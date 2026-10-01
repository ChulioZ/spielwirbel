'use strict';

/* Die Brücke's shared vote and pass-device blind (#1241 — B4.5 Geteilte
 * Wertung and B4.6 Sichtblende at 1440, B6.9 and B6.10 at 390).
 *
 * Driven through the jsdom harness under Die Brücke AND Klassisch
 * (.claude/rules/testing-views-under-jsdom.md). jsdom applies no stylesheet, so
 * the layout was measured in a browser (see the PR); the stylesheet half here
 * pins the contracts the issue names — the 44px controls and the dark-scheme
 * gate on every rule of the section.
 *
 * Named for the design and the slice (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, declaredValue } = require('./support/css');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/bruecke.css'), 'utf8');
const HEAD = '/* ===== #1241 — Shared vote and the pass-device blind ===== */';
const GATE = ':root[data-design="bruecke"][data-scheme="dark"] ';

function section() {
  const start = RAW.indexOf(HEAD);
  assert.ok(start >= 0, 'the section header is the merge seam other Brücke slices rely on');
  const next = RAW.indexOf('/* ===== #', start + HEAD.length);
  return RAW.slice(start, next === -1 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
}
const bodyFor = (sel) => {
  const hit = rulesOf(section()).find(([s]) => s === GATE + sel);
  assert.ok(hit, `bruecke.css has no #1241 rule for ${sel}`);
  return hit[1];
};

const ME = 'user-me';
const roundFixture = () => ({
  id: 'r1',
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }],
  tags: [],
  sessions: [],
  games: [
    { id: 'g1', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
    { id: 'g2', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
    { id: 'g3', title: 'Dixit', minPlayers: 1, maxPlayers: 8 },
  ],
});
const sessionFixture = (over = {}) => ({
  id: 's1',
  createdAt: '2026-09-25T18:00:00.000Z',
  gameIds: ['g1', 'g2', 'g3'],
  memberIds: ['m1', 'm2', 'm3'],
  guests: [],
  votes: {},
  votedIds: ['m2'],
  done: false,
  cancelled: false,
  finished: false,
  winnerIds: [],
  chosenGameId: null,
  ...over,
});

const q = (dom, sel) => dom.app.querySelector(sel);
const qa = (dom, sel) => [...dom.app.querySelectorAll(sel)];
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

function boot(t, design, api = async () => roundFixture()) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('toast', () => {});
  dom.set('api', api);
  if (design) dom.call('applyDesign', design);
  return dom;
}

// ------------------------------------------------------------------ the blind

async function blind(t, design) {
  const dom = boot(t, design);
  // Clara is handed the device after Ben rated: the intro shows, and Ben's
  // column is the thing it must not give away.
  const clara = { id: 'm3', name: 'Clara', guest: false };
  await dom.call('startVoting', roundFixture(), sessionFixture(), roundFixture().games, [clara], {
    saveVotes: async () => {},
    onSaved: async () => {},
  });
  return dom;
}

test('the Brücke blind is bare: no top bar, no dock, no navigation', async (t) => {
  const dom = await blind(t, 'bruecke');
  const screen = q(dom, '.handover');
  assert.ok(screen.classList.contains('handover--bruecke'));
  assert.ok(dom.document.body.classList.contains('vote-screen'), 'the blind hides the top bar at every width');
  assert.equal(dom.document.querySelector('.dock'), null, 'no dock on the blind');
  assert.equal(dom.document.querySelector('.rail'), null, 'no Abschnittsleiste on the blind');
});

test('the blind speaks in the app\'s words, with the design\'s kicker', async (t) => {
  const dom = await blind(t, 'bruecke');
  assert.equal(text(q(dom, '.bruecke-blind__signal')), 'Eingehendes Signal');
  assert.equal(text(q(dom, '.handover__name')), 'Clara, du bist dran!');
  assert.equal(text(q(dom, '.handover__sub')), 'Die anderen schauen kurz weg.');
  assert.equal(text(q(dom, '#goBtn')), 'Los geht’s ›');
});

test('the blind shows no rating, no score and no game', async (t) => {
  const dom = await blind(t, 'bruecke');
  const screen = q(dom, '.handover');
  const words = text(screen);
  ['Azul', 'Catan', 'Dixit', 'Ben'].forEach((w) => assert.ok(!words.includes(w), `the blind names ${w}`));
  assert.equal(screen.querySelector('.vote-progress, .score-pill, .mood, .rating, .bruecke-raters'), null);
});

test('„Los geht\'s" opens the first card', async (t) => {
  const dom = await blind(t, 'bruecke');
  q(dom, '#goBtn').click();
  await flush();
  assert.equal(q(dom, '.handover'), null);
  assert.equal(q(dom, '.vote__title').textContent.trim(), 'Azul');
});

test('Klassisch keeps its handover card and its top bar', async (t) => {
  const dom = await blind(t);
  const screen = q(dom, '.handover');
  assert.ok(!screen.classList.contains('handover--bruecke'));
  assert.equal(q(dom, '.bruecke-blind__signal'), null);
  assert.ok(screen.querySelector('.vote-progress'));
  assert.ok(!dom.document.body.classList.contains('vote-screen'));
});

// ------------------------------------------------------------------ the shared vote

async function lobby(t, design, session = sessionFixture(), api) {
  const dom = boot(t, design, api);
  await dom.call('showSessionLobby', roundFixture(), session, false);
  t.after(() => dom.call('stopLobbyPoll'));
  return dom;
}
const childClasses = (dom) => [...q(dom, '.live-vote').children].map((c) => c.className.split(' ')[0]);

test('the columns read people → share → this device, in the DOM as on screen', async (t) => {
  const dom = await lobby(t, 'bruecke');
  assert.ok(q(dom, '.live-vote').classList.contains('live-vote--bruecke'));
  assert.deepEqual(childClasses(dom), [
    'page-head', 'live-vote__people', 'live-vote__panel', 'live-vote__actions', 'session-log',
  ].filter((c) => c !== 'session-log' || q(dom, '.session-log')));
});

test('the people panel is headed „Wer spielt mit?" with the count in words', async (t) => {
  const dom = await lobby(t, 'bruecke');
  assert.equal(text(q(dom, '.live-vote__people .bruecke-kicker')), 'Wer spielt mit?');
  assert.equal(text(q(dom, '.bruecke-lobby__count')), '1 von 3 gewertet');
  assert.deepEqual(qa(dom, '.live-person').map((p) => text(p.querySelector('.live-person__state'))), [
    'offen', 'abgestimmt', 'offen',
  ]);
});

test('the share panel holds the link and the code; the code says what it is for', async (t) => {
  const dom = await lobby(t, 'bruecke');
  const panel = q(dom, '.live-vote__panel');
  assert.ok(panel.querySelector('.live-vote__share'));
  assert.equal(text(panel.querySelector('.live-vote__qr')), 'QR-Code Scannen und mitbewerten');
  assert.equal(panel.querySelector('.live-vote__close'), null, 'closing is not part of sharing');
});

test('closing and the waiting line end the „this device" column', async (t) => {
  const dom = await lobby(t, 'bruecke');
  const actions = q(dom, '.live-vote__actions');
  const kids = [...actions.children];
  assert.ok(kids.at(-2).classList.contains('live-vote__close'));
  assert.ok(kids.at(-1).classList.contains('live-vote__waiting'));
  assert.equal(text(actions.querySelector('.live-vote__hotseat .field__label')), 'An diesem Gerät abstimmen');
});

test('„Deine Stimme ist da" sits with the people once your own vote is in', async (t) => {
  const dom = await lobby(t, 'bruecke', sessionFixture({ votedIds: ['m1'] }));
  assert.equal(text(q(dom, '.live-vote__people .live-vote__done')), 'Deine Stimme ist da. Fehlen noch die anderen.');
});

test('with every vote in there is nothing to share: no panel, and closing leads', async (t) => {
  const dom = await lobby(t, 'bruecke', sessionFixture({ votedIds: ['m1', 'm2', 'm3'] }));
  assert.equal(q(dom, '.live-vote__panel'), null);
  const close = q(dom, '.live-vote__actions .live-vote__close');
  assert.ok(close.classList.contains('btn--primary'));
});

test('the shared vote keeps the navigation: the Abschnittsleiste and the section strip', async (t) => {
  const dom = await lobby(t, 'bruecke');
  assert.ok(dom.app.querySelector(':scope > .rail'), 'the rail is the Abschnittsleiste from 1280px');
  assert.ok(dom.app.querySelector(':scope > .dock'));
  assert.ok(!dom.document.body.classList.contains('vote-screen'));
});

test('the link it shares is /vote/<token>', async (t) => {
  const dom = await lobby(t, 'bruecke', sessionFixture(), async (method, url) =>
    (url.endsWith('/vote-link') ? { token: 'tok123' } : roundFixture()));
  q(dom, '.live-vote__share').click();
  await flush();
  const field = dom.document.querySelector('#shareUrlField');
  assert.ok(field, 'no share sheet and no clipboard in jsdom, so the manual sheet shows the url');
  assert.match(field.value, /\/vote\/tok123$/);
});

test('Klassisch keeps its lobby: order, closing in the panel, no navigation', async (t) => {
  const dom = await lobby(t);
  assert.ok(!q(dom, '.live-vote').classList.contains('live-vote--bruecke'));
  assert.deepEqual(childClasses(dom).slice(0, 4), ['page-head', 'live-vote__people', 'live-vote__actions', 'live-vote__panel']);
  assert.ok(q(dom, '.live-vote__panel .live-vote__close'));
  assert.equal(text(q(dom, '.live-vote__qr')), 'QR-Code');
  assert.equal(q(dom, '.bruecke-kicker'), null);
  assert.equal(dom.app.querySelector(':scope > .rail'), null);
});

// ------------------------------------------------------------------ stylesheet

test('every control on both screens meets the 44px key target', () => {
  [
    '.live-vote--bruecke .live-person',
    '.live-vote--bruecke .live-vote__share',
    '.live-vote--bruecke .live-vote__qr',
    '.live-vote--bruecke .live-vote__hotseat-btn',
    '.live-vote--bruecke .live-vote__close',
    '.handover--bruecke .handover__back',
  ].forEach((sel) => assert.equal(declaredValue(bodyFor(sel), 'min-height'), 'var(--target-key)', sel));
  // „Los geht's" is larger than the key target, as both sheets draw it.
  assert.match(declaredValue(bodyFor('.handover--bruecke .handover__go'), 'min-height'), /^(64|76)px$/);
});

test('the blind is the night ground with stripes, and neither footer nor bar', () => {
  const page = bodyFor('body.vote-screen:has(.handover--bruecke)');
  assert.match(declaredValue(page, 'background-image'), /repeating-linear-gradient/);
  assert.equal(declaredValue(bodyFor('body.vote-screen:has(.handover--bruecke) .site-footer'), 'display'), 'none');
});

test('every rule in the #1241 section is gated on the dark scheme', () => {
  const rules = rulesOf(section());
  assert.ok(rules.length > 20, `only ${rules.length} rules found — did the parse break?`);
  const ungated = rules.flatMap(([sel]) => sel.split(/,(?![^(]*\))/).map((x) => x.trim()))
    .filter((x) => !x.startsWith('@') && !x.startsWith(GATE.trim()));
  assert.deepEqual(ungated, []);
});
