'use strict';

/*
 * Render a design's brand marks — app icons, maskable icon, apple-touch icon,
 * favicon and the link-preview (Open Graph) image — to the PNGs its registry
 * row names (#1199).
 *
 *   node scripts/render-design-marks.js            # every design with a recipe
 *   node scripts/render-design-marks.js tisch      # one design
 *
 * WHY A SCRIPT AND COMMITTED OUTPUT. There is no image tooling in this repo and
 * no image build step (the same stance as the Klassisch icons and og-image.png,
 * .claude/rules/link-preview-card.md): the PNGs are rendered once, committed,
 * and served as static files. Headless Chrome is the only rasterizer on the
 * machine that can use the app's own fonts, and driving it over CDP (Node's
 * global WebSocket — no dependency) is what gives exact pixel sizes: a plain
 * `chrome --screenshot` floors the viewport at 500 CSS px, which silently
 * breaks every icon below that (.claude/rules/landing-product-screenshots.md
 * §1).
 *
 * WHERE THE COLOURS COME FROM. Nothing here is a free-floating hex: the felt is
 * the design's default marker (registry), the gold, the brass and the paper
 * ink are read out of the design's own token block in its stylesheet, and the
 * whirl is the bundled Tabler outline (public/js/card-glyphs.js). Retune a
 * token and re-run this; the marks follow.
 *
 * WHERE THE FILES GO. To exactly the paths the registry's `marks` declare, so
 * the manifest route, design.js and test/design-marks.test.js can never
 * disagree with what was rendered. Klassisch has no recipe: its marks are the
 * committed originals and are not re-rendered.
 *
 * LOOK AT EVERY IMAGE AFTERWARDS. test/design-marks.test.js proves the files
 * exist at the sizes they declare; it cannot see a whirl drawn off-centre.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { designById, markerOf } = require('../public/js/designs');
const { CARD_GLYPHS, CARD_GLYPH_BOX } = require('../public/js/card-glyphs');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const { connectCdp } = require('./cdp');
const CDP_PORT = Number(process.env.MARKS_CDP_PORT) || 9334;

// One custom property out of a design stylesheet's first `:root[data-design]`
// block — the token block the contrast suite measures, so the marks are drawn
// in the colours that were measured.
function token(css, name) {
  const m = new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(css);
  if (!m) throw new Error(`token ${name} not found in the design stylesheet`);
  return m[1];
}

function fontFace(family, weight, file) {
  const url = 'file://' + path.join(PUBLIC, 'fonts', file);
  return `@font-face{font-family:"${family}";font-weight:${weight};src:url("${url}") format("woff2");}`;
}

// The whirl as inline SVG, `size` px square, in `color`.
function whirl(size, color) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${CARD_GLYPH_BOX} ${CARD_GLYPH_BOX}" aria-hidden="true">`
    + `<path fill="${color}" d="${CARD_GLYPHS.tornado}"/></svg>`;
}

/* ---------------------------------------------------------------- Der Tisch */

function tischRecipe() {
  const design = designById('tisch');
  const css = fs.readFileSync(path.join(PUBLIC, design.stylesheet.replace(/^\//, '')), 'utf8');
  const felt = markerOf('tisch', 0); // Tannenfilz, the default felt (T8.1)
  const c = {
    felt: felt.color,
    feltDeep: felt.deep,
    page: design.page,
    gold: token(css, '--gold'),
    goldDeep: token(css, '--gold-deep'),
    goldInk: token(css, '--gold-ink'),
    edge: token(css, '--gold-edge'),
    brassHi: token(css, '--brass-hi'),
    ink: token(css, '--felt-ink'),
    inkSoft: token(css, '--felt-ink-soft'),
    wood: token(css, '--wood-light'),
    woodDeep: token(css, '--wood-deep'),
  };
  const fonts = fontFace('Bricolage Grotesque', 800, 'bricolage-grotesque-latin-800-normal.woff2')
    + fontFace('Manrope', 600, 'manrope-latin-600-normal.woff2')
    + fontFace('Manrope', 700, 'manrope-latin-700-normal.woff2');
  const feltGround = `radial-gradient(100% 110% at 35% 15%, ${c.felt}, ${c.feltDeep} 72%)`;

  // T11.2: felt with the whirl in gold, no brass edge. `glyph` is the whirl's
  // share of the side — 52% on the app icons, 36% on the maskable one so the
  // whole mark sits inside the inner 60% (the 20% safe margin the sheet draws).
  const icon = (size, glyph, ground = feltGround, radius = 0) => ({
    width: size,
    height: size,
    html: `<div style="position:fixed;inset:0;display:grid;place-items:center;background:${ground};`
      + `border-radius:${radius}px">${whirl(Math.round(size * glyph), c.gold)}</div>`,
  });

  const marks = design.marks;
  const [i192, i512, maskable] = marks.icons;
  const og = {
    width: 1200,
    height: 630,
    // T11.2's Open Graph frame at 2x: the felt panel with the claim on the left,
    // the shelf with the "Session wirbeln" plate on the right. The copy is the
    // design's own and German only, like today's card — a scraper runs no
    // script, so there is no locale to follow (.claude/rules/link-preview-card.md
    // §1). No covers but the app's own placeholder gradients, as everywhere a
    // committed image shows a shelf.
    html: `<div style="position:fixed;inset:0;display:flex;background:${c.page};font-family:Manrope">
      <div style="width:680px;flex:none;box-sizing:border-box;padding:48px;display:flex;flex-direction:column;gap:26px;
        background:radial-gradient(90% 130% at 30% -10%, ${c.felt}, ${c.feltDeep} 74%);border-right:10px solid ${c.edge}">
        <span style="align-self:flex-start;font:800 26px 'Bricolage Grotesque';letter-spacing:.14em;text-transform:uppercase;
          color:${c.goldInk};background:linear-gradient(180deg, ${c.brassHi}, ${c.goldDeep});border-radius:6px;padding:10px 22px">Spielwirbel</span>
        <span style="font:800 64px/1.06 'Bricolage Grotesque';color:${c.ink}">Wer am Tisch sitzt, entscheidet mit.</span>
        <span style="font:600 28px/1.45 Manrope;color:${c.inkSoft}">Regal füllen, Session wirbeln, geheim werten.</span>
        <span style="margin-top:auto;font:700 24px Manrope;color:${c.ink}">Kein Tracking · EU-Hosting · spielwirbel.app</span>
      </div>
      <div style="flex:1;padding:48px 44px;display:flex;flex-direction:column;gap:24px;justify-content:center">
        <span style="display:flex;gap:16px;align-items:flex-end">
          ${[[184, 204], [148, 32], [208, 318], [168, 150]].map(([h, hue]) => `<span style="width:92px;height:${h}px;border-radius:6px;
            background:linear-gradient(150deg, hsl(${hue} 42% 34%), hsl(${hue + 40} 50% 15%));box-shadow:0 10px 22px rgba(0,0,0,.5)"></span>`).join('')}
        </span>
        <span style="height:18px;border-radius:4px;background:linear-gradient(180deg, ${c.goldDeep}, ${c.edge})"></span>
        <span style="align-self:flex-start;display:inline-flex;align-items:center;gap:16px;min-height:88px;padding:0 32px;border-radius:8px;
          background:linear-gradient(180deg, ${c.brassHi}, ${c.goldDeep});color:${c.goldInk};font:800 32px 'Bricolage Grotesque'">
          ${whirl(38, c.goldInk)} Session wirbeln</span>
      </div>
    </div>`,
  };

  return {
    fonts,
    assets: [
      [i192.src, icon(192, 0.52)],
      [i512.src, icon(512, 0.52)],
      [maskable.src, icon(512, 0.36)],
      // Opaque and full-bleed: iOS applies its own mask and fills transparency
      // with black.
      [marks.appleTouch, icon(180, 0.5)],
      // T11.2: the favicon drops the gradient for the flat deep felt, and keeps
      // a small radius — at 32px a gradient only reads as noise.
      [marks.favicon.href, icon(32, 0.56, c.feltDeep, 5)],
      [marks.og, og],
    ],
  };
}

const RECIPES = { tisch: tischRecipe };

/* ------------------------------------------------------------------ the CDP */

// scripts/cdp.js, shared with capture-landing-shots.js. --allow-file-access-from-files
// is what lets the page load the repo's woff2 files by file:// path; without it
// the marks render in a fallback face and look subtly wrong rather than broken.
async function connect() {
  const cleanups = [];
  const cdp = await connectCdp({
    port: CDP_PORT, extraArgs: ['--allow-file-access-from-files'], onCleanup: (fn) => cleanups.push(fn),
  });
  return { ...cdp, close: () => { while (cleanups.length) cleanups.pop()(); } };
}

async function render(cdp, dir, fonts, rel, asset) {
  const page = path.join(dir, 'mark.html');
  fs.writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
    html,body{margin:0;background:transparent}</style></head><body>${asset.html}</body></html>`);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: asset.width, height: asset.height, deviceScaleFactor: 1, mobile: false,
  });
  // Transparent where nothing is painted — the favicon's rounded corners.
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: 'file://' + page });
  await loaded;
  // A face that is still loading renders in a fallback and looks subtly wrong
  // rather than broken, so wait for the fonts rather than for a guessed delay.
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: 'document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === "loaded").length)',
    awaitPromise: true, returnByValue: true,
  });
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, width: asset.width, height: asset.height, scale: 1 },
  });
  const out = path.join(PUBLIC, rel.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(`  wrote ${path.relative(ROOT, out)} (${asset.width}x${asset.height}, `
    + `${(fs.statSync(out).size / 1024).toFixed(1)} KB, ${result.value} fonts loaded)`);
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const ids = only.length ? only : Object.keys(RECIPES);
  for (const id of ids) if (!RECIPES[id]) throw new Error(`no recipe for design '${id}' (have: ${Object.keys(RECIPES).join(', ')})`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marks-'));
  const cdp = await connect();
  try {
    for (const id of ids) {
      console.log(`render-design-marks: ${id}`);
      const { fonts, assets } = RECIPES[id]();
      for (const [rel, asset] of assets) await render(cdp, dir, fonts, rel, asset);
    }
  } finally {
    cdp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('render-design-marks: done — now LOOK at every image before committing.');
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
