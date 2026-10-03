'use strict';

/* Forest's shared vote and pass-device blind (#1469 — F4.5 Geteilte Wertung
 * and F4.6 Übergabe at 1440, F6.5 and F6.6 at 390).
 *
 * Driven through the jsdom harness under Forest
 * (.claude/rules/testing-views-under-jsdom.md). Klassisch's side is the golden
 * in test/programmheft-shared-vote-klassisch-golden.test.js, whose Forest
 * control proves it can see this slice. jsdom applies no stylesheet, so the
 * layout was measured in headless Chromium (see the PR); the stylesheet half
 * here pins the contracts the issue names — the blind's keys at 44px, the
 * row keys at 44px, and the fireflies only on the dusk.
 *
 * Named for the design and the slice (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, declaredValue } = require('./support/css');

const HEAD = '/* ===== #1469 — the shared vote and the pass-device blind ===== */';
const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/forest.css'), 'utf8');
function section() {
  const start = RAW.indexOf(HEAD);
  assert.ok(start >= 0, 'the #1469 section header is the merge seam other Forest slices rely on');
  const next = RAW.indexOf('/* ===== ', start + HEAD.length);
  return RAW.slice(start, next === -1 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
}
const F = ':root[data-design="forest"]:not([data-scheme="dark"]) ';
const bodyFor = (sel) => {
  const hit = rulesOf(section()).find(([s]) => s === F + sel);
  assert.ok(hit, `forest.css has no #1469 rule for ${sel}`);
  return hit[1];
};

const ME = 'user-me';
const roundFixture = () => ({
  id: 'r1',
  name: 'Donnerstagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna', userId: ME }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }, { id: 'm4', name: 'Dora' }],
  tags: [],
  sessions: [],
  games: [
    { id: 'g1', title: 'Nordlichter', minPlayers: 1, maxPlayers: 8 },
    { id: 'g2', title: 'Moorgeister', minPlayers: 1, maxPlayers: 8 },
    { id: 'g3', title: 'Salzwiesen', minPlayers: 1, maxPlayers: 8 },
  ],
  activity: [],
});
const sessionFixture = (over = {}) => ({
  id: 's1',
  createdAt: '2026-09-25T18:00:00.000Z',
  gameIds: ['g1', 'g2', 'g3'],
  memberIds: ['m1', 'm2', 'm3', 'm4'],
  guests: [],
  votes: {},
  votedIds: ['m2'],
  done: false,
  cancelled: false,
  finished: false,
  winnerIds: [],
  chosenGameId: null,
  events: [],
  ...over,
});

const q = (dom, sel) => dom.app.querySelector(sel);
const qa = (dom, sel) => [...dom.app.querySelectorAll(sel)];
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

function boot(t, design = 'forest', api = async () => roundFixture()) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('toast', () => {});
  dom.set('api', api);
  dom.run('Math.random = () => 0.5');
  dom.call('applyDesign', design);
  return dom;
}

// ------------------------------------------------------------------ the blind

async function blind(t, people, design = 'forest') {
  const dom = boot(t, design);
  await dom.call('startVoting', roundFixture(), sessionFixture(), roundFixture().games, people, {
    saveVotes: async () => {},
    onSaved: async () => {},
  });
  return dom;
}
const ben = { id: 'm2', name: 'Ben', guest: false };
const clara = { id: 'm3', name: 'Clara', guest: false };

test('the Forest blind is dusk and bare: no top bar, no dock, no navigation', async (t) => {
  const dom = await blind(t, [clara]);
  const screen = q(dom, '.handover');
  assert.ok(screen.classList.contains('handover--forest'));
  assert.equal(screen.getAttribute('style'), null, 'no person-colour fill: the blind is the dusk (E5)');
  assert.ok(dom.document.body.classList.contains('vote-screen'), 'the blind hides the top bar at every width');
  assert.equal(dom.document.querySelector('.dock'), null, 'no dock on the blind');
  assert.equal(dom.document.querySelector('.rail'), null, 'no section line on the blind');
});

test('the blind is the ring, the name, the sub-line and one big key — in the app\'s words', async (t) => {
  const dom = await blind(t, [clara]);
  assert.equal(text(q(dom, '.handover__name')), 'Clara, du bist dran!');
  assert.equal(q(dom, '.handover__name').tagName, 'H1');
  assert.equal(text(q(dom, '.handover__sub')), 'Die anderen schauen kurz weg.');
  assert.equal(text(q(dom, '#goBtn')), 'Los geht’s ›');
  const ring = q(dom, '.forest-blind__ring');
  assert.equal(ring.getAttribute('aria-hidden'), 'true', 'the name says who; the ring is its picture');
  assert.match(ring.getAttribute('style'), /--person:#[0-9a-f]{6}/i, 'the person\'s colour is the ring');
  assert.equal(text(ring), 'CL');
  const trees = q(dom, '.forest-blind__trees');
  assert.equal(trees.getAttribute('aria-hidden'), 'true');
  assert.equal(trees.textContent.trim(), '', 'the trees carry no text');
});

test('the blind shows no value and no game, and no progress bar', async (t) => {
  const dom = await blind(t, [clara]);
  const words = text(q(dom, '.handover'));
  ['Nordlichter', 'Moorgeister', 'Salzwiesen', 'Ben', 'Anna'].forEach((w) => assert.ok(!words.includes(w), `the blind names ${w}`));
  assert.equal(q(dom, '.handover').querySelector('.vote-progress, .score-pill, .mood, .rating'), null);
});

test('the first blind has no Zurück; a later one has it, first in the DOM as it is first on screen', async (t) => {
  const one = await blind(t, [clara]);
  assert.equal(q(one, '#backBtn'), null);
  const dom = await blind(t, [ben, clara]);
  q(dom, '#goBtn').click();
  for (let i = 0; i < 3; i++) {
    await flush();
    q(dom, '.rating .mood').click();
    await new Promise((r) => setTimeout(r, 900)); // the advance beat (vote-advance.js)
  }
  q(dom, '#sendBtn').click(); // the review (#1434) hands on to the next person
  await flush();
  const screen = q(dom, '.handover--forest');
  assert.ok(screen, 'the second person gets the dusk blind too');
  const back = screen.querySelector('#backBtn');
  assert.ok(back);
  assert.equal(screen.firstElementChild, back, 'Zurück sits top-left (F4.6, F6.6), so it leads the DOM');
  assert.equal(text(back), 'Zurück');
});

test('„Los geht\'s" opens the first card', async (t) => {
  const dom = await blind(t, [clara]);
  q(dom, '#goBtn').click();
  await flush();
  assert.equal(q(dom, '.handover'), null);
  assert.ok(q(dom, '.vote__title'));
});

// ------------------------------------------------------------------ the shared vote

async function lobby(t, session = sessionFixture(), handedOn = false, api) {
  const dom = boot(t, 'forest', api);
  await dom.call('showSessionLobby', roundFixture(), session, handedOn);
  t.after(() => dom.call('stopLobbyPoll'));
  return dom;
}
const blocks = (dom) => [...q(dom, '.live-vote').children].map((c) => c.className.split(' ')[0]);

test('the blocks read head → dusk cards → people → this device → share → closing', async (t) => {
  const dom = await lobby(t);
  assert.ok(q(dom, '.live-vote').classList.contains('live-vote--forest'));
  assert.deepEqual(blocks(dom).filter((c) => c !== 'session-log'),
    ['page-head', 'forest-lobby__cards', 'live-vote__people', 'live-vote__actions', 'live-vote__panel', 'btn']);
  assert.ok(q(dom, '.live-vote > .live-vote__close'), 'closing is the last block, as F6.5 ends on it');
});

test('the face-down cards are decoration: one dusk card per drawn game, no text', async (t) => {
  const dom = await lobby(t);
  const cards = q(dom, '.forest-lobby__cards');
  assert.equal(cards.getAttribute('aria-hidden'), 'true');
  assert.equal(cards.querySelectorAll('.forest-lobby__card').length, 3);
  assert.equal(cards.textContent.trim(), '');
});

test('the people card opens with the count and who is still missing', async (t) => {
  const dom = await lobby(t);
  const head = q(dom, '.live-vote__people').firstElementChild;
  assert.ok(head.classList.contains('forest-lobby__head'));
  assert.equal(text(head.querySelector('.forest-lobby__count')), '1 von 4 gewertet');
  assert.equal(text(head.querySelector('.live-vote__waiting')), 'Noch 3 Personen: Anna, Clara und Dora haben nicht gewertet.');
});

test('each person still open on this device gets „Für …" in their own row', async (t) => {
  const dom = await lobby(t);
  const rows = qa(dom, '.live-person');
  const byName = Object.fromEntries(rows.map((r) => [text(r.querySelector('.live-person__name')), r]));
  assert.equal(byName.Anna.querySelector('.live-vote__hotseat-btn'), null, 'your own seat leads below');
  assert.equal(byName.Ben.querySelector('.live-vote__hotseat-btn'), null, 'Ben has voted');
  assert.equal(text(byName.Clara.querySelector('.live-vote__hotseat-btn')), 'CL Für Clara');
  assert.equal(text(byName.Dora.querySelector('.live-vote__hotseat-btn')), 'DO Für Dora');
  assert.equal(text(byName.Ben.querySelector('.live-person__state')), 'abgestimmt');
  assert.equal(text(byName.Clara.querySelector('.live-person__state')), 'offen');
  assert.equal(q(dom, '.live-vote__hotseat'), null, 'the emptied list is gone');
  assert.equal(text(q(dom, '.live-vote__actions .forest-lobby__here')), 'An diesem Gerät abstimmen');
});

test('a key moved into a row still votes for that person, behind the dusk blind', async (t) => {
  const dom = await lobby(t);
  const row = qa(dom, '.live-person').find((r) => text(r.querySelector('.live-person__name')) === 'Dora');
  row.querySelector('.live-vote__hotseat-btn').click();
  await flush();
  assert.equal(text(q(dom, '.handover__name')), 'Dora, du bist dran!');
  assert.ok(q(dom, '.handover--forest'));
});

test('the share panel: its title, the code BEHIND its button, the link, the note — closing is not in it', async (t) => {
  const dom = await lobby(t);
  const panel = q(dom, '.live-vote__panel');
  const order = [...panel.querySelectorAll('.live-vote__panel-title, .live-vote__qr, .live-vote__share, .live-vote__panel-note')]
    .map((el) => el.className.split(' ').find((c) => c.startsWith('live-vote__')));
  assert.deepEqual(order, ['live-vote__panel-title', 'live-vote__qr', 'live-vote__share', 'live-vote__panel-note']);
  assert.equal(text(panel.querySelector('.live-vote__qr')), 'QR-Code Scannen und mitbewerten');
  assert.equal(panel.querySelector('svg'), null, 'no code is drawn on load');
  assert.equal(panel.querySelector('.live-vote__close, .live-vote__waiting'), null);
});

test('no QR request is made until its button is pressed', async (t) => {
  const calls = [];
  const api = async (method, url) => {
    calls.push(`${method} ${url}`);
    return url.endsWith('/vote-link/qr') ? { svg: '<svg data-code="1"></svg>' } : roundFixture();
  };
  const dom = await lobby(t, sessionFixture(), false, api);
  await flush();
  assert.deepEqual(calls.filter((c) => c.includes('vote-link')), [], 'rendering the lobby minted a link');
  q(dom, '.live-vote__qr').click();
  await flush();
  assert.deepEqual(calls.filter((c) => c.includes('vote-link')), ['POST /api/rounds/r1/sessions/s1/vote-link/qr']);
  assert.ok(dom.document.querySelector('.vote-qr__code svg[data-code]'), 'the code arrives in its sheet');
});

test('„Abstimmung beenden" stays enabled while people are still open', async (t) => {
  const dom = await lobby(t);
  const close = q(dom, '.live-vote__close');
  assert.equal(close.disabled, false);
  assert.ok(!close.classList.contains('btn--primary'), 'it leads only once nobody is open');
});

test('handed on: „Weiter zu …" leads and that person has no second key in their row', async (t) => {
  const dom = await lobby(t, sessionFixture({ votedIds: ['m1', 'm2'] }), true);
  const lead = q(dom, '.live-vote__actions').firstElementChild;
  assert.match(text(lead), /^\w+ Weiter zu (Clara|Dora)$/);
  const next = text(lead).endsWith('Clara') ? 'Clara' : 'Dora';
  const row = qa(dom, '.live-person').find((r) => text(r.querySelector('.live-person__name')) === next);
  assert.equal(row.querySelector('.live-vote__hotseat-btn'), null);
});

test('with every vote in there is nothing to share: no panel, and closing leads', async (t) => {
  const dom = await lobby(t, sessionFixture({ votedIds: ['m1', 'm2', 'm3', 'm4'] }));
  assert.equal(q(dom, '.live-vote__panel'), null);
  assert.ok(q(dom, '.live-vote').classList.contains('is-all-in'));
  assert.ok(q(dom, '.live-vote__close').classList.contains('btn--primary'));
  assert.equal(text(q(dom, '.forest-lobby__count')), '4 von 4 gewertet');
});

test('the shared vote keeps the navigation: the section line and the dock (F4.5, F6.5)', async (t) => {
  const dom = await lobby(t);
  assert.ok(dom.app.querySelector(':scope > .rail'));
  assert.ok(dom.app.querySelector(':scope > .dock'));
  assert.ok(!dom.document.body.classList.contains('vote-screen'));
});

test('Klassisch keeps its own lobby and handover (control)', async (t) => {
  const dom = boot(t, 'klassisch');
  await dom.call('showSessionLobby', roundFixture(), sessionFixture(), false);
  t.after(() => dom.call('stopLobbyPoll'));
  assert.equal(q(dom, '.live-vote--forest, .forest-lobby__cards'), null);
  assert.ok(q(dom, '.live-vote__hotseat'));
  const b = await blind(t, [clara], 'klassisch');
  assert.equal(q(b, '.handover--forest'), null);
  assert.match(q(b, '.handover').getAttribute('style'), /background:/);
});

// ------------------------------------------------------------------ stylesheet

test('the blind\'s keys and every lobby control meet the 44px key target', () => {
  [
    '.handover--forest .handover__back',
    '.live-vote--forest .live-person > .live-vote__hotseat-btn',
    '.live-vote.live-vote--forest .live-vote__panel .btn.live-vote__qr',
    '.live-vote--forest .live-vote__share',
  ].forEach((sel) => assert.equal(declaredValue(bodyFor(sel), 'min-height'), 'var(--target-key)', sel));
  assert.equal(declaredValue(bodyFor('.handover--forest .handover__back'), 'min-width'), 'var(--target-key)');
  // „Los geht's" is larger than the key target, as both sheets draw it.
  assert.equal(declaredValue(bodyFor('.handover.handover--forest .handover__go'), 'min-height'), '64px');
});

test('the blind is the dusk, edge to edge, and the firefly is its key', () => {
  const screen = bodyFor('.handover.handover--forest');
  assert.equal(declaredValue(screen, 'position'), 'fixed');
  assert.match(screen, /var\(--dusk\)/);
  assert.equal(declaredValue(bodyFor('.handover.handover--forest .handover__go'), 'background'), 'var(--firefly)');
});

test('every rule in the #1469 section is scoped to Forest\'s light scheme', () => {
  const rules = rulesOf(section());
  assert.ok(rules.length > 25, `only ${rules.length} rules found — did the parse break?`);
  const unscoped = rules.flatMap(([sel]) => sel.split(/,(?![^(]*\))/).map((x) => x.trim()))
    .filter((x) => !x.startsWith('@') && !x.startsWith(':root[data-design="forest"]:not([data-scheme="dark"])'));
  assert.deepEqual(unscoped, []);
});
