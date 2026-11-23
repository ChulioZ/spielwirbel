/* Spielwirbel – „Aus Export importieren" (#1756): a round's data export read
   back in as a NEW round, here or on another instance.

   Reached from the new-round screen. The zip is read in the BROWSER, through
   the export's own fflate wrapper (`roundExportUnzip`, round-export.js), so zip
   parsing never reaches the server: only `round.json` is posted, and the route
   (lib/round-import.js) validates it again, allowlists every field and re-mints
   every id.

   Reading the file touches no server, so a fault there would otherwise be
   invisible — it reports (`.claude/rules/caught-client-faults-are-invisible.md`).
   A WRONG file is the user's to fix and is not reported: the toast says so. */

'use strict';

const ROUND_IMPORT_READ_ERRORS = {
  not_a_round: 'roundImport.error.notARound',
  no_round_json: 'roundImport.error.notARound',
  newer_format: 'roundImport.error.newer',
};

// The localized line for a refused import. The quota codes are the ones every
// create path answers with; a round cap gets the new-round screen's own text.
function roundImportErrorText(code) {
  if (code === 'quota_rounds') return t('newRound.toast.quota');
  if (/^quota_/.test(String(code))) return t('roundImport.error.quota');
  if (code === 'not_a_round' || code === 'invalid') return t('roundImport.error.notARound');
  if (code === 'newer_format') return t('roundImport.error.newer');
  return t('roundImport.error.failed');
}

// What the toast says once the round exists: the name, plus what did NOT come
// along, so a user is never left to discover a missing evening or cover.
function roundImportDoneText(name, report) {
  const parts = [t('roundImport.done', { name })];
  if (report.skippedSessions) parts.push(tn(report.skippedSessions, 'roundImport.skippedOne', 'roundImport.skipped'));
  if (report.droppedImages) parts.push(tn(report.droppedImages, 'roundImport.droppedOne', 'roundImport.dropped'));
  return parts.join(' ');
}

// Open the system file picker. The input lives only for the one pick.
function pickRoundExportFile() {
  const input = h('<input type="file" accept=".zip,.json,application/zip,application/json" hidden />');
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.remove();
    if (f) importRoundExportFile(f);
  });
  document.body.appendChild(input);
  input.click();
}

async function importRoundExportFile(f) {
  let file;
  try {
    file = readRoundExport(new Uint8Array(await f.arrayBuffer()), roundExportUnzip);
  } catch (err) {
    const key = ROUND_IMPORT_READ_ERRORS[err && err.message];
    if (!key) reportClientError('round_import_parse', err);
    toast(t(key || 'roundImport.error.read'), { tone: 'error' });
    return;
  }
  // Refused here rather than as a 413: the user learns why, in their language.
  const body = JSON.stringify(file);
  if (new TextEncoder().encode(body).length > ROUND_IMPORT_BYTES_MAX) {
    toast(t('roundImport.error.tooLarge'), { tone: 'error' });
    return;
  }

  const sum = roundExportSummary(file, { sessionOutcome, sessionChildIds });
  const ok = await confirmDialog({
    title: t('roundImport.confirmTitle', { name: sum.name }),
    body: [
      tn(sum.games, 'roundImport.countGamesOne', 'roundImport.countGames'),
      tn(sum.sessions, 'roundImport.countSessionsOne', 'roundImport.countSessions'),
      tn(sum.members, 'roundImport.countMembersOne', 'roundImport.countMembers'),
    ].join(' · ') + '. ' + t('roundImport.confirmNote'),
    confirmLabel: t('roundImport.confirm'),
    danger: false,
    icon: 'ti-file-import',
  });
  if (!ok) return;

  let res;
  try {
    res = await api('POST', '/api/rounds/import', file);
  } catch (e) {
    toast(roundImportErrorText(e.message), { tone: 'error' });
    return;
  }
  toast(roundImportDoneText(res.round.name, res.report));
  showRound(res.round.id);
}
