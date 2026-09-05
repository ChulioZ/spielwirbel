/* Spielwirbel – the shareable period-recap card (#800): the canvas behind the
   Pokale tab's „Teilen" button, rendered to a PNG the user hands to whoever
   they choose.

   Deliberately NOT a pure module with a module.exports guard, unlike its
   sibling period-recap.js: this is DOM/canvas code verified in a browser, and
   exporting it would only add an uncoverable file to the coverage report
   (.claude/rules/frontend-helper-modules-and-coverage.md). For the same reason
   it calls t() directly, as every views-*.js does, rather than taking the
   translate functions as arguments the way the testable session-share.js has to.

   THREE constraints here are not stylistic, and each fails in its own quiet way:

   1. NO COVER ART, ever. Provider covers are hotlinked and may not be
      redistributed (.claude/rules/provider-cover-hotlinking.md, and
      session-share.js already refuses them for exactly this) — and drawing a
      cross-origin image onto a canvas TAINTS it, so toBlob() then throws a
      SecurityError at export time, long after the code looked fine.
   2. Wait for document.fonts.ready before drawing. The app's own woff2 faces
      load with `font-display: swap`; a canvas drawn before they resolve renders
      in a fallback face and looks subtly wrong rather than broken.
   3. Draw at 2x into the backing store and scale the context, or the card is
      soft on a phone screenshot.

   The palette is read from the LIVE custom properties, so a round with its own
   theme (applyBackground) shares a card in its own colours rather than in the
   default orange. Only the raw tokens are read — the derived ones are
   color-mix() values a canvas cannot parse — and the tints are composited here
   instead. A WORLD (#903) reaches the card the same way: its display face is
   whatever --font-display resolves to, and its backdrop motif and button frame
   are the SVG masks the world's token block declares in styles.css, drawn here
   in the accent. A data: URI is same-origin, so drawing it taints nothing —
   constraint 1 holds. Constraint 2 grows a half: a canvas ctx.font never
   TRIGGERS a font load, so a world face no DOM node has painted yet would draw
   in a fallback; recapCardBlob asks for it explicitly.

   Load order: see index.html. */

'use strict';

// Logical width. The HEIGHT is computed per model (recapCardHeight below), not
// fixed: a quiet month produces two blocks where a busy one produces four, and
// under a fixed height the difference lands as a growing hole above the
// wordmark — which on an image someone posts into a chat reads as a rendering
// fault rather than as a small month.
const RECAP_CARD_W = 540;
const RECAP_CARD_PAD = 40;
// Block geometry, shared by the measuring pass and the drawing pass so the two
// cannot disagree about where the card ends.
const RECAP_CARD_GAP = 14;
const RECAP_CARD_TILE_H = 104;
const RECAP_CARD_ROW_H = 82;
const RECAP_CARD_SHELF_H = 68;

/* Normalize any CSS colour to what a canvas will actually paint, or null.

   Canvas treats an unparseable fillStyle as "keep the previous one", so a bad
   value paints the last colour used rather than failing — which is why this
   asks the question with TWO sentinels instead of pattern-matching the string.
   If the value parses, both assignments land on it and agree; if it does not,
   each sentinel survives and they differ. That is exact where a regex is a
   guess, and it returns the normalized `#rrggbb` as a bonus. */
function recapColor(v) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx || !v) return null;
  ctx.fillStyle = '#000000';
  ctx.fillStyle = v;
  const a = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = v;
  return a === ctx.fillStyle ? a : null;
}

/* One custom property off the document, as a colour the canvas can use.

   Custom properties are substitution-only, so getPropertyValue() hands back the
   UNRESOLVED text: since #904 `--surface` is a color-mix() under a dark design,
   and the card would have quietly fallen back to white — a white panel on a
   night-blue card, with nothing to say so. Painting the token on a throwaway
   span and reading the computed `color` back is the one way to get the value
   the browser resolved (.claude/rules/color-mix-interpolation-space.md). */
function recapToken(name, fallback) {
  const raw = recapColor(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  if (raw) return raw;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0';
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const resolved = recapColor(getComputedStyle(probe).color);
  probe.remove();
  return resolved || fallback;
}

function recapPalette() {
  return {
    bg: recapToken('--page-bg', '#f4f1ea'),
    surface: recapToken('--surface', '#ffffff'),
    brand: recapToken('--brand', '#c2410c'),
    ink: recapToken('--ink', '#2b2620'),
    inkSoft: recapToken('--ink-soft', '#6b6358'),
  };
}

// Trim to fit, with a real ellipsis rather than a hard cut — a long game title
// is the normal case, not an edge one.
function recapFit(ctx, text, maxWidth) {
  const s = String(text == null ? '' : text);
  if (ctx.measureText(s).width <= maxWidth) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(s.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo).trimEnd() + '…';
}

// The display stack follows the round's design: a world puts its own face in
// front of --font-display, and the card has to say so in the same face the
// screen does. Read off the live token rather than restated — a literal
// "Baloo 2" here is how the card would keep the standard face inside a Forest
// round with no error anywhere. A canvas accepts the whole family list.
function recapDisplayStack() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim();
  return v || '"Baloo 2", "Nunito", sans-serif';
}
const recapFont = (weight, size, display) =>
  `${weight} ${size}px ${display ? recapDisplayStack() : '"Nunito", sans-serif'}`;

// One of the world's SVG masks (the token block in styles.css), decoded to an
// Image — or null when the round has no world, which is the common case and
// costs one computed-style read. The mask is a black silhouette; recapTint
// gives it a colour.
function recapWorldMask(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // The URI holds quotes of the OTHER kind and parentheses (SVG transforms),
  // so only the enclosing quote may end the match — never a ')' inside.
  const m = /^url\((["'])(data:image\/svg\+xml.*)\1\)$/.exec(v);
  if (!m) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = m[2];
  });
}

// The silhouette painted in `color`, at `scale` for the 2x backing store:
// tile (or stretch) it onto a scratch canvas, then keep the colour only where
// the silhouette is (source-in). Returned as a canvas the caller drawImage()s.
function recapTint(mask, w, h, color, scale, tile) {
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);
  if (tile) {
    g.fillStyle = g.createPattern(mask, 'repeat');
    g.fillRect(0, 0, w, h);
  } else {
    g.drawImage(mask, 0, 0, w, h);
  }
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  return c;
}

// A rounded panel; the app's own cards are 16px-radius surfaces on the page.
function recapPanel(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 16);
  ctx.fill();
}

// Which optional blocks this model produces. Both passes read it, so the height
// and the drawing can never disagree about where the card ends. Shelf numbers
// that are zero are dropped — "0 aussortiert" is noise, the same call the
// all-time Rückblick makes for its archive chip.
function recapCardBlocks(model) {
  const rows = [];
  if (model.played && model.played.length) {
    rows.push({ label: t('pokale.mostPlayed'), value: model.played.join(' · '), sub: model.playedSub });
  }
  if (model.rated && model.rated.length) {
    rows.push({ label: t('pokale.bestRated'), value: model.rated.join(' · '), sub: model.ratedScore });
  }
  const shelf = [
    { n: model.added, label: t('periodRecap.label.added'), plus: true },
    { n: model.retired, label: t('periodRecap.label.retired') },
    { n: model.completed, label: t('periodRecap.label.completed') },
  ].filter((s) => s.n > 0);
  return { rows, shelf };
}

// How tall this card has to be. The trailing term is the wordmark's own line
// plus the breathing space above it, which is what keeps a two-block card and a
// four-block card looking like the same design.
function recapCardHeight(model) {
  const { rows, shelf } = recapCardBlocks(model);
  let h = RECAP_CARD_PAD + 26 + 44 + 26 + RECAP_CARD_TILE_H + RECAP_CARD_GAP;
  h += rows.length * (RECAP_CARD_ROW_H + RECAP_CARD_GAP);
  if (shelf.length) h += RECAP_CARD_SHELF_H + RECAP_CARD_GAP;
  return h + 24 + 20 + RECAP_CARD_PAD;
}

// `model` is what the view already computed for the screen:
// { roundName, periodLabel, sessions, gamesPlayed, played: [titles],
//   playedCount, rated: [titles], ratedScore, added, retired, completed }.
// `world` is { backdrop, frame, scale } — the two masks (either may be null)
// loaded by recapCardBlob before this synchronous pass, and the backing-store
// scale the tints are rendered at.
function drawRecapCard(ctx, model, height, world = {}) {
  const p = recapPalette();
  const W = RECAP_CARD_W;
  const pad = RECAP_CARD_PAD;
  const inner = W - pad * 2;

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, height);
  // The page's own accent halo at the top (--page-glow), composited here since
  // its token is a color-mix().
  const glow = ctx.createLinearGradient(0, 0, 0, 240);
  glow.addColorStop(0, p.brand);
  glow.addColorStop(1, p.bg);
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 240);
  ctx.globalAlpha = 1;
  // The world's backdrop across the same band the glow covers, and its button
  // frame at the card's corners — the same two marks the screen shows.
  const scale = world.scale || 1;
  if (world.backdrop) {
    // .09, the page's own backdrop budget: the round name is --ink-soft on this
    // band, and at .12 it drops under 4.5:1 on the motif's densest pixel.
    ctx.globalAlpha = 0.09;
    ctx.drawImage(recapTint(world.backdrop, W, 240, p.brand, scale, true), 0, 0, W, 240);
    ctx.globalAlpha = 1;
  }
  if (world.frame) {
    const fw = 110;
    const fh = 70;
    const frame = recapTint(world.frame, fw, fh, p.brand, scale, false);
    ctx.drawImage(frame, 8, 8, fw, fh);
    ctx.save();
    ctx.translate(W - 8, height - 8);
    ctx.rotate(Math.PI);
    ctx.drawImage(frame, 0, 0, fw, fh);
    ctx.restore();
  }

  let y = pad + 26;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = p.inkSoft;
  ctx.font = recapFont(600, 16);
  ctx.fillText(recapFit(ctx, model.roundName, inner), pad, y);

  y += 44;
  ctx.fillStyle = p.brand;
  ctx.font = recapFont(700, 34, true);
  ctx.fillText(recapFit(ctx, model.periodLabel, inner), pad, y);

  // Two headline numbers, side by side.
  y += 26;
  const gap = RECAP_CARD_GAP;
  const tileW = (inner - gap) / 2;
  const tileH = RECAP_CARD_TILE_H;
  [
    { n: model.sessions, label: t('periodRecap.label.sessions') },
    { n: model.gamesPlayed, label: t('periodRecap.label.gamesPlayed') },
  ].forEach((tile, i) => {
    const x = pad + i * (tileW + gap);
    recapPanel(ctx, x, y, tileW, tileH, p.surface);
    ctx.fillStyle = p.brand;
    ctx.font = recapFont(700, 44, true);
    ctx.fillText(String(tile.n), x + 20, y + 62);
    ctx.fillStyle = p.inkSoft;
    ctx.font = recapFont(600, 14);
    ctx.fillText(recapFit(ctx, tile.label, tileW - 40), x + 20, y + 86);
  });
  y += tileH + gap;

  // One row per named stat, each a panel with a label and its games.
  const { rows, shelf } = recapCardBlocks(model);
  rows.forEach((row) => {
    const rowH = RECAP_CARD_ROW_H;
    recapPanel(ctx, pad, y, inner, rowH, p.surface);
    ctx.fillStyle = p.inkSoft;
    ctx.font = recapFont(600, 13);
    ctx.fillText(recapFit(ctx, row.label.toUpperCase(), inner - 40), pad + 20, y + 28);
    ctx.fillStyle = p.ink;
    ctx.font = recapFont(700, 22, true);
    const subW = row.sub ? ctx.measureText(row.sub).width : 0;
    ctx.fillText(recapFit(ctx, row.value, inner - 52 - subW), pad + 20, y + 58);
    if (row.sub) {
      ctx.fillStyle = p.brand;
      ctx.textAlign = 'right';
      ctx.fillText(row.sub, pad + inner - 20, y + 58);
      ctx.textAlign = 'left';
    }
    y += rowH + gap;
  });

  if (shelf.length) {
    const rowH = RECAP_CARD_SHELF_H;
    recapPanel(ctx, pad, y, inner, rowH, p.surface);
    ctx.fillStyle = p.inkSoft;
    ctx.font = recapFont(600, 13);
    ctx.fillText(t('periodRecap.label.shelf').toUpperCase(), pad + 20, y + 26);
    ctx.fillStyle = p.ink;
    ctx.font = recapFont(600, 17);
    ctx.fillText(
      recapFit(ctx, shelf.map((s) => `${s.plus ? '+' : ''}${s.n} ${s.label}`).join('   ·   '), inner - 40),
      pad + 20,
      y + 52
    );
    y += rowH + gap;
  }

  // Wordmark, bottom-left, so a card that travels through three chats still
  // says where it came from.
  ctx.fillStyle = p.brand;
  ctx.font = recapFont(700, 20, true);
  ctx.fillText('Spielwirbel', pad, height - pad);
  ctx.fillStyle = p.inkSoft;
  ctx.font = recapFont(600, 13);
  ctx.textAlign = 'right';
  ctx.fillText(recapFit(ctx, 'spielwirbel.app', inner / 2), W - pad, height - pad);
  ctx.textAlign = 'left';
}

// Render the card to a PNG Blob. Rejects rather than resolving null, so the
// caller's catch is the one place a failure is reported.
async function recapCardBlob(model) {
  // Constraint 2 — see the header. `document.fonts` is present in every browser
  // this app supports; the guard is for a stray environment without it.
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  // A world face that no DOM node has painted yet is declared but not loaded,
  // and ctx.font never loads one. load() takes the same shorthand and resolves
  // once every face in the stack that has an @font-face is usable; a face that
  // cannot load leaves the card in the fallback rather than failing the share.
  if (document.fonts && document.fonts.load) {
    try { await document.fonts.load(recapFont(700, 30, true)); } catch { /* fallback face */ }
  }
  const scale = 2; // constraint 3
  const [backdrop, frame] = await Promise.all([recapWorldMask('--world-backdrop'), recapWorldMask('--world-frame')]);
  const height = recapCardHeight(model);
  const canvas = document.createElement('canvas');
  canvas.width = RECAP_CARD_W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  drawRecapCard(ctx, model, height, { backdrop, frame, scale });
  return new Promise((resolve, reject) => {
    // Nothing cross-origin is ever drawn (constraint 1), so toBlob cannot taint
    // — but it still answers null on an out-of-memory canvas.
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
