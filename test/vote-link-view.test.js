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
const { loadApp } = require('./support/dom');

const BALLOT = {
  roundName: 'Freitagsrunde',
  games: [
    { id: 'g1', title: 'Catan', image: null },
    { id: 'g2', title: 'Azul', image: null },
  ],
  people: [
    { id: 'm1', name: 'Anna', guest: false, color: '#7f77dd', hasVoted: false },
    { id: 'm2', name: 'Ben', guest: false, color: '#2f6f4f', hasVoted: true },
    { id: 'gu1', name: 'Dana', guest: true, color: null, hasVoted: false },
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

test('a rating must be given before the cards advance', async (t) => {
  const { dom } = boot(t);
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));
  await dom.call('showVoteLink', 'tok-3');
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click();

  // Next with nothing chosen stays on the first card and says why.
  dom.app.querySelector('#nextBtn').click();
  assert.equal(toasts.length, 1);
  assert.match(dom.app.querySelector('.vote__title').textContent, /Catan/);

  // With a rating it moves on.
  dom.app.querySelectorAll('.mood')[3].click();
  dom.app.querySelector('#nextBtn').click();
  assert.match(dom.app.querySelector('.vote__title').textContent, /Azul/);
});

test('submitting sends only the claimed person\'s ratings, then shows the thank-you', async (t) => {
  const { dom, calls } = boot(t);
  await dom.call('showVoteLink', 'tok-4');
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click(); // Anna

  // Catan -> 5, then a change of mind onto the 1: one tile wins, and the
  // payload carries the rating alone with no `retire` key beside it (#909).
  dom.app.querySelectorAll('.mood')[4].click();
  dom.app.querySelectorAll('.mood')[0].click();
  dom.app.querySelector('#nextBtn').click();
  dom.app.querySelectorAll('.mood')[0].click(); // Azul -> 1
  dom.app.querySelector('#nextBtn').click(); // finish

  await new Promise((r) => setTimeout(r, 0));

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
  dom.set('confirm', (msg) => { asked.push(msg); return false; });
  await dom.call('showVoteLink', 'tok-5');

  // Ben has voted and this device never claimed him -> a mis-tap is the likeliest
  // reason, so it asks. Declining leaves the claim list up.
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[1].click();
  assert.equal(asked.length, 1);
  assert.match(asked[0], /Ben/);
  assert.ok(dom.app.querySelector('#vlClaim'), 'declining must not open the cards');

  // Anna has NOT voted, so picking her asks nothing.
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click();
  assert.equal(asked.length, 1);
  assert.equal(dom.app.querySelectorAll('.mood').length, 5);
});

test('a device that already claimed a name revises without being re-asked', async (t) => {
  const { dom } = boot(t, {
    ballot: { ...BALLOT, people: BALLOT.people.map((p) => ({ ...p, hasVoted: p.id === 'm1' })) },
  });
  const asked = [];
  dom.set('confirm', (msg) => { asked.push(msg); return false; });

  // Anna voted from THIS device — the claim is remembered, so reopening the link
  // and tapping her own name goes straight back into the cards. Without this,
  // revising your own ratings (the reason the claim is stored at all) would ask
  // you to confirm overwriting yourself.
  dom.run("localStorage.setItem('spielwirbel.voteClaim.tok-6', 'm1')");
  await dom.call('showVoteLink', 'tok-6');
  dom.app.querySelectorAll('.live-vote__hotseat-btn')[0].click();
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
