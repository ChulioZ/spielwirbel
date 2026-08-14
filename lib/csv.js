'use strict';

/*
 * RFC 4180 CSV, both directions: the writer for the operator panel's exports
 * (issue #288) and the reader for the BoardGameGeek ranks dump (issue #681).
 *
 * Deliberately server-side and dependency-free: the consumers are
 * lib/routes/admin.js and lib/corpus.js, and keeping this out of public/js/**
 * sidesteps the coverage constraint that would otherwise apply (see
 * .claude/rules/frontend-helper-modules-and-coverage.md).
 *
 * The escaping here is the whole point of the module. Feedback messages are
 * user-authored free text that routinely contains commas, double quotes and
 * NEWLINES — an unquoted newline ends the record, so a single multi-line
 * submission would silently shift every following row into the wrong columns.
 * A corrupt export looks plausible in a spreadsheet, which is why this is a pure
 * function with its own unit tests rather than an inline join().
 */

// U+FEFF. Excel assumes the host's legacy 8-bit codepage for a .csv without one
// and renders German umlauts as mojibake ("Grüße" -> "GrÃ¼ÃŸe"); the BOM is what
// makes it read the file as UTF-8. Harmless to every other consumer.
const CSV_BOM = '﻿';

// Spreadsheet formula injection. A cell whose text begins with one of these is
// evaluated as a FORMULA by Excel and LibreOffice, not shown as text — so a
// feedback message of `=cmd|'/c calc'!A1` becomes code the operator's machine
// runs on open. RFC 4180 quoting does NOT prevent this: the quotes are consumed
// as CSV syntax and the formula is what remains.
//
// That matters more here than in most exports: the text is written by anyone who
// can reach the feedback widget, the reader is the operator (the most privileged
// human on the instance), and this file exists specifically to be opened in
// Excel — that is the whole reason for the BOM above.
//
// The fix is OWASP's: prefix a leading trigger with a single quote, which Excel
// consumes as "treat the rest as literal text" and does not display. TAB and CR
// are included because both can lead a cell the same way.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

// Every field is quoted unconditionally rather than only when it contains a
// delimiter. RFC 4180 permits it, it costs a few bytes, and it removes the
// entire class of "this value happened to need quoting and didn't get it" bugs.
function csvField(value) {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  // The trade-off, accepted deliberately: a legitimate message that opens with
  // "-" or "=" gains a leading apostrophe in the file. Excel hides it; a plain
  // text reader shows it. Mangling a leading dash beats executing a formula.
  const safe = FORMULA_LEAD.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

// `columns` is [[header, pick(row)], ...]. Records are CRLF-separated per RFC
// 4180 — Excel and LibreOffice both accept LF, but CRLF is what the spec says
// and what older Windows tooling expects.
function toCsv(columns, rows) {
  const lines = [columns.map(([header]) => csvField(header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map(([, pick]) => csvField(pick(row))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/*
 * The reader (issue #681), for the BoardGameGeek ranks dump the operator uploads.
 *
 * It lives here rather than in a module of its own because it is the same escaping
 * rules read backwards, and the two halves must agree about them — a reader that
 * disagreed with this file's writer would be exactly the drift
 * .claude/rules/shared-constants-across-the-stack.md is about.
 *
 * Hand-rolled rather than pulled in as a dependency: a CSV *reader* is ~30 lines
 * of state machine with no ambiguity left once the quoting rules are settled, and
 * the one real-world input is a machine-generated dump. The parts that actually
 * bite on that dump are handled explicitly below (a comma or a quote inside a
 * game title, a BOM, CRLF vs LF).
 *
 * Returns an array of records, each an array of raw string fields — no header
 * mapping and no type coercion, which is the caller's business (game titles are
 * not numbers and must not be guessed at).
 *
 * NEVER THROWS. A truncated or non-CSV upload yields whatever it yields, and the
 * caller refuses it by checking for the columns it needs. Throwing here would
 * turn "the operator picked the wrong file" into a 500.
 */
function fromCsv(text) {
  // A leading BOM would otherwise become part of the FIRST HEADER NAME, so a
  // lookup for 'id' misses and a perfectly good dump reads as having no id
  // column. Excel writes one on every export, and this file's own writer emits
  // one deliberately (CSV_BOM above).
  const s = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  // Whether the current record has seen anything at all. It is what distinguishes
  // a blank line (skipped) from a record of one empty field (kept) — a dump with
  // a trailing newline would otherwise gain a phantom final row.
  let dirty = false;

  const endField = () => { row.push(field); field = ''; };
  const endRecord = () => { endField(); rows.push(row); row = []; dirty = false; };

  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      // Inside quotes a doubled quote is a literal one and everything else —
      // commas, CR, LF — is ordinary text. That is the whole reason the reader
      // is a state machine and not a split(',') per line.
      if (c !== '"') field += c;
      else if (s[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      continue;
    }
    // A quote only opens a quoted run at the START of a field; one appearing
    // mid-field is kept as text. Being lenient here beats rejecting a row over a
    // stray quote in a title.
    if (c === '"' && field === '') { quoted = true; dirty = true; continue; }
    if (c === ',') { endField(); dirty = true; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      if (dirty || field !== '') endRecord();
      continue;
    }
    field += c;
    dirty = true;
  }
  // A file with no trailing newline still ends a record — and an unterminated
  // quoted field is flushed as text rather than dropped.
  if (dirty || field !== '') endRecord();
  return rows;
}

module.exports = { CSV_BOM, csvField, toCsv, fromCsv };
