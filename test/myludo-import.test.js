'use strict';

/*
 * The Myludo shelf import's pure half (#1758, public/js/myludo-import.js):
 * the parser, the BGG match suggestion, the expansion attachment and the
 * request body. Fixtures are INVENTED in the observed export shape — never a
 * real export.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// lookup-score.js's fold, reached by the module at call time as a shared-scope
// global — exactly what the browser provides.
globalThis.foldTitle = require('../public/js/lookup-score').foldTitle;
const {
  MYLUDO_IMPORT_MAX, parseMyludoRange, parseMyludoShelf, myludoMatch,
  attachMyludoExpansions, myludoShelfMatch, buildMyludoImport,
} = require('../public/js/myludo-import');

const row = (over) => ({
  ID: 1, Titre: 'Jeu', 'Sous-titre': '', 'Édition': 2020, Type: 'basegame',
  'Joueur(s)': '2 — 4', 'Durée': 60, 'Gamme(s)': [], EAN: [], Favori: 'non', ...over,
});

test('parseMyludoRange reads both Durée shapes and every player spelling', () => {
  assert.deepEqual(parseMyludoRange(90), { min: 90, max: 90 });
  assert.deepEqual(parseMyludoRange('30 — 45'), { min: 30, max: 45 });
  assert.deepEqual(parseMyludoRange('2 — 4'), { min: 2, max: 4 });
  assert.deepEqual(parseMyludoRange('3'), { min: 3, max: 3 });
  assert.deepEqual(parseMyludoRange('2-5'), { min: 2, max: 5 });
  assert.deepEqual(parseMyludoRange('6 — 2'), { min: 2, max: 6 }, 'a reversed range is righted');
  for (const none of [0, '', '0', null, undefined, NaN, 'beaucoup', [], {}]) {
    assert.equal(parseMyludoRange(none), null, `${JSON.stringify(none)} is no range`);
  }
});

test('parseMyludoShelf turns an export into rows, leniently', () => {
  const rows = parseMyludoShelf(JSON.stringify([
    row({ Titre: 'Forêt Mixte', 'Édition': 2021, 'Joueur(s)': '1 — 5', 'Durée': '40 — 60', 'Gamme(s)': ['Forêt Mixte'] }),
    row({ Titre: '  Forêt Mixte - Alpes ', Type: 'extension', 'Joueur(s)': '2', 'Durée': 30, 'Gamme(s)': ['Forêt Mixte'] }),
    row({ Titre: 'Unlock!', Type: 'standalone', 'Édition': '', 'Joueur(s)': undefined, 'Durée': undefined }),
    row({ Titre: '' }),
    'not an object',
  ]));
  assert.deepEqual(rows.map((r) => r.title), ['Forêt Mixte', 'Forêt Mixte - Alpes', 'Unlock!'],
    'an untitled row is skipped, a title is trimmed');
  assert.deepEqual(rows[0], {
    key: 'r0', title: 'Forêt Mixte', year: 2021, expansion: false, lines: ['Forêt Mixte'],
    players: { min: 1, max: 5 }, playtime: { min: 40, max: 60 },
  });
  assert.equal(rows[1].expansion, true);
  assert.deepEqual(rows[1].players, { min: 2, max: 2 });
  assert.equal(rows[2].expansion, false, 'a standalone is an ordinary game');
  assert.equal(rows[2].year, null);
  assert.equal(rows[2].players, null);
  assert.equal(rows[2].playtime, null);
  assert.notEqual(rows[0].key, rows[1].key);
});

test('parseMyludoShelf refuses a file that is not a Myludo shelf', () => {
  assert.deepEqual(parseMyludoShelf('[]'), [], 'an empty shelf is a valid, empty shelf');
  for (const other of ['{"plays":[]}', '"text"', '[{"name":"Catan"}]', '[1,2]']) {
    assert.throws(() => parseMyludoShelf(other), /not_myludo/, other);
  }
  assert.throws(() => parseMyludoShelf('Titre;Édition\nCatan;1995'), SyntaxError, 'a CSV is not JSON');
  const big = Array.from({ length: MYLUDO_IMPORT_MAX + 1 }, (_, i) => row({ Titre: `G${i}` }));
  assert.throws(() => parseMyludoShelf(big), /too_many/);
});

test('myludoMatch: same title + year is sure; a year mismatch is offered but not sure', () => {
  const r = { title: 'Les Aventuriers du Rail', year: 2004 };
  const hits = [
    { providerId: '9', title: 'Les Aventuriers du Rail: Europe', year: 2005 },
    { providerId: '1', title: 'Les aventuriers du rail', year: 2004 },
  ];
  assert.deepEqual(myludoMatch(r, hits), { hit: hits[1], sure: true });
  assert.deepEqual(myludoMatch({ ...r, year: 2015 }, hits), { hit: hits[1], sure: false });
  assert.deepEqual(myludoMatch({ ...r, year: null }, hits), { hit: hits[1], sure: true },
    'no year on the row cannot contradict the title');
  // No exact title: a longer title in the same year is a guess, never sure.
  assert.deepEqual(myludoMatch({ title: 'Les Aventuriers du Rail', year: 2005 }, [hits[0]]),
    { hit: hits[0], sure: false });
  assert.deepEqual(myludoMatch({ title: 'Les Aventuriers du Rail', year: 2010 }, [hits[0]]),
    { hit: null, sure: false });
  assert.deepEqual(myludoMatch(r, []), { hit: null, sure: false });
});

test('attachMyludoExpansions finds the base by product line, then by title prefix', () => {
  const rows = parseMyludoShelf([
    row({ Titre: 'Catan' }),
    row({ Titre: 'Catan Junior' }),
    row({ Titre: 'Forêt Mixte', 'Gamme(s)': ['Forêt Mixte'] }),
    row({ Titre: 'Alpes', Type: 'extension', 'Gamme(s)': ['Forêt Mixte'] }),
    row({ Titre: 'Catan Junior - Pirates', Type: 'extension' }),
    row({ Titre: 'Cascadia - Landmarks', Type: 'extension' }),
    row({ Titre: 'Orpheline', Type: 'extension' }),
  ]);
  const shelf = [{ id: 'g-cascadia', title: 'Cascadia' }, { id: 'g-wish', title: 'Orpheline', wish: true }];
  const map = attachMyludoExpansions(rows, shelf);
  const byTitle = (t) => map.get(rows.find((r) => r.title === t).key);
  assert.deepEqual(byTitle('Alpes'), { rowKey: rows[2].key }, 'by the product line');
  assert.deepEqual(byTitle('Catan Junior - Pirates'), { rowKey: rows[1].key }, 'the LONGEST title prefix wins');
  assert.deepEqual(byTitle('Cascadia - Landmarks'), { gameId: 'g-cascadia' }, 'a shelf game is a base too');
  assert.equal(byTitle('Orpheline'), null, 'a wish is no base, and an unmatched expansion is skipped');
  assert.equal(map.size, 4, 'one answer per expansion row, none for a game');
});

test('myludoShelfMatch: a linked row by BGG id, an unlinked row by folded title', () => {
  const games = [
    { id: 'g1', title: 'Scout', source: { provider: 'bgg', externalId: '291453' } },
    { id: 'g2', title: 'Café International' },
  ];
  assert.equal(myludoShelfMatch({ bggId: 291453 }, { title: 'anything' }, games), games[0]);
  assert.equal(myludoShelfMatch({ bggId: 1 }, { title: 'Scout' }, games), null,
    'a linked row never matches by title — BGG holds several games under one name');
  assert.equal(myludoShelfMatch(null, { title: 'CAFE international' }, games), games[1]);
  assert.equal(myludoShelfMatch(null, { title: 'Azul' }, games), null);
});

test('buildMyludoImport sends only the picked rows, with expansions under their base', () => {
  const rows = parseMyludoShelf([
    row({ Titre: 'Forêt Mixte', 'Joueur(s)': '1 — 5', 'Durée': '40 — 60', 'Gamme(s)': ['Forêt Mixte'] }),
    row({ Titre: 'Alpes', Type: 'extension', 'Joueur(s)': '2 — 5', 'Gamme(s)': ['Forêt Mixte'] }),
    row({ Titre: 'Azul', 'Durée': 45 }),
    row({ Titre: 'Cascadia - Landmarks', Type: 'extension', 'Joueur(s)': '1 — 6' }),
    row({ Titre: 'Orpheline', Type: 'extension' }),
    row({ Titre: 'Pas choisi' }),
  ]);
  const [foret, alpes, azul, landmarks, orpheline, unpicked] = rows;
  const attach = attachMyludoExpansions(rows, [{ id: 'g-cascadia', title: 'Cascadia' }]);
  const choices = new Map([[azul.key, { bggId: '230802', title: 'Azul' }], [foret.key, null]]);
  const picked = new Set([foret, alpes, azul, landmarks, orpheline].map((r) => r.key));
  const { body, skipped } = buildMyludoImport(rows, { choices, picked, attach });

  assert.deepEqual(body.games, [
    { title: 'Forêt Mixte', minPlayers: 1, maxPlayers: 5, playtime: { min: 40, max: 60 },
      expansions: [{ title: 'Alpes', minPlayers: 2, maxPlayers: 5 }] },
    // Linked: BGG's title and id, and NO playtime — it would shadow BGG's.
    { title: 'Azul', bggId: 230802, minPlayers: 2, maxPlayers: 4 },
  ]);
  assert.deepEqual(body.attach, [{ gameId: 'g-cascadia', expansions: [{ title: 'Cascadia - Landmarks', minPlayers: 1, maxPlayers: 6 }] }]);
  assert.equal(skipped, 1, 'the orphan expansion is the one skipped');
  assert.ok(!JSON.stringify(body).includes(unpicked.title), 'an unpicked row never reaches the request');
});
