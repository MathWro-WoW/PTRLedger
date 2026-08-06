import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'sources.json');
const OUTPUT_PATH = path.join(ROOT, 'site', 'data', 'patches.json');
const TALENT_DATA_URL = 'https://www.raidbots.com/static/data/ptr/talents.json';
const ABILITY_ICON_DIR = path.join(ROOT, 'site', 'assets', 'abilities');
const ABILITY_ICON_PATH = './assets/abilities';
const ABILITY_ICON_URL = 'https://render.worldofwarcraft.com/eu/icons/56';

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
  return /^(?:developer[’']s|developers[’']|developer) notes?\b:?\s*/i.test(text);
}

function isTalentChange(context, text) {
  return context.some((part) => /\btalents?\b/i.test(part)) || /\btalents?\b/i.test(text);
}

function stableSubject(text) {
  if (/^(?:the )?overall damage reduction\b|^all (?:ability )?damage\b/i.test(text)) {
    return 'Overall damage';
  }
  if (/^all healing and absorption\b/i.test(text)) return 'Overall healing and absorption';
  if (/^all healing\b/i.test(text)) return 'Overall healing';

  const stripped = text
    .replace(/^(new (?:passive )?talent|apex talents?|pvp talent):\s*/i, '')
    .replace(/\s*\([^)]*not yet implemented[^)]*\)/i, '')
    .trim();
  const dash = stripped.search(/\s[–—]\s/);
  if (dash > 0) return cleanText(stripped.slice(0, dash));

  const namedProperty = stripped.match(/^((?:[A-Z][\p{L}\d’'():-]*(?:\s+(?:of|the|and|for|from|[A-Z][\p{L}\d’'():-]*))*))\s+(?=(?:damage|healing|absorb|effectiveness|chance|base chance|cooldown|duration|mana cost|health drain|bonus)\b)/u);
  if (namedProperty?.[1]) return cleanText(namedProperty[1]).replace(/[’']s$/, '');

  const predicate = stripped.match(/^(.+?)(?=\s(?:now|has been|has a new icon|has moved|have been|is now|are now|can now|will|no longer|renamed|causes?|damage|heals?|healing|absorb|effectiveness|chance|base chance|grants?|increases?|reduces?|cooldown|duration|mana cost|health drain|cast and|main target|secondary target|bonus)\b)/i);
  if (predicate?.[1]) return cleanText(predicate[1]).replace(/\s+also$/i, '').replace(/[’']s$/, '');

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

function parseRelativePercentAdjustment(item) {
  if (item.baseline !== null) return null;
  if (!/\b(?:increased|reduced|decreased) by \d+(?:\.\d+)?%/i.test(item.text)) return null;
  const match = item.value.match(/^([+−-])(\d+(?:\.\d+)?)%$/);
  if (!match) return null;
  return (match[1] === '+' ? 1 : -1) * Number(match[2]) / 100;
}

function formatSignedPercent(value) {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  const amount = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  if (Math.abs(value) < 0.05) return '0%';
  return `${value > 0 ? '+' : '−'}${amount}%`;
}

function applyCumulativeTuning(change) {
  delete change.cumulative;
  delete change.latestAdjustment;
  for (const item of change.history) {
    delete item.effectiveValue;
    delete item.effectiveDirection;
  }
  if (change.history.length < 2) return;

  let factor = 1;
  for (const item of change.history) {
    const adjustment = parseRelativePercentAdjustment(item);
    if (adjustment === null) return;
    factor *= 1 + adjustment;
    const effectivePercent = (factor - 1) * 100;
    item.effectiveValue = formatSignedPercent(effectivePercent);
    item.effectiveDirection = effectivePercent > 0.05 ? 'buff' : effectivePercent < -0.05 ? 'nerf' : 'changed';
  }

  const latest = change.history.at(-1);
  change.cumulative = true;
  change.latestAdjustment = latest.value;
  change.value = latest.effectiveValue;
  change.direction = latest.effectiveDirection;
  change.baseline = null;
}

function hasBenefitMetric(text) {
  return /\b(damage|healing|heals?|absorbs?|shield|leech|effectiveness|chance|duration|lasts?|persists?|stores?|accumulates?|transfers?|refunds?|generates?|fury|rage|energy|focus|holy power|astral power|insanity|extends?|faster|frequently|cleaves?|strikes?|hits?|parry|cooldown|(?:mana|energy|focus|rage|holy power|astral power|insanity|resource) cost|cast time|costs?|value|yards?|targets?|reduces?\b[^.]{0,50}\b(?:damage taken|cost)|summons?)\b/i.test(text);
}

function lowerIsBetterMetric(text) {
  return /\b(?:every \d|costs?\s+\d|loses?\b[^.]{0,30}\bhealing|decreases? the duration|(?:cast time|cooldown|(?:mana|energy|focus|rage|holy power|astral power|insanity|resource) cost|damage taken)\b[^.]{0,40}\b(?:increased|reduced|decreased) to|increases?\s+(?:your\s+)?damage taken by)\b/i.test(text);
}

function classifyDirection(text, currentValue = null, baseline = null) {
  const positiveWord = /\b(increased|increases|additional|new (?:passive )?talent|can now|grants?|improved)\b/i.test(text);
  const hardNegativeWord = /\b(reduced|decreased|removed|no longer|less damage)\b/i.test(text);
  const mechanicReduction = /\b(reduces|decreases)\b/i.test(text);
  if (/\bcan now only see\b/i.test(text)) return 'changed';
  if (/\berroneously granted\b/i.test(text)) return 'nerf';
  if (/\bduration\b[^.]{0,30}\bno longer reduced\b/i.test(text)) return 'buff';
  const lostBenefit = /\bno longer (?:grants?|increases?|causes?\b[^.]{0,60}\b(?:generate|grant|increase|deal|duplicate))\b/i.test(text);
  const laterBenefit = /\.\s*[^.]*\b(?:increased|increases|additional|grants?|generates?|causes?\b[^.]{0,40}\b(?:damage|healing))\b/i.test(text);
  if (lostBenefit && !laterBenefit) return 'nerf';
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

  const costMetric = '(?:mana|energy|focus|rage|holy power|astral power|insanity|resource) cost';
  const beneficialReduction = new RegExp(`(?:\\b(?:reduces?|decreases?|reduced|decreased)\\b[^.]{0,40}\\b(?:cooldown|damage taken|${costMetric}|cast time)\\b|\\b(?:cooldown|damage taken|${costMetric}|cast time)\\b[^.]{0,40}\\b(?:reduced|decreased)\\b)`, 'i').test(text);
  const harmfulIncrease = new RegExp(`(?:\\b(?:increases?|increased)\\b[^.]{0,40}\\b(?:cooldown|damage taken|${costMetric}|cast time)\\b|\\b(?:cooldown|damage taken|${costMetric}|cast time)\\b[^.]{0,40}\\b(?:increases?|increased)\\b)`, 'i').test(text);
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
    /\b\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?(?:\s*\/\s*\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?)?(?:\s+(?:additional\s+)?(?:seconds?|minutes?|yards?|targets?|charges?|stacks?|times?|points?|Fury|Rage|Energy|Focus|Holy Power|Astral Power|Insanity|Icicles?|orbs?|uses?|enemies?|allies?|casts?|Ghouls?))?/gi,
  )].map((match) => cleanText(match[0]).replace(/\s*\/\s*/g, '/'));
}
function valueKind(value) {
  if (value.includes('%')) return 'percent';
  if (/seconds?|minutes?/i.test(value)) return 'time';
  if (/yards?/i.test(value)) return 'distance';
  if (/Fury|Rage|Energy|Focus|Holy Power|Astral Power|Insanity/i.test(value)) return 'resource';
  if (/targets?|charges?|stacks?|times?|points?|Icicles?|orbs?|uses?|enemies?|allies?|casts?|Ghouls?/i.test(value)) return 'count';
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
    /\b(increased|reduced|decreased) (to|by) (\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?(?:\s*\/\s*\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?)?(?:\s+(?:additional\s+)?(?:seconds?|minutes?|yards?|targets?|charges?|stacks?|times?|points?|Fury|Rage|Energy|Focus|Holy Power|Astral Power|Insanity|Icicles?|orbs?|uses?|enemies?|allies?|casts?|Ghouls?))?)/i,
  );
  if (change) {
    const sign = change[2].toLowerCase() === 'by'
      ? (/increased/i.test(change[1]) ? '+' : '−')
      : '';
    let value = cleanText(change[3]).replace(/\s*\/\s*/g, '/');
    const resourceCost = text.slice(0, change.index).match(/\b(Fury|Rage|Energy|Focus|Holy Power|Astral Power|Insanity)\s+cost\b[^.]*$/i);
    if (resourceCost && !value.includes('%') && !/[A-Za-z]/.test(value)) {
      value = `${value} ${resourceCost[1]}`;
    }
    return `${sign}${value}`;
  }

  const beforeBaseline = text
    .replace(/\s*\(was [^)]+\)/gi, '')
    .replace(/\b(?:rank|row|tier|level)\s+\d+\b/gi, '')
    .replace(/\bseason\s+\d+\b/gi, '')
    .replace(/\b(?:2|4)[- ]set\b/gi, '');
  const value = beforeBaseline.match(
    /\b\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?(?:\s*\/\s*\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?%?)?(?:\s+(?:additional\s+)?(?:seconds?|minutes?|yards?|targets?|charges?|stacks?|times?|points?|Fury|Rage|Energy|Focus|Holy Power|Astral Power|Insanity|Icicles?|orbs?|uses?|enemies?|allies?|casts?|Ghouls?))?/i,
  );
  if (value) return cleanText(value[0]).replace(/\s*\/\s*/g, '/');
  return direction === 'changed' ? 'Changed' : direction === 'buff' ? 'Buffed' : 'Nerfed';
}

function isBareListLabel(text) {
  return text.length <= 120 && !/[.!?:]$/.test(text);
}

function parseList($, list, classKey, context, output, textPrefix = null, parentSubject = null) {
  $(list).children('li').each((_, li) => {
    const text = directText($, li);
    const childLists = $(li).children('ul, ol');
    const childItems = childLists.children('li').toArray();
    const strong = cleanText($(li).children('strong').first().text());
    const isContainer = childLists.length > 0 && strong && text === strong;
    const isGenericChangeParent = childLists.length > 0 && /\bhas been updated\s*[–—:]?\s*$/i.test(text);
    const isContextParent = childItems.length > 0
      && /:\s*$/.test(text)
      && childItems.every((child) => (
        $(child).children('ul, ol').length === 0 && isBareListLabel(directText($, child))
      ));

    if (isContainer || isGenericChangeParent || isContextParent) {
      const childContext = isContainer ? [...context, strong] : context;
      const childPrefix = isContextParent || isGenericChangeParent ? text : null;
      const childParentSubject = isGenericChangeParent
        ? cleanText(text.replace(/\s+has been updated\s*[–—:]?\s*$/i, ''))
        : null;
      childLists.each((__, child) => (
        parseList($, child, classKey, childContext, output, childPrefix, childParentSubject)
      ));
      return;
    }

    if (text && !isDeveloperNote(text)) {
      const validSpecs = new Set((CLASS_SPECS[classKey] || []).map(normalizeHeading));
      const specIndex = context.findLastIndex((part) => validSpecs.has(normalizeHeading(part)));
      const spec = specIndex >= 0 ? context[specIndex] : 'Class-wide';
      const categoryParts = context.filter((part) => (
        !validSpecs.has(normalizeHeading(part)) && normalizeHeading(part) !== 'HERO TALENTS'
      ));
      const dependsOnParent = Boolean(parentSubject)
        && /^(?:Now|No longer|Also|Additionally|This|Its|When)\b/i.test(text);
      const shouldPrefix = Boolean(textPrefix) && (!parentSubject || dependsOnParent);
      const normalizedPrefix = textPrefix?.replace(/\s*[–—:]\s*$/, ':');
      const presentedText = shouldPrefix
        ? `${normalizedPrefix} ${text}${/[.!?]$/.test(text) ? '' : '.'}`
        : text;
      const dependentLabel = cleanText(text.split(/[.;]/, 1)[0]).slice(0, 60);
      output.push({
        classKey,
        spec,
        isTalent: isTalentChange(context, presentedText),
        category: categoryParts.join(' · ') || null,
        subject: dependsOnParent ? `${parentSubject} · ${dependentLabel}` : stableSubject(text),
        text: presentedText,
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
              output.push({
                classKey: 'ALL CLASSES',
                spec: 'General',
                category: null,
                isTalent: isTalentChange([], text),
                subject: stableSubject(text),
                text,
              });
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

function normalizeAbilityName(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s*\(rank\s+\d+\)/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeIconName(value) {
  const icon = cleanText(value).toLowerCase().replace(/\.(?:blp|tga|jpe?g|png)$/i, '');
  return /^[a-z0-9_-]+$/.test(icon) ? icon : null;
}

export function createAbilityCatalog(trees) {
  const catalog = new Map();
  const seen = new Set();
  const groups = [
    ['class', 'classNodes'],
    ['spec', 'specNodes'],
    ['hero', 'heroNodes'],
    ['hero', 'subTreeNodes'],
  ];

  for (const tree of trees || []) {
    const classKey = normalizeHeading(tree.className || '');
    if (!CLASS_META[classKey]) continue;
    const spec = cleanText(tree.specName || '');

    for (const [scope, property] of groups) {
      for (const talentNode of tree[property] || []) {
        const entries = talentNode.entries || [];
        const fallbackEntry = entries.find((entry) => entry.icon || entry.spellId) || {};
        const names = [
          {
            name: talentNode.name,
            icon: fallbackEntry.icon,
            spellId: fallbackEntry.spellId,
          },
          ...entries,
        ];

        for (const entry of names) {
          const name = cleanText(entry.name || talentNode.name || '');
          const nameKey = normalizeAbilityName(name);
          if (!nameKey) continue;
          const iconName = normalizeIconName(entry.icon || fallbackEntry.icon || '');
          const spellId = Number(entry.spellId || fallbackEntry.spellId) || null;
          const dedupeKey = [
            classKey,
            spec,
            scope,
            nameKey,
            iconName,
            spellId,
            Boolean(talentNode.freeNode),
          ].join('|');
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          if (!catalog.has(classKey)) catalog.set(classKey, []);
          catalog.get(classKey).push({
            name,
            nameKey,
            spec,
            scope,
            isTalent: !talentNode.freeNode,
            iconName,
            spellId,
          });
        }
      }
    }
  }

  return catalog;
}

function resolveAbilityMetadata(change, catalog) {
  const subject = normalizeAbilityName(change.subject.split(' · ', 1)[0]);
  if (!subject) return null;
  const available = (catalog.get(change.classKey) || []).filter((entry) => {
    if (change.spec === 'Class-wide') return entry.scope === 'class';
    return entry.spec === change.spec;
  });
  const matches = available.map((entry) => ({
    entry,
    exact: entry.nameKey === subject,
  })).filter(({ entry, exact }) => exact || subject.startsWith(`${entry.nameKey} `));
  if (!matches.length) return null;

  const exact = matches.some((match) => match.exact);
  const preferred = matches.filter((match) => match.exact === exact);
  const longest = Math.max(...preferred.map(({ entry }) => entry.nameKey.length));
  const resolved = preferred.filter(({ entry }) => entry.nameKey.length === longest).map(({ entry }) => entry);
  const icons = [...new Set(resolved.map((entry) => entry.iconName).filter(Boolean))];
  const spellIds = [...new Set(resolved.map((entry) => entry.spellId).filter(Boolean))];

  return {
    abilityName: resolved[0].name,
    abilityType: resolved.some((entry) => entry.isTalent) ? 'talent' : 'spell',
    iconName: icons.length === 1 ? icons[0] : null,
    spellId: spellIds.length === 1 ? spellIds[0] : null,
  };
}

function previousChangesById(patch) {
  return new Map((patch?.classes || []).flatMap((classInfo) => (
    classInfo.changes.map((change) => [change.id, change])
  )));
}

export function enrichPatchWithAbilities(patch, catalog, previousPatch = null) {
  const previous = previousChangesById(previousPatch);

  for (const classInfo of patch.classes) {
    for (const change of classInfo.changes) {
      const resolved = resolveAbilityMetadata(change, catalog);
      const fallback = previous.get(change.id);
      change.isTalent = Boolean(
        change.isTalent
        || resolved?.abilityType === 'talent'
        || fallback?.isTalent,
      );
      change.abilityType = change.isTalent
        ? 'talent'
        : resolved?.abilityType || fallback?.abilityType || null;
      change.abilityName = resolved?.abilityName || fallback?.abilityName || null;
      change.spellId = resolved?.spellId || fallback?.spellId || null;
      const iconName = resolved?.iconName
        || normalizeIconName(path.basename(fallback?.icon || '', path.extname(fallback?.icon || '')));
      change.icon = iconName ? `${ABILITY_ICON_PATH}/${iconName}.jpg` : null;
    }
  }

  return patch;
}

async function cacheAbilityIcons(patches) {
  const references = new Map();
  for (const patch of patches) {
    for (const classInfo of patch.classes) {
      for (const change of classInfo.changes) {
        if (!change.icon) continue;
        if (!references.has(change.icon)) references.set(change.icon, []);
        references.get(change.icon).push(change);
      }
    }
  }
  if (!references.size) return;

  await mkdir(ABILITY_ICON_DIR, { recursive: true });
  const missing = [];
  for (const [iconPath, changes] of references) {
    const filename = path.basename(iconPath);
    try {
      await access(path.join(ABILITY_ICON_DIR, filename));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push({ iconPath, filename, changes });
    }
  }

  let downloaded = 0;
  for (let index = 0; index < missing.length; index += 12) {
    const results = await Promise.all(missing.slice(index, index + 12).map(async (item) => {
      try {
        const response = await fetch(`${ABILITY_ICON_URL}/${item.filename}`, {
          headers: {
            Accept: 'image/jpeg',
            'User-Agent': 'WoW-PTR-Ledger/1.0 (+https://github.com/)',
          },
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) throw new Error(`unexpected content type ${contentType || 'unknown'}`);
        await writeFile(path.join(ABILITY_ICON_DIR, item.filename), Buffer.from(await response.arrayBuffer()));
        return { ok: true, item };
      } catch (error) {
        return { ok: false, item, error };
      }
    }));

    for (const result of results) {
      if (result.ok) {
        downloaded += 1;
      } else {
        for (const change of result.item.changes) change.icon = null;
        console.warn(`Icon unavailable for ${result.item.iconPath} (${result.error.message})`);
      }
    }
  }

  if (downloaded) console.log(`Cached ${downloaded} new ability icons`);
}

function topicUrl(source) {
  const topicPath = source.slug ? `${source.slug}/${source.topicId}` : source.topicId;
  return `https://${source.region}.forums.blizzard.com/en/wow/t/${topicPath}`;
}

async function fetchAllPosts(source) {
  const base = topicUrl(source);
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
  const baseUrl = topicUrl(source);

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
        baseline,
        direction,
        source: url,
      };
      const existing = changes.get(key);

      if (existing) {
        const previous = existing.history.at(-1);
        if (previous.round !== post.post_number || previous.text !== raw.text) existing.history.push(historyItem);
        existing.text = raw.text;
        existing.value = historyItem.value;
        existing.direction = direction;
        existing.baseline = baseline ?? (numericVector(currentValue).length ? existing.baseline : null);
        existing.isTalent ||= raw.isTalent;
        existing.lastChanged = date;
        applyCumulativeTuning(existing);
      } else {
        changes.set(key, {
          id: key,
          classKey: raw.classKey,
          spec: raw.spec,
          category: raw.category,
          isTalent: raw.isTalent,
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
  let abilityCatalog = new Map();

  try {
    const trees = await fetchJson(TALENT_DATA_URL);
    if (!Array.isArray(trees) || !trees.length) throw new Error('talent dataset is empty');
    abilityCatalog = createAbilityCatalog(trees);
    console.log(`Loaded ${abilityCatalog.size} classes from the PTR talent dataset`);
  } catch (error) {
    console.warn(`Talent metadata unavailable; preserving known classifications (${error.message})`);
  }

  for (const source of config.patches) {
    try {
      const posts = await fetchAllPosts(source);
      const patch = buildPatch(source, posts);
      if (!patch.rounds.length) throw new Error(`No class notes found for ${source.id}`);
      enrichPatchWithAbilities(patch, abilityCatalog, previousById.get(source.id));
      patches.push(patch);
      console.log(`${source.id}: ${patch.stats.changes} current changes across ${patch.rounds.length} note rounds`);
    } catch (error) {
      const previous = previousById.get(source.id);
      if (!previous) throw error;
      console.warn(`${source.id}: source unavailable; preserving existing data (${error.message})`);
      patches.push(previous);
    }
  }

  await cacheAbilityIcons(patches);

  const latest = patches.map((patch) => patch.lastUpdated).filter(Boolean).sort().at(-1) || null;
  const output = { schemaVersion: 2, generatedAt: latest, patches };
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
