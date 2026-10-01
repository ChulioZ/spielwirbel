'use strict';

/* The review step after a voter's last card (#1434).

   #1168 made the rating tap the advance, which removed the „Weiter" that used to
   stand between the last rating and the submission — so the one moment someone
   might want to reconsider, with every candidate now seen, had no pause at all.
   The last card's beat now delivers a review step: every game with its rating,
   each row a button back to its card, and one „Absenden".

   What this spec pins is the part that is easy to get wrong rather than easy to
   see: the #1168 safety properties must hold ON the review step too — one
   submission per run, no double-tap reaching „Absenden", the leave guard still
   protecting unsaved votes — and a jump back from the review must return to it
   rather than walking the voter through every later card again.

   Both surfaces run through the real views (`.claude/rules/testing-views-under-jsdom.md`).
   The own-device lobby reuses `startVoting`, so the wizard cases cover it too. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { setMotion, beat } = require('./support/vote-card');

const ANNA = { id: 'm1', name: 'Anna', color: '#7f77dd' };
const BEN = { id: 'm2', name: 'Ben', color: '#1d9e75' };

const GAMES = [
  { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4 },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
  { id: 'g3', title: 'Dorfromantik', minPlayers: 1, maxPlayers: 6 },
];

const roundFixture = () => ({
  id: 'r1', name: 'Freitagsrunde', background: null,
  members: [ANNA, BEN], games: [], sessions: [], tags: [],
});

const sessionFixture = () => ({
  id: 's1', createdAt: '2026-09-30T18:00:00.000Z',
  gameIds: GAMES.map((g) => g.id), memberIds: ['m1', 'm2'], guests: [],
  votes: {}, votedIds: [], done: false, cancelled: false,
  finished: false, winnerIds: [], chosenGameId: null,
});

const moods = (dom) => [...dom.app.querySelectorAll('.rating .mood')];
const title = (dom) => dom.app.querySelector('.vote__title').textContent.trim();
const review = (dom) => dom.app.querySelector('.vote-review');
const rows = (dom) => [...dom.app.querySelectorAll('.vote-review__row')];
const send = (dom) => dom.app.querySelector('.vote-review__send');

async function popBack(dom, click) {
  await new Promise((resolve) => {
    dom.window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true });
    click();
  });
}

async function wizard(t, { saved = [], hold = null, design = null, people = [ANNA], skipIntro = true, reduced = true } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, reduced);
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async () => roundFixture());
  await dom.call('startVoting', roundFixture(), sessionFixture(), GAMES, people, {
    skipIntro,
    saveVotes: async (votes) => {
      saved.push(JSON.parse(JSON.stringify(votes)));
      if (hold) await hold;
    },
    onSaved: async () => {},
  });
  return dom;
}

// Rate every card with the given faces (1-based ratings), one beat each.
async function rateAll(dom, ratings) {
  for (const n of ratings) {
    moods(dom)[n - 1].click();
    await beat(dom);
  }
}

// =========================================================== the wizard

test('the last rating delivers the review step, not the submission', async (t) => {
  const saved = [];
  const dom = await wizard(t, { saved });
  await rateAll(dom, [4, 2, 5]);

  assert.equal(saved.length, 0, 'the last tap still submitted on its own');
  assert.ok(review(dom), 'no review step after the last card');
  assert.equal(dom.app.querySelector('.rating'), null, 'a rating scale is still on screen');

  // One row per game, in draw order, each a real button showing its rating.
  const list = rows(dom);
  assert.equal(list.length, 3);
  assert.ok(list.every((b) => b.tagName === 'BUTTON' && b.type === 'button'));
  assert.deepEqual(list.map((b) => b.querySelector('.vote-review__game').textContent.trim()),
    ['Catan', 'Azul', 'Dorfromantik']);
  assert.deepEqual(list.map((b) => b.querySelector('.vote-review__n').textContent.trim()), ['4', '2', '5']);
  // The name leads with the game and carries the rating, so a reader hears
  // what the row is and what pressing it does.
  assert.equal(list[0].getAttribute('aria-label'),
    dom.run("t('vote.reviewRow', { title: 'Catan', rating: t('vote.ratingLabel', { n: 4, max: 5 }) })"));

  // Focus moves to the step's heading (the issue's accessibility note).
  const heading = dom.app.querySelector('.vote-review__title');
  assert.equal(heading.tagName, 'H1');
  assert.equal(dom.document.activeElement, heading);
  assert.equal(send(dom).textContent.trim(), dom.run("t('vote.reviewSend')"));
});

test('„Absenden" submits the column exactly once', async (t) => {
  const saved = [];
  const dom = await wizard(t, { saved });
  await rateAll(dom, [4, 2, 5]);
  send(dom).click();
  await flush();
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].m1, { g1: { rating: 4 }, g2: { rating: 2 }, g3: { rating: 5 } });
});

/* The window the `finishing` flag exists for: the save is still in flight, the
   review is still on screen, and a second press must not write the column
   again. `hold` keeps the save pending so the flag is actually reachable. */
test('a second „Absenden" while the save is in flight does not submit twice', async (t) => {
  let release;
  const hold = new Promise((r) => { release = r; });
  t.after(() => release());
  const saved = [];
  const dom = await wizard(t, { saved, hold });
  await rateAll(dom, [3, 3, 3]);

  send(dom).click();
  await flush();
  assert.equal(saved.length, 1);
  assert.ok(review(dom), 'the review should still be up while the save hangs');
  send(dom).click();
  await flush();
  assert.equal(saved.length, 1, 'the run submitted twice');
});

/* The double-tap that #1168's tap lock exists for, one screen further on: the
   second tap of a double-tap on the LAST card's face must not land on
   „Absenden" of the review the beat just delivered. Under reduced motion the
   beat is shorter than the lock, so the review is on screen while taps are
   still locked — exactly the window this asserts. */
test('a tap on „Absenden" inside the tap lock is ignored', async (t) => {
  const saved = [];
  const dom = await wizard(t, { saved });
  await rateAll(dom, [3, 3]);
  moods(dom)[2].click();
  await new Promise((r) => setTimeout(r, dom.run('voteAdvanceMs()') + 30));
  assert.ok(review(dom), 'the beat should already have delivered the review');
  send(dom).click();
  await flush();
  assert.equal(saved.length, 0, 'a double-tap reached „Absenden"');
});

test('a jump back from the review and a re-rate submits the new value exactly once', async (t) => {
  const saved = [];
  const dom = await wizard(t, { saved });
  await rateAll(dom, [4, 2, 5]);

  rows(dom)[0].click();                       // back to Catan
  await flush();
  assert.equal(title(dom), 'Catan');
  assert.equal(moods(dom)[3].getAttribute('aria-pressed'), 'true', 'the earlier rating is not preselected');

  // The re-rate returns straight to the review — not through Azul and
  // Dorfromantik again, which is the whole point of reviewing.
  moods(dom)[0].click();
  await beat(dom);
  await flush();
  assert.ok(review(dom), 'the re-rate did not return to the review');
  assert.equal(rows(dom)[0].querySelector('.vote-review__n').textContent.trim(), '1');
  assert.equal(saved.length, 0);

  send(dom).click();
  await flush();
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].m1, { g1: { rating: 1 }, g2: { rating: 2 }, g3: { rating: 5 } });
});

test('Browser Back from the review goes to the last card, even after a jump', async (t) => {
  const dom = await wizard(t);
  await rateAll(dom, [4, 2, 5]);

  await popBack(dom, () => dom.window.history.back());
  assert.equal(title(dom), 'Dorfromantik', 'Back from the review left the flow');
  assert.equal(moods(dom)[4].getAttribute('aria-pressed'), 'true');

  // Forward onto the review again, jump, re-rate: the jump must not leave an
  // extra history entry behind the review.
  moods(dom)[4].click();
  await beat(dom);
  rows(dom)[1].click();
  await flush();
  moods(dom)[2].click();
  await beat(dom);
  await flush();
  assert.ok(review(dom));
  await popBack(dom, () => dom.window.history.back());
  assert.equal(title(dom), 'Dorfromantik', 'Back from the review went to the jumped-to card');
});

/* Once the review has been seen, re-rating ANY card returns to it — not only
   one reached by a row tap. Walking back two cards and changing a mind must not
   then walk the voter forward through Dorfromantik again. */
test('after the review, a card reached by Back also returns to the review', async (t) => {
  const saved = [];
  const dom = await wizard(t, { saved });
  await rateAll(dom, [4, 2, 5]);
  await popBack(dom, () => dom.window.history.back());
  await popBack(dom, () => dom.window.history.back());
  assert.equal(title(dom), 'Azul');

  moods(dom)[0].click();
  await beat(dom);
  assert.ok(review(dom), 'the re-rate walked on to the next card instead of the review');
  send(dom).click();
  await flush();
  assert.deepEqual(saved[0].m1, { g1: { rating: 4 }, g2: { rating: 1 }, g3: { rating: 5 } });
});

test('the in-card way back on the review returns to the last card', async (t) => {
  const dom = await wizard(t);
  await rateAll(dom, [4, 2, 5]);
  await popBack(dom, () => dom.app.querySelector('#backBtn').click());
  assert.equal(title(dom), 'Dorfromantik');
});

test('the leave guard still protects the votes while the review is up', async (t) => {
  const saved = [];
  const dom = await wizard(t, { saved });
  await rateAll(dom, [4, 2, 5]);
  dom.run('window.__asked = 0; window.confirm = () => { window.__asked += 1; return false; };');
  assert.equal(dom.run('confirmLeave()'), false, 'leaving the review discarded unsaved votes silently');
  assert.equal(dom.run('window.__asked'), 1);
  assert.ok(review(dom));
});

test('on a shared device the review comes before the next person’s handover', async (t) => {
  const saved = [];
  const dom = await wizard(t, { saved, people: [ANNA, BEN], skipIntro: false });
  dom.app.querySelector('#goBtn').click();
  await rateAll(dom, [4, 2, 5]);
  assert.ok(review(dom), 'no review at the end of the first person’s column');
  send(dom).click();
  await flush();
  assert.ok(dom.app.querySelector('.handover, .ocean-blind, #goBtn'), 'the next person’s handover did not follow');
  assert.equal(saved.length, 0, 'the first person’s review submitted the whole table');
});

test('every design renders the review, composed designs in their own card', async (t) => {
  for (const design of ['klassisch', 'tisch', 'ocean', 'bruecke', 'programmheft']) {
    const dom = await wizard(t, { design });
    await rateAll(dom, [4, 2, 5]);
    const root = review(dom);
    assert.ok(root, `${design}: no review`);
    assert.equal(rows(dom).length, 3, `${design}: rows missing`);
    assert.ok(send(dom), `${design}: no send`);
    const composed = ['tisch', 'ocean', 'bruecke'].includes(design);
    assert.equal(root.classList.contains('vote--composed'), composed, `${design}: wrong composition`);
    if (composed) assert.ok(root.querySelector('.vote-felt .vote__undo'), `${design}: no way back on the felt`);
    else assert.ok(root.querySelector('.vote__who .vote__undo'), `${design}: no way back in the person line`);
    if (design === 'ocean') assert.ok(root.classList.contains('vote--ocean'));
    if (design === 'bruecke') assert.ok(root.classList.contains('vote--bruecke'));
  }
});

// ======================================================== the shared-link card

function voteLinkBoot(t, { hold = null } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  const calls = [];
  const ballot = {
    roundName: 'Freitagsrunde',
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

async function voteLinkCards(t, opts) {
  const { dom, calls } = voteLinkBoot(t, opts);
  await dom.call('showVoteLink', 'tok-1');
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click();
  await flush();
  return { dom, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}

test('the shared-link card reviews before it sends, and sends once', async (t) => {
  let release;
  const hold = new Promise((r) => { release = r; });
  t.after(() => release());
  const { dom, posts } = await voteLinkCards(t, { hold });
  await rateAll(dom, [4, 2, 5]);

  assert.equal(posts().length, 0, 'the last tap still submitted on its own');
  assert.ok(review(dom));
  assert.equal(dom.document.activeElement, dom.app.querySelector('.vote-review__title'));

  send(dom).click();
  await flush();
  send(dom).click();
  await flush();
  assert.equal(posts().length, 1, 'the link voter submitted twice');
});

test('the shared-link review jumps back, re-rates and sends the new value', async (t) => {
  const { dom, posts } = await voteLinkCards(t);
  await rateAll(dom, [4, 2, 5]);

  rows(dom)[1].click();
  assert.equal(title(dom), 'Azul');
  moods(dom)[4].click();
  await beat(dom);
  assert.ok(review(dom), 'the re-rate did not return to the review');

  send(dom).click();
  await flush();
  assert.equal(posts().length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(posts()[0].body.votes)),
    { g1: { rating: 4 }, g2: { rating: 5 }, g3: { rating: 5 } });
});

test('„Zurück" on the shared-link review reopens the last card', async (t) => {
  const { dom } = await voteLinkCards(t);
  await rateAll(dom, [4, 2, 5]);
  dom.app.querySelector('#backBtn').click();
  assert.equal(title(dom), 'Dorfromantik');
  assert.equal(moods(dom)[4].getAttribute('aria-pressed'), 'true');
});

test('a tap on the shared-link „Absenden" inside the tap lock is ignored', async (t) => {
  const { dom, posts } = await voteLinkCards(t);
  await rateAll(dom, [3, 3]);
  moods(dom)[2].click();
  await new Promise((r) => setTimeout(r, dom.run('voteAdvanceMs()') + 30));
  assert.ok(review(dom), 'the beat should already have delivered the review');
  send(dom).click();
  await flush();
  assert.equal(posts().length, 0, 'a double-tap reached „Absenden"');
});

// „Absenden" must stay on screen however long the list is: measured at 390×844,
// 6+ games pushed it below the fold in every design. It sticks to the bottom
// edge, and the card it lives in must not be a scroll container — `.vote`'s
// `overflow: hidden` silently made it one, and the button never stuck.
test('the review\'s send button sticks to the bottom edge, inside a card that is not a scroll container', () => {
  const { bodyOf } = require('./support/css');
  const send = bodyOf('.vote-review__send') || '';
  assert.match(send, /position:\s*sticky/);
  assert.match(send, /bottom:\s*calc\(12px \+ env\(safe-area-inset-bottom/);
  assert.match(bodyOf('.vote.vote-review') || '', /overflow:\s*clip/);
});
