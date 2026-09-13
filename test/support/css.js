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

// Split on a top-level separator — one outside any parentheses. The selector
// list inside `:is(.a, .b)` is not a selector list of the enclosing selector.
function splitTop(selector, separator) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of selector) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth === 0 && ch === separator) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const moreSpecific = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/* Specificity as [ids, classes, elements].

   `:is()`, `:not()` and `:has()` contribute the specificity of their MOST
   SPECIFIC argument and nothing of their own; `:where()` contributes nothing at
   all. That is not a refinement of a good-enough count — this sheet carries 23
   `:not()` selectors, and the naive form (what this was until #1053) reads
   `*:not(.rail):not(.dock)` as FOUR classes instead of two, so any comparison
   touching one is off by a whole level while reading as authoritative.

   Deliberately still not modelled: `:nth-child(An+B of S)`, whose `of S` would
   need the argument counted; it is counted as a plain pseudo-class instead,
   which is right for every other pseudo and appears nowhere in this sheet.

   This lives here rather than in one test because the question it answers comes
   up wherever a media block overrides a component: several of this sheet's
   media blocks are declared ABOVE the components they re-style, so an override
   at equal specificity loses on source order — silently, and more than once for
   real (`.claude/rules/flex-none-cancels-flex-wrap.md`). */
function specificity(sel) {
  const acc = [0, 0, 0];
  let rest = '';
  let i = 0;
  for (;;) {
    const m = /:(not|is|where|has)\(/.exec(sel.slice(i));
    if (!m) { rest += sel.slice(i); break; }
    rest += sel.slice(i, i + m.index);
    let j = i + m.index + m[0].length;
    const from = j;
    for (let depth = 1; j < sel.length && depth > 0; j += 1) {
      if (sel[j] === '(') depth += 1;
      else if (sel[j] === ')') depth -= 1;
    }
    if (m[1] !== 'where') {
      const best = splitTop(sel.slice(from, j - 1), ',')
        .map(specificity)
        .reduce((a, b) => (moreSpecific(b, a) ? b : a), [0, 0, 0]);
      for (let k = 0; k < 3; k += 1) acc[k] += best[k];
    }
    i = j;
  }
  /* Attribute selectors are removed WHOLE, and pseudo-ELEMENTS before
     pseudo-classes. Both mattered: `[aria-expanded="true"]` used to leave
     `="true"]` behind, whose `true` was then counted as an ELEMENT — which read
     the add-on chip's open-state rule as (0,2,1), i.e. outranking `.chip.is-on`
     outright rather than tying it, and a tie is exactly what made #1053 a bug. */
  const attrs = rest.match(/\[[^\]]*\]/g) || [];
  const pseudoEls = rest.replace(/\[[^\]]*\]/g, '').match(/::[\w-]+/g) || [];
  const bare = rest.replace(/\[[^\]]*\]/g, '').replace(/::[\w-]+/g, '');
  const ids = (bare.match(/#[\w-]+/g) || []).length;
  const classes = (bare.match(/[.:][\w-]+/g) || []).length + attrs.length;
  const els = (bare.replace(/[.#:][\w-]+/g, '').match(/[a-z]+/g) || []).length + pseudoEls.length;
  return [acc[0] + ids, acc[1] + classes, acc[2] + els];
}

// A tie returns false: at equal specificity source order decides, which is the
// bug every caller of this is guarding against.
const outranks = (a, b) => moreSpecific(specificity(a), specificity(b));

/* ---- Resolving the cascade for one element ----------------------------------

   `bodyOf()` answers "what does this rule say"; these answer "what does the
   BROWSER paint". The difference is the whole of #1053: `.chip.is-on` and
   `.setup-addons__chip[aria-expanded="true"]` both say the right thing, tie on
   specificity, and the later one silently took the `color` while the earlier
   one kept the `background` — so a test measuring either rule's own tokens
   passed over an invisible label. See
   `.claude/rules/assert-the-decision-not-its-ingredients.md`.

   An element is described rather than built: `{ tag, classes, attrs }`. jsdom
   is not used on purpose — it does not substitute custom properties, so the
   only thing it could report for these rules is `var(--on-accent)`, i.e. the
   same string this reads out of the sheet, at the cost of a DOM. */

/* A compound selector split into its simple selectors. A shape it cannot model
   THROWS rather than quietly failing to match: a selector that dropped out of
   the cascade unnoticed would make every assertion built on this vacuous, which
   is the exact failure this machinery exists to prevent. */
function simpleSelectors(compound) {
  const out = [];
  let i = 0;
  while (i < compound.length) {
    const start = i;
    const ch = compound[i];
    if (ch === '*') i += 1;
    else if (ch === '.' || ch === '#') { i += 1; while (/[\w-]/.test(compound[i] || '')) i += 1; }
    else if (ch === '[') { while (i < compound.length && compound[i] !== ']') i += 1; i += 1; }
    else if (ch === ':') {
      i += 1;
      if (compound[i] === ':') i += 1;
      while (/[\w-]/.test(compound[i] || '')) i += 1;
      if (compound[i] === '(') { let d = 0; do { if (compound[i] === '(') d += 1; else if (compound[i] === ')') d -= 1; i += 1; } while (i < compound.length && d > 0); }
    } else if (/[a-z]/i.test(ch)) { while (/[\w-]/.test(compound[i] || '')) i += 1; }
    else throw new Error(`cannot model "${compound}" at offset ${i} — teach simpleSelectors() the shape rather than letting it drop out of the cascade`);
    if (i <= start) throw new Error(`simpleSelectors() stalled on "${compound}" at offset ${i}`);
    out.push(compound.slice(start, i));
  }
  return out;
}

/* Transient pseudo-classes. An element described by class and attribute alone is
   at rest, enabled and unfocused, so these are FALSE for it — listed explicitly,
   because anything not named here throws, and a silent `false` is what makes a
   cascade model lie rather than fail. */
const AT_REST = [':hover', ':active', ':focus', ':focus-visible', ':focus-within', ':disabled', ':checked', ':target', ':visited', ':link'];

function satisfies(simple, el) {
  if (simple === '*') return true;
  if (simple.startsWith('.')) return el.classes.includes(simple.slice(1));
  if (simple.startsWith('[')) {
    const m = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\]$/.exec(simple);
    if (!m) throw new Error(`cannot model the attribute selector ${simple}`);
    const value = m[2] ?? m[3] ?? m[4];
    const attrs = el.attrs || {};
    return value === undefined ? m[1] in attrs : attrs[m[1]] === value;
  }
  if (simple.startsWith(':')) {
    const open = simple.indexOf('(');
    const fn = open === -1 ? simple : simple.slice(0, open);
    const args = open === -1 ? [] : splitTop(simple.slice(open + 1, -1), ',');
    // `:not(X)` fails when the element matches X AS A WHOLE, so `:not(.a.b)` is
    // one condition rather than two — hence the negated `some` over `every`.
    if (fn === ':not') return !args.some((a) => simpleSelectors(a).every((s) => satisfies(s, el)));
    if (fn === ':is' || fn === ':where') return args.some((a) => simpleSelectors(a).every((s) => satisfies(s, el)));
    if (AT_REST.includes(fn)) return false;
    throw new Error(`cannot model the pseudo-class ${simple} — decide what it means for a resting element rather than guessing`);
  }
  return simple.toLowerCase() === el.tag;
}

// What is left of a complex selector after its last combinator. Whitespace is
// normalised by the caller, so a descendant combinator is always one space.
const subjectOf = (complex) => [' ', '>', '+', '~']
  .reduce((parts, c) => parts.flatMap((p) => splitTop(p, c)), [complex])
  .pop();

/* Does `selector` match `el`? Only the SUBJECT compound is tested, so an
   ancestor-qualified rule whose subject matches is kept. That over-includes
   rather than missing one, which is the safe direction for a question of the
   form "what could win here".

   The `\s+` collapse is load-bearing: this sheet writes long selector GROUPS
   over several lines, and a multi-line DESCENDANT selector would otherwise reach
   the tokenizer with a newline in it and throw. There is none today, so the
   collapse is what keeps that a non-event rather than a future false alarm. */
/* A KEYFRAME STEP is not a cascade selector. rulesOf() cannot see the
   `@keyframes name {` wrapper — that has braces of its own — so a keyframe's
   steps arrive here looking like ordinary rules, and `0%` then throws out of
   simpleSelectors(). It only ever bit once the sheet grew a keyframe animating a
   COLOUR (#1056's `tafel-gold`): the existing ones animate opacity and
   transform, which no resolvedDeclaration() caller asks about, so the whole
   class of failure was one property away the entire time.

   Excluded explicitly rather than left to fail as a `false`, because everything
   else this tokenizer cannot model throws on purpose — a step matching nothing
   is a FACT about @keyframes, not a gap in the model. */
const KEYFRAME_STEP = /^(?:from|to|-?\d+(?:\.\d+)?%)$/;

const matchesEl = (selector, el) => splitTop(selector.replace(/\s+/g, ' '), ',')
  .filter((one) => !KEYFRAME_STEP.test(one.trim()))
  .some((one) => simpleSelectors(subjectOf(one)).every((s) => satisfies(s, el)));

// The last declaration of `prop` in a rule body — within one rule, later wins.
const declaredValue = (body, prop) => {
  const hits = [...body.matchAll(new RegExp(`(?:^|[\\s;{])${prop}:\\s*([^;}]+)`, 'g'))];
  return hits.length ? hits[hits.length - 1][1].trim() : null;
};

// Every rule that sets `prop` on `el`, wherever it lives — media blocks included.
const settersOf = (el, prop, rules = RULES) => rules
  .map(([sel, body], order) => ({ sel, order, value: declaredValue(body, prop) }))
  .filter((c) => c.value && matchesEl(c.sel, el));

/* The declaration that actually wins for `prop` on `el`: specificity first, then
   source order — the tie that produces this whole class of bug. Returns the
   selector alongside the value, so a failing assertion names the rule to go and
   look at. Throws when the answer would be conditional or guessed. */
function resolvedDeclaration(el, prop) {
  const conditional = mediaBlocks(CSS).flatMap(([query, css]) =>
    rulesOf(css)
      .filter(([sel, body]) => declaredValue(body, prop) && matchesEl(sel, el))
      .map(([sel]) => `@media ${query} { ${sel} }`));
  if (conditional.length) {
    // rulesOf() sees THROUGH @media, so a width-scoped rule would otherwise be
    // counted as if it applied at every width — silently making the answer
    // conditional on a viewport the caller never stated.
    throw new Error(`${prop} is set inside ${conditional.join(', ')} — this resolution no longer holds at every width`);
  }
  const candidates = settersOf(el, prop);
  if (!candidates.length) throw new Error(`no rule sets ${prop} on this element — check the description, or the sheet has moved`);
  for (const c of candidates) {
    // specificity() models `:not`/`:is`/`:where`/`:has` and nothing else, so a
    // candidate carrying any other pseudo-class would be ranked by a number that
    // is quietly wrong. Fail rather than guess.
    if (c.sel.replace(/:(?:not|is|where|has)\((?:[^()]|\([^()]*\))*\)/g, '').includes(':')) {
      throw new Error(`${c.sel} carries a pseudo-class specificity() does not model — rank it deliberately`);
    }
  }
  candidates.sort((a, b) => (moreSpecific(specificity(a.sel), specificity(b.sel)) ? 1 : moreSpecific(specificity(b.sel), specificity(a.sel)) ? -1 : a.order - b.order));
  return candidates[candidates.length - 1];
}

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
  columnsIn, specificity, outranks, matchesEl, declaredValue, resolvedDeclaration,
};
