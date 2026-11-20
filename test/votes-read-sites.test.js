'use strict';

/* #1838: a TASTE figure must read ratings through public/js/session-ratings.js,
   never straight off `session.votes`, or a „Wie war's?" verdict is silently
   ignored by it — nothing goes red, the figure just leaves verdicts out.

   So every line in lib/, public/js/ and scripts/ that reads `.votes` /
   `votes[` is counted per file and compared with the allowlist below. Each
   entry is a BALLOT-ONLY reader (tonight's tally, who voted, the vote link,
   vote secrecy) or housekeeping (writers, the backends' storage, the delete
   cleanup), with its line count pinned — so a new direct read in an allowed
   file goes red as well as one in a new file.

   If this goes red: a taste figure (how someone LIKES a game) belongs on
   `sessionRatings`/`personRatings`. A genuine ballot reader may be added here,
   with its reason. The count is LINES that match, comments included. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PATTERN = /\.votes\b|\bvotes\[/;

const ALLOWED = {
  'lib/demo.js': [6, 'seeds votes'],
  'lib/session-votes.js': [3, 'vote secrecy and sanitising'],
  'lib/session-split.js': [1, 'table proposals score the ballot'],
  'lib/user-plays.js': [1, 'the vote is the fallback when no verdict exists'],
  'lib/providers/bgg.js': [4, "BGG's own poll votes, not ours"],
  'lib/routes/sessions.js': [5, 'the vote routes'],
  'lib/routes/vote-link.js': [1, 'the shared vote link'],
  'lib/repo/json.js': [13, 'storage: writers, game-removal cleanup, the Discover histogram (both kinds)'],
  'lib/repo/postgres.js': [10, 'storage: writers, game-removal cleanup'],
  'lib/repo/migrations/20260905120000_drop_retire_votes.js': [1, 'a past data migration'],
  'public/js/views-session-live.js': [1, 'live voting view'],
  'public/js/vote-boost.js': [3, 'memberBoosts: whose WISHES got played — pre-play by definition'],
  'public/js/views-session-tables.js': [3, "the tables' vote feedback"],
  'public/js/session-ratings.js': [4, 'the accessor itself'],
  'public/js/vote-hint.js': [1, 'voterKnowsGame — a verdict implies a seat at the played game, which the next clause covers'],
  'public/js/views-session.js': [5, 'the vote flow'],
  'public/js/member-active.js': [1, 'a comment'],
  'public/js/achievements.js': [4, 'badges about ballots cast'],
  'public/js/round-export.js': [1, 'votes.csv; verdicts travel in round.json'],
  'public/js/views-vote-link.js': [3, 'the shared vote link'],
  'public/js/game-stats.js': [1, "gameStatsForSession — tonight's result"],
  'public/js/session-outcome.js': [1, 'sessionHasVotes — did anyone vote'],
  'public/js/views-session-sheets.js': [1, 'the session sheets'],
  'public/js/views-session-result-tafel.js': [1, "the result's Tafel"],
  'scripts/capture-landing-shots.js': [1, 'screenshot fixture'],
  'scripts/migrate-retire-votes.js': [5, 'a past data script'],
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

function siteCounts() {
  const found = {};
  for (const file of ['lib', 'public/js', 'scripts'].flatMap((d) => walk(d))) {
    const n = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').filter((l) => PATTERN.test(l)).length;
    if (n) found[file] = n;
  }
  return found;
}

test('every direct `.votes` read sits in an allowlisted ballot-only or storage file, at its pinned count', () => {
  const found = siteCounts();
  // Anti-vacuous: the scan must actually find the readers it allows.
  assert.ok(Object.keys(found).length >= 20, `the scan found only ${Object.keys(found).length} files — is the pattern broken?`);
  const wrong = Object.entries(found)
    .filter(([file, n]) => !ALLOWED[file] || ALLOWED[file][0] !== n)
    .map(([file, n]) => `${file}: ${n} line(s), allowed ${ALLOWED[file] ? ALLOWED[file][0] : 0}`);
  const stale = Object.keys(ALLOWED).filter((file) => !found[file]);
  assert.deepEqual(wrong, [], 'a direct votes read outside the allowlist — a taste figure must use sessionRatings');
  assert.deepEqual(stale, [], 'an allowlisted file no longer reads votes — drop its entry');
});

test('the pattern sees the shapes the taste loops used to have', () => {
  for (const line of ['const v = (s.votes[p.id] || {})[gameId];', 'const votes = session.votes || {};', 'own = votes[person.id]'])
    assert.ok(PATTERN.test(line), line);
  for (const line of ['sessionRatings(s, people)', 'const verdicts = s.verdicts;'])
    assert.ok(!PATTERN.test(line), line);
});
