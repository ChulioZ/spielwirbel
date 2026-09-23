'use strict';

/* The pages outside the SPA — the contact page (#391), the shared-password login
   page (#595), the server-rendered FAQ (#489) and, since #1198, the legal pages —
   style themselves from a COPY of the app's design tokens. They cannot share the
   real thing: linking public/styles.css would pull the whole SPA stylesheet —
   including its own `body`, `.card` and `.input` rules — onto pages that have no
   round context and must render logged-out.

   The FAQ and the legal pages are `lib/` modules rather than files under
   `public/`, and they are covered by exactly the same assertions: they read the
   file as TEXT and pull the declarations out of its `<style>` block, so whether
   that block sits in an .html document or in a template literal makes no
   difference. It does impose one constraint on those two — the CSS must be
   written inline in the template, never hoisted into a `const` the tag
   interpolates, or the hex sweep scans an interpolation instead of rules and
   passes vacuously.

   A hand-copied constant across two files is precisely the drift that
   .claude/rules/shared-constants-across-the-stack.md exists about, and there the
   one duplicate deemed acceptable (TAG_ICONS) is acceptable *because* a test
   asserts the two copies are identical. This is that test: retune --brand in
   styles.css alone and these pages silently keep the old orange.

   TWO COPIES PER PAGE since #1198. The first is Klassisch's, in the plain
   `:root` block, and is what renders today. The second is the FACE copy: every
   design marked `face: true` in public/js/designs.js gets its own
   `:root[data-design="<id>"]` block, applied only when the page's <html> carries
   that id — which it does exactly when FACE_DESIGN names it (server-stamped for
   /faq and the legal pages, stamped by js/pages/face.js for the two static
   pages). That copy is pinned against the design's OWN resolved tokens — the
   registry's page/accent, then its stylesheet, then styles.css's dark block —
   through the same resolver the contrast suite uses, so it cannot drift from
   what the SPA paints for that design either. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { declaration } = require('./support/theme');
const { DESIGN_REGISTRY, FACE_DESIGN, designById } = require('../public/js/designs');

const ROOT = path.join(__dirname, '..');
// Comments are brace-free text, so a :root matcher happily runs straight through
// one — see .claude/rules/css-text-assertions-strip-comments.md.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (rel) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const CSS = read('public/styles.css');
/* `klassisch: false` for the legal pages only: their Klassisch look predates the
   app's tokens and is frozen as literal colours, so they carry no Klassisch copy
   to pin and their Klassisch rules are not swept for a hex. Their FACE copy and
   every rule scoped to it are held to exactly the same bar as the other three. */
const PAGES = [
  { rel: 'public/kontakt.html', klassisch: true },
  { rel: 'public/login.html', klassisch: true },
  { rel: 'lib/faq.js', klassisch: true },
  { rel: 'lib/legal.js', klassisch: false },
];
const FACES = DESIGN_REGISTRY.filter((d) => d.face);

// Custom properties in a block body.
function varsOf(body) {
  const vars = new Map();
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(name, value.trim().replace(/\s+/g, ' '));
  }
  return vars;
}

// Custom properties declared in the first plain :root block of a stylesheet.
function rootVars(css) {
  const block = css.match(/:root\s*{([^}]*)}/);
  assert.ok(block, 'expected a :root block');
  return varsOf(block[1]);
}

// The face copy for one design: the `:root[data-design="<id>"]` block, exactly.
function faceVars(css, id) {
  const re = new RegExp(`:root\\[data-design="${id}"\\]\\s*{([^}]*)}`);
  const block = css.match(re);
  return block ? varsOf(block[1]) : null;
}

// What the SPA paints for `name` under `design`. --page-bg and --brand are the
// registry's own page/accent, written inline by applyBackground() — styles.css's
// :root value for them is Klassisch's and would be the wrong answer.
function expected(name, design) {
  if (name === '--page-bg' && design.page) return design.page;
  if (name === '--brand' && design.accent) return design.accent;
  return declaration(name, design.scheme === 'dark', design);
}

test('#1198: the face is Klassisch or a design the public pages are dressed for', () => {
  // The flip (#1202) moves FACE_DESIGN. If it moved onto a design no page carries
  // a copy for, every page outside the SPA would keep rendering Klassisch under a
  // face that says otherwise, and nothing else in the suite would notice.
  assert.ok(designById(FACE_DESIGN), `FACE_DESIGN "${FACE_DESIGN}" is not in the registry`);
  assert.ok(FACE_DESIGN === 'klassisch' || designById(FACE_DESIGN).face,
    `FACE_DESIGN "${FACE_DESIGN}" is not marked face: true, so the standalone pages carry no copy of it`);
  // Anti-vacuous: with no face-ready design the per-page loops below test nothing.
  assert.ok(FACES.length >= 1, 'no design is marked face: true');
});

for (const { rel, klassisch } of PAGES) {
  const PAGE = read(rel);
  const style = PAGE.match(/<style>([\s\S]*?)<\/style>/);

  if (klassisch) {
    test(`every design token ${rel} copies still matches public/styles.css`, () => {
      const app = rootVars(CSS);
      const page = rootVars(PAGE);

      // Per page, never over the union: a well-populated page would otherwise
      // satisfy the floor for one that declares nothing and passes vacuously.
      assert.ok(page.size >= 10, `expected ${rel} to declare its tokens, got ${page.size}`);

      for (const [name, value] of page) {
        assert.ok(app.has(name), `${name} is declared in ${rel} but no longer in styles.css`);
        assert.equal(
          value, app.get(name),
          `${name} has drifted: ${rel} says "${value}", styles.css says "${app.get(name)}"`,
        );
      }
    });
  }

  for (const design of FACES) {
    test(`#1198: ${rel}'s ${design.id} copy matches that design's own tokens`, () => {
      const face = faceVars(PAGE, design.id);
      assert.ok(face, `${rel} declares no :root[data-design="${design.id}"] block`);
      assert.ok(face.size >= 10, `expected ${rel}'s ${design.id} block to declare its tokens, got ${face.size}`);

      for (const [name, value] of face) {
        assert.equal(value, expected(name, design),
          `${name} has drifted in ${rel}'s ${design.id} block: says "${value}", the design paints "${expected(name, design)}"`);
      }

      // Every var() the copy leans on resolves inside the copy. A reference to a
      // name only the Klassisch block declares would resolve to KLASSISCH's
      // value, and one declared nowhere would make the whole declaration invalid.
      for (const [name, value] of face) {
        for (const [, ref] of value.matchAll(/var\((--[\w-]+)/g)) {
          assert.ok(face.has(ref), `${name} in ${rel}'s ${design.id} block reads ${ref}, which the block does not declare`);
        }
      }

      // No Klassisch value leaks through: whatever the Klassisch copy declares,
      // the face copy redeclares, so a rule reading any token gets this design's.
      if (klassisch) {
        for (const name of rootVars(PAGE).keys()) {
          assert.ok(face.has(name), `${rel}'s ${design.id} block does not redeclare ${name}, so Klassisch's value shows through`);
        }
      }
    });
  }

  test(`${rel} only @font-faces weights the app self-hosts`, () => {
    const faces = [...PAGE.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
    assert.ok(faces.length > 0, `expected ${rel} to declare its own @font-face rules`);

    for (const face of faces) {
      const src = face.match(/url\('([^']+)'\)/);
      assert.ok(src, `@font-face with no url(): ${face}`);
      // Root-absolute so it resolves the same from any route depth, and a real
      // file so the browser doesn't silently fall back to system-ui. The build
      // copies fonts through unhashed, so this path holds in dist/ too.
      assert.match(src[1], /^\/fonts\//, `font src must be root-absolute: ${src[1]}`);
      assert.ok(
        fs.existsSync(path.join(ROOT, 'public', src[1])),
        `${src[1]} does not exist — ${rel} would fall back to system-ui`,
      );
      // The same file the SPA loads, not a second copy of the typeface.
      assert.ok(
        CSS.includes(src[1].replace(/^\//, '')),
        `${src[1]} is not among the fonts public/styles.css declares`,
      );
    }
  });

  test(`${rel} declares no palette hex outside its token copies`, () => {
    assert.ok(style, `expected ${rel} to carry an inline <style>`);
    // Everything but the token blocks: the page's own rules, which must resolve
    // their colours through the tokens rather than restating a palette value
    // (.claude/rules/theme-derived-colors.md) — that is how login.html came to
    // render in a blue-violet nobody could retune from styles.css.
    // #fff/#000 stay allowed: they are the two non-palette absolutes the app's
    // own rules use inline (button ink, shadow stops).
    const rules = [...style[1].replace(/:root(\[data-design="[\w-]+"\])?\s*{[^}]*}/g, '')
      .matchAll(/([^{}]+){([^{}]*)}/g)]
      .map(([, sel, body]) => ({ sel: sel.trim(), body }));
    // A page without a Klassisch copy is swept only where the face applies —
    // its frozen Klassisch rules are literal by construction (see PAGES).
    const swept = klassisch ? rules : rules.filter((r) => /\[data-design="/.test(r.sel));
    assert.ok(swept.length >= 3, `expected ${rel} to carry rules to sweep, got ${swept.length}`);
    const stray = swept.flatMap((r) => [...r.body.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => `${m[0]} in ${r.sel}`))
      .filter((hit) => !/^#(fff|ffffff|000|000000)\b/i.test(hit));
    assert.deepEqual(stray, [], `${rel} hardcodes ${stray.join(', ')} outside its token copies`);
  });
}

/* ---- the attribute that switches the copy on -------------------------------

   The copies above do nothing until <html data-design> names a design. Two
   mechanisms stamp it, one per kind of page, and both must read FACE_DESIGN
   rather than a literal — a page stamping 'klassisch' by hand would stay
   Klassisch through the flip with every assertion above still green. */

test('#1198: /faq and the legal pages stamp FACE_DESIGN onto <html> on the server', () => {
  process.env.IMPRESSUM_ADDRESS = process.env.IMPRESSUM_ADDRESS || 'Musterweg 1\\n12345 Musterstadt';
  process.env.IMPRESSUM_EMAIL = process.env.IMPRESSUM_EMAIL || 'kontakt@example.test';
  const { renderFaq } = require('../lib/faq');
  const legal = require('../lib/legal');
  const pages = {
    faq: renderFaq('de'),
    impressum: legal.renderImpressum(),
    datenschutz: legal.renderDatenschutz(),
    nutzungsbedingungen: legal.renderNutzungsbedingungen(),
  };
  for (const [name, html] of Object.entries(pages)) {
    const tag = html.match(/<html\b[^>]*>/);
    assert.ok(tag, `${name}: no <html> tag`);
    assert.match(tag[0], new RegExp(`\\bdata-design="${FACE_DESIGN}"`), `${name} does not stamp the face design`);
  }
  // The rendered check alone is satisfied by a hand-written "klassisch" for as
  // long as the face IS Klassisch — i.e. right up to the flip it exists for. So
  // the templates must interpolate the constant, not merely agree with it today.
  for (const rel of ['lib/faq.js', 'lib/legal.js']) {
    assert.ok(read(rel).includes('data-design="${FACE_DESIGN}"'), `${rel} does not interpolate FACE_DESIGN into <html>`);
  }
});

test('#1198: login.html and kontakt.html stamp the face from designs.js, in <head>', () => {
  const faceJs = fs.readFileSync(path.join(ROOT, 'public/js/pages/face.js'), 'utf8');
  assert.match(strip(faceJs), /dataset\.design\s*=\s*FACE_DESIGN/, 'face.js no longer writes FACE_DESIGN');
  for (const rel of ['public/login.html', 'public/kontakt.html']) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const designs = head.indexOf('<script src="/js/designs.js"></script>');
    const stamp = head.indexOf('<script src="/js/pages/face.js"></script>');
    // In <head> and synchronous, so the attribute is on <html> before the body
    // parses and the page never paints Klassisch first. designs.js first, or
    // FACE_DESIGN is undefined when face.js runs and nothing is stamped.
    assert.ok(designs !== -1, `${rel} does not load /js/designs.js in <head>`);
    assert.ok(stamp !== -1, `${rel} does not load /js/pages/face.js in <head>`);
    assert.ok(designs < stamp, `${rel} loads face.js before designs.js`);
  }
});
