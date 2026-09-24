'use strict';

/* The two one-time feedback prompts (#1172) — after a round's first session
 * result and after an account's first BGG collection import — and the `source`
 * value that tells the operator which one produced a message.
 *
 * Four layers, tested four ways:
 *
 *  - feedback-link.js is pure and shared with the server, so it is required
 *    straight into Node (.claude/rules/frontend-helper-modules-and-coverage.md);
 *  - the route is driven over supertest with EVERY entry of the real
 *    FEEDBACK_SOURCES — a loop over the shared object is what would go red if a
 *    server copy drifted (.claude/rules/shared-constants-across-the-stack.md);
 *  - both prompts are RENDERED through the jsdom harness, which also gives the
 *    "already asked" flags a real per-instance localStorage (a Node require
 *    would read every flag as unset through its own catch);
 *  - the operator panel's feedback card is loaded from the real admin.html.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { JSDOM } = require('jsdom');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { loadApp, loadKontakt, translator, flush } = require('./support/dom');
const { FEEDBACK_SOURCES, isFeedbackSource, feedbackUrl } = require('../public/js/feedback-link');
const { isContactAvailable, setContactAvailable } = require('../public/js/report-link');

// =================== The contact gate the prompts ride ===================

/* MUST stay first and must not call the setter: the gate's DEFAULT decides
   whether a prompt can ever appear on an instance with no contact channel
   (.claude/rules/break-the-code-on-purpose.md, "a test that SETS the state"). */
test('the contact gate reads closed until /api/config opens it', () => {
  assert.equal(isContactAvailable(), false);
  setContactAvailable(true);
  assert.equal(isContactAvailable(), true);
  setContactAvailable(false);
});

// =================== feedback-link.js ===================

test('the sources are exactly the two prompts, and nothing else passes', () => {
  assert.deepEqual(Object.values(FEEDBACK_SOURCES).sort(), ['first_session', 'import']);
  for (const s of Object.values(FEEDBACK_SOURCES)) assert.equal(isFeedbackSource(s), true, s);
  for (const s of ['', undefined, null, 'First_Session', 'import ', 'constructor', '__proto__']) {
    assert.equal(isFeedbackSource(s), false, String(s));
  }
});

test('the feedback link carries category and path, and a source only when it is one', () => {
  const plain = new URL(feedbackUrl('/r/1/regal'), 'https://x.test');
  assert.equal(plain.pathname, '/kontakt.html');
  assert.equal(plain.searchParams.get('category'), 'feedback');
  assert.equal(plain.searchParams.get('path'), '/r/1/regal');
  assert.equal(plain.searchParams.has('source'), false, 'the top-bar button is the unprompted path');

  const prompted = new URL(feedbackUrl('/r/1/s/2', FEEDBACK_SOURCES.import), 'https://x.test');
  assert.equal(prompted.searchParams.get('source'), 'import');
  assert.equal(new URL(feedbackUrl('/', 'bogus'), 'https://x.test').searchParams.has('source'), false);
});

// =================== The route ===================

const storedFeedback = async (message) =>
  (await repo.listFeedback(500)).find((e) => e.message === message);

test('every prompt source round-trips into the stored feedback context', async () => {
  for (const source of Object.values(FEEDBACK_SOURCES)) {
    const message = `source round-trip ${source}`;
    const res = await request(app).post('/api/contact')
      .send({ message, category: 'feedback', path: '/r/1', locale: 'de', source });
    assert.equal(res.status, 200);
    assert.equal((await storedFeedback(message)).context.source, source);
  }
});

test('an unknown source is dropped, the message kept — and no source means no key', async () => {
  const res = await request(app).post('/api/contact')
    .send({ message: 'odd source', category: 'feedback', source: 'newsletter' });
  assert.equal(res.status, 200, 'a metadata field must never cost the message');
  assert.equal('source' in (await storedFeedback('odd source')).context, false);

  await request(app).post('/api/contact').send({ message: 'no source', category: 'feedback' });
  assert.equal('source' in (await storedFeedback('no source')).context, false,
    'the unprompted path stores no key, so old and new rows read the same');
});

// =================== The contact page carries it ===================

/* The standalone page sits between the prompt's link and the route: a page that
   read the query but never sent `source` on would lose it with every other layer
   green. Raw pass-through by design — the server owns the allowlist. */
async function submitFrom(search) {
  const sent = [];
  const dom = loadKontakt({
    search,
    fetch: (url, init) => {
      if (!init) return Promise.resolve({ ok: true, json: () => Promise.resolve({ footer: true }) });
      sent.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    },
  });
  const doc = dom.window.document;
  doc.getElementById('message').value = 'Eine Zeile';
  doc.getElementById('contactForm')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  dom.window.close();
  assert.equal(sent.length, 1, 'the form did not POST');
  return sent[0];
}

test('the contact page sends the prompt\'s source on with a feedback submission', async () => {
  const body = await submitFrom('?' + new URL(feedbackUrl('/r/1', FEEDBACK_SOURCES.firstSession), 'https://x.test').searchParams);
  assert.equal(body.category, 'feedback');
  assert.equal(body.source, 'first_session');
  assert.equal(body.path, '/r/1');
  assert.equal('source' in await submitFrom('?category=feedback&path=%2F'), false, 'no source in, none out');
});

// =================== The results-screen prompt ===================

const de = translator('de');

function roundFixture(sessions) {
  return {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
    ],
    sessions,
  };
}

// A session whose voting has just closed — `done`, but not yet marked played,
// which is the state the reveal lands on.
const sessionFixture = (id, over = {}) => ({
  id,
  createdAt: '2026-09-20T18:00:00.000Z',
  gameIds: ['g1', 'g2'],
  memberIds: ['m1', 'm2'],
  events: [],
  votes: { m1: { g1: { rating: 5 }, g2: { rating: 3 } }, m2: { g1: { rating: 4 }, g2: { rating: 2 } } },
  votedIds: ['m1', 'm2'],
  done: true,
  cancelled: false,
  finished: false,
  winnerIds: [],
  chosenGameId: null,
  ...over,
});

function app0(t, { contact = true, demo = false } = {}) {
  const dom = loadApp();
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => true);
  dom.set('isDemoAccount', () => demo);
  // An installable browser, so the install card is always the alternative on
  // offer — every "no feedback card" case below then also proves which card
  // took the slot instead.
  dom.set('installState', () => 'prompt');
  if (contact) dom.run('setContactAvailable(true)');
  const opened = [];
  dom.window.open = (...args) => { opened.push(args); return null; };
  return { dom, opened };
}

async function reveal(dom, round, session, isReveal = true) {
  dom.set('api', async () => round);
  await dom.call('showResults', round, session, null, isReveal);
}

const cards = (dom) => ({
  feedback: dom.app.querySelectorAll('.feedback-offer').length,
  install: dom.app.querySelectorAll('.install-offer').length,
});

test('a round\'s first result asks for feedback INSTEAD of offering the install', async (t) => {
  const { dom } = app0(t);
  const s1 = sessionFixture('s1');
  await reveal(dom, roundFixture([s1]), s1);
  assert.deepEqual(cards(dom), { feedback: 1, install: 0 });
  const card = dom.app.querySelector('.feedback-offer');
  assert.ok(card.textContent.includes(de('feedback.prompt.session')));

  // Above the footer, like the install card it stands in for (#614).
  const footer = dom.app.querySelector('.result-footer');
  assert.ok(card.compareDocumentPosition(footer) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
});

test('the prompt is shown once per round: a second reveal on the device gets the install card', async (t) => {
  const { dom } = app0(t);
  const s1 = sessionFixture('s1');
  const round = roundFixture([s1]);
  await reveal(dom, round, s1);
  assert.equal(cards(dom).feedback, 1);
  // Same round, same (still first) session revealed again — e.g. the lobby path
  // landing here a second time. Remembered on SHOW, so it does not come back.
  await reveal(dom, round, s1);
  assert.deepEqual(cards(dom), { feedback: 0, install: 1 });
});

test('the round\'s next session gets the install card as before', async (t) => {
  const { dom } = app0(t);
  const s1 = sessionFixture('s1', { finished: true, chosenGameId: 'g1' });
  const s2 = sessionFixture('s2');
  await reveal(dom, roundFixture([s1, s2]), s2);
  assert.deepEqual(cards(dom), { feedback: 0, install: 1 });
});

/* The trap the issue's own sketch walked into: at the reveal the session is
   closed but NOT yet marked played, so "exactly one finished session" is true
   on the SECOND session (after the first was marked played) and false on the
   first. Counting other sessions that reached a result is what asks at the
   right moment. */
test('"first" means no OTHER session reached a result — a still-unplayed first one qualifies', async (t) => {
  const { dom } = app0(t);
  const s1 = sessionFixture('s1', { finished: false });
  await reveal(dom, roundFixture([s1]), s1);
  assert.equal(cards(dom).feedback, 1, 'the first session is not marked played yet at the reveal');

  const { dom: dom2 } = app0(t);
  const done = sessionFixture('a', { done: true, finished: false });
  const s2 = sessionFixture('b');
  await reveal(dom2, roundFixture([done, s2]), s2);
  assert.equal(cards(dom2).feedback, 0, 'an earlier closed-but-unplayed session already had its result');
});

test('a demo account sees neither card after its first session', async (t) => {
  const { dom } = app0(t, { demo: true });
  const s1 = sessionFixture('s1');
  await reveal(dom, roundFixture([s1]), s1);
  assert.deepEqual(cards(dom), { feedback: 0, install: 0 });
});

test('with no contact channel the slot stays the install card — and nothing is remembered', async (t) => {
  const { dom } = app0(t, { contact: false });
  const s1 = sessionFixture('s1');
  const round = roundFixture([s1]);
  await reveal(dom, round, s1);
  assert.deepEqual(cards(dom), { feedback: 0, install: 1 });
  assert.equal(dom.run(`feedbackAsked(FEEDBACK_SOURCES.firstSession, 'r1')`), false);
});

test('looking an old result up never asks', async (t) => {
  const { dom } = app0(t);
  const s1 = sessionFixture('s1');
  await reveal(dom, roundFixture([s1]), s1, false);
  assert.deepEqual(cards(dom), { feedback: 0, install: 0 });
});

test('the button opens the feedback form in a new tab, carrying the source', async (t) => {
  const { dom, opened } = app0(t);
  const s1 = sessionFixture('s1');
  await reveal(dom, roundFixture([s1]), s1);
  dom.app.querySelector('.feedback-offer__cta').click();
  assert.equal(opened.length, 1);
  const [url, target, features] = opened[0];
  const u = new URL(url, 'https://x.test');
  assert.equal(u.pathname, '/kontakt.html');
  assert.equal(u.searchParams.get('category'), 'feedback');
  assert.equal(u.searchParams.get('source'), 'first_session');
  assert.equal(u.searchParams.get('path'), dom.window.location.pathname);
  assert.equal(target, '_blank');
  assert.equal(features, 'noopener');
  assert.equal(cards(dom).feedback, 0, 'answered, so the card goes');
});

test('the quiet way out removes the card without opening anything', async (t) => {
  const { dom, opened } = app0(t);
  const s1 = sessionFixture('s1');
  await reveal(dom, roundFixture([s1]), s1);
  dom.app.querySelector('.feedback-offer__dismiss').click();
  assert.equal(cards(dom).feedback, 0);
  assert.equal(opened.length, 0);
});

// =================== The import prompt ===================

async function importOnce(dom, { imported = 2 } = {}) {
  dom.set('api', async (method, url) => {
    if (method === 'GET') {
      return { state: 'ok', games: [{ externalId: '1', title: 'Brass', present: false, imageUrl: null, minPlayers: 2, maxPlayers: 4 }] };
    }
    assert.match(url, /\/lookup\/import\?/);
    return { imported, skipped: 0 };
  });
  await dom.call('showBggImport', { id: 7, name: 'Freitagsrunde', members: [], games: [] });
  await flush();
  dom.document.querySelector('.bgg-import__go').click();
  await flush();
}

// Closing goes through history.back(), whose popstate lands a timer turn later;
// a new sheet opened before it arrives would be torn down by the stale pop.
// So wait on the sheet layer's own state rather than on a guessed delay — a
// fixed timer is what made this flaky under a loaded suite.
async function sheetSettled(dom) {
  for (let i = 0; i < 200 && dom.get('sheetHistory'); i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(dom.get('sheetHistory'), false, 'the sheet\'s history marker was never consumed');
}

async function closeImport(dom) {
  dom.document.querySelector('.bgg-import__done').click();
  await sheetSettled(dom);
  assert.equal(dom.document.querySelector('.bgg-import'), null);
}

function importApp(t, opts = {}) {
  const { dom, opened } = app0(t, opts);
  dom.set('currentUserId', () => opts.uid || 'u1');
  const toasts = [];
  dom.set('toast', (m) => toasts.push(m));
  dom.set('showRound', () => {});
  return { dom, opened, toasts };
}

test('an account\'s first import keeps the sheet open on a done state that asks', async (t) => {
  const { dom, opened, toasts } = importApp(t);
  await importOnce(dom);
  const sheet = dom.document.querySelector('.bgg-import');
  assert.ok(sheet, 'the sheet closed instead of asking');
  const prompt = sheet.querySelector('.feedback-offer');
  assert.ok(prompt, 'no feedback prompt after the first import');
  assert.ok(prompt.textContent.includes(de('feedback.prompt.import')));
  assert.ok(sheet.textContent.includes(de('bggImport.toast.done', { n: 2 })), 'the done state must say what happened');
  assert.equal(toasts.length, 0, 'the sheet says it, so no toast repeats it');

  prompt.querySelector('.feedback-offer__cta').click();
  assert.equal(new URL(opened[0][0], 'https://x.test').searchParams.get('source'), 'import');

  sheet.querySelector('.bgg-import__done').click();
  assert.equal(dom.document.querySelector('.bgg-import'), null, 'the close control did not close the sheet');
});

test('the second import on the same account closes as before', async (t) => {
  const { dom, toasts } = importApp(t);
  await importOnce(dom);
  await closeImport(dom);
  await importOnce(dom);
  await sheetSettled(dom);
  assert.equal(dom.document.querySelector('.bgg-import'), null, 'asked twice');
  assert.equal(toasts.length, 1);
});

test('another account on the same device is asked on ITS first import', async (t) => {
  const { dom } = importApp(t);
  await importOnce(dom);
  await closeImport(dom);
  dom.set('currentUserId', () => 'u2');
  await importOnce(dom);
  assert.ok(dom.document.querySelector('.bgg-import .feedback-offer'));
});

test('an import that added nothing, or a demo, never asks', async (t) => {
  const { dom } = importApp(t);
  await importOnce(dom, { imported: 0 });
  assert.equal(dom.document.querySelector('.bgg-import'), null);
  assert.equal(dom.run(`feedbackAsked(FEEDBACK_SOURCES.import, 'u1')`), false, 'a non-ask must not spend the one ask');

  const { dom: demo } = importApp(t, { demo: true });
  await importOnce(demo);
  assert.equal(demo.document.querySelector('.bgg-import'), null);
});

// =================== The operator panel ===================

test('the panel shows which prompt a message came from, and nothing for an unprompted one', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/admin.html' });
  const w = dom.window;
  const entries = [
    { id: 'f1', message: 'after the first', createdAt: '2026-09-24T10:00:00.000Z', context: { path: '/r/1', locale: 'de', source: 'first_session', tenantId: null } },
    { id: 'f2', message: 'after an import', createdAt: '2026-09-24T09:00:00.000Z', context: { path: '/r/1', locale: 'en', source: 'import', tenantId: null } },
    { id: 'f3', message: 'unprompted', createdAt: '2026-09-24T08:00:00.000Z', context: { path: '/r/1', locale: 'de', tenantId: null } },
  ];
  w.fetch = async (url) => {
    const u = String(url);
    // The Kennzahlen card is not under test; failing its route keeps its
    // renderer off a payload it cannot read (test/admin-kennzahlen.test.js).
    if (u.includes('/status')) return { ok: false, status: 500, json: async () => ({ error: 'x' }) };
    const body = u.includes('/me') ? { ok: true }
      : u.includes('/feedback') ? { entries, total: entries.length }
        : {
          corpus: { rows: 0, limit: 0, minRatings: 0, updatedAt: null, enriched: 0, pending: 0 },
          actions: [], entries: [], notices: [], feedback: [], items: [], users: [], total: 0,
        };
    return { ok: true, status: 200, json: async () => body };
  };
  const el = w.document.createElement('script');
  el.textContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'admin.js'), 'utf8');
  w.document.body.appendChild(el);
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  const rows = [...w.document.querySelectorAll('#feedbackTable tbody tr')].slice(1);
  assert.equal(rows.length, 3);
  const ctx = rows.map((r) => r.children[2].textContent);
  assert.match(ctx[0], /^Nach der ersten Session · /);
  assert.match(ctx[1], /^Nach dem Sammlungsimport · /);
  assert.doesNotMatch(ctx[2], /Nach /);
  dom.window.close();
});
