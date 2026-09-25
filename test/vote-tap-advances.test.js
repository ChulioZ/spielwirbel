'use strict';

/* One tap per game, on both card renderers (#1168).

   Rating used to take two taps — the face, then „Weiter" — and the second one
   carried no information: the vote is in the closure the moment the face is
   pressed. The face tap now advances after a short beat, and this spec is the
   guard on the part of that which is easy to get wrong rather than the part
   that is easy to see.

   The hard constraint is the double-tap: during the beat the outgoing card is
   still on screen, so a second tap must not reach the FOLLOWING game's faces.
   `.vote--advancing` sets `pointer-events: none`, but jsdom applies no external
   stylesheet — and a keyboard Enter is not a pointer event anyway — so what is
   asserted here is the JS guard, which is the half that actually has to hold.

   Both surfaces run through the real views under the jsdom harness
   (`.claude/rules/testing-views-under-jsdom.md`). The wizard's card is also the
   OWN-DEVICE card: views-session-live.js reuses `startVoting` rather than
   rendering its own, so "all three surfaces behave identically" is two code
   paths, not three. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { setMotion, beat, swap } = require('./support/vote-card');

const MEMBER = { id: 'm1', name: 'Anna', color: '#7f77dd' };

const GAMES = [
  { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4 },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
  { id: 'g3', title: 'Dorfromantik', minPlayers: 1, maxPlayers: 6 },
];

const roundFixture = () => ({
  id: 'r1', name: 'Freitagsrunde', background: null,
  members: [MEMBER], games: [], sessions: [],
});

const sessionFixture = () => ({
  id: 's1', createdAt: '2026-09-18T18:00:00.000Z',
  gameIds: GAMES.map((g) => g.id), memberIds: ['m1'],
  votes: {}, votedIds: [], done: false, cancelled: false,
  finished: false, winnerIds: [], chosenGameId: null,
});

/* Most cases stub reduced motion, so the beat is the short one and the suite
   does not spend a third of a second per rating. The path is identical —
   voteAdvanceMs is the only thing that branches, and test/vote-advance.test.js
   pins both arms. The double-tap cases deliberately do NOT: their whole point
   is the real 100ms second tap against the real default beat. */

const moods = (dom) => [...dom.app.querySelectorAll('.rating .mood')];
const title = (dom) => dom.app.querySelector('.vote__title').textContent.trim();

// =========================================================== the wizard card

/* `hold` keeps the save in flight, which is the only way to reach the flow's
   one-submission guard: without it finish() resolves in the same turn and the
   tap lock alone would explain every green. */
async function wizard(t, { saved = [], reduced = true, hold = null } = {}) {
  const dom = loadApp();
  t.after(() => dom.close());
  setMotion(dom, reduced);
  dom.set('api', async () => roundFixture());
  await dom.call('startVoting', roundFixture(), sessionFixture(), GAMES, [MEMBER], {
    skipIntro: true,
    saveVotes: async (votes) => {
      saved.push(JSON.parse(JSON.stringify(votes)));
      if (hold) await hold;
    },
    onSaved: async () => {},
  });
  return dom;
}

test('the vote card has no „Weiter" any more — the rating IS the advance', async (t) => {
  const dom = await wizard(t);
  assert.equal(dom.app.querySelector('#nextBtn'), null, 'the confirmation button is back');
  assert.equal(dom.app.querySelector('.vote__nav'), null, 'the nav row is back');
  assert.ok(dom.app.querySelector('#backBtn'), 'the way back must stay — it is the undo');
});

/* The way back is now a bare icon in the card's top-left corner, not a button
   in a row. With „Weiter" gone a lone full-width „Zurück" read as the screen's
   primary action, which is the opposite of what it is.

   Three things are pinned because each fails silently. It must live INSIDE
   `.vote__who` — that is what makes it follow the content column in the ≥860px
   split layout instead of landing on the cover. It must carry an accessible
   name — the glyph is `aria-hidden`, so without one the control announces as
   nothing at all. And the name stays „Zurück" rather than „Rückgängig": on the
   shared-link card's FIRST card this same control goes back to the name picker,
   where „undo" would be a lie. */
test('the way back is an unlabelled corner icon inside the person line', async (t) => {
  const dom = await wizard(t);
  const undo = dom.app.querySelector('#backBtn');

  assert.ok(undo.classList.contains('vote__undo'));
  assert.ok(undo.closest('.vote__who'), 'it must sit in the person line, not loose in the card');
  assert.equal(undo.textContent.trim(), '', 'icon only — no text label');
  assert.ok(undo.querySelector('i.ti.ti-arrow-back-up'), 'the undo glyph is missing');
  assert.equal(undo.querySelector('i').getAttribute('aria-hidden'), 'true');
  assert.equal(undo.getAttribute('aria-label'), dom.run("t('vote.back')"));

  // Nothing to go back to on the first card, and it says so rather than lying.
  assert.equal(undo.disabled, true);
  moods(dom)[3].click();
  await beat(dom);
  assert.equal(dom.app.querySelector('#backBtn').disabled, false);
});

test('the shared-link card wears the same corner control', async (t) => {
  const { dom } = await voteLinkCards(t);
  const undo = dom.app.querySelector('#backBtn');
  assert.ok(undo.classList.contains('vote__undo'));
  // The link page wears the FACE, which is Der Tisch since the flip (#1202):
  // its card carries the control on the felt head rather than in the person line.
  assert.ok(undo.closest('.vote__who, .vote-felt'), 'it must sit in the card head, not loose');
  assert.equal(undo.textContent.trim(), '');
  assert.equal(undo.getAttribute('aria-label'), dom.run("t('vote.back')"));
  // Enabled on card ONE here, unlike the wizard: it goes back to the name
  // picker, which is the one correction this screen has to offer.
  assert.equal(undo.disabled, false);
});

test('one tap rates the game and moves to the next one', async (t) => {
  const dom = await wizard(t);
  assert.equal(title(dom), 'Catan');

  moods(dom)[3].click();
  // Still on the same card for the length of the beat: the outgoing card is
  // what holds the finger away from the next game's faces.
  assert.equal(title(dom), 'Catan', 'the card swapped before the beat was over');
  assert.equal(moods(dom)[3].getAttribute('aria-pressed'), 'true', 'the choice must be visible during the beat');

  await beat(dom);
  assert.equal(title(dom), 'Azul');
});

/* The feature's one hard constraint, at the real default beat — 100ms is the
   issue's own number and only means anything against the 340ms card. */
test('a second tap 100ms after the first does NOT rate the following game', async (t) => {
  const saved = [];
  const dom = await wizard(t, { saved, reduced: false });

  moods(dom)[4].click();              // Catan -> 5
  await new Promise((r) => setTimeout(r, 100));
  moods(dom)[0].click();              // the accidental second tap of a double-tap
  await beat(dom);

  assert.equal(title(dom), 'Azul', 'the double-tap skipped a card');
  // And it did not silently rewrite the first game either.
  moods(dom)[4].click(); await beat(dom);
  moods(dom)[4].click(); await beat(dom);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].m1, { g1: { rating: 5 }, g2: { rating: 5 }, g3: { rating: 5 } });
});

test('the last tap finishes the run', async (t) => {
  const saved = [];
  const dom = await wizard(t, { saved });
  for (let i = 0; i < GAMES.length; i++) {
    moods(dom)[2].click();
    await beat(dom);
  }
  assert.equal(saved.length, 1, 'the last card did not submit');
  assert.deepEqual(Object.keys(saved[0].m1).sort(), ['g1', 'g2', 'g3']);
});

/* The tap lock cannot cover this one: it has expired by the time the save is
   still in flight, and the card is still on screen because the finale only
   renders once the POST resolves. Reaching finish() used to take a deliberate
   „Weiter", so a stray tap could not race it; now the last rating does, and
   the second submission would write the column twice. Measured — with the
   `finishing` flag removed, only this case reddens. */
test('a tap while the save is still in flight does not submit a second time', async (t) => {
  let release;
  const hold = new Promise((r) => { release = r; });
  t.after(() => release());
  const saved = [];
  const dom = await wizard(t, { saved, hold });

  for (let i = 0; i < GAMES.length; i++) {
    moods(dom)[2].click();
    await beat(dom);
  }
  assert.equal(saved.length, 1);
  assert.ok(dom.app.querySelector('.rating'), 'the card should still be up while the save hangs');

  moods(dom)[0].click();        // a stray tap on a card that is already submitting
  await beat(dom);
  assert.equal(saved.length, 1, 'the run submitted twice');
});

test('„Zurück" reopens the previous card with its rating preselected', async (t) => {
  const dom = await wizard(t);
  moods(dom)[3].click();
  await beat(dom);
  assert.equal(title(dom), 'Azul');

  await new Promise((resolve) => {
    dom.window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true });
    dom.app.querySelector('#backBtn').click();
  });

  assert.equal(title(dom), 'Catan');
  assert.equal(moods(dom)[3].getAttribute('aria-pressed'), 'true', 'the earlier choice was lost');
});

test('a card merely revisited does not advance on its own', async (t) => {
  const dom = await wizard(t);
  moods(dom)[3].click();
  await beat(dom);
  await new Promise((resolve) => {
    dom.window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true });
    dom.app.querySelector('#backBtn').click();
  });
  assert.equal(title(dom), 'Catan');

  await beat(dom);
  assert.equal(title(dom), 'Catan', 'arriving on a rated card must not re-trigger its advance');
});

test('changing the rating on a revisited card advances again', async (t) => {
  const saved = [];
  const dom = await wizard(t, { saved });
  moods(dom)[3].click(); await beat(dom);
  await new Promise((resolve) => {
    dom.window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true });
    dom.app.querySelector('#backBtn').click();
  });

  moods(dom)[0].click();               // change of mind on Catan
  await beat(dom);
  assert.equal(title(dom), 'Azul', 'a re-rating must move on the same way a first one does');

  moods(dom)[2].click(); await beat(dom);
  moods(dom)[2].click(); await beat(dom);
  assert.equal(saved[0].m1.g1.rating, 1, 'the changed rating was not the one saved');
});

test('a Back during the beat wins — the pending advance is dropped', async (t) => {
  const dom = await wizard(t);
  moods(dom)[3].click(); await beat(dom);   // now on Azul
  moods(dom)[3].click();                    // …and a beat is running

  await new Promise((resolve) => {
    dom.window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true });
    dom.window.history.back();
  });
  assert.equal(title(dom), 'Catan');

  await beat(dom);
  // Without the cancel, the callback's "one step forward from where I was"
  // fires here and pushes the user off the card they navigated to.
  assert.equal(title(dom), 'Catan', 'the cancelled advance still fired');
});

/* The other way out, and the one no popstate covers: the brand mark leaves
   through confirmLeave() directly. Without the cancel in guardLeave the pending
   beat fires on a torn-down wizard and renders a vote card over whatever screen
   the user actually went to — votes and all, on a flow that has ended. */
test('leaving the wizard mid-beat renders nothing over the screen you left for', async (t) => {
  const dom = await wizard(t);
  dom.run('window.confirm = () => true;');   // jsdom has none, and there are unsaved votes

  moods(dom)[3].click();                     // a beat is now running
  assert.equal(dom.run('confirmLeave()'), true, 'the leave guard refused to let go');
  dom.app.innerHTML = '<div id="elsewhere"></div>';   // stand in for wherever we went

  await beat(dom);
  assert.ok(dom.document.getElementById('elsewhere'),
    'the abandoned beat rendered a vote card over the new screen');
  assert.equal(dom.app.querySelector('.vote'), null);
});

// ------------------------------------------------------------- what a reader gets

test('each delivered card is announced and takes focus on its heading', async (t) => {
  const dom = await wizard(t);
  const live = dom.document.getElementById('srLive');
  assert.ok(live, 'the silent live region is missing from index.html');
  assert.equal(live.textContent, '', 'the region must start empty or it is never announced');

  moods(dom)[3].click();
  await beat(dom);

  assert.equal(live.textContent, dom.run("t('vote.advanced', { n: 2, total: 3, title: 'Azul' })"));
  assert.equal(dom.document.activeElement, dom.app.querySelector('.vote__title'),
    'a delivered card must put focus at its top, not leave it on <body>');
});

test('a Back announces nothing and moves no focus', async (t) => {
  const dom = await wizard(t);
  const live = dom.document.getElementById('srLive');
  moods(dom)[3].click();
  await beat(dom);
  live.textContent = '';

  await new Promise((resolve) => {
    dom.window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true });
    dom.app.querySelector('#backBtn').click();
  });

  assert.equal(live.textContent, '');
  assert.ok(!moods(dom).includes(dom.document.activeElement));
  assert.notEqual(dom.document.activeElement, dom.app.querySelector('.vote__title'),
    'arriving through a Back must leave focus alone');
});

// ======================================================== the shared-link card

function voteLinkBoot(t, { reduced = true, hold = null } = {}) {
  const dom = loadApp();
  t.after(() => dom.close());
  setMotion(dom, reduced);
  const calls = [];
  const ballot = {
    round: { name: 'Freitagsrunde', background: null },
    games: GAMES,
    people: [{ id: 'm1', name: 'Anna', hasVoted: false }, { id: 'm2', name: 'Bo', hasVoted: false }],
    open: true,
  };
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (hold && method === 'POST') await hold;
    return ballot;
  });
  return { dom, calls };
}

async function voteLinkCards(t, opts = {}) {
  const { dom, calls } = voteLinkBoot(t, opts);
  await dom.call('showVoteLink', 'tok-1');
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click();
  await flush();
  return { dom, calls };
}

test('the shared-link card advances on the tap too, and drops its „Weiter"', async (t) => {
  const { dom } = await voteLinkCards(t);
  assert.equal(dom.app.querySelector('#nextBtn'), null);
  assert.equal(title(dom), 'Catan');

  moods(dom)[3].click();
  assert.equal(title(dom), 'Catan', 'it swapped before the beat was over');
  await beat(dom);
  assert.equal(title(dom), 'Azul');
  assert.equal(dom.document.activeElement, dom.app.querySelector('.vote__title'));
  assert.equal(dom.document.getElementById('srLive').textContent,
    dom.run("t('vote.advanced', { n: 2, total: 3, title: 'Azul' })"));
});

test('a double-tap on the shared-link card does not rate the following game', async (t) => {
  const { dom, calls } = await voteLinkCards(t, { reduced: false });
  moods(dom)[4].click();
  await new Promise((r) => setTimeout(r, 100));
  moods(dom)[0].click();
  await beat(dom);
  assert.equal(title(dom), 'Azul');

  moods(dom)[4].click(); await beat(dom);
  moods(dom)[4].click(); await beat(dom);
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'the ratings were never submitted');
  assert.deepEqual({ ...post.body.votes.g1 }, { rating: 5 });
});

test('the shared-link card submits exactly once, even mid-flight', async (t) => {
  let release;
  const hold = new Promise((r) => { release = r; });
  t.after(() => release());
  const { dom, calls } = await voteLinkCards(t, { hold });
  const posts = () => calls.filter((c) => c.method === 'POST').length;

  for (let i = 0; i < GAMES.length; i++) {
    moods(dom)[2].click();
    await beat(dom);
  }
  assert.equal(posts(), 1);

  // Same window as the wizard's: the lock has expired, the POST has not
  // resolved, and the card is still on screen.
  moods(dom)[0].click();
  await beat(dom);
  assert.equal(posts(), 1, 'the link voter submitted twice');
});

test('„Zurück" on the shared-link card reopens the previous game', async (t) => {
  const { dom } = await voteLinkCards(t);
  moods(dom)[3].click();
  await beat(dom);
  dom.app.querySelector('#backBtn').click();
  assert.equal(title(dom), 'Catan');
  assert.equal(moods(dom)[3].getAttribute('aria-pressed'), 'true');
});

/* The lock outliving the swap is the fix for the reduced-motion hole above, and
   nothing else in this file would notice if it were undone: every other case
   waits past the guard before tapping again. */
test('the delivered card is still tap-locked for a moment after the swap', async (t) => {
  const dom = await wizard(t);
  moods(dom)[3].click();
  await swap(dom);
  assert.equal(title(dom), 'Azul', 'the beat should already have delivered the card');

  moods(dom)[0].click();               // a double-tap's second tap, landing late
  await beat(dom);
  assert.equal(title(dom), 'Azul', 'a tap inside the guard window rated the card anyway');
  assert.ok(moods(dom).every((b) => b.getAttribute('aria-pressed') === 'false'),
    'the late tap left a rating behind');
});

test('„Zurück" is ignored while a beat is running, on both cards', async (t) => {
  const { dom } = await voteLinkCards(t);
  moods(dom)[3].click();            // beat running, still on Catan
  dom.app.querySelector('#backBtn').click();
  // Without the guard this drops back to the name picker mid-advance, and the
  // pending callback then renders a card over it.
  assert.equal(title(dom), 'Catan', 'Zurück raced the beat');
  await beat(dom);
  assert.equal(title(dom), 'Azul');
});
