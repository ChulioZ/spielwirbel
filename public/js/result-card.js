/* Spielwirbel – the session result as a shareable image, for the designs
   without a card of their own (#1628): Klassisch.

   One portrait card, content-sized like the classic period card: the round
   and the date, the results screen's own sentence, the played game with its
   score and who brings the box, then the ranking as the screen orders it — the
   tie-aware places from computePlaces, so a shared place prints twice and a
   tie adds a row. No per-person votes: the screen never shows who voted what,
   and the card can say nothing the screen does not (the model is the one
   shareResult builds for the text share, sessionShareText's own input).

   Handed to the user's own share sheet WITH the text beside it by
   shareResultCard (recap-card-tisch.js), which falls back to the text share
   where the browser cannot share files — the same path as every design's card.

   The constraints recap-card-tisch.js lists hold in full:
   1. NO COVER ART, NO SVG, NO PATTERN. Flat fills and rounded rects; the one
      image is the same-origin „Powered by BGG" PNG via drawImage, which keeps
      the canvas clean in WebKit
      (.claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md).
   2. NO ICON FONT. A canvas never loads a font, so no glyph is drawn.
   3. 2x backing store, and the text faces asked for before the first fillText.

   Colours are the live palette (recapPalette, recapMarker), the classic recap
   card's own reading — Klassisch has no token copy, and needs none: its
   tokens are the ones the cascade holds while it is worn.

   No module.exports — DOM/canvas code, exercised through the jsdom harness by
   test/result-card.test.js with a recording context
   (.claude/rules/frontend-helper-modules-and-coverage.md). Load order: after
   recap-card.js and recap-card-tisch.js, whose helpers it calls at click time. */

'use strict';

const RESULT_CARD_W = 540;
const RESULT_CARD_SCALE = 2;
const RESULT_CARD_PAD = 30;
const RESULT_CARD_GAP = 14;
const RESULT_CARD_ROW_H = 34;
const RESULT_CARD_FOOT_H = 64;
const RESULT_CARD_LINE_H = 32;
// Rows the image carries. The screen lists every game; a picture posted into a
// chat has to stay a picture, and the ninth-placed game is not what it is for.
const RESULT_CARD_MAX_ROWS = 8;
const RESULT_CARD_MAX_LINES = 3;

/* „Gehört Anna, Ben" for the played game, or '' — every design's card reads
   it from here, so the line cannot be phrased two ways. `bringers` is
   boxBringers' answer, computed by the results screen (views-session.js). */
function resultCardBringers(model) {
  const names = (model && model.bringers) || [];
  return names.length ? t('result.ownedBy', { names: names.join(', ') }) : '';
}

// The headline: the results screen's own sentence (shareHeadline, the text
// share's builder) minus the trophy, an emoji the canvas would draw in
// whatever colour face the platform has.
function resultCardSentence(model) {
  let s = shareHeadline(model, t, joinNames, tn) || t('result.title');
  if (s.startsWith(SHARE_TROPHY)) s = s.slice(SHARE_TROPHY.length).trimStart();
  return s;
}

// The card's content as plain data — the one pass the measuring, the drawing
// and the spec read.
function resultCardSpec(model) {
  const rows = (model.rows || []).filter((r) => r.place && r.count);
  const played = model.playedTitle ? rows.find((r) => r.title === model.playedTitle) : null;
  return {
    kicker: [model.roundName, model.day || model.when].filter(Boolean).join(' · '),
    sentence: resultCardSentence(model),
    played: model.playedTitle && !model.cancelled ? {
      stamp: t('result.stamp'),
      title: model.playedTitle,
      score: played ? fmtAvg(played.score) : '',
      scoreValue: played ? played.score : null,
      sub: played ? `${t('score.name')} · ${tn(played.count, 'recap.ratingsOne', 'recap.ratings', { n: played.count })}` : '',
      bringers: resultCardBringers(model),
    } : null,
    rowsTitle: t('share.ratings').replace(/[:：]\s*$/, ''),
    rows: rows.slice(0, RESULT_CARD_MAX_ROWS).map((r) => ({
      place: String(r.place),
      title: r.title,
      score: fmtAvg(r.score),
      scoreValue: r.score,
      chosen: !!model.playedTitle && r.title === model.playedTitle,
    })),
  };
}

// Word-wrap `text` to at most `maxLines`, the last line ellipsized; a word
// longer than the line (a German compound, a long title) is fitted on its own.
function resultCardWrap(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxW || !line) { line = next; continue; }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines - 1) {
      line = words.slice(i).join(' ');
      break;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines).map((l) => recapFit(ctx, l, maxW));
}

const resultPlayedH = (spec) => (spec.played ? 104 + (spec.played.bringers ? 22 : 0) : 0);
const resultRowsH = (spec) => (spec.rows.length ? 44 + spec.rows.length * RESULT_CARD_ROW_H + 10 : 0);

// The sentence's line count needs a context to measure with, so the height is
// computed against the drawing context itself rather than a guess.
function resultCardHeight(ctx, spec) {
  ctx.font = recapFont(800, 26, true);
  const lines = resultCardWrap(ctx, spec.sentence, RESULT_CARD_W - RESULT_CARD_PAD * 2, RESULT_CARD_MAX_LINES);
  let h = 66 + lines.length * RESULT_CARD_LINE_H + RESULT_CARD_GAP;
  if (spec.played) h += resultPlayedH(spec) + RESULT_CARD_GAP;
  if (spec.rows.length) h += resultRowsH(spec) + RESULT_CARD_GAP;
  return { height: h + RESULT_CARD_FOOT_H, lines };
}

// A score in its ramp pill — the screen's own colour (scoreColor), under the
// design's on-accent ink. Returns the pill's width.
function resultPill(ctx, text, value, right, mid, size, pal) {
  if (!text) return 0;
  ctx.font = recapFont(800, size, true);
  const w = ctx.measureText(text).width + 20;
  const h = Math.round(size * 1.6);
  shelfRect(ctx, right - w, mid - h / 2, w, h, h / 2, recapColor(scoreColor(value)) || pal.brand);
  ctx.fillStyle = pal.onAccent;
  ctx.textAlign = 'left';
  ctx.fillText(text, right - w + 10, mid + size * 0.36);
  return w;
}

function drawResultPlayed(ctx, played, y, pal) {
  const pad = RESULT_CARD_PAD;
  const w = RESULT_CARD_W - pad * 2;
  shelfRect(ctx, pad, y, w, resultPlayedH({ played }), 14, pal.surface);
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.brand;
  ctx.font = recapFont(800, 12);
  ctx.fillText(recapFit(ctx, played.stamp.toLocaleUpperCase(), w - 32), pad + 16, y + 26);
  const pillW = resultPill(ctx, played.score, played.scoreValue, pad + w - 16, y + 54, 22, pal);
  ctx.fillStyle = pal.ink;
  ctx.font = recapFont(800, 22, true);
  ctx.fillText(recapFit(ctx, played.title, w - 32 - (pillW ? pillW + 12 : 0)), pad + 16, y + 62);
  ctx.fillStyle = pal.inkSoft;
  ctx.font = recapFont(600, 13);
  if (played.sub) ctx.fillText(recapFit(ctx, played.sub, w - 32), pad + 16, y + 88);
  if (played.bringers) ctx.fillText(recapFit(ctx, played.bringers, w - 32), pad + 16, y + 110);
  return y + resultPlayedH({ played });
}

// The ranking, as the screen orders it: place, title, score. The played game's
// row carries a brand edge, so the image says which one was chosen without a
// glyph.
function drawResultRows(ctx, spec, y, pal) {
  const pad = RESULT_CARD_PAD;
  const w = RESULT_CARD_W - pad * 2;
  shelfRect(ctx, pad, y, w, resultRowsH(spec), 14, pal.surface);
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.ink;
  ctx.font = recapFont(800, 15, true);
  ctx.fillText(recapFit(ctx, spec.rowsTitle, w - 32), pad + 16, y + 28);
  spec.rows.forEach((row, i) => {
    const top = y + 44 + i * RESULT_CARD_ROW_H;
    const mid = top + RESULT_CARD_ROW_H / 2;
    if (row.chosen) {
      shelfRect(ctx, pad + 8, top + 2, w - 16, RESULT_CARD_ROW_H - 4, 8, pal.bg);
      ctx.fillStyle = pal.brand;
      ctx.fillRect(pad + 8, top + 2, 4, RESULT_CARD_ROW_H - 4);
    }
    ctx.fillStyle = row.chosen ? pal.brand : pal.inkSoft;
    ctx.font = recapFont(800, 15, true);
    ctx.textAlign = 'left';
    ctx.fillText(row.place, pad + 22, mid + 5);
    const pillW = resultPill(ctx, row.score, row.scoreValue, pad + w - 16, mid, 13, pal);
    ctx.fillStyle = pal.ink;
    ctx.font = recapFont(row.chosen ? 800 : 700, 15);
    ctx.fillText(recapFit(ctx, row.title, w - 66 - (pillW ? pillW + 12 : 0)), pad + 50, mid + 5);
  });
  return y + resultRowsH(spec);
}

function drawResultCard(ctx, spec, layout, pal, badge) {
  const pad = RESULT_CARD_PAD;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, RESULT_CARD_W, layout.height);
  ctx.fillStyle = pal.marker;
  ctx.fillRect(0, 0, RESULT_CARD_W, 8);
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.brand;
  ctx.font = recapFont(800, 14);
  ctx.fillText(recapFit(ctx, spec.kicker.toLocaleUpperCase(), RESULT_CARD_W - pad * 2), pad, 46);
  ctx.fillStyle = pal.ink;
  ctx.font = recapFont(800, 26, true);
  layout.lines.forEach((line, i) => ctx.fillText(line, pad, 66 + (i + 1) * RESULT_CARD_LINE_H - 8));
  let y = 66 + layout.lines.length * RESULT_CARD_LINE_H + RESULT_CARD_GAP;
  if (spec.played) y = drawResultPlayed(ctx, spec.played, y, pal) + RESULT_CARD_GAP;
  if (spec.rows.length) drawResultRows(ctx, spec, y, pal);
  drawShelfFoot(ctx, layout.height, { footInk: pal.inkSoft, badge: '#ffffff', tisch: false }, badge);
}

/* Render the card to a PNG Blob. Rejects rather than resolving null, so the
   caller's catch — which reports it (reportClientError) — is the one place a
   failure is seen. `model` is shareResult's (views-session.js). */
async function resultCardBlob(model) {
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all([recapFont(800, 26, true), recapFont(700, 15)].map((f) => document.fonts.load(f)));
    } catch { /* a face that cannot load leaves the card in the fallback */ }
  }
  const c = recapPalette();
  const m = recapMarker();
  const pal = { ...c, marker: m ? m.color : c.brand, onAccent: recapToken('--on-accent', '#ffffff') };
  const spec = resultCardSpec(model);
  const badge = await tischBadge();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const layout = resultCardHeight(ctx, spec);
  canvas.width = RESULT_CARD_W * RESULT_CARD_SCALE;
  canvas.height = layout.height * RESULT_CARD_SCALE;
  // Resizing a canvas resets its context, so the scale goes on afterwards.
  ctx.scale(RESULT_CARD_SCALE, RESULT_CARD_SCALE);
  drawResultCard(ctx, spec, layout, pal, badge);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
