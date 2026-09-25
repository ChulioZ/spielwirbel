/* Spielwirbel – the Regal-Steckbrief as a shareable image (#1173).

   One portrait card: the round's name, the bands as horizontal bars, the
   leading mechanics and categories, and the gaps. Drawn on the device and handed
   to the user's own share sheet (or saved) by shareShelfProfile in
   views-shelf-profile.js — nothing is uploaded, the same trust shape as the
   period recap's card.

   Two looks, chosen at click time: Der Tisch paints from its own token COPY
   (TISCH_CARD_TOKENS, recap-card-tisch.js) with the round's felt as the head,
   and every other design reads the live palette the way the classic recap card
   does (recapPalette, recapMarker). The worlds get no ornaments here on purpose:
   they are being retired by the flip (#1202), and their SVG masks are exactly
   what WebKit taints a canvas on (.claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md).

   So the constraints recap-card-tisch.js lists hold in full, and are simpler to
   keep here because nothing tempts breaking them:
   1. NO COVER ART, NO SVG, NO PATTERN. Every surface is a flat fill or a rounded
      rect; the one image is the same-origin „Powered by BGG" PNG via drawImage —
      a licence condition wherever BGG data appears, and every band on this card
      is BGG data.
   2. NO ICON FONT. A canvas never loads a font, so no glyph is drawn at all.
   3. 2x backing store, and the text faces asked for before the first fillText.

   No module.exports — DOM/canvas code, exercised through the jsdom harness by
   test/shelf-profile-view.test.js with a recording context
   (.claude/rules/frontend-helper-modules-and-coverage.md). Load order: after
   recap-card.js and recap-card-tisch.js, whose helpers it calls at click time. */

'use strict';

const SHELF_CARD_W = 540;
const SHELF_CARD_SCALE = 2;
const SHELF_CARD_PAD = 30;
const SHELF_CARD_HEAD_H = 150;
const SHELF_CARD_ROW_H = 26;
const SHELF_CARD_LIST_ROW_H = 21;
const SHELF_CARD_GAP = 14;
const SHELF_CARD_FOOT_H = 64;
// Lines of gaps the image carries. The screen lists them all; a picture posted
// into a chat has to stay a picture.
const SHELF_CARD_MAX_GAPS = 4;

// The colours, per look. Klassisch keeps its head on the page colour with the
// round's marker as a strip — white text on an arbitrary marker is a contrast
// bet this card has no reason to make.
function shelfCardPalette() {
  if (designCard() === 'tisch') {
    const p = tischPalette();
    const felt = tischCardFelts(1)[0];
    return {
      tisch: true, bg: p['page-bg'], head: felt.color, headDeep: felt.deep, edge: p['gold-deep'],
      headInk: p['felt-ink'], headSoft: p['felt-ink-soft'], panel: p.paper, ink: p['paper-ink'],
      inkSoft: p['paper-ink-soft'], track: p['paper-raised'], bar: p.felt, gapInk: p['score-1'],
      footInk: p['ink-soft'], badge: p.paper,
    };
  }
  const c = recapPalette();
  const m = recapMarker();
  return {
    tisch: false, bg: c.bg, head: null, marker: m ? m.color : c.brand, headInk: c.ink, headSoft: c.brand,
    panel: c.surface, ink: c.ink, inkSoft: c.inkSoft, track: c.bg, bar: c.brand, gapInk: c.brand,
    footInk: c.inkSoft, badge: '#ffffff',
  };
}

const shelfCardFont = (pal, weight, size, display) =>
  (pal.tisch ? tischFont(weight, size, display) : recapFont(weight, size, display));

// Height of each block, shared by the measuring and the drawing pass.
const shelfDimH = (dim) => 44 + dim.rows.length * SHELF_CARD_ROW_H + 12;
function shelfListsH(model) {
  if (!model.lists.length) return 0;
  const rows = Math.max(...model.lists.map((l) => l.items.length));
  return 42 + rows * SHELF_CARD_LIST_ROW_H + 12;
}
const shelfGapsH = (model) => (model.gaps.length
  ? 42 + Math.min(model.gaps.length, SHELF_CARD_MAX_GAPS) * SHELF_CARD_LIST_ROW_H + 12 : 0);

function shelfCardHeight(model) {
  let h = SHELF_CARD_HEAD_H + SHELF_CARD_GAP + 6;
  model.dims.forEach((d) => { h += shelfDimH(d) + SHELF_CARD_GAP; });
  const lists = shelfListsH(model);
  if (lists) h += lists + SHELF_CARD_GAP;
  const gaps = shelfGapsH(model);
  if (gaps) h += gaps + SHELF_CARD_GAP;
  return h + SHELF_CARD_FOOT_H;
}

function shelfRect(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function drawShelfHead(ctx, model, pal) {
  const pad = SHELF_CARD_PAD;
  if (pal.tisch) {
    shelfRect(ctx, 0, 0, SHELF_CARD_W, SHELF_CARD_HEAD_H, 0, pal.head);
    ctx.fillStyle = pal.edge;
    ctx.fillRect(0, SHELF_CARD_HEAD_H, SHELF_CARD_W, 6);
  } else {
    ctx.fillStyle = pal.marker;
    ctx.fillRect(0, 0, SHELF_CARD_W, 8);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.headSoft;
  ctx.font = shelfCardFont(pal, 800, 14);
  ctx.fillText(recapFit(ctx, model.title.toLocaleUpperCase(), SHELF_CARD_W - pad * 2), pad, 52);
  ctx.fillStyle = pal.headInk;
  ctx.font = shelfCardFont(pal, 800, 32, true);
  ctx.fillText(recapFit(ctx, model.roundName, SHELF_CARD_W - pad * 2), pad, 94);
  ctx.fillStyle = pal.tisch ? pal.headSoft : pal.inkSoft;
  ctx.font = shelfCardFont(pal, 600, 14);
  ctx.fillText(recapFit(ctx, model.basis, SHELF_CARD_W - pad * 2), pad, 124);
}

// One dimension: its title and a bar per band, the count at the right. A band
// under the gap threshold draws its count in the gap colour, so the picture
// says what the screen says without a legend.
function drawShelfDim(ctx, dim, y, pal) {
  const pad = SHELF_CARD_PAD;
  const w = SHELF_CARD_W - pad * 2;
  shelfRect(ctx, pad, y, w, shelfDimH(dim), 14, pal.panel);
  ctx.fillStyle = pal.ink;
  ctx.font = shelfCardFont(pal, 800, 15, true);
  ctx.fillText(recapFit(ctx, dim.title, w - 32), pad + 16, y + 28);
  const labelW = 130;
  const trackX = pad + 16 + labelW;
  const trackW = w - 32 - labelW - 40;
  dim.rows.forEach((row, i) => {
    const ry = y + 44 + i * SHELF_CARD_ROW_H;
    ctx.fillStyle = pal.inkSoft;
    ctx.font = shelfCardFont(pal, 700, 13);
    ctx.textAlign = 'left';
    ctx.fillText(recapFit(ctx, row.label, labelW - 8), pad + 16, ry + 13);
    shelfRect(ctx, trackX, ry + 2, trackW, 12, 6, pal.track);
    const share = dim.known ? row.n / dim.known : 0;
    if (share > 0) shelfRect(ctx, trackX, ry + 2, Math.max(12, trackW * share), 12, 6, pal.bar);
    ctx.fillStyle = row.gap ? pal.gapInk : pal.ink;
    ctx.font = shelfCardFont(pal, 800, 14);
    ctx.textAlign = 'right';
    ctx.fillText(String(row.n), pad + w - 16, ry + 13);
    ctx.textAlign = 'left';
  });
  return y + shelfDimH(dim);
}

// Mechanics and categories side by side, as their plain BGG names — BGG's terms
// allow choosing which of its names to show, never rewriting one.
function drawShelfLists(ctx, model, y, pal) {
  const pad = SHELF_CARD_PAD;
  const w = SHELF_CARD_W - pad * 2;
  const h = shelfListsH(model);
  shelfRect(ctx, pad, y, w, h, 14, pal.panel);
  const colW = (w - 32) / model.lists.length;
  model.lists.forEach((list, c) => {
    const x = pad + 16 + c * colW;
    ctx.fillStyle = pal.ink;
    ctx.font = shelfCardFont(pal, 800, 15, true);
    ctx.fillText(recapFit(ctx, list.title, colW - 12), x, y + 28);
    ctx.font = shelfCardFont(pal, 600, 13);
    list.items.forEach((item, i) => {
      ctx.fillStyle = pal.inkSoft;
      ctx.fillText(recapFit(ctx, item, colW - 12), x, y + 50 + i * SHELF_CARD_LIST_ROW_H);
    });
  });
  return y + h;
}

function drawShelfGaps(ctx, model, y, pal) {
  const pad = SHELF_CARD_PAD;
  const w = SHELF_CARD_W - pad * 2;
  const h = shelfGapsH(model);
  shelfRect(ctx, pad, y, w, h, 14, pal.panel);
  ctx.fillStyle = pal.ink;
  ctx.font = shelfCardFont(pal, 800, 15, true);
  ctx.fillText(recapFit(ctx, model.gapsTitle, w - 32), pad + 16, y + 28);
  ctx.font = shelfCardFont(pal, 600, 13);
  model.gaps.slice(0, SHELF_CARD_MAX_GAPS).forEach((line, i) => {
    const ly = y + 50 + i * SHELF_CARD_LIST_ROW_H;
    shelfRect(ctx, pad + 16, ly - 8, 7, 7, 3.5, pal.gapInk);
    ctx.fillStyle = pal.ink;
    ctx.fillText(recapFit(ctx, line, w - 50), pad + 30, ly);
  });
  return y + h;
}

function drawShelfFoot(ctx, height, pal, badge) {
  const pad = SHELF_CARD_PAD;
  ctx.fillStyle = pal.footInk;
  ctx.font = shelfCardFont(pal, 700, 12);
  ctx.textAlign = 'left';
  ctx.fillText('spielwirbel.app', pad, height - 26);
  if (badge && (badge.naturalWidth || badge.width)) {
    const bw = 104;
    const bh = bw * ((badge.naturalHeight || badge.height) / (badge.naturalWidth || badge.width));
    const x = SHELF_CARD_W - pad - bw - 18;
    const y = height - 22 - bh - 10;
    shelfRect(ctx, x, y, bw + 18, bh + 10, 3, pal.badge);
    ctx.drawImage(badge, x + 9, y + 5, bw, bh);
  }
}

function drawShelfCard(ctx, model, height, pal, badge) {
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, SHELF_CARD_W, height);
  drawShelfHead(ctx, model, pal);
  let y = SHELF_CARD_HEAD_H + SHELF_CARD_GAP + 6;
  model.dims.forEach((d) => { y = drawShelfDim(ctx, d, y, pal) + SHELF_CARD_GAP; });
  if (model.lists.length) y = drawShelfLists(ctx, model, y, pal) + SHELF_CARD_GAP;
  if (model.gaps.length) drawShelfGaps(ctx, model, y, pal);
  drawShelfFoot(ctx, height, pal, badge);
}

/* Render the card to a PNG Blob. Rejects rather than resolving null, so the
   caller's catch — which reports it (reportClientError) — is the one place a
   failure is seen.

   `model` is built by the view in the active locale:
   { roundName, title, basis, dims: [{ title, known, rows: [{ label, n, gap }] }],
     lists: [{ title, items: [string] }], gapsTitle, gaps: [string] } */
async function shelfProfileCardBlob(model) {
  const pal = shelfCardPalette();
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all([shelfCardFont(pal, 800, 32, true), shelfCardFont(pal, 700, 13)].map((f) => document.fonts.load(f)));
    } catch { /* a face that cannot load leaves the card in the fallback */ }
  }
  const badge = await tischBadge();
  const height = shelfCardHeight(model);
  const canvas = document.createElement('canvas');
  canvas.width = SHELF_CARD_W * SHELF_CARD_SCALE;
  canvas.height = height * SHELF_CARD_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SHELF_CARD_SCALE, SHELF_CARD_SCALE);
  drawShelfCard(ctx, model, height, pal, badge);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
