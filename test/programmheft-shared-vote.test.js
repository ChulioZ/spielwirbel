'use strict';

/* Das Programmheft's shared vote and pass-device blind (#1375 — P4.5
 * Geteilte Wertung and P4.6 Übergabe at 1440, P6.5 and P6.6 at 390).
 *
 * Driven through the jsdom harness under Das Programmheft
 * (.claude/rules/testing-views-under-jsdom.md). Klassisch's side is
 * test/programmheft-shared-vote-klassisch-golden.test.js. jsdom applies no
 * stylesheet, so the layout was measured in a browser (see the PR); the
 * stylesheet half here pins the contracts the issue names — the blind's
 * control at the 44px key target and the bare screen.
 *
 * Named for the design and the slice (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { rulesOf, declaredValue } = require('./support/css');

const HEAD = '/* ===== #1375 — the shared vote and the pass-device blind ===== */';
const RAW = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/programmheft.css'), 'utf8');
function section() {
  const start = RAW.indexOf(HEAD);
  assert.ok(start >= 0, 'the section header is the merge seam other Programmheft slices rely on');
  const next = RAW.indexOf('/* ===== #', start + HEAD.length);
  return RAW.slice(start, next === -1 ? undefined : next).replace(/\/\*[\s\S]*?\*\//g, '');
}
const P = ':root[data-design="programmheft"] ';
const bodyFor = (sel) => {
  const hit = rulesOf(section()).find(([s]) => s === P + sel);
  assert.ok(hit, `programmheft.css has no #1375 rule for ${sel}`);
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

function boot(t, design = 'programmheft', api = async () => roundFixture()) {
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

async function blind(t, people) {
  const dom = boot(t);
  await dom.call('startVoting', roundFixture(), sessionFixture(), roundFixture().games, people, {
    saveVotes: async () => {},
    onSaved: async () => {},
  });
  return dom;
}
const clara = { id: 'm3', name: 'Clara', guest: false };
const dora = { id: 'm4', name: 'Dora', guest: false };

test('the Programmheft blind is bare: no top bar, no dock, no navigation', async (t) => {
  const dom = await blind(t, [clara]);
  const screen = q(dom, '.handover');
  assert.ok(screen.classList.contains('handover--ph'));
  assert.ok(dom.document.body.classList.contains('vote-screen'), 'the blind hides the top bar at every width');
  assert.equal(dom.document.querySelector('.dock'), null, 'no dock on the blind (operator decision 8)');
  assert.equal(dom.document.querySelector('.rail'), null, 'no section line on the blind');
});

test('the blind is name, colour and the call — in the app\'s words, between two bands', async (t) => {
  const dom = await blind(t, [clara]);
  const screen = q(dom, '.handover');
  assert.equal(qa(dom, '.handover > .ph-blind__band').length, 2);
  assert.ok(screen.firstElementChild.classList.contains('ph-blind__band'));
  assert.ok(screen.lastElementChild.classList.contains('ph-blind__band'));
  assert.equal(text(q(dom, '.handover__name')), 'Clara, du bist dran!');
  assert.equal(text(q(dom, '.handover__sub')), 'Die anderen schauen kurz weg.');
  assert.equal(text(q(dom, '#goBtn')), 'Los geht’s ›');
  const swatch = q(dom, '.ph-blind__swatch');
  assert.equal(swatch.getAttribute('aria-hidden'), 'true');
  assert.equal(swatch.textContent, '', 'the colour carries no text (P1 rule 1)');
  assert.match(swatch.getAttribute('style'), /--person:#[0-9a-f]{6}/i);
});

test('one person handed the device gets no count; a sequence gets „Person n von N"', async (t) => {
  const one = await blind(t, [clara]);
  assert.equal(q(one, '.ph-blind__kicker'), null, '„Person 1 von 1" would count nothing');
  // The run order is shuffled, so the count must follow the run, not the list
  // it was handed: whoever's blind comes first is Person 1 — under either draw.
  for (const draw of [0, 0.99]) {
    const dom = boot(t);
    dom.run(`Math.random = () => ${draw}`);
    await dom.call('startVoting', roundFixture(), sessionFixture(), roundFixture().games, [clara, dora], {
      saveVotes: async () => {},
      onSaved: async () => {},
    });
    assert.equal(text(q(dom, '.ph-blind__kicker')), 'Person 1 von 2', `draw ${draw}: ${text(q(dom, '.handover__name'))}`);
  }
});

test('the blind shows no rating, no score and no game', async (t) => {
  const dom = await blind(t, [clara]);
  const words = text(q(dom, '.handover'));
  ['Nordlichter', 'Moorgeister', 'Salzwiesen', 'Ben'].forEach((w) => assert.ok(!words.includes(w), `the blind names ${w}`));
  assert.equal(q(dom, '.handover').querySelector('.vote-progress, .score-pill, .mood, .rating, .handover__avatar'), null);
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
  const dom = boot(t, 'programmheft', api);
  await dom.call('showSessionLobby', roundFixture(), session, handedOn);
  t.after(() => dom.call('stopLobbyPoll'));
  return dom;
}
const blocks = (dom) => [...q(dom, '.live-vote').children].map((c) => c.className.split(' ')[0]);

test('the blocks read people → share → this device, in the DOM as on the phone', async (t) => {
  const dom = await lobby(t);
  assert.ok(q(dom, '.live-vote').classList.contains('live-vote--ph'));
  assert.deepEqual(blocks(dom).filter((c) => c !== 'session-log'),
    ['page-head', 'live-vote__people', 'live-vote__panel', 'live-vote__actions']);
});

test('the head: the marker rule, „Extrablatt", the title and the count in words', async (t) => {
  const dom = await lobby(t);
  const head = q(dom, '.live-vote > .page-head');
  assert.ok(head.firstElementChild.classList.contains('ph-rule'));
  assert.equal(text(head.querySelector('.ph-lobby__kicker')), 'Extrablatt');
  assert.equal(text(head.querySelector('h1')), 'Abstimmung läuft');
  assert.equal(head.querySelectorAll('h1').length, 1);
  assert.equal(text(head.querySelector('.ph-lobby__numeral')), '1 / 4');
  assert.equal(head.querySelector('.ph-lobby__numeral').getAttribute('aria-hidden'), 'true');
  assert.equal(text(head.querySelector('.ph-lobby__words')), '1 von 4 gewertet');
});

test('each person still open on this device gets „Für …" in their own row', async (t) => {
  const dom = await lobby(t);
  const rows = qa(dom, '.live-person');
  const byName = Object.fromEntries(rows.map((r) => [text(r.querySelector('.live-person__name')), r]));
  // Anna is you (your own seat leads below); Ben has voted; Clara and Dora are open.
  assert.equal(byName.Anna.querySelector('.live-vote__hotseat-btn'), null);
  assert.equal(byName.Ben.querySelector('.live-vote__hotseat-btn'), null);
  assert.equal(text(byName.Clara.querySelector('.live-vote__hotseat-btn')), 'CL Für Clara');
  assert.equal(text(byName.Dora.querySelector('.live-vote__hotseat-btn')), 'DO Für Dora');
  assert.equal(q(dom, '.live-vote__hotseat'), null, 'the emptied list is gone');
  assert.equal(text(q(dom, '.live-vote__people .ph-lobby__here')), 'An diesem Gerät abstimmen');
});

test('a key moved into a row still votes for that person', async (t) => {
  const dom = await lobby(t);
  const row = qa(dom, '.live-person').find((r) => text(r.querySelector('.live-person__name')) === 'Dora');
  row.querySelector('.live-vote__hotseat-btn').click();
  await flush();
  assert.equal(text(q(dom, '.handover__name')), 'Dora, du bist dran!');
  assert.ok(q(dom, '.handover--ph'), 'and the device goes behind the programme\'s blind');
});

test('„Deine Stimme ist da" leads the people; the waiting line follows them', async (t) => {
  const dom = await lobby(t, sessionFixture({ votedIds: ['m1', 'm2'] }));
  const people = q(dom, '.live-vote__people');
  assert.equal(text(people.firstElementChild), 'Deine Stimme ist da. Fehlen noch die anderen.');
  assert.equal(text(people.querySelector('.live-vote__waiting')), 'Noch 2 Personen: Clara und Dora haben nicht gewertet.');
});

test('the share panel holds the link and the code; closing is not part of sharing', async (t) => {
  const dom = await lobby(t);
  const panel = q(dom, '.live-vote__panel');
  assert.equal(text(panel.querySelector('.live-vote__panel-title')), 'Am eigenen Gerät mitstimmen');
  assert.ok(panel.querySelector('.live-vote__share'));
  assert.equal(text(panel.querySelector('.live-vote__qr')), 'QR-Code Scannen und mitbewerten');
  assert.equal(panel.querySelector('.live-vote__close, .live-vote__waiting'), null);
});

test('„Abstimmung beenden" ends the this-device block, after the leading key', async (t) => {
  const dom = await lobby(t);
  const kids = [...q(dom, '.live-vote__actions').children];
  assert.ok(kids[0].classList.contains('live-vote__mine'), 'your own seat leads');
  assert.ok(kids.at(-1).classList.contains('live-vote__close'));
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
  assert.ok(q(dom, '.live-vote__actions .live-vote__close').classList.contains('btn--primary'));
  assert.equal(text(q(dom, '.ph-lobby__numeral')), '4 / 4');
});

test('the shared vote keeps the navigation: the section line and the dock', async (t) => {
  const dom = await lobby(t);
  assert.ok(dom.app.querySelector(':scope > .rail'));
  assert.ok(dom.app.querySelector(':scope > .dock'), 'P6.5 draws the dock');
  assert.ok(!dom.document.body.classList.contains('vote-screen'));
});

test('the link it shares is /vote/<token>', async (t) => {
  const dom = await lobby(t, sessionFixture(), false, async (method, url) =>
    (url.endsWith('/vote-link') ? { token: 'tok123' } : roundFixture()));
  q(dom, '.live-vote__share').click();
  await flush();
  const field = dom.document.querySelector('#shareUrlField');
  assert.ok(field, 'no share sheet and no clipboard in jsdom, so the manual sheet shows the url');
  assert.match(field.value, /\/vote\/tok123$/);
});

// ------------------------------------------------------------------ stylesheet

test('every control on both screens meets the 44px key target', () => {
  [
    '.live-vote--ph .live-person > .live-vote__hotseat-btn',
    '.live-vote--ph .live-vote__qr',
    '.live-vote--ph .live-vote__share',
    '.live-vote--ph .live-vote__actions .btn',
    '.handover--ph .handover__back',
  ].forEach((sel) => assert.equal(declaredValue(bodyFor(sel), 'min-height'), 'var(--target-key)', sel));
  // „Los geht's" is larger than the key target, as both sheets draw it.
  assert.equal(declaredValue(bodyFor('.handover.handover--ph .handover__go'), 'min-height'), '64px');
});

test('the blind hides the footer, and its bands are fixed to the viewport edges', () => {
  assert.equal(declaredValue(bodyFor('body.vote-screen:has(.handover--ph) .site-footer'), 'display'), 'none');
  assert.equal(declaredValue(bodyFor('.ph-blind__band'), 'position'), 'fixed');
});

test('every rule in the #1375 section is scoped to the design', () => {
  const rules = rulesOf(section());
  assert.ok(rules.length > 40, `only ${rules.length} rules found — did the parse break?`);
  const unscoped = rules.flatMap(([sel]) => sel.split(/,(?![^(]*\))/).map((x) => x.trim()))
    .filter((x) => !x.startsWith('@') && !x.startsWith(':root[data-design="programmheft"]'));
  assert.deepEqual(unscoped, []);
});
