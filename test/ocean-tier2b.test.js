'use strict';

/* Ocean's tier 2b (#1219, O14.1–O14.4): the round's Einstellungen with the
 * marker picker, the Freundeskreis and its feed, the inbox, „Was ist neu",
 * Konto and the signed-in statistics.
 *
 * The markup is rendered through the jsdom harness under Ocean AND Klassisch:
 * every Ocean composition is also asserted absent under Klassisch, whose DOM is
 * the default path and must not move. The pixels were judged in a browser at
 * 390 and 1440; what is pinned here is what regresses silently —
 *
 *   - the marker picker reading its colours from anything but member-colors.js
 *     (the issue's acceptance line — a hand-copied list is the palette bug);
 *   - a pick from the settings card not being the same PATCH the /design screen
 *     sends, or the card's own row to /design surviving beside it;
 *   - the danger zone leaving its own column, or a Konto section losing a form
 *     when it moves into a card;
 *   - a rule of the #1219 section reading the gated colour block ungated, or
 *     the base card rule out-ranking its own modifiers (it did, in the first
 *     cut: see the `:where()` note in ocean.css).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');
const { MEMBER_COLORS } = require('../public/js/member-colors');
const { designMarkers } = require('../public/js/designs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// --- the marker colours are the shared constant ------------------------------

test('Ocean\'s eight markers ARE member-colors.js, read rather than copied', () => {
  assert.deepEqual(designMarkers('ocean').map((m) => m.color), MEMBER_COLORS);
  // „Not a copy" is a claim about the SOURCE: no person colour may be spelled
  // in designs.js. Stripping comments first, so a comment naming one is fine.
  const src = read('public/js/designs.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const spelled = MEMBER_COLORS.filter((c) => src.toLowerCase().includes(c.toLowerCase()));
  assert.deepEqual(spelled, [], 'designs.js spells a member colour instead of reading PERSON_COLORS');
});

test('every page that loads designs.js loads member-colors.js before it', () => {
  for (const page of ['public/index.html', 'public/login.html', 'public/kontakt.html']) {
    const html = read(page);
    const colors = html.indexOf('src="/js/member-colors.js"');
    const designs = html.indexOf('src="/js/designs.js"');
    assert.ok(designs > 0, `${page} no longer loads designs.js — re-read this test`);
    assert.ok(colors > 0 && colors < designs, `${page} loads designs.js without member-colors.js ahead of it`);
  }
});

// --- O14.1 Rundeneinstellungen -----------------------------------------------

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

test('Ocean puts the marker picker on the settings screen, first, in the person colours', async (t) => {
  const { dom } = bootRound(t, 'ocean');
  await dom.call('showRoundSettings', RID);
  const main = dom.app.querySelector('.rs-ocean > .rs-ocean__main');
  assert.ok(main, 'no Ocean composition');
  const first = main.firstElementChild;
  assert.ok(first.classList.contains('rs-card--marker'), 'the marker card must lead (O14.1)');
  const swatches = [...first.querySelectorAll('.marker-card')];
  assert.deepEqual(swatches.map((b) => b.style.getPropertyValue('--marker')), MEMBER_COLORS);
  assert.deepEqual(swatches.map((b) => b.getAttribute('aria-pressed')),
    MEMBER_COLORS.map((_, i) => String(i === ROUND.marker)));
  assert.equal(text(first.querySelector('.rs-card__note')), dom.run("t('marker.note')"),
    'the card must say the marker is the round\'s, in the app\'s own sentence');

  // The row that led to the same eight swatches is gone; the tags row stays.
  const hrefs = [...dom.app.querySelectorAll('.rs-row[href]')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, [`/round/${RID}/tags`]);
});

test('a pick from the settings card is the /design screen\'s PATCH, and re-renders the settings', async (t) => {
  const { dom, calls } = bootRound(t, 'ocean');
  await dom.call('showRoundSettings', RID);
  dom.app.querySelectorAll('.rs-card--marker .marker-card')[5].click();
  await new Promise((r) => setTimeout(r, 20));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'no PATCH was sent');
  assert.equal(patch.url, `/api/rounds/${RID}/marker`);
  assert.equal(patch.body.index, 5);
  assert.ok(dom.app.querySelector('.rs-ocean'), 'the pick navigated away from Einstellungen');
});

test('every section becomes a card, and the danger zone gets a column of its own', async (t) => {
  const { dom } = bootRound(t, 'ocean');
  await dom.call('showRoundSettings', RID);
  const heads = (sel) => [...dom.app.querySelectorAll(`${sel} > .rs-card > h2`)].map(text);
  assert.deepEqual(heads('.rs-ocean__main'), [
    dom.run("t('marker.title')"), dom.run("t('roundSettings.config')"), dom.run("t('savedFilters.title')"),
    dom.run("t('roundSettings.manage')"),
  ]);
  assert.deepEqual(heads('.rs-ocean__aside'), [dom.run("t('roundSettings.danger')")]);
  const danger = dom.app.querySelector('.rs-ocean__aside .rs-card--danger');
  assert.ok(danger.querySelector('.rs-danger .btn--danger'), 'the delete button did not move with its section');
  // Nothing left stranded outside the cards after the page head.
  const loose = [...dom.app.children].filter((el) => el.matches('h2, .ds-list, .rs-danger'));
  assert.deepEqual(loose, []);
});

test('Klassisch keeps its settings list, its marker row and no cards', async (t) => {
  const { dom } = bootRound(t, 'klassisch');
  await dom.call('showRoundSettings', RID);
  assert.equal(dom.app.querySelector('.rs-ocean, .rs-card, .marker-cards'), null);
  const hrefs = [...dom.app.querySelectorAll('.rs-row[href]')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, [`/round/${RID}/tags`, `/round/${RID}/design`]);
});

test('the /design screen still renders the same picker', async (t) => {
  const { dom } = bootRound(t, 'ocean');
  await dom.call('showMarker', RID);
  const swatches = [...dom.app.querySelectorAll('.marker-cards .marker-card')];
  assert.deepEqual(swatches.map((b) => b.style.getPropertyValue('--marker')), MEMBER_COLORS);
});

// --- O14.2 the Freundeskreis, the inbox -----------------------------------

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

const LISTS = {
  friends: [{ friendshipId: 'f1', userId: 'u-dora', username: 'dora', avatar: null, since: '2025-05-02T10:00:00Z' }],
  incoming: [],
  outgoing: [],
};
const EVENTS = [
  { type: 'game_added', title: 'Wingspan', coverUrl: null, at: '2026-09-18T18:00:00Z', username: 'dora', avatar: null },
];

async function friends(t, design) {
  const dom = bootAccount(t, design);
  dom.set('accountApi', async (method, p) => {
    if (p === '/friends') return LISTS;
    if (p === '/friends/feed') return { friendCount: 1, events: EVENTS };
    return {};
  });
  await dom.call('showFriends');
  return dom;
}

test('Ocean lists the feed as rows, Klassisch keeps its tiles', async (t) => {
  const ocean = await friends(t, 'ocean');
  assert.equal(ocean.app.querySelectorAll('.feed-list--rows .feed-row').length, 1);
  assert.equal(ocean.app.querySelector('.e-grid'), null);
  assert.ok(ocean.app.querySelector('.k-tiles .k-tile--add'), 'the add control must stay in the roster');

  const klassisch = await friends(t, 'klassisch');
  assert.equal(klassisch.app.querySelector('.feed-row'), null);
  assert.equal(klassisch.app.querySelectorAll('.e-grid .e-tile').length, 1);
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

test('Ocean and Der Tisch compose the inbox row the same way; Klassisch does not', async (t) => {
  for (const design of ['ocean', 'tisch']) {
    const dom = await inbox(t, design);
    const rows = [...dom.app.querySelectorAll('.inbox-row')];
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.classList.contains('inbox-row--composed')), `${design}: a row is not composed`);
    assert.ok(rows[0].classList.contains('inbox-row--round-invitation'));
    assert.equal(rows[0].querySelector('.inbox-row__icon').getAttribute('aria-hidden'), 'true');
  }
  const klassisch = await inbox(t, 'klassisch');
  assert.equal(klassisch.app.querySelector('.inbox-row--composed, .inbox-row__icon'), null);
});

// --- O14.3 Konto ------------------------------------------------------------

const ME = {
  id: 'u-ada', email: 'ada@example.test', username: 'ada', demo: false, avatar: null,
  statsVisible: true, notifyRoundInvitations: true, notifyFriendRequests: true, bgStats: false,
  bggUsername: null, design: 'ocean',
};

async function konto(t, design) {
  const dom = bootAccount(t, design);
  dom.run(`accountUser = ${JSON.stringify(ME)}`);
  dom.set('withAppConfig', (cb) => cb({ designs: ['klassisch', 'tisch', 'ocean'] }));
  dom.set('accountApi', async (method, p) => {
    if (p === '/me') return { ...ME, design };
    if (p === '/passkeys') return { passkeys: [] };
    return {};
  });
  await dom.call('showAccount');
  return dom;
}

test('Ocean puts every Konto section in a card and leaves the design card as it is', async (t) => {
  const dom = await konto(t, 'ocean');
  const cards = [...dom.app.querySelectorAll(':scope > .konto-card')];
  assert.ok(cards.length >= 6, `only ${cards.length} Konto cards`);
  // Every card opens with its own heading, and no heading is left outside one.
  for (const c of cards) {
    assert.ok(c.firstElementChild.matches('h2.konto-section__h') || c.classList.contains('install-section'));
  }
  assert.equal(dom.app.querySelectorAll(':scope > h2').length, 0, 'a section heading was left outside its card');
  // The forms moved with their headings.
  assert.ok(dom.app.querySelector('.konto-card .konto-facts'));
  assert.ok(dom.app.querySelector('.konto-card--danger .konto-danger .btn--danger'));
  assert.ok(dom.app.querySelector(':scope > .konto-design'), 'the design card must stay a card of its own');
  assert.equal(dom.app.querySelector('.konto-card .konto-design'), null, 'the design card was swallowed');
});

test('Klassisch renders Konto without cards', async (t) => {
  const dom = await konto(t, 'klassisch');
  assert.equal(dom.app.querySelector('.konto-card'), null);
  assert.ok(dom.app.querySelector(':scope > h2.konto-section__h'));
});

// --- the stylesheet -----------------------------------------------------------

const SHEET = read('public/css/designs/ocean.css')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => (c.includes('===== #1219') ? '/*#1219*/' : ''));
const SECTION = SHEET.slice(SHEET.indexOf('/*#1219*/') + '/*#1219*/'.length);
const GATE = ':root[data-design="ocean"]:not([data-scheme="dark"])';

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

test('every rule of the #1219 section is gated on the light scheme', () => {
  assert.ok(SHEET.includes('/*#1219*/'), 'the section header moved — re-read this test');
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  assert.ok(flat.length > 60, 'the scan found implausibly few rules');
  for (const [selector] of flat) {
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(GATE), `${part} reads gated tokens without the gate`);
    }
  }
});

test('the shared card and kicker rules weigh nothing beyond the gate, so modifiers win', () => {
  // An :is() list weighs as its heaviest member (.claude/rules/
  // is-list-takes-its-most-specific-member.md); the card list holds a
  // `.app > .ds-list:has(…)`, which put the danger card's edge under the base.
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  const base = flat.filter(([sel]) => sel.includes('.rs-card, .konto-card, .friends-screen .k-band'));
  assert.ok(base.length >= 1, 'the shared card rule moved — re-read this test');
  for (const [sel] of base) assert.ok(sel.startsWith(`${GATE} :where(`), `${sel} is not :where()`);
  const kicker = flat.find(([sel]) => sel.includes('.rs-card > .rs-section__h'));
  assert.ok(kicker && kicker[0].startsWith(`${GATE} :where(`), 'the kicker rule is not :where()');
});

test('the #1219 section spells no colour: every one is a token', () => {
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  const literal = flat.filter(([, body]) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(body)).map(([sel]) => sel);
  assert.deepEqual(literal, []);
});
