import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'sources.json');
const OUTPUT_PATH = path.join(ROOT, 'site', 'data', 'patches.json');

const CLASS_META = {
  'DEATH KNIGHT': { name: 'Death Knight', color: '#c41e3a', mark: 'DK', icon: './assets/classes/deathknight.jpg' },
  'DEMON HUNTER': { name: 'Demon Hunter', color: '#a330c9', mark: 'DH', icon: './assets/classes/demonhunter.jpg' },
  DRUID: { name: 'Druid', color: '#ff7c0a', mark: 'DR', icon: './assets/classes/druid.jpg' },
  EVOKER: { name: 'Evoker', color: '#33937f', mark: 'EV', icon: './assets/classes/evoker.jpg' },
  HUNTER: { name: 'Hunter', color: '#aad372', mark: 'HU', icon: './assets/classes/hunter.jpg' },
  MAGE: { name: 'Mage', color: '#3fc7eb', mark: 'MA', icon: './assets/classes/mage.jpg' },
  MONK: { name: 'Monk', color: '#00ff98', mark: 'MO', icon: './assets/classes/monk.jpg' },
  PALADIN: { name: 'Paladin', color: '#f48cba', mark: 'PA', icon: './assets/classes/paladin.jpg' },
  PRIEST: { name: 'Priest', color: '#f3f3f3', mark: 'PR', icon: './assets/classes/priest.jpg' },
  ROGUE: { name: 'Rogue', color: '#fff468', mark: 'RO', icon: './assets/classes/rogue.jpg' },
  SHAMAN: { name: 'Shaman', color: '#0070dd', mark: 'SH', icon: './assets/classes/shaman.jpg' },
  WARLOCK: { name: 'Warlock', color: '#8788ee', mark: 'WL', icon: './assets/classes/warlock.jpg' },
  WARRIOR: { name: 'Warrior', color: '#c69b6d', mark: 'WA', icon: './assets/classes/warrior.jpg' },
};

const CLASS_SPECS = {
  'DEATH KNIGHT': ['Blood', 'Frost', 'Unholy'],
  'DEMON HUNTER': ['Devourer', 'Havoc', 'Vengeance'],
  DRUID: ['Balance', 'Feral', 'Guardian', 'Restoration'],
  EVOKER: ['Augmentation', 'Devastation', 'Devourer', 'Preservation'],
  HUNTER: ['Beast Mastery', 'Marksmanship', 'Survival'],
  MAGE: ['Arcane', 'Fire', 'Frost'],
  MONK: ['Brewmaster', 'Mistweaver', 'Windwalker'],
  PALADIN: ['Holy', 'Protection', 'Retribution'],
  PRIEST: ['Discipline', 'Holy', 'Shadow'],
  ROGUE: ['Assassination', 'Outlaw', 'Subtlety'],
  SHAMAN: ['Elemental', 'Enhancement', 'Restoration'],
  WARLOCK: ['Affliction', 'Demonology', 'Destruction'],
  WARRIOR: ['Arms', 'Fury', 'Protection'],
};

const normalizeHeading = (value) => cleanText(value).toUpperCase();
const slug = (value) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

function cleanText(value = '') {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function directText($, element) {
  const clone = $(element).clone();
  clone.children('ul, ol').remove();
  return cleanText(clone.text());
}

function isDeveloperNote(text) {
  return /^(developers?[’'] notes?|developer notes?):/i.test(text);
}

function stableSubject(text) {
  if (/^(?:the )?overall damage reduction\b|^all damage (?:dealt )?(?:increased|reduced)\b/i.test(text)) {
    return 'Overall damage';
  }
  const stripped = text
    .replace(/^(new (?:passive )?talent|apex talents?|pvp talent):\s*/i, '')
    .replace(/\s*\([^)]*not yet implemented[^)]*\)/i, '')
    .trim();
  const dash = stripped.search(/\s[–—]\s/);
  if (dash > 0) return cleanText(stripped.slice(0, dash));

  const predicate = stripped.match(/^(.+?)(?=\s(?:now|has been|have been|is now|are now|can now|no longer|renamed|damage|healing|absorb|effectiveness|chance|base chance|grants?|increases?|reduces?|cooldown|duration|mana cost|health drain|cast and|main target|secondary target|bonus)\b)/i);
  if (predicate?.[1]) return cleanText(predicate[1]);

  return cleanText(stripped.split(/[.;]/, 1)[0]).slice(0, 90);
}

function parseFromToRevision(text) {
  const match = text.match(/\bfrom\s+(\d+(?:\.\d+)?%?)\s+to\s+(\d+(?:\.\d+)?%?)/i);
  if (!match) return null;
  const isOutputReduction = /\boverall damage reduction\b/i.test(text);
  return {
    from: `${isOutputReduction ? '−' : ''}${match[1]}`,
    to: `${isOutputReduction ? '−' : ''}${match[2]}`,
    lowerIsBetter: isOutputReduction,
  };
}

function numericVector(value) {
  if (!value) return [];
  return extractValueTokens(value).flatMap((token) => {
    const multiplier = /minutes?/i.test(token) ? 60 : 1;
    return [...token.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]) * multiplier);
  });
}

function compareNumericValues(currentValue, baseline) {
  const current = numericVector(currentValue);
  const live = numericVector(baseline);
  if (!current.length || current.length !== live.length) return null;

  const differences = current.map((value, index) => Math.sign(value - live[index])).filter(Boolean);
  if (!differences.length) return null;
  if (differences.every((difference) => difference > 0)) return 1;
  if (differences.every((difference) => difference < 0)) return -1;
  return 0;
}

function hasBenefitMetric(text) {
  return /\b(damage|healing|heals?|absorbs?|shield|leech|effectiveness|chance|duration|lasts?|persists?|stores?|accumulates?|transfers?|refunds?|generates?|fury|rage|extends?|faster|frequently|cleaves?|strikes?|hits?|parry|cooldown|mana cost|resource cost|cast time|costs?|value|yards?|targets?|reduces?\b[^.]{0,50}\b(?:damage taken|cost)|summons?)\b/i.test(text);
}

function lowerIsBetterMetric(text) {
  return /\b(?:every \d|costs?\s+\d|loses?\b[^.]{0,30}\bhealing|decreases? the duration|(?:cast time|cooldown|mana cost|resource cost|damage taken)\b[^.]{0,40}\b(?:increased|reduced|decreased) to|increases?\s+(?:your\s+)?damage taken by)\b/i.test(text);
}

function classifyDirection(text, currentValue = null, baseline = null) {
  const positiveWord = /\b(increased|increases|additional|new (?:passive )?talent|can now|grants?|improved)\b/i.test(text);
  const hardNegativeWord = /\b(reduced|decreased|removed|no longer|less damage)\b/i.test(text);
  const mechanicReduction = /\b(reduces|decreases)\b/i.test(text);
  if (positiveWord && hardNegativeWord) return 'changed';
  const inlineRevision = parseFromToRevision(text);
  if (inlineRevision) {
    const comparison = compareNumericValues(inlineRevision.to, inlineRevision.from);
    if (comparison) {
      const effectiveComparison = inlineRevision.lowerIsBetter ? comparison * -1 : comparison;
      return effectiveComparison > 0 ? 'buff' : 'nerf';
    }
  }
  const pairedDirection = inferDirectionFromBaselinePairs(text);
  if (pairedDirection) return pairedDirection;

  const comparison = compareNumericValues(currentValue, baseline);
  const benefitMetric = hasBenefitMetric(text);
  if (comparison === 0 && benefitMetric) return 'changed';
  if (comparison && benefitMetric) {
    const effectiveComparison = lowerIsBetterMetric(text) ? comparison * -1 : comparison;
    return effectiveComparison > 0 ? 'buff' : 'nerf';
  }

  const beneficialReduction = /(?:\b(?:reduces?|decreases?|reduced|decreased)\b[^.]{0,40}\b(?:cooldown|damage taken|mana cost|resource cost|cast time)\b|\b(?:cooldown|damage taken|mana cost|resource cost|cast time)\b[^.]{0,40}\b(?:reduced|decreased)\b)/i.test(text);
  const harmfulIncrease = /(?:\b(?:increases?|increased)\b[^.]{0,40}\b(?:cooldown|damage taken|mana cost|resource cost|cast time)\b|\b(?:cooldown|damage taken|mana cost|resource cost|cast time)\b[^.]{0,40}\b(?:increases?|increased)\b)/i.test(text);
  if (positiveWord && !hardNegativeWord) return harmfulIncrease ? 'nerf' : 'buff';
  if (hardNegativeWord && !positiveWord) return beneficialReduction ? 'buff' : 'nerf';
  if (mechanicReduction) return beneficialReduction ? 'buff' : 'nerf';
  return 'changed';
}

function extractBaseline(text) {
  const values = [...text.matchAll(/\(was ([^)]+)\)/gi)].map((match) => cleanText(match[1]));
  return values.length ? values.join(' · ') : null;
}

function extractValueTokens(value) {
  return [...value.matchAll(
    /\b\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?(?:\s*\/\s*\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?)?(?:\s+(?:seconds?|minutes?|yards?|targets?|charges?|stacks?|times?|points?|Fury|Rage|Astral Power))?/gi,
  )].map((match) => cleanText(match[0]).replace(/\s*\/\s*/g, '/'));
}
function valueKind(value) {
  if (value.includes('%')) return 'percent';
  if (/seconds?|minutes?/i.test(value)) return 'time';
  if (/yards?/i.test(value)) return 'distance';
  if (/Fury|Rage|Astral Power/i.test(value)) return 'resource';
  if (/targets?|charges?|stacks?|times?|points?/i.test(value)) return 'count';
  return 'number';
}

function extractValuePairsWithBaseline(text) {
  const baselineMatches = [...text.matchAll(/\(was ([^)]+)\)/gi)];
  const pairs = [];
  let segmentStart = 0;

  for (const baselineMatch of baselineMatches) {
    const segment = text.slice(segmentStart, baselineMatch.index);
    const currentTokens = extractValueTokens(segment);
    const baselineTokens = extractValueTokens(baselineMatch[1]);
    const used = new Set();
    const selectedForPair = [];

    for (const baselineToken of [...baselineTokens].reverse()) {
      const kind = valueKind(baselineToken);
      let index = currentTokens.findLastIndex((token, candidateIndex) => (
        !used.has(candidateIndex) && valueKind(token) === kind
      ));
      if (index < 0) index = currentTokens.findLastIndex((_, candidateIndex) => !used.has(candidateIndex));
      if (index < 0) continue;
      used.add(index);
      selectedForPair.unshift(currentTokens[index]);
    }

    pairs.push({ current: selectedForPair, baseline: baselineTokens, segment });
    segmentStart = baselineMatch.index + baselineMatch[0].length;
  }

  return pairs;
}

function extractValuesPairedWithBaseline(text) {
  return extractValuePairsWithBaseline(text).flatMap((pair) => pair.current);
}

function inferDirectionFromBaselinePairs(text) {
  const pairs = extractValuePairsWithBaseline(text);
  if (!pairs.length) return null;
  const directions = [];

  for (const pair of pairs) {
    const comparison = compareNumericValues(pair.current.join(' · '), pair.baseline.join(' · '));
    if (comparison === null || !hasBenefitMetric(pair.segment)) return null;
    if (comparison === 0) return 'changed';
    const effectiveComparison = lowerIsBetterMetric(pair.segment) ? comparison * -1 : comparison;
    directions.push(effectiveComparison > 0 ? 'buff' : 'nerf');
  }

  return directions.every((direction) => direction === directions[0]) ? directions[0] : 'changed';
}

function extractCurrentValue(text, direction) {
  const inlineRevision = parseFromToRevision(text);
  if (inlineRevision) return inlineRevision.to;
  const pairedValues = extractValuesPairedWithBaseline(text);
  if (pairedValues.length) return pairedValues.join(' · ');

  const change = text.match(
    /\b(increased|reduced|decreased) (to|by) (\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?(?:\s*\/\s*\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?)?(?:\s+(?:seconds?|minutes?|yards?|targets?|charges?|stacks?|times?|points?|Fury|Rage|Astral Power))?)/i,
  );
  if (change) {
    const sign = change[2].toLowerCase() === 'by'
      ? (/increased/i.test(change[1]) ? '+' : '−')
      : '';
    return `${sign}${cleanText(change[3]).replace(/\s*\/\s*/g, '/')}`;
  }

  const beforeBaseline = text.replace(/\s*\(was [^)]+\)/gi, '');
  const value = beforeBaseline.match(
    /\b\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?(?:\s*\/\s*\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?)?(?:\s+(?:seconds?|minutes?|yards?|targets?|charges?|stacks?|times?|points?|Fury|Rage|Astral Power))?/i,
  );
  if (value) return cleanText(value[0]).replace(/\s*\/\s*/g, '/');
  return direction === 'changed' ? 'Changed' : direction === 'buff' ? 'Buffed' : 'Nerfed';
}

function parseList($, list, classKey, context, output) {
  $(list).children('li').each((_, li) => {
    const text = directText($, li);
    const childLists = $(li).children('ul, ol');
    const strong = cleanText($(li).children('strong').first().text());
    const isContainer = childLists.length > 0 && strong && text === strong;

    if (isContainer) {
      childLists.each((__, child) => parseList($, child, classKey, [...context, strong], output));
      return;
    }

    if (text && !isDeveloperNote(text)) {
      const validSpecs = new Set((CLASS_SPECS[classKey] || []).map(normalizeHeading));
      const specIndex = context.findIndex((part) => validSpecs.has(normalizeHeading(part)));
      const spec = specIndex >= 0 ? context[specIndex] : 'Class-wide';
      const categoryParts = context.filter((part, index) => (
        index !== specIndex && normalizeHeading(part) !== 'HERO TALENTS'
      ));
      output.push({
        classKey,
        spec,
        category: categoryParts.join(' · ') || null,
        subject: stableSubject(text),
        text,
      });
    }

    childLists.each((__, child) => parseList($, child, classKey, context, output));
  });
}

export function parseClassChanges(cooked) {
  const $ = cheerio.load(cooked);
  const output = [];

  $('h2').each((_, heading) => {
    if (normalizeHeading($(heading).text()) !== 'CLASSES') return;

    let pendingClass = null;
    let sibling = $(heading).next();
    while (sibling.length && !sibling.is('h2')) {
      if (sibling.is('p')) {
        const classKey = normalizeHeading(directText($, sibling));
        pendingClass = CLASS_META[classKey] ? classKey : null;
      } else if (sibling.is('ul, ol')) {
        if (pendingClass) {
          parseList($, sibling, pendingClass, [], output);
          pendingClass = null;
        } else {
          sibling.children('li').each((__, li) => {
            const text = directText($, li);
            const classKey = normalizeHeading(text);
            const classList = $(li).children('ul, ol').first();

            if (CLASS_META[classKey] && classList.length) {
              parseList($, classList, classKey, [], output);
            } else if (text && !isDeveloperNote(text)) {
              output.push({ classKey: 'ALL CLASSES', spec: 'General', category: null, subject: stableSubject(text), text });
            }
          });
        }
      }
      sibling = sibling.next();
    }
  });

  return output;
}

function changeKey(change) {
  const identity = [change.classKey, change.spec, change.category, change.subject]
    .map((part) => slug(part || ''))
    .join('|');
  return createHash('sha1').update(identity).digest('hex').slice(0, 12);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'WoW-PTR-Ledger/1.0 (+https://github.com/)',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

async function fetchAllPosts(source) {
  const base = `https://${source.region}.forums.blizzard.com/en/wow/t/${source.topicId}`;
  const topic = await fetchJson(`${base}.json`);
  const loaded = topic.post_stream.posts || [];
  const loadedIds = new Set(loaded.map((post) => post.id));
  const missing = (topic.post_stream.stream || []).filter((id) => !loadedIds.has(id));
  const fetched = [];

  for (let index = 0; index < missing.length; index += 20) {
    const params = new URLSearchParams();
    for (const id of missing.slice(index, index + 20)) params.append('post_ids[]', String(id));
    const page = await fetchJson(`${base}/posts.json?${params}`);
    fetched.push(...(page.post_stream.posts || []));
  }

  return [...loaded, ...fetched]
    .filter((post) => post.cooked)
    .sort((a, b) => a.post_number - b.post_number);
}

export function buildPatch(source, posts) {
  const changes = new Map();
  const rounds = [];
  const baseUrl = `https://${source.region}.forums.blizzard.com/en/wow/t/${source.topicId}`;

  for (const post of posts) {
    const parsed = parseClassChanges(post.cooked);
    if (!parsed.length) continue;

    const date = post.created_at;
    const url = `${baseUrl}/${post.post_number}`;
    const seenInRound = new Map();

    for (const raw of parsed) {
      let key = changeKey(raw);
      const occurrence = (seenInRound.get(key) || 0) + 1;
      seenInRound.set(key, occurrence);
      if (occurrence > 1) key = `${key}-${occurrence}`;

      const baseline = extractBaseline(raw.text);
      const preliminaryDirection = classifyDirection(raw.text);
      const currentValue = extractCurrentValue(raw.text, preliminaryDirection);
      const direction = classifyDirection(raw.text, currentValue, baseline);
      const historyItem = {
        round: post.post_number,
        date,
        text: raw.text,
        value: currentValue,
        source: url,
      };
      const existing = changes.get(key);

      if (existing) {
        const previous = existing.history.at(-1);
        if (previous.text !== raw.text) existing.history.push(historyItem);
        existing.text = raw.text;
        existing.value = historyItem.value;
        existing.direction = direction;
        existing.baseline = baseline || existing.baseline;
        existing.lastChanged = date;
      } else {
        changes.set(key, {
          id: key,
          classKey: raw.classKey,
          spec: raw.spec,
          category: raw.category,
          subject: raw.subject,
          text: raw.text,
          value: historyItem.value,
          baseline,
          direction,
          firstSeen: date,
          lastChanged: date,
          history: [historyItem],
        });
      }
    }

    rounds.push({
      number: post.post_number,
      date,
      updatedAt: post.updated_at,
      changes: parsed.length,
      source: url,
      label: rounds.length === 0 ? 'Initial notes' : `Update ${rounds.length}`,
    });
  }

  const grouped = new Map();
  for (const change of changes.values()) {
    const key = change.classKey;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(change);
  }

  const classOrder = ['ALL CLASSES', ...Object.keys(CLASS_META)];
  const classes = [...grouped.entries()]
    .sort(([a], [b]) => classOrder.indexOf(a) - classOrder.indexOf(b))
    .map(([key, classChanges]) => {
      const meta = key === 'ALL CLASSES'
        ? { name: 'All classes', color: '#a7b0c0', mark: 'ALL' }
        : CLASS_META[key];
      return {
        id: slug(meta.name),
        ...meta,
        changes: classChanges.sort((a, b) => a.spec.localeCompare(b.spec) || a.subject.localeCompare(b.subject)),
      };
    });

  const latestRound = rounds.at(-1);
  return {
    id: source.id,
    name: source.name,
    label: `${source.id} · ${source.name}`,
    status: source.status,
    current: Boolean(source.current),
    topicId: source.topicId,
    source: baseUrl,
    lastUpdated: latestRound?.updatedAt || latestRound?.date || null,
    rounds,
    classes,
    stats: {
      classes: classes.filter((item) => item.id !== 'all-classes').length,
      changes: classes.reduce((sum, item) => sum + item.changes.length, 0),
      revised: classes.reduce((sum, item) => sum + item.changes.filter((change) => change.history.length > 1).length, 0),
    },
  };
}

async function readExisting() {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const existing = await readExisting();
  const previousById = new Map((existing?.patches || []).map((patch) => [patch.id, patch]));
  const patches = [];

  for (const source of config.patches) {
    try {
      const posts = await fetchAllPosts(source);
      const patch = buildPatch(source, posts);
      if (!patch.rounds.length) throw new Error(`No class notes found for ${source.id}`);
      patches.push(patch);
      console.log(`${source.id}: ${patch.stats.changes} current changes across ${patch.rounds.length} note rounds`);
    } catch (error) {
      const previous = previousById.get(source.id);
      if (!previous) throw error;
      console.warn(`${source.id}: source unavailable; preserving existing data (${error.message})`);
      patches.push(previous);
    }
  }

  const latest = patches.map((patch) => patch.lastUpdated).filter(Boolean).sort().at(-1) || null;
  const output = { schemaVersion: 1, generatedAt: latest, patches };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const before = existing ? `${JSON.stringify(existing, null, 2)}\n` : '';

  if (serialized === before) {
    console.log('Data is already current.');
    return;
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, serialized);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
