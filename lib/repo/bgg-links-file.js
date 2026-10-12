'use strict';

/*
 * The JSON backend's store for the BGG link table (#1638) — its own file under
 * DATA_DIR, deliberately NOT part of data.json, for the corpus's reason
 * (lib/repo/corpus-file.js): lib/store.js rewrites the whole of data.json on
 * every mutation, and this table is a few thousand rows of public BGG metadata
 * written by a background pass. Folding it in would make every vote
 * re-serialize it. It holds no round data and nothing a tenant owns, so it is
 * not a "third persistence backend" in CLAUDE.md's sense either.
 *
 * Same shape as corpus-file.js: load once, mutate the stable object in place,
 * persist atomically. `links` is never reassigned.
 */

const fs = require('fs');
const path = require('path');

const { DATA_DIR } = require('../store');

const LINKS_FILE = path.join(DATA_DIR, 'bgg-links.json');

function loadLinks() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    return parsed;
  } catch {
    // Missing, empty or corrupt -> an empty table, which every instance starts
    // as: names simply render unlinked until a BGG parse fills it.
    return { entries: [] };
  }
}

// Stable reference: mutated, never reassigned (lib/store.js's contract).
const links = loadLinks();

// Atomic like saveData(): temp file, then rename.
function saveLinks() {
  const tmp = `${LINKS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(links), 'utf8');
  fs.renameSync(tmp, LINKS_FILE);
}

module.exports = { LINKS_FILE, links, saveLinks };
