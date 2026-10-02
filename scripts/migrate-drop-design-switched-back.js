'use strict';

/*
 * One-off: delete the `designSwitchedBack` key from every stored account, for
 * the JSON backend (issue #1480).
 *
 *   node scripts/migrate-drop-design-switched-back.js              # migrates the default dataset
 *   DATA_DIR=/path/to/data node scripts/migrate-drop-design-switched-back.js
 *   node scripts/migrate-drop-design-switched-back.js --dry-run    # report only, write nothing
 *
 * STOP THE SERVER FIRST. A running instance holds the whole dataset in memory
 * and rewrites the file on its next save, so it would silently discard
 * everything this changes (.claude/rules/data-json-external-edits.md).
 *
 * WHY IT EXISTS. #1201 stamped `designSwitchedBack` on an account that moved
 * back to Klassisch from another design, for the operator's switch-back share.
 * #1480 removed that share and stopped writing the field; an unread
 * personal-data field fails data minimisation (Art. 5 Abs. 1 lit. c DSGVO), so
 * the values already stored are deleted rather than left behind.
 *
 * Production runs Postgres, where the identical deletion is a Knex migration
 * that applies itself on boot
 * (lib/repo/migrations/20261002120000_drop_design_switched_back.js). This is
 * the same change for a self-hosted JSON instance, which has no migration
 * runner. Nothing reads the key either way, so skipping the script changes no
 * behaviour — it only leaves the stale values on disk.
 *
 * SAFE TO RUN TWICE, and safe to leave un-run: a second pass finds nothing and
 * writes nothing at all. Once no JSON instance can still be carrying pre-#1480
 * accounts, delete this script — the repo keeps no permanent migration code
 * (CLAUDE.md).
 */

const fs = require('fs');
const path = require('path');

const KEY = 'designSwitchedBack';

// Rewrite one dataset IN PLACE (the store's own shape: top-level data.users[]).
// Anything that is not an account object is stepped over untouched.
function dropSwitchedBack(data) {
  const stats = { users: 0, dropped: 0 };
  const users = Array.isArray(data && data.users) ? data.users : [];
  users.forEach((user) => {
    if (!user || typeof user !== 'object' || Array.isArray(user)) return;
    stats.users += 1;
    if (!Object.prototype.hasOwnProperty.call(user, KEY)) return;
    delete user[KEY];
    stats.dropped += 1;
  });
  return stats;
}

// Migrate one dataset file, backing it up first. Returns the backup's path, or
// null when there was nothing to do and the file was left untouched — an
// unnecessary rewrite of a live dataset is a risk with no upside.
function migrateFile(file, { dryRun = false } = {}) {
  const original = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(original);
  const stats = dropSwitchedBack(data);
  if (!stats.dropped || dryRun) return { stats, backup: null };
  const backup = `${file}.pre-1480.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
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
  console.log(`${file}: ${stats.users} account(s), ${stats.dropped} carrying ${KEY}.`);
  if (dryRun) console.log('--dry-run: nothing written.');
  else if (backup) console.log(`Backup written to ${backup}`);
  else console.log('Nothing to migrate; the file was left untouched.');
}

module.exports = { dropSwitchedBack, migrateFile };
