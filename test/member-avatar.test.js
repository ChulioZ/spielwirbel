'use strict';

/*
 * The one decision of photo-vs-initials (#841), and the per-page cache behind
 * it. The render sites are DOM views; everything worth asserting is pure and
 * lives here (.claude/rules/frontend-helper-modules-and-coverage.md).
 *
 * The cache is module-level state shared by every test in this file, so each
 * one resets it first — except the very first, which must NOT, because a cache
 * that starts non-empty is exactly the bug a test calling the setter first can
 * never see (.claude/rules/break-the-code-on-purpose.md, "a test that SETS the
 * state it asserts").
 */

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const {
  avatarFace, primeAvatars, rememberAvatar, knownAvatar,
  installAvatarFallback, resetAvatarCache, AVATAR_PRIME_TIMEOUT_MS,
} = require('../public/js/member-avatar');

// MUST be first in the file, and must not prime, remember or reset anything.
test('an id nobody has resolved is UNKNOWN, not "has no picture"', () => {
  assert.equal(knownAvatar('never-seen'), undefined);
  // The distinction is load-bearing: `undefined` means "ask the server",
  // `null` means "asked, and there is none". Collapsing them would make every
  // pictureless account re-requested on every single render.
  assert.equal(avatarFace('AB', { userId: 'never-seen' }), 'AB');
});

test('with no picture, the face is the escaped initials and nothing else', () => {
  resetAvatarCache();
  assert.equal(avatarFace('AB', {}), 'AB');
  assert.equal(avatarFace('AB'), 'AB');
  assert.equal(avatarFace('', {}), '');
  assert.equal(avatarFace(null, {}), '');
  // A name is user-authored, so its initials are too.
  assert.equal(avatarFace('<script>', {}), '&lt;script&gt;');
});

test('with a picture, the face is an <img> carrying the initials as its fallback', () => {
  resetAvatarCache();
  const html = avatarFace('AB', { src: '/uploads/x.webp' });
  assert.match(html, /^<img class="avatar__img" src="\/uploads\/x\.webp"/);
  assert.match(html, /alt=""/, 'decorative: the name is always rendered beside it');
  assert.match(html, /data-avatar-fallback="AB"/, 'what a broken picture degrades back to');
});

test('an explicit src wins over the cache, and both attributes are escaped', () => {
  resetAvatarCache();
  rememberAvatar('u1', '/uploads/cached.webp');
  assert.match(avatarFace('AB', { userId: 'u1' }), /src="\/uploads\/cached\.webp"/);
  // A payload that already carried the path (the profile, the friends list)
  // must not be second-guessed by a stale cache entry.
  assert.match(avatarFace('AB', { userId: 'u1', src: '/uploads/fresh.webp' }), /src="\/uploads\/fresh\.webp"/);
  assert.match(avatarFace('A"B', { src: '/x".webp' }), /src="\/x&quot;\.webp" .*data-avatar-fallback="A&quot;B"/);
});

test('priming caches EVERY id it asked about, including ones the answer omitted', async () => {
  resetAvatarCache();
  const asked = [];
  const fetcher = (ids) => { asked.push(ids); return { avatars: { a: '/uploads/a.webp' } }; };

  await primeAvatars(['a', 'b', 'b', null, undefined], fetcher);
  assert.deepEqual(asked, [['a', 'b']], 'deduped, blanks dropped');
  assert.equal(knownAvatar('a'), '/uploads/a.webp');
  // 'b' was asked about and not named in the answer -> it has no picture.
  // Leaving it unknown would re-request it forever.
  assert.equal(knownAvatar('b'), null);

  // Nothing is missing now, so a second prime must not reach the network at all
  // — this is what makes priming-before-render affordable on every view.
  await primeAvatars(['a', 'b'], fetcher);
  assert.equal(asked.length, 1);
});

test('a round of name-only seats costs no request whatsoever', async () => {
  resetAvatarCache();
  let called = 0;
  const fetcher = () => { called += 1; return { avatars: {} }; };
  await primeAvatars([], fetcher);
  await primeAvatars([undefined, null, ''], fetcher);
  assert.equal(called, 0, 'the common case — member.userId is set only by the seat self-claim');
});

test('a failed resolution caches nothing, throws nothing, and can be retried', async () => {
  resetAvatarCache();
  let calls = 0;
  const flaky = () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return { avatars: { a: '/uploads/a.webp' } };
  };
  await primeAvatars(['a'], flaky);
  assert.equal(knownAvatar('a'), undefined, 'still unknown, so the screen renders initials');

  await primeAvatars(['a'], flaky);
  assert.equal(knownAvatar('a'), '/uploads/a.webp', 'and the next view tries again');
});

test('resetting drops everything, so the next account inherits nothing', () => {
  resetAvatarCache();
  rememberAvatar('u1', '/uploads/x.webp');
  assert.equal(knownAvatar('u1'), '/uploads/x.webp');
  resetAvatarCache();
  assert.equal(knownAvatar('u1'), undefined);
});

test('a picture whose bytes are gone degrades to the initials it replaced', () => {
  const dom = new JSDOM('<div id="seat" class="avatar"></div>');
  const { document } = dom.window;
  installAvatarFallback(document);

  const seat = document.getElementById('seat');
  seat.innerHTML = avatarFace('AB', { src: '/uploads/taken-down.webp' });
  assert.equal(seat.querySelectorAll('img').length, 1);

  // `error` does not bubble, so the listener is registered in the CAPTURE
  // phase — a bubbling listener would never fire and this would be a broken
  // image glyph inside a coloured circle, forever.
  seat.querySelector('img').dispatchEvent(new dom.window.Event('error'));
  assert.equal(seat.textContent, 'AB');
  assert.equal(seat.querySelectorAll('img').length, 0);
});

test('the fallback listener ignores images that are not avatars', () => {
  const dom = new JSDOM('<div id="box"><img class="cover" src="/uploads/c.jpg"></div>');
  const { document } = dom.window;
  installAvatarFallback(document);

  const box = document.getElementById('box');
  box.querySelector('img').dispatchEvent(new dom.window.Event('error'));
  assert.equal(box.querySelectorAll('img').length, 1, 'a failed COVER must not be blanked by this');
});

test('a fetch that never answers gives up and lets the screen render initials', async (t) => {
  // The round-read path awaits this before rendering, and `fetch` has no timeout
  // of its own — so without the deadline a stalled connection holds the app's
  // most-used screen open forever. Failing open on a HANG has to be as reliable
  // as failing open on an error.
  //
  // Mocked so the test does not really wait four seconds. Both APIs together:
  // mocking one leaves the other on the real clock and the timer never fires
  // (.claude/rules/mock-timers-jump-the-clock-before-firing.md).
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  resetAvatarCache();

  const state = { settled: false };
  const hang = () => new Promise(() => {});          // never resolves, never rejects
  const done = primeAvatars(['a'], hang).then(() => { state.settled = true; });

  // Drain the microtask queue properly. `await Promise.resolve()` yields ONE
  // tick, and the rejection has to travel race -> catch -> finally -> .then —
  // so with a single yield `settled` reads false whether or not the timer fired,
  // and the assertion below passes against ANY deadline. Measured: halving the
  // deadline on purpose left this test green until setImmediate replaced it.
  // setImmediate is not among the mocked APIs, so it still really defers.
  const drain = () => new Promise((r) => setImmediate(r));

  // Step ACROSS the boundary rather than past it: only the false-then-true pair
  // pins the deadline. A single big tick would pass against any shorter one.
  t.mock.timers.tick(AVATAR_PRIME_TIMEOUT_MS - 1);
  await drain();
  assert.equal(state.settled, false, 'still waiting just inside the deadline');

  t.mock.timers.tick(1);
  await done;
  await drain();
  assert.equal(state.settled, true, 'gave up at the deadline');
  assert.equal(knownAvatar('a'), undefined,
    'nothing cached, so the next view retries rather than remembering a non-answer');
});

test('a prime that answers in time clears its timer instead of leaving one pending', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  resetAvatarCache();

  await primeAvatars(['a'], async () => ({ avatars: { a: '/uploads/a.webp' } }));
  assert.equal(knownAvatar('a'), '/uploads/a.webp');

  // Advancing past the deadline must reach no live timer. If the race's timer
  // survived a successful prime, its rejection would surface here as an
  // unhandled rejection rather than being harmlessly discarded.
  t.mock.timers.tick(AVATAR_PRIME_TIMEOUT_MS * 2);
  await Promise.resolve();
  assert.equal(knownAvatar('a'), '/uploads/a.webp', 'the answer stands');
});
