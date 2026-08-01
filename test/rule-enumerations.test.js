'use strict';

/* Some rules in `.claude/rules/` exist to be a COMPLETE LIST — "these are the
   events we log", "these are the quota codes", "these are the constants shared
   across the stack". A list like that is only worth reading if it is exhaustive,
   and it decays in a way nothing else notices: the code grows a new member, every
   test stays green, and the rule keeps presenting a subset as the whole set.

   Measured on 2026-07-30, all three lists below had already drifted:

   - `product-event-logging.md` named 5 of the 6 `EVENTS` (`games_imported` was
     added by #481), even though the rule itself says "Adding an event means adding
     it to `EVENTS` *and* to this list".
   - `per-tenant-quotas.md` named 3 of the 6 quota refusals (#325 added two, #563
     one) and said "All three are state caps".
   - `shared-constants-across-the-stack.md` named 2 of the 3 shared files
     (`session-people.js`, #458).

   Two audits had already missed all three, because an audit spot-checks a rule's
   *claims* and nothing was checking its *enumerations*. So they are checked here
   instead — the remedy criteria C-017 prescribes for a rule that was right and got
   skipped anyway: mechanize it rather than reword it.

   Each check is a FLOOR, deliberately: it proves the code's members are all named
   in the rule, not that the rule names nothing extra. A rule may legitimately
   discuss a retired member as history (criteria C-012), and asserting the reverse
   direction would fight that.

   Two of these three were VACUOUS on the first attempt, and the reason generalizes:
   a whole-file `includes()` is satisfied by the rule's own prose ABOUT the member —
   including, absurdly, the sentence explaining that this test exists. Deleting
   `games_imported` from the list left the test green because the paragraph below the
   list still named it. So each check reads only the rule's **enumeration region**,
   the same scoping lesson as `.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md`
   §3 (scope the match to `<main>`, or the head satisfies it) and
   `.claude/rules/css-text-assertions-strip-comments.md` (strip the comments, or a
   comment mentioning the selector satisfies it). Verified by deleting one member
   from each list and watching all three go red. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Every .js file directly under a source directory, as [repo-relative path, text].
const filesIn = (dir) => fs.readdirSync(path.join(ROOT, dir))
  .filter((f) => f.endsWith('.js'))
  .map((f) => [`${dir}/${f}`, src(`${dir}/${f}`)]);

// One `##` section of a rule — the region holding its enumeration. Ends at the next
// `##` heading, so only the section's OWN heading is a fixed string: renaming that
// fails loudly ("is gone"), while editing anything downstream cannot silently widen,
// empty or invalidate the scope. Keyed on a heading rather than on a paragraph for
// exactly that reason.
const section = (text, rel, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `${rel}: heading "${heading}" is gone — re-scope this check`);
  const rest = text.slice(start + heading.length);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
};

// The members of a `const NAME = new Set([ 'a', 'b' ])` literal. Parsed out of the
// source rather than required: `lib/observability.js` does not export EVENTS, and
// requiring it for a docs assertion would drag pino's initialization in with it.
const setLiteral = (text, name) => {
  const m = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(text);
  assert.ok(m, `could not find the ${name} set literal — did it move or change shape?`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

test('every product event in the EVENTS allowlist is named in its rule', () => {
  const events = setLiteral(src('lib/observability.js'), 'EVENTS');
  // Anti-vacuous: a regex that silently stopped matching would assert nothing.
  assert.ok(events.length >= 6, `expected at least 6 product events, parsed ${events.length}`);

  const rel = '.claude/rules/product-event-logging.md';
  const rule = section(src(rel), rel, '## The events');
  const missing = events.filter((e) => !rule.includes(e));
  assert.deepEqual(missing, [],
    `product-event-logging.md does not name: ${missing.join(', ')}`
    + ' — add it to the list at the top of that rule, not just to EVENTS.');
});

test('every quota refusal code a route emits is named in its rule', () => {
  const codes = new Set();
  for (const [, text] of filesIn('lib/routes')) {
    for (const m of text.matchAll(/'(quota_[a-z_]+)'/g)) codes.add(m[1]);
  }
  assert.ok(codes.size >= 6, `expected at least 6 quota codes, found ${codes.size}`);

  const rule = src('.claude/rules/per-tenant-quotas.md');
  const missing = [...codes].filter((c) => !rule.includes(c)).sort();
  assert.deepEqual(missing, [],
    `per-tenant-quotas.md does not name: ${missing.join(', ')}`
    + ' — add a row to the table, so the list stays the complete set it claims to be.');
});

test('every constant the backend shares out of public/js is named in its rule', () => {
  // The backend requiring out of `public/js/` is the deliberate shape for a value
  // the client offers and the server validates. Each instance must be listed, or
  // the rule stops being the inventory a future session checks against.
  const shared = new Set();
  // `filesIn` is non-recursive, so `lib/routes` is named separately from `lib`.
  // The depth-agnostic `(?:\.\.\/)+` matters: the routers reach public/js with
  // `../../` since they moved under lib/, and a `\.\.\/`-only regex would have
  // silently matched nothing and left `shared` empty rather than failing.
  for (const [, text] of [...filesIn('lib/routes'), ...filesIn('lib')]) {
    for (const m of text.matchAll(/require\('(?:\.\.\/)+public\/js\/([A-Za-z0-9_-]+)'\)/g)) shared.add(m[1]);
  }
  assert.ok(shared.size >= 3, `expected at least 3 shared frontend modules, found ${shared.size}`);

  const rel = '.claude/rules/shared-constants-across-the-stack.md';
  const rule = section(src(rel), rel, '## The rule');
  const missing = [...shared].filter((n) => !rule.includes(n)).sort();
  assert.deepEqual(missing, [],
    `shared-constants-across-the-stack.md does not name: ${missing.join(', ')}`
    + ' — every backend require out of public/js/ belongs in that inventory.');
});
