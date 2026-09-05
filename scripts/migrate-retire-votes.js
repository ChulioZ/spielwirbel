'use strict';

/*
 * One-off: drop the retirement-proposal flag out of every stored vote, for the
 * JSON backend (issue #909).
 *
 *   node scripts/migrate-retire-votes.js              # migrates the default dataset
 *   DATA_DIR=/path/to/data node scripts/migrate-retire-votes.js
 *   node scripts/migrate-retire-votes.js --dry-run    # report only, write nothing
 *
 * STOP THE SERVER FIRST. A running instance holds the whole dataset in memory
 * and rewrites the file on its next save, so it would silently discard
 * everything this changes (.claude/rules/data-json-external-edits.md).
 *
 * WHY IT EXISTS. #797 made "aussortieren" the zero of a 0–5 scale and
 * deliberately did NOT migrate storage — `effectiveRating()` resolved the two
 * legacy shapes on read. #909 removes the option, so that read-side rule is
 * gone and a retire-only vote would now read as "did not vote": the opinion
 * would silently vanish out of every average rather than being reinterpreted.
 *
 * Production runs Postgres, where the identical rewrite is a Knex migration
 * that applies itself on boot
 * (lib/repo/migrations/20260905120000_drop_retire_votes.js). This is the same
 * mapping for a self-hosted JSON instance, which has no migration runner.
 * test/migrate-retire-votes.test.js pins the two to the same table, which is
 * the only thing keeping the backends from reading one round two ways.
 *
 *   { rating: null, retire: true }  ->  { rating: 1 }
 *   { rating: N,    retire: true }  ->  { rating: N }   (the flag just goes)
 *   { rating: N,    retire: false } ->  { rating: N }
 *
 * `retire` as the STRING "true" was never `=== true` and so was never a
 * retirement: such a row keeps its rating and only loses the key.
 *
 * SAFE TO RUN TWICE, and safe to leave un-run: a second pass finds no flags and
 * writes nothing at all. Once no JSON instance can still be carrying pre-#909
 * data, delete this script — the repo keeps no permanent migration code
 * (CLAUDE.md).
 */

const fs = require('fs');
const path = require('path');

// Rewrite one dataset IN PLACE (the store's own shape:
// data.rounds[].sessions[].votes[personId][gameId]). Anything that is not the
// object graph we expect is stepped over untouched — this script's job is the
// flag, and quietly "repairing" a shape nobody wrote would destroy the evidence
// of what the data actually held.
function migrateVotes(data) {
  const stats = { votes: 0, flagsDropped: 0, rewritten: 0 };
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  (Array.isArray(data && data.rounds) ? data.rounds : []).forEach((round) => {
    (Array.isArray(round && round.sessions) ? round.sessions : []).forEach((session) => {
      if (!isObj(session) || !isObj(session.votes)) return;
      let touched = false;
      Object.values(session.votes).forEach((byGame) => {
        if (!isObj(byGame)) return;
        Object.values(byGame).forEach((vote) => {
          if (!isObj(vote)) return;
          stats.votes += 1;
          if (!('retire' in vote)) return;
          // Only a real `=== true` was a retirement, matching the read rule that
          // used to live in vote-scale.js — and matching the jsonb comparison
          // the Postgres migration has to spell by hand for the same reason.
          if (vote.retire === true && !Number.isFinite(vote.rating)) vote.rating = 1;
          delete vote.retire;
          stats.flagsDropped += 1;
          touched = true;
        });
      });
      if (touched) stats.rewritten += 1;
    });
  });
  return stats;
}

// Migrate one dataset file, backing it up first. Returns the backup's path, or
// null when there was nothing to do and the file was left untouched — an
// unnecessary rewrite of a live dataset is a risk with no upside.
function migrateFile(file, { dryRun = false } = {}) {
  const original = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(original);
  const stats = migrateVotes(data);
  if (!stats.flagsDropped || dryRun) return { stats, backup: null };
  const backup = `${file}.pre-909.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  fs.writeFileSync(backup, original, 'utf8');
  // The same atomic write the store uses: temp file first, then rename.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return { stats, backup };
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const dir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', 'data');
  const file = path.join(dir, 'data.json');
  if (!fs.existsSync(file)) {
    console.error(`No dataset at ${file} — set DATA_DIR to point at one.`);
    process.exit(1);
  }
  const { stats, backup } = migrateFile(file, { dryRun });
  console.log(`${file}: ${stats.votes} votes, ${stats.flagsDropped} retire flag(s) across ${stats.rewritten} session(s).`);
  if (dryRun) console.log('--dry-run: nothing written.');
  else if (backup) console.log(`Backup written to ${backup}`);
  else console.log('Nothing to migrate; the file was left untouched.');
}

module.exports = { migrateVotes, migrateFile };
