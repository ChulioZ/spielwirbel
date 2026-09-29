/* Spielwirbel – Die Brücke's shareable card (#1247), from
   docs/design/bruecke/Bruecke-B8-Farben.dc.html (B8.4 „Die Rückblickkarte").

   ONE format: the period recap, square for messengers. The results screen keeps
   the text share while Die Brücke is worn (shareResultCard) — B8.4 draws no
   session card.

   DRAWN AT 600x600, EXPORTED AT 1080x1080 (x1.8), AND THE EXPORTED SIZE IS WHAT
   THE RULES APPLY TO. The first package measured its own „no text under 24 px"
   rule against the drawing and nineteen nodes broke it. So every size below is
   a DRAWN size, and the smallest is 14 px, which exports at 25.2 px:

     round name        50 -> 90     the four figures   38 -> 68
     most played       24 -> 43     wordmark           16 -> 29
     kicker, labels, month letters  14 -> 25.2

   test/recap-card-bruecke.test.js reads every font the drawing sets and fails
   on one that exports under 24 px, so a new string cannot slip under the floor.

   WHAT NEVER GOES ON THE CARD (B8.4, a privacy commitment, not styling): no
   faces, no profile pictures, no e-mail or account name beyond the heading the
   caller already chose, no invitation link, no cover art (image rights are not
   ours, and a cross-origin cover would taint the canvas). Only the round, the
   period, four figures, the monthly bars and the most-played game — the numbers
   the section above the share button is showing (#526's rule).

   THE CANVAS STAYS CLEAN IN WEBKIT. No pattern anywhere — WebKit taints a canvas
   on a createPattern() built from an SVG image and toBlob() then throws, for
   every Safari and iOS visitor (.claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md).
   B8.4's dot grid is a CSS background there; here it is plain arcs. The corner
   brackets are strokes, the wordmark's lamp is a filled rect with a canvas
   shadow, and the one image is the same-origin BGG badge via drawImage. No icon
   font either.

   Colours are Die Brücke's tokens as a COPY (BRUECKE_CARD_TOKENS), licensed by
   the parity test against test/support/theme.js — the TISCH_CARD_TOKENS shape
   and reason (.claude/rules/shared-constants-across-the-stack.md): the token
   names are shared by every design, so a live read under another design's
   cascade would paint that design's colours under this layout.

   No module.exports — DOM/canvas code, reached through the jsdom harness. Load
   order: after recap-card.js (recapFit, recapCardBlocks) and recap-card-tisch.js
   (tischWrap, tischBadge). */

'use strict';

const BRUECKE_CARD_SIZE = 600;     // drawn
const BRUECKE_CARD_SCALE = 1.8;    // -> 1080 exported
const BRUECKE_CARD_PAD = 38;

// Die Brücke's tokens, keyed by their name in bruecke.css (see the header for
// why a copy). `--page-bg` and `--brand` are the registry's `page` and
// `accent`, which paintDesign writes and the test resolves the same way.
const BRUECKE_CARD_TOKENS = {
  '--page-bg': '#070b14', '--page-hi': '#10203a', '--surface': '#0e1626',
  '--line': '#24324a', '--ink': '#dfe7f5', '--ink-soft': '#9aa8c0', '--brand': '#35e0ff',
};

// B8.4's dot grid: the accent at this alpha, every 28 px, fading out from the
// middle of the upper card. The spec measures every ink over a dot at FULL
// strength on the light stop, the worst ground any string here can sit on.
const BRUECKE_CARD_DOT_ALPHA = 0.14;

// Every ink the card writes text in, and what it is written on. Data rather
// than prose so the spec can measure each pair (>= 4.5:1) — and so a string in
// a colour nobody measured fails the drawing test (it checks every fillText's
// fillStyle against this list).
const BRUECKE_CARD_TEXT = [
  { ink: '--ink', on: '--page-hi' }, { ink: '--ink', on: '--page-bg' }, { ink: '--ink', on: '--surface' },
  { ink: '--ink-soft', on: '--page-hi' }, { ink: '--ink-soft', on: '--page-bg' }, { ink: '--ink-soft', on: '--surface' },
  { ink: '--brand', on: '--page-hi' }, { ink: '--brand', on: '--page-bg' }, { ink: '--brand', on: '--surface' },
];

function brueckePalette() {
  const p = {};
  for (const [name, value] of Object.entries(BRUECKE_CARD_TOKENS)) p[name.slice(2)] = value;
  return p;
}

const brueckeFont = (weight, size, face) => {
  if (face === 'mono') return `${weight} ${size}px "IBM Plex Mono", ui-monospace, monospace`;
  if (face === 'display') return `${weight} ${size}px "Chakra Petch", "IBM Plex Sans", sans-serif`;
  return `${weight} ${size}px "IBM Plex Sans", sans-serif`;
};

// A hex token with an alpha, for the dot grid and nothing else.
function brueckeAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ---------------------------------------------------------------- the model */

// The card's content as plain data — the one pass both the drawing and the
// spec read. The model is the period recap's (recap-card.js): the round's
// Chronik and the account's profile both hand it over.
function brueckeCardSpec(model) {
  const blocks = recapCardBlocks(model);
  // The four figures (B8.4 „die vier Zahlen"): the two counts, the best-rated
  // game named with its score, then the shelf — in that order, four at most.
  // A count carries no leading zero; the score is the caller's own formatted
  // string (fmtAvg: one decimal, a comma where the locale has one).
  const figures = [
    { value: String(Number(model.sessions) || 0), label: t('periodRecap.label.sessions'), accent: false },
    { value: String(Number(model.gamesPlayed) || 0), label: t('periodRecap.label.gamesPlayed'), accent: false },
  ];
  if (model.rated && model.rated.length) {
    figures.push({
      value: model.rated.join(' · '),
      label: [model.ratedLabel || t('pokale.bestRated'), model.ratedScore].filter(Boolean).join(' · '),
      accent: true,
    });
  }
  blocks.shelf.forEach((s) => figures.push({ value: `${s.plus ? '+' : ''}${s.n}`, label: s.label, accent: true }));

  // The bars: a year's twelve months (periodMonths), each labelled with its
  // narrow month name. A month period, or a year without a played session,
  // has no chart to draw.
  const monthly = Array.isArray(model.monthly) ? model.monthly : [];
  const bars = monthly.length && monthly.some((m) => m.count > 0)
    ? monthly.map((m) => ({
      count: m.count,
      month: new Date(m.at).toLocaleString(localeTag(locale), { month: 'narrow' }),
    }))
    : null;

  return {
    kicker: t('periodRecap.entry', { period: model.periodLabel || '' }),
    title: model.heading || '',
    figures: figures.slice(0, 4),
    bars,
    barsLabel: t('periodRecap.card.perMonth'),
    played: model.played && model.played.length
      ? { label: t('pokale.mostPlayed'), value: [model.played.join(' · '), model.playedSub].filter(Boolean).join(' · ') }
      : null,
  };
}

/* ------------------------------------------------------------------ drawing */

// Width of `text` drawn with `track` px between letters (ctx.letterSpacing is
// not in every WebKit this app supports, so tracking is drawn letter by letter).
function brueckeTrackedWidth(ctx, text, track) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width;
  return w + Math.max(0, [...text].length - 1) * track;
}

/* Tracked capitals at (x, y), in the current font: B1's notation voice. Within
   `maxW`, stepping the tracking down before cutting — B16.4's long-language
   rule (.16em -> .06em) — and only then ellipsizing. `align` 'right' puts the
   run's right edge at x. Returns the drawn width. */
function brueckeCaps(ctx, text, x, y, maxW, size, em, align) {
  let s = String(text).toUpperCase();
  let track = size * em;
  if (brueckeTrackedWidth(ctx, s, track) > maxW) track = size * 0.06;
  if (brueckeTrackedWidth(ctx, s, track) > maxW) {
    const chars = [...s];
    while (chars.length > 1 && brueckeTrackedWidth(ctx, `${chars.join('')}…`, track) > maxW) chars.pop();
    s = `${chars.join('').trimEnd()}…`;
  }
  const w = brueckeTrackedWidth(ctx, s, track);
  let cx = align === 'right' ? x - w : x;
  for (const ch of s) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
  return w;
}

// Display capitals, stepping down a size before giving up a line, then
// ellipsizing the last one. Returns { lines, size }.
function brueckeTitle(ctx, text, maxW, from, to, maxLines) {
  const caps = String(text).toUpperCase();
  for (let size = from; size >= to; size -= 2) {
    ctx.font = brueckeFont(700, size, 'display');
    const lines = tischWrap(ctx, [{ text: caps, gold: false }], maxW, maxLines);
    const joined = lines && lines.map((l) => l.map((w) => w.text).join(''));
    if (joined && joined.every((l) => ctx.measureText(l).width <= maxW)) return { size, lines: joined };
  }
  ctx.font = brueckeFont(700, to, 'display');
  const all = (tischWrap(ctx, [{ text: caps, gold: false }], maxW, 99) || [[{ text: caps }]])
    .map((l) => l.map((w) => w.text).join(''));
  const kept = all.slice(0, maxLines);
  if (all.length > maxLines) kept[maxLines - 1] = `${kept[maxLines - 1]} ${all.slice(maxLines).join(' ')}`;
  return { size: to, lines: kept.map((l) => recapFit(ctx, l, maxW)) };
}

// One value in the display face, as large as fits `maxW` down to `to`.
function brueckeFitValue(ctx, text, maxW, from, to) {
  for (let size = from; size > to; size -= 2) {
    ctx.font = brueckeFont(700, size, 'display');
    if (ctx.measureText(text).width <= maxW) return { text, size };
  }
  ctx.font = brueckeFont(700, to, 'display');
  return { text: recapFit(ctx, text, maxW), size: to };
}

// The ground: B8.4's radial from the light stop at the top to the night, an
// ellipse 90% wide and 70% tall. A canvas gradient is circular, so the ellipse
// is a circle drawn under a vertical squash.
function brueckeGround(ctx, W, p) {
  ctx.fillStyle = p['page-bg'];
  ctx.fillRect(0, 0, W, W);
  const rx = W * 0.9;
  const ry = W * 0.7;
  ctx.save();
  ctx.translate(W / 2, 0);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, p['page-hi']);
  g.addColorStop(0.75, p['page-bg']);
  g.addColorStop(1, p['page-bg']);
  ctx.fillStyle = g;
  ctx.fillRect(-W, 0, W * 2, W / (ry / rx));
  ctx.restore();
}

// The dot grid: arcs, never a pattern (see the header). Full strength inside
// the inner fifth of an ellipse centred at 50% / 35%, fading to nothing at its
// edge — B8.4's mask-image, evaluated per dot.
function brueckeDots(ctx, W, p) {
  const cx = W / 2;
  const cy = W * 0.35;
  const rx = W * 0.75;
  const ry = W * 0.7;
  for (let y = 14; y < W; y += 28) {
    for (let x = 14; x < W; x += 28) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const k = d <= 0.2 ? 1 : Math.max(0, 1 - (d - 0.2) / 0.8);
      if (k <= 0) continue;
      ctx.fillStyle = brueckeAlpha(p.brand, BRUECKE_CARD_DOT_ALPHA * k);
      ctx.beginPath();
      ctx.arc(x, y, 1.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// The frame, which bounds the card on a light chat ground, and the four corner
// brackets, which carry it on a dark one (B8.4 „Format").
function brueckeFrame(ctx, W, p) {
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, W - 1);
  ctx.strokeStyle = p.brand;
  ctx.lineWidth = 2;
  const i = 23;
  const l = 20;
  for (const [x, y, dx, dy] of [[i, i, 1, 1], [W - i, i, -1, 1], [i, W - i, 1, -1], [W - i, W - i, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * l);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * l, y);
    ctx.stroke();
  }
}

// One of the four figures: a flat plate with its edge, the value in the display
// face, the label in tracked mono below it.
function brueckeFigure(ctx, f, x, y, w, h, p) {
  ctx.fillStyle = p.surface;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const inner = w - 32;
  const v = brueckeFitValue(ctx, f.value, inner, 38, 24);
  ctx.fillStyle = f.accent ? p.brand : p.ink;
  ctx.font = brueckeFont(700, v.size, 'display');
  ctx.fillText(v.text, x + 16, y + 14 + 34);
  ctx.fillStyle = p['ink-soft'];
  ctx.font = brueckeFont(500, 14, 'mono');
  brueckeCaps(ctx, f.label, x + 16, y + h - 14, inner, 14, 0.14);
}

// The bars: one per month, the accent, over its narrow month letter. An empty
// month keeps a 4% sliver so the axis reads as twelve months, as B8.4 draws it.
function brueckeBars(ctx, bars, label, x, y, w, p) {
  ctx.fillStyle = p['ink-soft'];
  ctx.font = brueckeFont(500, 14, 'mono');
  brueckeCaps(ctx, label, x, y + 12, w, 14, 0.16);
  const top = y + 12 + 7;
  const h = 62;
  const gap = 5;
  const bw = (w - gap * (bars.length - 1)) / bars.length;
  const peak = Math.max(...bars.map((b) => b.count), 1);
  const plot = h - 14 - 5;
  ctx.textAlign = 'center';
  bars.forEach((b, i) => {
    const bx = x + i * (bw + gap);
    const bh = Math.max(plot * 0.04, plot * (b.count / peak));
    ctx.fillStyle = p.brand;
    ctx.fillRect(bx, top + plot - bh, bw, bh);
    ctx.fillStyle = p['ink-soft'];
    ctx.font = brueckeFont(400, 14, 'mono');
    ctx.fillText(recapFit(ctx, b.month, bw + gap), bx + bw / 2, top + h - 1);
  });
  ctx.textAlign = 'left';
  return top + h;
}

// The wordmark: the lamp — a lit square with its glow — and SPIELWIRBEL in
// tracked display capitals, both in the accent (B8.4, bottom right). This is
// the design's mark on everything it exports.
function brueckeWordmark(ctx, right, baseline, p) {
  ctx.font = brueckeFont(700, 16, 'display');
  const track = 16 * 0.2;
  const w = brueckeTrackedWidth(ctx, 'SPIELWIRBEL', track);
  const lamp = 9;
  ctx.save();
  ctx.shadowColor = p.brand;
  ctx.shadowBlur = 10;
  ctx.fillStyle = p.brand;
  ctx.fillRect(right - w - 8 - lamp, baseline - 5 - lamp / 2 - 1, lamp, lamp);
  ctx.restore();
  ctx.fillStyle = p.brand;
  brueckeCaps(ctx, 'Spielwirbel', right, baseline, w + 1, 16, 0.2, 'right');
  return w + 8 + lamp;
}

// "Powered by BGG" — a licence requirement wherever BGG data appears, as on the
// other designs' cards. A same-origin PNG, so drawImage leaves the canvas clean.
// Its artwork is drawn for a light ground, so it sits on an ink plate.
function brueckeBadge(ctx, badge, right, top, width, p) {
  if (!(badge && (badge.naturalWidth || badge.width))) return;
  const bh = width * ((badge.naturalHeight || badge.height) / (badge.naturalWidth || badge.width));
  ctx.fillStyle = p.ink;
  ctx.fillRect(right - width - 8, top, width + 8, bh + 4);
  ctx.drawImage(badge, right - width - 4, top + 2, width, bh);
}

function drawBrueckeCard(ctx, spec, badge) {
  const p = brueckePalette();
  const W = BRUECKE_CARD_SIZE;
  const pad = BRUECKE_CARD_PAD;
  const inner = W - pad * 2;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  brueckeGround(ctx, W, p);
  brueckeDots(ctx, W, p);
  brueckeFrame(ctx, W, p);

  const badgeW = 84;
  brueckeBadge(ctx, badge, pad + inner, pad - 2, badgeW, p);

  // Kicker, then the round's name — the one thing people came to read, so it
  // gives up a size before it gives up a line.
  let y = pad + 14;
  ctx.fillStyle = p.brand;
  ctx.font = brueckeFont(500, 14, 'mono');
  brueckeCaps(ctx, spec.kicker, pad, y, inner - badgeW - 20, 14, 0.2);
  y += 16;
  const title = brueckeTitle(ctx, spec.title, inner, 50, 32, 2);
  const lh = Math.round(title.size * 0.98);
  ctx.fillStyle = p.ink;
  ctx.font = brueckeFont(700, title.size, 'display');
  title.lines.forEach((line) => { y += lh; ctx.fillText(line, pad, y - lh * 0.12); });
  y += 20;

  // The figures, two by two.
  const gap = 14;
  const fw = (inner - gap) / 2;
  const fh = 86;
  spec.figures.forEach((f, i) => {
    brueckeFigure(ctx, f, pad + (i % 2) * (fw + gap), y + Math.floor(i / 2) * (fh + gap), fw, fh, p);
  });
  if (spec.figures.length) y += Math.ceil(spec.figures.length / 2) * (fh + gap) - gap;

  if (spec.bars) y = brueckeBars(ctx, spec.bars, spec.barsLabel, pad, y + 20, inner, p);

  // The foot: a hairline, most played on the left, the wordmark on the right.
  const foot = W - pad;
  const footTop = foot - 24 - 3 - 14 - 14;
  ctx.fillStyle = p.line;
  ctx.fillRect(pad, footTop, inner, 1);
  const markW = brueckeWordmark(ctx, pad + inner, foot - 4, p);
  if (spec.played) {
    const room = inner - markW - 20;
    ctx.fillStyle = p['ink-soft'];
    ctx.font = brueckeFont(500, 14, 'mono');
    brueckeCaps(ctx, spec.played.label, pad, foot - 24 - 6, room, 14, 0.14);
    const v = brueckeFitValue(ctx, spec.played.value.toUpperCase(), room, 24, 18);
    ctx.fillStyle = p.ink;
    ctx.font = brueckeFont(700, v.size, 'display');
    ctx.fillText(v.text, pad, foot);
  }
}

// Render the card to a PNG Blob. Rejects rather than resolving null, so the
// caller's catch — which reports to the operator (reportClientError in
// shareRecapCard) as well as toasting — is the one place a failure is seen.
async function brueckeCardBlob(model) {
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all([
        brueckeFont(700, 50, 'display'), brueckeFont(500, 14, 'mono'), brueckeFont(400, 14, 'mono'),
      ].map((f) => document.fonts.load(f)));
    } catch { /* a face that cannot load leaves the card in the fallback */ }
  }
  const spec = brueckeCardSpec(model);
  const badge = await tischBadge();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(BRUECKE_CARD_SIZE * BRUECKE_CARD_SCALE);
  canvas.height = Math.round(BRUECKE_CARD_SIZE * BRUECKE_CARD_SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(BRUECKE_CARD_SCALE, BRUECKE_CARD_SCALE);
  drawBrueckeCard(ctx, spec, badge);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
