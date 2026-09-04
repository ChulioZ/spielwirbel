'use strict';

/* The Siegwertung (#895): what one member's wins are worth once the size of the
 * field they beat is taken into account.
 *
 * Ranking the Ruhmeshalle by raw win count measured attendance, not play — and
 * a solo evening is representable, so a member logging their solo plays won
 * essentially all of them and accumulated a total nobody playing in a group
 * could contest. The worked rows below are the issue's acceptance evidence and
 * are pinned individually: what must not move silently is the SHAPE — field
 * weighted, summed, solo-neutral — and only per-member rows can distinguish a
 * retune of that from a break in it.
 *
 * `partyGroupsOf` is INJECTED rather than required: `session-people.js` is a
 * shared-scope sibling, and a party is the unit here (.claude/rules/session-teams.md
 * — do not re-derive the party arithmetic).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sessionWinScores, memberWinScores } = require('../public/js/win-score');
const { sessionPartyGroups } = require('../public/js/session-people');

// ---- Fixture builders -------------------------------------------------------

let seq = 0;
const night = (memberIds, winnerIds, extra = {}) => ({
  id: `s${++seq}`,
  createdAt: `2026-01-01T20:00:00.000Z`,
  memberIds,
  guests: [],
  votes: {},
  finished: true,
  winnerIds,
  ...extra,
});

const roundOf = (memberIds, sessions) => ({
  id: 'r1',
  members: memberIds.map((id) => ({ id, name: id })),
  games: [],
  sessions,
});

// Four members plus three fillers, so a "four-party night" can name one of the
// four without dragging the other three in. Each block below is disjoint, which
// is what lets each member's row be reasoned about on its own.
function podiumFixture() {
  const sessions = [];
  const F = ['f1', 'f2', 'f3'];
  const block = (mid, n, wins) => {
    for (let i = 0; i < n; i++) sessions.push(night([mid, ...F], [i < wins ? mid : 'f1']));
  };
  for (let i = 0; i < 20; i++) sessions.push(night(['dan'], ['dan'])); // solo nights
  block('dan', 6, 2);
  block('anna', 40, 12);
  block('clara', 40, 10);
  block('ben', 8, 5);
  return roundOf(['dan', 'anna', 'clara', 'ben', ...F], sessions);
}

const scoresOf = (round) => memberWinScores(round, sessionPartyGroups);
const r1 = (x) => Number(x.toFixed(1));

// ---- The worked rows --------------------------------------------------------

test('the four worked rows, and the order they produce', () => {
  const s = scoresOf(podiumFixture());

  // Dan: 20 solo nights contribute exactly nothing; 2 wins and 4 losses at
  // four parties. 2·(3/4) − 4·(1/4) = +0,5, against a raw count of 22.
  assert.equal(r1(s.dan), 0.5);
  // Anna: 12 of 40 at four parties. 12·(3/4) − 28·(1/4) = +2,0.
  assert.equal(r1(s.anna), 2.0);
  // Clara: 10 of 40 — exactly the rate chance predicts, so 0,0 and off the podium.
  assert.equal(r1(s.clara), 0.0);
  // Ben: 5 of 8. 5·(3/4) − 3·(1/4) = +3,0, on a raw count of 5.
  assert.equal(r1(s.ben), 3.0);

  const order = ['dan', 'anna', 'clara', 'ben'].sort((a, b) => s[b] - s[a]);
  assert.deepEqual(order, ['ben', 'anna', 'dan', 'clara']);
});

test('a solo night is worth exactly zero, with no special case reaching for it', () => {
  const round = roundOf(['a'], [night(['a'], ['a'])]);
  assert.equal(scoresOf(round).a, 0);
  // 1 − w/p with p = w = 1. Asserted on the CODE too, because a branch is
  // exactly what would drift later (#895 §The measure). Comments are stripped
  // first and that is load-bearing, not tidiness: the file's own header explains
  // the solo case at length, so a raw-text scan would match its own
  // documentation and could only be made green by weakening the pattern
  // (.claude/rules/source-scanning-guards-enumerate-shapes.md).
  const raw = require('node:fs').readFileSync(require.resolve('../public/js/win-score'), 'utf8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/partyGroupsOf/.test(code), 'comment strip ate the code — the scan below would be vacuous');
  assert.ok(!/\bsolo\b/i.test(code), 'win-score.js must contain no solo special case');
});

// ---- Zero-sum over parties --------------------------------------------------

test('the per-session scores sum to zero over PARTIES, for any p and w', () => {
  const cases = [
    { people: ['a', 'b'], winners: ['a'] }, // p=2, w=1
    { people: ['a', 'b', 'c', 'd'], winners: ['a'] }, // p=4, w=1
    { people: ['a', 'b', 'c', 'd', 'e'], winners: ['a'] }, // p=5, w=1
    { people: ['a', 'b', 'c', 'd'], winners: ['a', 'b'] }, // p=4, w=2
  ];
  for (const c of cases) {
    const session = night(c.people, c.winners);
    const round = roundOf(c.people, [session]);
    const scores = sessionWinScores(round, session, sessionPartyGroups);
    // One representative per party — a team shares its members' value, so
    // summing over PEOPLE would not be zero and is not the claim.
    const parties = sessionPartyGroups(round, session);
    const total = parties.reduce((n, p) => n + scores.get(p.personIds[0]), 0);
    assert.ok(Math.abs(total) < 1e-12, `p=${parties.length} w=${c.winners.length} summed to ${total}`);
  }
});

test('a session with no recorded winner changes nobody', () => {
  const people = ['a', 'b', 'c'];
  const session = night(people, []);
  const round = roundOf(people, [session]);
  assert.equal(sessionWinScores(round, session, sessionPartyGroups).size, 0);
  // ...and it does not drag anyone down across the round either.
  const withWin = roundOf(people, [session, night(people, ['a'])]);
  const s = scoresOf(withWin);
  assert.equal(r1(s.a), r1(1 - 1 / 3));
  assert.equal(r1(s.b), r1(-1 / 3));
});

test('a team win credits each team member once, with the party value', () => {
  // Four people, two of them a team -> p = 3. The team wins -> w = 1.
  const session = night(['a', 'b', 'c', 'd'], ['a'], {
    teams: [{ id: 't1', personIds: ['a', 'b'] }],
  });
  const round = roundOf(['a', 'b', 'c', 'd'], [session]);
  const scores = sessionWinScores(round, session, sessionPartyGroups);
  assert.equal(sessionPartyGroups(round, session).length, 3);
  assert.equal(scores.get('a'), 1 - 1 / 3);
  assert.equal(scores.get('b'), 1 - 1 / 3, 'the team-mate who is not in winnerIds still won');
  assert.equal(scores.get('c'), -1 / 3);
  assert.equal(scores.get('d'), -1 / 3);
});

// ---- The float drift the ranking has to survive -----------------------------

test('two members at a mathematically equal total really do differ in the float', () => {
  // A: 4 wins at p=2, 1 loss at p=3.  B: 3 wins at p=2, 1 win at p=3, 1 loss at p=2.
  // Both are 5/3. This fixture is here because the tie convention must be
  // asserted against drift that ACTUALLY occurs, never against hand-picked
  // equal floats (#895 §The measure).
  const sessions = [];
  for (let i = 0; i < 4; i++) sessions.push(night(['A', 'x'], ['A']));
  sessions.push(night(['A', 'x', 'y'], ['x']));
  for (let i = 0; i < 3; i++) sessions.push(night(['B', 'x'], ['B']));
  sessions.push(night(['B', 'x', 'y'], ['B']));
  sessions.push(night(['B', 'x'], ['x']));
  const s = scoresOf(roundOf(['A', 'B', 'x', 'y'], sessions));

  assert.notEqual(s.A, s.B, 'fixture no longer drifts — the tie test below would be vacuous');
  assert.equal(s.A.toFixed(1), s.B.toFixed(1));
  assert.equal(s.A.toFixed(1), '1.7');
});

test('every round member gets a score, including one who never played', () => {
  const round = roundOf(['a', 'b', 'never'], [night(['a', 'b'], ['a'])]);
  const s = scoresOf(round);
  assert.equal(s.never, 0);
  assert.deepEqual(Object.keys(s).sort(), ['a', 'b', 'never']);
});

test('a guest is scored within the session but is not a round member', () => {
  const session = night(['a'], ['g1'], { guests: [{ id: 'g1', name: 'Vera' }] });
  const round = roundOf(['a'], [session]);
  const scores = sessionWinScores(round, session, sessionPartyGroups);
  assert.equal(scores.get('g1'), 1 - 1 / 2, 'the guest won a two-party night');
  assert.equal(scores.get('a'), -1 / 2);
  // memberWinScores is the standings' input and keys on round members only.
  assert.deepEqual(Object.keys(scoresOf(round)), ['a']);
});

test('an unfinished session is not counted', () => {
  const round = roundOf(['a', 'b'], [night(['a', 'b'], ['a'], { finished: false })]);
  assert.equal(scoresOf(round).a, 0);
});
