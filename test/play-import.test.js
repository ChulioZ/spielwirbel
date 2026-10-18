'use strict';

/*
 * The pure half of the play-history import (#1665): public/js/play-import.js.
 *
 * The BG Stats fixture is synthetic — nobody on the project has the app — and
 * is built from the export shape several independent open-source readers of it
 * agree on: top-level games/players/locations/plays, `playerScores[]` keyed by
 * `playerRefId`, scores as STRINGS, `playDate` as local "YYYY-MM-DD hh:mm:ss",
 * `ignored`, `usesTeams` + `team`, `cooperative` on the game. Every name is
 * invented.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  importScore, localStampToIso, parseBgStatsExport, normaliseBggPlays, suggestPeople,
  suggestGames, duplicateState, playMemberIds, playPassesFilter, buildImportBatches,
  resolveCreated, IMPORT_BATCH_MAX,
} = require('../public/js/play-import');
const { playedOnInstant } = require('../public/js/played-on');

const EXPORT = {
  about: 'BG Stats backup',
  userInfo: { meRefId: 1 },
  players: [
    { id: 1, name: 'Ada', uuid: 'p1', isAnonymous: false, bggUsername: '' },
    { id: 2, name: 'Bea', uuid: 'p2' },
    { id: 3, name: 'Cem', uuid: 'p3' },
    { id: 4, name: 'Dio', uuid: 'p4' },
  ],
  games: [
    { id: 10, name: 'Azul', bggId: 230802, cooperative: false },
    { id: 11, name: 'Pandemie', bggId: 30549, cooperative: true },
    { id: 12, name: 'Hausregel-Spiel', bggId: 0 },
  ],
  locations: [{ id: 50, name: 'Küche' }, { id: 51, name: 'Café' }],
  plays: [
    { uuid: 'u-azul', playDate: '2025-03-07 19:30:00', gameRefId: 10, locationRefId: 50, ignored: false, usesTeams: false,
      playerScores: [
        { playerRefId: 1, score: '61', winner: true },
        { playerRefId: 2, score: '12.5', winner: false },
        { playerRefId: 3, score: '', winner: false },
      ] },
    { uuid: 'u-pandemic', playDate: '2025-04-01 20:00:00', gameRefId: 11, locationRefId: 51, ignored: false,
      playerScores: [{ playerRefId: 1, winner: false }, { playerRefId: 4, winner: false }] },
    { uuid: 'u-teams', playDate: '2025-05-02 18:00:00', gameRefId: 12, ignored: true, usesTeams: true,
      playerScores: [
        { playerRefId: 1, team: 'Rot', winner: true, score: '7' },
        { playerRefId: 2, team: 'Rot', winner: true, score: '7' },
        { playerRefId: 3, team: 'Blau', winner: false, score: '3' },
        { playerRefId: 4, team: 'Blau', winner: false, score: '3' },
      ] },
    // A play whose game is missing from `games` is skipped, not fatal.
    { uuid: 'u-orphan', playDate: '2025-05-03 18:00:00', gameRefId: 99, playerScores: [] },
  ],
};

test('importScore keeps integers only — a decimal or blank BG Stats score is dropped, not rounded', () => {
  assert.equal(importScore('61'), 61);
  assert.equal(importScore(' -4 '), -4);
  assert.equal(importScore('12.5'), undefined);
  assert.equal(importScore(''), undefined);
  assert.equal(importScore('—'), undefined);
  assert.equal(importScore(undefined), undefined);
});

test('localStampToIso reads a wall-clock stamp in the DEVICE zone and refuses an impossible day', () => {
  const iso = localStampToIso('2025-03-07 19:30:00');
  const d = new Date(iso);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2025, 2, 7, 19, 30]);
  assert.equal(localStampToIso('2025-02-30 10:00:00'), null);
  assert.equal(localStampToIso('yesterday'), null);
});

test('parseBgStatsExport normalises plays: people, wins, integer scores, location, teams', () => {
  const { plays, locations } = parseBgStatsExport(JSON.stringify(EXPORT));
  assert.equal(plays.length, 3, 'the orphan play is skipped');
  assert.deepEqual(locations, ['Café', 'Küche']);
  const azul = plays.find((p) => p.sourceId === 'u-azul');
  assert.equal(azul.source, 'bgstats');
  assert.equal(azul.dateOnly, false, 'a BG Stats play carries its time');
  assert.equal(azul.location, 'Küche');
  assert.deepEqual(azul.game, { key: 'bgg:230802', bggId: 230802, title: 'Azul', coop: false });
  assert.deepEqual(azul.players.map((p) => [p.key, p.name, p.win, p.score]),
    [['bgs:1', 'Ada', true, 61], ['bgs:2', 'Bea', false, undefined], ['bgs:3', 'Cem', false, undefined]]);
  assert.equal(azul.ending, undefined);

  const teams = plays.find((p) => p.sourceId === 'u-teams');
  assert.equal(teams.incomplete, true, '`ignored` reads as incomplete');
  assert.equal(teams.game.key, 'title:hausregel-spiel', 'a game with no BGG id is keyed by title');
  assert.deepEqual(teams.players.map((p) => p.team), ['Rot', 'Rot', 'Blau', 'Blau']);
});

test('a co-op the whole table lost becomes ending: lost', () => {
  const { plays } = parseBgStatsExport(EXPORT);
  assert.equal(plays.find((p) => p.sourceId === 'u-pandemic').ending, 'lost');
});

test('plays before the floor or in the future are left out of the preview', () => {
  const exp = { ...EXPORT, plays: [
    { ...EXPORT.plays[0], uuid: 'old', playDate: '1999-12-31 20:00:00' },
    { ...EXPORT.plays[0], uuid: 'ok', playDate: '2000-01-01 20:00:00' },
    { ...EXPORT.plays[0], uuid: 'future', playDate: '2026-01-02 20:00:00' },
  ] };
  const now = new Date(2026, 0, 1, 12);
  assert.deepEqual(parseBgStatsExport(exp, { minDay: '2000-01-01', now }).plays.map((p) => p.sourceId), ['ok']);
  const raw = [{ id: '1', date: '1999-06-01', quantity: 1, game: { bggId: 1, title: 'X' }, players: [] },
    { id: '2', date: '2001-06-01', quantity: 1, game: { bggId: 1, title: 'X' }, players: [] }];
  assert.deepEqual(normaliseBggPlays(raw, { playedOnInstant, minDay: '2000-01-01', now }).map((p) => p.sourceId), ['2']);
});

test('parseBgStatsExport refuses a file that is not an export, and lets JSON errors through', () => {
  assert.throws(() => parseBgStatsExport('{"games": []}'), /not_bgstats/);
  assert.throws(() => parseBgStatsExport('[]'), /not_bgstats/);
  assert.throws(() => parseBgStatsExport('{nope'), SyntaxError);
});

test('normaliseBggPlays: a day-only play at the 20:00 stand-in, and quantity N as N sessions', () => {
  const raw = [{
    id: '77', date: '2025-06-01', quantity: 2, incomplete: false, location: '',
    game: { bggId: 13, title: 'CATAN' },
    players: [{ name: 'Ada', win: true, score: '10', me: true }, { name: 'bea ', win: false, score: '' }],
  }];
  const plays = normaliseBggPlays(raw, { playedOnInstant, now: new Date('2026-01-01T12:00:00Z') });
  assert.deepEqual(plays.map((p) => p.sourceId), ['77#1', '77#2']);
  assert.equal(plays[0].dateOnly, true);
  assert.equal(new Date(plays[0].playedOn).getHours(), 20);
  assert.equal(plays[0].dayKey, '2025-06-01');
  assert.deepEqual(plays[0].players.map((p) => [p.key, p.name, p.score, !!p.me]),
    [['bggp:ada', 'Ada', 10, true], ['bggp:bea', 'bea', undefined, false]]);
  const single = normaliseBggPlays([{ ...raw[0], quantity: 1 }], { playedOnInstant });
  assert.deepEqual(single.map((p) => p.sourceId), ['77']);
});

const ROUND_MEMBERS = [
  { id: 'm-ada', name: 'ada', userId: 'u1' },
  { id: 'm-old', name: 'Bea', retired: true },
];

test('suggestPeople: name match (case-insensitive), own seat for `me`, regulars as members, one-offs as guests', () => {
  const plays = [
    { players: [{ key: 'k1', name: 'Ada' }, { key: 'k2', name: 'Cem' }, { key: 'k3', name: 'Bea' }] },
    { players: [{ key: 'k2', name: 'Cem' }, { key: 'k4', name: 'Dio', me: true }] },
  ];
  const out = new Map(suggestPeople(plays, ROUND_MEMBERS, { meMemberId: 'm-me' }).map((p) => [p.key, p]));
  assert.deepEqual(out.get('k1').choice, { memberId: 'm-ada' });
  assert.deepEqual(out.get('k2').choice, { newMember: 'Cem' }, 'two plays — a regular');
  assert.deepEqual(out.get('k3').choice, { guest: 'Bea' }, 'a retired seat is not matched');
  assert.deepEqual(out.get('k4').choice, { memberId: 'm-me' }, 'the account row is the account\'s seat');
  assert.equal(out.get('k2').plays, 2);
});

test('suggestGames: reuse by BGG id in any state, then by title, else create retired', () => {
  const plays = [
    { game: { key: 'bgg:13', bggId: 13, title: 'Catan' } },
    { game: { key: 'title:x', bggId: null, title: 'Werwolf' } },
    { game: { key: 'bgg:99', bggId: 99, title: 'Neu' } },
  ];
  const games = [
    { id: 'g1', title: 'Die Siedler', retired: true, source: { provider: 'bgg', externalId: '13' } },
    { id: 'g2', title: 'werwolf' },
  ];
  const out = new Map(suggestGames(plays, games).map((g) => [g.key, g.choice]));
  assert.deepEqual(out.get('bgg:13'), { gameId: 'g1' });
  assert.deepEqual(out.get('title:x'), { gameId: 'g2' });
  assert.deepEqual(out.get('bgg:99'), { create: { shelf: false } });
});

test('duplicateState: exact importRef, then same day + game + members as probable', () => {
  const play = { source: 'bgg', sourceId: '77', dayKey: '2025-06-01' };
  const at = new Date(2025, 5, 1, 21, 0).toISOString();
  const sessions = [
    { importRef: { source: 'bgstats', id: '77' }, finished: true, chosenGameId: 'g9', createdAt: at, memberIds: [] },
    { finished: true, chosenGameId: 'g1', createdAt: at, memberIds: ['b', 'a'] },
  ];
  assert.equal(duplicateState(play, [...sessions, { importRef: { source: 'bgg', id: '77' } }], { gameId: 'g1', memberIds: ['a'] }), 'imported');
  assert.equal(duplicateState(play, sessions, { gameId: 'g1', memberIds: ['a', 'b'] }), 'probable');
  assert.equal(duplicateState(play, sessions, { gameId: 'g1', memberIds: ['a'] }), null, 'other people');
  assert.equal(duplicateState({ ...play, dayKey: '2025-06-02' }, sessions, { gameId: 'g1', memberIds: ['a', 'b'] }), null, 'another day');
  assert.equal(duplicateState(play, [{ ...sessions[1], cancelled: true }], { gameId: 'g1', memberIds: ['a', 'b'] }), null, 'cancelled is no play');
});

test('playMemberIds and playPassesFilter read the current people choices', () => {
  const play = { dayKey: '2025-06-01', location: 'Küche', players: [{ key: 'a' }, { key: 'b' }, { key: 'c' }] };
  const people = new Map([['a', { memberId: 'm1' }], ['b', { guest: 'B' }], ['c', null]]);
  assert.deepEqual(playMemberIds(play, people), ['m1']);
  assert.equal(playPassesFilter(play, { from: '2025-06-02' }, people), false);
  assert.equal(playPassesFilter(play, { to: '2025-05-31' }, people), false);
  assert.equal(playPassesFilter(play, { location: 'Café' }, people), false);
  assert.equal(playPassesFilter(play, { matchedOnly: true }, new Map([['b', { guest: 'B' }]])), false);
  assert.equal(playPassesFilter(play, { from: '2025-06-01', to: '2025-06-01', location: 'Küche', matchedOnly: true }, people), true);
});

test('buildImportBatches: the first batch carries every mapping; plays split at IMPORT_BATCH_MAX', () => {
  const plays = Array.from({ length: IMPORT_BATCH_MAX + 1 }, (_, i) => ({
    sourceId: `s${i}`, playedOn: '2025-01-01T19:00:00.000Z', dateOnly: false,
    game: { key: i ? 'bgg:1' : 'title:t' },
    players: [{ key: 'a', win: i === 0, score: 3 }, { key: 'ignored', win: false }],
  }));
  const people = [
    { key: 'a', choice: { newMember: 'Ada' } },
    { key: 'ignored', choice: null },
    { key: 'unused', choice: { guest: 'X' } },
  ];
  const games = [
    { key: 'bgg:1', title: 'One', bggId: 1, choice: { create: { shelf: true } } },
    { key: 'title:t', title: 'T', bggId: null, choice: { gameId: 'g-t' } },
  ];
  const plan = buildImportBatches('bgstats', plays, people, games);
  assert.equal(plan.batches.length, 2);
  assert.equal(plan.batches[0].length, IMPORT_BATCH_MAX);
  assert.deepEqual(plan.people, [{ key: 'a', newMember: 'Ada' }], 'ignored and unused people are left out');
  assert.deepEqual(plan.games, [
    { key: 'bgg:1', create: { title: 'One', bggId: 1, shelf: true } },
    { key: 'title:t', gameId: 'g-t' },
  ]);
  assert.deepEqual(plan.batches[0][0], {
    id: 's0', playedOn: '2025-01-01T19:00:00.000Z', dateOnly: false, gameKey: 'title:t',
    players: [{ key: 'a', win: true, score: 3 }, { key: 'ignored', win: false }],
  });

  const next = resolveCreated(plan, { people: { a: 'm-new' }, games: { 'bgg:1': 'g-new' } });
  assert.deepEqual(next.people, [{ key: 'a', memberId: 'm-new' }]);
  assert.deepEqual(next.games, [{ key: 'bgg:1', gameId: 'g-new' }, { key: 'title:t', gameId: 'g-t' }]);
  assert.deepEqual(resolveCreated(plan, { people: {}, games: {} }).people, plan.people,
    'a batch that wrote nothing leaves the creations pending');
});
