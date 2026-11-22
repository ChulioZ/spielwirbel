'use strict';

/* The Rundenpuls in the Chronik head and the Steckbrief's sentence under the
 * Regal heading (#1852), through the real views in every registered design.
 *
 * Both are moves, not new figures, so each test compares the new line with the
 * Start tab's card for the same round — one derivation, asserted on screen
 * rather than by re-deriving it here
 * (.claude/rules/assert-the-decision-not-its-ingredients.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');
const { DESIGN_REGISTRY } = require('../public/js/designs');

assert.ok(DESIGN_REGISTRY.length >= 6, 'the registry lost its designs — every loop below would shrink with it');

// Nine games with provider data: over the Steckbrief's eight-game threshold.
const linkedGames = () => Array.from({ length: 9 }, (_, i) => ({
  id: `g${i + 1}`, title: `Spiel ${i + 1}`, tagIds: [],
  minPlayers: 2, maxPlayers: 4, minPlaytime: 30, maxPlaytime: 60, weight: 2.5,
}));

// Dated back from today, so the pulse's twelve-month window always holds them.
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const recent = () => [night('s1', 1, { createdAt: daysAgo(10) }), night('s2', 2, { createdAt: daysAgo(4) })];

function boot(t, design, { sessions = recent(), games, simpleMode } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  const round = badgeRound(sessions);
  if (games) round.games = games;
  stubApi(dom, round);
  wideAt(dom, false);
  if (simpleMode) dom.run(`accountUser = { id: 'u1', username: 'ada', simpleMode: ${JSON.stringify(simpleMode)} };`);
  return { dom, round };
}
const active = (round) => round.games.filter((g) => !g.retired);
const chronik = (dom, round) => { dom.app.innerHTML = ''; dom.call('renderChronikTab', round, []); return dom.app; };
const regal = (dom, round) => { dom.app.innerHTML = ''; dom.call('renderRegalTab', round, active(round)); return dom.app; };

for (const { id } of DESIGN_REGISTRY) {
  test(`${id}: the Chronik head carries the pulse, folded, with the card's figures`, (t) => {
    const { dom, round } = boot(t, id);
    const app = chronik(dom, round);
    const pulse = app.querySelector('details.chronik-pulse');
    assert.ok(pulse, 'no pulse in the Chronik head');
    assert.equal(pulse.open, false, 'the pulse must start folded');
    // In the head of the screen: after the heading, before the filter chips and
    // the timeline (Forest's „Rückblick" entry may stand between, F13.2).
    const head = app.querySelector('.section-head h1').closest('.section-head');
    const chips = app.querySelector('.filter-chips');
    assert.equal(pulse.parentElement, head.parentElement, 'the pulse left the Chronik section');
    assert.ok(head.compareDocumentPosition(pulse) & 4, 'the pulse comes before the heading');
    assert.ok(pulse.compareDocumentPosition(chips) & 4, 'the pulse comes after the filter chips');
    const summary = pulse.querySelector('summary').textContent.replace(/\s+/g, ' ').trim();
    assert.match(summary, /^Rundenpuls /);
    assert.match(summary, /2 Sessions in 12 Monaten/);
    // The same figures the pulse card states, from the same function.
    const card = dom.call('hubPulseCard', round, active(round));
    const facts = card.querySelector('.hub-card__facts:not(.hub-card__threshold)');
    if (facts) {
      // One line in Klassisch („a · b"), one span per fact in Die Brücke.
      const spans = [...facts.querySelectorAll('.hub-card__fact')].map((el) => el.textContent);
      const list = spans.length ? spans : facts.textContent.split(/\s*·\s*/);
      for (const fact of list.map((s) => s.trim()).filter(Boolean)) {
        assert.ok(summary.includes(fact), `the summary lacks the card's „${fact}"`);
      }
    } else {
      // Der Tisch states the figures as tiles; the folded body carries the same tiles.
      const n = (root) => [...root.querySelectorAll('.pulse-tile__n')].map((el) => el.textContent);
      assert.deepEqual(n(pulse), n(card), 'the tiles disagree with the pulse card');
    }
    assert.equal(pulse.querySelectorAll('.hub-card__facts:not(.hub-card__threshold)').length, 0,
      'the body repeats the fact sentence the summary already states');
    // Two sessions: under the series threshold, so the note says when series
    // come — wherever the card says it (Das Programmheft says it in its lead).
    assert.equal(!!pulse.querySelector('.hub-card__threshold'), !!card.querySelector('.hub-card__threshold'),
      'the series note differs from the pulse card');
  });

  test(`${id}: a round with no played session shows no pulse in the Chronik`, (t) => {
    const { dom, round } = boot(t, id, { sessions: [] });
    assert.equal(chronik(dom, round).querySelector('.chronik-pulse'), null);
  });

  test(`${id}: the Regal heading carries the Steckbrief's sentence as a link`, (t) => {
    const { dom, round } = boot(t, id, { games: linkedGames() });
    const app = regal(dom, round);
    const line = app.querySelector('a.regal-profile');
    assert.ok(line, 'no profile line under the Regal heading');
    assert.equal(line.previousElementSibling, app.querySelector('.section-head h1').closest('.section-head'),
      'the profile line does not follow the Regal heading');
    assert.match(line.getAttribute('href'), /\/round\/r1\/shelf-profile$/);
    // The fixture's dominant ranges, known in advance (2–4, 30–60 min, 2.5).
    const sentence = 'Meist für 2–4 Personen · 31–60 Min. · mittel';
    assert.ok(line.textContent.includes(sentence), `the line does not say „${sentence}": ${line.textContent}`);
  });

  test(`${id}: below the Steckbrief's threshold the Regal carries no profile line`, (t) => {
    const { dom, round } = boot(t, id, { games: linkedGames().slice(0, 7) });
    assert.equal(regal(dom, round).querySelector('.regal-profile'), null);
  });
}

test('„Einfacher Modus" with stats hidden hides both lines, and the default shows them', (t) => {
  for (const [mode, hidden] of [[{ all: false, except: [] }, false], [{ all: false, except: ['stats'] }, true]]) {
    const { dom, round } = boot(t, null, { games: linkedGames(), simpleMode: mode });
    assert.equal(!!chronik(dom, round).querySelector('.chronik-pulse'), !hidden, `pulse under ${JSON.stringify(mode)}`);
    assert.equal(!!regal(dom, round).querySelector('.regal-profile'), !hidden, `profile under ${JSON.stringify(mode)}`);
  }
});

test('the profile line opens the Steckbrief screen in-app', (t) => {
  const { dom, round } = boot(t, null, { games: linkedGames() });
  const seen = [];
  dom.set('showShelfProfile', (rid) => seen.push(rid));
  regal(dom, round).querySelector('a.regal-profile').click();
  assert.deepEqual([...seen], ['r1']);
});
