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

/* The body of a rule that names `selector` as ONE MEMBER of its selector group.
   A shared reset written as `.a,\n.b { … }` is invisible to bodyOf(), which
   compares the whole selector text — and the resulting failure reads as the rule
   having been DELETED rather than regrouped, which is a confusing signal for a
   test whose job is to notice a deletion. Use this whenever the rule under test
   may legitimately be shared by a second component. */
const bodyOfIn = (selector, rules = RULES) => {
  const hit = rules.find(([sel]) => sel.split(',').map((s) => s.trim()).includes(selector));
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

/* Specificity as [ids, classes, elements]. Enough for `.a`, `.a .b` and `.a.b`;
   it does not model :is()/:has() and does not need to — every selector compared
   through it is a plain class sequence, and a future one that isn't should be
   compared deliberately rather than by a silently-wrong number.

   This lives here rather than in one test because the question it answers comes
   up wherever a media block overrides a component: several of this sheet's
   media blocks are declared ABOVE the components they re-style, so an override
   at equal specificity loses on source order — silently, and more than once for
   real (`.claude/rules/flex-none-cancels-flex-wrap.md`). */
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/[.:[][\w-]+/g) || []).length;
  const els = (sel.replace(/[.#:[][\w-]+/g, '').match(/[a-z]+/g) || []).length;
  return [ids, classes, els];
}

const outranks = (a, b) => {
  const [x, y] = [specificity(a), specificity(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false; // a tie loses to source order, which is the bug being guarded
};

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

/* The numbers out of a MULTI-COLUMN container (#942): `columns: <n>px [<c>]`
   or the `column-width`/`column-count` longhands, plus `column-gap`.
   Deliberately NOT reading plain `gap` — in a multicol container the shorthand
   sets the column gap only and `row-gap` is silently dropped, so a rule written
   with `gap` is the bug this should surface rather than parse over.

   `count` was added by #948 and is the half that fails SILENTLY if omitted: the
   `columns` shorthand takes a width and a count together, and with both set the
   used count is min(count, fit) — so a count is a cap. Parsed as a plain number
   the shorthand's second token is invisible to a width-only regex, and every
   assertion built on `columnsIn` then reads a capped flow as an uncapped one
   and stays green over the cap being deleted. */
function columnSpec(body) {
  if (!body) return null;
  let floor = null;
  let count = null;
  const long = body.match(/(?:^|[\s;])column-width:\s*(\d+)px/);
  if (long) floor = Number(long[1]);
  const longCount = body.match(/(?:^|[\s;])column-count:\s*(\d+)/);
  if (longCount) count = Number(longCount[1]);
  /* The shorthand resets whichever half it omits, so it is read last and its
     tokens are taken positionally-agnostically — `columns` accepts the width and
     the count in either order. */
  const short = body.match(/(?:^|[\s;])columns:\s*([^;}]+)/);
  if (short) {
    for (const token of short[1].trim().split(/\s+/)) {
      if (/^\d+px$/.test(token)) floor = parseInt(token, 10);
      else if (/^\d+$/.test(token)) count = Number(token);
    }
  }
  const gap = body.match(/column-gap:\s*(\d+)px/);
  return { floor, gap: gap ? Number(gap[1]) : null, count };
}

/* How many columns of `floor` width a container of `width` px of CONTENT box
   actually USES: n columns need floor*n + gap*(n-1) <= width, and a declared
   `column-count` caps that (#948). Shared by gridSpec and columnSpec — the fit
   arithmetic is identical because `column-width` reproduces `auto-fill`.

   `gridSpec` returns no `count`, so a grid is uncapped exactly as before. The
   floor of 1 is the multicol spec's own (a container narrower than one column
   still gets one), and it matters here: without it a cap on a container
   narrower than its own floor would read as 0 columns. */
const columnsIn = (width, { floor, gap, count }) => {
  const fits = Math.max(1, Math.floor((width + gap) / (floor + gap)));
  return count ? Math.min(count, fits) : fits;
};

module.exports = {
  ROOT, CSS, RULES, rulesOf, bodyOf, bodyOfIn, mediaBlocks, whole, rootPx, gridSpec, columnSpec,
  columnsIn, specificity, outranks,
};
