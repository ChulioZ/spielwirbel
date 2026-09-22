'use strict';

/* The hub's three sub-page previews and its „Nicht im Regal" group (#1185).

   This is the information architecture every design will skin
   (docs/design/handover-claude-design-2026-09-19.md §2), built first in
   Klassisch: the Start tab previews Regal, Pokale and Chronik and carries the
   four off-shelf entry points under one heading.

   Driven through the real `renderStartTab` in the jsdom harness, the way
   test/hub-start-cards.test.js drives the derived cards — the things that go
   wrong here are a preview showing a count that disagrees with the page it
   previews, a row wired to the wrong route, and a young round meeting boxes
   (`.claude/rules/testing-views-under-jsdom.md`). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const game = (id, extra = {}) => ({
  id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, image: 'c.jpg',
  createdAt: '2026-01-0' + (id % 9 + 1) + 'T10:00:00.000Z', ...extra,
});
const play = (id, gid, when, winnerIds = ['m1'], memberIds = ['m1', 'm2']) => ({
  id, createdAt: when, done: true, finished: true,
  gameIds: [gid], chosenGameId: gid, winnerIds, memberIds,
  votes: { m1: { [gid]: { rating: 5 } }, m2: { [gid]: { rating: 4 } } },
});

/* Eight on the shelf, three off it (one per archive), and four evenings arranged
   so the STANDINGS ORDER AND THE RAW WIN COUNT DISAGREE.

   That is not incidental. Anna wins three solo evenings and Ben wins the one
   two-handed evening, so Anna has 3 wins to Ben's 1 while the Siegwertung — which
   weights a win by the field it beat, and scores a solo night exactly 0 (#895) —
   puts Ben at +0.5 and Anna at −0.5. Measured: with the preview re-sorting by
   raw win count, the ranking assertion goes red. Under a fixture where the two
   measures happen to agree it stayed green five runs out of five, which is the
   fixture-too-small-to-fail case in
   `.claude/rules/break-the-code-on-purpose.md` — the whole point of that
   assertion is that the preview must not be a second derivation, and only a
   fixture where the derivations differ can see it. */
const busyRound = (over = {}) => ({
  id: 'r1',
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: [
    ...Array.from({ length: 8 }, (_, i) => game(10 + i)),
    game(30, { retired: true, retiredAt: '2026-02-01T10:00:00.000Z' }),
    game(31, { completed: true, completedAt: '2026-02-02T10:00:00.000Z' }),
    game(32, { wish: true, wishAt: '2026-02-03T10:00:00.000Z' }),
  ],
  sessions: [
    play(900, 10, '2026-03-01T18:00:00.000Z', ['m1'], ['m1']),
    play(901, 11, '2026-04-01T18:00:00.000Z', ['m1'], ['m1']),
    play(903, 13, '2026-04-15T18:00:00.000Z', ['m1'], ['m1']),
    play(902, 12, '2026-05-02T18:00:00.000Z', ['m2']),
  ],
  tags: [],
  ...over,
});

const youngRound = () => ({
  id: 'r2',
  name: 'Neue Runde',
  background: null,
  members: [{ id: 'm1', name: 'Anna' }],
  games: [game(10), game(11)],
  sessions: [],
  tags: [],
});

const activeOf = (r) => r.games.filter((g) => !g.retired && !g.completed && !g.wish);

function hub(t, round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => ({ recommendations: [] }));
  dom.call('renderStartTab', round, activeOf(round));
  return dom;
}

/** A preview card by the title it renders, scoped to the grid. */
const previewByTitle = (dom, title) =>
  [...dom.app.querySelectorAll('.hub-preview')].find(
    (c) => c.querySelector('.hub-card__title').textContent.trim() === title
  );

// ------------------------------------------------------------- the previews

test('the Regal preview states the shelf count and shows a handful of covers', (t) => {
  const r = busyRound();
  const dom = hub(t, r);
  const card = previewByTitle(dom, dom.run("t('hub.tab.regal')"));
  assert.ok(card, 'no Regal preview on a round with a shelf and a history');
  // The count is the ACTIVE shelf, not every row: three of this fixture's games
  // are off the shelf, and previewing them here would preview a different screen.
  assert.equal(
    card.querySelector('.hub-preview__sub').textContent.trim(),
    dom.run("tn(8, 'home.chip.gamesOne', 'home.chip.games')"),
  );
  const covers = card.querySelectorAll('.hub-preview__cover');
  assert.equal(covers.length, 6, 'the cover strip is capped at HUB_PREVIEW_COVERS');
  assert.equal(dom.run('HUB_PREVIEW_COVERS'), 6);
});

test('the Pokale preview ranks the same members, in the same places, as the Pokale page', (t) => {
  /* The assertion that matters: the preview must not be a SECOND derivation.
     Two rankings over one set of sessions drift with nothing going red, and the
     preview then contradicts the page one tap away
     (.claude/rules/shared-constants-across-the-stack.md). So the expectation is
     computed by calling roundStandings — the very function views-pokale.js
     renders from — rather than restated as literals here. */
  const r = busyRound();
  const dom = hub(t, r);
  const card = previewByTitle(dom, dom.run("t('hub.tab.pokale')"));
  assert.ok(card, 'no Pokale preview on a round with recorded winners');

  const standings = dom.get('roundStandings')(r);
  // Spread first: `winners` was built inside the vm context, so a `.map` over it
  // returns a vm-realm array and `deepStrictEqual` reports "same structure but
  // not reference-equal" (.claude/rules/testing-views-under-jsdom.md).
  const expected = [...standings.winners].slice(0, 3).map((m) => ({
    place: String(standings.rankOf[m.id]),
    name: m.name,
  }));
  assert.ok(expected.length >= 2, 'fixture has fewer than two ranked members — the order is untested');
  /* The precondition that makes the assertion below discriminating at all: the
     two candidate derivations must ORDER THESE MEMBERS DIFFERENTLY, or a preview
     that re-ranks by raw win count passes. Asserted rather than trusted, because
     it is a property of the fixture and fixtures get edited. */
  const byWins = [...standings.winners].sort((a, b) => standings.wins[b.id] - standings.wins[a.id]);
  assert.notDeepEqual(
    byWins.map((m) => m.name), [...standings.winners].map((m) => m.name),
    'the fixture ranks the same by Siegwertung and by raw wins, so this test cannot see a second derivation',
  );
  const shown = [...card.querySelectorAll('.hub-preview__rank')].map((row) => ({
    place: row.querySelector('.hub-preview__place').textContent.trim(),
    name: row.querySelector('.hub-preview__name').textContent.trim(),
  }));
  assert.deepEqual(shown, expected);
});

test('the Chronik preview counts finished sessions and dates the newest', (t) => {
  const r = busyRound();
  const dom = hub(t, r);
  const card = previewByTitle(dom, dom.run("t('hub.tab.chronik')"));
  assert.ok(card, 'no Chronik preview on a round with a history');
  assert.equal(
    card.querySelector('.hub-preview__sub').textContent.trim(),
    dom.run("tn(4, 'home.chip.sessionsOne', 'home.chip.sessions')"),
  );
  /* Dated by `createdAt` — when the evening was played — which is what the
     Chronik itself orders by. `finishedAt` moves every time an old session is
     re-finished, so reading it here would make the preview disagree with the
     list it previews (.claude/rules/server-computed-calendar-periods.md §7). */
  const expected = dom.run("fmtDate('2026-05-02T18:00:00.000Z')");
  assert.equal(
    card.querySelector('.hub-preview__last').textContent.trim(),
    dom.run(`t('hub.preview.chronikLast', { date: ${JSON.stringify(expected)} })`),
  );
});

test('each preview opens its own sub-page, as a real link with a distinct name', (t) => {
  const dom = hub(t, busyRound());
  const opens = [...dom.app.querySelectorAll('.hub-preview__open')];
  assert.equal(opens.length, 3);
  assert.deepEqual(
    opens.map((a) => a.getAttribute('href')),
    ['/round/r1/regal', '/round/r1/pokale', '/round/r1/chronik'],
  );
  for (const a of opens) {
    // A real <a href>, so ⌘/middle-click opens the sub-page in a new tab (#330).
    assert.equal(a.tagName, 'A');
    // „öffnen" three times over is the classic link-list failure: the accessible
    // name has to say WHICH page.
    const label = a.getAttribute('aria-label') || '';
    assert.ok(label && label !== a.textContent.trim(),
      `a preview link is named only "${label}", which does not say where it goes`);
  }
  const labels = opens.map((a) => a.getAttribute('aria-label'));
  assert.equal(new Set(labels).size, 3, `two preview links share one name: ${labels.join(' / ')}`);
});

test('ONE link per preview — a card is not a nest of interactive rows', (t) => {
  /* The natural shape is to wrap the card in an <a> and link the covers and rows
     inside it too, which nests interactive content: a screen reader then reads
     the card as one enormous link named by its whole contents, and a keyboard
     user tabs through a preview they cannot act on. */
  const dom = hub(t, busyRound());
  for (const card of dom.app.querySelectorAll('.hub-preview')) {
    const interactive = card.querySelectorAll('a, button, [tabindex]');
    assert.equal(interactive.length, 1,
      `a preview carries ${interactive.length} controls; it may carry exactly one`);
  }
});

test('a young round meets no previews at all', (t) => {
  /* The load-bearing rule views-round-start.js's header states, extended to the
     previews: a brand-new round meets the CTA and nothing else. Pokale and
     Chronik have nothing to show before the first evening by construction; the
     Regal is gated on the same condition deliberately, because the hero chip
     already states the count and a strip of placeholder tiles under a duplicated
     number is not worth a card. */
  const dom = hub(t, youngRound());
  assert.equal(dom.app.querySelectorAll('.hub-preview').length, 0,
    'a round that has never played was sold a preview of a screen it has been on all along');
  assert.equal(dom.run('hubPreviewsEarned')(youngRound()), false);
  assert.equal(dom.run('hubPreviewsEarned')(busyRound()), true);
});

test('an unplayed DRAW does not earn the previews either', (t) => {
  // `finished`, not `done`: a session whose voting has closed but which nobody
  // has recorded a result for is not an evening the round has played.
  const r = youngRound();
  r.sessions = [{ id: 's9', createdAt: '2026-06-01T18:00:00.000Z', done: true, finished: false, gameIds: ['10'], votes: {} }];
  const dom = hub(t, r);
  assert.equal(dom.app.querySelectorAll('.hub-preview').length, 0);
});

// ------------------------------------------------------- „Nicht im Regal"

test('the off-shelf group is ONE heading over the four destinations', (t) => {
  const dom = hub(t, busyRound());
  const group = dom.app.querySelector('.hub-offshelf');
  assert.ok(group, 'the hub carries no „Nicht im Regal" group');
  assert.equal(group.querySelectorAll('.hub-offshelf__title').length, 1);
  assert.equal(group.querySelector('.hub-offshelf__title').textContent.trim(),
    dom.run("t('rail.archive')"));
  const rows = [...group.querySelectorAll('.ds-row')];
  /* Four, never five. The V1 Tisch sheet (T3.2) showed the mistake to avoid: a
     fifth „Nicht im Regal" row with its own count, sitting inside the group of
     that name. */
  assert.equal(rows.length, 4, 'the off-shelf group is not exactly the four destinations');
  assert.deepEqual(
    rows.map((a) => a.getAttribute('href')),
    ['/round/r1/retired', '/round/r1/completed', '/round/r1/wishlist', '/round/r1/recommendations'],
  );
  for (const row of rows) {
    // Real links (#330), and `class` first so test/ds-row-affordance.test.js can
    // still see the row at all.
    assert.equal(row.tagName, 'A');
    /* The SAME row class the Regal's sheet uses. `.off-shelf__row .ds-row__main`
       is what puts the icon beside the label — the bare `.ds-row__main` is
       `display: block` — so a parallel class renders the icon flush against the
       text. jsdom applies no stylesheet, so this pins the class rather than the
       pixels; it was found in a browser. */
    assert.ok(row.classList.contains('off-shelf__row'),
      'the hub group invented its own row class, which does not inherit the icon/label rule');
  }
});

test('the group carries the same counts as the rail and the Regal sheet', (t) => {
  /* They no longer each derive their own — offShelfEntries() is the one
     definition — so this asserts that the hub really renders THAT list rather
     than having quietly grown a fourth copy. The Regal↔rail pair is pinned by
     test/off-shelf-parity.test.js; this is the third surface joining it. */
  const r = busyRound();
  const dom = hub(t, r);
  const shown = [...dom.app.querySelectorAll('.hub-offshelf .ds-row')]
    .map((a) => a.textContent.replace(/\s+/g, ' ').trim());
  const expected = [...dom.get('offShelfEntries')(r)].map((e) => e.label);
  assert.deepEqual(shown, expected);
  // And the counts are real, so a label that stopped counting would show here.
  assert.match(shown[0], /1/, 'the retired row does not count the one retired game');
  assert.match(shown[2], /1/, 'the wish row does not count the one wished-for game');
});

test('the group is offered on a round with NOTHING off the shelf', (t) => {
  /* Navigation, not content — the one thing on this screen that is
     unconditional. A screen is not less reachable for being empty, and the
     Wunschliste of a round that has never used one is exactly where someone goes
     to start using it. Every card above renders nothing when it has nothing to
     say; this must not. */
  const dom = hub(t, youngRound());
  const rows = dom.app.querySelectorAll('.hub-offshelf .ds-row');
  assert.equal(rows.length, 4, 'a round with nothing off the shelf lost its way to the four lists');
});

test('the group is rail-owned, so a desktop does not offer it twice', (t) => {
  /* From 1280px up the rail carries these four rows. Without this the Start tab
     would show the same navigation twice on one screen — and it is a CSS hide, so
     the duplication is invisible to every DOM assertion
     (.claude/rules/responsive-content-width.md). Same treatment as the hero, the
     CTA and the Einstellungen entry. */
  const dom = hub(t, busyRound());
  assert.ok(dom.app.querySelector('.hub-offshelf').classList.contains('rail-owned'));
});

test('the previews are NOT rail-owned — the rail carries no preview', (t) => {
  // The anti-vacuous half of the case above: `rail-owned` is right for
  // navigation the rail duplicates and wrong for content it does not, and
  // spraying it over the grid would silently empty the Start tab on a desktop.
  const dom = hub(t, busyRound());
  for (const card of dom.app.querySelectorAll('.hub-preview')) {
    assert.equal(card.classList.contains('rail-owned'), false);
  }
});
