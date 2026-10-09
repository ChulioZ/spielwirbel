'use strict';

/* Das Programmheft's tier 2b (#1380, P14): the round's Einstellungen with the
 * marker picker inline, the profile, the Freundeskreis and its feed, the inbox,
 * „Was ist neu" and the statistics.
 *
 * Operator ruling „A design owns its layout": the branch is designIs() only,
 * Klassisch's DOM does not move, DOM order is visual order and every entry that
 * is reachable today stays reachable. So every Programmheft composition below
 * is also asserted ABSENT under Klassisch. The pixels were judged in a browser
 * at 390 and 1440; what is pinned here is what regresses silently —
 *
 *   - the inline picker offering anything but the design's eight markers, or a
 *     pick that is not the /design screen's PATCH;
 *   - the /design row surviving beside the inline picker (two ways to the same
 *     eight swatches), or a section heading left outside its section;
 *   - the danger zone leaving the second column;
 *   - the feed and the profile activity falling back to the tile grid, or the
 *     profile's rows growing a face (every row is the <h1>'s account);
 *   - a rule of the #1380 section reading the gated colour block ungated, or
 *     spelling a colour instead of a token.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');
const { designMarkers } = require('../public/js/designs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// --- P14 Rundeneinstellungen ------------------------------------------------

const RID = 'r1';
const ROUND = {
  id: RID,
  name: 'Freitagsrunde',
  marker: 2,
  background: null,
  tags: [],
  providers: [],
  savedFilters: [],
  members: [{ id: 'm1', name: 'Anna' }],
  games: [{ id: 'g1', title: 'Azul', tagIds: [] }],
  sessions: [],
};

function bootRound(t, design) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (method === 'PATCH' && /\/marker$/.test(url)) return { marker: body.index };
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return { ...ROUND };
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  return { dom, calls };
}

test('Das Programmheft leads its settings with the marker picker, in its own eight colours', async (t) => {
  const { dom } = bootRound(t, 'programmheft');
  await dom.call('showRoundSettings', RID);
  const main = dom.app.querySelector(':scope > .rs-ph > .rs-ph__col:not(.rs-ph__col--act)');
  assert.ok(main, 'no Programmheft composition');
  // P14.6 heads the set-up with the round's name (#1423), then the markers.
  assert.ok(main.firstElementChild.classList.contains('rs-ph__sec--name'), 'the name field must lead (P14.6)');
  const first = main.children[1];
  assert.ok(first.classList.contains('rs-ph__sec--marker'), 'the marker section must follow the name (P14.6)');
  assert.equal(text(first.querySelector('h2')), dom.run("t('marker.title')"));
  const swatches = [...first.querySelectorAll('.marker-card')];
  const colours = designMarkers('programmheft').map((m) => m.color);
  assert.equal(swatches.length, 8);
  assert.deepEqual(swatches.map((b) => b.style.getPropertyValue('--marker')), colours);
  assert.deepEqual(swatches.map((b) => b.getAttribute('aria-pressed')),
    colours.map((_, i) => String(i === ROUND.marker)));
  assert.equal(text(first.querySelector('.rs-ph__note')), dom.run("t('marker.note')"));

  // The row that led to the same eight swatches is gone; the tags row stays.
  const hrefs = [...dom.app.querySelectorAll('.rs-row[href]')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, [`/round/${RID}/tags`]);
});

test('a pick from the inline picker is the /design screen\'s PATCH, and stays on Einstellungen', async (t) => {
  const { dom, calls } = bootRound(t, 'programmheft');
  await dom.call('showRoundSettings', RID);
  dom.app.querySelectorAll('.rs-ph__sec--marker .marker-card')[5].click();
  await new Promise((r) => setTimeout(r, 20));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'no PATCH was sent');
  assert.equal(patch.url, `/api/rounds/${RID}/marker`);
  assert.equal(patch.body.index, 5);
  assert.ok(dom.app.querySelector('.rs-ph'), 'the pick navigated away from Einstellungen');
});

test('every heading takes its section with it: setup left, managing and danger right', async (t) => {
  const { dom } = bootRound(t, 'programmheft');
  await dom.call('showRoundSettings', RID);
  const heads = (sel) => [...dom.app.querySelectorAll(`${sel} > .rs-ph__sec > h2`)].map(text);
  assert.deepEqual(heads('.rs-ph__col:not(.rs-ph__col--act)'), [
    dom.run("t('newRound.nameLabel')"), dom.run("t('marker.title')"), dom.run("t('roundSettings.config')"), dom.run("t('savedFilters.title')"),
  ]);
  assert.deepEqual(heads('.rs-ph__col--act'), [
    dom.run("t('roundSettings.manage')"), dom.run("t('roundSettings.danger')"),
  ]);
  const danger = dom.app.querySelector('.rs-ph__col--act .rs-ph__sec--danger');
  assert.ok(danger.querySelector('.rs-danger .btn--danger'), 'the delete button did not move with its section');
  // Nothing left stranded after the page head: only the head, then the columns.
  assert.deepEqual([...dom.app.children].map((el) => el.className.split(' ')[0]).slice(-2), ['page-head', 'rs-ph']);
});

test('Klassisch takes none of the Programmheft columns', async (t) => {
  const { dom } = bootRound(t, 'klassisch');
  await dom.call('showRoundSettings', RID);
  assert.equal(dom.app.querySelector('.rs-ph, .rs-ph__sec'), null);
  assert.ok(dom.app.querySelector('.rs-cols .marker-cards'), 'the control: Klassisch\'s own composition rendered');
});

// --- P14 Freundeskreis, profile, inbox --------------------------------------

function bootAccount(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('refreshInboxBadge', () => {});
  dom.set('setInboxDot', () => {});
  dom.set('showHome', () => {});
  dom.set('toast', () => {});
  dom.set('isDemoAccount', () => false);
  dom.set('currentUserId', () => 'u-ada');
  dom.run('setContactAvailable(true)');
  dom.call('applyDesign', design);
  return dom;
}

const EVENTS = [
  { type: 'game_added', title: 'Wingspan', coverUrl: null, at: '2026-09-18T18:00:00Z', username: 'dora', avatar: null },
];

async function friends(t, design) {
  const dom = bootAccount(t, design);
  dom.set('accountApi', async (method, p) => {
    if (p === '/friends') {
      return { friends: [{ friendshipId: 'f1', userId: 'u-dora', username: 'dora', avatar: null, since: '2025-05-02T10:00:00Z' }], incoming: [], outgoing: [] };
    }
    if (p === '/friends/feed') return { friendCount: 1, events: EVENTS };
    return {};
  });
  await dom.call('showFriends');
  return dom;
}

test('the Freundeskreis lists its feed as rows; Klassisch keeps the tiles', async (t) => {
  const ph = await friends(t, 'programmheft');
  assert.equal(ph.app.querySelectorAll('.feed-list--rows .feed-row').length, 1);
  assert.equal(ph.app.querySelector('.e-grid'), null);
  assert.ok(ph.app.querySelector('.k-tiles .k-tile--add'), 'the add control must stay in the roster');

  const klassisch = await friends(t, 'klassisch');
  assert.equal(klassisch.app.querySelector('.feed-row'), null);
  assert.equal(klassisch.app.querySelectorAll('.e-grid .e-tile').length, 1);
});

async function profile(t, design, self) {
  const dom = bootAccount(t, design);
  dom.set('accountApi', async (method, p) => {
    if (p === '/profile/dora') {
      return { userId: 'u-dora', username: 'dora', avatar: null, self, friendship: self ? null : 'friends',
        // The route omits `username`/`avatar` from a profile's rows.
        events: EVENTS.map((ev) => ({ type: ev.type, title: ev.title, coverUrl: ev.coverUrl, at: ev.at })),
        nextCursor: null };
    }
    return { events: [], nextCursor: null };
  });
  await dom.call('showProfile', 'dora');
  return dom;
}

test('the profile prints its activity as rows without a face; a friend\'s rows keep the report flag', async (t) => {
  const friend = await profile(t, 'programmheft', false);
  const rows = [...friend.app.querySelectorAll('.profile-screen .feed-list--rows .feed-row')];
  assert.equal(rows.length, 1);
  assert.equal(friend.app.querySelector('.profile-screen .e-grid'), null);
  assert.equal(rows[0].querySelector('.feed-row__face'), null, 'every row is the <h1>\'s account — no face');
  assert.ok(rows[0].querySelector('.feed-item__report'), 'the report entry point is gone');

  const own = await profile(t, 'programmheft', true);
  const mine = [...own.app.querySelectorAll('.profile-screen .feed-list--rows .feed-row')];
  assert.equal(mine.length, 1);
  assert.equal(mine[0].querySelector('.feed-item__report'), null, 'no report flag on your own profile');

  const klassisch = await profile(t, 'klassisch', false);
  assert.equal(klassisch.app.querySelector('.feed-row'), null);
  assert.equal(klassisch.app.querySelectorAll('.profile-screen .e-grid .e-tile').length, 1);
});

const ITEMS = [
  { id: 'i1', type: 'round_invitation', read: false, createdAt: '2026-09-24T18:02:00Z',
    payload: { invitationId: 'inv1', roundName: 'Familie Berger', inviterUsername: 'mia', memberName: null } },
  { id: 'i2', type: 'something_else', read: true, createdAt: '2026-09-20T10:00:00Z', payload: {} },
];

async function inbox(t, design) {
  const dom = bootAccount(t, design);
  dom.set('accountApi', async (method, p) => (p === '/inbox' ? { items: ITEMS.map((i) => ({ ...i })) } : {}));
  dom.set('showRound', () => {});
  await dom.call('showInbox');
  return dom;
}

test('Das Programmheft composes the inbox rows; Klassisch does not', async (t) => {
  const ph = await inbox(t, 'programmheft');
  const rows = [...ph.app.querySelectorAll('.inbox-row')];
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.classList.contains('inbox-row--composed')), 'a row is not composed');
  assert.ok(rows[0].classList.contains('inbox-row--round-invitation'));
  assert.equal(rows[0].querySelector('.inbox-row__icon').getAttribute('aria-hidden'), 'true');

  const klassisch = await inbox(t, 'klassisch');
  assert.equal(klassisch.app.querySelector('.inbox-row--composed, .inbox-row__icon'), null);
});

// --- the stylesheet -----------------------------------------------------------

const SHEET = read('public/css/designs/programmheft.css')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1380')) return '/*#1380*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
// The section runs to the NEXT section header, not to the end of the file: a
// sibling slice appending after it is not #1380's.
const AFTER = SHEET.slice(SHEET.indexOf('/*#1380*/') + '/*#1380*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const GATE = ':root[data-design="programmheft"]:not([data-scheme="dark"])';

function topLevelParts(selector) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of selector) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

test('every rule of the #1380 section is gated on the light scheme', () => {
  assert.ok(SHEET.includes('/*#1380*/'), 'the section header moved — re-read this test');
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  assert.ok(flat.length > 60, `the scan found implausibly few rules (${flat.length})`);
  for (const [selector] of flat) {
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(GATE), `${part} reads gated tokens without the gate`);
    }
  }
});

test('the #1380 section spells no colour: every one is a token', () => {
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  const literal = flat.filter(([, body]) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(body)).map(([sel]) => sel);
  assert.deepEqual(literal, []);
});
