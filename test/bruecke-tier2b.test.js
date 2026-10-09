'use strict';

/* Die Brücke's tier 2b (#1246, B14 + B6.6): the round's Einstellungen with the
 * marker picker inline, the Spielerkarte, the Freundeskreis and its feed, the
 * inbox, „Was ist neu" and the statistics — and „← Zurück zu meinen Runden" on
 * the account main pages, which wear no Abschnittsleiste.
 *
 * Rendered through the jsdom harness under Brücke AND Klassisch — every Brücke
 * branch must be absent from the default path. The pixels were judged in a
 * browser at 390 and 1440; what is pinned here is what regresses silently:
 *
 *   - the settings losing the issue's order („Einstellungen · Marker · Tags ·
 *     Einladen"), offering anything but the design's eight markers, a pick that
 *     is not the /design screen's PATCH, or the /design row surviving beside
 *     the inline picker;
 *   - the way up becoming a `.back-row` (these are MAIN pages — no back
 *     control, test/back-control.test.js), losing its destination, or leaking
 *     onto Klassisch or onto the profile, which keeps its one back control;
 *   - the Freundeskreis reading the roster before the feed (B14.2's left column
 *     is „Was lief"), or a request losing the lead;
 *   - a rule of the #1246 section reading a gated colour token ungated, or
 *     spelling a colour instead of a token.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');
const { designMarkers } = require('../public/js/designs');

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// --- B14.5 / B6.6 Rundeneinstellungen ----------------------------------------

const RID = 'r1';
const ROUND = {
  id: RID,
  name: 'Donnerstagsrunde',
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
  // Accounts on, so „Einladen" is offered — it is in the issue's row order.
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('toast', () => {});
  return { dom, calls };
}

test('Die Brücke reads „Einstellungen · Marker · Tags · Einladen", in its own eight markers', async (t) => {
  const { dom } = bootRound(t, 'bruecke');
  await dom.call('showRoundSettings', RID);
  const cols = dom.app.querySelector(':scope > .rs-br');
  assert.ok(cols, 'no Brücke composition');

  // The reading order the issue names, taken from the DOM as a reader meets it.
  const order = [
    text(dom.app.querySelector(':scope > .page-head h1')),
    text(cols.querySelector('.rs-br__plate--marker > h2')),
    ...[...cols.querySelectorAll('.rs-row')].map((r) => text(r)),
  ];
  assert.deepEqual(order.slice(0, 3), [
    dom.run("t('rail.settings')"), dom.run("t('marker.title')"), dom.run("t('round.tags')"),
  ]);
  assert.ok(order.indexOf(dom.run("t('invite.link')")) > order.indexOf(dom.run("t('round.tags')")),
    `„Einladen" must follow „Tags": ${order.join(' · ')}`);
  assert.equal(order.filter((s) => s === dom.run("t('marker.title')")).length, 1,
    'the /design row („Farbmarker") must not reappear beside the inline picker');

  const plate = cols.querySelector('.rs-br__col--marker > .rs-br__plate--marker');
  assert.ok(plate, 'the marker plate must lead the first column');
  const swatches = [...plate.querySelectorAll('.marker-card')];
  const colours = designMarkers('bruecke').map((m) => m.color);
  assert.equal(swatches.length, 8);
  assert.deepEqual(swatches.map((b) => b.style.getPropertyValue('--marker')), colours);
  assert.deepEqual(swatches.map((b) => b.getAttribute('aria-pressed')),
    colours.map((_, i) => String(i === ROUND.marker)));
  assert.equal(text(plate.querySelector('.rs-br__note')), dom.run("t('marker.note')"));

  // The /design row went (a new place replaces its entry point); the tags row stays.
  const hrefs = [...dom.app.querySelectorAll('.rs-row[href]')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, [`/round/${RID}/tags`]);
});

test('a pick from the Brücke picker is the /design screen\'s PATCH, and stays on Einstellungen', async (t) => {
  const { dom, calls } = bootRound(t, 'bruecke');
  await dom.call('showRoundSettings', RID);
  dom.app.querySelectorAll('.rs-br__plate--marker .marker-card')[5].click();
  await new Promise((r) => setTimeout(r, 20));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'no PATCH was sent');
  assert.equal(patch.url, `/api/rounds/${RID}/marker`);
  assert.equal(patch.body.index, 5);
  assert.ok(dom.app.querySelector('.rs-br'), 'the pick navigated away from Einstellungen');
});

test('every heading takes its section into a plate, and the Gefahrenzone comes last', async (t) => {
  const { dom } = bootRound(t, 'bruecke');
  await dom.call('showRoundSettings', RID);
  const heads = [...dom.app.querySelectorAll('.rs-br__col:not(.rs-br__col--marker) > .rs-br__plate > h2')].map(text);
  assert.deepEqual(heads, [
    dom.run("t('roundSettings.config')"), dom.run("t('savedFilters.title')"),
    dom.run("t('roundSettings.manage')"), dom.run("t('roundSettings.danger')"),
  ]);
  const plates = [...dom.app.querySelectorAll('.rs-br__plate')];
  const danger = plates[plates.length - 1];
  assert.ok(danger.classList.contains('rs-br__plate--danger'), 'the danger zone is not the last plate');
  assert.ok(danger.querySelector('.rs-danger .btn--danger'), 'the delete button did not move with its section');
  // Nothing stranded after the page head: the back row, the head, then the plates.
  assert.deepEqual([...dom.app.children].map((el) => el.className.split(' ')[0]).slice(-3),
    ['back-row', 'page-head', 'rs-br']);
});

test('Klassisch takes none of the Brücke plates', async (t) => {
  const { dom } = bootRound(t, 'klassisch');
  await dom.call('showRoundSettings', RID);
  assert.equal(dom.app.querySelector('.rs-br, .rs-br__plate'), null);
  assert.ok(dom.app.querySelector('.rs-cols .marker-cards'), 'the control: Klassisch\'s own composition rendered');
});

// --- the account screens ------------------------------------------------------

const EVENTS = [
  { type: 'game_added', title: 'Wingspan', coverUrl: null, at: '2026-09-18T18:00:00Z', username: 'dora', avatar: null },
];
const ITEMS = [
  { id: 'i1', type: 'round_invitation', read: false, createdAt: '2026-09-24T18:02:00Z',
    payload: { invitationId: 'inv1', roundName: 'Familie Berger', inviterUsername: 'mia', memberName: null } },
];

function bootAccount(t, design, { incoming = [] } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const home = [];
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('refreshInboxBadge', () => {});
  dom.set('setInboxDot', () => {});
  dom.set('showHome', () => home.push(1));
  dom.set('showRound', () => {});
  dom.set('toast', () => {});
  dom.set('isDemoAccount', () => false);
  dom.set('currentUserId', () => 'u-ada');
  dom.run('setContactAvailable(true)');
  dom.set('accountApi', async (method, p) => {
    if (p === '/friends') {
      return { friends: [{ friendshipId: 'f1', userId: 'u-dora', username: 'dora', avatar: null, since: '2025-05-02T10:00:00Z' }],
        incoming, outgoing: [] };
    }
    if (p === '/friends/feed') return { friendCount: 1, events: EVENTS };
    if (p === '/inbox') return { items: ITEMS.map((i) => ({ ...i })) };
    if (p === '/profile/dora') {
      return { userId: 'u-dora', username: 'dora', avatar: null, self: false, friendship: 'friends',
        events: EVENTS.map((ev) => ({ type: ev.type, title: ev.title, coverUrl: ev.coverUrl, at: ev.at })), nextCursor: null };
    }
    return { events: [], nextCursor: null };
  });
  dom.call('applyDesign', design);
  return { dom, home };
}

const ACCOUNT_MAIN = [
  ['freundeskreis', (dom) => dom.call('showFriends')],
  ['inbox', (dom) => dom.call('showInbox')],
  ['was ist neu', (dom) => dom.call('showNews')],
  ['entdecken', (dom) => dom.call('showEntdecken')],
];

for (const [name, render] of ACCOUNT_MAIN) {
  test(`the ${name} screen leads with „Zurück zu meinen Runden" under Brücke — a link home, not a back control`, async (t) => {
    const { dom, home } = bootAccount(t, 'bruecke');
    await render(dom);
    const first = dom.app.firstElementChild;
    assert.ok(first && first.classList.contains('bruecke-up'), `the ${name} screen does not start with the way up`);
    const link = first.querySelector('a');
    assert.equal(link.getAttribute('href'), '/', 'the way up is a real link to the lobby');
    assert.equal(text(link), dom.run("t('common.backToRounds')"));
    assert.equal(link.querySelector('.ti').getAttribute('aria-hidden'), 'true');
    assert.equal(dom.app.querySelectorAll('.back-row').length, 0, 'a main page carries no back control');
    link.click();
    assert.equal(home.length, 1, 'the link did not route home in-app');

    const klassisch = bootAccount(t, 'klassisch').dom;
    await render(klassisch);
    assert.equal(klassisch.app.querySelector('.bruecke-up'), null, `Klassisch's ${name} grew the Brücke link`);
  });
}

test('the profile keeps its one back control under Brücke, and lists its activity as faceless rows', async (t) => {
  const { dom } = bootAccount(t, 'bruecke');
  await dom.call('showProfile', 'dora');
  assert.equal(dom.app.querySelectorAll('.back-row').length, 1);
  assert.equal(dom.app.querySelector('.bruecke-up'), null, 'the profile is not a main page — its way out is back');
  const rows = [...dom.app.querySelectorAll('.profile-screen .feed-list--rows .feed-row')];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.feed-row__face'), null, 'every row is the <h1>\'s account — no face');
  assert.ok(rows[0].querySelector('.feed-item__report'), 'the report entry point is gone');
});

test('the Brücke Freundeskreis reads „Was lief" before the roster, with a request still first', async (t) => {
  const incoming = [{ friendshipId: 'f9', userId: 'u-mia', username: 'mia', avatar: null, since: '2026-09-01T10:00:00Z' }];
  const { dom } = bootAccount(t, 'bruecke', { incoming });
  await dom.call('showFriends');
  const bands = [...dom.app.querySelectorAll('.friends-screen > .k-band')];
  const at = (sel) => bands.findIndex((b) => b.querySelector(sel));
  assert.equal(at('.k-grid'), 0, 'a request must lead');
  assert.ok(at('.feed-list--rows .feed-row') > 0 && at('.feed-list--rows .feed-row') < at('.k-tiles'),
    'the feed must read before the roster');
  assert.ok(dom.app.querySelector('.k-tiles .k-tile--add'), 'the add control must stay in the roster');

  const klassisch = bootAccount(t, 'klassisch', { incoming }).dom;
  await klassisch.call('showFriends');
  const kb = [...klassisch.app.querySelectorAll('.friends-screen > .k-band')];
  assert.ok(kb.findIndex((b) => b.querySelector('.k-tiles')) < kb.findIndex((b) => b.querySelector('.e-grid')),
    'Klassisch keeps the roster before the feed');
  assert.equal(klassisch.app.querySelector('.feed-row'), null);
});

test('Die Brücke composes the inbox rows; Klassisch does not', async (t) => {
  const { dom } = bootAccount(t, 'bruecke');
  await dom.call('showInbox');
  const row = dom.app.querySelector('.inbox-row');
  assert.ok(row.classList.contains('inbox-row--composed'));
  assert.equal(row.querySelector('.inbox-row__icon').getAttribute('aria-hidden'), 'true');
  assert.ok(row.querySelector('.inbox-row__when'), 'the typed row lost its time');

  const klassisch = bootAccount(t, 'klassisch').dom;
  await klassisch.call('showInbox');
  assert.equal(klassisch.app.querySelector('.inbox-row--composed, .inbox-row__icon'), null);
});

// --- the stylesheet -----------------------------------------------------------

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8');
const SHEET = RAW.replace(/\/\*[\s\S]*?\*\//g, (c) => {
  if (c.includes('===== #1246')) return '/*#1246*/';
  return c.startsWith('/* ===== #') ? '/*§*/' : '';
});
// The section runs to the NEXT section header: a sibling slice is not #1246's.
const AFTER = SHEET.slice(SHEET.indexOf('/*#1246*/') + '/*#1246*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const FLAT = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
const VOICE = ':root[data-design="bruecke"]';
const DARK = ':root[data-design="bruecke"][data-scheme="dark"]';

const GATED_TOKENS = (() => {
  const body = rulesOf(SHEET).find(([sel]) => sel.trim() === DARK)[1];
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
})();

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

test('Brücke paints a friend face in its own person tone, never a raw palette hex under night ink', async (t) => {
  const { dom } = bootAccount(t, 'bruecke');
  await dom.call('showFriends');
  const faces = [...dom.app.querySelectorAll('.friends-screen .avatar')];
  assert.ok(faces.length >= 2, `implausibly few faces (${faces.length})`);
  const tones = new Set(designMarkers('bruecke').map((m) => m.color.toLowerCase()));
  for (const face of faces) {
    const bg = face.getAttribute('style').match(/background:\s*([^;]+)/)[1].trim().toLowerCase();
    assert.ok(tones.has(bg), `${bg} is not one of Brücke's person tones`);
  }

  const klassisch = bootAccount(t, 'klassisch').dom;
  await klassisch.call('showFriends');
  const kFace = klassisch.app.querySelector('.friends-screen .avatar');
  assert.equal(kFace.getAttribute('style'), `background:${klassisch.call('accountColor', 'dora')}`,
    'Klassisch keeps the raw palette hex');
});

test('the status line keys on the LOBBY head, which no account screen carries', async (t) => {
  const css = RAW.replace(/\/\*[\s\S]*?\*\//g, '');
  const status = css.split('\n').filter((l) => l.includes('.topbar[data-status]'));
  assert.ok(status.length >= 3, 'the status-line rules moved — re-read this test');
  for (const line of status) {
    assert.doesNotMatch(line, /\.lobby-head\)/, 'a bare .lobby-head matches every account screen');
    assert.match(line, /\.lobby-head--home\)/);
  }
  const { dom } = bootAccount(t, 'bruecke');
  await dom.call('showFriends');
  assert.ok(dom.app.querySelector('.lobby-head'), 'the friends screen lost its head — re-read this test');
  assert.equal(dom.app.querySelector('.lobby-head--home'), null);
});

test('every #1246 rule is scoped to Brücke, and every one reading a colour token is dark-gated', () => {
  assert.ok(SHEET.includes('/*#1246*/'), 'the section header moved — re-read this test');
  assert.ok(GATED_TOKENS.has('--ink-soft') && GATED_TOKENS.size > 30, 'the gated block was not found');
  assert.ok(FLAT.length > 100, `the scan found implausibly few rules (${FLAT.length})`);
  let gatedReads = 0;
  for (const [selector, body] of FLAT) {
    const reads = [...body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]).filter((v) => GATED_TOKENS.has(v));
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(VOICE), `${part} is not scoped to Brücke`);
      if (reads.length) assert.ok(part.startsWith(DARK), `${part} reads ${reads.join(', ')} without the dark gate`);
    }
    if (reads.length) gatedReads++;
  }
  assert.ok(gatedReads > 30, 'the scan saw implausibly few colour reads');
});

test('the #1246 section spells no colour: every one is a token', () => {
  const literal = FLAT.filter(([, body]) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(body)).map(([sel]) => sel);
  assert.deepEqual(literal, []);
});

test('„Zurück zu meinen Runden" reaches the 24px target through min-height, not line-height', () => {
  const rule = FLAT.find(([sel]) => sel.trim() === `${VOICE} .bruecke-up__link`);
  assert.ok(rule, 'the link rule is missing');
  assert.match(rule[1], /min-height:\s*var\(--target-min\)/);
  assert.match(RAW, /--target-min:\s*24px/, 'the token no longer says 24px');
});
