import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPatch,
  createAbilityCatalog,
  enrichPatchWithAbilities,
  parseClassChanges,
  selectAbilitySearchResult,
} from '../scripts/update-data.mjs';

const source = {
  id: '12.2',
  name: 'Example patch',
  topicId: 123,
  slug: 'example-patch',
  region: 'eu',
  status: 'PTR',
  current: true,
};

const finalSource = {
  id: '12.1-live',
  name: "Curse of Ula'tek — Live",
  type: 'article',
  url: 'https://worldofwarcraft.blizzard.com/en-us/news/24293281',
  status: 'LIVE',
  current: true,
};

const post = (postNumber, date, note) => ({
  post_number: postNumber,
  created_at: date,
  updated_at: date,
  cooked: `<h2><strong>CLASSES</strong></h2>
    <ul>
      <li><strong>MAGE</strong>
        <ul>
          <li><strong>Frost</strong>
            <ul>${note}</ul>
          </li>
        </ul>
      </li>
    </ul>`,
});

test('parses nested class and specialization notes', () => {
  const changes = parseClassChanges(post(1, '2026-01-01T00:00:00Z', `
    <li><em>Developers’ notes: This should not become a change.</em></li>
    <li>Frozen Orb damage increased by 12% (was 8%).</li>
  `).cooked);

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], {
    classKey: 'MAGE',
    spec: 'Frost',
    isTalent: false,
    category: null,
    subject: 'Frozen Orb',
    text: 'Frozen Orb damage increased by 12% (was 8%).',
  });
});

test('marks source-confirmed talent changes without guessing ordinary abilities', () => {
  const changes = parseClassChanges(post(1, '2026-01-01T00:00:00Z', `
    <li>New Talent: Glacial Current – Frozen Orb damage increased by 20%.</li>
    <li>Frostbolt damage increased by 10%.</li>
    <li><strong>Hero Talents</strong>
      <ul><li><strong>Spellslinger</strong>
        <ul><li>Splinterstorm damage increased by 15%.</li></ul>
      </li></ul>
    </li>
  `).cooked);

  assert.deepEqual(changes.map(({ subject, category, isTalent }) => ({ subject, category, isTalent })), [
    { subject: 'Glacial Current', category: null, isTalent: true },
    { subject: 'Frostbolt', category: null, isTalent: false },
    { subject: 'Splinterstorm', category: 'Spellslinger', isTalent: true },
  ]);
});

test('classifies normal talent-tree entries and enriches resolved abilities', () => {
  const catalog = createAbilityCatalog([{
    className: 'Mage',
    specName: 'Frost',
    classNodes: [],
    specNodes: [
      {
        name: 'Frozen Orb',
        entries: [{
          name: 'Frozen Orb',
          spellId: 84714,
          icon: 'spell_frost_frozenorb',
        }],
      },
      {
        name: 'Frostbolt',
        freeNode: true,
        entries: [{
          name: 'Frostbolt',
          spellId: 116,
          icon: 'spell_frost_frostbolt02',
        }],
      },
      {
        name: 'Splitting Ice',
        entries: [{
          name: 'Splitting Ice',
          spellId: 56377,
          icon: 'spell_frost_ice_shards',
        }],
      },
    ],
  }]);
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', `
      <li>Frozen Orb damage increased by 12% (was 8%).</li>
      <li>Frostbolt damage increased by 10%.</li>
      <li>Splitting Ice damage increased by 10%.</li>
      <li>Ice Lance damage increased by 8%.</li>
    `),
  ]);

  enrichPatchWithAbilities(patch, catalog);
  const frozenOrb = patch.classes[0].changes.find((change) => change.subject === 'Frozen Orb');
  const frostbolt = patch.classes[0].changes.find((change) => change.subject === 'Frostbolt');
  const splittingIce = patch.classes[0].changes.find((change) => change.subject === 'Splitting Ice');
  const unresolved = patch.classes[0].changes.find((change) => change.subject === 'Ice Lance');

  assert.equal(frozenOrb.isTalent, true);
  assert.equal(frozenOrb.abilityType, 'talent');
  assert.equal(frozenOrb.abilityName, 'Frozen Orb');
  assert.equal(frozenOrb.spellId, 84714);
  assert.equal(frozenOrb.icon, './assets/abilities/spell_frost_frozenorb.jpg');
  assert.equal(frostbolt.isTalent, false);
  assert.equal(frostbolt.abilityType, 'spell');
  assert.equal(frostbolt.spellId, 116);
  assert.equal(frostbolt.icon, './assets/abilities/spell_frost_frostbolt02.jpg');
  assert.equal(splittingIce.icon, './assets/abilities/spell_frost_ice-shards.jpg');
  assert.equal(unresolved.isTalent, false);
  assert.equal(unresolved.abilityType, null);
  assert.equal(unresolved.abilityName, null);
  assert.equal(unresolved.spellId, null);
  assert.equal(unresolved.icon, null);
});

test('source-confirmed talents override free ability metadata', () => {
  const catalog = createAbilityCatalog([{
    className: 'Mage',
    specName: 'Frost',
    specNodes: [{
      name: 'Glacial Current',
      freeNode: true,
      entries: [{
        name: 'Glacial Current',
        spellId: 123456,
        icon: 'spell_frost_icefloes',
      }],
    }],
  }]);
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', `
      <li>New Talent: Glacial Current – Damage increased by 20%.</li>
      <li><strong>Hero Talents</strong>
        <ul><li><strong>Spellslinger</strong>
          <ul><li>Splinterstorm damage increased by 15%.</li></ul>
        </li></ul>
      </li>
    `),
  ]);

  enrichPatchWithAbilities(patch, catalog);
  const changes = patch.classes[0].changes;
  const glacialCurrent = changes.find((change) => change.subject === 'Glacial Current');
  const splinterstorm = changes.find((change) => change.subject === 'Splinterstorm');

  assert.equal(glacialCurrent.isTalent, true);
  assert.equal(glacialCurrent.abilityType, 'talent');
  assert.equal(glacialCurrent.icon, './assets/abilities/spell_frost_icefloes.jpg');
  assert.equal(splinterstorm.isTalent, true);
  assert.equal(splinterstorm.abilityType, 'talent');
  assert.equal(splinterstorm.icon, null);
});

test('resolves class-wide notes against specialization metadata when unique', () => {
  const catalog = createAbilityCatalog([{
    className: 'Mage',
    specName: 'Arcane',
    specNodes: [{
      name: 'Prismatic Bolt',
      entries: [{
        name: 'Prismatic Bolt',
        spellId: 123456,
        icon: 'spell_arcane_arcanetorrent',
      }],
    }],
  }]);
  const patch = {
    classes: [{
      changes: [{
        id: 'class-wide-prismatic-bolt',
        classKey: 'MAGE',
        spec: 'Class-wide',
        subject: 'Prismatic Bolt',
        isTalent: true,
      }],
    }],
  };

  enrichPatchWithAbilities(patch, catalog);

  assert.equal(patch.classes[0].changes[0].abilityName, 'Prismatic Bolt');
  assert.equal(patch.classes[0].changes[0].spellId, 123456);
  assert.equal(
    patch.classes[0].changes[0].icon,
    './assets/abilities/spell_arcane_arcanetorrent.jpg',
  );
});

test('resolves client-backed spells, pet effects, auto-attacks, and ranked talent icons', () => {
  const catalog = createAbilityCatalog([{
    className: 'Death Knight',
    specName: 'Unholy',
    heroNodes: [{
      id: 95046,
      name: 'The Blood is Life',
      entries: [{
        name: 'The Blood is Life',
        spellId: 434260,
        icon: 'achievement_nazmir_boss_bloodofghuun',
      }],
    }],
    subTreeNodes: [{ id: 999, name: 'San’layn', entries: [] }],
    specNodes: [{
      id: 110354,
      name: 'Forbidden Knowledge / Forbidden Knowledge / Forbidden Knowledge',
      entries: [
        {
          name: 'Forbidden Knowledge',
          spellId: 1242158,
          icon: 'inv12_apextalent_deathknight_forbiddenknowledge',
        },
        {
          name: 'Forbidden Knowledge',
          spellId: 1256565,
          icon: 'spell_shadow_fingerofdeath',
        },
        {
          name: 'Forbidden Knowledge',
          spellId: 1256566,
          icon: 'inv12_apextalent_deathknight_forbiddenknowledge',
        },
      ],
    }],
  }]);
  const changes = [
    { id: 'frost-fever', classKey: 'DEATH KNIGHT', spec: 'Frost', subject: 'Frost Fever', isTalent: false },
    { id: 'blood-beast', classKey: 'DEATH KNIGHT', spec: 'Blood', subject: 'Blood Beast auto-attack', isTalent: true },
    { id: 'auto-attack', classKey: 'DEATH KNIGHT', spec: 'Unholy', subject: 'Auto-attack', isTalent: false },
    { id: 'melee-auto', classKey: 'MONK', spec: 'Windwalker', subject: 'Melee auto-attack', isTalent: false },
    { id: 'death-order', classKey: 'DEATH KNIGHT', spec: 'Unholy', subject: 'Death Order', isTalent: false },
    { id: 'dread-plague', classKey: 'DEATH KNIGHT', spec: 'Unholy', subject: 'Dread Plague', isTalent: false },
    { id: 'epidemic', classKey: 'DEATH KNIGHT', spec: 'Unholy', subject: 'Epidemic', isTalent: false },
    { id: 'epidemic-order', classKey: 'DEATH KNIGHT', spec: 'Unholy', subject: 'Epidemic Order', isTalent: false },
    { id: 'infected-claw', classKey: 'DEATH KNIGHT', spec: 'Unholy', subject: 'Infected Claw', isTalent: false },
    { id: 'ranged-auto', classKey: 'HUNTER', spec: 'Class-wide', subject: 'Ranged auto-shot', isTalent: false },
    { id: 'blood-is-life', classKey: 'DEATH KNIGHT', spec: 'Unholy', subject: 'San’layn: Blood is Life', isTalent: true },
    { id: 'apex-base', classKey: 'DEATH KNIGHT', spec: 'Unholy', subject: 'Forbidden Knowledge', isTalent: true },
    { id: 'apex-rank-3', classKey: 'DEATH KNIGHT', spec: 'Unholy', subject: 'Forbidden Knowledge (Rank 3) has been updated', isTalent: true },
  ];
  const patch = { classes: [{ changes }] };

  enrichPatchWithAbilities(patch, catalog);
  const expected = {
    'frost-fever': ['spell', 'Frost Fever', 55095, 'spell_deathknight_frostfever'],
    'blood-beast': ['talent', 'Blood Beast', 434237, 'achievement_nazmir_boss_bloodofghuun'],
    'auto-attack': ['spell', 'Auto Attack', 6603, 'inv_sword_04'],
    'melee-auto': ['spell', 'Auto Attack', 6603, 'inv_sword_04'],
    'death-order': ['spell', 'Death Order', 1294261, 'inv_ghoulnorthrend'],
    'dread-plague': ['spell', 'Dread Plague', 1240996, 'inv12_ability_deathknight_empowereddreadplague'],
    epidemic: ['spell', 'Epidemic', 207317, 'spell_nature_nullifydisease'],
    'epidemic-order': ['spell', 'Epidemic Order', 1294480, 'inv_ghoulnorthrend'],
    'infected-claw': ['spell', 'Infected Claws', 207272, 'ability_creature_disease_05'],
    'ranged-auto': ['spell', 'Auto Shot', 75, 'ability_whirlwind'],
    'blood-is-life': ['talent', 'The Blood is Life', 434260, 'achievement_nazmir_boss_bloodofghuun'],
    'apex-base': ['talent', 'Forbidden Knowledge', 1242158, 'inv12_apextalent_deathknight_forbiddenknowledge'],
    'apex-rank-3': ['talent', 'Forbidden Knowledge', 1256566, 'inv12_apextalent_deathknight_forbiddenknowledge'],
  };

  for (const change of changes) {
    const [abilityType, abilityName, spellId, iconName] = expected[change.id];
    assert.equal(change.abilityType, abilityType, change.id);
    assert.equal(change.abilityName, abilityName, change.id);
    assert.equal(change.spellId, spellId, change.id);
    assert.equal(change.icon, `./assets/abilities/${iconName}.jpg`, change.id);
  }
});

test('accepts only exact, class-aware spell search metadata', () => {
  const glacialAdvance = selectAbilitySearchResult({
    results: [
      {
        type: 6,
        id: 194913,
        name: 'Glacial Advance',
        icon: 'ability_hunter_glacialtrap',
        pinBreadcrumb: ['Specializations', 'Death Knight'],
      },
      {
        type: 6,
        id: 999999,
        name: 'Glacial Advance',
        icon: 'spell_frost_frostbolt02',
        pinBreadcrumb: ['NPC Abilities'],
      },
    ],
  }, 'DEATH KNIGHT', 'Glacial Advance');
  const ambiguous = selectAbilitySearchResult({
    results: [
      { type: 6, id: 1, name: 'Consume', icon: 'spell_shadow_lifedrain' },
      { type: 6, id: 2, name: 'Consume', icon: 'ability_demonhunter_consume_soul' },
    ],
  }, 'DEMON HUNTER', 'Consume');
  const partial = selectAbilitySearchResult({
    results: [
      { type: 6, id: 3, name: 'Glacial Advance Trigger', icon: 'ability_hunter_glacialtrap' },
    ],
  }, 'DEATH KNIGHT', 'Glacial Advance');
  const databaseOnly = selectAbilitySearchResult({
    results: [],
    categories: {
      database: [{
        type: 6,
        id: 5176,
        name: 'Wrath',
        icon: 'spell_nature_wrathv2',
        pinBreadcrumb: ['Abilities', 'Druid'],
      }],
    },
  }, 'DRUID', 'Wrath');

  assert.deepEqual(glacialAdvance, {
    abilityName: 'Glacial Advance',
    spellId: 194913,
    iconName: 'ability_hunter_glacialtrap',
  });
  assert.deepEqual(databaseOnly, {
    abilityName: 'Wrath',
    spellId: 5176,
    iconName: 'spell_nature_wrathv2',
  });
  assert.equal(ambiguous, null);
  assert.equal(partial, null);
});

test('skips generic parent notes while retaining their nested changes', () => {
  const changes = parseClassChanges(post(1, '2026-01-01T00:00:00Z', `
    <li>Ravager has been updated:
      <ul>
        <li><em>Developers’ notes: Context for the nested changes.</em></li>
        <li>Ravager damage increased by 50%.</li>
        <li>Ravager no longer increases Cleave damage while active.</li>
      </ul>
    </li>
  `).cooked);

  assert.deepEqual(changes.map((change) => change.text), [
    'Ravager damage increased by 50%.',
    'Ravager no longer increases Cleave damage while active.',
  ]);
});

test('adds a generic parent subject only when a nested note depends on it', () => {
  const changes = parseClassChanges(post(1, '2026-01-01T00:00:00Z', `
    <li>The Venomous Abyss 4-Set Bonus has been updated –
      <ul>
        <li>Now generates 5 Icicles over 1 second.</li>
        <li>Shatter damage bonus reduced to 10% (was 15%).</li>
      </ul>
    </li>
  `).cooked);

  assert.deepEqual(changes.map(({ subject, text }) => ({ subject, text })), [
    {
      subject: 'The Venomous Abyss 4-Set Bonus · Now generates 5 Icicles over 1 second',
      text: 'The Venomous Abyss 4-Set Bonus has been updated: Now generates 5 Icicles over 1 second.',
    },
    {
      subject: 'Shatter',
      text: 'Shatter damage bonus reduced to 10% (was 15%).',
    },
  ]);
});

test('excludes singular possessive and unpunctuated developer notes', () => {
  const changes = parseClassChanges(post(1, '2026-01-01T00:00:00Z', `
    <li><em>Developer’s notes: Singular context.</em></li>
    <li><em>Developers’ notes Plural context without a colon.</em></li>
    <li>Frozen Orb damage increased by 12%.</li>
  `).cooked);

  assert.deepEqual(changes.map((change) => change.subject), ['Frozen Orb']);
});

test('retains parent context for bare nested change labels', () => {
  const changes = parseClassChanges(post(1, '2026-01-01T00:00:00Z', `
    <li>Fixed an issue where several abilities would not grant Soul Leech:
      <ul>
        <li>Wither</li>
        <li>Blackened Soul</li>
      </ul>
    </li>
  `).cooked);

  assert.deepEqual(changes.map(({ subject, text }) => ({ subject, text })), [
    {
      subject: 'Wither',
      text: 'Fixed an issue where several abilities would not grant Soul Leech: Wither.',
    },
    {
      subject: 'Blackened Soul',
      text: 'Fixed an issue where several abilities would not grant Soul Leech: Blackened Soul.',
    },
  ]);
});

test('uses concise subjects for broad and possessive changes', () => {
  const changes = parseClassChanges(post(1, '2026-01-01T00:00:00Z', `
    <li>All healing increased by 5%.</li>
    <li>All ability damage reduced by 5%.</li>
    <li>Demolish’s cooldown reduced to 30 seconds (was 45 seconds).</li>
    <li>Aimed Shot has a new icon.</li>
  `).cooked);

  assert.deepEqual(changes.map((change) => change.subject), [
    'Overall healing',
    'Overall damage',
    'Demolish',
    'Aimed Shot',
  ]);
});

test('truncates text-based subjects at readable word boundaries', () => {
  const changes = parseClassChanges(post(1, '2026-01-01T00:00:00Z', `
    <li>Fixed an issue causing Full Moons launched by Orbit Breaker to have 100% effectiveness instead of 50%.</li>
    <li>Fixed an issue causing some Cooldown Manager elements such as damage-over-time timers and buff trackers to sometimes not show accurate information.</li>
    <li>Fixed an issue where Dream Guide was incorrectly being consumed by Regrowths cast via Reinvigoration.</li>
  `).cooked);

  assert.deepEqual(changes.map((change) => change.subject), [
    'Fixed an issue causing Full Moons launched by Orbit Breaker to have 100%',
    'Fixed an issue causing some Cooldown Manager elements such as damage-over-time timers…',
    'Fixed an issue where Dream Guide was incorrectly being consumed by Regrowths cast…',
  ]);
});

test('parses class headings that precede separate lists', () => {
  const changes = parseClassChanges(`
    <h2>CLASSES</h2>
    <p><strong>Mage</strong></p>
    <ul>
      <li><strong>Arcane</strong><ul><li>Arcane Blast damage increased by 20%.</li></ul></li>
    </ul>
    <p><strong>Warrior</strong></p>
    <ul>
      <li><strong>Arms</strong><ul><li>Execute damage reduced by 15%.</li></ul></li>
    </ul>
    <h2>ITEMS</h2>
  `);

  assert.deepEqual(changes.map(({ classKey, spec, subject }) => ({ classKey, spec, subject })), [
    { classKey: 'MAGE', spec: 'Arcane', subject: 'Arcane Blast' },
    { classKey: 'WARRIOR', spec: 'Arms', subject: 'Execute' },
  ]);
});

test('recognizes split class headings and keeps non-spec containers as categories', () => {
  const changes = parseClassChanges(`
    <h2>CLASSES</h2>
    <ul>
      <li><strong>DEMON</strong> <strong>HUNTER</strong>
        <ul><li><strong>Havoc</strong><ul><li>Chaos Strike damage increased by 6%.</li></ul></li></ul>
      </li>
      <li><strong>WARRIOR</strong>
        <ul>
          <li><strong>Apex Talents</strong>
            <ul><li><strong>Colossus</strong><ul><li>Dominance of the Colossus has been updated.</li></ul></li></ul>
          </li>
        </ul>
      </li>
    </ul>
  `);

  assert.deepEqual(changes.map(({ classKey, spec, category, subject }) => ({ classKey, spec, category, subject })), [
    { classKey: 'DEMON HUNTER', spec: 'Havoc', category: null, subject: 'Chaos Strike' },
    {
      classKey: 'WARRIOR',
      spec: 'Class-wide',
      category: 'Apex Talents · Colossus',
      subject: 'Dominance of the Colossus',
    },
  ]);
});

test('uses the deepest specialization when source lists are accidentally nested', () => {
  const changes = parseClassChanges(`
    <h2>CLASSES</h2>
    <ul>
      <li><strong>EVOKER</strong>
        <ul><li><strong>Augmentation</strong>
          <ul><li><strong>Preservation</strong>
            <ul><li><strong>Flameshaper</strong>
              <ul><li>Consume Flame healing increased by 50%.</li></ul>
            </li></ul>
          </li></ul>
        </li></ul>
      </li>
    </ul>
  `);

  assert.deepEqual(changes.map(({ spec, category }) => ({ spec, category })), [
    { spec: 'Preservation', category: 'Flameshaper' },
  ]);
});

test('preserves units for current values paired with live values', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', `
      <li>Blood Beast auto-attack damage increased by 1400%.</li>
      <li>Blood-Soaked Ground now reduces physical damage taken by 8% (was 5%).</li>
      <li>Apex Talent (Rank 2) reduces damage taken by 6% (was 4%).</li>
      <li>Example power increased to 20% (was 10%) and lasts 8 seconds (was 6 seconds).</li>
      <li>Commander now grants 10%/20% damage for 30 seconds (was 15%/30%).</li>
      <li>Inertia now increases damage by 12% for 6 seconds (was 18% for 5 seconds).</li>
    `),
  ]);
  const values = Object.fromEntries(patch.classes[0].changes.map((change) => [change.subject, change.value]));

  assert.equal(values['Blood Beast auto-attack'], '+1400%');
  assert.equal(values['Blood-Soaked Ground'], '8%');
  assert.equal(values['Apex Talent (Rank 2)'], '6%');
  assert.equal(patch.classes[0].changes.find((change) => change.text.startsWith('Example power')).value, '20% · 8 seconds');
  assert.equal(patch.classes[0].changes.find((change) => change.text.startsWith('Commander')).value, '10%/20%');
  assert.equal(patch.classes[0].changes.find((change) => change.text.startsWith('Inertia')).value, '12% · 6 seconds');
});

test('classifies bugfix notes separately from tuning direction', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', `
      <li>Fixed an issue causing Improved Voidform to generate Insanity when casting Voidform.</li>
      <li>The Example bonus – Fixed an issue that caused Fireball to have 100% critical strike chance instead of 50%.</li>
      <li>Resolved an issue causing Nazgrim’s Conquest to grant additional Strength.</li>
      <li>Crusader’s Resolved moved to row 8.</li>
    `),
  ]);
  const directionFor = (start) => patch.classes[0].changes.find((change) => change.text.startsWith(start)).direction;
  const valueFor = (start) => patch.classes[0].changes.find((change) => change.text.startsWith(start)).value;

  assert.equal(directionFor('Fixed an issue'), 'fixed');
  assert.equal(directionFor('The Example bonus'), 'fixed');
  assert.equal(directionFor('Resolved an issue'), 'fixed');
  assert.equal(directionFor('Crusader’s Resolved'), 'changed');
  assert.equal(valueFor('Fixed an issue'), 'Fixed');
  assert.equal(valueFor('The Example bonus'), 'Fixed');
});

test('records explicit PvP exclusions without inferring unspecified scope', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', `
      <li>Frostbolt damage increased by 10%. This does not apply to PvP combat.</li>
      <li>Ice Barrier duration increased to 12 seconds (was 10 seconds). Duration remains unchanged in PvP combat.</li>
      <li>Blizzard damage increased by 5%.</li>
    `),
  ]);
  const impactFor = (start) => patch.classes[0].changes.find((change) => change.text.startsWith(start)).pvpImpact;
  assert.equal(impactFor('Frostbolt'), 'excluded');
  assert.equal(impactFor('Ice Barrier'), 'unchanged');
  assert.equal(impactFor('Blizzard'), null);
});


test('updates PvP scope when a later revision changes the qualifier', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', '<li>Frostbolt damage increased by 10%. This does not apply to PvP combat.</li>'),
    post(2, '2026-01-08T00:00:00Z', '<li>Frostbolt damage increased by 12%.</li>'),
  ]);
  const change = patch.classes[0].changes[0];
  assert.deepEqual(change.history.map((item) => item.pvpImpact), ['excluded', null]);
  assert.equal(change.pvpImpact, null);
});
test('infers buffs and nerfs from live-to-PTR value movement', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', `
      <li>Pact of the San’layn now stores 15% of all Shadow damage dealt (was 10%).</li>
      <li>Blood-Soaked Ground now reduces physical damage taken by 8% (was 5%).</li>
      <li>Blood is Life now accumulates 15% of damage dealt (was 25%).</li>
      <li>Wingleader now reduces the cooldown by 1.5 seconds (was 1 second).</li>
      <li>Focused Aim now reduces the cooldown by 1 second (was 2 seconds).</li>
      <li>Inertia now increases damage by 12% for 6 seconds (was 18% for 5 seconds).</li>
      <li>Diminishing return categories reset after 20 seconds (was 16 seconds).</li>
      <li>Arcane Blast mana cost increased to 15% (was 10%).</li>
      <li>Arcane Barrage mana cost reduced to 10% (was 15%).</li>
      <li>Final Hour causes its bonus to persist for 6 seconds (was 8 seconds).</li>
      <li>Demon Blades now generates 10-16 Fury per attack (was 8-15).</li>
      <li>Hammer of Light now costs 3 Holy Power (was 5).</li>
      <li>Perseverance now reduces damage taken by 4%. Duration increased to 10 seconds (was 6 seconds).</li>
      <li>Fast Action reduces the cooldown by 8 seconds (was 5 seconds) and increases damage by 1%.</li>
      <li>Chain Lightning now hits up to 5 targets (was 3).</li>
      <li>Bonus Lava Bursts are now 50% of their normal value (was 100%).</li>
      <li>Chain Heal now bounces to 5 targets (was 3), loses 10% healing per jump (was 30%), and has a 20 yard range (was 15 yards).</li>
      <li>The Rend ability’s Rage cost is reduced to 10.</li>
      <li>Ravager’s duration is no longer reduced by Haste.</li>
      <li>Stormkeeper no longer causes Lightning Bolt to generate an additional Elemental Overload.</li>
      <li>Players can now only see up to 3 Lesser Ghouls.</li>
    `),
  ]);
  const directionFor = (start) => patch.classes[0].changes.find((change) => change.text.startsWith(start)).direction;

  assert.equal(directionFor('Pact of the San’layn'), 'buff');
  assert.equal(directionFor('Blood-Soaked Ground'), 'buff');
  assert.equal(directionFor('Blood is Life'), 'nerf');
  assert.equal(directionFor('Wingleader'), 'buff');
  assert.equal(directionFor('Focused Aim'), 'nerf');
  assert.equal(directionFor('Inertia'), 'changed');
  assert.equal(directionFor('Diminishing return'), 'changed');
  assert.equal(directionFor('Arcane Blast'), 'nerf');
  assert.equal(directionFor('Arcane Barrage'), 'buff');
  assert.equal(directionFor('Final Hour'), 'nerf');
  assert.equal(directionFor('Demon Blades'), 'buff');
  assert.equal(directionFor('Hammer of Light'), 'buff');
  assert.equal(directionFor('Perseverance'), 'buff');
  assert.equal(directionFor('Fast Action'), 'buff');
  assert.equal(directionFor('Chain Lightning'), 'buff');
  assert.equal(directionFor('Bonus Lava Bursts'), 'nerf');
  assert.equal(directionFor('Chain Heal'), 'buff');
  assert.equal(directionFor('The Rend ability'), 'buff');
  assert.equal(directionFor('Ravager'), 'buff');
  assert.equal(directionFor('Stormkeeper'), 'nerf');
  assert.equal(directionFor('Players'), 'changed');
  assert.equal(patch.classes[0].changes.find((change) => change.text.startsWith('Demon Blades')).value, '10-16 Fury');
  assert.equal(patch.classes[0].changes.find((change) => change.text.startsWith('The Rend ability')).value, '10 Rage');
});

test('folds an overall tuning correction into its original change', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', '<li>All damage reduced by 8%.</li>'),
    post(2, '2026-01-02T00:00:00Z', '<li>The overall damage reduction from our latest tuning pass has been adjusted from 8% to 3%.</li>'),
  ]);
  const change = patch.classes[0].changes[0];

  assert.equal(patch.classes[0].changes.length, 1);
  assert.equal(change.subject, 'Overall damage');
  assert.equal(change.value, '−3%');
  assert.equal(change.baseline, null);
  assert.equal(change.direction, 'buff');
  assert.deepEqual(change.history.map((item) => item.value), ['−8%', '−3%']);
});

test('folds later tuning into the current value while retaining history', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', '<li>Frozen Orb damage increased by 12% (was 8%).</li>'),
    post(2, '2026-01-08T00:00:00Z', '<li>Frozen Orb damage increased by 10% (was 8%).</li>'),
  ]);
  const change = patch.classes[0].changes[0];

  assert.equal(change.value, '10%');
  assert.equal(change.baseline, '8%');
  assert.equal(change.history.length, 2);
  assert.deepEqual(change.history.map((item) => item.value), ['12%', '10%']);
  assert.deepEqual(change.history.map((item) => item.baseline), ['8%', '8%']);
  assert.deepEqual(change.history.map((item) => item.direction), ['buff', 'buff']);
  assert.equal(patch.stats.revised, 1);
});

test('retains talent classification when a later revision omits the talent label', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', '<li>New Talent: Frozen Orb – Damage increased by 12% (was 8%).</li>'),
    post(2, '2026-01-08T00:00:00Z', '<li>Frozen Orb damage increased by 10% (was 8%).</li>'),
  ]);
  const change = patch.classes[0].changes[0];

  assert.equal(change.isTalent, true);
  assert.equal(change.history.length, 2);
});

test('compounds sequential relative tuning while preserving each announced adjustment', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', '<li>All ability damage increased by 20%.</li>'),
    post(2, '2026-01-08T00:00:00Z', '<li>All ability damage increased by 10%.</li>'),
  ]);
  const change = patch.classes[0].changes[0];

  assert.equal(change.value, '+32%');
  assert.equal(change.latestAdjustment, '+10%');
  assert.equal(change.cumulative, true);
  assert.equal(change.direction, 'buff');
  assert.deepEqual(change.history.map((item) => item.value), ['+20%', '+10%']);
  assert.deepEqual(change.history.map((item) => item.effectiveValue), ['+20%', '+32%']);
  assert.equal(change.history[1].source, 'https://eu.forums.blizzard.com/en/wow/t/example-patch/123/2');
});

test('keeps final article checkpoints independent from PTR cumulative history', () => {
  const patch = buildPatch(finalSource, [{
    post_number: 'final',
    created_at: '2026-08-06T17:11:00Z',
    updated_at: '2026-08-06T17:19:26Z',
    cooked: `<h2><strong>CLASSES</strong></h2>
      <ul><li><details><summary><strong><span>▶</span> DEMON HUNTER</strong></summary>
        <ul><li><strong>Devourer</strong>
          <ul><li>All ability damage increased by 32%.</li></ul>
        </li></ul>
      </details></li></ul>`,
  }]);
  const change = patch.classes.find((classInfo) => classInfo.id === 'demon-hunter').changes[0];

  assert.equal(change.spec, 'Devourer');
  assert.equal(change.subject, 'Overall damage');
  assert.equal(change.value, '+32%');
  assert.equal(change.history.length, 1);
  assert.equal(change.cumulative, undefined);
  assert.equal(change.latestAdjustment, undefined);
  assert.equal(change.history[0].effectiveValue, undefined);
  assert.equal(patch.rounds[0].label, 'Final notes');
  assert.equal(patch.rounds[0].source, finalSource.url);
});

test('compounds mixed buffs and nerfs from the live baseline', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', '<li>All ability damage increased by 20%.</li>'),
    post(2, '2026-01-08T00:00:00Z', '<li>All ability damage reduced by 10%.</li>'),
  ]);
  const change = patch.classes[0].changes[0];

  assert.equal(change.value, '+8%');
  assert.equal(change.latestAdjustment, '−10%');
  assert.equal(change.direction, 'buff');
  assert.deepEqual(change.history.map((item) => item.effectiveDirection), ['buff', 'buff']);
});

test('clears an obsolete numeric baseline after a qualitative replacement', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', '<li>Frozen Orb damage increased to 12% (was 8%).</li>'),
    post(2, '2026-01-08T00:00:00Z', '<li>Frozen Orb no longer deals splash damage.</li>'),
  ]);
  const change = patch.classes[0].changes[0];

  assert.equal(change.value, 'Nerfed');
  assert.equal(change.baseline, null);
  assert.equal(change.history.at(-1).baseline, null);
  assert.equal(change.history.at(-1).direction, 'nerf');
});

test('does not display structural rank, row, or set identifiers as values', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', `
      <li>Bonus rage moved from rank 1 to rank 3.</li>
      <li>Rank 1: Spending Rage has a chance to awaken a Guardian Spirit for 8 seconds.</li>
      <li>The Venomous Abyss 2-set Bonus – Strength increased by 0.5%, up to 5%.</li>
      <li>The Midnight Season 1 2-set bonus no longer extends Ebon Might.</li>
      <li>Precision Detonation lasts for 1 additional second.</li>
    `),
  ]);
  const valueFor = (start) => patch.classes[0].changes.find((change) => change.text.startsWith(start)).value;

  assert.equal(valueFor('Bonus rage'), 'Changed');
  assert.equal(valueFor('Rank 1'), '8 seconds');
  assert.equal(valueFor('The Venomous Abyss'), '+0.5%');
  assert.equal(valueFor('The Midnight Season'), 'Nerfed');
  assert.equal(valueFor('Precision Detonation'), '1 additional second');
});

test('retains an official checkpoint when its text repeats in a later round', () => {
  const patch = buildPatch(source, [
    post(1, '2026-01-01T00:00:00Z', '<li>Frozen Orb damage increased by 12% (was 8%).</li>'),
    post(2, '2026-01-08T00:00:00Z', '<li>Frozen Orb damage increased by 12% (was 8%).</li>'),
  ]);
  const change = patch.classes[0].changes[0];

  assert.deepEqual(change.history.map((item) => item.round), [1, 2]);
  assert.equal(patch.stats.revised, 1);
});
