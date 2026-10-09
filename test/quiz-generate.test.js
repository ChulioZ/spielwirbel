'use strict';

/*
 * The weekly quiz's generator (#743), as a pure function over corpus rows.
 *
 * The guarantees that make a question fair live here, and each one is asserted
 * over EVERY question of many generated rounds rather than over one sample: a
 * "no distractor equals the answer" check over a single question passes against
 * a generator that only sometimes emits a duplicate (.claude/rules/break-the-code-on-purpose.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildRound, TYPES, weightBand, playtimeBand } = require('../lib/quiz-generate');

const CATS = ['Abstract Strategy', 'Animals', 'Card Game', 'Economic', 'Fantasy', 'Medieval', 'Science Fiction', 'Territory Building'];
const MECHS = ['Dice Rolling', 'Hand Management', 'Set Collection', 'Tile Placement', 'Worker Placement', 'Drafting', 'Area Majority'];
const DESIGNERS = ['Uwe Rosenberg', 'Reiner Knizia', 'Vital Lacerda', 'Elizabeth Hargrave', 'Stefan Feld', 'Martin Wallace'];

// A deterministic synthetic corpus: attributes vary with the index so every
// question type has eligible rows, and some rows lack attributes on purpose.
function corpus(n = 80, over = () => ({})) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({
      externalId: String(1000 + i),
      name: `Game ${i}`,
      rank: i + 1,
      year: 1995 + (i % 30),
      info: {
        imageUrl: `https://cf.geekdo-images.com/x/pic${i}.jpg`,
        weight: 1.2 + ((i * 0.37) % 3.6),
        numWeights: 500,
        minPlayers: 1 + (i % 3),
        maxPlayers: 2 + (i % 3) + (i % 4),
        minPlaytime: 20,
        maxPlaytime: [25, 40, 60, 75, 100, 150, 240][i % 7],
        categories: [CATS[i % CATS.length], CATS[(i + 3) % CATS.length]],
        mechanics: [MECHS[i % MECHS.length]],
        designers: i % 9 === 0 ? ['(Uncredited)'] : [DESIGNERS[i % DESIGNERS.length]],
      },
      ...over(i),
    });
  }
  return rows;
}

const WEEKS = Array.from({ length: 40 }, (_, i) => `2026-W${String(i + 1).padStart(2, '0')}`);
const byId = (rows) => new Map(rows.map((r) => [r.externalId, r]));

function allQuestions(rows, opts = {}) {
  const out = [];
  for (const week of WEEKS) {
    const round = buildRound(rows, { week, currentYear: 2026, ...opts });
    if (round) out.push(...round.questions, ...(round.sample ? [round.sample] : []));
  }
  return out;
}

// What makes a choice the CORRECT one, per type, read straight off the row —
// never off the generator's own bookkeeping.
function isTrue(q, choice, rows) {
  const g = q.subject && rows.get(q.subject.externalId);
  switch (q.type) {
    case 'weight': return g.info.weight >= choice.min && (choice.max === 5 ? g.info.weight <= 5 : g.info.weight < choice.max);
    case 'playtime': return (choice.min == null || g.info.maxPlaytime >= choice.min) && (choice.max == null || g.info.maxPlaytime <= choice.max);
    case 'players': return choice.min === g.info.minPlayers && choice.max === g.info.maxPlayers;
    case 'year': return choice === g.year;
    case 'category': return g.info.categories.includes(choice);
    case 'mechanic': return g.info.mechanics.includes(choice);
    case 'designer': return g.info.designers.includes(choice);
    case 'duel': {
      const ranks = q.choices.map((c) => rows.get(c.externalId).rank);
      return rows.get(choice.externalId).rank === Math.min(...ranks);
    }
    default: throw new Error(`unknown type ${q.type}`);
  }
}

test('every type is generated, and in every question exactly ONE choice is true', () => {
  const rows = corpus();
  const index = byId(rows);
  const qs = allQuestions(rows);
  const seen = new Set(qs.map((q) => q.type));
  assert.deepEqual([...seen].sort(), [...TYPES].sort(), 'some question type never came up over 40 weeks');
  for (const q of qs) {
    assert.equal(q.choices.length, 4, `${q.type}: four choices`);
    if (q.type === 'year') assert.ok(q.choices.every((y) => y <= 2026), `a year choice lies in the future: ${q.choices}`);
    const truths = q.choices.map((c) => isTrue(q, c, index));
    assert.equal(truths.filter(Boolean).length, 1, `${q.type} about ${q.subject && q.subject.name}: ${JSON.stringify(q.choices)} has ${truths.filter(Boolean).length} true choices`);
    assert.equal(truths.indexOf(true), q.answer, `${q.type}: the stored answer is the true choice`);
    assert.equal(new Set(q.choices.map((c) => JSON.stringify(c))).size, 4, `${q.type}: four DISTINCT choices`);
  }
});

test('BGG\'s „(Uncredited)" is never a designer choice, and an uncredited game gets no designer question', () => {
  const rows = corpus();
  for (const q of allQuestions(rows).filter((x) => x.type === 'designer')) {
    assert.ok(!q.choices.includes('(Uncredited)'), JSON.stringify(q.choices));
    assert.notEqual(Number(q.subject.externalId) % 9, 1000 % 9, 'an uncredited game was asked about');
  }
});

test('the ranking duel\'s four ranks are clearly apart', () => {
  const rows = corpus(200);
  const index = byId(rows);
  const duels = allQuestions(rows).filter((q) => q.type === 'duel');
  assert.ok(duels.length > 0);
  for (const q of duels) {
    const ranks = q.choices.map((c) => index.get(c.externalId).rank).sort((a, b) => a - b);
    for (let i = 1; i < ranks.length; i += 1) assert.ok(ranks[i] - ranks[i - 1] >= 10, `ranks ${ranks} are too close`);
  }
});

test('a round holds no game twice, no type twice, and no subject from the cooldown set', () => {
  const rows = corpus();
  for (const week of WEEKS) {
    const recent = new Set(['1000', '1001', '1002', '1003', '1004']);
    const round = buildRound(rows, { week, currentYear: 2026, recentSubjects: recent });
    const games = round.questions.flatMap((q) => (q.type === 'duel' ? q.choices.map((c) => c.externalId) : [q.subject.externalId]));
    assert.equal(new Set(games).size, games.length, `${week}: a game appears twice`);
    assert.equal(new Set(round.questions.map((q) => q.type)).size, round.questions.length, `${week}: a type appears twice`);
    for (const q of round.questions) {
      if (q.subject) assert.ok(!recent.has(q.subject.externalId), `${week}: ${q.subject.externalId} is in the cooldown`);
    }
    assert.equal(round.questions.length, 5);
  }
});

test('the sample question is none of the scored ones and shares no game with them', () => {
  // A SMALL corpus on purpose: the round takes most of it, so a sample drawn
  // without excluding the round's games collides almost every week — over a
  // large one it would miss by luck (measured: green with the exclusion removed).
  const rows = corpus(14);
  for (const week of WEEKS) {
    const round = buildRound(rows, { week, currentYear: 2026 });
    assert.ok(round.sample, `${week}: no sample`);
    const gamesOf = (q) => (q.type === 'duel' ? q.choices.map((c) => c.externalId) : [q.subject.externalId]);
    const scored = new Set(round.questions.flatMap(gamesOf));
    for (const id of gamesOf(round.sample)) assert.ok(!scored.has(id), `${week}: the sample reuses ${id}`);
  }
});

test('the same week over the same corpus yields the same round; another week does not', () => {
  const rows = corpus();
  const a = buildRound(rows, { week: '2026-W41', currentYear: 2026 });
  const b = buildRound(rows, { week: '2026-W41', currentYear: 2026 });
  const c = buildRound(rows, { week: '2026-W42', currentYear: 2026 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.questions, c.questions);
});

test('a type with too few eligible rows is skipped, never emitted half-built', () => {
  // No mechanics, no credited designers and no weights anywhere: those three
  // types must vanish, the rest must still be whole.
  const rows = corpus(80, (i) => ({ info: { ...corpus(80)[i].info, mechanics: [], designers: ['(Uncredited)'], weight: null } }));
  const qs = allQuestions(rows);
  const types = new Set(qs.map((q) => q.type));
  for (const gone of ['mechanic', 'designer', 'weight']) assert.ok(!types.has(gone), `${gone} was generated without data`);
  for (const q of qs) assert.equal(q.choices.length, 4);
});

test('an empty or unenriched corpus makes no round at all', () => {
  assert.equal(buildRound([], { week: '2026-W41', currentYear: 2026 }), null);
  const bare = corpus(80, () => ({ info: null, year: null }));
  assert.equal(buildRound(bare, { week: '2026-W41', currentYear: 2026 }), null);
});

test('the pool is the best-ranked rows only', () => {
  const rows = corpus(300);
  const round = buildRound(rows, { week: '2026-W41', currentYear: 2026, poolSize: 60 });
  for (const q of [...round.questions, round.sample]) {
    const ids = q.type === 'duel' ? q.choices.map((c) => c.externalId) : [q.subject.externalId];
    for (const id of ids) assert.ok(Number(id) - 1000 < 60, `${id} is outside the pool of 60`);
  }
});

test('the bands: weight on whole ladder steps, playtime on the playtime ladder', () => {
  assert.deepEqual(weightBand(2.4), { min: 2, max: 3 });
  assert.deepEqual(weightBand(5), { min: 4, max: 5 });
  assert.equal(weightBand(2.02), null, 'too close to a band edge to be a fair question');
  assert.equal(weightBand(null), null);
  assert.deepEqual(playtimeBand(30), { min: null, max: 30 });
  assert.deepEqual(playtimeBand(31), { min: 31, max: 45 });
  assert.deepEqual(playtimeBand(240), { min: 181, max: null });
});
