'use strict';

/* The Rückblick at the foot of the Regal, and the young round's Pokale order
 * (#1855). Rendered through the jsdom harness in every design, because both
 * claims are about the DOM each design composes (.claude/rules/testing-views-under-jsdom.md).
 *
 * Named after the view rather than the module: test/recap.test.js already
 * belongs to public/js/recap.js (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');
const { DESIGN_REGISTRY } = require('../public/js/designs');

/* Three games, three people, one rated evening: Azul is the worst-rated game,
   Cascadia the one the table splits over (Clara 5, Ben 1), and every member
   has a favourite. Four played evenings, so the round is past its podium. */
const VOTES = {
  m1: { g1: { rating: 5 }, g2: { rating: 1 }, g3: { rating: 4 } },
  m2: { g1: { rating: 4 }, g2: { rating: 2 }, g3: { rating: 1 } },
  m3: { g1: { rating: 4 }, g2: { rating: 2 }, g3: { rating: 5 } },
};
const THREE = ['m1', 'm2', 'm3'];
function ratedRound() {
  const round = badgeRound([
    night('s1', 1, { memberIds: THREE, gameIds: ['g1', 'g2', 'g3'], votes: VOTES, votedIds: THREE }),
    night('s2', 2, { memberIds: THREE }),
    night('s3', 3, { memberIds: THREE, winnerIds: ['m2'] }),
    night('s4', 4, { memberIds: THREE, chosenGameId: 'g3' }),
  ], 3);
  round.games.push({ id: 'g3', title: 'Cascadia', tagIds: [] });
  return round;
}

function boot(t, design, round, { simpleMode, wide = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  stubApi(dom, round);
  wideAt(dom, wide);
  if (simpleMode) dom.run(`accountUser = { id: 'u1', username: 'ada', simpleMode: ${JSON.stringify(simpleMode)} };`);
  return dom;
}
const active = (round) => round.games.filter((g) => !g.retired && !g.completed);
const regal = (dom, round) => { dom.app.innerHTML = ''; dom.call('renderRegalTab', round, active(round)); return dom.app; };
const pokale = (dom, round) => { dom.app.innerHTML = ''; dom.call('renderPokaleTab', round); return dom.app; };
const labelOf = (card) => (card.querySelector('.pokale-card__label') || {}).textContent;

assert.ok(DESIGN_REGISTRY.length >= 6, 'the design sweep below must cover every design');

for (const { id } of DESIGN_REGISTRY) {
  test(`${id}: the Regal ends with one folded Rückblick row, and Pokale has none`, (t) => {
    const round = ratedRound();
    const dom = boot(t, id, round);
    const app = regal(dom, round);
    const rows = app.querySelectorAll('details.regal-recap');
    assert.equal(rows.length, 1, 'exactly one Rückblick row on the Regal');
    const row = rows[0];
    assert.equal(row.open, false, 'the row starts folded');
    assert.equal(app.lastElementChild, row.closest('.section'), 'the Rückblick closes the Regal');
    const summary = row.querySelector('summary').textContent.replace(/\s+/g, ' ').trim();
    assert.ok(summary.startsWith(dom.run("t('recap.title')")), summary);
    assert.equal(row.querySelector('.recap__totals'), null, 'the totals chips were dropped');

    const cards = [...row.querySelectorAll('.pokale-card')];
    const worst = cards.find((c) => labelOf(c) === dom.run("t('recap.worstRated')"));
    const divisive = cards.find((c) => labelOf(c) === dom.run("t('recap.divisive')"));
    assert.ok(worst && worst.textContent.includes('Azul'), 'Schlechtestbewertet names Azul');
    assert.ok(divisive && divisive.querySelector('.pokale-card__value').textContent === 'Cascadia');
    const favs = [...row.querySelectorAll('.recap-fav .recap-fav__name')].map((n) => n.textContent);
    assert.deepEqual(favs.sort(), ['Anna', 'Ben', 'Clara']);

    assert.equal(pokale(dom, round).querySelector('.recap, .regal-recap'), null, 'Pokale still renders a Rückblick');
  });

  test(`${id}: a young round names its leader FIRST, before the rest line`, (t) => {
    // Two played evenings, below YOUNG_ROUND_PODIUM_FROM: Anna leads with one win.
    const round = badgeRound([
      night('s1', 1, { memberIds: THREE }),
      night('s2', 2, { memberIds: THREE, winnerIds: ['m2'] }),
    ], 3);
    round.sessions[1].winnerIds = ['m1'];
    const dom = boot(t, id, round, { wide: true });
    const app = pokale(dom, round);
    const lead = app.querySelector('.pokale-young');
    const rest = app.querySelector('.podium__rest');
    assert.ok(lead && rest, 'the young round renders its leader and its rest line');
    assert.ok(lead.compareDocumentPosition(rest) & 4, 'the leader must come before the rest line');
    // Where the design splits stage from plaques, both stand in the stage.
    const stage = app.querySelector('.pokale-split__stage');
    if (stage) {
      assert.ok(stage.contains(lead) && stage.contains(rest), 'leader and rest line belong to the stage column');
      assert.equal(stage.firstElementChild, lead, 'the leader opens the stage');
    }
  });
}

test('a round with too little to say opens to the thin-data line', (t) => {
  const round = badgeRound([night('s1', 1)]);
  const dom = boot(t, null, round);
  const row = regal(dom, round).querySelector('.regal-recap');
  assert.ok(row, 'the row renders even on a young round');
  assert.ok(row.querySelector('.recap__thin'), 'the thin-data line is inside the row');
  assert.equal(row.querySelectorAll('.pokale-card').length, 0);
});

test('„Einfacher Modus" with stats hidden hides the row; the default shows it', (t) => {
  for (const [mode, hidden] of [[{ all: false, except: [] }, false], [{ all: false, except: ['stats'] }, true]]) {
    const round = ratedRound();
    const dom = boot(t, null, round, { simpleMode: mode });
    assert.equal(!!regal(dom, round).querySelector('.regal-recap'), !hidden, `under ${JSON.stringify(mode)}`);
  }
});
