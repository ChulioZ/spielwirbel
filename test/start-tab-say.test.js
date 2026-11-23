'use strict';

/* The Start tab's stage SAYS where the round stands (#1854), in every design.

   Walked over DESIGN_REGISTRY × the five states of stageState, rendered through
   the real showRound in the jsdom harness (.claude/rules/testing-views-under-jsdom.md):
   the sentence, what lies on the table, and the state's primary. On top:

   - the draw stays secret while a vote runs — no drawn game's title or cover
     anywhere on the tab (the fixture keeps every drawn game off the other
     surfaces, so a leak can only come from the stage);
   - while a vote runs the chip row is gone and „Neue Session wirbeln" is the
     SECOND action;
   - nothing on the stage moves (a CSS-text assertion, since jsdom applies no
     stylesheet). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { DESIGN_REGISTRY } = require('../public/js/designs');
const { ROOT, rulesOf } = require('./support/css');

const DESIGNS = DESIGN_REGISTRY.map((d) => d.id);
const RID = 'r1';
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
/* Five games, each with its own cover file, so a cover can be traced to its
   game. Fewer than the suggestion floor, so „Wie wär's mit" is a sentence and
   names no game — the secrecy spec needs every drawn game off every surface. */
const GAMES = ['Azul', 'Carcassonne', 'Codenames', 'Dixit', 'Everdell']
  .map((title, i) => ({ id: 10 + i, title, image: `cover-${10 + i}.jpg`, minPlayers: 2, maxPlayers: 5, createdAt: '2026-01-02T10:00:00.000Z' }));
const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Cem' }];
// The one played evening: Everdell (14), which no draw below contains.
const PLAYED = {
  id: 'p1', createdAt: daysAgo(4), done: true, finished: true, gameIds: [14], chosenGameId: 14,
  winnerIds: ['m1'], memberIds: ['m1', 'm2', 'm3'], votes: { m1: { 14: { rating: 5 } } },
};
const VOTE = {
  id: 'v1', createdAt: daysAgo(0), done: false, finished: false, cancelled: false,
  gameIds: [10, 11, 12, 13], memberIds: ['m1', 'm2', 'm3'], votedIds: ['m2', 'm1'], votes: {},
};
const TABLE = {
  id: 't1', createdAt: daysAgo(0), done: true, finished: false, cancelled: false,
  gameIds: [11], chosenGameId: 11, memberIds: ['m1', 'm2', 'm3'], votes: {},
};
const round = (sessions, games = GAMES) => ({
  id: RID, name: 'Freitagsrunde', background: null, members: MEMBERS, games, sessions, tags: [], activity: [],
});
const STATES = {
  empty: () => round([], []),
  young: () => round([]),
  normal: () => round([PLAYED]),
  running: () => round([PLAYED, VOTE]),
  table: () => round([PLAYED, TABLE]),
};

async function hub(t, design, r) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design !== 'klassisch') dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async () => r);
  await dom.call('showRound', RID, 'start');
  return dom;
}
const pane = (dom) => [...dom.app.querySelectorAll('*')].filter((el) => !el.closest('.rail, .dock'));
const inPane = (dom, sel) => pane(dom).filter((el) => el.matches(sel));
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

const SENTENCE = {
  young: '5 Spiele warten auf eure erste Session.',
  normal: 'Was spielen wir heute?',
  running: 'Abstimmung läuft.',
  table: 'Auf dem Tisch: Carcassonne',
};

test('the registry is not empty, so the loops below cannot pass vacuously', () => {
  assert.ok(DESIGNS.length >= 6, `only ${DESIGNS.length} designs registered`);
});

for (const design of DESIGNS) {
  test(`${design}: every state says its sentence, lays its table and offers its primary`, async (t) => {
    for (const [kind, make] of Object.entries(STATES)) {
      const dom = await hub(t, design, make());
      const says = inPane(dom, '.hub-say');
      if (kind === 'empty') {
        assert.equal(says.length, 0, `${design}: a 0-game round says a sentence instead of its empty table`);
        // Die Brücke folds the empty table into its Missionskontrolle (B7.1).
        assert.equal(inPane(dom, '.empty--table, .bruecke-mission__state--empty').length, 1, `${design}: the empty table is gone`);
        continue;
      }
      assert.equal(says.length, 1, `${design}/${kind}: ${says.length} stage sentences`);
      const say = says[0];
      assert.ok(say.classList.contains(`hub-say--${kind}`), `${design}/${kind}: says ${say.className}`);
      const h2 = say.querySelector('h2.hub-say__line');
      assert.equal(h2 && text(h2), SENTENCE[kind], `${design}/${kind}: the sentence`);
      // The stage comes BEFORE the hub's own CTA.
      const cta = inPane(dom, '.hub-cta')[0];
      assert.ok(say.compareDocumentPosition(cta) & 4, `${design}/${kind}: the sentence sits below the CTA`);

      const table = say.querySelector('.hub-say__table');
      const go = say.querySelector('.hub-say__go');
      if (kind === 'young') {
        assert.equal(table.querySelectorAll('.hub-say__card').length, 5, `${design}: not the first five covers`);
        assert.equal(go, null, `${design}/young: the hub's CTA is the primary`);
      } else if (kind === 'normal') {
        assert.equal(table, null, `${design}/normal: the stage drew a second „Zuletzt"`);
        assert.equal(go, null, `${design}/normal: the hub's CTA is the primary`);
      } else if (kind === 'running') {
        assert.equal(table.querySelectorAll('.hub-say__card--back').length, 3, `${design}: not three face-down cards`);
        assert.equal(text(table.querySelector('.hub-say__more')), '+1', `${design}: the fourth game is not „+1"`);
        assert.equal(text(say.querySelector('.hub-say__sub')), '4 Spiele im Topf · Anna und Ben haben gewählt');
        assert.equal(go.tagName, 'BUTTON');
        assert.equal(text(go), 'Weiter abstimmen');
      } else if (kind === 'table') {
        assert.match(table.querySelector('.hub-say__card').getAttribute('style') || '', /cover-11\.jpg/, `${design}: the chosen game's cover`);
        assert.equal(go.tagName, 'A');
        assert.equal(go.getAttribute('href'), `/round/${RID}/session/t1`);
        assert.equal(text(go), 'Ergebnis eintragen');
      }
      if (table) assert.equal(table.getAttribute('aria-hidden'), 'true', `${design}/${kind}: the table is announced`);
      // One primary per state, the stage's own while a session is open.
      const busy = kind === 'running' || kind === 'table';
      assert.equal(cta.classList.contains('btn--primary'), !busy, `${design}/${kind}: the CTA's rank`);
      assert.equal(cta.classList.contains('hub-cta--second'), busy, `${design}/${kind}: the CTA's rank`);
    }
  });

  test(`${design}: while a vote runs the draw stays secret, the chips are gone, „Neue Session wirbeln" is second`, async (t) => {
    const dom = await hub(t, design, STATES.running());
    const drawn = GAMES.filter((g) => VOTE.gameIds.includes(g.id));
    const all = pane(dom);
    const tab = all.map((el) => el.textContent).join(' ');
    for (const g of drawn) {
      assert.ok(!tab.includes(g.title), `${design}: the drawn „${g.title}" appears on the Start tab`);
      const leak = all.find((el) => [...el.attributes].some((a) => a.value.includes(g.image) || a.value.includes(g.title)));
      assert.equal(leak, undefined, `${design}: ${g.title}'s cover or title rides an attribute of ${leak && leak.className}`);
    }
    // Anti-vacuous: the same probe finds the PLAYED game, which is allowed.
    assert.ok(tab.includes('Everdell') || all.some((el) => (el.getAttribute('style') || '').includes('cover-14.jpg')),
      `${design}: the probe cannot see a game at all`);

    assert.equal(inPane(dom, '.hub-presets, .hub-preset').length, 0, `${design}: a preset chip while a vote runs`);
    const cta = inPane(dom, '.hub-cta')[0];
    assert.equal(text(cta), 'Neue Session wirbeln', `${design}: the second action's label`);
    assert.ok(dom.app.querySelector('.hub-say__go').compareDocumentPosition(cta) & 4, `${design}: the second action leads`);
  });
}

test('„Weiter abstimmen" opens the lobby of the session the stage speaks for', async (t) => {
  const dom = await hub(t, 'klassisch', STATES.running());
  const seen = [];
  dom.set('showSessionLobby', (r, s) => seen.push(s.id));
  dom.app.querySelector('.hub-say__go').click();
  assert.deepEqual([...seen], ['v1']);
});

test('past three voters the sub-line counts them, and nobody voted says so', async (t) => {
  const crowd = [...MEMBERS, { id: 'm4', name: 'Dana' }];
  const many = { ...VOTE, memberIds: crowd.map((m) => m.id), votedIds: ['m1', 'm2', 'm3', 'm4'] };
  const r = { ...round([PLAYED, many]), members: crowd };
  let dom = await hub(t, 'klassisch', r);
  assert.equal(text(dom.app.querySelector('.hub-say__sub')), '4 Spiele im Topf · 4 von 4 haben gewählt');
  dom = await hub(t, 'klassisch', round([PLAYED, { ...VOTE, votedIds: [] }]));
  assert.equal(text(dom.app.querySelector('.hub-say__sub')), '4 Spiele im Topf · Noch hat niemand gewählt');
  dom = await hub(t, 'klassisch', round([PLAYED, { ...VOTE, votedIds: ['m3'] }]));
  assert.equal(text(dom.app.querySelector('.hub-say__sub')), '4 Spiele im Topf · Cem hat gewählt');
});

test('a second open session stays a ticket under the stage', async (t) => {
  const older = { ...TABLE, createdAt: daysAgo(1) };
  const dom = await hub(t, 'klassisch', round([PLAYED, older, VOTE]));
  assert.ok(dom.app.querySelector('.hub-say--running'), 'the stage does not speak for the newest');
  const tickets = inPane(dom, '.ticket--live');
  assert.equal(tickets.length, 1, 'the older open session lost its ticket — or the newest kept one');
  assert.ok(dom.app.querySelector('.hub-say').compareDocumentPosition(tickets[0]) & 4, 'the ticket sits above the stage');
});

test('a stage card is the containing block of its no-cover placeholder', () => {
  /* .cover-ph is position: absolute. Without this the placeholder of a game
     with no cover escaped the card and stretched the page by ~240px on a young
     round — invisible to jsdom, which applies no stylesheet. */
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const body = (rulesOf(css).find(([sel]) => sel === '.hub-say__card') || [])[1] || '';
  assert.match(body, /position:\s*relative/, '.hub-say__card is not positioned');
});

test('nothing on the stage moves: no animation and no transition in any sheet', () => {
  const sheets = ['public/styles.css', ...fs.readdirSync(path.join(ROOT, 'public/css/designs')).map((f) => `public/css/designs/${f}`)];
  let seen = 0;
  for (const file of sheets) {
    const css = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [sel, body] of rulesOf(css)) {
      if (!/\.hub-say[\w-]*|\.hub-cta--second/.test(sel)) continue;
      seen += 1;
      assert.doesNotMatch(body, /\b(animation|transition)\s*:/, `${file}: ${sel.replace(/\s+/g, ' ')} moves`);
    }
  }
  assert.ok(seen >= 8, `only ${seen} stage rules found — did the parse break?`);
});
