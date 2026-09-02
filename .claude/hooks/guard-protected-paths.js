#!/usr/bin/env node
'use strict';

// PreToolUse hook enforcing this repo's two ABSOLUTE data prohibitions:
//   .claude/rules/no-reading-production-data.md — data/data.json, data/uploads/
//   .claude/rules/no-reading-env-files.md       — .env and its .local siblings
//
// Both hold private user data or live secrets, and until #880 both were the
// only invariants of that weight enforced entirely by prose.
//
// It matches on the tool's INPUT, never on its NAME. A hook keyed to `Read`
// would leave `cat data/data.json` wide open while still reading as protection,
// and it would stop matching silently the day a tool is renamed — which the
// issue itself named as worse than having no hook at all. settings.json wires
// this over matcher "*", so every tool call reaches this script and the decision
// is made from the paths in its arguments.

const PROTECTED = [
  // The production dataset. `data/` itself stays readable: the rule explicitly
  // permits a structural check such as `ls data/`.
  {
    re: /(?:^|[^\w.-])data\/data\.json/,
    what: 'data/data.json — the production dataset (.claude/rules/no-reading-production-data.md)',
  },
  {
    re: /(?:^|[^\w.-])data\/uploads(?![\w.-])/,
    what: 'data/uploads/ — private cover images (.claude/rules/no-reading-production-data.md)',
  },
  // A glob wide enough to sweep the dataset up with it (`cat data/*`).
  {
    re: /(?:^|[^\w.-])data\/\*/,
    what: 'a glob over data/, which would include data/data.json (.claude/rules/no-reading-production-data.md)',
  },
  // Local env files hold SESSION_SECRET, DATABASE_URL and the S3/mailbox
  // credentials. The committed `.env.example` is a placeholder template that is
  // explicitly safe and meant to be edited, so it must NOT match: `.` counts as
  // a name character below, which is what keeps `.env.example` out of the bare
  // `.env` branch while `.env.local` still lands in the first one.
  {
    re: /\.env(?:\.[\w-]+)*\.local(?![\w.-])/,
    what: 'a local .env file — live secrets (.claude/rules/no-reading-env-files.md)',
  },
  {
    re: /\.env(?![\w.-])/,
    what: '.env — live secrets (.claude/rules/no-reading-env-files.md)',
  },
];

// Fields whose value is never a path being read. Everything else IS scanned —
// the list is an EXCLUSION, not an allowlist, so a tool that ships a new field
// name is covered by default. The inverse shape fails open, which is the one
// outcome this hook must not have (cf. .claude/rules/ci-aggregate-gate.md).
const NOT_A_PATH = new Set([
  'description',   // Bash's human-readable summary
  'pattern',       // Grep's search string — leaves a way to grep for these paths
  'prompt',        // Agent / WebFetch instructions
  'content',       // Write's payload: what a file WILL hold, not what is read
  'old_string',    // Edit's payloads, same reasoning
  'new_string',
  'statusMessage',
]);

// Returns a human-readable description of the prohibition tripped, or null.
function protectedHit(toolInput) {
  let hit = null;
  const walk = (value, field) => {
    if (hit) return;
    if (typeof value === 'string') {
      if (NOT_A_PATH.has(field)) return;
      for (const rule of PROTECTED) {
        if (rule.re.test(value)) { hit = rule.what; return; }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, field);
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(item, key);
    }
  };
  walk(toolInput, null);
  return hit;
}

function main() {
  let hit;
  try {
    const payload = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    hit = protectedHit(payload.tool_input || {});
  } catch (err) {
    // Fail CLOSED. If the payload shape ever changes, this hook breaks loudly
    // instead of degrading into a no-op that still looks like protection.
    process.stderr.write(
      `Blocked: the data-prohibition hook could not read its input (${err.message}).\n` +
      'Fix .claude/hooks/guard-protected-paths.js — do not bypass it.\n');
    process.exit(2);
  }
  if (!hit) process.exit(0);
  // Exit 2 is the unconditional block; stderr becomes the reason Claude sees.
  process.stderr.write(
    `Blocked by this repo's absolute data prohibition: ${hit}\n` +
    'This file is off-limits to agents. Generate your own data in an isolated ' +
    'DATA_DIR (the `test-data` skill), read .env.example instead of .env, and ' +
    'use the committed `dev-temp-data` preview config to run the app.\n' +
    'If you were not reading it — a shell one-liner that EDITS a file mentioning ' +
    'this path, or greps for it — use the Write/Edit or Grep tools instead: their ' +
    'content and pattern fields are exempt, because they are not paths being read.\n');
  process.exit(2);
}

module.exports = { protectedHit };

if (require.main === module) main();
