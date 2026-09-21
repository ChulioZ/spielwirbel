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
  DESIGN_REGISTRY, FACE_DESIGN, designById,
  selectableDesigns, selectableDesignIds, isSelectableDesign,
} = require('../public/js/designs');
const { PALETTES } = require('../public/js/round-designs');

const tisch = designById('tisch');
const klassisch = designById(FACE_DESIGN);

// A LIGHT round design, to prove a round still overrides the user's dark one.
const salbei = PALETTES.find((p) => p.id === 'salbei');
const roundBg = (d) => ({ type: 'theme', id: d.id, page: d.page, accent: d.accent });

/* ------------------------------- the registry ------------------------------ */

test('the registry ships an unfinished design, or the gate tests below are vacuous', () => {
  assert.ok(DESIGN_REGISTRY.some((d) => d.enabled), 'no enabled design ships');
  assert.ok(DESIGN_REGISTRY.some((d) => !d.enabled),
    'no disabled design ships — every production-gate assertion here means nothing');
});

test('Klassisch declares NO colours — it IS the :root default', () => {
  // Load-bearing rather than tidiness: it is what makes applyBackground take
  // the removeProperty branch, i.e. what makes "Klassisch renders exactly as
  // before" a property of the code rather than a coincidence of two hexes.
  assert.equal(klassisch.page, undefined);
  assert.equal(klassisch.accent, undefined);
  assert.equal(klassisch.stylesheet, undefined, 'styles.css is Klassisch; it needs no override file');
});

test('production offers only enabled designs; outside it, the whole registry', () => {
  const enabled = DESIGN_REGISTRY.filter((d) => d.enabled).map((d) => d.id);
  assert.deepEqual(selectableDesignIds({ production: true }), enabled);
  assert.deepEqual(selectableDesignIds({ production: false }), DESIGN_REGISTRY.map((d) => d.id));
  // No argument at all must NOT mean production: this module runs in the
  // browser, where there is no NODE_ENV to read, and a default that guessed
  // wrong in the strict direction would hide a design under review.
  assert.deepEqual(selectableDesignIds(), DESIGN_REGISTRY.map((d) => d.id));
  assert.equal(selectableDesigns({ production: true }).every((d) => d.enabled), true);
});

test('selectability is an allowlist — never a denylist', () => {
  assert.equal(isSelectableDesign(FACE_DESIGN, { production: true }), true);
  assert.equal(isSelectableDesign('tisch', { production: true }), false, 'not enabled yet');
  assert.equal(isSelectableDesign('tisch', { production: false }), true);
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

/* --------------------- the three-state scheme contract --------------------- */

test('a round design overrides the user design, and leaving the round restores it', (t) => {
  const dom = boot(t);
  dom.run('applyDesign("tisch")');
  assert.equal(root(dom).dataset.scheme, 'dark');

  // Inside a LIGHT round: rounds keep their own designs until the flip (#1202),
  // so the round wins outright — scheme, page and accent together. Anything
  // less would leave light-design surfaces under a dark page or vice versa.
  dom.call('applyBackground', roundBg(salbei));
  assert.equal(root(dom).dataset.scheme, undefined, 'a light round design clears the dark scheme');
  assert.equal(prop(dom, '--page-bg'), salbei.page);
  assert.equal(prop(dom, '--brand'), salbei.accent);
  assert.equal(root(dom).dataset.design, 'tisch', 'the user design is still what the account wears');

  // Back out of the round: null is NOT "light", it is "no round design here".
  dom.call('applyBackground', null);
  assert.equal(root(dom).dataset.scheme, 'dark', 'leaving a round must fall back to the USER design');
  assert.equal(prop(dom, '--page-bg'), tisch.page);
  assert.equal(prop(dom, '--brand'), tisch.accent);
});

test('a legacy colour-only round is light by construction, not a fallback', (t) => {
  // A {type:'color'} round predates dark designs entirely, so its page is a
  // light colour. Resolving it to the user design's scheme would put light-mode
  // ink on it — the one case where "no registry entry" must still mean light.
  const dom = boot(t);
  dom.run('applyDesign("tisch")');
  dom.call('applyBackground', { type: 'color', color: '#eeeeee' });
  assert.equal(root(dom).dataset.scheme, undefined);
  assert.equal(prop(dom, '--page-bg'), '#eeeeee');
});

test('under Klassisch the fallback is still the :root defaults', (t) => {
  // The regression guard for every existing screen: with the face worn, the
  // no-round-design branch must behave exactly as it did before #1184.
  const dom = boot(t);
  dom.run('applyDesign("klassisch")');
  dom.call('applyBackground', roundBg(salbei));
  dom.call('applyBackground', null);
  assert.equal(prop(dom, '--page-bg'), '');
  assert.equal(prop(dom, '--brand'), '');
  assert.equal(root(dom).dataset.scheme, undefined);
  assert.equal(themeColor(dom), '#c2410c');
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

  dom.window.history.replaceState({}, '', '/?design=tisch');
  dom.run('initDesign()');
  assert.equal(root(dom).dataset.design, FACE_DESIGN,
    'the server did not offer tisch, so the flag must not apply it');
  assert.equal(asked.length, 1, 'the server was asked');

  // Now the same flag against a server that does offer it — the dev/review path.
  dom.set('withAppConfig', (cb) => cb({ designs: [FACE_DESIGN, 'tisch'] }));
  dom.run('initDesign()');
  assert.equal(root(dom).dataset.design, 'tisch');
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

   Two halves, because either alone is porous, and that is measured rather than
   assumed (.claude/rules/redundant-guards-make-each-other-untestable.md — a
   deliberate break that reddens nothing means one of them is dead weight).
   Adding `--tisch-felt-edge: #1a2b1f` reddens ONLY the literal sweep; adding
   `--surface: var(--sunken)` — a shadow with no literal in it — reddens ONLY
   the token sweep. Neither guard covers the other's case, so do not merge
   them. */

const fs = require('node:fs');
const path = require('node:path');

const CSS_DIR = path.join(__dirname, '..', 'public', 'css', 'designs');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const designSheets = () => fs.readdirSync(CSS_DIR)
  .filter((f) => f.endsWith('.css'))
  .map((f) => [f, stripComments(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'))]);

test('every registered design with a stylesheet has one, and every stylesheet a design', () => {
  // Anti-vacuous, and it binds both ways: an empty directory would make the two
  // sweeps below pass while checking nothing, and an orphan file would be dead
  // weight nothing loads.
  const onDisk = designSheets().map(([f]) => '/css/designs/' + f).sort();
  const declared = DESIGN_REGISTRY.filter((d) => d.stylesheet).map((d) => d.stylesheet).sort();
  assert.ok(onDisk.length >= 1, 'no design stylesheet on disk — the colour sweeps below are vacuous');
  assert.deepEqual(onDisk, declared, 'public/css/designs/ and the registry disagree about which files exist');
});

test('no design stylesheet re-declares a token the contrast harness resolves', () => {
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
    for (const m of css.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gm)) {
      // Layout tokens are the POINT of these files; only a token styles.css
      // also declares can shadow a value the harness measured.
      if (resolved.has(m[2]) && COLOUR_TOKENS.test(m[2])) clashes.push(`${file} -> ${m[2]}`);
    }
  }
  assert.deepEqual(clashes, [],
    'these design stylesheets shadow a colour token the contrast suite resolves from styles.css, '
    + 'so the shadowed value ships unmeasured — put the design\'s colours in public/js/designs.js');
});

/* The colour tokens specifically: everything the app paints ink, fills and
   edges with. A design's LAYOUT tokens (--radius-*, --text-*, --w-*, --dur-*)
   are exactly what an override file is for, so the sweep above must not refuse
   them. */
const COLOUR_TOKENS = /^--(page-bg|brand|accent|bg|surface|ink|on-accent|shade|sunken|line|control|placeholder|good|warn|danger|gold|stage|scrim|page-glow)/;

test('no design stylesheet contains a colour literal at all', () => {
  /* The half the token sweep cannot see: a design inventing its own
     `--tisch-felt-edge: #1a2b1f` declares a token styles.css never heard of, so
     it clashes with nothing — and paints an unmeasured colour all the same. */
  const found = [];
  for (const [file, css] of designSheets()) {
    for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\s*\(/g)) {
      found.push(`${file} -> ${m[0]}`);
    }
  }
  assert.deepEqual(found, [],
    'a design stylesheet declares a colour, which the contrast suite cannot resolve: '
    + 'a design\'s colours belong in public/js/designs.js (see its header)');
});
