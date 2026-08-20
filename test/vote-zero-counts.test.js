'use strict';

/* A retirement proposal counts as a rating of 0, everywhere (#797).

   `test/vote-scale.test.js` pins the rule itself; this file pins that each
   READER actually goes through it. That split matters, because the failure mode
   here is not an exception — it is a number that is quietly wrong on one screen
   while the neighbouring screen has it right. Storage was not migrated, so the
   two legacy shapes below are what the live data really holds:

     { rating: null, retire: true }   a bare "get rid of it" — used to be skipped
     { rating: 4,    retire: true }   the contradiction the old card allowed

   The frontend readers are exercised by RUNNING the views under jsdom
   (`.claude/rules/testing-views-under-jsdom.md`) rather than by matching source,
   and lib/recommend.js is required directly. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { gameAffinity, buildPlayScale } = require('../lib/recommend');

const RID = 'r1';

/* Anna proposes retiring Catan outright; Ben carries the legacy contradiction
   (a stored 4 next to the flag). Both are 0, so Catan's average is 0 and not
   the 4 the old readers would have reported from Ben's row alone. Azul is the
   control: an ordinary 3/5 that must be untouched by any of this. */
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
        m1: { g1: { rating: null, retire: true }, g2: { rating: 3, retire: false } },
        m2: { g1: { rating: 4, retire: true }, g2: { rating: 5, retire: false } },
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

test('gameStats averages both legacy retire shapes as 0', async (t) => {
  const dom = bootApp(t);
  dom.context.ROUND = ROUND;
  const st = dom.run('gameStats(ROUND, "g1")');
  // Two voters, both wanting it gone: Ø 0 over 2 ratings — not "no ratings",
  // and not the 4 the contradictory row still stores.
  assert.equal(st.avg, 0);
  assert.equal(st.count, 2);
  assert.equal(st.sortCount, 2);
  assert.equal(st.votesCast, 2);

  const ok = dom.run('gameStats(ROUND, "g2")');
  assert.equal(ok.avg, 4, 'an ordinary game is untouched');
  assert.equal(ok.sortCount, 0);
});

test('gameStatsForSession agrees with it, so the two screens cannot disagree', async (t) => {
  const dom = bootApp(t);
  dom.context.ROUND = ROUND;
  const st = dom.run('gameStatsForSession(ROUND, ROUND.sessions[0], "g1")');
  assert.equal(st.avg, 0);
  assert.equal(st.count, 2);
  assert.equal(st.sortCount, 2);
});

// -------------------------------------------------------- the member screen

test('a member\'s Ø includes the games they voted off the shelf', async (t) => {
  const dom = bootApp(t);
  await dom.call('showMember', RID, 'm2');
  const values = [...dom.app.querySelectorAll('.member-stats__card')]
    .map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  // Ben: 0 for Catan (the flag wins over his stored 4) and 5 for Azul -> Ø 2.5.
  // Reading his 4 would report Ø 4.5, which is the pre-#797 number.
  assert.ok(values.some((v) => /Ø 2\.5/.test(v)), `no Ø 2.5 among: ${values.join(' | ')}`);
});

// ------------------------------------------------------- the results screen

test('the results distribution has six buckets, the first being the retirements', async (t) => {
  const dom = bootApp(t);
  await dom.call('showResults', ROUND, ROUND.sessions[0], ROUND.games, false);

  const rows = [...dom.app.querySelectorAll('.result-row')];
  assert.ok(rows.length, 'the results screen rendered no rows');
  for (const row of rows) {
    assert.equal(row.querySelectorAll('.result-row__bars .bar').length, 6,
      'the distribution must run 0–5, not 1–5');
  }

  // Catan's row: two retirement votes in the zero bucket and nothing anywhere
  // else, plus the plain-language line that states the same count in words.
  const catan = rows.find((r) => /Catan/.test(r.textContent));
  const bars = [...catan.querySelectorAll('.result-row__bars .bar')];
  assert.ok(bars[0].classList.contains('bar--retire'), 'the zero bar is the retirement bucket');
  assert.ok(bars[0].querySelector('.ti-trash'), 'the zero bar carries the trash glyph, not a numeral');
  assert.match(bars[0].getAttribute('title'), /2/, 'its count belongs in the tooltip');
  assert.equal(bars.slice(1).map((b) => b.textContent.trim()).join(''), '',
    'a retirement vote must not also land in a 1–5 bucket');
  assert.match(catan.querySelector('.sort-flag').textContent, /2/,
    'the „X wollen aussortieren" line is where the zero bar\'s count is stated');

  // And the average the row prints is the 0 those votes make it.
  assert.match(catan.querySelector('.result-row__score').textContent, /0[.,]0/);
});

// --------------------------------------------------- the recommendation side

test('the recommendation profile reads a retirement proposal as a 0', () => {
  const bgg = (id, over = {}) => ({
    id, title: id, tagIds: [], source: { provider: 'bgg', externalId: `x-${id}` }, ...over,
  });
  const mk = (votes) => ({
    id: RID,
    members: [{ id: 'm1', name: 'Anna' }],
    games: [bgg('g1')],
    sessions: [{ id: 's1', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1'], memberIds: ['m1'], votes }],
  });

  const hated = mk({ m1: { g1: { rating: null, retire: true } } });
  const loved = mk({ m1: { g1: { rating: 5, retire: false } } });
  const legacy = mk({ m1: { g1: { rating: 5, retire: true } } });

  const affinityOf = (round) =>
    gameAffinity(round, round.games[0], buildPlayScale(round));

  assert.ok(affinityOf(hated) < affinityOf(loved),
    'a game the group voted off the shelf must not score like one they love');
  assert.equal(affinityOf(legacy), affinityOf(hated),
    'retirement wins over the rating a legacy row still stores');
});
