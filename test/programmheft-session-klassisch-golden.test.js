'use strict';

/* The Klassisch DOM of the session loop #1374 composes for Das Programmheft —
   Neue Session, the vote card, the result (a single winner, a tie, a session
   nobody voted in) and the several-tables split — pinned as a golden snapshot.

   Same licence and same price as test/programmheft-klassisch-golden.test.js:
   the views branch on designIs('programmheft'), and the proof that the branch is
   Programmheft's alone is a snapshot of the whole rendered screen, which sees an
   attribute moved or a wrapper added where a per-selector check sees only what
   someone thought to list.

   The golden was generated from the views BEFORE #1374 touched them, and was
   seen red once against a build whose Programmheft branch was made
   unconditional. Regenerate only for a change that deliberately alters
   Klassisch: SPIELWIRBEL_UPDATE_GOLDEN=1 node --test test/programmheft-session-klassisch-golden.test.js */

// The golden was captured in Europe/Berlin (the results print a local time);
// pinned so a runner in another zone (CI is UTC) renders the same snapshot.
process.env.TZ = 'Europe/Berlin';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');

const GOLDEN = path.join(__dirname, 'fixtures', 'programmheft-session-klassisch-golden.json');

const MEMBERS = [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }, { id: 'm3', name: 'Clara' }];
const GAMES = [
  { id: 'g1', title: 'Nordlichter', minPlayers: 2, maxPlayers: 5, minPlaytime: 90, maxPlaytime: 90, ownerIds: ['m1'] },
  { id: 'g2', title: 'Moorgeister', minPlayers: 1, maxPlayers: 8, minPlaytime: 40, maxPlaytime: 40 },
  { id: 'g3', title: 'Salzwiesen', minPlayers: 1, maxPlayers: 8 },
];

function roundFixture(sessions = []) {
  return {
    id: 'r1',
    name: 'Donnerstagsrunde',
    background: null,
    members: MEMBERS.map((m) => ({ ...m })),
    tags: [],
    sessions,
    games: GAMES.map((g) => ({ ...g })),
    activity: [],
  };
}

function finished(over = {}) {
  return {
    id: 's1',
    createdAt: '2026-09-14T18:00:00.000Z',
    finishedAt: '2026-09-14T22:10:00.000Z',
    gameIds: ['g1', 'g2', 'g3'],
    memberIds: ['m1', 'm2', 'm3'],
    votes: {
      m1: { g1: { rating: 5 }, g2: { rating: 3 }, g3: { rating: 1 } },
      m2: { g1: { rating: 4 }, g2: { rating: 4 }, g3: { rating: 4 } },
      m3: { g1: { rating: 5 }, g2: { rating: 3 }, g3: { rating: 4 } },
    },
    votedIds: ['m1', 'm2', 'm3'],
    done: true,
    cancelled: false,
    finished: true,
    winnerIds: ['m2'],
    chosenGameId: 'g1',
    events: [],
    ...over,
  };
}

function boot(t, design, round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  dom.set('showSessionLobby', () => {});
  dom.set('currentUserId', () => null);
  dom.set('api', async () => round);
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  return dom;
}

// The screen's own content, without the rail and dock (shared chrome), with
// whitespace folded so a template literal's indentation is not the contract.
function snapshot(root) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll('.rail, .dock').forEach((n) => n.remove());
  return clone.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}

async function renderAll(t, design) {
  const out = {};
  {
    const round = roundFixture();
    const dom = boot(t, design, round);
    await dom.call('showStartSession', round);
    await flush();
    out.setup = snapshot(dom.app);
  }
  {
    const round = roundFixture();
    const dom = boot(t, design, round);
    const session = finished({
      votes: {}, votedIds: ['m2'], done: false, finished: false, winnerIds: [], chosenGameId: null,
    });
    await dom.call('startVoting', round, session, round.games, [{ id: 'm1', name: 'Anna', guest: false }], {
      skipIntro: true,
      saveVotes: async () => {},
      onSaved: async () => {},
    });
    out.vote = snapshot(dom.app);
  }
  const results = {
    result: finished(),
    resultTie: finished({ winnerIds: ['m2', 'm3'] }),
    resultUnvoted: finished({ votes: {}, votedIds: [], winnerIds: [], chosenGameId: null, finished: false }),
  };
  for (const [key, session] of Object.entries(results)) {
    const round = roundFixture([session]);
    const dom = boot(t, design, round);
    await dom.call('showResults', round, session);
    await flush();
    out[key] = snapshot(dom.app);
  }
  {
    const parent = finished({
      id: 'p1', votes: { m1: { g1: { rating: 5 }, g2: { rating: 2 } } }, gameIds: ['g1', 'g2'],
      multiTable: true, finished: false, chosenGameId: null, winnerIds: [], childSessionIds: ['c1', 'c2'],
    });
    const child = (id, gid, ids) => finished({
      id, gameIds: [gid], memberIds: ids, votes: {}, votedIds: [], chosenGameId: gid,
      parentSessionId: 'p1', winnerIds: [ids[0]],
    });
    const round = roundFixture([parent, child('c1', 'g1', ['m1']), child('c2', 'g2', ['m2', 'm3'])]);
    const dom = boot(t, design, round);
    dom.set('roundCan', () => false);
    await dom.call('showTableBuilder', round, parent);
    await flush();
    out.tables = snapshot(dom.app);
  }
  return out;
}

test('Klassisch: the session loop renders exactly as before #1374', async (t) => {
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

test('the snapshot can see Programmheft: the same screens under it are NOT the golden', async (t) => {
  // The control that proves the comparison above discriminates at all.
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const ph = await renderAll(t, 'programmheft');
  for (const k of Object.keys(golden)) {
    assert.notEqual(ph[k], golden[k], `Programmheft's ${k} is identical to Klassisch's`);
  }
});

test('the snapshot can see Forest (#1468): its session loop is NOT the golden either', async (t) => {
  // Forest's session slice branches the same views through forestWorn(); the
  // golden above is what pins that Klassisch stays byte-for-byte, and this
  // control is what proves the comparison can see a Forest branch at all. Seen
  // red by making forestWorn() answer true for every design.
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const forest = await renderAll(t, 'forest');
  for (const k of Object.keys(golden)) {
    assert.notEqual(forest[k], golden[k], `Forest's ${k} is identical to Klassisch's`);
  }
});
