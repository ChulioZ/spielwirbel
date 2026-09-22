'use strict';

/* Der Tisch's LIVE VOTE (#1192) — T4.3 Live-Abstimmung, T6.5 Live.
 *
 * The repaint half of this slice is already guarded generically:
 * test/tisch-hub-lobby.test.js derives "a rule reading a scheme-gated token is
 * itself scheme-gated" over the whole stylesheet, test/design-layer's two
 * sweeps refuse a colour literal or a token shadow outside the root blocks, and
 * test/a11y-contrast.test.js measures every token it names. A rule added here
 * is picked up by all three without anyone editing a list.
 *
 * What none of them can see is the five claims below. Three are about the
 * CONTRACT between the view and the stylesheet — the view renders elements for
 * every design and exactly one design draws them — and two are about the
 * package promising something the app's data cannot keep.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const APP = strip(read('public', 'styles.css'));
const TISCH = strip(read('public', 'css', 'designs', 'tisch.css'));

const ME = 'user-me';

function roundFixture(over = {}) {
  return {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    members: [
      { id: 'm1', name: 'Anna', userId: ME },
      { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Chris' },
      { id: 'm4', name: 'Dana' },
    ],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
      { id: 'g3', title: 'Cascadia', minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [],
    ...over,
  };
}

function sessionFixture(over = {}) {
  return {
    id: 's1',
    createdAt: '2026-09-22T18:00:00.000Z',
    gameIds: ['g1', 'g2', 'g3'],
    memberIds: ['m1', 'm2', 'm3', 'm4'],
    guests: [],
    votes: {},
    votedIds: [],
    done: false,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: null,
    ...over,
  };
}

async function lobby(t, { round = roundFixture(), session = sessionFixture() } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  // The 5s poll would otherwise reach the harness's rejecting fetch.
  dom.set('api', async () => round);
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  await dom.call('showSessionLobby', round, session, false);
  return dom;
}

const textOf = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);

/* 1 — ONE BOX PER DRAWN GAME, AND ALL OF THEM FOLLOW THE PERSON'S ONE STATE.
 *
 * T4.3 draws three states (gewertet · dran · offen) and its own fixture has
 * Jonas at [1,1,0]. The app cannot produce that: a column is written in ONE
 * request at the end of the card run, so `votedIds` is binary and a partial
 * column never reaches the server — by design, since lib/session-votes.js
 * redacts exactly that to keep the second voter from reading the first.
 *
 * So the honest rendering is the person's state SPREAD over the games, and the
 * assertion pins both halves: the count follows the draw (not a literal 3), and
 * a row is all-done or all-open with nothing in between. A future session
 * reading the sheet and "fixing" the middle state has to come through here.
 */
test('each person gets one box per drawn game, all filled or all open', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ votedIds: ['m2'] }) });
  const rows = [...dom.app.querySelectorAll('.live-person')];
  assert.equal(rows.length, 4, 'four seats');

  for (const row of rows) {
    const dots = [...row.querySelectorAll('.live-person__dot')];
    assert.equal(dots.length, 3, 'one box per drawn game');
    const done = dots.filter((d) => d.classList.contains('is-done')).length;
    assert.ok(done === 0 || done === 3, `a row is all-done or all-open, got ${done}`);
    assert.equal(done === 3, row.classList.contains('is-voted'), 'the boxes agree with the row');
  }

  assert.deepEqual(
    rows.map((r) => textOf(r.querySelector('.live-person__progress'))),
    ['0 von 3 gewertet', '3 von 3 gewertet', '0 von 3 gewertet', '0 von 3 gewertet']
  );
});

/* A two-game session must say "von 2". Pinning the count against a DIFFERENT
 * draw is what makes the assertion above about the draw rather than about the
 * number three, which the fixture would otherwise satisfy by coincidence.
 */
test('the box count follows the draw, not a fixed three', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ gameIds: ['g1', 'g2'] }) });
  const row = dom.app.querySelector('.live-person');
  assert.equal(row.querySelectorAll('.live-person__dot').length, 2);
  assert.equal(textOf(row.querySelector('.live-person__progress')), '0 von 2 gewertet');
});

/* 2 — THE WAITING LINE NAMES WHO IS MISSING, AND STOPS NAMING PAST THREE.
 *
 * The issue's own acceptance criterion is that the reason names the person.
 * The upper branch is the half a spec has to hold: six names is a paragraph
 * under a button, and the reader's question at that size is „how many".
 */
test('the waiting line names one missing person', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ votedIds: ['m1', 'm2', 'm3'] }) });
  assert.equal(textOf(dom.app.querySelector('.live-vote__waiting')), 'Noch 1 Person: Dana hat nicht gewertet.');
});

test('the waiting line names up to three and counts beyond that', async (t) => {
  const three = await lobby(t, { session: sessionFixture({ votedIds: ['m1'] }) });
  assert.equal(
    textOf(three.app.querySelector('.live-vote__waiting')),
    'Noch 3 Personen: Ben, Chris und Dana haben nicht gewertet.'
  );

  const round = roundFixture();
  round.members.push({ id: 'm5', name: 'Eli' });
  const four = await lobby(t, {
    round,
    session: sessionFixture({ memberIds: ['m1', 'm2', 'm3', 'm4', 'm5'] }),
  });
  const line = textOf(four.app.querySelector('.live-vote__waiting'));
  assert.equal(line, 'Noch 5 Personen haben nicht gewertet.');
  assert.ok(!/Ben|Chris|Dana|Eli/.test(line), 'past three the line stops naming people');
});

/* And it disappears once there is nobody to wait for — a sentence about a state
 * that has passed, sitting directly above the button that ends the voting. */
test('the waiting line is gone once every vote is in', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ votedIds: ['m1', 'm2', 'm3', 'm4'] }) });
  assert.equal(dom.app.querySelector('.live-vote__waiting'), null);
  assert.equal(dom.app.querySelector('.live-vote__panel-head'), null, 'and so is the sharing offer');
});

/* 3 — „ERGEBNIS ZEIGEN" IS NEVER DISABLED, WHATEVER THE SHEET DRAWS.
 *
 * T6.5 draws the button `disabled` while someone is still open; T4.3 draws the
 * same button live with the same line beneath it. The two sheets disagree, and
 * the enabled reading is the one that ships because the app decided this
 * question first and for a reason the package does not overturn: closing is
 * available at every point so that someone who never turns up cannot hold the
 * evening hostage (views-session-live.js, and the confirm dialog is the guard).
 *
 * This is the assertion most likely to be "corrected" by a future session
 * reading T6.5, which is exactly why it is written down as a test and not only
 * as a comment.
 */
test('the close button stays enabled while people are still open', async (t) => {
  const dom = await lobby(t, { session: sessionFixture({ votedIds: ['m1'] }) });
  const close = dom.app.querySelector('.live-vote__close');
  assert.ok(close, 'the closing action is on the screen');
  assert.equal(close.disabled, false);
  assert.ok(!close.hasAttribute('disabled'));
});

/* 4 — THE GUEST NOTE IS ABOUT SESSION GUESTS, AND NOTHING ELSE.
 *
 * T4.3 says „Mia stimmt ohne Konto ab". Who is actually holding the shared link
 * is not knowable — any participant may claim any open name on it — so the only
 * true reading is the one the data supports: a guest (#532) has no account by
 * construction. A note that claimed to identify the device would be a guess.
 */
test('the guest note names the session guests and is absent without them', async (t) => {
  const plain = await lobby(t);
  assert.equal(plain.app.querySelector('.live-vote__guests'), null);

  const round = roundFixture();
  const withGuest = await lobby(t, {
    round,
    session: sessionFixture({
      memberIds: ['m1', 'm2', 'm3', 'm4'],
      guests: [{ id: 'gu1', name: 'Mia' }],
    }),
  });
  const note = withGuest.app.querySelector('.live-vote__guests');
  assert.ok(note, 'a guest puts the note on the screen');
  assert.match(textOf(note), /Mia/);
  // The members must not be swept into it — they may well have accounts.
  assert.ok(!/Anna|Ben|Chris|Dana/.test(textOf(note)));
});

/* 5 — EVERY ELEMENT KLASSISCH HIDES MUST BE GIVEN A `display` BY THE DESIGN.
 *
 * The view renders Der Tisch's extra content for every design and styles.css
 * hides it, which is the shape #1191 established. The failure that shape invites
 * is silent in both directions and was shipped once while writing this issue:
 * a design rule that gives an element geometry but never a `display` leaves
 * styles.css's `none` standing, so the element is styled, measured by the
 * contrast sweep, and never painted anywhere.
 *
 * Derived from the stylesheet rather than listed, so a sixth hidden element
 * tomorrow is covered without anyone editing this test.
 */
test('every element the app hides by default is switched on by the design that renders it', () => {
  const hidden = [];
  for (const m of APP.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|[;\s])display:\s*none\s*(;|$)/.test(m[2])) continue;
    for (const sel of m[1].split(',').map((x) => x.trim())) {
      // Only the plain single-class selectors this pattern uses; a state rule
      // like `.x[hidden]` is a different mechanism and not this contract.
      const hit = /^\.(live-vote__[a-z-]+|live-person__[a-z-]+)$/.exec(sel);
      if (hit) hidden.push(sel);
    }
  }
  assert.ok(hidden.length >= 5, `expected the hidden set, found ${hidden.length}`);

  const missing = hidden.filter((sel) => {
    const re = new RegExp(`${sel.replace('.', '\\.')}\\s*\\{[^{}]*display:`);
    return !re.test(TISCH);
  });
  assert.deepEqual(missing, [], `styled by Der Tisch but never displayed: ${missing.join(', ')}`);
});

/* The panel is the one element that is NOT hidden — it groups children that
 * Klassisch already laid out, in a box Der Tisch can place beside the roster.
 *
 * Taking them out of `.live-vote__actions` took away that column's `gap`, so
 * the panel restates it. THE TWO MUST BE ONE VALUE: written as two literals
 * they drift the first time anyone retunes the column, and the result is a
 * couple of pixels of seam between the hot-seat buttons and the share row that
 * nobody would ever file a bug about. So the assertion is not "both are 12px" —
 * which two literals satisfy — but that each reads the same custom property.
 */
test('the panel reproduces the actions column spacing from one shared value', async (t) => {
  const decl = (sel) => {
    const m = new RegExp(`\\${sel}\\s*\\{([^{}]*)\\}`).exec(APP);
    assert.ok(m, `${sel} is declared in styles.css`);
    return m[1];
  };
  const VAR = /var\(--live-actions-gap\)/;
  assert.match(decl('.live-vote__actions'), VAR, 'the column reads the shared gap');
  const panelRule = decl('.live-vote__panel');
  assert.match(panelRule, /gap:\s*var\(--live-actions-gap\)/, 'and so does the panel');
  assert.match(panelRule, /margin-top:\s*var\(--live-actions-gap\)/, 'including the space above it');
  // A literal anywhere in the rule is the drift this is guarding against.
  assert.ok(!/\d+px/.test(panelRule), `the panel must not hard-code a spacing: ${panelRule.trim()}`);

  const dom = await lobby(t, { session: sessionFixture({ votedIds: ['m1'] }) });
  const panel = dom.app.querySelector('.live-vote__panel');
  assert.ok(panel, 'the panel is rendered');
  assert.ok(panel.querySelector('.live-vote__share-row'), 'the share row is inside it');
  assert.ok(panel.querySelector('.live-vote__close'), 'and so is the closing action');
  // Order is what `contents` preserves: sharing first, then the action that ends
  // the evening, then the line explaining who is missing.
  assert.deepEqual(
    [...panel.children].map((el) => el.className.split(' ')[0]),
    ['live-vote__panel-head', 'live-vote__share-row', 'btn', 'live-vote__waiting']
  );
});

/* 6 — /vote/<token> WEARS THE FACE, NOT THE VIEWER'S OWN DESIGN.
 *
 * This is the app's one public, account-free surface, and until #1192 it wore
 * whatever design the browser happened to be carrying: `bootApp()` applies the
 * account's design before routing, so a link opened by someone who HAS an
 * account rendered the invitation in that person's private look.
 *
 * The assertion has to force the wrong design first. Rendering the view on a
 * fresh page and finding the face proves nothing at all — the face is what a
 * fresh page already has, so the test would pass with the line deleted. That is
 * the whole point of putting it here rather than in test/vote-link-view.test.js,
 * whose harness starts clean by construction.
 */
test('the vote-link page forces the face design over whatever the viewer wears', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => ({
    roundName: 'Freitagsrunde',
    demo: false,
    games: [{ id: 'g1', title: 'Nordlichter', minPlayers: 2, maxPlayers: 5 }],
    people: [{ id: 'm1', name: 'Anna', color: null, hasVoted: false, linked: false }],
  }));
  dom.set('toast', () => {});

  // The viewer arrives wearing something else — the state that used to leak in.
  dom.run("applyDesign('tisch')");
  assert.equal(dom.run('document.documentElement.dataset.design'), 'tisch', 'the wrong design is really on');

  await dom.call('showVoteLink', 'tok-face');

  assert.equal(
    dom.run('document.documentElement.dataset.design'),
    dom.run('FACE_DESIGN'),
    'the public ballot wears the instance face'
  );
});
