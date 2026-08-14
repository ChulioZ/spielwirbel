'use strict';

/*
 * The JSON backend's store for the BoardGameGeek corpus (issue #681) — its own
 * file under DATA_DIR, deliberately NOT part of data.json.
 *
 * THIS SEPARATION IS A HARD CONSTRAINT, not a preference. lib/store.js rewrites
 * the ENTIRE data.json on every mutation (saveData(): serialize the whole tree,
 * temp file, rename). The corpus is ~5000 rows of game metadata — an order of
 * magnitude more than a typical instance's own data — so folding it in would
 * make every single "add a game" and every vote re-serialize megabytes of BGG
 * facts that never change. Keeping it out of that path is the entire point.
 *
 * It is also not a "third persistence backend" in CLAUDE.md's sense: that call
 * is about not fragmenting ROUND-DATA storage across more than one source of
 * truth, and this holds no round data, no personal data and nothing a tenant
 * owns. The Postgres backend puts it in its own tables for the same reason.
 *
 * Mirrors lib/store.js's shape on purpose — load once, mutate the stable object
 * in place, persist atomically — so the two files read the same way. `corpus` is
 * never reassigned.
 */

const fs = require('fs');
const path = require('path');

const { DATA_DIR } = require('../store');

const CORPUS_FILE = path.join(DATA_DIR, 'bgg-corpus.json');

function loadCorpus() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    if (!parsed.meta || typeof parsed.meta !== 'object') parsed.meta = {};
    return parsed;
  } catch {
    // Missing, empty or corrupt -> an empty corpus. That is a legitimate state,
    // not an error: every instance starts here, and the consuming features show
    // their own empty state rather than failing.
    return { meta: {}, entries: [] };
  }
}

// Stable reference: mutated, never reassigned (lib/store.js's contract).
const corpus = loadCorpus();

// Atomic like saveData(): temp file first, then rename, so a crash mid-write
// cannot leave a half-written corpus that then fails to parse and silently
// reads as empty.
function saveCorpus() {
  const tmp = `${CORPUS_FILE}.tmp`;
  // No pretty-printing here, unlike data.json: nobody reads this by hand, and
  // indenting 5000 rows roughly doubles a file that is already the largest thing
  // this backend writes.
  fs.writeFileSync(tmp, JSON.stringify(corpus), 'utf8');
  fs.renameSync(tmp, CORPUS_FILE);
}

module.exports = { CORPUS_FILE, corpus, saveCorpus };
