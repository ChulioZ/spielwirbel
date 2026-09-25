/* Spielwirbel – Der Tisch's shareable card (#1199), from
   docs/design/tisch/Tisch-T11-Karte-Marke.dc.html (T11.1).

   One portrait card, 1080x1350, in three variants: a single session, a session
   split across several tables, and a period recap. Four zones top-down — the
   felt head carrying the sentence, the played game with its stamp and score,
   the people, the Tafel — because that is the order people read a screenshot
   someone posted into a chat. The head is the round's MARKER felt, which is
   what ties the image to a round at a glance.

   Reached only while Der Tisch is worn: recapCardBlob (the Chronik) and
   shareResult (the results screen) ask `activeDesign().card` and fall through
   to the classic behaviour otherwise, so Klassisch is untouched. The MODELS are
   the ones those two screens already build for their shares — nothing here
   computes a new fact.

   The constraints from recap-card.js all hold, and two are sharper here:

   1. NO COVER ART and NO SVG PATTERN. A hotlinked cover may not be
      redistributed and taints the canvas; WebKit also taints on a pattern built
      from an SVG image (.claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md).
      Every surface below is a gradient or a flat fill, the covers are the app's
      own wood no-cover placeholder, and the one image drawn is the
      same-origin BGG badge PNG, via drawImage — which is clean in both engines.
   2. NO ICON FONT. The faces, the crown, the check and the whirl are Path2D
      fills of the bundled Tabler outlines (card-glyphs.js). A canvas never
      loads a font, so an icon face nothing has painted yet would draw as tofu —
      and whether it has been painted depends on the user's path through the app.

   Colours are the design's own tokens as a COPY (TISCH_CARD_TOKENS), not a read
   of the live cascade — and the copy is licensed by a parity test
   (test/recap-card-tisch.test.js asserts every value equals tisch.css's dark
   token block), the TAG_ICONS shape from
   .claude/rules/shared-constants-across-the-stack.md. A live read was the first
   cut and it was measured wrong: the names are SHARED (`--page-bg`, `--ink`,
   `--gold` exist in every design), so whenever Der Tisch's dark block is not
   in force — a round still on its own light palette, which rounds keep until
   the flip (#1202) — the card silently drew Klassisch's cream page and orange
   edge under a Tisch layout. The ROUND'S marker is still read live, because
   that one is the round's own and has no other home.

   No module.exports — DOM/canvas code, reached through the jsdom harness by
   test/recap-card-tisch.test.js
   (.claude/rules/frontend-helper-modules-and-coverage.md). Load order: after
   recap-card.js (recapColor, recapFit) and card-glyphs.js. */

'use strict';

const TISCH_CARD_W = 540;
const TISCH_CARD_H = 675;
const TISCH_CARD_SCALE = 2; // 1080x1350, the size T11.1 specifies
const TISCH_CARD_PAD = 28;
const TISCH_CARD_HEAD_H = 236;
// T11.1: 7px under the head, i.e. 14px at 2x — "damit sie im Feed nicht
// verschwindet". Thinner and the brass reads as a hairline in a chat preview.
const TISCH_CARD_EDGE = 7;
const TISCH_CARD_ROW_H = 38;
const TISCH_CARD_MAX_ROWS = 3;
const TISCH_CARD_BADGE = '/icons/powered-by-bgg.png';

// Der Tisch's tokens, keyed by their name in tisch.css (see the header for why
// a copy; the parity test is what keeps it one). `--page-bg` is the registry's
// `page`, which applyBackground writes and the test compares against instead.
const TISCH_CARD_TOKENS = {
  '--page-bg': '#3b2a12', '--felt': '#2f6b4d', '--felt-deep': '#1c4531',
  '--felt-ink': '#f6ecd8', '--felt-ink-soft': '#cfe6d6',
  '--gold': '#f0cf86', '--gold-hi': '#f6e3b4', '--gold-deep': '#d9a951',
  '--gold-ink': '#4a3423', '--gold-edge': '#9a6d2b', '--brass-hi': '#f6d795',
  '--paper': '#f8f3e7', '--paper-raised': '#efe7d5', '--paper-ink': '#2f2620',
  '--paper-ink-soft': '#4a4038', '--ink': '#f6ecd8', '--ink-soft': '#e8d0aa',
  '--wood-light': '#5b4128', '--wood-deep': '#3f2d18',
  '--score-1': '#8f2f22', '--score-2': '#a05a1f', '--score-3': '#b8a12e',
  '--score-4': '#8dbf46', '--score-5': '#b8e08a', '--score-veto': '#6a2118',
  '--score-ink-low': '#fdf4e4', '--score-ink-high': '#2a1a08', '--score-veto-ink': '#fdeee8',
};

// tisch.css's `--wood-grain`. Kept out of the table above because it is an
// rgba() the parity test's resolver does not evaluate; test/recap-card-tisch.test.js
// compares it to the stylesheet's declaration as text instead.
const TISCH_CARD_GRAIN = 'rgba(0, 0, 0, 0.14)';

// The palette as `p['gold-edge']`-style keys, i.e. the token name without its
// leading dashes.
function tischPalette() {
  const p = {};
  for (const [name, value] of Object.entries(TISCH_CARD_TOKENS)) p[name.slice(2)] = value;
  return p;
}

// The felts a card's head is made of: the round's marker, and for a split
// session one more per table, walking the design's marker list from there.
// Tables carry no colour of their own, so this is a deterministic choice rather
// than a stored one — the next felts in T8's order, never the same felt twice.
//
// The round's marker is matched against Der Tisch's OWN felts rather than used
// as given: a marker painted by another design's set (a round screen that has
// not re-applied since a design switch) is not a felt, and the card then starts
// from Tannenfilz, the set's default, instead of putting an orange head on it.
function tischCardFelts(count) {
  const mine = recapMarker();
  const markers = designMarkers('tisch');
  const start = Math.max(0, mine ? markers.findIndex((m) => recapColor(m.color) === mine.color) : 0);
  const felts = [];
  for (let i = 0; i < count; i++) {
    const m = markers[(start + i) % markers.length];
    felts.push({ color: m.color, deep: m.deep });
  }
  return felts;
}

/* ---------------------------------------------------------------- the model */

// Split a sentence into coloured runs: `names` (the winners) is gold, the rest
// is felt ink — the one place gold may be TEXT on felt, because it is >= 24px
// (review finding A1). Located by string search, so the sentence stays the
// exact localized one the screen shows rather than being re-assembled here.
function tischRuns(sentence, highlight) {
  const i = highlight ? sentence.indexOf(highlight) : -1;
  if (i < 0) return [{ text: sentence, gold: false }];
  return [
    { text: sentence.slice(0, i), gold: false },
    { text: highlight, gold: true },
    { text: sentence.slice(i + highlight.length), gold: false },
  ].filter((r) => r.text);
}

// The card's content as plain data, per variant — the one pass both the
// drawing and the spec read, so what is drawn is what was decided here.
function tischCardSpec(kind, model) {
  if (kind === 'period') {
    const rows = [];
    // Labels and shelf entries through the classic card's own recapCardBlocks,
    // so the two designs cannot disagree about what a period card lists — the
    // round's three shelf numbers, or the account's „neu ausprobiert" (#1147).
    const blocks = recapCardBlocks(model);
    if (model.rated && model.rated.length) {
      rows.push({ rank: '', title: `${model.ratedLabel || t('pokale.bestRated')} · ${model.rated.join(' · ')}`, pill: model.ratedScore, stop: null, gold: true });
    }
    const shelf = blocks.shelf;
    if (shelf.length) {
      rows.push({ rank: '', title: `${blocks.shelfLabel} · ${shelf.map((s) => `${s.plus ? '+' : ''}${s.n} ${s.label}`).join(' · ')}`, pill: null, stop: null, gold: false });
    }
    return {
      kind,
      felts: 1,
      kicker: model.heading,
      headline: [{ text: model.periodLabel, gold: false }],
      subline: `${model.sessions} ${t('periodRecap.label.sessions')}`,
      feature: model.played && model.played.length ? {
        title: model.played[0],
        stamp: t('pokale.mostPlayed'),
        big: model.played.join(' · '),
        bigIsTitle: true,
        sub: model.playedSub || '',
      } : null,
      // The session count is already the head's gold line (T11.1: „Sommer 2026
      // · 14 Sessions"), so the band below carries only what the head does not.
      counters: [
        { n: model.gamesPlayed, label: t('periodRecap.label.gamesPlayed') },
      ],
      people: [],
      tables: [],
      rows,
    };
  }

  const kicker = `${model.roundName} · ${model.when}`;
  if (kind === 'split') {
    const tables = (model.tables || []).map((tb, i) => ({ label: t('tables.tableLabel', { n: i + 1 }), title: tb.title, names: tb.names }));
    return {
      kind, felts: Math.max(2, Math.min(tables.length, 3)), kicker,
      headline: [{ text: t('result.titleSplit'), gold: false }], subline: '',
      feature: null, counters: [], people: [], tables, rows: [],
    };
  }

  // A single session. The sentence is the results screen's own h1 — the same
  // builder the text share uses — minus the trophy, which is an emoji the
  // canvas would draw in whatever colour-emoji face the platform has.
  const names = (model.winnerNames || []).length ? joinNames(model.winnerNames) : '';
  let sentence = shareHeadline(model, t, joinNames, tn) || t('result.title');
  if (sentence.startsWith(SHARE_TROPHY)) sentence = sentence.slice(SHARE_TROPHY.length).trimStart();
  const played = model.playedTitle ? (model.rows || []).find((r) => r.title === model.playedTitle && r.count) : null;
  return {
    kind: 'session',
    felts: 1,
    kicker,
    headline: tischRuns(sentence, names),
    subline: '',
    feature: model.playedTitle ? {
      title: model.playedTitle,
      stamp: t('result.stamp'),
      big: played ? fmtAvg(played.score) : '',
      bigIsTitle: false,
      sub: played ? `${t('score.name')} · ${tn(played.count, 'recap.ratingsOne', 'recap.ratings', { n: played.count })}` : '',
    } : null,
    counters: [],
    people: (model.people || []).map((p) => ({ ...p })),
    tables: [],
    rows: (model.rows || []).filter((r) => r.place && r.count).slice(0, TISCH_CARD_MAX_ROWS).map((r) => ({
      rank: String(r.place), title: r.title, pill: fmtAvg(r.score), stop: rampStop(r.score), gold: r.place === 1,
    })),
  };
}

/* ------------------------------------------------------------------ drawing */

const tischFont = (weight, size, display) =>
  `${weight} ${size}px ${display ? '"Bricolage Grotesque", "Manrope", sans-serif' : '"Manrope", sans-serif'}`;

// A Tabler outline at (x, y), `size` px square — see card-glyphs.js.
function tischGlyph(ctx, name, x, y, size, color) {
  if (typeof Path2D === 'undefined' || !CARD_GLYPHS[name]) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / CARD_GLYPH_BOX, size / CARD_GLYPH_BOX);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(CARD_GLYPHS[name]));
  ctx.restore();
}

function tischRect(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

// Der Tisch's no-cover placeholder — the wood of T1 that tisch.css paints on
// `.cover-ph` (the grain every 11px, a walnut gradient) with the whirl on it —
// so a game on the card looks as it does on the Regal. Never a real cover
// (constraint 1). The grain is drawn as flat stripes rather than a
// repeating-gradient pattern: a canvas has no repeating gradient, and a
// pattern is exactly what the header forbids.
function tischCover(ctx, x, y, w, h, p) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 3);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w * 0.35, y + h);
  g.addColorStop(0, p['wood-light']);
  g.addColorStop(1, p['wood-deep']);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = TISCH_CARD_GRAIN;
  for (let gx = x; gx < x + w; gx += 11) ctx.fillRect(gx, y, 3, h);
  ctx.restore();
  if (w >= 40) {
    const s = w * 0.42;
    tischGlyph(ctx, 'tornado', x + (w - s) / 2, y + (h - s) / 2, s, 'rgba(246, 236, 216, 0.72)');
  }
}

// Word-wrap coloured runs to `maxW`, at most `maxLines`. Returns the lines as
// run lists, or null when the text does not fit — the caller then steps the
// size down rather than truncating the sentence people came to read.
function tischWrap(ctx, runs, maxW, maxLines) {
  const words = [];
  runs.forEach((run) => run.text.split(/(\s+)/).forEach((w) => { if (w) words.push({ text: w, gold: run.gold }); }));
  const lines = [[]];
  let width = 0;
  for (const word of words) {
    const ww = ctx.measureText(word.text).width;
    if (/^\s+$/.test(word.text)) {
      if (lines[lines.length - 1].length) { lines[lines.length - 1].push(word); width += ww; }
      continue;
    }
    if (width + ww > maxW && lines[lines.length - 1].length) {
      const last = lines[lines.length - 1];
      while (last.length && /^\s+$/.test(last[last.length - 1].text)) last.pop();
      lines.push([]);
      width = 0;
    }
    lines[lines.length - 1].push(word);
    width += ww;
  }
  if (lines.length > maxLines) return null;
  return lines;
}

function drawTischHead(ctx, spec, p) {
  const W = TISCH_CARD_W;
  const H = TISCH_CARD_HEAD_H;
  const felts = tischCardFelts(spec.felts);
  felts.forEach((felt, i) => {
    ctx.save();
    if (felts.length > 1) {
      // T11.1's "Mehrere Tische": the head divides diagonally into the felts.
      const slice = W / felts.length;
      const lean = 36;
      ctx.beginPath();
      ctx.moveTo(i === 0 ? 0 : slice * i + lean, 0);
      ctx.lineTo(i === felts.length - 1 ? W : slice * (i + 1) + lean, 0);
      ctx.lineTo(i === felts.length - 1 ? W : slice * (i + 1) - lean, H);
      ctx.lineTo(i === 0 ? 0 : slice * i - lean, H);
      ctx.closePath();
      ctx.clip();
    }
    const g = ctx.createRadialGradient(W / 2, -60, 0, W / 2, -60, 440);
    g.addColorStop(0, felt.color);
    g.addColorStop(0.74, felt.deep);
    g.addColorStop(1, felt.deep);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  });
  ctx.fillStyle = p['gold-edge'];
  ctx.fillRect(0, H, W, TISCH_CARD_EDGE);

  // The brand plate and the kicker line.
  const pad = TISCH_CARD_PAD;
  ctx.font = tischFont(800, 14, true);
  ctx.textBaseline = 'alphabetic';
  const brand = 'SPIELWIRBEL';
  const plateW = ctx.measureText(brand).width + 22 + brand.length * 1.6;
  const plate = ctx.createLinearGradient(0, 24, 0, 50);
  plate.addColorStop(0, p['brass-hi']);
  plate.addColorStop(1, p['gold-deep']);
  tischRect(ctx, pad, 24, plateW, 26, 3, plate);
  ctx.fillStyle = p['gold-ink'];
  let bx = pad + 11;
  for (const ch of brand) { ctx.fillText(ch, bx, 42); bx += ctx.measureText(ch).width + 1.6; }

  ctx.font = tischFont(800, 12, true);
  ctx.fillStyle = p['felt-ink'];
  ctx.textAlign = 'right';
  ctx.fillText(recapFit(ctx, spec.kicker.toUpperCase(), W - pad * 2 - plateW - 16), W - pad, 41);
  ctx.textAlign = 'left';

  // The sentence, bottom-anchored, stepping down a size before it gives up a
  // line — a long Finnish title is the normal case, not the edge one.
  const maxW = W - pad * 2;
  const sub = spec.subline ? 1 : 0;
  let size = 36;
  let lines = null;
  for (; size >= 22; size -= 2) {
    ctx.font = tischFont(800, size, true);
    lines = tischWrap(ctx, spec.headline, maxW, 4 - sub);
    if (lines) break;
  }
  if (!lines) {
    ctx.font = tischFont(800, size, true);
    lines = [[{ text: recapFit(ctx, spec.headline.map((r) => r.text).join(''), maxW), gold: false }]];
  }
  const lh = Math.round(size * 1.08);
  let y = H - 24 - (lines.length - 1 + sub) * lh;
  for (const line of lines) {
    let x = pad;
    for (const word of line) {
      ctx.fillStyle = word.gold ? p.gold : p['felt-ink'];
      ctx.fillText(word.text, x, y);
      x += ctx.measureText(word.text).width;
    }
    y += lh;
  }
  if (sub) {
    ctx.fillStyle = p.gold;
    ctx.fillText(recapFit(ctx, spec.subline, maxW), pad, y);
  }
}

// The stamp T4.4 draws on the played game: felt, a check, turned -6°.
function drawTischStamp(ctx, text, x, y, p) {
  ctx.save();
  ctx.font = tischFont(800, 13, true);
  const label = text.toUpperCase();
  const w = ctx.measureText(label).width + 44;
  ctx.translate(x + w / 2, y + 14);
  ctx.rotate(-6 * Math.PI / 180);
  tischRect(ctx, -w / 2, -14, w, 28, 3, p['felt-deep']);
  ctx.strokeStyle = p['felt-ink-soft'];
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-w / 2 + 1, -13, w - 2, 26, 3);
  ctx.stroke();
  tischGlyph(ctx, 'check', -w / 2 + 11, -8, 16, p['felt-ink']);
  ctx.fillStyle = p['felt-ink'];
  ctx.fillText(label, -w / 2 + 31, 5);
  ctx.restore();
}

function drawTischFeature(ctx, f, y, p) {
  const pad = TISCH_CARD_PAD;
  const cw = 102;
  const ch = 128;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  tischCover(ctx, pad, y, cw, ch, p);
  ctx.restore();
  const x = pad + cw + 20;
  const maxW = TISCH_CARD_W - x - pad;
  drawTischStamp(ctx, f.stamp, x, y + 6, p);
  ctx.fillStyle = p.ink;
  if (f.bigIsTitle) {
    ctx.font = tischFont(800, 24, true);
    const lines = tischWrap(ctx, [{ text: f.big, gold: false }], maxW, 2)
      || [[{ text: recapFit(ctx, f.big, maxW) }]];
    lines.forEach((line, i) => ctx.fillText(recapFit(ctx, line.map((w) => w.text).join(''), maxW), x, y + 70 + i * 28));
  } else if (f.big) {
    ctx.font = tischFont(800, 56, true);
    ctx.fillText(f.big, x, y + 96);
  }
  if (f.sub) {
    ctx.fillStyle = p['ink-soft'];
    ctx.font = tischFont(700, 13);
    ctx.fillText(recapFit(ctx, f.sub, maxW), x, y + 120);
  }
  return y + ch;
}

function drawTischPeople(ctx, people, y, p) {
  const pad = TISCH_CARD_PAD;
  const step = 62;
  const fit = Math.floor((TISCH_CARD_W - pad * 2 + (step - 44)) / step);
  const shown = people.length > fit ? people.slice(0, fit - 1) : people;
  const more = people.length - shown.length;
  const slot = (i) => pad + i * step;
  shown.forEach((person, i) => {
    const cx = slot(i) + 22;
    ctx.fillStyle = person.color || p['wood-light'];
    ctx.beginPath();
    ctx.arc(cx, y + 22, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.gold;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = tischFont(800, 15, true);
    ctx.textAlign = 'center';
    ctx.fillText(person.initials || '', cx, y + 28);
    ctx.fillStyle = p['ink-soft'];
    ctx.font = tischFont(700, 11);
    ctx.fillText(recapFit(ctx, person.name, step - 6), cx, y + 60);
    ctx.textAlign = 'left';
    if (person.winner) tischGlyph(ctx, 'crown', cx - 9, y - 14, 18, p.gold);
  });
  if (more > 0) {
    const cx = slot(shown.length) + 22;
    tischRect(ctx, cx - 22, y, 44, 44, 22, p['wood-light']);
    ctx.fillStyle = p.ink;
    ctx.font = tischFont(800, 15, true);
    ctx.textAlign = 'center';
    ctx.fillText(`+${more}`, cx, y + 28);
    ctx.textAlign = 'left';
  }
  return y + 64;
}

function drawTischCounters(ctx, counters, y, p) {
  const pad = TISCH_CARD_PAD;
  const gap = 12;
  const w = (TISCH_CARD_W - pad * 2 - gap * (counters.length - 1)) / counters.length;
  counters.forEach((c, i) => {
    const x = pad + i * (w + gap);
    tischRect(ctx, x, y, w, 56, 4, p['wood-light']);
    ctx.fillStyle = p.gold;
    ctx.font = tischFont(800, 28, true);
    ctx.fillText(String(c.n), x + 14, y + 38);
    const nw = ctx.measureText(String(c.n)).width;
    ctx.fillStyle = p.ink;
    ctx.font = tischFont(700, 13);
    ctx.fillText(recapFit(ctx, c.label, w - nw - 40), x + 24 + nw, y + 35);
  });
  return y + 56;
}

// The Tafel: paper, one ink per row, the winning row gold (T1.7).
function drawTischTafel(ctx, spec, y, p) {
  const pad = TISCH_CARD_PAD;
  const w = TISCH_CARD_W - pad * 2;
  const tableMode = spec.tables.length > 0;
  const rows = tableMode ? spec.tables.slice(0, 4) : spec.rows;
  if (!rows.length) return y;
  const rowH = tableMode ? 52 : TISCH_CARD_ROW_H;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pad, y, w, rows.length * rowH, 4);
  ctx.clip();
  rows.forEach((row, i) => {
    const ry = y + i * rowH;
    let bg = i % 2 ? p['paper-raised'] : p.paper;
    if (row.gold) {
      bg = ctx.createLinearGradient(pad, 0, pad + w, 0);
      bg.addColorStop(0, p['gold-hi']);
      bg.addColorStop(1, p.gold);
    }
    ctx.fillStyle = bg;
    ctx.fillRect(pad, ry, w, rowH);
    ctx.fillStyle = 'rgba(47, 38, 32, 0.12)';
    ctx.fillRect(pad, ry + rowH - 1, w, 1);
    const ink = row.gold ? p['gold-ink'] : p['paper-ink'];
    if (tableMode) {
      tischCover(ctx, pad + 12, ry + 10, 24, 32, p);
      ctx.fillStyle = ink;
      ctx.font = tischFont(800, 15, true);
      ctx.fillText(recapFit(ctx, `${row.label} · ${row.title}`, w - 60), pad + 48, ry + 23);
      ctx.fillStyle = p['paper-ink-soft'];
      ctx.font = tischFont(600, 12);
      ctx.fillText(recapFit(ctx, row.names, w - 60), pad + 48, ry + 41);
      return;
    }
    let x = pad + 14;
    if (row.rank) {
      ctx.fillStyle = ink;
      ctx.font = tischFont(800, 15, true);
      ctx.fillText(row.rank, x, ry + 25);
      x += 18;
      tischCover(ctx, x, ry + 6, 20, 26, p);
      x += 30;
    }
    // The pill: the ramp's fill with its own ink and the face beside the
    // number, so the colour is never the only carrier (WCAG 1.4.1).
    let pillW = 0;
    if (row.pill) {
      ctx.font = tischFont(800, 12, true);
      const faced = row.stop !== null && row.stop !== undefined;
      pillW = ctx.measureText(row.pill).width + (faced ? 36 : 20);
      const px = pad + w - 12 - pillW;
      const fill = faced ? p[row.stop === 'veto' ? 'score-veto' : `score-${row.stop}`] : p['gold-deep'];
      const pink = faced
        ? p[row.stop === 'veto' ? 'score-veto-ink' : (Number(row.stop) <= 2 ? 'score-ink-low' : 'score-ink-high')]
        : p['gold-ink'];
      tischRect(ctx, px, ry + 8, pillW, 22, 11, fill);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(px + 0.5, ry + 8.5, pillW - 1, 21, 11);
      ctx.stroke();
      let tx = px + 10;
      if (faced) {
        const face = CARD_FACES[row.stop === 'veto' ? 0 : Number(row.stop) - 1];
        tischGlyph(ctx, face, tx, ry + 12, 14, pink);
        tx += 17;
      }
      ctx.fillStyle = pink;
      ctx.fillText(row.pill, tx, ry + 23);
    }
    ctx.fillStyle = ink;
    ctx.font = tischFont(800, 15, true);
    ctx.fillText(recapFit(ctx, row.title, pad + w - 24 - pillW - x), x, ry + 25);
  });
  ctx.restore();
  return y + rows.length * rowH;
}

function drawTischFoot(ctx, p, badge) {
  const pad = TISCH_CARD_PAD;
  ctx.fillStyle = p['ink-soft'];
  ctx.font = tischFont(700, 12);
  ctx.fillText('spielwirbel.app', pad, TISCH_CARD_H - 26);
  // "Powered by BGG" on its light carrier — a licence requirement wherever BGG
  // data appears, and the design places it here (T11.1). A same-origin PNG, so
  // drawImage leaves the canvas clean in every engine.
  if (badge && (badge.naturalWidth || badge.width)) {
    const bw = 104;
    const bh = bw * ((badge.naturalHeight || badge.height) / (badge.naturalWidth || badge.width));
    const x = TISCH_CARD_W - pad - bw - 18;
    const y = TISCH_CARD_H - 22 - bh - 10;
    tischRect(ctx, x, y, bw + 18, bh + 10, 3, p.paper);
    ctx.drawImage(badge, x + 9, y + 5, bw, bh);
  }
}

function drawTischCard(ctx, spec, badge) {
  const p = tischPalette();
  ctx.fillStyle = p['page-bg'];
  ctx.fillRect(0, 0, TISCH_CARD_W, TISCH_CARD_H);
  drawTischHead(ctx, spec, p);
  let y = TISCH_CARD_HEAD_H + TISCH_CARD_EDGE + 18;
  if (spec.feature) y = drawTischFeature(ctx, spec.feature, y, p) + 14;
  if (spec.people.length) y = drawTischPeople(ctx, spec.people, y + 10, p) + 8;
  if (spec.counters.length) y = drawTischCounters(ctx, spec.counters, y, p) + 14;
  drawTischTafel(ctx, spec, y, p);
  drawTischFoot(ctx, p, badge);
}

function tischBadge() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // A missing badge must not fail the share — the card is drawn without it.
    img.onerror = () => resolve(null);
    img.src = TISCH_CARD_BADGE;
  });
}

// Render one variant to a PNG Blob. Rejects rather than resolving null, so the
// caller's catch — which reports to the operator (reportClientError) — is the
// one place a failure is seen.
async function tischCardBlob(kind, model) {
  // The two TEXT faces must be usable before the first fillText (recap-card.js
  // constraint 2): ask for them explicitly, since ctx.font never loads one.
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all([tischFont(800, 36, true), tischFont(700, 13), tischFont(600, 12)].map((f) => document.fonts.load(f)));
    } catch { /* a face that cannot load leaves the card in the fallback */ }
  }
  const spec = tischCardSpec(kind, model);
  const badge = await tischBadge();
  const canvas = document.createElement('canvas');
  canvas.width = TISCH_CARD_W * TISCH_CARD_SCALE;
  canvas.height = TISCH_CARD_H * TISCH_CARD_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(TISCH_CARD_SCALE, TISCH_CARD_SCALE);
  drawTischCard(ctx, spec, badge);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

// Which card the worn design draws, or null for the classic one. Read at click
// time: the design can change between rendering a button and pressing it.
function designCard() {
  const d = typeof activeDesign === 'function' ? activeDesign() : null;
  return (d && d.card) || null;
}

/* The results screen's „Teilen" while a design with its own card is worn: the
   card as a PNG, WITH the message text beside it, through the user's own share
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
  let blob;
  try {
    blob = await tischCardBlob(model.outcome === 'split' ? 'split' : 'session', model);
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
