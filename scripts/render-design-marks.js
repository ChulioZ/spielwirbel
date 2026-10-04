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

/* -------------------------------------------------------------------- Ocean */

// #1222 (the go-live): Ocean's own marks, decided at go-live rather than left on
// Klassisch's orange die. Nothing in the package draws them (#1220 scoped the
// app icon out), so they are Der Tisch's T11.2 composition re-dressed in Ocean's
// own tokens: the whirl — Spielwirbel's mark in every design — in Gischt on the
// accent water. A light ground was the obvious reading of a light design and the
// wrong one: at 16px on a white home screen the pale water dissolves into its
// neighbours, so the icon takes the accent, which is what Ocean's primary button
// wears. Gischt on the accent is 5.8:1, on --brand-strong 8.2:1.
function oceanRecipe() {
  const design = designById('ocean');
  const css = fs.readFileSync(path.join(PUBLIC, design.stylesheet.replace(/^\//, '')), 'utf8');
  const c = {
    page: design.page,
    accent: design.accent,
    brandStrong: token(css, '--brand-strong'),
    foam: token(css, '--water-foam'),
    coast: token(css, '--water-coast'),
    deep: token(css, '--deep'),
    deepBottom: token(css, '--deep-bottom'),
    deepInk: token(css, '--deep-ink'),
    deepInkSoft: token(css, '--deep-ink-soft'),
    ink: token(css, '--ink'),
    sand: token(css, '--sand'),
    sandDeep: token(css, '--sand-deep'),
    waterline: token(css, '--waterline'),
    waterlineDeep: token(css, '--waterline-deep'),
  };
  const fonts = fontFace('Comfortaa', 700, 'comfortaa-latin-700-normal.woff2')
    + fontFace('Figtree', 600, 'figtree-latin-600-normal.woff2')
    + fontFace('Figtree', 700, 'figtree-latin-700-normal.woff2');
  const water = `radial-gradient(110% 110% at 35% 15%, ${c.accent}, ${c.brandStrong} 78%)`;

  // Same proportions as Der Tisch's: 52% on the app icons, 36% on the maskable
  // one so the whole whirl sits inside the inner 60%.
  const icon = (size, glyph, ground = water, radius = 0) => ({
    width: size,
    height: size,
    html: `<div style="position:fixed;inset:0;display:grid;place-items:center;background:${ground};`
      + `border-radius:${radius}px">${whirl(Math.round(size * glyph), c.foam)}</div>`,
  });

  const marks = design.marks;
  const [i192, i512, maskable] = marks.icons;
  const og = {
    width: 1200,
    height: 630,
    // Der Tisch's Open Graph frame, Ocean's materials: the deep-water panel with
    // the claim on the left, the shelf on a sand ledge over the page's water on
    // the right. German only, like every og card (link-preview-card.md §1).
    html: `<div style="position:fixed;inset:0;display:flex;background:linear-gradient(180deg, ${c.foam}, ${c.coast});font-family:Figtree">
      <div style="width:680px;flex:none;box-sizing:border-box;padding:48px;display:flex;flex-direction:column;gap:26px;
        background:linear-gradient(180deg, ${c.deep}, ${c.deepBottom});border-right:10px solid ${c.waterlineDeep}">
        <span style="align-self:flex-start;font:700 26px Comfortaa;letter-spacing:.08em;
          color:${c.deepInk};background:${c.accent};border-radius:999px;padding:12px 26px">Spielwirbel</span>
        <span style="font:700 60px/1.12 Comfortaa;color:${c.deepInk}">Wer am Tisch sitzt, entscheidet mit.</span>
        <span style="font:600 28px/1.45 Figtree;color:${c.deepInkSoft}">Regal füllen, Session wirbeln, geheim werten.</span>
        <span style="margin-top:auto;font:700 24px Figtree;color:${c.deepInk}">Kein Tracking · EU-Hosting · spielwirbel.app</span>
      </div>
      <div style="flex:1;padding:48px 44px;display:flex;flex-direction:column;gap:24px;justify-content:center">
        <span style="display:flex;gap:16px;align-items:flex-end">
          ${[[184, 204], [148, 32], [208, 318], [168, 150]].map(([h, hue]) => `<span style="width:92px;height:${h}px;border-radius:12px;
            background:linear-gradient(150deg, hsl(${hue} 48% 52%), hsl(${hue + 40} 50% 30%));box-shadow:0 10px 22px rgba(16,40,58,.28)"></span>`).join('')}
        </span>
        <span style="height:18px;border-radius:9px;background:linear-gradient(180deg, ${c.sand}, ${c.sandDeep})"></span>
        <span style="align-self:flex-start;display:inline-flex;align-items:center;gap:16px;min-height:88px;padding:0 34px;border-radius:999px;
          background:${c.accent};color:${c.foam};font:700 30px Comfortaa">
          ${whirl(38, c.foam)} Session wirbeln</span>
      </div>
    </div>`,
  };

  return {
    fonts,
    assets: [
      [i192.src, icon(192, 0.52)],
      [i512.src, icon(512, 0.52)],
      [maskable.src, icon(512, 0.36)],
      [marks.appleTouch, icon(180, 0.5)],
      // Flat deep accent at 32px, like Der Tisch's flat felt: a gradient there
      // only reads as noise.
      [marks.favicon.href, icon(32, 0.56, c.brandStrong, 7)],
      [marks.og, og],
    ],
  };
}

/* ------------------------------------------------------------------ Brücke */

// #1419: Die Brücke's own marks. The whirl stays Spielwirbel's sign in every
// design (operator decision on #1436), so the icons are the whirl, lit in the
// cyan accent with the lamp's glow (B8.4, brueckeWordmark), on B1's night ground
// inside the two corner brackets every Brücke plate wears (B1 „Klammern", the
// one ornament a panel may have). Cyan on the night is 13:1.
function brueckeRecipe() {
  const design = designById('bruecke');
  const css = fs.readFileSync(path.join(PUBLIC, design.stylesheet.replace(/^\//, '')), 'utf8');
  const c = {
    page: design.page,
    accent: design.accent,
    pageHi: token(css, '--page-hi'),
    surface: token(css, '--surface'),
    line: token(css, '--line'),
    ink: token(css, '--ink'),
    inkSoft: token(css, '--ink-soft'),
    action: token(css, '--action'),
    onAccent: token(css, '--on-accent'),
  };
  const fonts = fontFace('Chakra Petch', 700, 'chakra-petch-latin-700-normal.woff2')
    + fontFace('IBM Plex Sans', 500, 'ibm-plex-sans-latin-500-normal.woff2')
    + fontFace('IBM Plex Mono', 500, 'ibm-plex-mono-latin-500-normal.woff2');
  // B1's page ground: radial from the light stop to the night (bruecke.css body).
  const night = `radial-gradient(90% 75% at 50% 0%, ${c.pageHi}, ${c.page} 72%)`;

  // The whirl, lit: the lamp's glow (brueckeWordmark: a canvas shadow of the
  // accent) as a drop-shadow, so it follows the glyph rather than a box.
  const litWhirl = (s) => `<span style="display:block;line-height:0;`
    + `filter:drop-shadow(0 0 ${Math.max(1, Math.round(s * 0.12))}px ${c.accent})">${whirl(s, c.accent)}</span>`;
  // The wordmark in B8.4's voice: Chakra Petch 700 capitals, tracked .2em.
  const word = (px) => `<span style="font:700 ${px}px 'Chakra Petch';letter-spacing:.2em;margin-right:-.2em;`
    + `color:${c.accent};line-height:1">SPIELWIRBEL</span>`;
  // Two brackets, top-left and bottom-right, `inset` from the edge.
  const brackets = (arm, stroke, inset) => ['top', 'bottom'].map((v) => {
    const h = v === 'top' ? 'left' : 'right';
    return `<span style="position:absolute;${v}:${inset}px;${h}:${inset}px;width:${arm}px;height:${arm}px;`
      + `border-${v}:${stroke}px solid ${c.accent};border-${h}:${stroke}px solid ${c.accent}"></span>`;
  }).join('');

  // `glyph` is the whirl's share of the side, as on Der Tisch and Ocean;
  // `framed` adds the brackets. `scale` shrinks the whole composition over the
  // full-bleed ground: the maskable icon's 0.7 keeps the brackets' corners
  // inside the inner 60% (a circle of radius 0.4), so Android's crop never
  // takes one.
  const icon = (size, { glyph, framed = true, scale = 1, ground = night, radius = 0 }) => ({
    width: size,
    height: size,
    html: `<div style="position:fixed;inset:0;background:${ground};border-radius:${radius}px">`
      + `<div style="position:absolute;inset:0;display:grid;place-items:center;transform:scale(${scale})">`
      + (framed ? brackets(Math.round(size * 0.14), Math.max(2, Math.round(size * 0.022)), Math.round(size * 0.12)) : '')
      + litWhirl(Math.round(size * glyph))
      + '</div></div>',
  });

  const marks = design.marks;
  const [i192, i512, maskable] = marks.icons;
  const og = {
    width: 1200,
    height: 630,
    // Der Tisch's Open Graph frame in Die Brücke's materials: the flat plate
    // with its brackets and the whirl + wordmark over the claim on the left, the shelf
    // on a cyan hairline over the night on the right, the amber action — B1's
    // „die eine Hauptaktion" — below it. German only, like every og card
    // (link-preview-card.md §1).
    html: `<div style="position:fixed;inset:0;display:flex;background:${night};font-family:'IBM Plex Sans'">
      <div style="position:relative;width:680px;flex:none;box-sizing:border-box;padding:52px;display:flex;flex-direction:column;gap:28px;
        background:${c.surface};border-right:1px solid ${c.line}">
        ${brackets(34, 3, 18)}
        <span style="display:flex;align-items:center;gap:18px">${litWhirl(40)}${word(30)}</span>
        <span style="font:700 60px/1.1 'Chakra Petch';color:${c.ink}">Wer am Tisch sitzt, entscheidet mit.</span>
        <span style="font:500 28px/1.45 'IBM Plex Sans';color:${c.inkSoft}">Regal füllen, Session wirbeln, geheim werten.</span>
        <span style="margin-top:auto;font:500 19px 'IBM Plex Mono';letter-spacing:.04em;text-transform:uppercase;color:${c.inkSoft}">Kein Tracking · EU-Hosting · spielwirbel.app</span>
      </div>
      <div style="flex:1;padding:48px 44px;display:flex;flex-direction:column;gap:24px;justify-content:center">
        <span style="display:flex;gap:16px;align-items:flex-end">
          ${[[184, 204], [148, 32], [208, 318], [168, 150]].map(([h, hue]) => `<span style="width:92px;height:${h}px;
            background:linear-gradient(150deg, hsl(${hue} 45% 40%), hsl(${hue + 40} 50% 18%));border:1px solid ${c.line}"></span>`).join('')}
        </span>
        <span style="height:2px;background:${c.accent};box-shadow:0 0 12px ${c.accent}"></span>
        <span style="align-self:flex-start;display:inline-flex;align-items:center;gap:16px;min-height:88px;padding:0 34px;
          background:${c.action};color:${c.onAccent};font:700 30px 'Chakra Petch';letter-spacing:.08em;text-transform:uppercase;
          box-shadow:0 0 24px ${c.action}66">${whirl(38, c.onAccent)} Session wirbeln</span>
      </div>
    </div>`,
  };

  return {
    fonts,
    assets: [
      [i192.src, icon(192, { glyph: 0.46 })],
      [i512.src, icon(512, { glyph: 0.46 })],
      [maskable.src, icon(512, { glyph: 0.46, scale: 0.7 })],
      [marks.appleTouch, icon(180, { glyph: 0.46 })],
      // 32px: the whirl alone on the flat night, no brackets — at that size
      // they only read as a smudge in the corners.
      [marks.favicon.href, icon(32, { glyph: 0.62, framed: false, ground: c.page, radius: 4 })],
      [marks.og, og],
    ],
  };
}

/* ------------------------------------------------------------ Programmheft */

// #1419: Das Programmheft's own marks. Its mark is P8.4's masthead — the
// vermilion band with SPIELWIRBEL in Anton, in INK (P9: „Tinte auf Zinnober";
// paper on the vermilion is 3.8:1, ink 4.9:1) — as the share card draws it
// (programmheftMasthead), and the whirl stays Spielwirbel's sign in every
// design (operator decision on #1436). So the icons are that band across a
// paper sheet with the 3px ink rule under it, the whirl in ink above the
// wordmark — the app bar's own pairing. The favicon keeps only the whirl on the
// vermilion: eleven letters do not survive 32px.
function programmheftRecipe() {
  const design = designById('programmheft');
  const css = fs.readFileSync(path.join(PUBLIC, design.stylesheet.replace(/^\//, '')), 'utf8');
  const c = {
    page: design.page,
    ink: token(css, '--ink'),
    inkSoft: token(css, '--ink-soft'),
    vermilion: token(css, '--vermilion'),
    onVermilion: token(css, '--on-vermilion'),
    box: token(css, '--box'),
    boxInk: token(css, '--box-ink'),
  };
  const fonts = fontFace('Anton', 400, 'anton-latin-400-normal.woff2')
    + fontFace('Archivo', 600, 'archivo-latin-600-normal.woff2')
    + fontFace('Archivo', 700, 'archivo-latin-700-normal.woff2');

  // The masthead: the band holding the whirl over the wordmark, tracked like
  // the card's (4.8px at 24px = .2em), then the rule. `word` and `glyph` are
  // sizes as a share of the icon.
  const icon = (size, { word, glyph, band, rule }) => ({
    width: size,
    height: size,
    html: `<div style="position:fixed;inset:0;display:flex;flex-direction:column;justify-content:center;background:${c.page}">`
      + `<div style="height:${Math.round(size * band)}px;background:${c.vermilion};display:flex;flex-direction:column;`
      + `align-items:center;justify-content:center;gap:${Math.round(size * 0.035)}px">`
      + whirl(Math.round(size * glyph), c.onVermilion)
      + `<span style="font:400 ${Math.round(size * word)}px/1 Anton;letter-spacing:.2em;margin-right:-.2em;color:${c.onVermilion}">SPIELWIRBEL</span></div>`
      + `<div style="height:${Math.max(2, Math.round(size * rule))}px;margin-top:${Math.round(size * 0.035)}px;background:${c.ink}"></div>`
      + '</div>',
  });
  const favicon = (size) => ({
    width: size,
    height: size,
    html: `<div style="position:fixed;inset:0;display:grid;place-items:center;background:${c.vermilion}">`
      + `${whirl(Math.round(size * 0.72), c.onVermilion)}</div>`,
  });

  const marks = design.marks;
  const [i192, i512, maskable] = marks.icons;
  const og = {
    width: 1200,
    height: 630,
    // The front page: the masthead (whirl + wordmark, no design name — operator
    // decision on #1436) across the whole card, the claim in Anton
    // over the 3px rule on the left, the shelf's placeholder covers flat on
    // paper on the right with the black box — P1's component — as the action.
    // German only, like every og card (link-preview-card.md §1).
    html: `<div style="position:fixed;inset:0;display:flex;flex-direction:column;background:${c.page};font-family:Archivo">
      <div style="height:96px;flex:none;background:${c.vermilion};display:flex;align-items:center;gap:20px;padding:0 52px">
        ${whirl(54, c.onVermilion)}
        <span style="font:400 56px/1 Anton;letter-spacing:.2em;color:${c.onVermilion}">SPIELWIRBEL</span>
      </div>
      <div style="flex:1;display:flex;padding:40px 52px 44px;gap:48px">
        <div style="flex:1;display:flex;flex-direction:column;gap:22px">
          <span style="font:400 76px/1.04 Anton;text-transform:uppercase;color:${c.ink}">Wer am Tisch sitzt, entscheidet mit.</span>
          <span style="height:3px;background:${c.ink}"></span>
          <span style="font:600 28px/1.4 Archivo;color:${c.inkSoft}">Regal füllen, Session wirbeln, geheim werten.</span>
          <span style="margin-top:auto;font:700 20px Archivo;letter-spacing:.12em;text-transform:uppercase;color:${c.ink}">Kein Tracking · EU-Hosting · spielwirbel.app</span>
        </div>
        <div style="width:392px;flex:none;display:flex;flex-direction:column;gap:22px;justify-content:flex-end">
          <span style="display:flex;gap:12px;align-items:flex-end">
            ${[[168, 204], [132, 32], [190, 318], [150, 150]].map(([h, hue]) => `<span style="width:86px;height:${h}px;
              background:linear-gradient(150deg, hsl(${hue} 45% 48%), hsl(${hue + 40} 50% 28%));outline:1px solid ${c.ink}"></span>`).join('')}
          </span>
          <span style="height:3px;background:${c.ink}"></span>
          <span style="align-self:flex-start;display:inline-flex;align-items:center;min-height:80px;padding:0 30px;
            gap:14px;background:${c.box};color:${c.boxInk};font:400 32px Anton;letter-spacing:.08em;text-transform:uppercase">${whirl(36, c.boxInk)} Session wirbeln</span>
        </div>
      </div>
    </div>`,
  };

  return {
    fonts,
    assets: [
      [i192.src, icon(192, { word: 0.1, glyph: 0.2, band: 0.46, rule: 0.018 })],
      [i512.src, icon(512, { word: 0.1, glyph: 0.2, band: 0.46, rule: 0.018 })],
      // The inner 60%: whirl and wordmark narrow to fit it; the band and the
      // rule are ground and may run into the crop.
      [maskable.src, icon(512, { word: 0.07, glyph: 0.15, band: 0.36, rule: 0.013 })],
      [marks.appleTouch, icon(180, { word: 0.1, glyph: 0.2, band: 0.46, rule: 0.018 })],
      [marks.favicon.href, favicon(32)],
      [marks.og, og],
    ],
  };
}

/* ------------------------------------------------------------------ Forest */

// #1465 rendered Forest's first marks with its token slice (test/design-marks.test.js
// holds every coloured design to its own icons from registration); #1475 (F8.4)
// redrew them from the design's WORDMARK BADGE — the flat Laubgrün disc with
// the whirl in F1's light print, as the header (F1.7) and the share card's foot
// (F8.4) wear it — standing on the clearing's light ground. The whirl stays
// Spielwirbel's sign (operator decision on #1436). Light print on the accent is
// 6.5:1. The whirl takes the badge's own 18/34 of the disc.
function forestRecipe() {
  const design = designById('forest');
  const css = fs.readFileSync(path.join(PUBLIC, design.stylesheet.replace(/^\//, '')), 'utf8');
  const c = {
    page: design.page,
    accent: design.accent,
    onDusk: token(css, '--on-dusk'),
    ink: token(css, '--ink'),
    inkSoft: token(css, '--ink-soft'),
    surface: token(css, '--surface'),
    moss: token(css, '--moss'),
    dusk: token(css, '--dusk'),
    duskSoft: token(css, '--dusk-soft'),
    wood: token(css, '--wood'),
    bark: token(css, '--bark'),
  };
  const fonts = fontFace('Young Serif', 400, 'young-serif-latin-400-normal.woff2')
    + fontFace('Alegreya Sans', 700, 'alegreya-sans-latin-700-normal.woff2')
    + fontFace('Alegreya Sans', 800, 'alegreya-sans-latin-800-normal.woff2');
  // The clearing: the page running into moss, lit from the top left — F8.4's
  // sky. Under the disc, so the badge reads as a leaf-green coin on the light.
  const clearing = `radial-gradient(120% 120% at 30% 15%, ${c.page}, ${c.moss} 85%)`;
  const BADGE_GLYPH = 18 / 34;

  // `disc` is the badge's share of the side: 78% on the app icons, 62% on the
  // maskable one so the whole disc sits inside the 80% safe circle. The
  // favicon is the bare badge on transparent — a 32px tab icon is the disc.
  const icon = (size, disc, ground = clearing) => {
    const d = Math.round(size * disc);
    const shadow = size >= 64 ? `box-shadow:0 ${Math.round(size * 0.02)}px ${Math.round(size * 0.05)}px rgba(40,60,30,.28);` : '';
    return {
      width: size,
      height: size,
      html: `<div style="position:fixed;inset:0;display:grid;place-items:center;background:${ground}">`
        + `<div style="width:${d}px;height:${d}px;border-radius:50%;background:${c.accent};${shadow}`
        + `display:grid;place-items:center">${whirl(Math.round(d * BADGE_GLYPH), c.onDusk)}</div></div>`,
    };
  };

  const marks = design.marks;
  const [i192, i512, maskable] = marks.icons;
  const og = {
    width: 1200,
    height: 630,
    // Der Tisch's Open Graph frame, Forest's materials: the dusk panel with the
    // claim in Young Serif on the left — the one dark ground, the wordmark
    // badge beside the name (#1475) — and the clearing on the right: covers on a card, the
    // stump's cut face as a ledge, the leaf-shaped primary button. German only,
    // like every og card (link-preview-card.md §1).
    html: `<div style="position:fixed;inset:0;display:flex;background:${c.page};font-family:'Alegreya Sans'">
      <div style="width:660px;flex:none;box-sizing:border-box;padding:48px;display:flex;flex-direction:column;gap:26px;background:${c.dusk}">
        <span style="display:flex;align-items:center;gap:14px;font:400 30px 'Young Serif';color:${c.onDusk}">
          <span style="width:44px;height:44px;border-radius:50%;background:${c.accent};display:grid;place-items:center">${whirl(23, c.onDusk)}</span>Spielwirbel</span>
        <span style="font:400 60px/1.08 'Young Serif';color:${c.onDusk}">Wer am Tisch sitzt, entscheidet mit.</span>
        <span style="font:700 28px/1.45 'Alegreya Sans';color:${c.duskSoft}">Regal füllen, Session wirbeln, geheim werten.</span>
        <span style="margin-top:auto;font:800 22px 'Alegreya Sans';letter-spacing:.06em;color:${c.onDusk}">Kein Tracking · EU-Hosting · spielwirbel.app</span>
      </div>
      <div style="flex:1;padding:48px 44px;display:flex;flex-direction:column;gap:24px;justify-content:center">
        <span style="display:flex;gap:14px;align-items:flex-end;padding:22px;border-radius:18px;background:${c.surface};
          box-shadow:0 6px 18px rgba(40,60,30,.10)">
          ${[[170, 120], [132, 32], [192, 200], [150, 90]].map(([h, hue]) => `<span style="width:84px;height:${h}px;border-radius:10px;
            background:linear-gradient(150deg, hsl(${hue} 40% 50%), hsl(${hue + 30} 45% 28%))"></span>`).join('')}
        </span>
        <span style="height:16px;border-radius:8px;background:linear-gradient(180deg, ${c.wood}, ${c.bark})"></span>
        <span style="align-self:flex-start;display:inline-flex;align-items:center;gap:14px;min-height:84px;padding:0 32px;
          border-radius:22px 7px 22px 7px;background:${c.accent};color:${c.onDusk};font:800 30px 'Alegreya Sans';
          box-shadow:0 8px 18px rgba(40,60,30,.25)">${whirl(36, c.onDusk)} Session wirbeln</span>
      </div>
    </div>`,
  };

  return {
    fonts,
    assets: [
      [i192.src, icon(192, 0.78)],
      [i512.src, icon(512, 0.78)],
      [maskable.src, icon(512, 0.62)],
      // iOS paints a transparent apple-touch icon black, so it keeps the ground.
      [marks.appleTouch, icon(180, 0.78)],
      [marks.favicon.href, icon(32, 1, 'transparent')],
      [marks.og, og],
    ],
  };
}

const RECIPES = {
  tisch: tischRecipe, ocean: oceanRecipe, bruecke: brueckeRecipe, programmheft: programmheftRecipe,
  forest: forestRecipe,
};

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
    // Two frames after the fonts as well: on Linux Chromium a capture right
    // after a viewport CHANGE (192 -> 512) still painted the old height's
    // layout, the ground restarting 438px down (#1475).
    expression: 'document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))'
      + '.then(() => [...document.fonts].filter((f) => f.status === "loaded").length)',
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
