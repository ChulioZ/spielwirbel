'use strict';

/*
 * The public /vote/:token screen (#652), RUN through the jsdom harness rather
 * than matched over its source (.claude/rules/testing-views-under-jsdom.md).
 *
 * What is worth pinning here is what the ROUTE tests cannot see: that a link
 * holder is offered exactly the names on the ballot, that a guest gets the same
 * card a member does (#909 removed the last per-role difference), that an
 * already-voted name is confirmed before it is replaced, and that an unusable
 * link renders the one honest dead state instead of a blank screen — the failure
 * mode a page reached from a chat link can least afford.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { setMotion, beat } = require('./support/vote-card');

const BALLOT = {
  roundName: 'Freitagsrunde',
  demo: false,
  games: [
    { id: 'g1', title: 'Catan', image: null },
    { id: 'g2', title: 'Azul', image: null },
  ],
  people: [
    { id: 'm1', name: 'Anna', guest: false, color: '#7f77dd', hasVoted: false, linked: false },
    { id: 'm2', name: 'Ben', guest: false, color: '#2f6f4f', hasVoted: true, linked: true },
    { id: 'gu1', name: 'Dana', guest: true, color: null, hasVoted: false, linked: false },
  ],
};

const clone = (v) => JSON.parse(JSON.stringify(v));

// A harness with the ballot stubbed. `calls` records what the screen sent, which
// is how the submit assertions read the payload without a server.
function boot(t, { ballot = BALLOT, fail = false } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (fail) throw new Error('invalid_link');
    if (method === 'GET') return clone(ballot);
    return { ok: true };
  });
  // The screen calls these for chrome it does not otherwise depend on.
  dom.set('toast', () => {});
  return { dom, calls };
}

test('the claim list offers every participant, marking who has already voted', async (t) => {
  const { dom } = boot(t);
  await dom.call('showVoteLink', 'tok-1');

  const buttons = [...dom.app.querySelectorAll('.live-vote__hotseat-btn')];
  assert.equal(buttons.length, 3);
  const text = buttons.map((b) => b.textContent.replace(/\s+/g, ' ').trim());
  assert.match(text[0], /Anna/);
  assert.match(text[1], /Ben/);
  // The guest keeps the app's own marker — personLabel(), not a second resolver.
  assert.match(text[2], /Dana \(Gast\)/);

  // Ben has voted; the other two have not. Asserted per row rather than as a
  // count, so a badge rendered on every row would fail rather than pass.
  assert.equal(/abgestimmt/.test(text[0]), false);
  assert.equal(/abgestimmt/.test(text[1]), true);
  assert.equal(/abgestimmt/.test(text[2]), false);

  // The round name is the one piece of context the screen shows.
  assert.match(dom.app.textContent, /Freitagsrunde/);
});

test('picking a name opens the cards; a member and a guest get the same scale', async (t) => {
  const { dom } = boot(t);
  await dom.call('showVoteLink', 'tok-2');

  // Anna (a member) — five tiles, 1-5. Between #797 and #909 she had a sixth,
  // the retirement proposal, which a guest did not; that difference is gone.
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click();
  assert.equal(dom.app.querySelectorAll('.mood').length, 5, 'the 1-5 scale');
  assert.match(dom.app.querySelector('.vote__title').textContent, /Catan/);
  assert.equal(dom.app.querySelector('.mood--retire'), null, 'no trash tile for anybody');
  assert.equal(dom.app.querySelector('.sortBtn'), null, 'no separate retire control either');
  const memberLabels = [...dom.app.querySelectorAll('.mood')].map((b) => b.getAttribute('aria-label'));

  // Dana (a guest) — back to the claim list first.
  dom.app.querySelector('#backBtn').click();
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[2].click();
  assert.deepEqual(
    [...dom.app.querySelectorAll('.mood')].map((b) => b.getAttribute('aria-label')), memberLabels,
    'a guest card must be indistinguishable from a member one (#909)'
  );
});

/* Until #1168 this asserted the „needRating" toast: a card could be left with
   nothing on the scale and „Weiter" pressed, so there was a state to guard
   against. There is no longer one — the rating IS the advance, so an unrated
   card has no way past it at all, and the guard and its nine translations went
   with the button. What is left to pin is that nothing else advances the card. */
test('only a rating advances the card — there is no way past an unrated one', async (t) => {
  const { dom } = boot(t);
  setMotion(dom, true);
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));
  await dom.call('showVoteLink', 'tok-3');
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click();

  assert.equal(dom.app.querySelector('#nextBtn'), null, 'the confirmation button is back');
  await beat(dom);
  assert.match(dom.app.querySelector('.vote__title').textContent, /Catan/,
    'an untouched card advanced on its own');
  assert.equal(toasts.length, 0);

  // One tap, and it moves on.
  dom.app.querySelectorAll('.mood')[3].click();
  await beat(dom);
  assert.match(dom.app.querySelector('.vote__title').textContent, /Azul/);
});

test('submitting sends only the claimed person\'s ratings, then shows the thank-you', async (t) => {
  const { dom, calls } = boot(t);
  setMotion(dom, true);
  await dom.call('showVoteLink', 'tok-4');
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click(); // Anna

  // Catan -> 5, then a change of mind onto the 1: one tile wins, and the
  // payload carries the rating alone with no `retire` key beside it (#909).
  // Since #1168 a change of mind goes through „Zurück" rather than a second tap
  // on the same card — the first tap has already advanced, and the second one
  // inside the beat is exactly what the double-tap guard exists to swallow.
  dom.app.querySelectorAll('.mood')[4].click();
  await beat(dom);
  dom.app.querySelector('#backBtn').click();
  dom.app.querySelectorAll('.mood')[0].click();
  await beat(dom);
  dom.app.querySelectorAll('.mood')[0].click(); // Azul -> 1, and that finishes
  await beat(dom);

  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'the votes were never submitted');
  assert.equal(post.url, '/api/vote/tok-4/votes/m1');
  // Round-tripped through JSON: the payload was built inside the vm context, so
  // its prototype is that realm's and deepEqual fails on the prototype alone —
  // a false red reading "same structure but not reference-equal"
  // (.claude/rules/scroll-reset-on-forward-navigation.md notes the same trap).
  assert.deepEqual(JSON.parse(JSON.stringify(post.body)), {
    votes: { g1: { rating: 1 }, g2: { rating: 1 } },
  });
  // Nobody else's column rides along — the payload is one person's, by shape.
  assert.deepEqual(Object.keys(post.body.votes).sort(), ['g1', 'g2']);

  assert.match(dom.app.textContent, /Danke/);
  // And the results are NOT shown: the reveal belongs to the group at the table.
  assert.equal(/Catan/.test(dom.app.textContent), false);
});

test('replacing someone else\'s vote is confirmed first; your own is not', async (t) => {
  const { dom } = boot(t);
  const asked = [];
  dom.set('confirmDialog', (o) => { asked.push(o.body); return Promise.resolve(false); });
  await dom.call('showVoteLink', 'tok-5');

  // Ben has voted and this device never claimed him -> a mis-tap is the likeliest
  // reason, so it asks. Declining leaves the claim list up.
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[1].click();
  await flush();
  assert.equal(asked.length, 1);
  assert.match(asked[0], /Ben/);
  assert.ok(dom.app.querySelector('#vlClaim'), 'declining must not open the cards');

  // Anna has NOT voted, so picking her asks nothing.
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click();
  await flush();
  assert.equal(asked.length, 1);
  assert.equal(dom.app.querySelectorAll('.mood').length, 5);
});

test('a device that already claimed a name revises without being re-asked', async (t) => {
  const { dom } = boot(t, {
    ballot: { ...BALLOT, people: BALLOT.people.map((p) => ({ ...p, hasVoted: p.id === 'm1' })) },
  });
  const asked = [];
  dom.set('confirmDialog', (o) => { asked.push(o.body); return Promise.resolve(false); });

  // Anna voted from THIS device — the claim is remembered, so reopening the link
  // and tapping her own name goes straight back into the cards. Without this,
  // revising your own ratings (the reason the claim is stored at all) would ask
  // you to confirm overwriting yourself.
  dom.run("localStorage.setItem('spielwirbel.voteClaim.tok-6', 'm1')");
  await dom.call('showVoteLink', 'tok-6');
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click();
  await flush();
  assert.deepEqual(asked, []);
  assert.equal(dom.app.querySelectorAll('.mood').length, 5);
});

test('an unusable link renders the dead state, never a blank screen', async (t) => {
  const { dom } = boot(t, { fail: true });
  await dom.call('showVoteLink', 'tok-dead');

  // The screen a mistyped link, a closed session and a deleted round all reach —
  // the server answers all three identically on purpose, so this must not guess
  // at a cause either.
  assert.match(dom.app.textContent, /Link führt ins Leere/);
  assert.ok(dom.app.textContent.trim().length > 20, 'a blank page is the failure this guards');
  assert.equal(/abgelaufen|expired/i.test(dom.app.textContent), false, 'must not diagnose');
  assert.equal(dom.app.querySelectorAll('.mood').length, 0);
});

/* ------------ The one-off sentence naming the app (#1169) ------------------ */

/* This is the app's single point of contact with people who never chose it —
   four to six phones per played evening — so the gates below are the feature.
   Each test drives the real flow to the done step rather than calling
   `renderVoteLinkDone` directly: the conditions read the ballot and the person
   the CARDS handed on, and a direct call would let a wrong hand-off pass. */

// Vote through both games as `who`, landing on the done step.
async function voteThrough(dom, token, who) {
  setMotion(dom, true);
  await dom.call('showVoteLink', token);
  [...dom.app.querySelectorAll('.live-vote__hotseat-btn')]
    .find((b) => b.textContent.includes(who)).click();
  await flush();
  dom.app.querySelectorAll('.mood')[3].click();
  await beat(dom);
  dom.app.querySelectorAll('.mood')[3].click();
  await beat(dom);
}

const noteOf = (dom) => dom.app.querySelector('.vote-link__note');

test('an unlinked seat is told what the app was — once, with one plain link to /', async (t) => {
  const { dom } = boot(t);
  await voteThrough(dom, 'tok-note', 'Anna');

  assert.match(dom.app.textContent, /Danke/, 'never reached the done step');
  const note = noteOf(dom);
  assert.ok(note, 'the one surface that reaches a non-user showed nothing');
  assert.match(note.textContent, /Spielwirbel/);

  // One link, to the landing page, with nothing appended. A tracking parameter
  // here would be a third-party-free page acquiring an identifier, and a
  // `navLink` would route in-app — this visitor has no app to route inside.
  const links = note.querySelectorAll('a');
  assert.equal(links.length, 1, 'a sentence with one offer, not a card of them');
  assert.equal(links[0].getAttribute('href'), '/');

  // A sentence, not an install offer: no button and no dismiss control.
  assert.equal(note.querySelector('button'), null);
});

test('the same device is not told twice — the flag survives a revise', async (t) => {
  const { dom } = boot(t);
  await voteThrough(dom, 'tok-once', 'Anna');
  assert.ok(noteOf(dom), 'the first pass must show it, or the second proves nothing');

  // „Stimme ändern" re-runs the whole screen, which is the realistic way a
  // device reaches the done step a second time.
  dom.app.querySelector('#vlAgain').click();
  await flush();
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click();
  await flush();
  dom.app.querySelectorAll('.mood')[2].click();
  await beat(dom);
  dom.app.querySelectorAll('.mood')[2].click();
  await beat(dom);

  assert.match(dom.app.textContent, /Danke/);
  assert.equal(noteOf(dom), null, 'the second pass nagged');
});

test('a seat that belongs to an ACCOUNT is never told — they already have the app', async (t) => {
  // Ben is the linked seat. He has voted, so the claim asks before replacing —
  // accept, otherwise the cards never open and the test passes vacuously.
  const { dom } = boot(t);
  dom.set('confirmDialog', () => Promise.resolve(true));
  await voteThrough(dom, 'tok-linked', 'Ben');

  assert.match(dom.app.textContent, /Danke/, 'never reached the done step');
  assert.equal(noteOf(dom), null);
});

test('a demo round never pitches — its data is about to evaporate', async (t) => {
  const { dom } = boot(t, { ballot: { ...BALLOT, demo: true } });
  await voteThrough(dom, 'tok-demo', 'Anna');

  assert.match(dom.app.textContent, /Danke/, 'never reached the done step');
  assert.equal(noteOf(dom), null);
});

/* The scope half of the rule, which no rendering can assert: the note must
   appear on THIS screen and nowhere else — not on the hot-seat wizard, not on
   a linked member's own-device view, not in the lobby or the results.

   A lexical scan, so mind what it can and cannot see
   (.claude/rules/source-scanning-guards-enumerate-shapes.md): it proves no other
   frontend file NAMES the key, which is how a copy-paste into the wizard would
   arrive. It cannot prove the sentence is absent from a screen that reached it
   some other way, and the per-render assertions above are what cover that. */
test('the note\'s keys exist in exactly one view file', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'public', 'js');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 30, 'the scan found no view files — it is measuring nothing');

  for (const key of ['voteLink.appNote', 'voteLink.appNoteCta']) {
    const holders = files.filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(key));
    assert.deepEqual(holders, ['views-vote-link.js'], `${key} is named outside its one screen`);
  }
});
