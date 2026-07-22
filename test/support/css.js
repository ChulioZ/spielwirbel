'use strict';

/* Shared parsing for the tests that assert against `public/styles.css` as TEXT
   rather than a parsed stylesheet (dock-footer-clearance, wide-layout). At this
   size a string test is the right tool — but the parsing has two traps that
   cost real effort once already, so it lives here rather than being re-derived
   per file. See `.claude/rules/css-text-assertions-strip-comments.md`.

   Trap 1: comments are brace-free text, so a selector regex built out of
   `[^{}]*` happily spans one that merely MENTIONS a class in prose and binds to
   whatever rule opens next. An earlier dock test passed against a stylesheet
   with the fix deleted for exactly that reason. Hence: strip comments first.

   Trap 2: this codebase's naming is BEM-ish, so `.site-footer` naively also
   matches `.site-footer__links`. Match a class as a whole class — `whole()`. */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

const CSS = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/* [selector, body] of every rule in a chunk of CSS. This deliberately sees
   THROUGH @media wrappers (the query is brace-free, so it never matches as a
   selector), which is what lets a whole-sheet lookup find a rule wherever it
   lives. When the enclosing block matters, narrow with mediaBlocks() first. */
const rulesOf = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => [m[1].trim(), m[2]]);

const RULES = rulesOf(CSS);

// The body of a rule looked up by its EXACT selector text.
const bodyOf = (selector, rules = RULES) => {
  const hit = rules.find(([sel]) => sel === selector);
  return hit ? hit[1] : null;
};

/* Top-level @media blocks as [query, css]. Brace-matched, because rulesOf()
   cannot tell you which block a rule came from — and that distinction is
   load-bearing for anything scoped to a width range. */
function mediaBlocks(css = CSS) {
  const out = [];
  const re = /@media([^{]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push([m[1].trim(), css.slice(re.lastIndex, i - 1)]);
    re.lastIndex = i;
  }
  return out;
}

// A regex matching `cls` as a WHOLE class name (see trap 2 above).
const whole = (cls) =>
  new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');

// The declared value of a custom property in :root, e.g. px('--w-wide') -> 1440.
function rootPx(name) {
  const root = bodyOf(':root');
  const m = root && root.match(new RegExp(`${name}:\\s*(\\d+)px`));
  return m ? Number(m[1]) : null;
}

/* `repeat(auto-fill|auto-fit, minmax(<n>px, 1fr))` + `gap: <n>px` out of a rule
   body — the two numbers that decide how many columns a grid actually gets. */
function gridSpec(body) {
  if (!body) return null;
  const floor = body.match(/minmax\((\d+)px/);
  const gap = body.match(/gap:\s*(\d+)px/);
  return { floor: floor ? Number(floor[1]) : null, gap: gap ? Number(gap[1]) : null };
}

/* How many `auto-fill` columns of `floor` width fit in `width` px of CONTENT
   box: n columns need floor*n + gap*(n-1) <= width. */
const columnsIn = (width, { floor, gap }) => Math.floor((width + gap) / (floor + gap));

module.exports = { ROOT, CSS, RULES, rulesOf, bodyOf, mediaBlocks, whole, rootPx, gridSpec, columnsIn };
