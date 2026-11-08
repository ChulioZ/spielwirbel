'use strict';

/* „Partien importieren" (#1665) with a Myludo file (#1759), driven under jsdom
   (.claude/rules/testing-views-under-jsdom.md). The `api` seam is stubbed, and
   the file is handed to the input as an object with `text()`, which is all the
   sheet reads of it. The point of this spec is the ONE input serving two
   sources: the button that opened it must decide which parser runs. The
   fixture is INVENTED in the observed export shape. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, waitFor } = require('./support/dom');

const ROUND = {
  id: 1,
  name: 'Donnerstagsrunde',
  games: [{ id: 11, title: 'Alchemists' }],
  tags: [],
  members: [{ id: 'm1', name: 'Hugo' }],
  sessions: [],
  activity: [],
};

const MYLUDO = JSON.stringify([
  { ID: 1915, Titre: 'Alchemists', Date: '2025-03-07', Lieu: '',
    Joueurs: [{ Nom: 'Hugo', Score: 35, Victoire: true }, { Nom: 'Annette', Score: 28, Victoire: false }],
    'Incomplète': 'Non', Coop: 'Non' },
]);

function open(t, pick) {
  const dom = loadApp({ locale: 'en' });
  t.after(() => dom.close());
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    return { imported: 1, skipped: 0, empty: 0, people: {}, games: {} };
  });
  dom.set('currentUserId', () => null);
  dom.set('showRound', () => {});
  dom.call('showPlayImport', ROUND);
  const buttons = [...dom.document.querySelectorAll('.play-import__source')];
  const button = buttons.find((b) => b.textContent.includes(pick));
  assert.ok(button, `no source button reading „${pick}" among ${buttons.map((b) => b.textContent.trim()).join(' | ')}`);
  const input = dom.document.querySelector('.play-import input[type="file"]');
  input.click = () => {}; // jsdom would open nothing anyway
  button.click();
  return { dom, input, calls };
}

const feed = (dom, input, text) => {
  Object.defineProperty(input, 'files', { value: [{ text: async () => text }] });
  input.dispatchEvent(new dom.window.Event('change'));
};

test('the Myludo button parses the file as a Myludo plays export and sends it as source myludo', async (t) => {
  const { dom, input, calls } = open(t, 'Myludo');
  feed(dom, input, MYLUDO);
  await waitFor(() => dom.document.querySelector('.play-import__play'));
  const row = dom.document.querySelector('.play-import__play');
  assert.match(row.textContent, /Alchemists/);
  assert.match(row.textContent, /Hugo, Annette/);
  // plays → people → games? (Alchemists is on the shelf, so straight to confirm) → submit
  const next = () => [...dom.document.querySelectorAll('.sheet__actions .btn--primary')].pop().click();
  next();
  await waitFor(() => dom.document.querySelector('.play-import__map'));
  next();
  await waitFor(() => dom.document.querySelector('.sheet__actions .btn--primary .ti-download'));
  next();
  await waitFor(() => calls.some((c) => c.url.endsWith('/sessions/import')));
  const sent = calls.find((c) => c.url.endsWith('/sessions/import')).body;
  assert.equal(sent.source, 'myludo');
  assert.equal(sent.plays.length, 1);
  assert.equal(sent.plays[0].dateOnly, true);
  assert.deepEqual(JSON.parse(JSON.stringify(sent.games)), [{ key: 'title:alchemists', gameId: 11 }], 'matched to the shelf game by title');
});

test('a BG Stats file chosen through the Myludo button says it is not a Myludo export', async (t) => {
  const { dom, input } = open(t, 'Myludo');
  feed(dom, input, JSON.stringify({ games: [], players: [], plays: [] }));
  await waitFor(() => dom.document.querySelector('.bgg-import__msg'));
  assert.match(dom.document.querySelector('.bgg-import__msg').textContent, /not a Myludo plays export/);
});

test('the BG Stats button still parses as BG Stats — a Myludo file there is refused as such', async (t) => {
  const { dom, input } = open(t, 'BG Stats');
  feed(dom, input, MYLUDO);
  await waitFor(() => dom.document.querySelector('.bgg-import__msg'));
  assert.match(dom.document.querySelector('.bgg-import__msg').textContent, /not a BG Stats export/);
});
