'use strict';

/* scripts/session-cost.js reports what an agent session cost, and the whole
   point of it is that the numbers are trustworthy enough to compare a workflow
   change against. Two properties are load-bearing and neither is visible from
   the output — a wrong figure looks exactly like a right one:

   - argument parsing, where `--limit N` must consume N without letting it fall
     through as a transcript path (and must consume nothing when absent, or the
     first explicit path is eaten instead). Both directions shipped broken while
     this file was being written;
   - image accounting. A screenshot's base64 length is ~300KB while it bills as
     roughly a fixed ~1.5k tokens, so counting bytes would overstate it by two
     orders of magnitude and point the reader at the wrong thing entirely. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyze, parseArgs } = require('../scripts/session-cost');

const line = (obj) => `${JSON.stringify(obj)}\n`;

/** A synthetic transcript: two requests, one text result, one image result. */
function transcript() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-cost-'));
  const file = path.join(dir, 'sample.jsonl');
  fs.writeFileSync(file, [
    line({
      type: 'assistant',
      message: {
        usage: { input_tokens: 10, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, output_tokens: 100 },
        content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'git status' } }],
      },
    }),
    line({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x'.repeat(2000) }] },
    }),
    line({
      type: 'assistant',
      message: {
        usage: { input_tokens: 0, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 500, output_tokens: 50 },
        content: [{ type: 'tool_use', id: 'b', name: 'Read', input: { file_path: '/tmp/shot.png' } }],
      },
    }),
    line({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'b',
          content: [{ type: 'image', source: { data: 'y'.repeat(400_000) } }],
        }],
      },
    }),
    '\n',
    'not json at all\n',
  ].join(''));
  return file;
}

test('--limit consumes its value instead of leaving it as a path', () => {
  assert.deepEqual(parseArgs(['--limit', '10']), { limit: 10, explicit: [] });
});

test('an explicit path survives when --limit is absent', () => {
  // The regression: excluding index `limitArg + 1` unconditionally is index 0
  // when the flag is missing, which silently ate the only path given.
  assert.deepEqual(parseArgs(['a.jsonl']), { limit: 5, explicit: ['a.jsonl'] });
  assert.deepEqual(parseArgs(['--limit', '3', 'a.jsonl']), { limit: 3, explicit: ['a.jsonl'] });
});

test('--limit falls back to 5 when its value is missing or not a number', () => {
  assert.equal(parseArgs(['--limit']).limit, 5);
  assert.equal(parseArgs(['--limit', 'abc']).limit, 5);
});

test('the first request context is reported separately from the last', () => {
  const a = analyze(transcript());
  // The fixed preamble is the first figure and is re-read on every later call;
  // collapsing the two would hide exactly the number this tool exists to show.
  assert.equal(a.firstCtx, 40_010);
  assert.equal(a.lastCtx, 90_500);
  assert.equal(a.requests, 2);
  assert.equal(a.output, 150);
  assert.equal(a.cacheRead, 130_000);
});

test('an image result is flagged as one, not measured by its base64 length', () => {
  const a = analyze(transcript());
  const images = a.results.filter((r) => r.image);
  assert.equal(images.length, 1);
  assert.equal(images[0].bytes > 400_000, true, 'the fixture image is genuinely huge in bytes');

  // What the report must not do: let that 400KB dominate the "largest results"
  // list, which ranks non-image results only.
  const ranked = a.results.filter((r) => !r.image);
  assert.equal(ranked.length, 1);
  assert.match(ranked[0].label, /^Bash git status$/);
});

test('malformed and blank transcript lines are skipped, not thrown on', () => {
  // A live transcript is appended to while it is read, so a truncated final
  // line is normal — throwing there would make the tool unusable mid-session.
  assert.doesNotThrow(() => analyze(transcript()));
});
