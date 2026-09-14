'use strict';

/* The results screen for a session that holds NO VOTES (#915).
 *
 * A direct-play session is created with `votes: {}` (`lib/routes/sessions.js`,
 * the `body.gameId != null` branch), so it reaches this screen having never
 * asked anybody anything — and every vote-derived piece rendered its EMPTY
 * state instead of being absent: six full-height distribution tracks all filled
 * to 0px, and a bare „–" where the score goes.
 *
 * MEASURED CORRECTION to the issue: it also claimed the medals and a
 * „Geteilter Sieg" spotlight fired here. They do not, and never did —
 * `computePlaces` opens with `if (!r.count) return null`, so an unvoted row has
 * no place, and both the medal and the spotlight already keyed off that. Those
 * two assertions below are therefore CHARACTERIZATION, green before and after,
 * kept because this change edits the very row template they live in and they
 * are what would catch it re-rendering them. No gating code was added for them:
 * a redundant `hasVotes` clause on an already-correct condition is dead code
 * that reads like a fix.
 *
 * The empty-rung track is right for #890's design and wrong here: it makes an
 * unvoted rung read as an empty SLOT, which is a statement about a vote nobody
 * was ever asked for. So the whole ranking treatment is suppressed rather than
 * drawn empty.
 *
 * Asserted under jsdom by RUNNING the view, not by matching its source: the
 * absence of a node is the whole claim here, and a regex cannot tell an element
 * that is missing from one that is merely rendered empty
 * (.claude/rules/testing-views-under-jsdom.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';

const GAMES = [
  { id: 'g1', title: 'Catan', tagIds: [] },
  { id: 'g2', title: 'Azul', tagIds: [] },
  { id: 'g3', title: 'Splendor', tagIds: [] },
];

// A session with no votes at all — the shape the direct-play branch writes.
const unvoted = (over = {}) => ({
  id: 's1',
  createdAt: '2026-09-01T18:00:00.000Z',
  gameIds: ['g1'],
  memberIds: ['m1'],
  guests: [],
  votes: {},
  votedIds: [],
  finished: false,
  cancelled: false,
  done: true,
  winnerIds: [],
  chosenGameId: 'g1',
  events: [],
  ...over,
});

// The same screen with real votes — the control every suppression is measured
// against, so a test that passes by rendering nothing at all cannot hide here.
const voted = (over = {}) => unvoted({
  gameIds: ['g1', 'g2'],
  votes: { m1: { g1: { rating: 5, retire: false }, g2: { rating: 3, retire: false } } },
  votedIds: ['m1'],
  ...over,
});

const round = (over = {}) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [{ id: 'm1', name: 'Anna' }],
  games: GAMES,
  sessions: [],
  ...over,
});

const show = async (t, s, r = round({ sessions: [s] })) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return r;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  await dom.call('showResults', r, s, r.games, false);
  return dom;
};

test('a session nobody voted in renders no ranking treatment', async (t) => {
  const dom = await show(t, unvoted());

  assert.equal(dom.app.querySelectorAll('.trow').length, 1, 'the game is still listed');
  assert.equal(dom.app.querySelector('.trow__bars'), null, 'no distribution columns');
  assert.equal(dom.app.querySelector('.score-big'), null, 'no score, not even a „–"');
  assert.equal(dom.app.querySelector('.score-label'), null, 'nothing to name');
  assert.equal(dom.app.querySelector('.score-info'), null, 'and so no ⓘ explaining it');
  assert.equal(dom.app.querySelector('.rank-medal'), null, 'no medal (characterization — computePlaces already declines to place it)');
  // Scoped to the score column on purpose: the screen elsewhere contains an en
  // dash of its own („Als gespielt markieren – Gewinner …"), so a page-wide
  // match would be asserting the wrong thing while looking stricter. Since
  // #1056 the action lives in its OWN column, so the score column of an unvoted
  // row is genuinely empty rather than holding the button.
  assert.equal(
    dom.app.querySelector('.trow__score').textContent.replace(/\s+/g, ' ').trim(),
    '',
    'the score column of an unvoted row holds nothing at all'
  );
  assert.match(
    dom.app.querySelector('.trow__action').textContent.replace(/\s+/g, ' ').trim(),
    /auf dem Tisch/,
    'the chosen row states it is on the table, in the action column'
  );
});

test('the row keeps every control that is not about votes', async (t) => {
  const dom = await show(t, unvoted());
  const row = dom.app.querySelector('.trow');

  assert.ok(row.querySelector('.trow__title'), 'title');
  assert.ok(row.querySelector('.trow__img'), 'cover');
  // The chosen game is g1, so the action column carries the chip rather than a
  // „Spielen" button — and „Aus Session entfernen" moved into the row's „…"
  // menu, which is present in every phase (#1056).
  assert.equal(row.querySelector('.play-btn'), null, 'the chosen row offers no second „Spielen"');
  assert.ok(row.querySelector('.trow__chip'), 'it states „auf dem Tisch" instead');
  assert.ok(row.querySelector('.trow__menu'), 'the „…" menu carries the game link and the removal');
  // The finish controls left the row entirely in #1057 — they are the table
  // band's now, and the band is what a direct-play session opens on.
  assert.equal(row.querySelector('.row-finish'), null, 'no finish panel inside the row any more');
  const band = dom.app.querySelector('.tisch');
  assert.ok(band && !band.hidden, 'the table band carries them instead');
  assert.ok([...band.querySelectorAll('button')].some((b) => /Als gespielt markieren/.test(b.textContent)),
    'with the one action the evening needs');
  // …which is the wiring updateChosen drives through `rowRefs`.
  assert.ok(row.classList.contains('is-chosen'), 'the chosen row is still marked');
});

test('a direct-play session is the band alone — the whole Tafel stands down', async (t) => {
  /* #532: created with `votes: {}`, so `sessionHasVotes` is false and there is
     no ranking to show. What must still be there is the table band, because
     that session's whole purpose is the one game on it.

     RENAMED in #1107. This test was called „…and no Tafel" while asserting only
     the absence of `.tafel-top` and `.trow__bars` — the `.tafel` container and
     its heading were rendered the whole time, which is precisely the defect
     #1107 fixed. A test whose name outruns its assertions is worse than no
     test: it answers the question for the next reader without having asked it. */
  const dom = await show(t, unvoted());
  const band = dom.app.querySelector('.tisch');
  assert.ok(band && !band.hidden, 'the chosen game must have its band');

  const tafel = dom.app.querySelector('.tafel');
  assert.ok(tafel && tafel.hidden, 'the Tafel section is hidden, heading and all');
  assert.equal(dom.app.querySelector('.tafel-top'), null, 'and nothing to celebrate a vote with');
  assert.equal(dom.app.querySelector('.trow__bars'), null, 'nor a distribution to rank by');
  const hint = dom.app.querySelector('.tafel__hint');
  assert.ok(!hint || hint.hidden, 'no „Welches spielt ihr?" over an answered question');
  assert.ok(dom.app.querySelector('.result-people'), 'the people who played are still named');
});

/* --- the three terms of the gate, one test each ------------------------------
   Each fixture differs from `unvoted()` in exactly ONE term, so a test that goes
   green by suppressing everything cannot hide among them. */

test('a vote-less session with two games keeps every row (the abandoned draw)', async (t) => {
  // A lobby closed with zero votes. The rows are the only list of candidates the
  // group has, so the Tafel is the whole screen here.
  const dom = await show(t, unvoted({ gameIds: ['g1', 'g2'], chosenGameId: null }));
  const tafel = dom.app.querySelector('.tafel');
  assert.ok(tafel && !tafel.hidden, 'the Tafel stays');
  assert.equal(dom.app.querySelectorAll('.trow').length, 2, 'with both candidates listed');
});

test('a vote-less session with two games keeps them once one is CHOSEN', async (t) => {
  /* The `games.length === 1` term, and the only fixture that can see it: with
     nothing chosen the gate is already false through its `chosenId` term, so
     the abandoned-draw test above passes whether or not this term exists
     (measured — deleting it left the whole file green).

     Reachable today: close a lobby with zero votes and two games, then tap
     „Spielen" on one. The other game must stay listed, because the group can
     still change its mind and the rows are the only place that choice lives. */
  const dom = await show(t, unvoted({ gameIds: ['g1', 'g2'], chosenGameId: 'g1' }));
  const tafel = dom.app.querySelector('.tafel');
  assert.ok(tafel && !tafel.hidden, 'the Tafel stays while there is another game to pick');
  assert.equal(dom.app.querySelectorAll('.trow').length, 2, 'both games stay listed');
});

test('a vote-less one-game session with nothing chosen keeps its row', async (t) => {
  /* Draw one game, close the lobby with zero votes: one game, no votes, nothing
     chosen. The row's „Spielen" button is the ONLY way onto the table, so
     dropping the `chosenId` term would strand this group on an empty screen. */
  const dom = await show(t, unvoted({ chosenGameId: null }));
  const tafel = dom.app.querySelector('.tafel');
  assert.ok(tafel && !tafel.hidden, 'the Tafel stays');
  assert.equal(dom.app.querySelectorAll('.trow').length, 1, 'the one candidate is listed');
  assert.ok([...dom.app.querySelectorAll('.trow button')].some((b) => /Spielen/.test(b.textContent)),
    'and it can still be put on the table');
});

test('a VOTED one-game session keeps its Tafel — there is a vote to report', async (t) => {
  // The `!hasVotes` term. One game is not a ranking, but a vote that happened is
  // still a fact about the evening, and #1107 explicitly does not touch it.
  const dom = await show(t, voted({
    gameIds: ['g1'],
    votes: { m1: { g1: { rating: 4, retire: false } } },
    chosenGameId: 'g1',
  }));
  const tafel = dom.app.querySelector('.tafel');
  assert.ok(tafel && !tafel.hidden, 'the Tafel stays');
  assert.equal(dom.app.querySelectorAll('.score-big').length, 1, 'and still reports the score');
});

test('a direct-play session offers neither way to clear the choice', async (t) => {
  /* With one game there is nothing else to choose, and with the Tafel gone there
     would be no way back from an un-choice. „Session löschen" stays the hatch. */
  const dom = await show(t, unvoted());

  const band = dom.app.querySelector('.tisch');
  assert.ok(!/Anderes Spiel/.test(band.textContent), 'no „Anderes Spiel wählen" on the band');

  const menu = dom.app.querySelector('.trow__menu');
  assert.ok(menu, 'the row still builds its „…" menu');
  menu.click();
  // The popover mounts on <body>, not inside #app.
  const opts = [...dom.document.querySelectorAll('.popover--menu .popover__opt')]
    .map((b) => b.textContent.trim());
  assert.ok(opts.length, 'the menu opened');
  assert.ok(!opts.some((o) => /Auswahl aufheben/.test(o)),
    `„Auswahl aufheben" is still offered: ${opts.join(' | ')}`);

  assert.ok([...dom.app.querySelectorAll('.result-footer button')]
    .some((b) => /Session löschen/.test(b.textContent)), 'the escape hatch is still there');
});

test('the band carries the archived badge, in the row\'s own classes', async (t) => {
  /* Once the Tafel is gated away the band is the ONLY surface that can say the
     game was retired after the session. Same helper as the row, so the two
     cannot drift — asserted on the CLASS rather than the text, which is what a
     look-alike copy would get wrong first. */
  const retired = round({
    games: [{ id: 'g1', title: 'Catan', tagIds: [], retired: true }, GAMES[1], GAMES[2]],
    sessions: [unvoted()],
  });
  const dom = await show(t, unvoted(), retired);
  const badge = dom.app.querySelector('.tisch__title .tag--retired');
  assert.ok(badge, 'the band says the game was archived');
  assert.equal(dom.app.querySelector('.tafel').hidden, true, 'and it is the only surface saying it');
});

test('a completed game gets the completed badge on the band, not the retired one', async (t) => {
  const done = round({
    games: [{ id: 'g1', title: 'Catan', tagIds: [], completed: true }, GAMES[1], GAMES[2]],
    sessions: [unvoted()],
  });
  const dom = await show(t, unvoted(), done);
  assert.ok(dom.app.querySelector('.tisch__title .tag--completed'), 'the completed badge');
  assert.equal(dom.app.querySelector('.tisch__title .tag--retired'), null, 'and not the other one');
});

test('an unvoted draw session gets no winner spotlight', async (t) => {
  // Characterization (see the header): `computePlaces` already returns null for
  // a row with no votes, so `rows.filter((r) => r.place === 1)` is empty and the
  // spotlight never fires. Pinned here because the row template around it moved.
  const dom = await show(t, unvoted({ gameIds: ['g1', 'g2'], chosenGameId: null }));

  assert.equal(dom.app.querySelectorAll('.trow').length, 2, 'both games are listed');
  assert.equal(dom.app.querySelector('.tafel-top'), null, 'nobody won anything here');
});

test('a normally voted session is untouched', async (t) => {
  const dom = await show(t, voted());

  assert.equal(dom.app.querySelectorAll('.trow__bars').length, 2, 'bars on every row');
  assert.equal(dom.app.querySelectorAll('.score-big').length, 2, 'scores on every row');
  assert.equal(dom.app.querySelectorAll('.score-info').length, 1, 'exactly one ⓘ, as before');
  assert.ok(dom.app.querySelector('.trow__rank--1'), 'the rank rail places them');
  assert.ok(dom.app.querySelector('.tafel-top'), 'and the winner is in the gold group');
});

test('the chosen-game banner is gone from this screen altogether', async (t) => {
  /* Three removals in a row, each because something else already said it:
     #915 the „Gespielt wird: X" line, #1056 the prompt (onto the Tafel's
     kicker), #1057 the banner itself. The cancelled state was its last use and
     the h1 states that too. */
  const dom = await show(t, voted());
  assert.doesNotMatch(dom.app.textContent, /Gespielt wird/, 'the chosen game is already marked in the list');
  assert.equal(dom.app.querySelector('.chosen-banner'), null, 'no banner element at all');
});

test('the prompt and the cancelled state still speak, each in its own place', async (t) => {
  const prompt = await show(t, voted({ chosenGameId: null }));
  const hint = prompt.app.querySelector('.tafel__hint');
  assert.equal(hint.hidden, false, 'the prompt shows while nothing is chosen');
  assert.match(hint.textContent, /Tippt „Spielen“/);
  assert.ok(prompt.app.querySelector('.tisch').hidden, 'and nothing is on the table yet');

  const cancelled = await show(t, voted({ chosenGameId: null, cancelled: true }));
  assert.match(cancelled.app.querySelector('.result-title').textContent, /abgebrochen/i,
    'the cancelled state is the title now, which is also what the share text and the document title use');
});

test('„Braucht Erweiterung" survives every move, now on the table band', async (t) => {
  // Five people at a 2–4 base box that only seats them because the round owns a
  // 2–6 expansion — the one warning that the base box does not seat this table.
  const g = { id: 'g1', title: 'Catan', tagIds: [], minPlayers: 2, maxPlayers: 4,
    expansions: [{ title: 'Städte & Ritter', minPlayers: 2, maxPlayers: 6 }] };
  const s = unvoted({ memberIds: ['m1', 'm2', 'm3', 'm4', 'm5'] });
  const r = round({
    games: [g, ...GAMES.slice(1)],
    members: ['m1', 'm2', 'm3', 'm4', 'm5'].map((id, i) => ({ id, name: `P${i}` })),
    sessions: [s],
  });
  const dom = await show(t, s, r);

  const note = dom.app.querySelector('.tisch__note--warn');
  assert.ok(note, 'the note is rendered');
  assert.match(note.textContent, /Städte & Ritter/, 'and names the expansion the draw used');
  assert.ok(
    dom.app.querySelector('.tisch .tisch__note--warn'),
    'on the table band, which IS the box it is about'
  );
});

test('the Chronik card stops claiming a game was rated', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());

  const cardText = (s) => {
    dom.app.innerHTML = '';
    dom.call('renderChronikTab', round({ sessions: [s] }), []);
    return dom.app.querySelector('.session-card__meta').textContent;
  };

  assert.doesNotMatch(
    cardText(unvoted({ finished: true })), /bewertet/,
    'a direct-play session had nobody rate anything'
  );
  assert.match(
    cardText(voted({ finished: true })), /bewertet/,
    'a voted session still says so'
  );
});
