'use strict';

// Guards the PreToolUse hook that enforces this repo's two absolute data
// prohibitions (.claude/rules/no-reading-production-data.md and
// no-reading-env-files.md). See .claude/rules/pretooluse-guard-matches-inputs.md
// for why the hook is keyed to tool INPUTS rather than tool NAMES.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'guard-protected-paths.js');
const SETTINGS = path.join(ROOT, '.claude', 'settings.json');

const { protectedHit } = require(HOOK);

// --- what must be denied -------------------------------------------------
// Each case is [label, tool_input]. The tool NAME is deliberately absent from
// protectedHit's signature: a hook keyed to `Read` leaves `cat data/data.json`
// open while still reading as protection.
const DENY = [
  ['Read, absolute', { file_path: `${ROOT}/data/data.json` }],
  ['Read, relative', { file_path: 'data/data.json' }],
  ['cat the dataset', { command: 'cat data/data.json' }],
  ['head the dataset', { command: 'head -c 200 data/data.json' }],
  ['sed a slice out of it', { command: "sed -n '1,5p' data/data.json" }],
  ['grep the uploads', { command: 'grep -r foo data/uploads/' }],
  ['read one upload', { file_path: `${ROOT}/data/uploads/cover-1.jpg` }],
  ['glob-sweep the data dir', { command: 'cat data/*' }],
  ['cat the env file', { command: 'cat .env' }],
  ['run the server with it', { command: 'node --env-file=.env server.js' }],
  ['echo a secret out of it', { command: 'echo $SESSION_SECRET; cat .env' }],
  ['a local env file', { file_path: '.env.local' }],
  ['a scoped local env file', { file_path: '.env.production.local' }],
  ['an absolute env path', { command: `cat ${ROOT}/.env` }],
  // Rename immunity: an unknown tool with an unknown field name is still caught,
  // because the scan is over VALUES and skips only a named exclusion list.
  ['a tool that does not exist yet', { somePathField: 'data/data.json' }],
  ['a path nested in an array', { files: ['README.md', 'data/data.json'] }],
  ['a path nested in an object', { target: { location: '.env' } }],
];

// --- what must keep working ---------------------------------------------
// A deny-list that also blocks the legitimate paths pushes sessions toward
// working around it, which is worse than not having the hook (issue #880).
const ALLOW = [
  ['the committed template', { file_path: '.env.example' }],
  ['cat the committed template', { command: 'cat .env.example' }],
  ['a structural check of data/', { command: 'ls -la data/' }],
  ['the sanctioned throwaway dataset', { file_path: '.devdata/data.json' }],
  ['seeding the throwaway dataset', { command: 'DATA_DIR=$(mktemp -d) npm start' }],
  ['running the suite', { command: 'npm test' }],
  ['the rule that states the prohibition', { file_path: '.claude/rules/no-reading-env-files.md' }],
  ['the env-var documentation', { file_path: 'docs/configuration.md' }],
  ['a non-protected file under data/', { file_path: 'data/README.md' }],
  // Grep's `pattern` is a search string, not a path — excluding it leaves a
  // legitimate way to grep the rules for these very strings.
  ['grepping the rules for the path', { pattern: 'data/data.json', path: '.claude/rules' }],
  // Write/Edit content is what a file WILL contain, not a path being read —
  // without this exclusion the hook could not be documented or edited.
  ['documenting the prohibition', { file_path: 'docs/configuration.md', content: 'Set `.env` from `.env.example`.' }],
  ['editing that documentation', { old_string: 'the .env file', new_string: 'the .env file (local only)' }],
  ['a human description mentioning it', { command: 'ls', description: 'Check whether data/data.json exists' }],
];

test('every protected read is denied', () => {
  for (const [label, input] of DENY) {
    assert.ok(protectedHit(input), `should have been denied: ${label}`);
  }
});

test('every legitimate path still works', () => {
  for (const [label, input] of ALLOW) {
    assert.equal(protectedHit(input), null, `should have been allowed: ${label}`);
  }
});

test('.env.example never reads as .env', () => {
  // The one pair the whole `.env` pattern turns on: the template is committed,
  // safe, and meant to be edited.
  assert.equal(protectedHit({ file_path: '.env.example' }), null);
  assert.ok(protectedHit({ file_path: '.env' }));
});

test('the hit names which prohibition was tripped', () => {
  // The reason reaches the model verbatim, so it has to identify the file set
  // rather than just saying "denied".
  assert.match(protectedHit({ file_path: 'data/data.json' }), /data\/data\.json/);
  assert.match(protectedHit({ file_path: '.env' }), /env/);
});

// --- the end-to-end contract with the harness ---------------------------
// The table above tests the matcher; these test that the SCRIPT honours the
// PreToolUse protocol, which is what the harness actually invokes.
function runHook(payload) {
  return spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
}

test('the script blocks with exit 2 and an explanation on stderr', () => {
  const r = runHook(JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'cat data/data.json' },
  }));
  assert.equal(r.status, 2, 'exit 2 is the unconditional block');
  assert.match(r.stderr, /data\/data\.json/);
  assert.match(r.stderr, /no-reading-production-data/, 'points at the rule');
});

test('the script stays out of the way of an ordinary call', () => {
  const r = runHook(JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  }));
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trim(), '');
});

test('the script fails CLOSED on input it cannot parse', () => {
  // If the harness ever changes its payload shape, the hook must break loudly
  // rather than turn into a no-op that still reads as protection.
  const r = runHook('not json at all');
  assert.equal(r.status, 2);
});

// --- the wiring, which is what silently stops matching ------------------
test('settings.json wires the hook over every tool', () => {
  const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  const entries = settings.hooks.PreToolUse;
  assert.ok(Array.isArray(entries) && entries.length > 0);

  const guard = entries.find((e) => JSON.stringify(e).includes('guard-protected-paths.js'));
  assert.ok(guard, 'the guard is still wired');
  // The matcher is the thing that silently stops matching. Narrowing it to a
  // tool-name list is the regression this assertion exists to catch.
  assert.equal(guard.matcher, '*', 'the guard must see EVERY tool call');
  assert.ok(fs.existsSync(HOOK), 'the wired script exists');
});
