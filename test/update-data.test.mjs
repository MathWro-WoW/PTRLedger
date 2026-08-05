import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPatch, parseClassChanges } from '../scripts/update-data.mjs';

const source = {
  id: '12.2',
  name: 'Example patch',
  topicId: 123,
  region: 'eu',
  status: 'PTR',
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
    category: null,
    subject: 'Frozen Orb',
    text: 'Frozen Orb damage increased by 12% (was 8%).',
  });
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
  assert.equal(patch.classes[0].changes.find((change) => change.text.startsWith('Demon Blades')).value, '10-16 Fury');
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
  assert.equal(patch.stats.revised, 1);
});
