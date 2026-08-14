'use strict';

/*
 * RFC 4180 escaping for the operator panel's CSV exports (issue #288).
 *
 * The case that matters is a feedback message containing a comma, a double quote
 * AND a newline at once: an unquoted newline ends the record, so getting this
 * wrong silently shifts every following row into the wrong columns — an export
 * that still opens fine in a spreadsheet and is simply wrong.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { CSV_BOM, csvField, toCsv, fromCsv } = require('../lib/csv');

test('csvField quotes every field and doubles inner quotes', () => {
  assert.equal(csvField('plain'), '"plain"');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line1\nline2'), '"line1\nline2"');
  // Absent optional fields (an anonymous submission has no context.email) must
  // become an empty cell, never the string "undefined"/"null".
  assert.equal(csvField(undefined), '""');
  assert.equal(csvField(null), '""');
  assert.equal(csvField(0), '"0"');
});

// Feedback text is written by anyone who can reach the widget and is read by the
// operator in Excel — so a leading formula trigger must be neutralized. Quoting
// alone does not do it: Excel consumes the quotes as CSV syntax and evaluates
// what is left.
test('a leading formula trigger is neutralized, not just quoted', () => {
  assert.equal(csvField('=cmd|\'/c calc\'!A1'), '"\'=cmd|\'/c calc\'!A1"');
  for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
    assert.equal(csvField(`${lead}payload`), `"'${lead}payload"`, `lead ${JSON.stringify(lead)}`);
  }
  // Only the FIRST character matters — an inner '=' is ordinary text and must
  // not be mangled, or every "a=b" in a message would grow an apostrophe.
  assert.equal(csvField('total=5'), '"total=5"');
  assert.equal(csvField('kein Problem'), '"kein Problem"');
});

test('toCsv writes a header row and CRLF records', () => {
  const csv = toCsv([['A', (r) => r.a], ['B', (r) => r.b]], [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  assert.equal(csv, '"A","B"\r\n"1","2"\r\n"3","4"\r\n');
});

test('an empty set still emits its header row', () => {
  assert.equal(toCsv([['A', (r) => r.a]], []), '"A"\r\n');
});

// The acceptance criterion from #288, asserted rather than eyeballed.
test('a message with a comma, a quote and a newline does not corrupt later rows', () => {
  const rows = [
    { message: 'Hallo, ich finde die "Würfel"-Ansicht\nkaputt', email: 'a@example.com' },
    { message: 'zweite Nachricht', email: 'b@example.com' },
  ];
  const csv = toCsv([['Nachricht', (r) => r.message], ['E-Mail', (r) => r.email]], rows);

  // Parse it back with a real RFC 4180 reader: quoted newlines stay INSIDE the
  // field, so the document must hold exactly 3 records (header + 2), not 4.
  const records = parseCsv(csv);
  assert.equal(records.length, 3);
  assert.deepEqual(records[0], ['Nachricht', 'E-Mail']);
  assert.deepEqual(records[1], ['Hallo, ich finde die "Würfel"-Ansicht\nkaputt', 'a@example.com']);
  // The row AFTER the multi-line message is the one a broken escaper mangles.
  assert.deepEqual(records[2], ['zweite Nachricht', 'b@example.com']);
});

test('the BOM is a single U+FEFF, so Excel reads the file as UTF-8', () => {
  assert.equal(CSV_BOM, '﻿');
  assert.equal(CSV_BOM.length, 1);
  // Round-trips through a UTF-8 buffer as the canonical EF BB BF prefix.
  assert.deepEqual([...Buffer.from(CSV_BOM, 'utf8')], [0xef, 0xbb, 0xbf]);
});

// A minimal RFC 4180 reader — the point is to verify the writer with something
// other than the writer's own logic.
function parseCsv(text) {
  const records = [];
  let field = '';
  let record = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { record.push(field); field = ''; } else if (c === '\r' && text[i + 1] === '\n') {
      record.push(field); field = ''; records.push(record); record = []; i += 1;
    } else field += c;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  return records;
}

/*
 * The READER (issue #681) — the mirror image of the writer above, and the half
 * the BGG ranks dump needs. Its traps are the same escaping rules read backwards:
 * a game title containing a comma, a quote or a newline must not shift the row.
 *
 * Note the local parseCsv above is deliberately NOT replaced by fromCsv: it
 * exists so the writer is verified by something other than this repo's own
 * reader, which would make both halves agree about a shared mistake.
 */

test('fromCsv reads plain records', () => {
  assert.deepEqual(fromCsv('id,name\r\n13,CATAN\r\n'), [['id', 'name'], ['13', 'CATAN']]);
});

test('fromCsv accepts LF as well as CRLF, and skips blank lines', () => {
  assert.deepEqual(fromCsv('a,b\n1,2\n\n3,4\n'), [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('fromCsv keeps a quoted comma inside one field', () => {
  assert.deepEqual(fromCsv('id,name\r\n1,"Tigris, Euphrates"\r\n')[1], ['1', 'Tigris, Euphrates']);
});

test('fromCsv un-doubles an escaped quote', () => {
  assert.deepEqual(fromCsv('1,"say ""hi"""\r\n')[0], ['1', 'say "hi"']);
});

test('fromCsv keeps a quoted NEWLINE inside the field rather than ending the record', () => {
  const rows = fromCsv('id,name\r\n1,"two\r\nlines"\r\n2,plain\r\n');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['1', 'two\r\nlines']);
  assert.deepEqual(rows[2], ['2', 'plain']);
});

test('fromCsv preserves empty fields, including a quoted empty one', () => {
  assert.deepEqual(fromCsv('1,,"",4')[0], ['1', '', '', '4']);
});

test('fromCsv strips a leading BOM so the first header name is usable', () => {
  assert.deepEqual(fromCsv(`${CSV_BOM}id,name\r\n`)[0], ['id', 'name']);
});

test('fromCsv round-trips what toCsv writes', () => {
  const written = toCsv([['id', (r) => r.id], ['name', (r) => r.name]],
    [{ id: '1', name: 'a,b "c"\nd' }]);
  assert.deepEqual(fromCsv(written), [['id', 'name'], ['1', 'a,b "c"\nd']]);
});

test('fromCsv never throws on junk, and answers [] for nothing at all', () => {
  assert.deepEqual(fromCsv(''), []);
  assert.deepEqual(fromCsv(null), []);
  // An unterminated quote yields the rest of the file as one field rather than
  // throwing: a truncated upload must be REFUSED by its caller's column check,
  // not by an exception here.
  assert.deepEqual(fromCsv('1,"unterminated'), [['1', 'unterminated']]);
});
