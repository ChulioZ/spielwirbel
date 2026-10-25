/* Spielwirbel – the session result as a shareable image, for the designs
   without a card of their own (#1628): Klassisch.

   One portrait card, content-sized like the classic period card: the round
   and the date, the results screen's own sentence, then by stage (#1726) —
   before a pick, the ranking as the screen orders it (the tie-aware places
   from computePlaces, so a shared place prints twice and a tie adds a row),
   each game with its rating distribution; once a game is chosen, only that
   game with its score and who brings the box, and its points when they were
   counted; for a split evening, each table and its result. No per-person
   votes: the screen never shows who voted what,
   and the card can say nothing the screen does not (the model is the one
   shareResult builds for the text share, sessionShareText's own input).

   Handed to the user's own share sheet WITH the text beside it by
   shareResultCard (below — every design's dispatch lives here since #1726),
   which falls back to the text share where the browser cannot share files.

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

/* The two shared pieces every design's session card draws once the share
   follows the stage (#1726). Both are flat fills and fillText only — no glyph
   font, no SVG, no pattern (the constraints above) — and each design passes its
   own palette and face, so the pieces stay one decision drawn six ways. */

// A game's rating distribution as ONE flat strip: a segment per vote-card value
// that anyone gave, lowest at the left as the Tafel's columns run, its length
// the count and its fill that value's colour from `colorOf(n)`. Counts only —
// the strip cannot say who gave which rating, because the model does not know.
function drawShareDist(ctx, dist, x, y, w, h, colorOf) {
  const live = (dist || []).filter((d) => d.count > 0).sort((a, b) => a.n - b.n);
  const total = live.reduce((n, d) => n + d.count, 0);
  if (!total || w <= 0) return;
  const gap = 2;
  const room = w - gap * (live.length - 1);
  let at = x;
  live.forEach((d, i) => {
    const sw = i === live.length - 1 ? x + w - at : Math.max(2, Math.round((room * d.count) / total));
    shelfRect(ctx, at, y, sw, h, Math.min(h / 2, sw / 2), colorOf(d.n));
    at += sw + gap;
  });
}

// The points rows, best first (sessionSharePoints): the name at the left, the
// points at the right, a hairline under each. A winner's line carries the crown
// in the accent — the glyph as a Path2D, never the icon font — so the win is
// not carried by colour alone; the automa reads in the soft ink. `o` is
// { x, y, w, rowH, size, font(weight, size), ink, soft, accent, rule }.
function drawSharePoints(ctx, points, o) {
  const crownW = points.some((pt) => pt.winner) ? o.size + 8 : 0;
  ctx.textAlign = 'left';
  points.forEach((pt, i) => {
    const top = o.y + i * o.rowH;
    const base = top + o.rowH / 2 + o.size * 0.36;
    if (o.rule) { ctx.fillStyle = o.rule; ctx.fillRect(o.x, top + o.rowH - 1, o.w, 1); }
    const ink = pt.automa ? o.soft : (pt.winner ? o.accent : o.ink);
    if (pt.winner) tischGlyph(ctx, 'crown', o.x, base - o.size * 0.86, o.size, o.accent);
    ctx.font = o.font(800, o.size);
    const vw = pt.text ? ctx.measureText(pt.text).width : 0;
    ctx.fillStyle = ink;
    if (pt.text) ctx.fillText(pt.text, o.x + o.w - vw, base);
    ctx.font = o.font(pt.winner ? 800 : 600, o.size);
    ctx.fillText(recapFit(ctx, pt.name, o.w - crownW - vw - 14), o.x + crownW, base);
  });
  return points.length * o.rowH;
}

// What a card shows under its headline, by stage (#1726): the rated rows with
// their distributions before a pick, and once a game is chosen nothing but that
// game — its points when the session is finished. Every design's spec reads
// this, so no card can keep a ranking another one dropped.
function shareCardContent(model) {
  const outcome = shareStage(model) === 'outcome';
  return {
    outcome,
    rows: outcome ? [] : (model.rows || []).filter((r) => r.place && r.count),
    points: outcome && model.outcome !== 'split' ? (model.points || []) : [],
  };
}

// A split evening's tables for a card: label, game, who sat there, and that
// table's own result line (shareTableResult, the text share's builder).
function shareCardTables(model) {
  return (model.tables || []).map((tb, i) => ({
    label: t('tables.tableLabel', { n: i + 1 }),
    title: tb.title,
    names: tb.names,
    said: shareTableResult(tb, t, joinNames, tn),
  }));
}

// The card's content as plain data — the one pass the measuring, the drawing
// and the spec read.
function resultCardSpec(model) {
  const all = (model.rows || []).filter((r) => r.place && r.count);
  const content = shareCardContent(model);
  const played = model.playedTitle ? all.find((r) => r.title === model.playedTitle) : null;
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
    rowsTitle: t('share.ratings').replace(/\s*[:：]\s*$/, ''),
    rows: content.rows.slice(0, RESULT_CARD_MAX_ROWS).map((r) => ({
      place: String(r.place),
      title: r.title,
      score: fmtAvg(r.score),
      scoreValue: r.score,
      dist: r.dist || [],
    })),
    pointsTitle: t('points.label'),
    points: content.points,
    tables: model.outcome === 'split' ? shareCardTables(model) : [],
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
// A row grows by its distribution strip when it has one.
const resultRowH = (spec) => RESULT_CARD_ROW_H + (spec.rows.some((r) => r.dist.length) ? 12 : 0);
const resultRowsH = (spec) => (spec.rows.length ? 44 + spec.rows.length * resultRowH(spec) + 10 : 0);
const resultPointsH = (spec) => (spec.points.length ? 44 + spec.points.length * 30 + 10 : 0);
const resultTableH = (tb) => 56 + (tb.said ? 20 : 0);
const resultTablesH = (spec) => (spec.tables.length ? spec.tables.reduce((h, tb) => h + resultTableH(tb), 16) : 0);

// The sentence's line count needs a context to measure with, so the height is
// computed against the drawing context itself rather than a guess.
function resultCardHeight(ctx, spec) {
  ctx.font = recapFont(800, 26, true);
  const lines = resultCardWrap(ctx, spec.sentence, RESULT_CARD_W - RESULT_CARD_PAD * 2, RESULT_CARD_MAX_LINES);
  let h = 66 + lines.length * RESULT_CARD_LINE_H + RESULT_CARD_GAP;
  if (spec.played) h += resultPlayedH(spec) + RESULT_CARD_GAP;
  if (spec.rows.length) h += resultRowsH(spec) + RESULT_CARD_GAP;
  if (spec.points.length) h += resultPointsH(spec) + RESULT_CARD_GAP;
  if (spec.tables.length) h += resultTablesH(spec) + RESULT_CARD_GAP;
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

// The ranking before a pick, as the screen orders it: place, title, score, and
// under the title the game's rating distribution as one flat strip (#1726).
function drawResultRows(ctx, spec, y, pal) {
  const pad = RESULT_CARD_PAD;
  const w = RESULT_CARD_W - pad * 2;
  const rowH = resultRowH(spec);
  shelfRect(ctx, pad, y, w, resultRowsH(spec), 14, pal.surface);
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.ink;
  ctx.font = recapFont(800, 15, true);
  ctx.fillText(recapFit(ctx, spec.rowsTitle, w - 32), pad + 16, y + 28);
  spec.rows.forEach((row, i) => {
    const top = y + 44 + i * rowH;
    const mid = top + RESULT_CARD_ROW_H / 2;
    ctx.fillStyle = pal.inkSoft;
    ctx.font = recapFont(800, 15, true);
    ctx.textAlign = 'left';
    ctx.fillText(row.place, pad + 22, mid + 5);
    const pillW = resultPill(ctx, row.score, row.scoreValue, pad + w - 16, mid, 13, pal);
    const textW = w - 66 - (pillW ? pillW + 12 : 0);
    ctx.fillStyle = pal.ink;
    ctx.font = recapFont(700, 15);
    ctx.fillText(recapFit(ctx, row.title, textW), pad + 50, mid + 5);
    drawShareDist(ctx, row.dist, pad + 50, mid + 12, Math.min(textW, 220), 6, (n) => recapColor(avgColor(n)) || pal.brand);
  });
  return y + resultRowsH(spec);
}

// The finished session's points (#1630, #1726), best first, the automa last.
function drawResultPoints(ctx, spec, y, pal) {
  const pad = RESULT_CARD_PAD;
  const w = RESULT_CARD_W - pad * 2;
  shelfRect(ctx, pad, y, w, resultPointsH(spec), 14, pal.surface);
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.ink;
  ctx.font = recapFont(800, 15, true);
  ctx.fillText(recapFit(ctx, spec.pointsTitle, w - 32), pad + 16, y + 28);
  drawSharePoints(ctx, spec.points, {
    x: pad + 16, y: y + 40, w: w - 32, rowH: 30, size: 15,
    font: (weight, size) => recapFont(weight, size), ink: pal.ink, soft: pal.inkSoft, accent: pal.brand,
  });
  return y + resultPointsH(spec);
}

// A split evening (#796, #1726): one plate per table — its game, who sat
// there, and that table's result.
function drawResultTables(ctx, spec, y, pal) {
  const pad = RESULT_CARD_PAD;
  const w = RESULT_CARD_W - pad * 2;
  shelfRect(ctx, pad, y, w, resultTablesH(spec), 14, pal.surface);
  let top = y + 8;
  spec.tables.forEach((tb) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.brand;
    ctx.font = recapFont(800, 12);
    ctx.fillText(recapFit(ctx, tb.label.toLocaleUpperCase(), w - 32), pad + 16, top + 18);
    ctx.fillStyle = pal.ink;
    ctx.font = recapFont(800, 17, true);
    ctx.fillText(recapFit(ctx, tb.title, w - 32), pad + 16, top + 38);
    ctx.fillStyle = pal.inkSoft;
    ctx.font = recapFont(600, 13);
    ctx.fillText(recapFit(ctx, tb.names, w - 32), pad + 16, top + 54);
    if (tb.said) {
      ctx.fillStyle = pal.ink;
      ctx.font = recapFont(700, 13);
      ctx.fillText(recapFit(ctx, tb.said, w - 32), pad + 16, top + 74);
    }
    top += resultTableH(tb);
  });
  return y + resultTablesH(spec);
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
  if (spec.rows.length) y = drawResultRows(ctx, spec, y, pal) + RESULT_CARD_GAP;
  if (spec.points.length) y = drawResultPoints(ctx, spec, y, pal) + RESULT_CARD_GAP;
  if (spec.tables.length) drawResultTables(ctx, spec, y, pal);
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

/* ------------------------------------------------- the share's dispatch */

// Which card the worn design draws, or null for the classic one. Read at click
// time: the design can change between rendering a button and pressing it.
function designCard() {
  const d = typeof activeDesign === 'function' ? activeDesign() : null;
  return (d && d.card) || null;
}

/* The results screen's „Teilen", in every design (#1628 — Klassisch and Die
   Brücke joined the four with a session card of their own): the card as a PNG, WITH the message text beside it, through the user's own share
   sheet — the same trust shape as every other share here (nothing is sent by
   us; the user picks the recipient).

   Returns true when the share is DONE (sent or dismissed) and false when the
   caller should run the text share it always had: no file sharing on this
   browser (desktop Chrome has navigator.share without file support), a card
   that failed to render, or a sheet that refused the call. A failed render is
   REPORTED — nothing here touches the server, so otherwise the catch would be
   the end of the story (.claude/rules/caught-client-faults-are-invisible.md) —
   but the user still gets the text, rather than a toast about an image they
   did not know they were getting. */
async function shareResultCard(model, text) {
  if (!(navigator.canShare && navigator.share && typeof File !== 'undefined')) return false;
  const card = designCard();
  let blob;
  try {
    // Every design draws a split evening's tables since #1726; Ocean's card
    // (#1220) picks its proportion from the screen.
    if (!card) blob = await resultCardBlob(model); else
    if (card === 'bruecke') blob = await brueckeCardBlob(model, 'session'); else
    if (card === 'programmheft') blob = await programmheftCardBlob('session', model); else
    if (card === 'forest') blob = await forestCardBlob('session', model); else
    blob = card === 'ocean'
      ? await oceanCardBlob(oceanShareKind(), model)
      : await tischCardBlob(model.outcome === 'split' ? 'split' : 'session', model);
  } catch (err) {
    reportClientError('recap_export', err);
    return false;
  }
  const file = new File([blob], 'spielwirbel-session.png', { type: 'image/png' });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], text });
    return true;
  } catch (e) {
    // Dismissing the sheet is a normal outcome, not a failure.
    return !!(e && e.name === 'AbortError');
  }
}

/* Which proportion the results screen shares. A phone shares the portrait card
   into a chat or a story; a wide landscape screen — where a desktop chat lays
   an image out at link-preview proportions — shares the 1.91:1 one. Read at
   click time, like designCard(). */
function oceanShareKind() {
  const wide = typeof matchMedia === 'function'
    && matchMedia('(min-width: 1024px) and (orientation: landscape)').matches;
  return wide ? 'landscape' : 'session';
}
