'use strict';

/*
 * The Myludo plays import (#1759): `parseMyludoPlays` in public/js/play-import.js,
 * and the round trip through POST …/sessions/import with `source: 'myludo'`.
 *
 * The fixture is INVENTED, in the shape observed in a real export: one
 * top-level array, keys in French, `ID` the GAME's Myludo id, `Date` a day
 * only, yes/no flags as capitalised „Oui"/„Non", players with a name and no id.
 * Every name and number is made up.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, createRound } = require('./helpers');
const {
  parseMyludoPlays, suggestPeople, suggestGames, duplicateState, buildImportBatches, IMPORT_SOURCES,
} = require('../public/js/play-import');
const { playedOnInstant } = require('../public/js/played-on');

const NOW = new Date(2026, 10, 8, 12);
const parse = (json, opts = {}) => parseMyludoPlays(json, { playedOnInstant, now: NOW, ...opts });

const EXPORT = [
  { ID: 1915, Titre: 'Alchemists', 'Édition': 2014, Date: '2025-03-07', Lieu: 'Chez Hugo', 'Durée': 90,
    Joueurs: [{ Nom: 'Hugo', Score: 35, Victoire: true }, { Nom: 'Ich', Score: 28, Victoire: false }],
    'Incomplète': 'Non', Coop: 'Non', 'Équipes': 'Non', Commentaire: 'Cool!' },
  // A co-op the table lost: nobody won, the ending says so.
  { ID: 77, Titre: 'Pandemic', Date: '2025-04-01', Lieu: '',
    Joueurs: [{ Nom: 'Hugo' }, { Nom: 'Annette' }],
    'Incomplète': 'Non', Coop: 'Oui', 'Coop Victoire': 'Non', 'Coop Score': 200 },
  // A co-op the table won with nobody flagged: everyone at it won.
  { ID: 77, Titre: 'Pandemic', Date: '2025-04-02', Lieu: '',
    Joueurs: [{ Nom: 'Hugo' }, { Nom: 'Annette' }], Coop: 'oui', 'Coop Victoire': 'OUI' },
  // An incomplete play with no winner and an unparseable score.
  { ID: 12, Titre: 'Azul', Date: '2025-05-02', Lieu: 'Café',
    Joueurs: [{ Nom: 'Annette', Score: '12.5', Victoire: false }, { Nom: 'Hugo', Victoire: false }],
    'Incomplète': 'Oui', Coop: 'Non' },
  // The same game, day and table twice: two plays, two ids.
  { ID: 12, Titre: 'Azul', Date: '2025-05-03', Joueurs: [{ Nom: 'Hugo', Victoire: true }, { Nom: 'Annette' }] },
  { ID: 12, Titre: 'Azul', Date: '2025-05-03', Joueurs: [{ Nom: 'Annette', Victoire: true }, { Nom: 'Hugo' }] },
  // Skipped: no title, no date, a malformed day.
  { ID: 1, Date: '2025-05-04', Joueurs: [] },
  { ID: 2, Titre: 'Ohne Datum', Joueurs: [] },
  { ID: 3, Titre: 'Kaputt', Date: '04/05/2025', Joueurs: [] },
];

test('myludo is an import source the route accepts', () => {
  assert.ok(IMPORT_SOURCES.includes('myludo'));
});

test('parseMyludoPlays normalises a play: day-only, location, wins, scores, the game by title', () => {
  const { plays, locations } = parse(JSON.stringify(EXPORT));
  assert.equal(plays.length, 6, 'three malformed rows are skipped');
  assert.deepEqual(locations, ['Café', 'Chez Hugo']);
  const alch = plays[0];
  assert.equal(alch.source, 'myludo');
  assert.equal(alch.dateOnly, true, 'a Myludo play carries a day only');
  assert.equal(alch.dayKey, '2025-03-07');
  assert.equal(alch.playedOn, playedOnInstant('2025-03-07', NOW), 'stored at the 20:00 stand-in');
  assert.equal(alch.location, 'Chez Hugo');
  assert.equal(alch.incomplete, false);
  assert.deepEqual(alch.game, { key: 'title:alchemists', bggId: null, title: 'Alchemists', coop: false });
  assert.deepEqual(alch.players.map((p) => [p.key, p.name, p.win, p.score]),
    [['myl:hugo', 'Hugo', true, 35], ['myl:ich', 'Ich', false, 28]]);
  assert.equal(alch.ending, undefined);
});

test('the exporter under Myludo\'s localized self-name is marked as the account', () => {
  const { plays } = parse(EXPORT);
  assert.equal(plays[0].players.find((p) => p.name === 'Ich').me, true);
  assert.equal(plays[0].players.find((p) => p.name === 'Hugo').me, undefined);
  const people = new Map(suggestPeople(plays, [], { meMemberId: 'm-me' }).map((p) => [p.name, p.choice]));
  assert.deepEqual(people.get('Ich'), { memberId: 'm-me' });
  assert.deepEqual(parse([{ ...EXPORT[0], Joueurs: [{ Nom: 'Moi' }] }]).plays[0].players[0].me, true);
});

test('a lost co-op records the ending; a won co-op with nobody flagged makes everyone a winner', () => {
  const { plays } = parse(EXPORT);
  const lost = plays.find((p) => p.dayKey === '2025-04-01');
  assert.equal(lost.game.coop, true);
  assert.equal(lost.ending, 'lost');
  assert.ok(lost.players.every((p) => p.win === false));
  const won = plays.find((p) => p.dayKey === '2025-04-02');
  assert.equal(won.ending, undefined, 'flags are compared case-insensitively');
  assert.ok(won.players.every((p) => p.win === true));
});

test('an incomplete play with no winner keeps nobody as winner and drops a non-integer score', () => {
  const azul = parse(EXPORT).plays.find((p) => p.dayKey === '2025-05-02');
  assert.equal(azul.incomplete, true);
  assert.equal(azul.ending, undefined, 'not a co-op — no ending is invented');
  assert.ok(azul.players.every((p) => !p.win));
  assert.equal(azul.players[0].score, undefined);
});

test('ids are stable across re-exports and distinct for a repeat of the same table', () => {
  const a = parse(EXPORT).plays.map((p) => p.sourceId);
  const b = parse(JSON.parse(JSON.stringify(EXPORT))).plays.map((p) => p.sourceId);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length, 'every play has its own id');
  const twice = parse(EXPORT).plays.filter((p) => p.dayKey === '2025-05-03');
  assert.deepEqual(twice.map((p) => p.sourceId), ['12@2025-05-03@annette,hugo', '12@2025-05-03@annette,hugo#2']);
});

test('plays before the floor or in the future are left out', () => {
  const rows = [{ ...EXPORT[0], Date: '1999-12-31' }, { ...EXPORT[0], Date: '2000-01-01' }, { ...EXPORT[0], Date: '2026-11-09' }];
  assert.deepEqual(parse(rows, { minDay: '2000-01-01' }).plays.map((p) => p.dayKey), ['2000-01-01']);
});

test('a file that is not a Myludo plays export is refused — the shelf export included', () => {
  assert.throws(() => parse('{"plays": []}'), /not_myludo/, 'a BG Stats-shaped object');
  assert.throws(() => parse('[{"Titre": "Azul", "Type": "basegame", "Joueur(s)": "2 — 4"}]'), /not_myludo/, 'the shelf export');
  assert.throws(() => parse('[1, 2]'), /not_myludo/);
  assert.throws(() => parse('{nope'), SyntaxError);
  assert.deepEqual(parse('[]').plays, [], 'an empty export is valid and empty');
});

test('a Myludo import round-trips through the route and is flagged as imported on re-import', async () => {
  const round = await createRound(request, { name: 'Myludo' });
  const [alice] = round.members;
  const { plays } = parse(EXPORT);
  const people = suggestPeople(plays, round.members);
  // Hugo is the round's existing seat; everyone else follows the suggestion.
  people.find((p) => p.name === 'Hugo').choice = { memberId: alice.id };
  const games = suggestGames(plays, round.games);
  const plan = buildImportBatches('myludo', plays, people, games);
  const res = await request(app).post(`/api/rounds/${round.id}/sessions/import`)
    .send({ source: plan.source, people: plan.people, games: plan.games, plays: plan.batches[0] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.imported, 6);

  const after = (await request(app).get(`/api/rounds/${round.id}`)).body;
  const imported = after.sessions.filter((s) => s.importRef && s.importRef.source === 'myludo');
  assert.equal(imported.length, 6);
  const lost = imported.find((s) => s.importRef.id.startsWith('77@2025-04-01'));
  assert.equal(lost.ending, 'lost');
  assert.equal(lost.dateOnly, true);

  // The preview's duplicate check sees every play as already here.
  for (const p of parse(EXPORT).plays) {
    assert.equal(duplicateState(p, after.sessions, { gameId: null, memberIds: [] }), 'imported', p.sourceId);
  }
});
