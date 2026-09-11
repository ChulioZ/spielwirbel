'use strict';

/* The two PURE halves of the owner picker (#971) — what the picker starts out
 * selecting, and how a game's owners are named.
 *
 * The chip renderer in the same module is DOM code and is exercised through the
 * jsdom harness instead (test/game-owners-views.test.js), so it shows up
 * uncovered here; requiring this file costs ~0.1 points of the global figure,
 * measured, which is well clear of the 90% floor
 * (.claude/rules/frontend-helper-modules-and-coverage.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ownerPresetFor, ownerNames } = require('../public/js/owner-picker');

const ANNA = { id: 'm1', name: 'Anna', userId: 'u-anna' };
const BEN = { id: 'm2', name: 'Ben' };
const round = (members) => ({ members });

test('with no stored preset the picker starts on the caller\'s own seat', () => {
  assert.deepEqual(ownerPresetFor(round([ANNA, BEN]), 'u-anna'), ['m1']);
});

test('a stored preset wins over the own seat, and an EMPTY one is honoured', () => {
  const withPreset = round([{ ...ANNA, ownerPreset: ['m2'] }, BEN]);
  assert.deepEqual(ownerPresetFor(withPreset, 'u-anna'), ['m2']);

  // The whole reason the guard is `Array.isArray` and not truthiness: "I took
  // myself off the list" has to survive to the next add.
  const emptied = round([{ ...ANNA, ownerPreset: [] }, BEN]);
  assert.deepEqual(ownerPresetFor(emptied, 'u-anna'), []);
});

test('a preset naming a seat that is gone does not resurrect it', () => {
  const stale = round([{ ...ANNA, ownerPreset: ['m1', 'ghost'] }]);
  assert.deepEqual(ownerPresetFor(stale, 'u-anna'), ['m1']);
});

test('a caller with no seat gets no preselection at all', () => {
  assert.deepEqual(ownerPresetFor(round([ANNA, BEN]), 'u-stranger'), [],
    'a grantee has no seat, so there is nobody to guess at');
  assert.deepEqual(ownerPresetFor(round([ANNA, BEN]), null), [], 'accounts off');
  assert.deepEqual(ownerPresetFor(undefined, 'u-anna'), [], 'no round is not a crash');
});

// Named in the ROUND's member order, so two screens can never list one game's
// owners differently.
test('ownerNames follows member order and drops an id nobody holds', () => {
  assert.deepEqual(ownerNames(round([ANNA, BEN]), ['m2', 'm1']), ['Anna', 'Ben']);
  assert.deepEqual(ownerNames(round([ANNA, BEN]), ['m2', 'ghost']), ['Ben']);
  assert.deepEqual(ownerNames(round([ANNA]), undefined), []);
  assert.deepEqual(ownerNames(null, ['m1']), []);
});

/* boxBringers — who has to BRING the box (#971, generalised by #1008). The rule
 * was inline in renderFinish() and therefore reachable only from the chosen
 * row; it is pure and shared now because the ranking prints it too, and two
 * screens must never list one game's owners differently
 * (.claude/rules/shared-constants-across-the-stack.md). */

const { boxBringers } = require('../public/js/owner-picker');
const { shelfParty } = require('../public/js/draw-pool');
const CLARA = { id: 'm3', name: 'Clara' };
const table = (members, memberIds) => [{ members }, { memberIds }];
// `shelfParty` is injected with no default (#1002) — see the comment on
// `bringing` in owner-picker.js. Every call below goes through the real one, so
// the label and the draw's own pool cannot part company.
const bringers = (r, s, g) => boxBringers(r, s, g, shelfParty);

test('boxBringers is silent when there is nothing to say', () => {
  const [r, s] = table([ANNA, BEN], ['m1', 'm2']);
  assert.deepEqual(bringers(r, s, { title: 'Catan' }), [], 'no owners recorded');
  assert.deepEqual(bringers(r, s, { ownerIds: [] }), [], 'an empty list is not news either');
  assert.deepEqual(bringers(r, s, { ownerIds: ['m1', 'm2'] }), [],
    'everyone at the table owns it, so nobody has to be told to bring it');
});

test('boxBringers names the owners who are actually at the table', () => {
  const [r, s] = table([ANNA, BEN, CLARA], ['m1', 'm2']);
  assert.deepEqual(bringers(r, s, { ownerIds: ['m1', 'm3'] }), ['Anna'],
    'Clara owns it too but stayed home, so naming her helps nobody');
});

test('boxBringers falls back to every owner when none of them is seated', () => {
  // A direct pick is not filtered by ownership, so it can legitimately land on
  // a game nobody present owns — exactly when the line matters most.
  const [r, s] = table([ANNA, BEN, CLARA], ['m1', 'm2']);
  assert.deepEqual(bringers(r, s, { ownerIds: ['m3'] }), ['Clara']);
});

/* Present WITHOUT your shelf (#1002): the seat is at the table, the box is not.
 * Every case below has the game IN the session, so it is the results screen
 * talking, not the draw — a solely-owned game only gets there by direct pick,
 * while the co-owned one is exactly what the draw legitimately produces. */

test('boxBringers skips an owner who came without their shelf', () => {
  const [r, s] = table([ANNA, BEN, CLARA], ['m1', 'm2', 'm3']);
  s.withoutShelfIds = ['m1'];
  // The bug this closes: Anna owns it, is at the table, and said she did not
  // bring it — so telling the group to get it from her sends them to nobody.
  assert.deepEqual(bringers(r, s, { ownerIds: ['m1', 'm2'] }), ['Ben'],
    'name the co-owner who can actually put it down');
});

test('boxBringers falls back to every owner when nobody present can produce it', () => {
  const [r, s] = table([ANNA, BEN, CLARA], ['m1', 'm2', 'm3']);
  s.withoutShelfIds = ['m1'];
  assert.deepEqual(bringers(r, s, { ownerIds: ['m1'] }), ['Anna'],
    'the same fallback an unseated owner gets: say who has it, so it can be asked for');
});

test('boxBringers is unchanged for a session that records no marks', () => {
  const [r, s] = table([ANNA, BEN, CLARA], ['m1', 'm2']);
  assert.deepEqual(bringers(r, s, { ownerIds: ['m1', 'm3'] }), ['Anna']);
  s.withoutShelfIds = [];
  assert.deepEqual(bringers(r, s, { ownerIds: ['m1', 'm3'] }), ['Anna'],
    'an empty list means the same as an absent key, like every other session list');
});

/* The reduction is SHARED, not restated. A hand-written `seated && !away`
   filter here would be the same subtraction spelled a second time, which is
   what lets the label name somebody the draw had already counted as empty-
   handed. The arity is asserted for the reason test/vote-score.test.js asserts
   `shelfScore.length`: an equality between two sessions is satisfied by a
   re-implementation, where a missing parameter is not. */
test('boxBringers takes the reducer, and has no default to fall back on', () => {
  assert.equal(boxBringers.length, 4, 'the reducer is a parameter, not a global reach');
  const [r, s] = table([ANNA, BEN, CLARA], ['m1', 'm2']);
  s.withoutShelfIds = ['m1'];
  assert.throws(() => boxBringers(r, s, { ownerIds: ['m1', 'm2'] }), TypeError,
    'omitting it must fail loudly, never hand back a differently-reduced list');
});

test('boxBringers names only people the draw would have counted as bringing a shelf', () => {
  const [r, s] = table([ANNA, BEN, CLARA], ['m1', 'm2', 'm3']);
  s.withoutShelfIds = ['m1'];
  const party = shelfParty(s.memberIds, s.withoutShelfIds);
  // Clara is seated and owns nothing, which is what keeps this out of the quiet
  // branch — with every seat an owner the line is not printed at all.
  const named = bringers(r, s, { ownerIds: ['m1', 'm2'] });
  // Every name the label prints belongs to somebody the draw's own reduction
  // kept — so the two can never send the group to different people.
  const byName = new Map(r.members.map((m) => [m.name, m.id]));
  named.forEach((n) => assert.ok(party.includes(byName.get(n)), n + ' must be in the shelf party'));
  assert.deepEqual(named, ['Ben']);
});

test('boxBringers survives a session with no seats at all', () => {
  /* The route guarantees at least one seat, so this is unreachable today — but
     `[].every(...)` is vacuously TRUE, which would read as "everyone owns it"
     and suppress the line. Suppressing is the safe direction here; the point of
     the case is that the answer is deliberate rather than accidental. */
  const [r, s] = table([ANNA, BEN], []);
  assert.deepEqual(bringers(r, s, { ownerIds: ['m1'] }), []);
  assert.deepEqual(bringers(r, {}, { ownerIds: ['m1'] }), [], 'and a session with no memberIds key');
});
