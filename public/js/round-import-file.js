/* Spielwirbel – the round export's file format, read by both ends (#1756).

   „Daten exportieren" (#1702) writes `round.json` into its zip; „Aus Export
   importieren" reads it back as a NEW round, on this instance or another one.
   The format marker, the version and the "is this a round at all?" test live
   here, in one dependency-free file, because the browser writes and pre-checks
   the file while lib/round-import.js validates it again on the way in — and a
   marker spelled twice is the drift .claude/rules/shared-constants-across-the-stack.md
   exists to prevent. The route requires this file; index.html loads it as a
   shared-scope script.

   THE MARKER ANNOTATES THE ROUND rather than wrapping it: `round.json` stays
   "the round exactly as the API returned it" (round-export.js), plus three keys
   in front, so a script or spreadsheet that already reads the file keeps
   working. A #1702-era file has no marker and reads as version 1, provided it
   has the round's shape. */
'use strict';

const ROUND_EXPORT_FORMAT = 'spielwirbel-round';
const ROUND_EXPORT_FORMAT_VERSION = 1;

// The sessions a file may carry. Not a quota (there is no session quota): it is
// what keeps one request bounded on an instance that enforces none, and with
// the games cap it is what the route's byte limit is derived from
// (lib/round-import.js).
const ROUND_IMPORT_SESSIONS_MAX = 5000;

// The largest `round.json` the import accepts, in UTF-8 bytes. Measured on a
// route-built round: a provider-linked game with its metadata is ~1.5 KB of
// compact JSON, a session with votes, guests, teams, points and its log ~1 KB.
// A round at the default games quota (1000) with the full session cap is
// therefore ~6.5 MB, and 8 MB leaves room for long names and logs. The route
// parses with exactly this limit (a larger body is a 413) and the browser
// refuses a larger file before sending it, so the user hears „too large"
// rather than a generic failure.
const ROUND_IMPORT_BYTES_MAX = 8 * 1024 * 1024;

// Prepend the marker to a round snapshot — what the export writes.
function withRoundExportMarker(round, now) {
  return {
    format: ROUND_EXPORT_FORMAT,
    formatVersion: ROUND_EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    ...round,
  };
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Why a parsed JSON value is NOT an importable round, or null when it is. Only
// the envelope: the entities inside are the server's to validate. A file with a
// foreign `format` is refused even when it happens to look like a round, and a
// higher version than this build knows is refused rather than half-read.
function roundExportProblem(file) {
  if (!isPlainObject(file)) return 'not_a_round';
  if (file.format !== undefined && file.format !== ROUND_EXPORT_FORMAT) return 'not_a_round';
  if (file.formatVersion !== undefined) {
    if (!Number.isInteger(file.formatVersion) || file.formatVersion < 1) return 'not_a_round';
    if (file.formatVersion > ROUND_EXPORT_FORMAT_VERSION) return 'newer_format';
  }
  if (typeof file.id !== 'string' || typeof file.name !== 'string') return 'not_a_round';
  if (!['members', 'games', 'sessions'].every((k) => Array.isArray(file[k]))) return 'not_a_round';
  return null;
}

// The zip's local-file signature, „PK\x03\x04".
const isZip = (bytes) => bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

// The parsed round from a picked file's bytes: the export's zip (its
// `round.json`) or a bare `.json`. `unzip` is fflate's `unzipSync`, injected so
// a spec can run this without the vendored bundle. Throws an Error whose
// message is the code the view localizes: `no_round_json`, `not_a_round`,
// `newer_format`. A JSON syntax error is rethrown as `not_a_round` — the user
// picked the wrong file, which is theirs to fix, not a fault to report.
function readRoundExport(bytes, unzip) {
  let text;
  if (isZip(bytes)) {
    const files = unzip(bytes, { filter: (f) => f.name === 'round.json' });
    if (!files['round.json']) throw new Error('no_round_json');
    text = new TextDecoder().decode(files['round.json']);
  } else {
    text = new TextDecoder().decode(bytes);
  }
  let file;
  try { file = JSON.parse(text); } catch { throw new Error('not_a_round'); }
  const problem = roundExportProblem(file);
  if (problem) throw new Error(problem);
  return file;
}

// Which sessions an import brings over, as copies whose split links point
// only at sessions that also arrive. An OPEN one (a draw still collecting
// votes, a game still being played) would import as a broken session — its
// votes may even be redacted in the export (`redactRoundVotes`) — so it is
// skipped. A split parent is not open (`sessionOutcome` reads its children),
// but it BECOMES open once all its tables are skipped, so this runs to a fixed
// point. One function for the server's write and the browser's confirmation,
// so the count the user approves is the count that lands. `sessionOutcome` and
// `sessionChildIds` (session-outcome.js) are injected: a public/js file cannot
// require a sibling.
function roundImportSessions(sessions, { sessionOutcome, sessionChildIds }) {
  let kept = sessions.filter(isPlainObject).map((s) => ({ ...s }));
  for (;;) {
    const ids = new Set(kept.map((s) => s.id));
    kept.forEach((s) => {
      if (s.childSessionIds !== undefined) {
        const children = sessionChildIds(s).filter((id) => ids.has(id));
        if (children.length) s.childSessionIds = children; else delete s.childSessionIds;
      }
      if (s.parentSessionId != null && !ids.has(s.parentSessionId)) delete s.parentSessionId;
    });
    const next = kept.filter((s) => sessionOutcome(s) !== 'open');
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

// What the confirmation names before anything is written.
function roundExportSummary(file, deps) {
  return {
    name: file.name,
    games: file.games.length,
    members: file.members.length,
    sessions: roundImportSessions(file.sessions, deps).length,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ROUND_EXPORT_FORMAT,
    ROUND_EXPORT_FORMAT_VERSION,
    ROUND_IMPORT_SESSIONS_MAX,
    ROUND_IMPORT_BYTES_MAX,
    roundImportSessions,
    withRoundExportMarker,
    roundExportProblem,
    readRoundExport,
    roundExportSummary,
  };
}
