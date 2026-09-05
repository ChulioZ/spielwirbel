'use strict';

/* The per-period recap lives on the CHRONIK (#851), not on Pokale (#800).
 *
 * The Chronik is the round's time axis — it already groups its own timeline by
 * month — so a month's shareable card belongs beside the stretch of history it
 * summarises. On Pokale it sat under the all-time record, which is what forced
 * its cards to carry „· Juli 2026" in the first place
 * (`.claude/rules/a-second-section-must-not-reuse-a-card-label.md`).
 *
 * Rendered through the jsdom harness rather than matched over the view source
 * (`.claude/rules/testing-views-under-jsdom.md`): every claim here is about
 * which screen a node ends up on, which no assertion over the text can see.
 *
 * SELECTORS ARE SCOPED TO THE SECTION on purpose. The Chronik now carries
 * `.pokale-card` elements, so a bare `.pokale-card` in any spec on this screen
 * would start answering about the recap instead of what it meant — the trap both
 * the jsdom rule and the card-label rule describe, one screen further on.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { CSS, rulesOf } = require('./support/css');

const RID = 'r1';

/* The same fixture shape test/pokale-retired.test.js uses, because the
   active-shelf claim below is that file's — it moved here with the section it
   is about. One vote session carries every rating; the rest only move the play
   tally. All three games average 3.0 in July, so the shelf filter alone decides
   the Bestbewertet card, and BOTH archives lead the active game: neither a
   missing filter nor a retired-only one can pass. */
const VOTES = {
  m1: { g1: { rating: 3 }, g2: { rating: 5 }, g3: { rating: 4 } },
  m2: { g1: { rating: 3 }, g2: { rating: 1 }, g3: { rating: 2 } },
  m3: { g1: { rating: 3 }, g2: { rating: 3 }, g3: { rating: 3 } },
};

const played = (id, gid, at, votes = {}) => ({
  id,
  createdAt: at,
  gameIds: ['g1', 'g2', 'g3'],
  memberIds: ['m1', 'm2', 'm3'],
  votes,
  votedIds: Object.keys(votes),
  finished: true,
  cancelled: false,
  done: true,
  winnerIds: ['m1'],
  chosenGameId: gid,
  events: [],
});

const GAMES = [
  { id: 'g1', title: 'Catan', tagIds: [] },
  { id: 'g2', title: 'Azul', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
  { id: 'g3', title: 'Cascadia', completed: true, completedAt: '2026-07-02T10:00:00.000Z', tagIds: [] },
];

const MEMBERS = [
  { id: 'm1', name: 'Anna' },
  { id: 'm2', name: 'Ben' },
  { id: 'm3', name: 'Cem' },
];

/* Two months, so the picker has something to move BETWEEN — a single-period
   fixture would let a picker that does nothing at all pass the „only the cards
   change" spec. July carries the votes and three Azul nights; August carries one
   Catan night and nothing else. */
const ROUND = {
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: MEMBERS,
  games: GAMES,
  sessions: [
    played('s1', 'g2', '2026-07-01T20:00:00.000Z', VOTES),
    played('s2', 'g2', '2026-07-02T20:00:00.000Z'),
    played('s3', 'g2', '2026-07-03T20:00:00.000Z'),
    played('s4', 'g3', '2026-07-04T20:00:00.000Z'),
    played('s5', 'g3', '2026-07-05T20:00:00.000Z'),
    played('s6', 'g1', '2026-07-06T20:00:00.000Z'),
    played('s7', 'g1', '2026-08-10T20:00:00.000Z'),
  ],
};

const ACTIVITIES = [
  { id: 'a1', type: 'game_added', at: '2026-08-12T09:00:00.000Z', gameId: 'g1', title: 'Catan' },
];

function boot(t, round = ROUND, activities = ACTIVITIES) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return activities;
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

const precap = (dom) => dom.app.querySelector('.precap');
const monthLabel = (dom, iso) => dom.run(`fmtMonth(${JSON.stringify(iso)})`);

/** One recap card, found by the label it renders — scoped to the recap section. */
const recapCardByLabel = (dom, label) =>
  [...precap(dom).querySelectorAll('.pokale-card')].find(
    (c) => (c.querySelector('.pokale-card__label') || {}).textContent === label
  );

/* Every element inside a card that NAMES a game. `.pokale-card__value` alone is
   not that test — pokaleStatCard uses it for the streak, whose value is a member
   name — so the href is what distinguishes them (the same reasoning as
   test/pokale-retired.test.js, where this selector comes from). */
const namedGames = (root) =>
  [...root.querySelectorAll('.pokale-game__title, .pokale-card__value')]
    .filter((el) => !el.classList.contains('pokale-card__value') || /\/game\//.test(el.getAttribute('href') || ''))
    .map((el) => el.textContent);

// ---- where the section lives ----------------------------------------------

test('the recap renders on the Chronik, as the first child of #app', async (t) => {
  const dom = boot(t);
  await dom.call('showRound', RID, 'chronik');
  const sec = precap(dom);
  assert.ok(sec, 'the period recap section is missing from the Chronik entirely');
  assert.equal(sec.querySelector('.section-head h2').textContent, dom.run("t('periodRecap.title')"));
  // First child, i.e. ABOVE the timeline. The desktop rail and the hub tab strip
  // are both PREPENDED to `app` (#331), so they are skipped rather than counted
  // as the recap having lost its place — the same two the >=1280px column rule
  // excludes by name (`.app > *:not(.rail):not(.dock)`).
  const sections = [...dom.app.children]
    .filter((el) => !el.classList.contains('dock') && !el.classList.contains('rail'));
  assert.equal(sections[0], sec, 'the recap must sit above the Chronik section, not below it');
  assert.ok(sections[1] && sections[1].querySelector('.timeline'), 'the timeline must be the section after it');
});

test('the recap renders NOWHERE on the Pokale tab any more', async (t) => {
  const dom = boot(t);
  await dom.call('showRound', RID, 'pokale');
  assert.equal(precap(dom), null, 'the period recap is still on Pokale — the move did not happen');
  // The tab itself must still be intact, or the assertion above is passing for
  // the wrong reason (a Pokale tab that rendered nothing at all).
  assert.ok(dom.app.querySelector('.pokale-card'), 'the Pokale tab rendered no cards at all');
  assert.ok(dom.app.querySelector('.recap__totals'), 'the all-time Rückblick must stay on Pokale');
});

test('exactly one <h1> on the Chronik screen', async (t) => {
  const dom = boot(t);
  await dom.call('showRound', RID, 'chronik');
  const h1s = [...dom.app.querySelectorAll('h1')];
  assert.equal(h1s.length, 1, 'the recap must keep its <h2>; only „Chronik" is the screen title');
  assert.equal(h1s[0].textContent, dom.run("t('chronik.title')"));
});

// ---- what the section says -------------------------------------------------

test('the period Bestbewertet follows the active-only rule (moved with #851)', async (t) => {
  const dom = boot(t);
  await dom.call('showRound', RID, 'chronik');
  // All three games average 3.0 in July: Azul is retired, Cascadia completed,
  // only Catan is on the active shelf.
  const scope = JSON.stringify(monthLabel(dom, '2026-07-01T00:00:00'));
  // July is not the default (August is newer) — move the picker to it.
  const picker = precap(dom).querySelector('.precap__picker');
  picker.value = 'month:2026-07';
  picker.dispatchEvent(new dom.window.Event('change'));
  const card = recapCardByLabel(dom, dom.run(`t('periodRecap.bestRated', { period: ${scope} })`));
  assert.ok(card, 'the period best-rated card is missing entirely');
  assert.deepEqual(namedGames(card), ['Catan']);
});

/* THE DEFECT #914 FIXED, stated as one assertion across two screens.
 *
 * Both cards carry the label „Bestbewertet" and, until #914, two different
 * arithmetics behind it: the all-time card (views-pokale.js) has ranked on the
 * Spielwirbel-Score since #893, while this one still meaned the raw ratings —
 * and printed the result with a `Ø ` prefix the all-time card does not use. So
 * the same game could be crowned with two different numbers in two different
 * typographies, on one screen's worth of scrolling.
 *
 * THE SHARED FIXTURE CANNOT SEE THE ARITHMETIC HALF. Its games are all rated 3,
 * and f(3) = 3 is one of the curve's pinned anchors, so score and raw mean print
 * the same „3,0" and only the `Ø ` would discriminate. This round therefore
 * carries a veto spread instead: `{5,5,1}` scores 1,7 and means 3,7
 * (.claude/rules/redefining-a-measure-invalidates-its-fixtures.md — the field
 * that stood for nothing under the old measure is the one under test now).
 *
 * The year period covers every session this round has, so the two cards are
 * looking at exactly the same votes and MUST agree. Comparing the rendered TEXT
 * rather than the two models is deliberate: the `Ø ` was a rendering defect, so
 * an assertion over the models could not have seen it.
 */
const VETO_ROUND = {
  ...ROUND,
  sessions: [
    played('v1', 'g1', '2026-07-06T20:00:00.000Z', {
      m1: { g1: { rating: 5 } }, m2: { g1: { rating: 5 } }, m3: { g1: { rating: 1 } },
    }),
  ],
};

test('the per-period and all-time Bestbewertet cards print the SAME number, in the same format', async (t) => {
  const dom = boot(t, VETO_ROUND);
  await dom.call('showRound', RID, 'chronik');
  const picker = precap(dom).querySelector('.precap__picker');
  picker.value = 'year:2026';
  picker.dispatchEvent(new dom.window.Event('change'));

  // A year period labels itself with the bare key (views-chronik.js's labelOf).
  const periodCard = recapCardByLabel(dom, dom.run("t('periodRecap.bestRated', { period: '2026' })"));
  assert.ok(periodCard, 'the year period card is missing — check the picker id shape');
  assert.deepEqual(namedGames(periodCard), ['Catan'], 'the two cards must be about the same game to be comparable');
  const periodValue = periodCard.querySelector('.pokale-card__sub').textContent;

  await dom.call('showRound', RID, 'pokale');
  const allTime = [...dom.app.querySelectorAll('.pokale-card')].find(
    (c) => (c.querySelector('.pokale-card__label') || {}).textContent === dom.run("t('pokale.bestRated')")
  );
  assert.ok(allTime, 'the all-time best-rated card is missing');
  assert.deepEqual(namedGames(allTime), ['Catan']);

  assert.equal(periodValue, allTime.querySelector('.pokale-card__sub').textContent);
  /* Named as well as compared, so a change breaking BOTH cards the same way
     cannot satisfy this by making them equally wrong. All five candidate values
     are distinct here, which is what keeps the guard discriminating: 2,8 is the
     shelf score ({5,5,1} shrunk toward the fixed prior of 3, lifted by one play
     at #928's PLAY_LIFT of 2,0), 2,6 the same thing under #894's lift of 1,0,
     1,7 the unshrunk Spielwirbel-Score (#893), 3,7 the raw mean, and „Ø 1,7"
     the old typography. */
  assert.equal(periodValue, '2,8');
});

test('the picker drives only the recap cards — the timeline below is untouched', async (t) => {
  const dom = boot(t);
  await dom.call('showRound', RID, 'chronik');
  /* Held by NODE IDENTITY — `===` on each element, and nothing weaker. Two
     forms were measured against a picker deliberately wired to rebuild the
     timeline, and BOTH stayed green: comparing `innerHTML` (the markup here is
     byte-identical after a redraw, since the picker does not filter the
     timeline) and `assert.deepEqual` over the node lists (deepStrictEqual
     compares DOM elements structurally, and two freshly-parsed clones have the
     same own properties). Only reference equality sees a rebuild. */
  const timelineNodes = [...dom.app.querySelectorAll('.timeline .tl-item')];
  assert.ok(timelineNodes.length >= 2, 'the fixture must actually have a timeline to leave alone');
  const sec = precap(dom);
  const picker = sec.querySelector('.precap__picker');
  // August (the default, newest) -> July, which has six of the seven sessions.
  const augustPlayed = sec.querySelector('.recap__totals').textContent;
  picker.value = 'month:2026-07';
  picker.dispatchEvent(new dom.window.Event('change'));
  assert.notEqual(sec.querySelector('.recap__totals').textContent, augustPlayed, 'the picker changed nothing at all');
  const after = [...dom.app.querySelectorAll('.timeline .tl-item')];
  assert.equal(after.length, timelineNodes.length, 'the picker changed how many entries the timeline shows');
  assert.ok(
    after.every((node, i) => node === timelineNodes[i]),
    'the picker must not filter or redraw the timeline — these must be the very same nodes'
  );
});

test('„Teilen" shares the SELECTED period, from the numbers on screen', async (t) => {
  const dom = boot(t);
  const drawn = [];
  // Stubbed because jsdom has no canvas; what is under test is which period's
  // model reaches the card, not the PNG. Built at CLICK time on purpose — a
  // model captured at render would share the month the user moved away from.
  dom.set('recapCardBlob', async (model) => { drawn.push(model); return { size: 1 }; });
  dom.set('toast', () => {});
  // jsdom implements neither navigator.canShare nor createObjectURL, so the real
  // code takes its download fallback and would die there. Stubbed so the test
  // fails on the MODEL rather than on the environment.
  dom.window.URL.createObjectURL = () => 'blob:test';
  dom.window.URL.revokeObjectURL = () => {};
  await dom.call('showRound', RID, 'chronik');
  const sec = precap(dom);
  const btn = sec.querySelector('.precap__share');
  assert.ok(btn, 'the share button is missing — canShareRecapImage() did not move with the section');
  const picker = sec.querySelector('.precap__picker');
  picker.value = 'month:2026-07';
  picker.dispatchEvent(new dom.window.Event('change'));
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].periodLabel, monthLabel(dom, '2026-07-01T00:00:00'), 'the card shared the wrong period');
  assert.equal(drawn[0].roundName, 'Freitagsrunde');
  // The same numbers the section is showing, not a second aggregation: July has
  // six played sessions, and its most-played game is Azul on three nights.
  assert.equal(drawn[0].sessions, 6);
  // Re-realmed: the model is built inside the vm context, so its arrays carry
  // that realm's Array.prototype and deepStrictEqual refuses them by identity.
  assert.deepEqual([...drawn[0].played], ['Azul']);
});

// ---- the edges of the new home ---------------------------------------------

test('a round with shelf changes but no finished session gets the thin recap (#851)', async (t) => {
  /* On Pokale this section sat BELOW the `finished.length === 0` guard, so such
     a round saw no picker at all. The Chronik has no such guard, and periodsOf()
     offers a period with EITHER a played session or a shelf change — so the
     picker now appears and reads „nur das Regal hat sich verändert". That is
     correct here rather than a leak: shelf changes are exactly what this
     timeline is a timeline of. Asserted rather than guarded against. */
  const dom = boot(t, { ...ROUND, sessions: [] }, ACTIVITIES);
  await dom.call('showRound', RID, 'chronik');
  const sec = precap(dom);
  assert.ok(sec, 'a round with only shelf changes must still get the recap here');
  assert.equal(sec.querySelector('.precap__thin').textContent, dom.run("t('periodRecap.thin')"));
  assert.equal(sec.querySelectorAll('.pokale-card').length, 0, 'no card can be crowned with nothing played');
});

test('a round with no periods at all renders no section', async (t) => {
  const dom = boot(t, { ...ROUND, sessions: [] }, []);
  await dom.call('showRound', RID, 'chronik');
  assert.equal(precap(dom), null, 'periodsOf() offered nothing, so there must be no section to design an empty state for');
  assert.ok(dom.app.querySelector('.timeline'), 'the Chronik itself must still render');
});

// ---- the wide-column exclusion (#851) --------------------------------------

test('the recap is excluded from the >=1280px wide-column exemption', () => {
  /* CSS stays a text assertion — jsdom applies no external stylesheet
     (`.claude/rules/testing-views-under-jsdom.md`). The section reuses
     `.pokale-cards`, so without `:not(.precap)` the `:has()` branch would widen
     it to the full pane while the timeline below stayed at the reading measure:
     two column widths stacked on one screen. */
  const widened = rulesOf(CSS)
    .map(([sel]) => sel)
    .filter((sel) => /\.app > \*.*:has\(/.test(sel) && /\.pokale-cards/.test(sel));
  assert.equal(widened.length, 1, 'the wide-column :has() rule moved — this assertion is looking at the wrong selector');
  assert.match(widened[0], /:not\(\.precap\)/);
});
