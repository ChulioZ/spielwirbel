'use strict';

/* Every rule file declares its LOADING SCOPE explicitly (criteria C-014/C-022).

   `paths:` frontmatter scopes a rule to the files its traps live in, so a session
   editing something else never pays for it. The trial that introduced it ran from
   2026-07-24 and stalled at 9 of 88 — not because the other 79 were judged global,
   but because a rule with no frontmatter is indistinguishable from one nobody
   decided about. C-022's whole point is that "the decision gets made, once, per
   rule, rather than defaulting to global by omission", and a decision that can be
   skipped silently is the thing this file removes.

   So a rule declares one of two things, and a new rule declaring neither fails:

     - `paths:` frontmatter — the trap lives in a known file set.
     - `<!-- scope: global — <reason> -->` — the trap surfaces through a tool, a
       situation, an ops action or a discipline, so no path could trigger it.

   The global marker is deliberately an HTML comment rather than a frontmatter
   key: `paths:` is read by the harness, and an unknown sibling key could change
   how it treats the file in a way nothing here can test. This marker is read only
   by this test, so it is kept out of the block the harness parses.

   C-014's "when in doubt, stay global" is untouched — nothing here pushes a rule
   toward being scoped. The only thing being forced is that somebody chose. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const RULES = path.join(ROOT, '.claude/rules');

const ruleFiles = () => fs.readdirSync(RULES).filter((f) => f.endsWith('.md')).sort();
const read = (f) => fs.readFileSync(path.join(RULES, f), 'utf8');

// The frontmatter block, when the file opens with one.
const frontmatter = (text) => {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 3);
  return end < 0 ? null : text.slice(4, end);
};

const pathGlobs = (text) => {
  const fm = frontmatter(text);
  if (!fm || !/^paths:/m.test(fm)) return null;
  return [...fm.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]);
};

const globalMarker = (text) => {
  const m = /<!--\s*scope:\s*global\s*—\s*(.+?)\s*-->/.exec(text);
  return m ? m[1] : null;
};

// Tracked files only: an untracked scratch file must never satisfy a glob.
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .trim().split('\n');

/* Minimal glob -> RegExp. `**` crosses directory separators, `*` does not.

   Split on `**` and translate each segment, rather than swapping `**` for a
   placeholder and back: the only safe placeholder is a character that cannot occur
   in a path, i.e. a control character, and putting one in a regex literal is a
   `no-control-regex` lint error. (It also works, silently — which is how the first
   version of this passed all five tests while being unlintable.) */
const globToRe = (g) => {
  const seg = (s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp("^" + g.split("**").map(seg).join(".*") + "$");
};

test('every rule declares its scope — `paths:` or an explicit global marker', () => {
  const undeclared = ruleFiles().filter((f) => {
    const text = read(f);
    return !pathGlobs(text) && !globalMarker(text);
  });

  assert.deepEqual(undeclared, [],
    'these rules declare neither `paths:` frontmatter nor a `<!-- scope: global — … -->`'
    + ' marker, so nobody has decided whether they should load for every session:\n  '
    + undeclared.join('\n  ')
    + '\nDecide: scope it to the files its traps live in, or mark it global with the reason.');
});

test('a rule does not declare both scopings', () => {
  // Both would be ambiguous, and the harness would silently believe `paths:` while
  // a reader believes the comment.
  const both = ruleFiles().filter((f) => {
    const text = read(f);
    return pathGlobs(text) && globalMarker(text);
  });
  assert.deepEqual(both, [], `these rules declare both a paths: block and a global marker: ${both.join(', ')}`);
});

test('the global marker carries a reason', () => {
  // "scope: global" with no reason is the omission again, one level down: it records
  // that someone typed the marker, not that they thought about it.
  const thin = [];
  for (const f of ruleFiles()) {
    const reason = globalMarker(read(f));
    if (reason !== null && reason.trim().length < 20) thin.push(`${f} (${JSON.stringify(reason)})`);
  }
  assert.deepEqual(thin, [], `these global markers state no usable reason: ${thin.join(', ')}`);
});

test('every `paths:` glob matches at least one tracked file', () => {
  /* The failure this catches is silent and total: a glob with a typo — or one left
     behind by a rename — matches nothing, so the rule never loads and its
     protection is simply gone. Nothing else would notice, because a rule that
     does not load produces no error, no warning and no failing test.

     This is why the paths: half is worth having a test at all. Which files a rule
     *should* name is a judgement nothing can assert; whether the files it names
     exist is not. */
  const dead = [];
  for (const f of ruleFiles()) {
    for (const g of pathGlobs(read(f)) || []) {
      if (!tracked.some((t) => globToRe(g).test(t))) dead.push(`${f} -> "${g}"`);
    }
  }
  assert.deepEqual(dead, [],
    'these globs match no tracked file, so their rule silently never loads:\n  ' + dead.join('\n  '));
});

test('a scoped rule names more than nothing', () => {
  // An empty `paths:` block parses fine and scopes the rule to no file at all —
  // strictly worse than global, and it reads as scoped to a skimmer.
  const empty = ruleFiles().filter((f) => {
    const globs = pathGlobs(read(f));
    return globs && globs.length === 0;
  });
  assert.deepEqual(empty, [], `these rules have an empty paths: block: ${empty.join(', ')}`);
});
