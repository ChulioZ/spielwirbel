'use strict';

/* The BGG collection-import picker's candidate list (#625).
 *
 * The list used to render the whole collection in BGG's own order, with the
 * games already on the shelf sitting inert (checked + disabled) between the ones
 * that can actually be imported — so a mostly-imported shelf meant scrolling a
 * long list hunting for the handful of rows that do something. They are now
 * split: importable games lead, already-present ones follow in a collapsed
 * section. Never *dropped*, which is the constraint the original design was
 * protecting (`.claude/rules/bgg-collection-import.md`): the list is the user's
 * own collection, and losing half of it reads as the import having failed.
 *
 * This runs the real view in jsdom rather than matching its source, because
 * every defect here is a DOM one — a row in the wrong list, a section that
 * starts expanded, a game silently missing from the sheet. The harness loads the
 * frontend through `vm`, so the view stays out of the coverage report; a
 * `require()` of it would red `coverage:ci` with every test green
 * (`.claude/rules/testing-views-under-jsdom.md`).
 *
 * The LAST spec is the exception: it drives the real collection route over
 * supertest, because the fixture every spec above renders is a hand-written copy
 * of that route's payload and nothing else would notice it drifting.
 */

// Flags before the app is required: the last spec in this file drives the real
// collection route, whose handle is read off the ACTING ACCOUNT (never the
// request), so an accounts-off instance could only reach the 'no_username'
// state and would answer with no games at all.
process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.BGG_API_TOKEN = 'test-token';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const { outbox } = require('../lib/mail');
const { loadApp } = require('./support/dom');
const { bodyOf } = require('./support/css');

// Only the last spec stubs the network at this level; the jsdom ones stub `api`
// inside the vm context. Restoring after every test keeps that true.
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

/* One candidate in the shape `GET /api/rounds/:rid/lookup/collection` emits,
   field for field (`lib/routes/lookup.js`). Captured from a real response on
   2026-08-05 — and pinned against one by the last spec in this file rather than
   trusted, because a hand-written copy of a server payload is the shape that
   rots in silence: rename `present` to `owned` in the route and the picker
   breaks in production while every spec here stays green, since the fixture
   goes on answering with the old name.

   `url` is the one field the route emits that this omits, deliberately: the
   picker never reads it, so the pin below is a subset check, not equality. */
const game = (id, title, present) => ({
  externalId: String(id),
  title,
  present,
  imageUrl: null,
  minPlayers: 2,
  maxPlayers: 4,
});

/* BGG returns one alphabetical list with a `present` flag per item, so the
   fixture interleaves the two kinds — a split that only works on a
   conveniently pre-sorted list is the bug, not the fix. */
const MIXED = [
  game(1, 'Azul', true),
  game(2, 'Brass', false),
  game(3, 'Cascadia', true),
  game(4, 'Dune', false),
  game(5, 'Everdell', true),
];
const FRESH = ['Brass', 'Dune'];
const PRESENT = ['Azul', 'Cascadia', 'Everdell'];

/* Open the import sheet against a stubbed collection. `showBggImport` kicks off
   its own `load()` without awaiting it, so the render lands a few microtasks
   after the call resolves — hence the macrotask flush. */
async function openImport(t, games, locale = 'de') {
  const dom = loadApp({ locale });
  t.after(() => dom.close());
  dom.set('api', async (method, path) => {
    assert.match(path, /\/lookup\/collection\?provider=bgg$/, `unexpected api call: ${method} ${path}`);
    return { state: 'ok', games };
  });
  await dom.call('showBggImport', { id: 7, name: 'Freitagsrunde' });
  await new Promise((resolve) => setImmediate(resolve));
  const body = dom.document.querySelector('.bgg-import');
  assert.ok(body, 'the import sheet rendered no body');
  return { dom, body };
}

const texts = (nodes) => [...nodes].map((n) => n.textContent.trim());

test('only the importable games render in the actionable list, in collection order', async (t) => {
  const { body } = await openImport(t, MIXED);

  assert.deepEqual(texts(body.querySelectorAll('.bgg-import__list .bgg-import__name')), FRESH);
  /* The `is-present` row is gone rather than merely relocated: a disabled
     checkbox in the one list the user acts on is exactly the noise this
     removed, and the selection logic counts `input`s. */
  assert.equal(body.querySelectorAll('.bgg-import__list input').length, FRESH.length);
  assert.equal(body.querySelectorAll('input[disabled]').length, 0, 'no disabled checkbox may survive anywhere in the sheet');
  assert.equal(body.querySelectorAll('.is-present').length, 0);
});

test('the already-present games sit in a section that is collapsed on load and lists every one of them', async (t) => {
  const { body } = await openImport(t, MIXED);

  const sec = body.querySelector('.bgg-import__present');
  assert.ok(sec, 'no already-present section rendered');
  assert.equal(sec.tagName, 'DETAILS');
  assert.equal(sec.open, false, 'the section must start collapsed — it is the half nobody came for');

  /* A native <summary>, so Tab reaches it and Enter/Space toggle it with no
     handler of our own (`.claude/rules/native-button-vs-focusable-span.md`). */
  const head = sec.querySelector('.bgg-import__present-head');
  assert.equal(head.tagName, 'SUMMARY');
  assert.equal(head.parentElement, sec);

  // Nothing is dropped from the sheet — the whole reason it is a collapse and
  // not a filter.
  assert.deepEqual(texts(sec.querySelectorAll('.bgg-import__present-item')), PRESENT);
  /* Not .ds-row: these are not click targets, and that component promises one
     (`.claude/rules/ds-row-is-a-click-target.md`). */
  assert.equal(sec.querySelectorAll('.ds-row').length, 0);
});

test('the section sits between the actionable list and the sticky actions bar', async (t) => {
  const { body } = await openImport(t, MIXED);
  const order = [...body.children].map((el) => el.className.split(' ')[0]);

  const picker = order.indexOf('bgg-import__picker');
  const present = order.indexOf('bgg-import__present');
  const actions = order.indexOf('toolbar');
  assert.ok(picker >= 0 && present >= 0 && actions >= 0, `missing a block: ${order.join(', ')}`);
  assert.ok(picker < present, 'the importable games must lead');
  /* `.sheet__actions` is `position: sticky; bottom: 0` with an opaque
     background, so anything after it scrolls underneath the submit button. */
  assert.ok(present < actions, 'the collapsed section must precede the actions bar');
});

test('the intro names both the collection total and how many are not on the shelf, in every locale', async (t) => {
  for (const locale of ['de', 'en']) {
    const { dom, body } = await openImport(t, MIXED, locale);
    const intro = body.querySelector('p.muted').textContent;

    /* Built through the same i18n call the view makes, but with the two counts
       supplied INDEPENDENTLY here: the total drives the plural pick, the fresh
       count fills {m}. Two position-free number regexes could not tell the
       slots apart — the sentence's only digits ARE the two slots, so swapping
       them in the view kept both green. Comparing the whole string also fails
       on an unreplaced {n}/{m}, which the regexes needed a third assertion for. */
    const expected = dom.run(
      `tn(${MIXED.length}, 'bggImport.introOne', 'bggImport.intro', { m: ${FRESH.length} })`,
    );
    assert.equal(intro, expected,
      `${locale}: the intro must name ${MIXED.length} in the collection and ${FRESH.length} not yet imported, in that order`);
  }
});

test('with nothing left to import the sheet shows the message plus the section, and no submit', async (t) => {
  const all = PRESENT.map((title, i) => game(i + 1, title, true));
  const { dom, body } = await openImport(t, all);

  assert.equal(body.querySelector('.bgg-import__msg p').textContent, dom.run("t('bggImport.allPresent')"));
  assert.equal(body.querySelector('.bgg-import__picker'), null, 'nothing is selectable, so there is no picker');
  assert.equal(body.querySelector('.bgg-import__go'), null, 'nothing is selectable, so there is no submit button');

  // The user can still confirm WHICH games it means — the message alone asks
  // them to take the sheet's word for it.
  const sec = body.querySelector('.bgg-import__present');
  assert.ok(sec, 'the all-present state must still list the collection');
  assert.equal(sec.open, false);
  assert.deepEqual(texts(sec.querySelectorAll('.bgg-import__present-item')), PRESENT);
});

/* jsdom applies no external stylesheet, so the focus indicator is asserted
   against the parsed CSS text rather than a computed style
   (`.claude/rules/testing-views-under-jsdom.md`). It is load-bearing: the SPA
   declares no other `summary` rules, so this control has nothing to inherit. */
test('the summary carries a visible focus indicator', () => {
  const focus = bodyOf('.bgg-import__present-head:focus-visible');
  assert.ok(focus, 'no :focus-visible rule for the disclosure summary');
  assert.match(focus, /outline:\s*\d/, 'the focus rule must draw an outline');
});

/* ------------------------ the fixture's provenance ------------------------- */

const PASSWORD = 'correct horse battery';
const auth = (token) => ({ Authorization: `Bearer ${token}` });

/* The one spec here that leaves jsdom, and the reason `game()` above may be
   hand-written at all: it drives the REAL route and checks that every field
   name the fixture declares is one the server actually emits. */
test('the fixture speaks the collection route\'s own field names', async () => {
  const email = 'picker-fixture@example.com';
  const username = 'pickerfixture';
  await request(app).post('/api/account/register').send({ email, username, password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'verification mail carries a /v?t= link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  const token = login.body.accessToken;

  const round = await request(app).post('/api/rounds').set(auth(token)).send({ name: 'R', members: ['Alice'] });
  assert.equal(round.status, 201);
  await request(app).patch('/api/account/me').set(auth(token)).send({ bggUsername: 'PickerFixture' });

  // A collection item: the name is a TEXT node and the player counts live on
  // <stats>, unlike search/thing (`.claude/rules/bgg-collection-import.md` §1).
  global.fetch = async () => ({
    status: 200,
    text: async () => `<?xml version="1.0" encoding="utf-8"?>
<items totalitems="1">
  <item objecttype="thing" objectid="13" subtype="boardgame" collid="c13">
    <name sortindex="1">CATAN</name>
    <thumbnail>https://cf.geekdo-images.com/x__thumb/img/y=/fit-in/200x150/pic13.png</thumbnail>
    <stats minplayers="2" maxplayers="4"/>
    <status own="1"/>
  </item>
</items>`,
  });

  const res = await request(app)
    .get(`/api/rounds/${round.body.id}/lookup/collection?provider=bgg`)
    .set(auth(token));
  assert.equal(res.status, 200);
  const real = res.body.games[0];
  // Without this the loop below would pass over an empty list, i.e. prove
  // nothing at all — the exact vacuous shape this spec exists to close.
  assert.ok(real, `the route returned no candidate (state: ${res.body.state}), so the check below would be vacuous`);

  for (const field of Object.keys(game(13, 'CATAN', false))) {
    assert.ok(field in real,
      `the picker fixture declares '${field}', which GET …/lookup/collection does not emit — `
      + `it answers with ${Object.keys(real).join(', ')}`);
  }
});
