/* Spielwirbel – Forest's shareable card (#1475), from
   docs/design/forest/Forest-F8-Farben.dc.html (F8.4 „Rückblickkarte").

   One portrait form, drawn at 540x675 and exported at 1080x1350 (x2), in two
   variants:

   - the RESULT card: the winner's scene of F10.4 in its end state on top — the
     clearing's sky over the meadow, the tree that has grown, the played game's
     box tilted in the grass (a stand-in in the round's marker, never a real
     cover) — and below it, on the opaque card, round · date, the results
     screen's own sentence, the winner in gold-deep with the played game's score,
     the Tafel's first three rows and the screen's fact line;
   - the PERIOD card: the dusk with ONE FIREFLY PER SESSION over a row of tree
     silhouettes, and the facts below it on the card. The dusk is the only place
     a firefly is drawn — on the result card's light sky it would be 1.1:1
     decoration (design-tokens-forest.test.js holds the stylesheet to the same
     rule), so the sheet's eight flies over the clearing are left out.

   THE EXPORTED SIZE IS WHAT THE RULES APPLY TO. The smallest drawn text is
   12px, which is 24px in the image — keep that relationship if anything here
   changes. Young Serif is never drawn under 19px (F1's floor): the rank digits
   1–3 are Alegreya Sans 800, not the sheet's 15px Young Serif (review U3).
   test/recap-card-forest.test.js asserts every font this file sets.

   NO TEXT ON THE IMAGE (F8.4): the marker band hangs on the image's top edge
   and the round's name stands beside it on the card, in the kicker. The spec
   asserts every fillText lands below the image.

   No prose: the card carries structured facts only — the results screen's own
   sentence and its fact line (paintForestFacts, #1468), the Tafel's rows, the
   recap's counts. Nothing here derives a figure the screen does not show.

   The constraints of recap-card.js and recap-card-tisch.js all hold: no cover
   art, no pattern, no SVG (WebKit taints a canvas on a pattern from an SVG
   image — .claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md), no icon
   font. Gradients, rounded rects, ellipses and plain polygon paths; the crown
   and the whirl are Path2D outlines (card-glyphs.js); the one image is the
   same-origin BGG badge via drawImage. Fonts are loaded before the first draw.

   Colours are Forest's tokens as a COPY (FOREST_CARD_TOKENS), licensed by the
   parity test against test/support/theme.js — the TISCH_CARD_TOKENS shape and
   reason (.claude/rules/shared-constants-across-the-stack.md): the token names
   are shared by every design, so a live read under any other cascade would
   paint that design's colours under this layout.

   No module.exports — DOM/canvas code, reached through the jsdom harness. Load
   order: after recap-card.js (recapColor, recapFit, recapMarker,
   recapCardBlocks), recap-card-tisch.js (tischWrap, tischRuns, tischGlyph,
   tischBadge) and recap-card-programmheft.js (programmheftTracked). */

'use strict';

const FOREST_CARD_SCALE = 2;
const FOREST_CARD_W = 540;
const FOREST_CARD_H = 675;
const FOREST_CARD_PAD = 30;
// F8.4: the result's scene is 340px tall, the period's dusk 300px.
const FOREST_CARD_SCENE_H = { session: 340, period: 300 };
const FOREST_CARD_ROWS = 3;
// One firefly per session — but a long year must not turn the dusk into a
// snowstorm, nor push the loop past what a phone draws in a frame. Above this
// the dusk shows this many; the exact count stands in the facts below.
const FOREST_CARD_FLIES_MAX = 60;

// Forest's tokens, keyed by their name in forest.css (see the header for why a
// copy; the parity test is what keeps it one). `--page-bg` and `--brand` are
// the registry's `page` and `accent`. The meadow is F8.4's #c2dc86 -> #9cc38a,
// which forest.css names as the score ramp's stops 4 and 3.
const FOREST_CARD_TOKENS = {
  '--page-bg': '#ecf1e4', '--surface': '#f9fbf4', '--band': '#f3f6ec', '--hatch': '#e9f0df',
  '--ink': '#1b2a18', '--ink-soft': '#4b5c45', '--brand': '#356427', '--line': '#d3dbc8',
  '--on-dusk': '#f4f8ec', '--dusk': '#24331f', '--firefly': '#fff3a8',
  '--gold': '#a86d14', '--gold-deep': '#85570f',
  '--score-1': '#3d5273', '--score-2': '#3b6f6c', '--score-3': '#9cc38a', '--score-4': '#c2dc86',
  '--score-5': '#f1e58c', '--score-veto': '#5b1e3a',
  '--score-ink-low': '#f4f8ec', '--score-ink-high': '#1b2a18', '--score-veto-ink': '#f4f8ec',
  '--bark': '#5a3d24', '--leaf-1': '#446b39', '--leaf-2': '#4f7d40', '--leaf-3': '#6b9a55',
};

// Every ink the card writes text in, and what it is written on — data rather
// than prose, so the spec can measure each pair and check every fillText.
const FOREST_CARD_TEXT = [
  { ink: '--ink', on: '--surface' },
  { ink: '--ink-soft', on: '--surface' },
  { ink: '--brand', on: '--surface' },
  { ink: '--gold-deep', on: '--surface' },
  { ink: '--ink', on: '--page-bg' },
  { ink: '--ink-soft', on: '--page-bg' },
  { ink: '--score-ink-low', on: '--score-1' },
  { ink: '--score-ink-low', on: '--score-2' },
  { ink: '--score-ink-high', on: '--score-3' },
  { ink: '--score-ink-high', on: '--score-4' },
  { ink: '--score-ink-high', on: '--score-5' },
  { ink: '--score-veto-ink', on: '--score-veto' },
];

function forestCardPalette() {
  const p = {};
  for (const [name, value] of Object.entries(FOREST_CARD_TOKENS)) p[name.slice(2)] = value;
  return p;
}

// Young Serif (display) is a single 400 face; everything else is Alegreya Sans.
const forestCardFont = (weight, size, serif) =>
  (serif ? `400 ${size}px "Young Serif", Georgia, serif` : `${weight} ${size}px "Alegreya Sans", sans-serif`);

// A score's pill: the ramp stop's fill and the ink forest.css pairs with it.
function forestPill(stop) {
  if (stop === 'veto') return { fill: '--score-veto', ink: '--score-veto-ink' };
  const n = Number(stop);
  if (!(n >= 1 && n <= 5)) return null;
  return { fill: `--score-${n}`, ink: n <= 2 ? '--score-ink-low' : '--score-ink-high' };
}

// The round's marker as one of Forest's eight, with its deep stop, or Tanne —
// the default (F8.2). Matched like programmheftCardMarker.
function forestCardMarker() {
  const set = designMarkers('forest');
  const mine = recapMarker();
  const hit = mine && set.find((m) => recapColor(m.color) === mine.color);
  const m = hit || set[0] || { color: FOREST_CARD_TOKENS['--brand'] };
  return { color: m.color, deep: m.deep || m.color };
}

/* What the results screen adds to its share model under Forest, at click time:
   the long date for the kicker, and the fact line exactly as the screen shows
   it — paintForestFacts keeps that node current through every winner tap, so
   the card can never state a figure the screen above it does not. */
function forestCardEdition(session, factsEl) {
  return {
    dayLong: new Date(session.createdAt).toLocaleDateString(localeTag(locale), { day: 'numeric', month: 'long', year: 'numeric' }),
    factLine: factsEl && !factsEl.hidden ? factsEl.textContent : '',
  };
}

/* ---------------------------------------------------------------- the model */

// The card's content as plain data — the one pass both the drawing and the
// spec read, so what is drawn is what was decided here.
function forestCardSpec(kind, model) {
  if (kind === 'period') {
    const blocks = recapCardBlocks(model);
    const sessions = Number(model.sessions) || 0;
    return {
      kind,
      kicker: [model.heading, t('recap.title')].filter(Boolean).join(' · '),
      title: String(model.periodLabel || ''),
      flies: Math.min(sessions, FOREST_CARD_FLIES_MAX),
      facts: [
        { k: t('periodRecap.label.sessions'), v: String(sessions) },
        { k: t('periodRecap.label.gamesPlayed'), v: String(model.gamesPlayed || 0) },
        ...blocks.shelf.map((s) => ({ k: s.label, v: `${s.plus ? '+' : ''}${s.n}` })),
      ],
      lines: blocks.rows.map((r) => ({ label: r.label, title: r.value, sub: r.sub || '' })),
    };
  }

  const kicker = [model.roundName, model.dayLong || model.day].filter(Boolean).join(' · ');
  // A split session names its tables; it has no winner or score of its own.
  if (model.outcome === 'split') {
    return {
      kind, kicker, cover: false,
      headline: [{ text: t('result.titleSplit'), gold: false }],
      winner: null,
      rows: (model.tables || []).slice(0, FOREST_CARD_ROWS).map((tb, i) => ({ place: String(i + 1), title: tb.title || '', score: '', stop: null })),
      factLine: '',
    };
  }

  // F8.4 sets the sentence and the winner apart: „„Nordlichter" wurde
  // gespielt." over „Jonas hat gewonnen!" in gold-deep. Both are the app's own
  // strings — the results screen's played sentence and the Chronik's winner
  // line — never a paraphrase. Without a winner the screen's sentence for how
  // the night ended stands alone (shareHeadline, the text share's builder),
  // minus the trophy, an emoji the canvas would draw in whatever colour face
  // the platform has.
  const winners = model.winnerNames || [];
  const played = model.playedTitle && !model.cancelled
    ? (model.rows || []).find((r) => r.title === model.playedTitle && r.count) : null;
  let headline;
  let winner = null;
  if (winners.length && model.playedTitle && !model.cancelled) {
    headline = t('result.titlePlayed', { game: model.playedTitle });
    winner = {
      text: tn(winners.length, 'chronik.wonOne', 'chronik.won', { names: joinNames(winners) }),
      score: played ? fmtAvg(played.score) : '',
      stop: played ? rampStop(played.score) : null,
    };
  } else {
    headline = shareHeadline(model, t, joinNames, tn) || t('result.title');
    if (headline.startsWith(SHARE_TROPHY)) headline = headline.slice(SHARE_TROPHY.length).trimStart();
  }

  return {
    kind: 'session',
    kicker,
    cover: !!model.playedTitle && !model.cancelled,
    headline: [{ text: headline, gold: false }],
    winner,
    rows: (model.rows || []).filter((r) => r.place && r.count).slice(0, FOREST_CARD_ROWS).map((r) => ({
      place: String(r.place), title: r.title, score: fmtAvg(r.score), stop: rampStop(r.score),
    })),
    factLine: model.factLine || '',
  };
}

/* ------------------------------------------------------------------ drawing */

// `#rrggbb` at `alpha`, for a glow's falloff.
function forestAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// The marker band hanging from the image's top edge, notched at its foot —
// F8.4's clip-path polygon as a plain path. Never carries text.
function forestBand(ctx, marker) {
  ctx.fillStyle = marker.color;
  ctx.beginPath();
  ctx.moveTo(32, 0);
  ctx.lineTo(54, 0);
  ctx.lineTo(54, 56);
  ctx.lineTo(43, 46);
  ctx.lineTo(32, 56);
  ctx.closePath();
  ctx.fill();
}

// The result's scene (F10.4's end state): sky over meadow, the grown tree, the
// played game's box in the grass. Geometry is the sheet's, in its own pixels.
function forestClearing(ctx, spec, p, marker) {
  const W = FOREST_CARD_W;
  const H = FOREST_CARD_SCENE_H.session;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, p.band);
  g.addColorStop(0.64, p.hatch);
  g.addColorStop(0.64, p['score-4']);
  g.addColorStop(1, p['score-3']);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const cx = W * 0.66;
  ctx.fillStyle = p.bark;
  ctx.beginPath();
  ctx.roundRect(cx - 10, H - 108 - 120, 20, 120, [10, 10, 3, 3]);
  ctx.fill();
  for (const [dx, bottom, w, hh, leaf] of [[0, 190, 140, 112, 'leaf-2'], [-42, 220, 100, 88, 'leaf-3'], [39, 226, 98, 84, 'leaf-1']]) {
    ctx.fillStyle = p[leaf];
    ctx.beginPath();
    ctx.ellipse(cx + dx, H - bottom - hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (spec.cover) {
    const w = 190;
    const h = 142;
    ctx.save();
    ctx.translate(34 + w / 2, H - 38 - h / 2);
    ctx.rotate((-4 * Math.PI) / 180);
    ctx.shadowColor = 'rgba(40, 60, 30, 0.35)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 14;
    const c = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    c.addColorStop(0, marker.color);
    c.addColorStop(1, marker.deep);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, [10, 3, 10, 3]);
    ctx.fill();
    ctx.restore();
  }
  forestBand(ctx, marker);
}

// The period's dusk: one firefly per session over eight tree silhouettes. The
// flies sit on a low-discrepancy sequence (the R2 sequence), so the same count
// always draws the same sky and no two crowd each other; they stay above the
// tallest crown and right of the marker band, so none is hidden — each one
// is a session, and a covered fly would be a session the card does not count.
function forestDusk(ctx, spec, p, marker) {
  const W = FOREST_CARD_W;
  const H = FOREST_CARD_SCENE_H.period;
  ctx.fillStyle = p.dusk;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < spec.flies; i++) {
    const x = 72 + (W - 92) * ((0.5 + i * 0.7548776662) % 1);
    const y = H * (0.08 + 0.46 * ((0.5 + i * 0.5698402910) % 1));
    const s = 4 + (i % 3);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, s * 3);
    glow.addColorStop(0, forestAlpha(p.firefly, 0.6));
    glow.addColorStop(1, forestAlpha(p.firefly, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, s * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.firefly;
    ctx.beginPath();
    ctx.arc(x, y, s / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const trees = [[44, 80], [60, 110], [52, 92], [70, 130], [48, 86], [62, 120], [56, 98], [66, 112]];
  const gap = (W - 24 - trees.reduce((s, [w]) => s + w, 0)) / (trees.length - 1);
  let x = 12;
  ctx.fillStyle = p.ink;
  for (const [w, h] of trees) {
    // border-radius 50% 50% 6px 6px / 60% 60% 6px 6px: an elliptic crown over
    // a straight body, cut off by the scene's own edge.
    const ry = h * 0.6;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, H - h + ry, w / 2, ry, 0, Math.PI, 0);
    ctx.lineTo(x + w, H);
    ctx.lineTo(x, H);
    ctx.closePath();
    ctx.fill();
    x += w + gap;
  }
  forestBand(ctx, marker);
}

// The kicker: tracked capitals in Laubgrün, 13px 800 — F8.4's .12em.
function forestKicker(ctx, text, y, p) {
  ctx.fillStyle = p.brand;
  ctx.font = forestCardFont(800, 13);
  programmheftTracked(ctx, String(text).toUpperCase(), FOREST_CARD_PAD, y, 1.56, FOREST_CARD_W - FOREST_CARD_PAD * 2);
}

// The headline in Young Serif, stepping down to 24px before giving up a line.
// Returns the height it used.
function forestHeadline(ctx, runs, y, from, maxLines, p) {
  const maxW = FOREST_CARD_W - FOREST_CARD_PAD * 2;
  let size = from;
  let lines = null;
  for (; size >= 24; size -= 2) {
    ctx.font = forestCardFont(400, size, true);
    lines = tischWrap(ctx, runs, maxW, maxLines);
    if (lines) break;
  }
  if (!lines) {
    size = 24;
    ctx.font = forestCardFont(400, size, true);
    lines = (tischWrap(ctx, runs, maxW, 99) || []).slice(0, maxLines);
  }
  const lh = Math.round(size * 1.08);
  ctx.fillStyle = p.ink;
  lines.forEach((line, i) => {
    const text = line.map((r) => r.text).join('');
    ctx.fillText(recapFit(ctx, text, maxW), FOREST_CARD_PAD, y + size * 0.9 + i * lh);
  });
  return lines.length * lh;
}

// A score in its leaf-cornered ramp pill, right-aligned at `right`. Returns
// the pill's width.
function forestScorePill(ctx, score, stop, right, mid, size, p) {
  const pill = forestPill(stop);
  if (!score || !pill) return 0;
  ctx.font = forestCardFont(800, size);
  const padX = size >= 20 ? 12 : 8;
  const w = ctx.measureText(score).width + padX * 2;
  const h = Math.round(size * 1.45);
  ctx.fillStyle = p[pill.fill.slice(2)];
  ctx.beginPath();
  ctx.roundRect(right - w, mid - h / 2, w, h, size >= 20 ? [14, 4, 14, 4] : [10, 3, 10, 3]);
  ctx.fill();
  ctx.fillStyle = p[pill.ink.slice(2)];
  ctx.fillText(score, right - w + padX, mid + size * 0.35);
  return w;
}

// The winner: the crown in gold, the line in gold-deep, the score at right.
function forestWinner(ctx, winner, y, p) {
  const pad = FOREST_CARD_PAD;
  const right = FOREST_CARD_W - pad;
  const mid = y + 17;
  const pillW = forestScorePill(ctx, winner.score, winner.stop, right, mid, 22, p);
  tischGlyph(ctx, 'crown', pad, mid - 12, 24, p.gold);
  ctx.fillStyle = p['gold-deep'];
  // A tie's names must be read in full: step down to 14px before the line is
  // ever cut (14px is 28px exported).
  const maxW = right - pad - 34 - (pillW ? pillW + 12 : 0);
  let size = 21;
  ctx.font = forestCardFont(800, size);
  while (size > 14 && ctx.measureText(winner.text).width > maxW) ctx.font = forestCardFont(800, --size);
  ctx.fillText(recapFit(ctx, winner.text, maxW), pad + 34, mid + Math.round(size / 3));
  return 34;
}

// The Tafel's rows: a hairline above each, the rank in Alegreya Sans 800 (not
// Young Serif — review U3), the title, the score's pill.
function forestRows(ctx, rows, y, p) {
  const pad = FOREST_CARD_PAD;
  const inner = FOREST_CARD_W - pad * 2;
  const h = 30;
  rows.forEach((r, i) => {
    const top = y + i * h;
    ctx.fillStyle = p.line;
    ctx.fillRect(pad, top, inner, 1);
    const mid = top + h / 2 + 1;
    const pillW = forestScorePill(ctx, r.score, r.stop, pad + inner, mid, 15, p);
    ctx.fillStyle = p.ink;
    ctx.font = forestCardFont(800, 15);
    ctx.fillText(r.place, pad, mid + 5);
    ctx.font = forestCardFont(700, 15);
    ctx.fillText(recapFit(ctx, r.title, inner - 28 - (pillW ? pillW + 10 : 0)), pad + 28, mid + 5);
  });
  return rows.length * h;
}

// The period's facts: up to three tiles to a row on the page ground — a Young
// Serif figure over a small label.
function forestFactTiles(ctx, facts, y, p) {
  if (!facts.length) return 0;
  const pad = FOREST_CARD_PAD;
  const gap = 10;
  const colW = (FOREST_CARD_W - pad * 2 - gap * 2) / 3;
  const tileH = 58;
  facts.forEach((f, i) => {
    const x = pad + (i % 3) * (colW + gap);
    const top = y + Math.floor(i / 3) * (tileH + gap);
    ctx.fillStyle = p['page-bg'];
    ctx.beginPath();
    ctx.roundRect(x, top, colW, tileH, 14);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.font = forestCardFont(400, 24, true);
    ctx.fillText(recapFit(ctx, f.v, colW - 24), x + 12, top + 30);
    ctx.fillStyle = p['ink-soft'];
    ctx.font = forestCardFont(700, 13);
    ctx.fillText(recapFit(ctx, f.k, colW - 24), x + 12, top + 48);
  });
  const rowsN = Math.ceil(facts.length / 3);
  return rowsN * tileH + (rowsN - 1) * gap;
}

// The period's named lines: „Meistgespielt: Nordlichter", the figure at right.
function forestLines(ctx, lines, y, p) {
  const pad = FOREST_CARD_PAD;
  const inner = FOREST_CARD_W - pad * 2;
  const h = 24;
  lines.forEach((l, i) => {
    const base = y + i * h + 16;
    ctx.font = forestCardFont(700, 16);
    let subW = 0;
    if (l.sub) {
      ctx.fillStyle = p['ink-soft'];
      subW = ctx.measureText(l.sub).width;
      ctx.fillText(l.sub, pad + inner - subW, base);
    }
    const label = `${l.label}: `;
    ctx.fillStyle = p['ink-soft'];
    const labelW = ctx.measureText(label).width;
    ctx.fillText(label, pad, base);
    ctx.fillStyle = p.ink;
    ctx.font = forestCardFont(800, 16);
    ctx.fillText(recapFit(ctx, l.title, inner - labelW - (subW ? subW + 12 : 0)), pad + labelW, base);
  });
  return lines.length * h;
}

// The foot (F8.4): the wordmark badge — the Laubgrün disc with the whirl —
// „Spielwirbel" in Young Serif 19, the address in soft ink, and "Powered by
// BGG" at the right, a licence requirement wherever BGG data appears.
function forestFoot(ctx, badge, p) {
  const pad = FOREST_CARD_PAD;
  const base = FOREST_CARD_H - 22;
  const disc = 24;
  const cy = base - 6;
  ctx.fillStyle = p.brand;
  ctx.beginPath();
  ctx.arc(pad + disc / 2, cy, disc / 2, 0, Math.PI * 2);
  ctx.fill();
  tischGlyph(ctx, 'tornado', pad + disc / 2 - 6.5, cy - 6.5, 13, p['on-dusk']);
  ctx.fillStyle = p.ink;
  ctx.font = forestCardFont(400, 19, true);
  ctx.fillText('Spielwirbel', pad + disc + 8, base);
  const wordW = ctx.measureText('Spielwirbel').width;
  ctx.fillStyle = p['ink-soft'];
  ctx.font = forestCardFont(700, 13);
  ctx.fillText('spielwirbel.app', pad + disc + 8 + wordW + 10, base);
  if (!(badge && (badge.naturalWidth || badge.width))) return;
  const w = 96;
  const bh = w * ((badge.naturalHeight || badge.height) / (badge.naturalWidth || badge.width));
  ctx.drawImage(badge, FOREST_CARD_W - pad - w, base - bh + 3, w, bh);
}

function drawForestCard(ctx, spec, badge) {
  const p = forestCardPalette();
  const W = FOREST_CARD_W;
  const H = FOREST_CARD_H;
  const marker = forestCardMarker();
  const sceneH = FOREST_CARD_SCENE_H[spec.kind];
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = p.surface;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, sceneH);
  ctx.clip();
  if (spec.kind === 'period') forestDusk(ctx, spec, p, marker);
  else forestClearing(ctx, spec, p, marker);
  ctx.restore();

  let y = sceneH + 22 + 13;
  forestKicker(ctx, spec.kicker, y, p);
  y += 10;
  if (spec.kind === 'period') {
    y += forestHeadline(ctx, [{ text: spec.title, gold: false }], y, 34, 1, p) + 12;
    y += forestFactTiles(ctx, spec.facts, y, p) + 12;
    forestLines(ctx, spec.lines, y, p);
  } else {
    y += forestHeadline(ctx, spec.headline, y, 32, spec.winner ? 2 : 3, p) + 8;
    if (spec.winner) y += forestWinner(ctx, spec.winner, y, p) + 6;
    y += forestRows(ctx, spec.rows, y, p) + 4;
    if (spec.factLine) {
      ctx.fillStyle = p.line;
      ctx.fillRect(FOREST_CARD_PAD, y, W - FOREST_CARD_PAD * 2, 1);
      ctx.fillStyle = p['ink-soft'];
      ctx.font = forestCardFont(700, 13);
      ctx.fillText(recapFit(ctx, spec.factLine, W - FOREST_CARD_PAD * 2), FOREST_CARD_PAD, y + 20);
    }
  }
  forestFoot(ctx, badge, p);
}

// Render one card to a PNG Blob. Rejects rather than resolving null, so the
// caller's catch — which reports to the operator (reportClientError, in
// shareRecapCard and shareResultCard) — is the one place a failure is seen.
async function forestCardBlob(kind, model) {
  // The faces must be usable before the first fillText (recap-card.js
  // constraint 2): ask for each explicitly, since ctx.font never loads one.
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all([forestCardFont(400, 32, true), forestCardFont(800, 15), forestCardFont(700, 13)]
        .map((f) => document.fonts.load(f)));
    } catch { /* a face that cannot load leaves the card in the fallback */ }
  }
  const spec = forestCardSpec(kind === 'period' ? 'period' : 'session', model);
  const badge = await tischBadge();
  const canvas = document.createElement('canvas');
  canvas.width = FOREST_CARD_W * FOREST_CARD_SCALE;
  canvas.height = FOREST_CARD_H * FOREST_CARD_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(FOREST_CARD_SCALE, FOREST_CARD_SCALE);
  drawForestCard(ctx, spec, badge);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
