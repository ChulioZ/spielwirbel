'use strict';

/* The Klassisch DOM of the two screens #1375 composes for Das Programmheft —
   the shared vote (the lobby a session waits in while people rate) and the
   pass-device blind (the handover between two people on one device) — pinned
   as a golden snapshot.

   Same licence as test/programmheft-session-klassisch-golden.test.js: the views
   branch on designIs('programmheft'), and a snapshot of the whole rendered
   screen sees an attribute moved or a wrapper added where a per-selector check
   sees only what someone thought to list.

   The golden was generated from the views BEFORE #1375 touched them. Regenerate
   only for a change that deliberately alters Klassisch:
   SPIELWIRBEL_UPDATE_GOLDEN=1 node --test test/programmheft-shared-vote-klassisch-golden.test.js */

process.env.TZ = 'Europe/Berlin';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');

const GOLDEN = path.join(__dirname, 'fixtures', 'programmheft-shared-vote-klassisch-golden.json');
const ME = 'user-me';

function roundFixture() {
  return {
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
  };
}

function open(over = {}) {
  return {
    id: 's1',
    createdAt: '2026-09-14T18:00:00.000Z',
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
  };
}

function boot(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('toast', () => {});
  dom.set('api', async () => roundFixture());
  // The hot-seat order is shuffled (startVoting); a fixed draw keeps it stable.
  dom.run('Math.random = () => 0.5');
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  return dom;
}

function snapshot(root) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll('.rail, .dock').forEach((n) => n.remove());
  return clone.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}

async function renderAll(t, design) {
  const out = {};
  const lobbies = {
    // Your own seat still open: it leads, the others are offered on this device.
    lobbyMine: [open(), false],
    // Your vote is in, a guest is voting by link.
    lobbyVoted: [open({ votedIds: ['m1', 'm2'], memberIds: ['m1', 'm2', 'm3'], guests: [{ id: 'g-x', name: 'Sarah' }] }), false],
    // Handed on after a vote on this device: the next person leads.
    lobbyHandedOn: [open({ votedIds: ['m1', 'm2'] }), true],
    // Everyone in: nothing to share, closing leads.
    lobbyAllIn: [open({ votedIds: ['m1', 'm2', 'm3', 'm4'] }), false],
  };
  for (const [key, [session, handedOn]] of Object.entries(lobbies)) {
    const dom = boot(t, design);
    const round = roundFixture();
    await dom.call('showSessionLobby', round, session, handedOn);
    await flush();
    out[key] = snapshot(dom.app);
    dom.call('stopLobbyPoll');
  }
  for (const [key, back] of [['blind', false], ['blindBack', true]]) {
    const dom = boot(t, design);
    const round = roundFixture();
    const people = [{ id: 'm2', name: 'Ben', guest: false }, { id: 'm3', name: 'Clara', guest: false }];
    await dom.call('startVoting', round, open(), round.games, back ? people : people.slice(1), {
      saveVotes: async () => {},
      onSaved: async () => {},
    });
    if (back) {
      // Ben's run: the blind, his three cards, then Clara's blind with a Zurück.
      dom.app.querySelector('#goBtn').click();
      for (let i = 0; i < 3; i++) {
        await flush();
        dom.app.querySelector('.rating .mood').click();
        await new Promise((r) => setTimeout(r, 900)); // the advance beat (vote-advance.js)
      }
      dom.app.querySelector('#sendBtn').click(); // the review (#1434) hands on to Clara
      await flush();
    }
    out[key] = snapshot(dom.app) + ` body.vote-screen=${dom.document.body.classList.contains('vote-screen')}`;
  }
  return out;
}

test('Klassisch: the shared vote and the blind render exactly as before #1375', async (t) => {
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
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const ph = await renderAll(t, 'programmheft');
  for (const k of Object.keys(golden)) {
    assert.notEqual(ph[k], golden[k], `Programmheft's ${k} is identical to Klassisch's`);
  }
});

test('the snapshot can see Forest (#1469): its shared vote and blind are NOT the golden either', async (t) => {
  // Forest's slice branches the same two views through forestWorn(); the golden
  // above pins that Klassisch stays byte-for-byte, and this control proves the
  // comparison can see a Forest branch at all.
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const forest = await renderAll(t, 'forest');
  for (const k of Object.keys(golden)) {
    assert.notEqual(forest[k], golden[k], `Forest's ${k} is identical to Klassisch's`);
  }
});
