'use strict';

/*
 * Fill a local dev instance with realistic content (#530).
 *
 *   node scripts/seed-dev.js [locale]        # locale: de (default) | en
 *
 * WHY THIS EXISTS. A fresh clone starts empty, so a contributor verifying a UI
 * change looks at a blank Regal, an empty Chronik and empty Pokale — i.e. at
 * none of the screens they are about to change. This writes one filled round
 * into a throwaway dataset so `preview_start`/`npm start` lands on a real app.
 *
 * IT REUSES THE GUEST DEMO'S SEED, deliberately: lib/demo.js's seedTenant()
 * already builds exactly this round (curated games with resolved hotlinked
 * covers, tags, four seats, two finished sessions with votes) through the
 * ordinary repo mutators. Copying that logic here would give the dev seed its
 * own second implementation to rot — the failure mode
 * .claude/rules/shared-constants-across-the-stack.md is about — so the script
 * is a wrapper around the real thing, and a change to the demo's shape lands
 * here for free. The covers stay HOTLINKS (never copies), see lib/demo-seed.js.
 *
 * THE DEV ACCOUNT is what makes the seed visible in BOTH auth modes. The round
 * belongs to the 'default' tenant, which an unauthenticated caller resolves to
 * in open mode (lib/tenant.js) — but the committed `dev-temp-data` launch
 * config runs with ACCOUNTS_ENABLED=true, where /api is Bearer-only, so there
 * the seed would be invisible behind the auth UI. Hence one local account whose
 * own tenantId is 'default' (the legacy pre-tenancy user shape lib/tenant.js
 * already supports): logging in as it resolves to the very same round, with no
 * second copy of the data and no re-tenanting.
 *
 * ITS CREDENTIALS ARE PUBLIC AND MUST STAY WORTHLESS. They are printed below and
 * committed here on purpose, exactly like the launch config's
 * `dev-only-not-a-secret` secrets: they only ever exist inside a gitignored
 * throwaway dataset. Never point this script at a dataset anyone can reach — the
 * DATA_DIR guard below refuses the repo's default data/ for that reason.
 *
 * NO SERVER MAY BE RUNNING against the target while this runs. A live server
 * holds the dataset in memory and rewrites the whole file on its next save, so
 * it would silently discard everything seeded here
 * (.claude/rules/data-json-external-edits.md).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_TARGET = path.join(ROOT, '.devdata');
// The dataset the app uses when DATA_DIR is unset — on a maintainer's machine
// this can hold a real instance's private data (.claude/rules/no-reading-production-data.md).
const FORBIDDEN_TARGET = path.join(ROOT, 'data');

const DEV_ACCOUNT = {
  email: 'dev@spielwirbel.invalid', // .invalid is reserved (RFC 2606): mail can never leave.
  username: 'dev',
  password: 'spielwirbel-dev',
};

function fail(message) {
  console.error(`seed-dev: ${message}`);
  process.exit(1);
}

// Short form for messages, but only while it stays short: path.relative happily
// answers '../../../..' for a target outside the repo (a temp dir), which is
// less readable than the absolute path it was meant to shorten.
function display(target) {
  const rel = path.relative(ROOT, target);
  return rel && !rel.startsWith('..') ? rel : target;
}

// Read the target's dataset WITHOUT requiring lib/store — requiring it creates
// the directory and caches the file, both of which we want to avoid on a path
// that is about to refuse.
function existingData(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  } catch {
    return null; // missing, empty or corrupt — all "nothing to lose here".
  }
}

async function main() {
  const locale = (process.argv[2] || 'de').toLowerCase();
  const target = path.resolve(process.env.DATA_DIR || DEFAULT_TARGET);

  if (target === FORBIDDEN_TARGET) {
    fail('refusing to seed the default data/ directory — it can hold a real instance\'s\n'
      + '  private data. Leave DATA_DIR unset to use .devdata/, or point it elsewhere.');
  }

  const existing = existingData(target);
  if (existing && ((existing.rounds || []).length || (existing.users || []).length)) {
    fail(`${display(target)} already holds data `
      + `(${(existing.rounds || []).length} round(s), ${(existing.users || []).length} account(s)).\n`
      + '  Delete it and re-run to start over — seeding on top would duplicate the round.');
  }

  // MUST precede the first require of lib/repo: the JSON store resolves DATA_DIR
  // and reads data.json once, at require time (.claude/rules/automated-tests.md).
  process.env.DATA_DIR = target;
  const repo = require('../lib/repo');
  const demo = require('../lib/demo');
  const accounts = require('../lib/accounts');
  const { TERMS_REVISION } = require('../lib/legal');

  await repo.init();

  // Created before the round so the owner seat can carry its id: that is what
  // makes the Chronik attribute the seeded actions to the logged-in dev account
  // and keeps its own chair out of the seat pickers (#421).
  const user = await repo.createUser({
    email: DEV_ACCOUNT.email,
    username: DEV_ACCOUNT.username,
    createdAt: new Date().toISOString(),
    // NOT a fresh tenant: 'default' is what an unauthenticated caller resolves
    // to in open mode, so both modes see one round rather than two datasets.
    tenantId: 'default',
    // Login refuses an unverified address (lib/routes/account.js), and no
    // verification mail can be delivered to a .invalid domain.
    emailVerified: true,
    identities: [{ type: 'password', hash: await accounts.hashPassword(DEV_ACCOUNT.password) }],
    verification: null,
    reset: null,
    refreshTokens: [],
    disabled: false,
    disabledAt: null,
    disabledReason: null,
    bggUsername: null,
    // Current, so the dev instance doesn't open on the terms-change notice.
    acceptedTermsRevision: TERMS_REVISION,
  });
  if (typeof user === 'string') fail(`could not create the dev account (${user}).`);

  const round = await demo.seedTenant('default', user.id, locale);
  const full = await repo.forTenant('default').getRound(round.id);

  const rel = display(target);
  console.log(`seed-dev: seeded ${rel}/data.json`);
  console.log(`  round     "${full.name}" — ${full.games.length} games, `
    + `${full.members.length} seats, ${(full.tags || []).length} tags, `
    + `${full.sessions.filter((s) => s.finished).length} finished sessions`);
  console.log(`  account   ${DEV_ACCOUNT.email} / ${DEV_ACCOUNT.password} (local only)`);
  console.log('  run       preview_start "dev-temp-data", or: '
    + `DATA_DIR=${rel} npm start`);
}

main().catch((err) => fail(err.message));
