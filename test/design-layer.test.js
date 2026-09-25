'use strict';

/* The per-USER design layer (#1184): the seam every later design rides on.
 *
 * Two halves, and the second is the one that will break.
 *
 * The REGISTRY half (public/js/designs.js) is pure and required straight into
 * Node: which designs exist, and the production gate that keeps an unfinished
 * one out of the live instance. `GET /api/config` is where that gate is
 * actually enforced, so its end of it lives in test/config.test.js.
 *
 * The APPLY half is the interesting one. A round's design and the user's design
 * write the SAME two custom properties and the SAME data-scheme attribute, so
 * "no round design here" cannot mean "clear to the :root defaults" any more —
 * it has to mean "fall back to the user's design". Collapsing those two would
 * leave a dark design with light --surface and --ink on every screen outside a
 * round: a dark page carrying light-mode ink, which is the failure this file
 * exists to pin. round-theme.js's setScheme therefore has THREE states, and the
 * tests below walk a round entry/exit cycle rather than asserting one call.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const {
  DESIGN_REGISTRY, FACE_DESIGN, CLASSIC_DESIGN, designById,
  selectableDesigns, selectableDesignIds, isSelectableDesign,
} = require('../public/js/designs');

const tisch = designById('tisch');
const klassisch = designById('klassisch');

/* ------------------------------- the registry ------------------------------ */

test('the flip (#1202): Der Tisch is live and is the face; Klassisch stays offered', () => {
  assert.equal(FACE_DESIGN, 'tisch');
  assert.equal(tisch.enabled, true);
  assert.equal(klassisch.enabled, true, '„Wie bisher" must stay selectable forever');
  assert.equal(CLASSIC_DESIGN, 'klassisch');
});

test('Klassisch declares NO colours — it IS the :root default', () => {
  // Load-bearing rather than tidiness: it is what makes paintDesign take
  // the removeProperty branch, i.e. what makes "Klassisch renders exactly as
  // before" a property of the code rather than a coincidence of two hexes.
  assert.equal(klassisch.page, undefined);
  assert.equal(klassisch.accent, undefined);
  assert.equal(klassisch.stylesheet, undefined, 'styles.css is Klassisch; it needs no override file');
});

test('production offers only enabled designs; outside it, the whole registry', (t) => {
  // Every registered design is live since the flip, so one is switched off for
  // the duration to give the gate something to refuse (never the face).
  klassisch.enabled = false;
  t.after(() => { klassisch.enabled = true; });
  const enabled = DESIGN_REGISTRY.filter((d) => d.enabled).map((d) => d.id);
  assert.deepEqual(selectableDesignIds({ production: true }), enabled);
  assert.deepEqual(selectableDesignIds({ production: false }), DESIGN_REGISTRY.map((d) => d.id));
  // No argument at all must NOT mean production: this module runs in the
  // browser, where there is no NODE_ENV to read, and a default that guessed
  // wrong in the strict direction would hide a design under review.
  assert.deepEqual(selectableDesignIds(), DESIGN_REGISTRY.map((d) => d.id));
  assert.equal(selectableDesigns({ production: true }).every((d) => d.enabled), true);
});

test('selectability is an allowlist — never a denylist', (t) => {
  assert.equal(isSelectableDesign(FACE_DESIGN, { production: true }), true);
  klassisch.enabled = false;
  t.after(() => { klassisch.enabled = true; });
  assert.equal(isSelectableDesign('klassisch', { production: true }), false, 'not enabled');
  assert.equal(isSelectableDesign('klassisch', { production: false }), true);
  for (const junk of ['', 'nope', '../klassisch', 'KLASSISCH', null, undefined, 42, {}, ['klassisch']]) {
    assert.equal(isSelectableDesign(junk, { production: false }), false,
      `${JSON.stringify(junk)} must not be selectable`);
  }
});

test('the face is a design that actually exists and is enabled', () => {
  // A face the production gate would strip leaves every logged-out surface —
  // the landing page, login, the legal pages — with no design at all.
  assert.ok(designById(FACE_DESIGN), 'FACE_DESIGN names no registered design');
  assert.equal(designById(FACE_DESIGN).enabled, true);
});

/* -------------------------------- applying -------------------------------- */

const boot = (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  return dom;
};
const root = (dom) => dom.document.documentElement;
const prop = (dom, name) => root(dom).style.getPropertyValue(name);
const themeColor = (dom) => dom.document.querySelector('meta[name="theme-color"]').getAttribute('content');

test('applyDesign puts the design on <html> and paints its two tokens', (t) => {
  const dom = boot(t);
  assert.equal(dom.run('applyDesign("tisch")'), 'tisch');
  assert.equal(root(dom).dataset.design, 'tisch');
  assert.equal(root(dom).dataset.scheme, 'dark', 'a dark design must set the scheme outside a round too');
  assert.equal(prop(dom, '--page-bg'), tisch.page);
  assert.equal(prop(dom, '--brand'), tisch.accent);
  assert.equal(themeColor(dom), tisch.accent, 'the browser chrome follows the design');
});

test('Klassisch leaves the page exactly as it was before the seam existed', (t) => {
  const dom = boot(t);
  dom.run('applyDesign("tisch")');
  assert.equal(dom.run('applyDesign("klassisch")'), 'klassisch');
  assert.equal(root(dom).dataset.design, 'klassisch');
  assert.equal(root(dom).dataset.scheme, undefined, 'Klassisch is light');
  assert.equal(prop(dom, '--page-bg'), '', 'no inline page colour — the :root default paints it');
  assert.equal(prop(dom, '--brand'), '');
  assert.equal(themeColor(dom), '#c2410c', 'back to the standard accent');
});

test('an unknown design falls back to the face rather than leaving the app unpainted', (t) => {
  const dom = boot(t);
  assert.equal(dom.run('applyDesign("a-design-that-was-retired")'), FACE_DESIGN);
  assert.equal(root(dom).dataset.design, FACE_DESIGN);
});

test('the override stylesheet is injected once, on demand, and never twice', (t) => {
  const dom = boot(t);
  const links = () => dom.document.querySelectorAll('link[data-design]');
  assert.equal(links().length, 0, 'nothing is fetched before a design that needs a file is worn');

  dom.run('applyDesign("tisch")');
  assert.equal(links().length, 1);
  assert.equal(links()[0].getAttribute('href'), tisch.stylesheet);
  assert.equal(links()[0].rel, 'stylesheet');

  // Switching away and back must not refetch: the rules simply stop matching
  // once data-design moves, so a second link would buy nothing.
  dom.run('applyDesign("klassisch")');
  dom.run('applyDesign("tisch")');
  assert.equal(links().length, 1, 're-wearing a design must not inject a second link');

  // Klassisch has no file at all.
  dom.run('applyDesign("klassisch")');
  assert.equal(dom.document.querySelectorAll('link[data-design="klassisch"]').length, 0);
});

/* ------------------- a round no longer paints the page ---------------------- */

test('#1202: a round screen puts its MARKER on the page and nothing else', (t) => {
  const dom = boot(t);
  dom.run('applyDesign("tisch")');
  // A round that wore the light Salbei palette before the flip. Its stored
  // design must not reach the page any more — only the marker it maps to.
  const round = { id: 'r1', background: { type: 'theme', id: 'salbei', page: '#eaf1ea', accent: '#397a4b' } };
  dom.call('applyMarker', round);
  assert.equal(root(dom).dataset.scheme, 'dark', 'the worn design decides the scheme, never the round');
  assert.equal(prop(dom, '--page-bg'), tisch.page);
  assert.equal(prop(dom, '--brand'), tisch.accent);
  assert.equal(prop(dom, '--marker'), tisch.markers[2].color, 'Salbei maps to index 2 — Burgunderfilz here');
  assert.equal(root(dom).dataset.world, undefined, 'no world hook exists any more');

  dom.call('applyMarker', null);
  assert.equal(prop(dom, '--marker'), '', 'leaving the round clears its colour');
  assert.equal(prop(dom, '--page-bg'), tisch.page, 'and leaves the design alone');
});

test('under Klassisch the page is still the :root defaults, in a round or not', (t) => {
  // The regression guard for every existing screen: with Klassisch worn, the
  // page must behave exactly as it did before #1184.
  const dom = boot(t);
  dom.run('applyDesign("klassisch")');
  dom.call('applyMarker', { id: 'r1', background: { type: 'theme', id: 'forest' } });
  assert.equal(prop(dom, '--page-bg'), '');
  assert.equal(prop(dom, '--brand'), '');
  assert.equal(root(dom).dataset.scheme, undefined);
  assert.equal(themeColor(dom), '#c2410c');
  assert.equal(prop(dom, '--marker'), klassisch.markers[2].color, 'a Forest round is sage under Klassisch');
});

/* ------------------------------ boot + the flag ---------------------------- */

test('boot wears the face, and the ?design= flag needs the SERVER to allow it', (t) => {
  const dom = boot(t);
  const asked = [];
  // withAppConfig is the memoized /api/config reader (auth-tokens.js). Stubbing
  // it is the whole point: the flag must not be able to select a design the
  // server did not list, which is what keeps it from being a back door into an
  // unfinished design on production.
  dom.set('withAppConfig', (cb) => { asked.push(true); cb({ designs: [FACE_DESIGN] }); });

  dom.window.history.replaceState({}, '', '/?design=klassisch');
  dom.run('initDesign()');
  assert.equal(root(dom).dataset.design, FACE_DESIGN,
    'the server did not offer klassisch, so the flag must not apply it');
  assert.equal(asked.length, 1, 'the server was asked');

  // Now the same flag against a server that does offer it — the dev/review path.
  dom.set('withAppConfig', (cb) => cb({ designs: ['klassisch', FACE_DESIGN] }));
  dom.run('initDesign()');
  assert.equal(root(dom).dataset.design, 'klassisch');
});

test('with no flag, boot applies the face synchronously and asks nothing', (t) => {
  const dom = boot(t);
  let asked = 0;
  dom.set('withAppConfig', (cb) => { asked += 1; cb({ designs: [FACE_DESIGN, 'tisch'] }); });
  dom.window.history.replaceState({}, '', '/');
  dom.run('initDesign()');
  assert.equal(root(dom).dataset.design, FACE_DESIGN);
  assert.equal(asked, 0, 'no config round trip when there is nothing to re-apply');
});

/* ---------------- the override stylesheets carry no colour ----------------- */

/* The rule this enforces is written in .claude/rules/design-stylesheets-are-shell-assets.md
   and in designs.js's header, and prose is the wrong tool for it: the failure
   is invisible in every direction. A colour declared in an override file
   renders perfectly, breaks no test, and is simply never measured by
   test/a11y-contrast.test.js — which resolves each design's tokens out of
   styles.css from the registry's page/accent/scheme. So the first design to
   put its --surface in its own file ships an unmeasured contrast pair, which is
   exactly the #145 class of regression on a surface nobody has looked at yet.

   #1188 MOVED THE LINE, and did not remove it. test/support/theme.js now
   resolves a token through the design's own `:root[data-design="<id>"]` block
   before styles.css, so a colour declared THERE is measured exactly like a
   :root token — which is what let Der Tisch own its walnut --surface and its
   paper --ink. Everywhere else in the file the old reasoning is untouched: a
   descendant rule is not in the harness's field of view, so a colour in one
   still ships unmeasured.

   So both sweeps below now ask "outside the design's own root block?" rather
   than "in this file at all?".

   Two halves, because either alone is porous, and that is measured rather than
   assumed (.claude/rules/redundant-guards-make-each-other-untestable.md — a
   deliberate break that reddens nothing means one of them is dead weight).
   Putting `--tisch-felt-edge: #1a2b1f` on a component rule reddens ONLY the
   literal sweep; putting `--surface: var(--sunken)` there — a shadow with no
   literal in it — reddens ONLY the token sweep. Neither covers the other's
   case, so do not merge them.

   The third guard is in test/a11y-contrast.test.js: a colour token declared in
   a design's root block is RESOLVABLE, which is not the same as measured, so
   that file asserts every one of them appears in a named pair. Without it this
   change would have traded an unmeasured colour for an unmeasured token. */

const fs = require('node:fs');
const path = require('node:path');

const CSS_DIR = path.join(__dirname, '..', 'public', 'css', 'designs');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const designSheets = () => fs.readdirSync(CSS_DIR)
  .filter((f) => f.endsWith('.css'))
  .map((f) => [f, stripComments(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'))]);

/* A sheet split into [its own :root[data-design] block, everything else].
   Brace-matched rather than regexed, because the block legitimately contains
   `color-mix(…)` and a lazy match would end at the first `}` inside one. The
   design id is taken from the FILENAME, so a block keyed on some other
   design's id lands in `rest` and is judged there — which is correct: it would
   never be resolved for this design either. */
function splitRoot(file, css) {
  const id = file.replace(/\.css$/, '');
  /* EVERY root block, not the first: a design may split its tokens into an
     unconditional block (fonts, radii) and a scheme-qualified one (its
     colours), which is what Der Tisch does and why this loops. Cutting only
     the first would leave the colour block in `rest`, where both sweeps would
     then report every one of its values as an unmeasured literal. */
  let root = '';
  let rest = '';
  let from = 0;
  for (;;) {
    const at = css.indexOf(`:root[data-design="${id}"]`, from);
    // A DESCENDANT rule (`:root[data-design="x"] .sheet`) is a component rule,
    // not a root block, and belongs in `rest`.
    if (at === -1) { rest += css.slice(from); break; }
    const open = css.indexOf('{', at);
    if (css.slice(at, open).replace(`:root[data-design="${id}"]`, '').trim()
      .replace(/^\[data-scheme="[a-z]+"\]$/, '') !== '') {
      rest += css.slice(from, open + 1);
      from = open + 1;
      continue;
    }
    let depth = 1;
    let i = open + 1;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    rest += css.slice(from, at);
    root += css.slice(open + 1, i - 1);
    from = i;
  }
  return { root, rest };
}

test('every registered design with a stylesheet has one, and every stylesheet a design', () => {
  // Anti-vacuous, and it binds both ways: an empty directory would make the two
  // sweeps below pass while checking nothing, and an orphan file would be dead
  // weight nothing loads.
  const onDisk = designSheets().map(([f]) => '/css/designs/' + f).sort();
  const declared = DESIGN_REGISTRY.filter((d) => d.stylesheet).map((d) => d.stylesheet).sort();
  assert.ok(onDisk.length >= 1, 'no design stylesheet on disk — the colour sweeps below are vacuous');
  assert.deepEqual(onDisk, declared, 'public/css/designs/ and the registry disagree about which files exist');
});

test('no design stylesheet re-declares a colour token OUTSIDE its resolved root block', () => {
  /* Derived from styles.css rather than from a list written here: the set of
     tokens the harness reads is whatever :root and the dark block declare, so a
     token added there is covered without anyone remembering this file. An
     enumerated list is the shape that silently stops covering the newest member
     (.claude/rules/source-scanning-guards-enumerate-shapes.md). */
  const appCss = stripComments(fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8'));
  const resolved = new Set([...appCss.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gm)].map((m) => m[2]));
  assert.ok(resolved.size > 40, `only ${resolved.size} tokens found in styles.css — did the parse break?`);

  const clashes = [];
  for (const [file, css] of designSheets()) {
    const { root, rest } = splitRoot(file, css);
    const own = new Set([...root.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gm)].map((m) => m[2]));
    for (const m of rest.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:\s*([^;}]+)/gm)) {
      // Layout tokens are the POINT of these files; only a token styles.css
      // also declares can shadow a value the harness measured.
      if (!resolved.has(m[2]) || !COLOUR_TOKENS.test(m[2])) continue;
      /* A RE-POINT is allowed, and is how a subtree flips scheme: an overlay in
         Der Tisch is a paper card on a wood table, so `.sheet` sets
         `--surface: var(--paper)`. That is legible — the value it resolves to
         is declared in the root block, where the harness reads it, and
         test/a11y-contrast.test.js measures the paper pairs by name. What stays
         banned is a value the harness cannot follow: a literal, or a var()
         into a token this design never declares. */
      const repoint = /^var\((--[a-z0-9-]+)\)$/.exec(m[3].trim());
      if (repoint && own.has(repoint[1])) continue;
      clashes.push(`${file} -> ${m[2]}: ${m[3].trim()}`);
    }
  }
  assert.deepEqual(clashes, [],
    'these design stylesheets shadow a colour token OUTSIDE their :root[data-design] block, '
    + 'where test/support/theme.js cannot see it — declare it in that block instead, '
    + 'or point the component rule at a token that is declared there');
});

/* The colour tokens specifically: everything the app paints ink, fills and
   edges with. A design's LAYOUT tokens (--radius-*, --text-*, --w-*, --dur-*)
   are exactly what an override file is for, so the sweep above must not refuse
   them. */
const COLOUR_TOKENS = /^--(page-bg|brand|accent|bg|surface|ink|on-accent|shade|sunken|line|control|placeholder|good|warn|danger|gold|stage|scrim|page-glow)/;

test('no design stylesheet contains a colour literal outside its resolved root block', () => {
  /* The half the token sweep cannot see: a component rule inventing its own
     `--tisch-felt-edge: #1a2b1f`, or simply writing `color: #8d6436`, declares
     a colour styles.css never heard of, so it clashes with nothing — and paints
     an unmeasured colour all the same.

     Every component rule in a design sheet therefore reads `var(--x)` and
     nothing else. That is not a style preference: it is what forces a colour up
     into the one block the harness reads. */
  const found = [];
  for (const [file, css] of designSheets()) {
    const { rest } = splitRoot(file, css);
    for (const m of rest.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\s*\(/g)) {
      found.push(`${file} -> ${m[0]}`);
    }
  }
  assert.deepEqual(found, [],
    'a design stylesheet paints a colour outside its :root[data-design] block, where the '
    + 'contrast suite cannot resolve it — hoist it into that block as a token and '
    + 'reference it with var()');
});

test('a design\'s root block is real — the two sweeps above are not passing by splitting everything away', () => {
  /* splitRoot() decides what both sweeps look at, so a bug in it that returned
     an empty `rest` would make each of them vacuously green while a sheet
     painted whatever it liked. Assert the split found a block AND left the
     component rules behind. */
  const sheets = designSheets();
  assert.ok(sheets.length >= 1, 'no design stylesheet on disk');
  for (const [file, css] of sheets) {
    const { root, rest } = splitRoot(file, css);
    assert.ok(root.includes('--'), `${file}: no :root[data-design] block found — did the hook move?`);
    assert.ok(rest.includes(':root[data-design'),
      `${file}: nothing but the root block survived the split — the sweeps above would be vacuous`);
  }
});

/* ------------------------------ designIs (#1262) ----------------------------- */

test('designIs answers for the design in force, and only that one', () => {
  const dom = loadApp({ locale: 'de' });
  dom.run('applyDesign("tisch")');
  assert.equal(dom.run('designIs("tisch")'), true);
  assert.equal(dom.run('designIs("klassisch")'), false);
  dom.run('applyDesign("klassisch")');
  assert.equal(dom.run('designIs("tisch")'), false);
  assert.equal(dom.run('designIs("klassisch")'), true);
  // An unknown id falls back to the face, so the predicate never reports a
  // design that is not actually painted.
  dom.run('applyDesign("a-design-that-was-retired")');
  assert.equal(dom.run('designIs("' + FACE_DESIGN + '")'), true);
});

/* ------------------- re-rendering on a design change (#1266) ------------------ */
/* A screen that branches on designIs() builds its markup once. Without a
 * re-render, a design change while it is on display leaves the old markup under
 * the new stylesheet. The three cases below are the ones where a re-render
 * would be WRONG, and each is a way the obvious "just call currentView()" fix
 * breaks: before the first route (it would render the default home view over
 * the cold load), during a chooser preview (it would rebuild the chooser and
 * lose the pick), and from inside a view's own render (it would re-enter). */

const spyRenders = (dom) => { dom.run('globalThis.__renders = 0; currentView = () => { globalThis.__renders++; }'); };
const renders = (dom) => dom.run('globalThis.__renders');

test('a committed design change re-renders the screen, once, and only once a route has rendered', (t) => {
  const dom = boot(t);
  dom.run('applyDesign("klassisch")');
  spyRenders(dom);
  dom.run('applyDesign("tisch")');
  assert.equal(renders(dom), 0, 'before the first route there is no screen to re-render');
  dom.run('designViewsReady()');
  dom.run('applyDesign("klassisch")');
  assert.equal(renders(dom), 1, 'a real change re-renders');
  dom.run('applyDesign("klassisch")');
  assert.equal(renders(dom), 1, 'the same design again is not a change');
});

test('a preview repaints without committing, so the save re-renders the screen underneath', (t) => {
  const dom = boot(t);
  dom.run('applyDesign("klassisch"); designViewsReady()');
  spyRenders(dom);
  dom.run('applyDesign("tisch", { preview: true })');
  assert.equal(root(dom).dataset.design, 'tisch', 'the preview is painted');
  assert.equal(renders(dom), 0, 'a preview never re-renders');
  dom.run('applyDesign("tisch")');
  assert.equal(renders(dom), 1, 'committing the previewed design re-renders what was built under the old one');
});

test('a view that sets the design as part of its own render does not re-enter itself', (t) => {
  const dom = boot(t);
  dom.run('applyDesign("tisch"); designViewsReady()');
  spyRenders(dom);
  dom.run('applyDesign("klassisch", { rendering: true })');
  assert.equal(renders(dom), 0);
  dom.run('applyDesign("klassisch")');
  assert.equal(renders(dom), 0, 'and the design it rendered under is now the committed one');
});
