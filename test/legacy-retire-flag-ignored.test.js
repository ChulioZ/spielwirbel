'use strict';

/* A leftover `retire` key is IGNORED — the vote is its rating (#909).

   #909 removed the retirement proposal from the vote scale and rewrote stored
   votes once (the Knex migration on Postgres, scripts/migrate-retire-votes.js
   on the JSON backend). This file is about the data the rewrite has NOT
   reached, which is a real set rather than a hypothetical one:

     - a self-hosted JSON instance whose operator has not run the script yet;
     - the few seconds of a zero-downtime deploy in which the outgoing container
       is still writing the old shape
       (.claude/rules/deploy-invariants-are-pinned-in-code.md).

   Every reader must take the stored rating and step over the flag. That is the
   same precedence the migration writes, so a round reads identically before and
   after it — which is what makes the rewrite a tidy-up rather than a cutover.

   It replaces test/vote-zero-counts.test.js, which pinned the opposite rule
   (#797's "retirement WINS over the rating") over the same readers. The reader
   list is the valuable part and is kept: the failure mode here is not an
   exception but a number that is quietly wrong on one screen while the
   neighbouring screen has it right.

   The frontend readers are exercised by RUNNING the views under jsdom
   (`.claude/rules/testing-views-under-jsdom.md`); lib/recommend.js is required
   directly. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { gameAffinity, buildPlayScale, buildShelfIndex } = require('../lib/recommend');

const RID = 'r1';

/* Ben carries the legacy contradiction (a stored 4 next to the flag), which
   #797 resolved as a 0 and #909 resolves as the 4. Anna carries the retire-ONLY
   shape, which has no rating to fall back on and therefore reads as "did not
   vote" — the exact loss the migration exists to prevent, pinned here so the
   cost of skipping it is written down rather than assumed. Azul is the control:
   an ordinary 3/5 untouched by any of this. */
const ROUND = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
  ],
  games: [
    { id: 'g1', title: 'Catan', tagIds: [] },
    { id: 'g2', title: 'Azul', tagIds: [] },
  ],
  sessions: [
    {
      id: 's1',
      createdAt: '2026-07-01T20:00:00.000Z',
      gameIds: ['g1', 'g2'],
      memberIds: ['m1', 'm2'],
      votes: {
        m1: { g1: { rating: null, retire: true }, g2: { rating: 3 } },
        m2: { g1: { rating: 4, retire: true }, g2: { rating: 5 } },
      },
      votedIds: ['m1', 'm2'],
      finished: true,
      cancelled: false,
      done: true,
      winnerIds: ['m1'],
      chosenGameId: 'g2',
      events: [],
    },
  ],
};

function bootApp(t) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return ROUND;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

// ------------------------------------------------------------ core.js stats

test('gameStats reads the stored rating and steps over the flag', async (t) => {
  const dom = bootApp(t);
  dom.context.ROUND = ROUND;
  const st = dom.run('gameStats(ROUND, "g1")');
  // Ben's 4 counts as a 4 — under #797 it was a 0. Anna's retire-only row has
  // no rating at all, so it is one vote, not two.
  assert.equal(st.avg, 4);
  assert.equal(st.count, 1);
  assert.equal(st.tiles[4], 1, 'the histogram bins it as a 4');

  const ok = dom.run('gameStats(ROUND, "g2")');
  assert.equal(ok.avg, 4, 'an ordinary game is untouched');
});

test('gameStatsForSession agrees with it, so the two screens cannot disagree', async (t) => {
  const dom = bootApp(t);
  dom.context.ROUND = ROUND;
  const st = dom.run('gameStatsForSession(ROUND, ROUND.sessions[0], "g1")');
  assert.equal(st.avg, 4);
  assert.equal(st.count, 1);
});

// -------------------------------------------------------- the member screen

test("a member's Ø uses the rating stored beside a stale flag", async (t) => {
  const dom = bootApp(t);
  await dom.call('showMember', RID, 'm2');
  const values = [...dom.app.querySelectorAll('.member-stats__card')]
    .map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  // Ben: 4 for Catan (his stored rating, flag ignored) and 5 for Azul -> Ø 4,5.
  // Reading the flag as a 0 would report Ø 2,5, which is the #797 number.
  assert.ok(values.some((v) => /Ø 4,5/.test(v)), `no Ø 4,5 among: ${values.join(' | ')}`);
});

// ------------------------------------------------------- the results screen

test('the results distribution has five buckets, 1 through 5', async (t) => {
  const dom = bootApp(t);
  await dom.call('showResults', ROUND, ROUND.sessions[0], ROUND.games, false);

  const rows = [...dom.app.querySelectorAll('.result-row')];
  assert.ok(rows.length, 'the results screen rendered no rows');
  for (const row of rows) {
    assert.equal(row.querySelectorAll('.result-row__bars .bar-col').length, 5,
      'the distribution must run 1–5, with no retirement column');
    assert.equal(row.querySelector('.result-row__bars .bar-axis .ti-trash'), null,
      'no column may be named by the trash glyph any more');
  }

  // Catan's row: Ben's 4 in the fourth column and nothing anywhere else. Since
  // #890 the count is read off the fill HEIGHT (the columns are labelled with
  // the scale, not with counts), so "nothing anywhere else" is every other fill
  // sitting at 0%.
  const catan = rows.find((r) => /Catan/.test(r.textContent));
  const cols = [...catan.querySelectorAll('.result-row__bars .bar-col')];
  assert.deepEqual(cols.map((c) => c.querySelector('.bar').style.height),
    ['0%', '0%', '0%', '100%', '0%']);
  assert.equal(catan.querySelector('.sort-flag'), null,
    'the „X wollen aussortieren" line is gone with the vote that fed it');
  // And the score the row prints is the 4 that vote makes it.
  assert.match(catan.querySelector('.result-row__score').textContent, /4[.,]0/);
});

// --------------------------------------------------- the recommendation side

test('the recommendation profile reads the stored rating, not the flag', () => {
  const bgg = (id, over = {}) => ({
    id, title: id, tagIds: [], source: { provider: 'bgg', externalId: `x-${id}` }, ...over,
  });
  const mk = (votes) => ({
    id: RID,
    members: [{ id: 'm1', name: 'Anna' }],
    games: [bgg('g1')],
    sessions: [{ id: 's1', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1'], memberIds: ['m1'], votes }],
  });

  const hated = mk({ m1: { g1: { rating: 1 } } });
  const loved = mk({ m1: { g1: { rating: 5 } } });
  const legacy = mk({ m1: { g1: { rating: 5, retire: true } } });

  const affinityOf = (round) =>
    gameAffinity(round.games[0], buildPlayScale(round), buildShelfIndex(round));

  assert.ok(affinityOf(hated) < affinityOf(loved),
    'a game the group votes „gar nicht" must not score like one they love');
  assert.equal(affinityOf(legacy), affinityOf(loved),
    'a stale flag beside a stored 5 leaves it a 5');
});
