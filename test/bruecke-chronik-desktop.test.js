'use strict';

/* Die Brücke's Chronik from 1280px (#1499): the period recap is a right-hand
   column beside the log, UNDER the Abschnittsleiste.

   Two rules written in neighbouring PRs collided here. #1245 placed the recap
   as a third column beside a rail column (`var(--rail-w) 1fr 380px`, recap on
   `grid-row: 1 / span 999`) — a copy of Ocean's rule, correct for a shell that
   keeps a rail. #1238 then turned Brücke's rail into a full-width bar and set
   every child to column 1, which won the template and the recap's column but
   not its row: the recap took row 1, ABOVE the bar, and the log shrank into a
   reading-measure column with the right half of the screen empty.

   So this resolves the cascade rather than reading one rule: each property is
   answered by the rule that wins on the element (specificity, then source
   order) across `styles.css` and `bruecke.css`, with each media block applied
   only at the width under test. jsdom does the selector MATCHING — the shell
   rules lean on `:has()`, which `test/support/css.js`'s describer cannot model
   — and nothing else; jsdom applies no layout, so placement is asserted as the
   declared grid values that decide it. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { specificity } = require('./support/css');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/* Every style rule in source order, with the media queries it sits inside.
   Brace-matched with a prelude stack, so a rule nested in two at-rules carries
   both conditions. */
function rulesWithMedia(css) {
  const out = [];
  const stack = [];
  let prelude = '';
  for (const ch of css) {
    if (ch === '{') { stack.push(prelude.trim()); prelude = ''; }
    else if (ch === '}') {
      const sel = stack.pop();
      if (sel !== undefined && !sel.startsWith('@') && !stack.some((s) => !s.startsWith('@'))) {
        out.push({ sel, body: prelude, media: stack.filter((s) => s.startsWith('@')) });
      }
      prelude = '';
    } else prelude += ch;
  }
  return out;
}

/* Whether a media prelude holds at `width`. Only width features are modelled;
   any other condition (motion, contrast, hover) is treated as NOT holding, so
   an override for an accessibility preference never answers a layout question. */
function holds(at, width) {
  if (at.startsWith('@supports')) return true;
  if (!at.startsWith('@media')) return false;
  return at.slice(6).split(',').some((q) => {
    const feats = [...q.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
    if (!feats.length || /\bnot\b/.test(q)) return false;
    return feats.every((f) => {
      const m = /^(min|max)-width:\s*(\d+(?:\.\d+)?)px$/.exec(f);
      if (!m) return false;
      return m[1] === 'min' ? width >= Number(m[2]) : width <= Number(m[2]);
    });
  });
}

const RULES = [...rulesWithMedia(read('styles.css')), ...rulesWithMedia(read('css/designs/bruecke.css'))]
  .map((r, order) => ({ ...r, order }));

const declared = (body, prop) => {
  const hits = [...body.matchAll(new RegExp(`(?:^|[\\s;])${prop}:\\s*([^;]+)`, 'g'))];
  return hits.length ? hits[hits.length - 1][1].trim() : null;
};
const beats = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

// The winning value of `prop` on `el` at `width`, or null when nothing sets it.
function resolve(el, prop, width) {
  let best = null;
  for (const r of RULES) {
    if (!r.media.every((m) => holds(m, width))) continue;
    const value = declared(r.body, prop);
    if (!value) continue;
    for (const one of r.sel.split(/,(?![^()]*\))/)) {
      let ok;
      // A selector nwsapi cannot parse matches nothing, as in a browser that
      // drops the rule; the control test above catches a parse that eats all.
      try { ok = el.matches(one.trim()); } catch { ok = false; }
      if (!ok) continue;
      const spec = specificity(one.trim());
      if (!best || beats(spec, best.spec) || (!beats(best.spec, spec) && r.order > best.order)) {
        best = { value, spec, order: r.order, sel: one.trim() };
      }
    }
  }
  return best;
}

// The Chronik's children as views-chronik.js appends them for Die Brücke: the
// rail first, then the dock, the log section, and the recap LAST (B6.1).
function chronik({ recap = true } = {}) {
  const html = `<!doctype html><html data-design="bruecke" data-scheme="dark"><body>
    <main class="app"><nav class="rail"></nav><nav class="dock"></nav>
    <section class="section chronik-log"></section>
    ${recap ? '<section class="section precap"></section>' : ''}</main></body></html>`;
  const doc = new JSDOM(html).window.document;
  return { app: doc.querySelector('.app'), rail: doc.querySelector('.rail'), log: doc.querySelector('.chronik-log'), precap: doc.querySelector('.precap') };
}

const tracks = (v) => v.replace(/minmax\([^)]*\)/g, 'M').trim().split(/\s+/);
const startLine = (v) => v.split('/')[0].trim();

test('the resolver sees the sheets: Klassisch-shell control at 1280 places the rail in its own column', () => {
  assert.ok(RULES.length > 1000, 'implausibly few rules parsed');
  // styles.css's generic shell — the rail spans every row beside the content.
  const doc = new JSDOM('<html><body><main class="app"><nav class="rail"></nav><section></section></main></body></html>').window.document;
  const rail = resolve(doc.querySelector('.rail'), 'grid-row', 1280);
  assert.equal(rail && rail.value, '1 / span 999');
  assert.equal(resolve(doc.querySelector('.rail'), 'grid-row', 1024), null, 'a min-width:1280 rule applied at 1024');
});

for (const width of [1280, 1920]) {
  test(`at ${width}px the recap is a 380px column beside the log, below the bar`, () => {
    const { app, rail, log, precap } = chronik();
    const cols = resolve(app, 'grid-template-columns', width);
    assert.deepEqual(tracks(cols.value), ['M', '380px'], `two tracks, recap last — won by ${cols.sel}: ${cols.value}`);

    const railCol = resolve(rail, 'grid-column', width);
    assert.equal(railCol.value.replace(/\s+/g, ' '), '1 / -1', `the bar spans both tracks — won by ${railCol.sel}`);
    const railRow = resolve(rail, 'grid-row', width);
    assert.equal(startLine(railRow.value), '1', `the bar opens row 1 — won by ${railRow.sel}`);

    assert.equal(resolve(log, 'grid-column', width).value, '1', 'the log sits in the left track');
    assert.equal(resolve(precap, 'grid-column', width).value, '2', 'the recap sits in the right track');
    const recapRow = resolve(precap, 'grid-row', width);
    assert.notEqual(startLine(recapRow.value), '1', `the recap must not take row 1, above the bar — won by ${recapRow.sel}`);
    assert.equal(startLine(recapRow.value), '2', 'the recap starts level with the Chronik head');

    // The log uses its track instead of stopping at the reading measure,
    // which left a hole between the log and the recap.
    const cap = resolve(log, 'max-width', width);
    assert.equal(cap && cap.value, 'none', `the log is capped by ${cap && cap.sel}`);
  });
}

test('without a recap the Chronik keeps one track — no reserved column', () => {
  const { app } = chronik({ recap: false });
  const cols = resolve(app, 'grid-template-columns', 1920);
  assert.deepEqual(tracks(cols.value), ['M'], `won by ${cols.sel}`);
});

test('below 1280 the recap is not placed — the phone and tablet stack (log, then recap) stand', () => {
  const { precap } = chronik();
  for (const width of [390, 768, 1024]) {
    assert.equal(resolve(precap, 'grid-column', width), null, `${width}px`);
    assert.equal(resolve(precap, 'grid-row', width), null, `${width}px`);
  }
});
