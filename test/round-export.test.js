'use strict';

/* A round's data export (#1702): public/js/round-export.js, the settings row
   that starts it, and the vendored fflate it zips with.

   Run through the jsdom harness, never required: the export calls the screen's
   own functions (`roundScoreIndex`, `sessionOutcome`, `gamePlaytime`, …) off the
   shared scope, and asserting it against those same functions is the whole
   point — a CSV that states a different score than the Regal is the bug this
   feature must not have. The expected values below are therefore computed IN
   the app context, from the shared functions, not hand-copied
   (`.claude/rules/assert-the-decision-not-its-ingredients.md`). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');

const { loadApp, flush } = require('./support/dom');

const ROOT = path.join(__dirname, '..');
const RID = 'r1';

// A Korean round name, members whose names need every kind of CSV escaping,
// and one of each session shape the acceptance criteria list.
function roundFixture() {
  return {
    id: RID,
    name: '금요일 보드게임',
    tags: [{ id: 't1', name: 'Kenner, "Strategie"', icon: 'ti-brain' }, { id: 't2', name: 'Party' }],
    members: [
      { id: 'm1', name: '지민', color: '#7f77dd' },
      { id: 'm2', name: 'Ben, "der Große"', color: '#1d9e75' },
      { id: 'm3', name: 'Zeile\neins', color: '#d85a30', retired: true },
      { id: 'm4', name: '=HYPERLINK("x")', color: '#378add' },
    ],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: ['t1'], ownerIds: ['m1', 'm2'],
        minPlaytime: 60, maxPlaytime: 120, playtimeOverride: { min: 45, max: 90 }, weight: 2.3,
        source: { provider: 'bgg', externalId: '13' }, expansions: [{ title: 'Seefahrer', minPlayers: 3, maxPlayers: 4 }] },
      { id: 'g2', title: 'Azul', retired: true, tagIds: ['t1', 't2'] },
      { id: 'g3', title: 'Ark Nova', wish: true },
      { id: 'g4', title: 'Cascadia', completed: true },
      { id: 'g5', title: 'Unrated' },
    ],
    sessions: [
      { id: 's1', createdAt: '2026-08-02T18:30:00.000Z', memberIds: ['m1', 'm2'],
        guests: [{ id: 'gu1', name: 'Gast, Eva' }],
        teams: [{ id: 'tm1', personIds: ['m1', 'gu1'] }],
        gameIds: ['g1', 'g2'], chosenGameId: 'g1', finished: true, winnerIds: ['m1', 'gu1'],
        votes: { m1: { g1: { rating: 5 }, g2: { rating: 2 } }, m2: { g1: { rating: 4 } }, gu1: { g1: { rating: 3 } } },
        scores: { m1: 42, m2: -3, gu1: 40 } },
      { id: 's2', createdAt: '2026-08-09T18:00:00.000Z', memberIds: ['m1', 'm4'], dateOnly: true,
        events: [{ type: 'logged' }], gameIds: ['g1'], chosenGameId: 'g1', finished: true,
        winnerIds: [], ending: 'noWinner', votes: {} },
      { id: 's3', createdAt: '2026-08-16T18:00:00.000Z', memberIds: ['m1', 'm2'], gameIds: ['g2'],
        chosenGameId: 'g2', finished: true, winnerIds: [], ending: 'ongoing',
        // m3 rated and was then removed from the session (#1538): out of the
        // session, still in the shelf's score — so still in votes.csv.
        removedPeople: [{ id: 'm3' }], votes: { m2: { g2: { rating: 1 } }, m3: { g2: { rating: 5 } } } },
      { id: 's4', createdAt: '2026-08-20T18:00:00.000Z', memberIds: ['m1'], gameIds: ['g1'],
        chosenGameId: null, cancelled: true, votes: {} },
      { id: 's5', createdAt: '2026-08-23T18:00:00.000Z', memberIds: ['m1', 'm2', 'm4'], gameIds: ['g1', 'g5'],
        multiTable: true, done: true, childSessionIds: ['s6'], votes: {} },
      { id: 's6', createdAt: '2026-08-23T18:10:00.000Z', memberIds: ['m1', 'm2'], gameIds: ['g1'],
        parentSessionId: 's5', chosenGameId: 'g1', votes: {} },
    ],
  };
}

// RFC 4180, enough of it to read back what the export writes.
function parseCsv(text) {
  assert.equal(text.charCodeAt(0), 0xfeff, 'every CSV opens with a BOM, or Excel misreads non-ASCII');
  const s = text.slice(1);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r' && s[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += c;
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function boot(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = roundFixture();
  dom.context.__round = round;
  return { dom, round };
}

const tables = (dom) => dom.run('roundExportTables(__round)');

test('games.csv states the Regal\'s own score and play count for every game (#1702)', (t) => {
  const { dom } = boot(t);
  const games = parseCsv(tables(dom)['games.csv']);
  // What the shelf computes, from the shelf's own index — in the app context.
  const expected = dom.run(`(() => {
    const idx = roundScoreIndex(__round, __round.games);
    return __round.games.map((g) => {
      const st = idx.byGame[g.id];
      return { id: g.id, score: Number.isFinite(st.score) ? fmtAvg(displayScore(st.score)) : '',
        plays: String(playCounts(__round).get(g.id) || 0) };
    });
  })()`);
  assert.equal(games.length, 5, 'every game, off-shelf ones included');
  for (const e of expected) {
    const row = games.find((g) => g.game_id === e.id);
    // fmtAvg is the pill's printing; the CSV writes the same one decimal with a dot.
    assert.equal(row.score.replace('.', ','), e.score, `score of ${e.id}`);
    assert.equal(row.plays, e.plays, `plays of ${e.id}`);
  }
  assert.ok(expected.some((e) => e.score !== ''), 'the fixture must actually score something');
  assert.ok(expected.some((e) => e.plays !== '0'), 'and actually play something');
});

test('games.csv labels every state and reads playtime through the override (#1702)', (t) => {
  const { dom } = boot(t);
  const games = Object.fromEntries(parseCsv(tables(dom)['games.csv']).map((g) => [g.game_id, g]));
  assert.deepEqual(['g1', 'g2', 'g3', 'g4', 'g5'].map((id) => games[id].state),
    ['active', 'retired', 'wished', 'completed', 'active']);
  assert.equal(games.g1.min_playtime, '45', 'the hand-set override wins over BGG (#1627)');
  assert.equal(games.g1.max_playtime, '90');
  assert.equal(games.g1.bgg_id, '13');
  assert.equal(games.g1.owners, '지민; Ben, "der Große"');
  assert.equal(games.g1.tags, 'Kenner, "Strategie"');
  assert.equal(games.g1.expansions, 'Seefahrer');
  assert.equal(games.g2.tags, 'Kenner, "Strategie"; Party');
});

test('sessions.csv: outcomes, endings, guests, teams, splits and date-only days (#1702)', (t) => {
  const { dom } = boot(t);
  const rows = Object.fromEntries(parseCsv(tables(dom)['sessions.csv']).map((s) => [s.session_id, s]));
  const outcome = (sid) => dom.run(`sessionOutcome(__round.sessions.find((s) => s.id === '${sid}'))`);
  for (const sid of ['s1', 's2', 's3', 's4', 's5', 's6']) assert.equal(rows[sid].outcome, outcome(sid), sid);
  assert.equal(rows.s4.outcome, 'cancelled');
  assert.equal(rows.s5.outcome, 'split');
  assert.equal(rows.s5.split_into, 's6');
  assert.equal(rows.s6.parent_session_id, 's5');
  assert.equal(rows.s1.ending, 'won');
  assert.equal(rows.s2.ending, 'noWinner');
  assert.equal(rows.s3.ending, 'ongoing');
  assert.equal(rows.s4.ending, '');
  assert.equal(rows.s1.winners, '지민; Gast, Eva', 'a guest can win');
  assert.equal(rows.s1.members, '지민; Ben, "der Große"');
  assert.equal(rows.s1.guests, 'Gast, Eva');
  assert.equal(rows.s1.teams, '지민 + Gast, Eva');
  assert.equal(rows.s1.game, 'Catan');
  assert.match(rows.s1.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(rows.s1.time, /^\d{2}:\d{2}$/, 'an app-stamped session keeps its time');
  assert.equal(rows.s2.time, '', 'a date-only session states no time (#1629)');
});

test('votes.csv and points.csv carry one row per rating and per score (#1702)', (t) => {
  const { dom } = boot(t);
  const all = tables(dom);
  const votes = parseCsv(all['votes.csv']);
  assert.equal(votes.length, 6);
  assert.ok(votes.some((v) => v.person_id === 'm3' && v.session_id === 's3'),
    'a rating by someone removed afterwards still counts for the shelf, so it is exported');
  const eva = votes.find((v) => v.person_id === 'gu1');
  assert.deepEqual({ ...eva, date: '' }, {
    session_id: 's1', date: '', person_id: 'gu1', person: 'Gast, Eva', guest: 'true',
    game_id: 'g1', game: 'Catan', rating: '3',
  });
  assert.ok(votes.filter((v) => v.person_id !== 'gu1').every((v) => v.guest === 'false'),
    'a member row says false, not an empty cell — the column filters the same in both tables');
  const points = parseCsv(all['points.csv']);
  assert.deepEqual(points.map((p) => [p.person, p.points]),
    [['지민', '42'], ['Ben, "der Große"', '-3'], ['Gast, Eva', '40']],
    'a negative score stays a number — no formula guard on numbers');
});

test('members.csv and tags.csv survive commas, quotes, newlines and Hangul (#1702)', (t) => {
  const { dom } = boot(t);
  const all = tables(dom);
  const members = parseCsv(all['members.csv']);
  assert.deepEqual(members.map((m) => m.name),
    ['지민', 'Ben, "der Große"', 'Zeile\neins', '\'=HYPERLINK("x")']);
  assert.equal(members[2].retired, 'true');
  assert.match(all['members.csv'], /"Zeile\neins"/, 'a newline is quoted, not split into a row');
  const tags = parseCsv(all['tags.csv']);
  assert.deepEqual(tags.map((tg) => [tg.name, tg.games]), [['Kenner, "Strategie"', '2'], ['Party', '1']]);
});

test('a text cell opening with a formula character is defused; a number is not (#1702)', (t) => {
  const { dom } = boot(t);
  const cell = (v) => dom.call('exportCsvCell', v);
  assert.equal(cell('=1+1'), '\'=1+1');
  assert.equal(cell('+49 123'), '\'+49 123');
  assert.equal(cell('-x'), '\'-x');
  assert.equal(cell('@SUM'), '\'@SUM');
  assert.equal(cell(-3), '-3');
  assert.equal(cell('a"b'), '"a""b"');
  assert.equal(cell(null), '');
  assert.equal(cell(Number.NaN), '');
});

test('the filename is a safe slug of the round name plus the local day (#1702)', (t) => {
  const { dom } = boot(t);
  const name = (n) => dom.run(`roundExportFilename({ name: ${JSON.stringify(n)} }, new Date(2026, 9, 20, 12))`);
  assert.equal(name('Freitagsrunde Köln'), 'spielwirbel-freitagsrunde-koln-2026-10-20.zip');
  assert.equal(name('Spaß & Spiel!'), 'spielwirbel-spass-spiel-2026-10-20.zip');
  assert.equal(name('../../etc/passwd'), 'spielwirbel-etc-passwd-2026-10-20.zip');
  assert.equal(name('금요일'), 'spielwirbel-round-2026-10-20.zip', 'nothing left → a fallback, not "--"');
});

test('the zip holds the six tables and the complete round as JSON (#1702)', (t) => {
  const { dom, round } = boot(t);
  const bytes = Buffer.from(dom.run('roundExportZip(__round)'));
  const files = unzipSync(new Uint8Array(bytes));
  assert.deepEqual(Object.keys(files).sort(),
    ['games.csv', 'members.csv', 'points.csv', 'round.json', 'sessions.csv', 'tags.csv', 'votes.csv']);
  assert.deepEqual(JSON.parse(strFromU8(files['round.json'])), round);
  assert.ok(strFromU8(files['members.csv']).includes('지민'), 'UTF-8 survives the zip');
});

test('the settings row is offered to an editor and downloads a fresh snapshot (#1702)', async (t) => {
  const { dom, round } = boot(t);
  const grantee = { ...round, shared: true, role: 'editor' };
  const reads = [];
  dom.set('api', async (method, url) => { reads.push(url); return grantee; });
  dom.set('accountsActive', () => true);
  const blobs = [];
  dom.window.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:x'; };
  dom.window.URL.revokeObjectURL = () => {};
  let saved = null;
  dom.window.HTMLAnchorElement.prototype.click = function click() { saved = this.download; };
  await dom.call('showRoundSettings', RID);
  const row = [...dom.app.querySelectorAll('button.rs-row')]
    .find((b) => b.textContent.includes(dom.run("t('roundSettings.export')")));
  assert.ok(row, 'an editor — who clears neither sheet capability — is still offered the export');
  reads.length = 0;
  row.click();
  await flush();
  assert.deepEqual(reads, [`/api/rounds/${RID}`], 'one network read, not the SWR cache');
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].type, 'application/zip');
  assert.match(saved, /^spielwirbel-round-\d{4}-\d{2}-\d{2}\.zip$/);
});

test('a failed build toasts and reports, since no server hears of it (#1702)', async (t) => {
  const { dom, round } = boot(t);
  dom.set('api', async () => round);
  const reports = [];
  const toasts = [];
  dom.set('reportClientError', (kind) => reports.push(kind));
  dom.set('toast', (msg) => toasts.push(msg));
  dom.window.URL.createObjectURL = () => { throw new Error('quota'); };
  await dom.call('downloadRoundExport', RID);
  assert.deepEqual(reports, ['round_export']);
  assert.deepEqual(toasts, [dom.run("t('roundSettings.exportFailed')")]);
});

test('the vendored fflate is byte-identical to the devDependency, licence beside it (#1702)', () => {
  // fflate's `exports` map hides the UMD build from require.resolve, so locate
  // the package root through its main entry and walk to the file.
  const pkgRoot = path.dirname(require.resolve('fflate/package.json', { paths: [ROOT] }));
  const upstream = path.join(pkgRoot, 'umd', 'index.js');
  const ours = fs.readFileSync(path.join(ROOT, 'public', 'js', 'vendor', 'fflate.min.js'));
  assert.ok(ours.equals(fs.readFileSync(upstream)),
    'public/js/vendor/fflate.min.js differs from node_modules/fflate/umd/index.js — after an fflate bump, '
    + 're-copy the file (and its LICENSE) and bump CACHE in public/sw.js');
  const lic = fs.readFileSync(path.join(ROOT, 'public', 'js', 'vendor', 'fflate.LICENSE.txt'));
  assert.ok(lic.equals(fs.readFileSync(path.join(pkgRoot, 'LICENSE'))),
    'MIT requires the notice with every copy');
});
