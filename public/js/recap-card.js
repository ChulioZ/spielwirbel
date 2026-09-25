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
      CROSS-ORIGIN IS NOT THE ONLY WAY TO TAINT: WebKit also taints on a
      createPattern() built from an SVG image, however same-origin — see
      .claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md.
   2. Wait for document.fonts.ready before drawing. The app's own woff2 faces
      load with `font-display: swap`; a canvas drawn before they resolve renders
      in a fallback face and looks subtly wrong rather than broken.
   3. Draw at 2x into the backing store and scale the context, or the card is
      soft on a phone screenshot.

   The palette is read from the LIVE custom properties, so the card shares in
   the colours of the design the page wears rather than in a fixed orange. Only
   the raw tokens are read — the derived ones are color-mix() values a canvas
   cannot parse — and the tints are composited here instead.

   Load order: see index.html. */

'use strict';

// Logical width. The HEIGHT is computed per model (recapCardHeight below), not
// fixed: a quiet month produces two blocks where a busy one produces four, and
// under a fixed height the difference lands as a growing hole above the
// wordmark — which on an image someone posts into a chat reads as a rendering
// fault rather than as a small month.
const RECAP_CARD_W = 540;
const RECAP_CARD_PAD = 40;
// The marker bar along the card's head (#1187). Under the card's own padding, so
// nothing has to move to make room for it.
const RECAP_CARD_MARKER_H = 8;
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
  if (!v) return null;
  const ctx = document.createElement('canvas').getContext('2d');
  // No 2d context at all (jsdom, where the specs run): fall back to accepting a
  // plainly-written colour, which is what this did before #904. Without this the
  // harness would report every token as unresolvable and quietly measure the
  // fallbacks — a green run over a card nobody had actually checked.
  if (!ctx) return /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(v) ? v : null;
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

/* The round's marker, or null (#1187). Read off the ROOT's custom property
   rather than through recapToken(): `color: var(--marker)` with the property
   unset is invalid-at-computed-value-time, so the probe would inherit the page's
   ink and hand back a plausible, wrong marker. getPropertyValue answers '' for
   "not set", which is the distinction this needs — and null is a real answer
   here: a card drawn outside a round (the account's own recap) has no marker. */
function recapMarker() {
  const root = getComputedStyle(document.documentElement);
  const color = recapColor(root.getPropertyValue('--marker').trim());
  const deep = recapColor(root.getPropertyValue('--marker-deep').trim());
  return color ? { color, deep: deep || color } : null;
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

// The display stack follows the worn design: the card says so in the same face
// the screen does. Read off the live token rather than restated. A canvas
// accepts the whole family list.
function recapDisplayStack() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim();
  return v || '"Baloo 2", "Nunito", sans-serif';
}
const recapFont = (weight, size, display) =>
  `${weight} ${size}px ${display ? recapDisplayStack() : '"Nunito", sans-serif'}`;

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
//
// The shelf entries and the two row labels come FROM THE MODEL (#1147), so one
// renderer draws both cards: the round's recap passes its three shelf numbers
// under „Regal", the account's own recap passes „neu ausprobiert" under its own
// label and names its rated row after the account's own rating rather than the
// group's score. The defaults are the round card's, so a model that says
// nothing about them draws exactly what it always did.
function recapCardBlocks(model) {
  const rows = [];
  if (model.played && model.played.length) {
    rows.push({ label: t('pokale.mostPlayed'), value: model.played.join(' · '), sub: model.playedSub });
  }
  if (model.rated && model.rated.length) {
    rows.push({ label: model.ratedLabel || t('pokale.bestRated'), value: model.rated.join(' · '), sub: model.ratedScore });
  }
  const shelf = (Array.isArray(model.shelf) ? model.shelf : []).filter((s) => s.n > 0);
  return { rows, shelf, shelfLabel: model.shelfLabel || t('periodRecap.label.shelf') };
}

// The round recap's three shelf numbers, in the shape `recapCardBlocks` takes.
// Shared by both designs' cards (recap-card-tisch.js reads it too), so the
// round card cannot grow a fourth entry on one design only.
function recapShelfEntries(rec) {
  return [
    { n: rec.added, label: t('periodRecap.label.added'), plus: true },
    { n: rec.retired, label: t('periodRecap.label.retired') },
    { n: rec.completed, label: t('periodRecap.label.completed') },
  ];
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
// { heading, periodLabel, sessions, gamesPlayed, played: [titles], playedSub,
//   rated: [titles], ratedScore, ratedLabel?, shelf: [{ n, label, plus }],
//   shelfLabel? }. `heading` is the top line — the round's name on the
// Chronik's card, the username on the account's own (#1147); it was
// `roundName` until the second caller made that name a lie.
function drawRecapCard(ctx, model, height) {
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
  // The round's marker along the card's head (#1187) — the fourth surface it
  // paints, and the one that leaves the app: whoever receives the image sees the
  // same colour the round wears on screen. Full-bleed rather than inset, so it
  // reads as the card's edge rather than as a stray rule.
  const marker = recapMarker();
  if (marker) {
    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, marker.color);
    bar.addColorStop(1, marker.deep);
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, W, RECAP_CARD_MARKER_H);
  }

  let y = pad + 26;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = p.inkSoft;
  ctx.font = recapFont(600, 16);
  ctx.fillText(recapFit(ctx, model.heading, inner), pad, y);

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
  const { rows, shelf, shelfLabel } = recapCardBlocks(model);
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
    ctx.fillText(recapFit(ctx, shelfLabel.toUpperCase(), inner - 40), pad + 20, y + 26);
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
  // A design with a card of its own draws that instead (#1199) — Der Tisch's
  // felt-headed card, recap-card-tisch.js. Same model, same caller, same
  // catch; everything below is the classic card, unchanged.
  if (designCard() === 'tisch') return tischCardBlob('period', model);
  // Constraint 2 — see the header. `document.fonts` is present in every browser
  // this app supports; the guard is for a stray environment without it.
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  // A display face that no DOM node has painted yet is declared but not loaded,
  // and ctx.font never loads one. load() takes the same shorthand and resolves
  // once every face in the stack that has an @font-face is usable; a face that
  // cannot load leaves the card in the fallback rather than failing the share.
  if (document.fonts && document.fonts.load) {
    try { await document.fonts.load(recapFont(700, 30, true)); } catch { /* fallback face */ }
  }
  const scale = 2; // constraint 3
  const height = recapCardHeight(model);
  const canvas = document.createElement('canvas');
  canvas.width = RECAP_CARD_W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  drawRecapCard(ctx, model, height);
  return new Promise((resolve, reject) => {
    // Nothing cross-origin is ever drawn (constraint 1), so toBlob cannot taint
    // — but it still answers null on an out-of-memory canvas.
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
