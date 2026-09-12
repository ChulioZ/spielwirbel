'use strict';

/*
 * Shared kit for the specs that read what the logger actually wrote:
 * test/observability.test.js and test/client-error-logging.test.js.
 *
 * Extracted when the second file needed it. Copying it instead would have put a
 * second `parseLogLines` next to the first — and the whole point of parseLogLines
 * is the chunk-boundary subtlety documented on it, which is exactly the kind of
 * hard-won detail a copy loses (.claude/rules/shared-constants-across-the-stack.md).
 */

// Capture everything written to stdout while `fn` runs, restoring afterwards.
async function captureStdout(fn) {
  const lines = [];
  const orig = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    lines.push(String(chunk));
    return orig.call(process.stdout, chunk, ...rest);
  };
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return lines.join('').split('\n').filter(Boolean);
}

// Parse only the JSON log lines, ignoring any unrelated stdout noise the test
// runner may interleave.
//
// The noise is not merely *between* our lines: node:test's reporter writes
// binary IPC frames to the same stdout we're capturing, and one write can carry
// a frame AND a pino line in a single chunk with no newline between them. So
// locate where our JSON actually starts instead of requiring index 0 — a
// `startsWith('{')` check silently drops a real, correctly-emitted log line
// depending on chunk boundaries (which is exactly how it behaves: flaky by
// test-name-pattern and by position in the file).
//
// NOTE: this hands back PARSED objects, so a duplicated key collapses to its
// last occurrence. A spec about the serialized line's integrity must read the
// raw string instead — see rawLogLines below.
function parseLogLines(lines) {
  const out = [];
  for (const l of lines) {
    const start = l.indexOf('{"level":');
    if (start === -1) continue;
    try {
      out.push(JSON.parse(l.slice(start)));
    } catch {
      // not one of ours
    }
  }
  return out;
}

// The same lines as parseLogLines, but as the raw JSON text pino emitted —
// trimmed of any interleaved runner noise ahead of the opening brace. The only
// way to see a duplicated key, which JSON.parse silently resolves.
function rawLogLines(lines) {
  const out = [];
  for (const l of lines) {
    const start = l.indexOf('{"level":');
    if (start === -1) continue;
    const raw = l.slice(start);
    try {
      JSON.parse(raw);
    } catch {
      continue; // not one of ours
    }
    out.push(raw);
  }
  return out;
}

function withEnv(key, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return (async () => {
    try {
      return await fn();
    } finally {
      if (had) process.env[key] = prev;
      else delete process.env[key];
    }
  })();
}

module.exports = { captureStdout, parseLogLines, rawLogLines, withEnv };
