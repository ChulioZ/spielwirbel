'use strict';

/*
 * The „Was ist neu" screen and its unseen dot (issue #741), driven through the
 * jsdom harness (.claude/rules/testing-views-under-jsdom.md).
 *
 * EVERY SPEC HERE STATES ITS OWN LIST through `boot({ entries })`, and never
 * reads the shipped NEWS. That began as a guard against vacuity — while the
 * shipped list was empty, `newsRevision()` was null and every claim about the
 * dot was satisfiable by an implementation that never lights it — and it is
 * what kept this file correct when #564 shipped the first real entry: the
 * empty-list specs still test the empty case, because they establish it rather
 * than inherit it. A spec that had read the shipped array would have silently
 * changed meaning that day. Same trap as the defaulted flag in
 * .claude/rules/break-the-code-on-purpose.md.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const ENTRY = {
  revision: '2026-08-20',
  de: { title: 'Passkeys', body: 'Anmelden ohne Passwort.' },
  en: { title: 'Passkeys', body: 'Sign in without a password.' },
};
const OLDER = {
  revision: '2026-07-01',
  de: { title: 'Regal-Import', body: 'Sammlung von BGG holen.' },
  en: { title: 'Shelf import', body: 'Pull your collection from BGG.' },
};

/* Boot the shell with an account whose seen-state the spec chooses. `lastSeen`
   is what /me would have delivered, so `null` is both "never seen anything" and
   the shape a pre-#741 account resolves to. */
function boot(t, { entries = [], lastSeen = null, loggedIn = true, accounts = true, locale = 'de' } = {}) {
  const dom = loadApp({ locale });
  t.after(() => dom.close());

  // NEWS is a top-level `const`, so it can only be mutated, never replaced —
  // which is exactly what a spec wants: the view and account.js read the same
  // array this pushes into.
  const news = dom.get('NEWS');
  news.length = 0;
  news.push(...entries);
  t.after(() => { news.length = 0; });

  dom.set('accountsActive', () => accounts);
  dom.set('isLoggedIn', () => loggedIn);
  dom.set('showHome', () => { dom.app.innerHTML = '<h1>home</h1>'; });
  // `accountUser` is a top-level `let`, invisible to set() — assign it inside
  // the context instead.
  dom.context.__user = loggedIn ? { id: 'u1', username: 'ada', email: 'a@example.com', lastSeenNewsRevision: lastSeen } : null;
  dom.run('accountUser = __user');

  const calls = [];
  dom.set('accountApi', async (method, url) => {
    calls.push({ method, url });
    if (url === '/news-seen') {
      // What the real route answers: a fresh meProjection, stamped server-side.
      return { id: 'u1', username: 'ada', email: 'a@example.com', lastSeenNewsRevision: dom.run('newsRevision()') };
    }
    return {};
  });

  // `seenCalls` rather than every call: setupAccountUi also refreshes the inbox
  // badge, which is unrelated traffic this file must not be coupled to.
  return {
    dom,
    calls,
    seenCalls: () => calls.filter((c) => c.url === '/news-seen'),
    dot: () => dom.document.getElementById('newsDot'),
    menu: () => openMenu(dom),
  };
}

/* Open the account menu and hand back its rows, plus the „Was ist neu" one
   picked out by its label. Both are needed: a spec about the marked row also has
   to say the four siblings stayed unmarked. `news` is null when the menu never
   opened at all, which is the logged-out case. */
function openMenu(dom) {
  dom.call('setupAccountUi');
  dom.document.getElementById('accountBtn').click();
  const rows = [...dom.document.querySelectorAll('.popover__opt')];
  const label = dom.run(`t('news.menu')`);
  return { rows, news: rows.find((el) => el.textContent.trim() === label) || null };
}

// The row's mark, as a screen reader and a sighted user each meet it.
const marked = (row) => ({
  dot: !!row.querySelector('.popover__dot'),
  name: row.getAttribute('aria-label'),
});

/* ------------------------------- the screen -------------------------------- */

test('the screen lists every entry, newest first, in the reader’s language', async (t) => {
  const { dom } = boot(t, { entries: [ENTRY, OLDER], locale: 'en' });
  await dom.call('showNews');

  const titles = [...dom.app.querySelectorAll('.news-entry__title')].map((el) => el.textContent);
  assert.deepEqual(titles, ['Passkeys', 'Shelf import']);
  assert.equal(dom.app.querySelector('.news-entry__body').textContent, 'Sign in without a password.');
  assert.equal(dom.document.location.pathname, '/neu');
});

test('a German reader gets the German half of the same entry', async (t) => {
  const { dom } = boot(t, { entries: [ENTRY], locale: 'de' });
  await dom.call('showNews');
  assert.equal(dom.app.querySelector('.news-entry__body').textContent, 'Anmelden ohne Passwort.');
});

test('an entry with no translation for this locale falls back rather than blanking', async (t) => {
  // The five queued locales (#534–#538) will read entries nobody translated.
  // English is the fallback, not German — see newsText().
  const { dom } = boot(t, { entries: [{ revision: '2026-08-20', en: { title: 'Only EN', body: 'Body.' } }], locale: 'de' });
  await dom.call('showNews');
  assert.equal(dom.app.querySelector('.news-entry__title').textContent, 'Only EN');
});

test('the empty list renders an honest empty state and NO entries', async (t) => {
  const { dom } = boot(t, { entries: [] });
  await dom.call('showNews');

  assert.equal(dom.app.querySelectorAll('.news-entry').length, 0);
  const note = dom.app.querySelector('.empty-note');
  assert.ok(note && note.textContent.trim(), 'the empty state says something');
  // It still renders as a screen — heading and all — rather than a blank page.
  assert.ok(dom.app.querySelector('.lobby-head h1'));
});

test('a logged-out visitor in accounts mode is sent Home', async (t) => {
  const { dom, seenCalls } = boot(t, { entries: [ENTRY], loggedIn: false });
  await dom.call('showNews');

  assert.equal(dom.app.textContent, 'home');
  assert.equal(seenCalls().length, 0, 'and nothing is stamped for a visitor with no account');
});

test('an accounts-OFF instance still renders the list — it is not secret', async (t) => {
  // A password-only or open self-hosted instance has no account to badge it
  // against, so the dot never shows there. The list itself is public product
  // information and must not 404 into Home.
  const { dom, seenCalls } = boot(t, { entries: [ENTRY], accounts: false, loggedIn: false });
  await dom.call('showNews');

  assert.equal(dom.app.querySelectorAll('.news-entry').length, 1);
  assert.equal(seenCalls().length, 0, 'with no account there is no seen-state to write');
});

/* --------------------------------- the dot --------------------------------- */

test('the dot lights when the account is behind the newest entry', async (t) => {
  const { dom, dot } = boot(t, { entries: [ENTRY, OLDER], lastSeen: '2026-07-01' });
  dom.call('setupAccountUi');
  assert.equal(dot().hidden, false);
});

test('an account that has seen the newest entry gets no dot', async (t) => {
  const { dom, dot } = boot(t, { entries: [ENTRY, OLDER], lastSeen: '2026-08-20' });
  dom.call('setupAccountUi');
  assert.equal(dot().hidden, true);
});

test('an account predating the field (null) is behind, so it IS dotted', async (t) => {
  const { dom, dot } = boot(t, { entries: [ENTRY], lastSeen: null });
  dom.call('setupAccountUi');
  assert.equal(dot().hidden, false);
});

test('with the list EMPTY no dot can ever appear, whatever the account holds', async (t) => {
  // The state a self-hosted instance with no entries is in. Both stamps are
  // exercised, because an
  // implementation comparing a null revision against a null stamp with `!==`
  // would light the dot for a stale account and not for a fresh one.
  for (const lastSeen of [null, '2026-08-20']) {
    const { dom, dot } = boot(t, { entries: [], lastSeen });
    dom.call('setupAccountUi');
    assert.equal(dot().hidden, true, `lastSeen=${lastSeen}`);
    assert.equal(dom.run('hasUnseenNews()'), false);
  }
});

test('logging out takes the dot with it', async (t) => {
  const { dom, dot } = boot(t, { entries: [ENTRY], lastSeen: null });
  dom.call('setupAccountUi');
  assert.equal(dot().hidden, false, 'lit while logged in, or the next assertion proves nothing');

  dom.set('isLoggedIn', () => false);
  dom.call('setupAccountUi');
  assert.equal(dot().hidden, true);
});

/* ------------------ the same mark inside the menu it opens (#764) ----------- */

test('the „Was ist neu" row carries the mark the button dot promised', async (t) => {
  const { dom, dot, menu } = boot(t, { entries: [ENTRY, OLDER], lastSeen: '2026-07-01' });
  const { rows, news } = menu();

  assert.ok(news, `no „Was ist neu" row among ${JSON.stringify(rows.map((r) => r.textContent.trim()))}`);
  assert.deepEqual(marked(news), { dot: true, name: dom.run(`t('news.menuUnseen')`) });
  // The dot itself is decorative — the unseen state is IN the row's name, or a
  // screen reader meets a nameless span and learns nothing.
  assert.equal(news.querySelector('.popover__dot').getAttribute('aria-hidden'), 'true');
  // One predicate drives both, so the trail cannot go cold halfway.
  assert.equal(dot().hidden, false);
  // And only the one row is marked — no dots on Freundeskreis/Konto/Entdecken/Abmelden.
  assert.equal(rows.filter((r) => r.querySelector('.popover__dot')).length, 1);
});

test('a caught-up account gets a row identical to its unmarked siblings', async (t) => {
  const { dot, menu } = boot(t, { entries: [ENTRY, OLDER], lastSeen: '2026-08-20' });
  const { rows, news } = menu();

  assert.deepEqual(marked(news), { dot: false, name: null });
  assert.equal(dot().hidden, true);
  /* The seen state must render as it did before #764 — same class list as the
     four rows that never had a dot, so no modifier can leak into it and re-space
     the menu. */
  const siblings = rows.filter((r) => r !== news).map((r) => r.className);
  assert.deepEqual(new Set(siblings), new Set([news.className]));
  assert.equal(news.className, 'popover__opt');
});

test('with the list EMPTY the row is never marked, whatever the account holds', async (t) => {
  for (const lastSeen of [null, '2026-08-20']) {
    const { menu } = boot(t, { entries: [], lastSeen });
    assert.deepEqual(marked(menu().news), { dot: false, name: null }, `lastSeen=${lastSeen}`);
  }
});

test('a logged-out visitor gets no menu, so no marked row either', async (t) => {
  const { dom, menu } = boot(t, { entries: [ENTRY], lastSeen: null, loggedIn: false });
  assert.equal(menu().news, null, 'the account menu opened for a logged-out visitor');
  assert.equal(dom.document.querySelectorAll('.popover__dot').length, 0);
});

test('opening /neu FROM the row clears the mark on the next open', async (t) => {
  const { dom, menu } = boot(t, { entries: [ENTRY], lastSeen: null });
  const first = menu();
  assert.equal(marked(first.news).dot, true, 'unmarked before the click proves nothing');

  first.news.click();
  await new Promise((r) => setTimeout(r, 0)); // let markNewsSeen re-seat accountUser

  assert.equal(dom.app.querySelectorAll('.news-entry').length, 1, 'the row still opens the screen');
  assert.deepEqual(marked(menu().news), { dot: false, name: null });
});

/* ------------------------- opening the screen marks seen -------------------- */

test('opening the screen stamps it seen, clears the dot, and re-seats the account', async (t) => {
  const { dom, seenCalls, dot } = boot(t, { entries: [ENTRY], lastSeen: null });
  dom.call('setupAccountUi');
  assert.equal(dot().hidden, false);

  await dom.call('showNews');

  assert.deepEqual(seenCalls(), [{ method: 'POST', url: '/news-seen' }],
    'visiting the page IS the acknowledgement — no separate control, no body');
  assert.equal(dot().hidden, true);

  /* The re-seat is the load-bearing half: setupAccountUi runs again on the next
     login transition, and against a stale `accountUser` it would re-light the
     dot the user just cleared. (A language switch does NOT re-run it —
     applyStaticTexts calls only the two banner functions — which is fine, since
     the dot does not depend on the locale.) */
  assert.equal(dom.run('accountUser.lastSeenNewsRevision'), '2026-08-20');
  dom.call('setupAccountUi');
  assert.equal(dot().hidden, true, 'and it stays cleared');
});

test('an account already caught up sends no request at all', async (t) => {
  const { dom, seenCalls } = boot(t, { entries: [ENTRY], lastSeen: '2026-08-20' });
  await dom.call('showNews');
  assert.deepEqual(seenCalls(), []);
});

test('a failed stamp leaves the dot to return on the next load', async (t) => {
  const { dom, dot } = boot(t, { entries: [ENTRY], lastSeen: null });
  dom.set('accountApi', async () => { throw new Error('network'); });

  await dom.call('showNews'); // must not reject out of the view
  assert.equal(dom.app.querySelectorAll('.news-entry').length, 1, 'the screen still rendered');

  // Optimistically cleared on screen, but the account was never updated — so the
  // next transition brings it back, which is the right failure direction.
  dom.call('setupAccountUi');
  assert.equal(dot().hidden, false);
});

/* ----------------------------- the entry point ----------------------------- */

test('the account menu carries the only way in', async (t) => {
  const { dom } = boot(t, { entries: [ENTRY] });
  dom.call('setupAccountUi');
  dom.document.getElementById('accountBtn').click();

  const labels = [...dom.document.querySelectorAll('.popover__opt')].map((el) => el.textContent.trim());
  assert.ok(labels.includes(dom.run(`t('news.menu')`)),
    `the account menu offers ${JSON.stringify(labels)} — no way to reach /neu`);
});

/* --------------------------- nothing may PUSH itself ------------------------ */

test('the feature renders no banner, toast, modal or interstitial', async (t) => {
  /* The whole reason #741 is shaped as a pulled screen: a third dismissable
     strip would train users to dismiss the Nutzungsbedingungen §11 terms notice
     unread. So this is a real constraint, not a style preference — and it is the
     one a future "let's make it more discoverable" change would break. */
  const { dom } = boot(t, { entries: [ENTRY], lastSeen: null });
  dom.call('setupAccountUi');
  await dom.call('showNews');

  for (const sel of ['.sheet-backdrop', '.popover', '.toast.is-on', 'dialog[open]']) {
    assert.equal(dom.document.querySelectorAll(sel).length, 0, `#741 rendered a ${sel}`);
  }
  // The two strips that DO exist stay down: the news feature must not borrow one.
  assert.equal(dom.document.getElementById('termsBanner').hidden, true);
  assert.equal(dom.document.getElementById('demoBanner').hidden, true);
  // And the dot is the entire nudge — an 8px element inside the account button,
  // not a sibling of the content column.
  assert.equal(dom.document.getElementById('newsDot').closest('#accountBtn')?.id, 'accountBtn');
});
