'use strict';

/* Forest's tier 2b (#1474, sheet Forest-F14-Tier2b): the round's Einstellungen
 * with the marker picker as ribbons, the profile's Spielerkarte, the
 * Freundeskreis and its feed, the inbox, „Was ist neu" and „Entdecken".
 *
 * Operator ruling „A design owns its layout": the views branch on
 * designIs('forest') only, and Klassisch's DOM must not move. That half is a
 * GOLDEN SNAPSHOT of the eight renders below, generated from the views BEFORE
 * #1474 touched them, and seen red against a build whose Forest branches were
 * made unconditional. Regenerate only for a change that deliberately alters
 * Klassisch:
 *   SPIELWIRBEL_UPDATE_GOLDEN=1 node --test test/forest-tier2b.test.js
 *
 * The pixels were judged in headless Chromium at 390 and 1440; what is pinned
 * here is what regresses silently —
 *   - the settings leaving the sheet's order (name, marker, tags left; the
 *     actions and the danger zone right), the picker offering anything but
 *     Forest's eight markers, or a pick that is not the /design screen's PATCH;
 *   - the selected marker losing its non-colour mark (the 3px ink frame);
 *   - the feed and the profile's activity leaving the row form, the inbox rows
 *     their composition, the news entries their kind, the statistics head its
 *     BGG attribution;
 *   - a rule of the #1474 section reading the gated colour block ungated, or
 *     spelling a colour instead of a token.
 */

process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');
const { designMarkers } = require('../public/js/designs');

const GOLDEN = path.join(__dirname, 'fixtures', 'forest-tier2b-klassisch-golden.json');
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const flush = () => new Promise((r) => setImmediate(r));

// --- fixtures ----------------------------------------------------------------

const RID = 'r1';
const ROUND = {
  id: RID,
  name: 'Donnerstagsrunde',
  marker: 2,
  background: null,
  tags: [{ id: 't1', name: 'Koop', icon: 'puzzle' }, { id: 't2', name: 'Strategie', icon: null }],
  providers: [],
  savedFilters: [],
  members: [{ id: 'm1', name: 'Anna' }],
  games: [{ id: 'g1', title: 'Azul', tagIds: ['t1'] }],
  sessions: [],
};

const EVENTS = [
  { type: 'game_added', title: 'Wingspan', coverUrl: null, at: '2026-09-18T18:00:00Z', username: 'dora', avatar: null },
  { type: 'session_won', title: 'Azul', coverUrl: null, at: '2026-09-12T20:00:00Z', username: 'dora', avatar: null },
];
const ITEMS = [
  { id: 'i1', type: 'round_invitation', read: false, createdAt: '2026-09-24T18:02:00Z',
    payload: { invitationId: 'inv1', roundName: 'Familie Berger', inviterUsername: 'mia', memberName: null } },
  { id: 'i2', type: 'friend_request', read: true, createdAt: '2026-09-22T10:00:00Z',
    payload: { requesterUsername: 'ben', friendshipId: 'f9' } },
  { id: 'i3', type: 'something_else', read: true, createdAt: '2026-09-20T10:00:00Z', payload: {} },
];
const STATS = {
  sessions: 64, wins: 17, winRate: 0.42, avgGiven: 3.8, rounds: 3, gamesPlayed: 21,
  bestGames: [{ title: 'Azul' }], bestScore: 0.6, bestPlays: 5,
  favorite: [{ title: 'Wingspan' }], favAvg: 4.6, badges: [],
};
const PLAYS = [{ at: '2026-09-12T20:00:00Z', title: 'Azul', won: true, newGame: false }];
const PUBLIC = {
  counters: { rounds: 3210, players: 9120, games: 18000, sessions: 12480 },
  games: {
    mostOwned: { title: 'Kaskadia', image: null, url: 'https://boardgamegeek.com/boardgame/1', shelves: 180 },
    playedWeek: { title: 'Azul', image: null, url: null, plays: 40 },
  },
};

function profilePayload(self) {
  return {
    userId: 'u-dora', username: 'dora', avatar: null, self, friendship: self ? null : 'friends',
    createdAt: '2025-09-01T10:00:00Z', stats: { ...STATS }, plays: self ? PLAYS : undefined,
    events: EVENTS.map((ev) => ({ type: ev.type, title: ev.title, coverUrl: ev.coverUrl, at: ev.at })),
    nextCursor: null,
  };
}

function boot(t, design) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  // The friend feed prints AGES („vor 2 Wochen") computed from Date.now(), so an
  // unpinned clock made the golden expire: it went red on 2026-10-09, eleven days
  // after the fixture's events, with no code changed. Pinned to a day the
  // golden's ages were recorded on.
  dom.run("Date.now = () => Date.parse('2026-10-06T12:00:00Z')");
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (method === 'PATCH' && /\/marker$/.test(url)) return { marker: body.index };
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return { ...ROUND };
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('refreshInboxBadge', () => {});
  dom.set('setInboxDot', () => {});
  dom.set('toast', () => {});
  dom.set('isDemoAccount', () => false);
  dom.set('currentUserId', () => 'u-ada');
  dom.run('setContactAvailable(true)');
  dom.set('fetch', async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(PUBLIC)) }));
  dom.set('accountApi', async (method, p) => {
    if (p === '/friends') {
      return {
        friends: [{ friendshipId: 'f1', userId: 'u-dora', username: 'dora', avatar: null, since: '2025-05-02T10:00:00Z' }],
        incoming: [{ friendshipId: 'f2', userId: 'u-ben', username: 'ben', avatar: null, since: '2026-09-22T10:00:00Z' }],
        outgoing: [],
      };
    }
    if (p === '/friends/feed') return { friendCount: 1, events: EVENTS.map((e) => ({ ...e })), nextCursor: null };
    if (p === '/inbox') return { items: ITEMS.map((i) => ({ ...i })) };
    if (p === '/profile/dora') return profilePayload(false);
    if (p === '/profile/ada') return { ...profilePayload(true), userId: 'u-ada', username: 'ada' };
    return { events: [], nextCursor: null };
  });
  return { dom, calls };
}

// --- Klassisch: the golden ---------------------------------------------------

function snapshot(root) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll('.rail, .dock').forEach((n) => n.remove());
  return clone.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}

const SCREENS = [
  ['settings', (dom) => dom.call('showRoundSettings', RID)],
  ['profile-own', (dom) => dom.call('showProfile', 'ada')],
  ['profile-friend', (dom) => dom.call('showProfile', 'dora')],
  ['friends', (dom) => dom.call('showFriends')],
  ['inbox', (dom) => dom.call('showInbox')],
  ['news', (dom) => dom.call('showNews')],
  ['entdecken', (dom) => dom.call('showEntdecken')],
];

async function renderAll(t, design) {
  const out = {};
  for (const [name, show] of SCREENS) {
    const { dom } = boot(t, design);
    await show(dom);
    await flush();
    out[name] = snapshot(dom.app);
  }
  return out;
}

test('Klassisch: Einstellungen, profile, Freundeskreis, inbox, news and Entdecken render exactly as before #1474', async (t) => {
  const now = await renderAll(t, 'klassisch');
  if (process.env.SPIELWIRBEL_UPDATE_GOLDEN === '1') {
    fs.writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(Object.keys(now), Object.keys(golden));
  for (const k of Object.keys(golden)) {
    assert.ok(golden[k].length > 200, `the golden for ${k} is implausibly small — the render did not happen`);
    assert.equal(now[k], golden[k], `Klassisch ${k} changed`);
  }
});

test('the snapshot can see Forest: those screens under it are NOT the golden', async (t) => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const forest = await renderAll(t, 'forest');
  for (const k of ['settings', 'profile-own', 'profile-friend', 'friends', 'inbox', 'news', 'entdecken']) {
    assert.notEqual(forest[k], golden[k], `Forest's ${k} is identical to Klassisch's`);
  }
});

// --- F14.1 Rundeneinstellungen ------------------------------------------------

test('Forest sets the Einstellungen in the sheet\'s order: name, marker, set-up left; actions, danger right', async (t) => {
  const { dom } = boot(t, 'forest');
  await dom.call('showRoundSettings', RID);
  const cols = dom.app.querySelector(':scope > .rs-fo');
  assert.ok(cols, 'no Forest composition');
  assert.deepEqual([...dom.app.children].map((el) => el.className.split(' ')[0]).slice(-3),
    ['back-row', 'page-head', 'rs-fo'], 'something was stranded outside the two columns');
  const [left, right] = cols.children;
  const heads = (col) => [...col.querySelectorAll(':scope > .rs-fo__card > .rs-section__h, :scope > .rs-fo__card > .rs-fo__label')].map(text);
  assert.deepEqual(heads(left), [
    dom.run("t('newRound.nameLabel')"), dom.run("t('marker.title')"),
    dom.run("t('roundSettings.config')"), dom.run("t('savedFilters.title')"),
  ]);
  assert.deepEqual(heads(right), [dom.run("t('roundSettings.manage')"), dom.run("t('roundSettings.danger')")]);
  assert.ok(right.lastElementChild.classList.contains('rs-fo__card--danger'));
  assert.ok(right.querySelector('.rs-danger .btn--danger'), 'the delete button did not move with its section');

  // The name field is a real labelled input carrying the round's name.
  const input = left.querySelector('#rsFoName');
  assert.equal(input.value, ROUND.name);
  assert.equal(left.querySelector('label[for="rsFoName"]').textContent, dom.run("t('newRound.nameLabel')"));

  // The marker card says the marker is the round's, seen in everyone's own design.
  const marker = left.querySelector('.rs-fo__card--marker');
  assert.equal(text(marker.querySelector('.rs-fo__note')), dom.run("t('marker.note')"));
  const swatches = [...marker.querySelectorAll('.marker-card')];
  const colours = designMarkers('forest').map((m) => m.color);
  assert.equal(swatches.length, 8);
  assert.deepEqual(swatches.map((b) => b.style.getPropertyValue('--marker')), colours);
  assert.deepEqual(swatches.map((b) => text(b)), designMarkers('forest').map((m) => dom.run(`t(${JSON.stringify(m.labelKey)})`)));
  assert.deepEqual(swatches.map((b) => b.getAttribute('aria-pressed')), colours.map((_, i) => String(i === ROUND.marker)));

  // The /design row went (the picker is here); the tags row stays, with the tags under it.
  const hrefs = [...dom.app.querySelectorAll('.rs-row[href]')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, [`/round/${RID}/tags`]);
  assert.deepEqual([...left.querySelectorAll('.rs-fo__tags .tag')].map(text), ['Koop', 'Strategie']);
});

test('a pick from the Forest picker is the /design screen\'s PATCH, and stays on Einstellungen', async (t) => {
  const { dom, calls } = boot(t, 'forest');
  await dom.call('showRoundSettings', RID);
  dom.app.querySelectorAll('.rs-fo__card--marker .marker-card')[5].click();
  await new Promise((r) => setTimeout(r, 20));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'no PATCH was sent');
  assert.equal(patch.url, `/api/rounds/${RID}/marker`);
  assert.equal(patch.body.index, 5);
  assert.ok(dom.app.querySelector('.rs-fo'), 'the pick navigated away from Einstellungen');
});

test('the name field saves on blur through saveRoundName, as on Das Programmheft', async (t) => {
  const { dom } = boot(t, 'forest');
  const saved = [];
  dom.set('saveRoundName', async (round, name) => { saved.push(name); return false; });
  await dom.call('showRoundSettings', RID);
  const input = dom.app.querySelector('#rsFoName');
  input.value = 'Freitagsrunde';
  input.dispatchEvent(new dom.window.FocusEvent('blur'));
  await flush();
  assert.deepEqual(saved, ['Freitagsrunde']);
  assert.equal(input.value, ROUND.name, 'a refused save must put the saved name back');
});

test('below co-owner the name card is absent, and the rest of the composition stands', async (t) => {
  const { dom } = boot(t, 'forest');
  dom.set('api', async (method, url) => (/^\/api\/rounds\/[^/]+$/.test(url) ? { ...ROUND, shared: true, role: 'editor' } : []));
  await dom.call('showRoundSettings', RID);
  assert.equal(dom.app.querySelector('.rs-fo__card--name'), null);
  assert.ok(dom.app.querySelector('.rs-fo__card--marker'));
});

// --- the account screens ------------------------------------------------------

test('Forest lists the Freundeskreis feed and the profile activity as rows', async (t) => {
  const { dom } = boot(t, 'forest');
  await dom.call('showFriends');
  assert.equal(dom.app.querySelectorAll('.feed-list--rows .feed-row').length, EVENTS.length);
  assert.equal(dom.app.querySelector('.e-grid'), null);
  // DOM order: the head, the waiting request, the roster, the feed last.
  const bands = [...dom.app.querySelectorAll('.friends-screen > .k-band')];
  assert.ok(bands[bands.length - 1].querySelector('.feed-list--rows'), 'the feed is not the last band');
  assert.ok(bands[bands.length - 2].querySelector('.k-tiles .k-tile--add'), 'the roster (with its add tile) must precede the feed');

  const p = boot(t, 'forest').dom;
  await p.call('showProfile', 'dora');
  assert.equal(p.app.querySelectorAll('.profile-screen .feed-list--rows .feed-row').length, EVENTS.length);
});

test('Forest composes the inbox rows, prints the news kind and heads Entdecken with the BGG mark', async (t) => {
  const { dom } = boot(t, 'forest');
  await dom.call('showInbox');
  const rows = [...dom.app.querySelectorAll('.inbox-row')];
  assert.equal(rows.length, ITEMS.length);
  assert.ok(rows.every((r) => r.classList.contains('inbox-row--composed')), 'a row is not composed');
  assert.equal(rows[0].querySelector('.inbox-row__icon').getAttribute('aria-hidden'), 'true');

  const n = boot(t, 'forest').dom;
  await n.call('showNews');
  const kinds = [...n.app.querySelectorAll('.news-entry__date .news-entry__kind')];
  assert.equal(kinds.length, n.app.querySelectorAll('.news-entry').length, 'every entry carries its kind');
  assert.equal(text(kinds[0]), n.run("t('news.kind.' + NEWS[0].kind)"));

  const s = boot(t, 'forest').dom;
  await s.call('showEntdecken');
  await flush();
  const bgg = s.app.querySelector('.lobby-head > img.lobby-head__bgg');
  assert.ok(bgg, 'no BGG mark in the head');
  assert.equal(bgg.getAttribute('alt'), 'Powered by BGG');
  assert.equal(s.app.querySelector('.lobby-head--felt'), null, 'Forest is not on felt');
});

// --- the stylesheet -----------------------------------------------------------

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'forest.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1474')) return '/*#1474*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
// The section runs to the NEXT section header, not to the end of the file: a
// sibling slice appending after it is not #1474's.
const AFTER = SHEET.slice(SHEET.indexOf('/*#1474*/') + '/*#1474*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const GATE = ':root[data-design="forest"]:not([data-scheme="dark"])';
const FLAT = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));

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

test('every rule of the #1474 section is gated on the light scheme', () => {
  assert.ok(SHEET.includes('/*#1474*/'), 'the section header moved — re-read this test');
  assert.ok(FLAT.length > 80, `the scan found implausibly few rules (${FLAT.length})`);
  for (const [selector] of FLAT) {
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(GATE), `${part} reads gated tokens without the gate`);
    }
  }
});

test('the #1474 section spells no colour: every one is a token', () => {
  const literal = FLAT.filter(([, body]) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(body)).map(([sel]) => sel);
  assert.deepEqual(literal, []);
});

test('the chosen marker is told apart without colour: a 3px ink frame over the others\' hairline', () => {
  const body = (sel) => (FLAT.find(([s]) => s === `${GATE} ${sel}`) || [])[1] || '';
  assert.match(body('.marker-card.is-active'), /box-shadow:\s*0 0 0 3px var\(--ink\)/);
  assert.match(body('.marker-card'), /box-shadow:\s*inset 0 0 0 1px var\(--line\)/, 'the others need a hairline, not the frame');
  // styles.css hides the check on every card but the chosen one; nothing here
  // may hide it on the chosen card too.
  assert.ok(!FLAT.some(([s, b]) => /\.ti\b/.test(s) && /marker-card/.test(s) && /(display:\s*none|visibility:\s*hidden)/.test(b)));
});
