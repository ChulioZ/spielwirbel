'use strict';

/* The "remove a person" sheet (#1538), rendered for real through the jsdom
   harness (.claude/rules/testing-views-under-jsdom.md): the lobby entry, the
   sheet's list, the confirm wording that depends on whether the person had
   voted, the DELETE it sends, and the re-render from the server's view. The
   results screens' entries are covered where they render —
   test/tisch-result-tafel.test.js for the „Mehr" menu every composed design
   shares, and the Klassisch golden for the footer link. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');

function fixture(over = {}) {
  const session = {
    id: 's1', createdAt: '2026-08-02T18:00:00.000Z', gameIds: ['g1'],
    memberIds: ['m1', 'm2'], guests: [{ id: 'x1', name: 'Dana' }],
    votes: {}, votedIds: ['m2'], done: false, cancelled: false, finished: false,
    winnerIds: [], chosenGameId: null, ...over,
  };
  const round = {
    id: 'r1', name: 'Freitagsrunde', background: null, tags: [],
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [{ id: 'g1', title: 'Catan', minPlayers: 1, maxPlayers: 8, tagIds: [] }],
    sessions: [session],
  };
  return { round, session };
}

async function lobby(t, over) {
  const { round, session } = fixture(over);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sent = [];
  const after = { ...round, sessions: [{ ...session, memberIds: ['m1'], removedPeople: [{ id: 'm2' }], votedIds: [] }] };
  dom.set('api', async (method, p) => { sent.push({ method, path: p }); return method === 'GET' ? after : {}; });
  dom.set('fetchRoundFresh', async () => after);
  const asked = [];
  dom.set('confirmDialog', async (o) => { asked.push(o); return true; });
  await dom.call('showSessionLobby', round, session);
  return { dom, sent, asked };
}

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

test('the lobby offers the entry, and the sheet lists every person', async (t) => {
  const { dom } = await lobby(t);
  const entry = dom.app.querySelector('.live-vote__people .remove-person__entry');
  assert.ok(entry, 'the entry sits at the foot of the roster');
  entry.click();
  const rows = [...dom.document.querySelectorAll('.remove-person__row')];
  assert.deepEqual(rows.map((r) => text(r.querySelector('.remove-person__name'))), ['Anna', 'Ben', 'Dana (Gast)']);
  assert.equal(rows[1].querySelector('button').getAttribute('aria-label'), 'Ben entfernen');
});

test('removing someone who voted says their ratings still count, then DELETEs and re-renders', async (t) => {
  const { dom, sent, asked } = await lobby(t);
  dom.app.querySelector('.remove-person__entry').click();
  dom.document.querySelectorAll('.remove-person__row button')[1].click();
  await flush();
  assert.equal(asked.length, 1);
  assert.match(asked[0].body, /Wertungen zählen weiter/, 'Ben had voted');
  assert.ok(sent.some((c) => c.method === 'DELETE' && c.path === '/api/rounds/r1/sessions/s1/people/m2'));
  const names = [...dom.app.querySelectorAll('.live-person__name')].map(text);
  assert.deepEqual(names, ['Anna', 'Dana (Gast)'], 'the lobby re-rendered without Ben');
});

test('someone who has not voted gets the plain confirm', async (t) => {
  const { dom, asked } = await lobby(t);
  dom.app.querySelector('.remove-person__entry').click();
  dom.document.querySelectorAll('.remove-person__row button')[0].click();
  await flush();
  assert.doesNotMatch(asked[0].body, /Wertungen/, 'Anna had not voted');
});

test('a session of one offers no entry at all', async (t) => {
  const { dom } = await lobby(t, { memberIds: ['m1'], guests: [], votedIds: [] });
  assert.equal(dom.app.querySelector('.remove-person__entry'), null);
});

test('the server\'s refusal codes become readable toasts', async (t) => {
  const { dom } = await lobby(t);
  const toasts = [];
  dom.set('toast', (msg) => toasts.push(msg));
  dom.set('api', async () => { throw new Error('last_person'); });
  dom.app.querySelector('.remove-person__entry').click();
  dom.document.querySelectorAll('.remove-person__row button')[0].click();
  await flush();
  assert.deepEqual(toasts, ['Eine Session braucht mindestens eine Person.']);
});

test('the log still names a removed guest', async (t) => {
  const { dom } = await lobby(t, {
    guests: [],
    removedPeople: [{ id: 'x1', guest: true, name: 'Dana' }],
    events: [{ at: '2026-08-02T18:05:00.000Z', type: 'person_removed', actor: 'm1', personId: 'x1' }],
  });
  const lines = [...dom.app.querySelectorAll('.session-log li')].map(text);
  assert.ok(lines.some((l) => /Anna hat Dana \(Gast\) aus der Session entfernt/.test(l)), lines.join(' / '));
});

// ---- putting someone back (#1655) ------------------------------------------

test('the sheet lists the removed under their own heading, skipping a member deleted since', async (t) => {
  const { dom } = await lobby(t, {
    memberIds: ['m1'], guests: [], votedIds: [],
    removedPeople: [{ id: 'm2' }, { id: 'gone' }, { id: 'x1', guest: true, name: 'Dana' }],
  });
  const entry = dom.app.querySelector('.remove-person__entry');
  assert.ok(entry, 'one person left, but someone to put back — the entry still shows');
  assert.match(text(entry), /Personen verwalten/);
  entry.click();
  const [current, removed] = dom.document.querySelectorAll('.remove-person__list');
  assert.deepEqual([...current.querySelectorAll('.remove-person__name')].map(text), ['Anna']);
  assert.equal(current.querySelector('button'), null, 'the last person offers no „Entfernen"');
  assert.equal(text(dom.document.querySelector('.remove-person__heading')), 'Entfernt');
  assert.deepEqual([...removed.querySelectorAll('.remove-person__name')].map(text), ['Ben', 'Dana (Gast)']);
  assert.equal(removed.querySelector('button').getAttribute('aria-label'), 'Ben wieder hinzufügen');
});

test('adding someone back POSTs the restore without a confirm, toasts and re-renders', async (t) => {
  const { round, session } = fixture({ memberIds: ['m1'], votedIds: [], removedPeople: [{ id: 'm2' }] });
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sent = [];
  const toasts = [];
  const after = { ...round, sessions: [{ ...session, memberIds: ['m1', 'm2'], removedPeople: undefined }] };
  dom.set('api', async (method, p) => { sent.push({ method, path: p }); return {}; });
  dom.set('fetchRoundFresh', async () => after);
  dom.set('confirmDialog', async () => { throw new Error('a restore must not ask'); });
  dom.set('toast', (msg) => toasts.push(msg));
  await dom.call('showSessionLobby', round, session);

  dom.app.querySelector('.remove-person__entry').click();
  dom.document.querySelector('.remove-person__list--removed button').click();
  await flush();
  assert.ok(sent.some((c) => c.method === 'POST' && c.path === '/api/rounds/r1/sessions/s1/people/m2/restore'));
  assert.deepEqual(toasts, ['Ben ist wieder dabei']);
  assert.equal(dom.document.querySelector('.remove-person'), null, 'the sheet closed');
  const names = [...dom.app.querySelectorAll('.live-person__name')].map(text);
  assert.ok(names.includes('Ben'), names.join(' / '));
});

test('a refused restore on a split parent becomes a readable toast', async (t) => {
  const { dom } = await lobby(t, { removedPeople: [{ id: 'x2', guest: true, name: 'Eli' }] });
  const toasts = [];
  dom.set('toast', (msg) => toasts.push(msg));
  dom.set('api', async () => { throw new Error('already_split'); });
  dom.app.querySelector('.remove-person__entry').click();
  dom.document.querySelector('.remove-person__list--removed button').click();
  await flush();
  assert.deepEqual(toasts, ['Diese Session ist auf Tische aufgeteilt. Füge die Person an ihrem Tisch wieder hinzu.']);
});

test('the log says who was added back, and by whom', async (t) => {
  const { dom } = await lobby(t, {
    events: [
      { at: '2026-08-02T18:05:00.000Z', type: 'person_removed', actor: 'm1', personId: 'm2' },
      { at: '2026-08-02T18:06:00.000Z', type: 'person_restored', actor: 'm1', personId: 'm2' },
      { at: '2026-08-02T18:07:00.000Z', type: 'person_restored', personId: 'x1' },
    ],
  });
  const lines = [...dom.app.querySelectorAll('.session-log li')].map(text);
  assert.ok(lines.some((l) => /Anna hat Ben wieder zur Session hinzugefügt/.test(l)), lines.join(' / '));
  assert.ok(lines.some((l) => /Dana \(Gast\) wurde wieder zur Session hinzugefügt/.test(l)), lines.join(' / '));
});
