/* Spielwirbel – Ocean's shareable card (#1220), from
   docs/design/ocean/Ocean-O8-Farben.dc.html (O8.3 „Rückblickkarte").

   Three formats, one picture: water above, the text on an opaque band below.

   - `session`   1080x1350, the results screen's „Teilen" on a phone.
   - `landscape` 1200x630, the same session at link-preview proportions — what
                 the results screen shares from a wide landscape screen, where
                 a desktop chat lays an image out at 1.91:1 (oceanShareKind).
   - `period`    1080x1350, the Chronik's and the profile's period recap: the
                 same form, more numbers.

   EVERY STRING SITS ON AN OPAQUE BAND, never on the water gradient. That was
   the review's finding on the landscape sheet („spielwirbel.app" at 2.66:1 on
   the gradient), and it is a rule here rather than a per-format decision: the
   gradient's dark end is exactly where nobody measures. The bands are
   `--surface`, and every ink drawn on them is in OCEAN_CARD_TEXT, which
   test/recap-card-ocean.test.js measures against that surface.

   WHAT NEVER GOES ON THE CARD (O8.3, a privacy commitment, not styling): no
   surnames, no faces, no individual ratings, no place, no time. So a winner is
   printed by FIRST NAME only, with initials taken from that first name (the
   model's own initials carry the surname's letter); the date comes from the
   model's `day`, never its `when`, which carries the time of day; the score is
   the group's; and nobody who did not win appears at all.

   The constraints of recap-card.js and recap-card-tisch.js all hold: no cover
   art, no pattern (WebKit taints a canvas on a pattern from an SVG image —
   .claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md), no icon font.
   The whirl is a Path2D fill (card-glyphs.js), the whale is canvas paths, the
   cover stand-in is a gradient, and the one image is the same-origin BGG badge
   via drawImage.

   Colours are Ocean's tokens as a COPY (OCEAN_CARD_TOKENS), licensed by the
   parity test against test/support/theme.js — the TISCH_CARD_TOKENS shape and
   reason (.claude/rules/shared-constants-across-the-stack.md): the token names
   are shared by every design, so a live read under any other design's cascade
   would paint that design's colours under Ocean's layout.

   No module.exports — DOM/canvas code, reached through the jsdom harness. Load
   order: after recap-card.js (recapColor, recapFit, recapMarker,
   recapCardBlocks), card-glyphs.js and recap-card-tisch.js (tischWrap,
   tischBadge). */

'use strict';

const OCEAN_CARD_SCALE = 2;
// Logical sizes; the backing store is twice each.
const OCEAN_CARD_SIZES = {
  session: [540, 675],
  landscape: [600, 315],
  period: [540, 675],
};
const OCEAN_CARD_PAD = 30;

// Ocean's tokens, keyed by their name in ocean.css (see the header for why a
// copy; the parity test is what keeps it one). `--brand` is the registry's
// `accent`, which paintDesign writes and the test resolves the same way.
const OCEAN_CARD_TOKENS = {
  '--surface': '#f7fbfc', '--ink': '#10283a', '--ink-soft': '#3f5a6b', '--brand': '#0e6690',
  '--line-soft': '#dfebf1',
  '--water-foam': '#eef7fa', '--water-surf': '#dcecf2', '--water-flat': '#cfe3ec',
  '--water-mid': '#7fb4d3',
  '--whale': '#2f6d94', '--whale-shade': '#1f4f72', '--whale-deep': '#163a55',
  '--deep-ink': '#f7fbfc',
  '--score-1': '#23305c', '--score-2': '#35609a', '--score-3': '#6a9fd0',
  '--score-4': '#b7d4ee', '--score-5': '#f2e394', '--score-veto': '#4a1942',
  '--score-ink-low': '#f7fbfc', '--score-ink-high': '#10283a', '--score-veto-ink': '#f7fbfc',
};

// The cover stand-in O8.3 draws — its two oklch() stops written out as hex,
// because a canvas in an older WebKit may not parse oklch(). Never a real
// cover: provider art may not be redistributed, and it would taint the canvas.
const OCEAN_CARD_COVER = ['#008e96', '#00456b'];

// Every ink the card writes text in, and what it is written on. Data rather
// than prose so the spec can measure each pair (>= 4.5:1, every size) — and so
// a new string cannot be added in a colour nobody measured without the drawing
// test noticing it (it checks every fillText's fillStyle against this list).
const OCEAN_CARD_TEXT = [
  { ink: '--ink', on: '--surface' },
  { ink: '--ink-soft', on: '--surface' },
  { ink: '--brand', on: '--surface' },
  { ink: '--score-ink-low', on: '--score-1' },
  { ink: '--score-ink-low', on: '--score-2' },
  { ink: '--score-ink-high', on: '--score-3' },
  { ink: '--score-ink-high', on: '--score-4' },
  { ink: '--score-ink-high', on: '--score-5' },
  { ink: '--score-veto-ink', on: '--score-veto' },
];

function oceanPalette() {
  const p = {};
  for (const [name, value] of Object.entries(OCEAN_CARD_TOKENS)) p[name.slice(2)] = value;
  return p;
}

const oceanFont = (weight, size, display) =>
  `${weight} ${size}px ${display ? '"Comfortaa", "Figtree", sans-serif' : '"Figtree", sans-serif'}`;

// A first name, and nothing after it: „Anna Müller" -> „Anna", and a guest's
// „Anna (Gast)" -> „Anna". The card never prints a surname (O8.3).
function oceanFirstName(name) {
  return String(name == null ? '' : name).trim().split(/\s+/)[0] || '';
}

// The round's marker as one of OCEAN's eight colours, or the accent. Matched
// like tischCardFelts: a marker painted by another design's set is not an
// Ocean colour, and the disc then falls back rather than wearing it.
function oceanCardMarker(p) {
  const mine = recapMarker();
  if (!mine) return p.brand;
  const hit = designMarkers('ocean').find((m) => recapColor(m.color) === mine.color);
  return hit ? hit.color : p.brand;
}

/* ---------------------------------------------------------------- the model */

// The card's content as plain data — the one pass both the drawing and the
// spec read, so what is drawn is what was decided here.
function oceanCardSpec(kind, model) {
  if (kind === 'period') {
    const blocks = recapCardBlocks(model);
    const stats = [
      { n: String(model.sessions), what: t('periodRecap.label.sessions') },
      { n: String(model.gamesPlayed), what: t('periodRecap.label.gamesPlayed') },
      ...blocks.shelf.map((s) => ({ n: `${s.plus ? '+' : ''}${s.n}`, what: s.label })),
    ];
    return {
      kind,
      pill: model.heading || '',
      kicker: '',
      title: model.periodLabel || '',
      stats,
      named: blocks.rows.map((r) => ({ label: r.label, value: r.value, sub: r.sub || '' })),
      winners: [],
      winText: '',
      score: null,
    };
  }

  // A session, in either proportion. The split session has no winner or score
  // of its own; it names its tables instead.
  if (model.outcome === 'split') {
    return {
      kind, pill: model.roundName || '', kicker: model.day || '', title: t('result.titleSplit'),
      stats: [], named: [], winners: [], score: null,
      winText: (model.tables || []).map((tb) => tb.title).filter(Boolean).join(' · '),
    };
  }
  const people = Array.isArray(model.people) ? model.people : [];
  const winning = people.filter((p) => p.winner);
  // Winners come from `people` (which carries the colour); a model without it
  // falls back to the bare names, colourless.
  const winners = (winning.length ? winning : (model.winnerNames || []).map((name) => ({ name, color: null })))
    .map((p) => {
      const first = oceanFirstName(p.name);
      return { first, initials: first.slice(0, 2).toUpperCase(), color: p.color || null };
    })
    .filter((w) => w.first);
  const played = model.playedTitle
    ? (model.rows || []).find((r) => r.title === model.playedTitle && r.count) : null;
  let winText = '';
  if (winners.length) winText = tn(winners.length, 'chronik.wonOne', 'chronik.won', { names: joinNames(winners.map((w) => w.first)) });
  else if (model.ending === 'lost') winText = t('result.endedLost');
  // No game chosen (a cancelled or undecided session): the screen's own
  // sentence, minus the trophy emoji a canvas would draw in whatever colour
  // face the platform has.
  let title = model.playedTitle || '';
  if (!title) {
    title = shareHeadline(model, t, joinNames, tn) || t('result.title');
    if (title.startsWith(SHARE_TROPHY)) title = title.slice(SHARE_TROPHY.length).trimStart();
  }
  return {
    kind,
    pill: model.roundName || '',
    kicker: model.day || '',
    title,
    // The landscape card says it as a sentence (O8.3: „Nordlichter wurde gespielt.").
    sentence: model.playedTitle ? t('result.titlePlayed', { game: model.playedTitle }) : title,
    stats: [],
    named: [],
    winners,
    winText,
    score: played ? { text: fmtAvg(played.score), stop: rampStop(played.score) } : null,
  };
}

/* ------------------------------------------------------------------ drawing */

function oceanRect(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

// A Tabler outline at (x, y), `size` px square — see card-glyphs.js.
function oceanGlyph(ctx, name, x, y, size, color) {
  if (typeof Path2D === 'undefined' || !CARD_GLYPHS[name]) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / CARD_GLYPH_BOX, size / CARD_GLYPH_BOX);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(CARD_GLYPHS[name]));
  ctx.restore();
}

// Tracked capitals, drawn letter by letter: `ctx.letterSpacing` is not in
// every WebKit this app supports.
function oceanCaps(ctx, text, x, y, maxW) {
  const s = recapFit(ctx, String(text).toUpperCase(), maxW - String(text).length * 1.4);
  let cx = x;
  for (const ch of s) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + 1.4; }
}

// The water: foam to surf above the waterline, the mid water to the whale's
// blue below it. A hard stop at the line, as O8.3 draws it.
function oceanWater(ctx, w, h, line, p) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, p['water-foam']);
  g.addColorStop(line, p['water-surf']);
  g.addColorStop(line, p['water-mid']);
  g.addColorStop(1, p.whale);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// O8.3's whale surfacing: a body, a tail, an eye. Plain paths. `k` scales it.
function oceanWhale(ctx, x, y, k, p) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  const body = ctx.createLinearGradient(0, 0, 0, 68);
  body.addColorStop(0, p.whale);
  body.addColorStop(1, p['whale-shade']);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, 50);
  ctx.bezierCurveTo(0, 8, 40, 0, 88, 0);
  ctx.bezierCurveTo(140, 0, 170, 22, 170, 46);
  ctx.bezierCurveTo(170, 62, 150, 68, 120, 68);
  ctx.lineTo(40, 68);
  ctx.bezierCurveTo(14, 68, 0, 62, 0, 50);
  ctx.fill();
  ctx.fillStyle = p['whale-shade'];
  ctx.beginPath();
  ctx.moveTo(158, 30);
  ctx.lineTo(188, 22);
  ctx.lineTo(208, 2);
  ctx.lineTo(198, 26);
  ctx.lineTo(208, 50);
  ctx.lineTo(188, 36);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = p['deep-ink'];
  ctx.beginPath();
  ctx.arc(34, 30, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The played game's box: O8.3's stand-in gradient with the whirl on it.
function oceanCover(ctx, cx, cy, w, h, tilt) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt * Math.PI / 180);
  ctx.shadowColor = 'rgba(14, 60, 90, 0.4)';
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 20;
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, OCEAN_CARD_COVER[0]);
  g.addColorStop(1, OCEAN_CARD_COVER[1]);
  oceanRect(ctx, -w / 2, -h / 2, w, h, 14, g);
  ctx.restore();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt * Math.PI / 180);
  const s = h * 0.46;
  oceanGlyph(ctx, 'tornado', -s / 2, -s / 2, s, 'rgba(247, 251, 252, 0.72)');
  ctx.restore();
}

// The round's name on an opaque pill with its marker disc (O8.3, top left).
function oceanPill(ctx, text, x, y, maxW, p) {
  if (!text) return;
  ctx.font = oceanFont(700, 18);
  const label = recapFit(ctx, text, maxW - 62);
  const w = ctx.measureText(label).width + 62;
  oceanRect(ctx, x, y, w, 40, 20, p.surface);
  oceanRect(ctx, x + 7, y + 6, 28, 28, 14, oceanCardMarker(p));
  oceanGlyph(ctx, 'tornado', x + 12, y + 11, 18, p['deep-ink']);
  ctx.fillStyle = p.ink;
  ctx.fillText(label, x + 44, y + 27);
}

// Word-wrap `text` in the context's current font to at most `maxLines`; a
// text that needs more keeps its first lines and ellipsizes the last, so a
// long title is shortened rather than overflowing the band.
function oceanLines(ctx, text, maxW, maxLines) {
  const wrapped = tischWrap(ctx, [{ text: String(text), gold: false }], maxW, 99) || [[{ text: String(text) }]];
  const lines = wrapped.map((l) => l.map((w) => w.text).join(''));
  if (lines.length <= maxLines) return lines.map((l) => recapFit(ctx, l, maxW));
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = recapFit(ctx, `${kept[maxLines - 1]} ${lines[maxLines]}`, maxW);
  return kept;
}

// Display text, stepping down a size before giving up a line. Returns
// { lines, size }.
function oceanTitleLines(ctx, text, maxW, from, to, maxLines) {
  for (let size = from; size >= to; size -= 2) {
    ctx.font = oceanFont(700, size, true);
    const lines = tischWrap(ctx, [{ text, gold: false }], maxW, maxLines);
    if (lines) return { size, lines: lines.map((l) => l.map((w) => w.text).join('')) };
  }
  ctx.font = oceanFont(700, to, true);
  return { size: to, lines: oceanLines(ctx, text, maxW, maxLines) };
}

// The score pill: the ramp's fill with its FIXED ink (O8.2), never computed
// from the fill's lightness.
function oceanScorePill(ctx, score, right, y, h, size, p) {
  ctx.font = oceanFont(700, size);
  const w = ctx.measureText(score.text).width + 30;
  const stop = score.stop;
  const fill = stop === 'veto' ? p['score-veto'] : p[`score-${stop}`] || p['score-5'];
  const ink = stop === 'veto' ? p['score-veto-ink'] : (Number(stop) <= 2 ? p['score-ink-low'] : p['score-ink-high']);
  oceanRect(ctx, right - w, y, w, h, h / 2, fill);
  ctx.fillStyle = ink;
  ctx.fillText(score.text, right - w + 15, y + h / 2 + size * 0.36);
  return w;
}

// The winners' discs: a ring in their colour, their first-name initials in ink
// on the band's surface.
function oceanAvatars(ctx, winners, x, cy, r, p) {
  const shown = winners.slice(0, 3);
  // Side by side, never overlapping: an overlap hid the first winner's initials.
  const step = r * 2 + 6;
  shown.forEach((w, i) => {
    const cx = x + r + i * step;
    ctx.fillStyle = p.surface;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = w.color || p.brand;
    ctx.lineWidth = r * 0.24;
    ctx.beginPath();
    ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = p.ink;
    ctx.font = oceanFont(700, Math.round(r * 0.7));
    ctx.textAlign = 'center';
    ctx.fillText(w.initials, cx, cy + r * 0.25);
    ctx.textAlign = 'left';
  });
  return shown.length ? r * 2 + (shown.length - 1) * step : 0;
}

// "Powered by BGG" — a licence requirement wherever BGG data appears, as on
// Der Tisch's card. A same-origin PNG, so drawImage leaves the canvas clean.
function oceanBadge(ctx, badge, right, baseline, width) {
  if (!(badge && (badge.naturalWidth || badge.width))) return;
  const bh = width * ((badge.naturalHeight || badge.height) / (badge.naturalWidth || badge.width));
  ctx.drawImage(badge, right - width, baseline - bh + 2, width, bh);
}

function drawOceanSession(ctx, spec, p, badge) {
  const [W, H] = OCEAN_CARD_SIZES.session;
  const pad = OCEAN_CARD_PAD;
  const inner = W - pad * 2;
  const title = oceanTitleLines(ctx, spec.title, inner, 36, 26, 2);
  const lh = Math.round(title.size * 1.12);
  // The winner row: discs, the sentence, the score pill. Measured before the
  // band is drawn, so a sentence that needs a second line grows the band
  // rather than being cut („Jonas, Lea und Konstantin haben gewonnen").
  const hasRow = !!(spec.winText || spec.score);
  const discs = Math.min(spec.winners.length, 3);
  const aw = discs ? discs * 54 - 6 : 0;
  ctx.font = oceanFont(700, 26);
  const pillW = spec.score ? ctx.measureText(spec.score.text).width + 30 : 0;
  const tx = pad + aw + (aw ? 14 : 0);
  const textW = pad + inner - tx - (pillW ? pillW + 14 : 0);
  // Three winners beside three discs is the tight case: step the size down
  // before cutting the sentence people came to read.
  let rowSize = 21;
  let rowText = [];
  if (hasRow) {
    const said = spec.winText || t('score.name');
    for (; rowSize >= 17; rowSize -= 2) {
      ctx.font = oceanFont(700, rowSize);
      const fit = tischWrap(ctx, [{ text: said, gold: false }], textW, 2);
      if (fit) { rowText = fit.map((l) => l.map((w) => w.text).join('')); break; }
    }
    if (!rowText.length) { rowSize = 17; ctx.font = oceanFont(700, 17); rowText = oceanLines(ctx, said, textW, 2); }
  }
  const rowLh = Math.round(rowSize * 1.24);
  const rowH = hasRow ? Math.max(50, rowText.length * rowLh + 4) : 0;
  const bandH = 28 + 18 + 12 + lh * title.lines.length + (rowH ? 10 + rowH : 0) + 16 + 18 + 26;
  const bandTop = H - bandH;

  oceanWater(ctx, W, H, 0.46, p);
  oceanPill(ctx, spec.pill, pad, pad, inner, p);
  oceanCover(ctx, W / 2, 262, 284, 213, -4);
  oceanWhale(ctx, 185, bandTop - 38, 1, p);

  ctx.fillStyle = p.surface;
  ctx.fillRect(0, bandTop, W, bandH);
  let y = bandTop + 28 + 12;
  ctx.fillStyle = p.brand;
  ctx.font = oceanFont(700, 15);
  oceanCaps(ctx, spec.kicker, pad, y, inner);
  y += 12;
  ctx.fillStyle = p.ink;
  ctx.font = oceanFont(700, title.size, true);
  title.lines.forEach((line) => { y += lh; ctx.fillText(line, pad, y - lh * 0.2); });
  if (rowH) {
    y += 10;
    const cy = y + rowH / 2;
    oceanAvatars(ctx, spec.winners, pad, cy, 24, p);
    if (spec.score) oceanScorePill(ctx, spec.score, pad + inner, cy - 20, 40, 26, p);
    ctx.fillStyle = spec.winners.length ? p.ink : p['ink-soft'];
    ctx.font = oceanFont(700, rowSize);
    const top = cy - (rowText.length * rowLh) / 2;
    rowText.forEach((line, i) => ctx.fillText(line, tx, top + rowLh * 0.77 + i * rowLh));
    y += rowH;
  }
  y += 16 + 16;
  ctx.fillStyle = p['ink-soft'];
  ctx.font = oceanFont(600, 16);
  ctx.fillText('spielwirbel.app', pad, y);
  oceanBadge(ctx, badge, pad + inner, y, 96);
}

function drawOceanLandscape(ctx, spec, p, badge) {
  const [W, H] = OCEAN_CARD_SIZES.landscape;
  const left = 245;
  oceanWater(ctx, W, H, 0.6, p);
  oceanCover(ctx, left / 2, H / 2, 185, 139, 0);

  // The band: the whole right column, opaque — O8.3's landscape fix.
  ctx.fillStyle = p.surface;
  ctx.fillRect(left, 0, W - left, H);
  const pad = 30;
  const x = left + pad;
  const inner = W - left - pad * 2;
  const title = oceanTitleLines(ctx, spec.sentence || spec.title, inner, 30, 22, 3);
  const lh = Math.round(title.size * 1.14);
  ctx.font = oceanFont(700, 19);
  const said = [spec.winText, spec.score && spec.score.text].filter(Boolean).join(' · ');
  const line = said ? oceanLines(ctx, said, inner, 2) : [];
  const blockH = 16 + 10 + lh * title.lines.length + (line.length ? 4 + 24 * line.length : 0) + 14 + 16;
  let y = (H - blockH) / 2 + 14;
  ctx.fillStyle = p.brand;
  ctx.font = oceanFont(700, 14);
  oceanCaps(ctx, [spec.pill, spec.kicker].filter(Boolean).join(' · '), x, y, inner);
  y += 10;
  ctx.fillStyle = p.ink;
  ctx.font = oceanFont(700, title.size, true);
  title.lines.forEach((l) => { y += lh; ctx.fillText(l, x, y - lh * 0.2); });
  if (line.length) {
    y += 4;
    ctx.fillStyle = p.ink;
    ctx.font = oceanFont(700, 19);
    line.forEach((l) => { y += 24; ctx.fillText(l, x, y); });
  }
  y += 14 + 16;
  ctx.fillStyle = p['ink-soft'];
  ctx.font = oceanFont(600, 15);
  ctx.fillText('spielwirbel.app', x, y);
  oceanBadge(ctx, badge, x + inner, y, 84);
}

function drawOceanPeriod(ctx, spec, p, badge) {
  const [W, H] = OCEAN_CARD_SIZES.period;
  const pad = OCEAN_CARD_PAD;
  oceanWater(ctx, W, H, 0.17, p);
  oceanPill(ctx, spec.pill, pad, pad, W - pad * 2 - 150, p);
  oceanWhale(ctx, W - pad - 208 * 0.8, 58, 0.8, p);

  // The band: from under the pill to the foot, the whole width, opaque.
  const top = 110;
  ctx.fillStyle = p.surface;
  ctx.fillRect(0, top, W, H - top);
  const inner = W - pad * 2;
  const title = oceanTitleLines(ctx, spec.title, inner, 36, 26, 2);
  const lh = Math.round(title.size * 1.12);
  let y = top + 20;
  ctx.fillStyle = p.ink;
  ctx.font = oceanFont(700, title.size, true);
  title.lines.forEach((l) => { y += lh; ctx.fillText(l, pad, y - lh * 0.2); });
  y += 10;

  // The numbers, then the named rows; each row's height gives way before the
  // foot would be crowded, since a busy period is the normal case.
  const foot = H - 30;
  const space = foot - 34 - y;
  const want = spec.stats.length * 54 + spec.named.length * 64;
  const k = want > space ? space / want : 1;
  const statH = 54 * k;
  const namedH = 64 * k;
  spec.stats.forEach((s) => {
    ctx.fillStyle = p['line-soft'];
    ctx.fillRect(pad, y + statH - 1, inner, 1);
    ctx.fillStyle = p.ink;
    ctx.font = oceanFont(700, 34, true);
    ctx.fillText(s.n, pad, y + statH * 0.5 + 13);
    ctx.fillStyle = p['ink-soft'];
    ctx.font = oceanFont(600, 19);
    ctx.fillText(recapFit(ctx, s.what, inner - 96), pad + 96, y + statH * 0.5 + 8);
    y += statH;
  });
  spec.named.forEach((r) => {
    ctx.fillStyle = p['line-soft'];
    ctx.fillRect(pad, y + namedH - 1, inner, 1);
    ctx.fillStyle = p.brand;
    ctx.font = oceanFont(700, 13);
    oceanCaps(ctx, r.label, pad, y + namedH * 0.5 - 8, inner);
    ctx.font = oceanFont(700, 19);
    const subW = r.sub ? ctx.measureText(r.sub).width + 16 : 0;
    ctx.fillStyle = p.ink;
    ctx.font = oceanFont(700, 22, true);
    ctx.fillText(recapFit(ctx, r.value, inner - subW), pad, y + namedH * 0.5 + 20);
    if (r.sub) {
      ctx.fillStyle = p.brand;
      ctx.font = oceanFont(700, 19);
      ctx.textAlign = 'right';
      ctx.fillText(r.sub, pad + inner, y + namedH * 0.5 + 20);
      ctx.textAlign = 'left';
    }
    y += namedH;
  });

  ctx.fillStyle = p['ink-soft'];
  ctx.font = oceanFont(600, 16);
  ctx.fillText('spielwirbel.app', pad, foot);
  oceanBadge(ctx, badge, pad + inner, foot, 96);
}

function drawOceanCard(ctx, spec, badge) {
  const p = oceanPalette();
  ctx.textBaseline = 'alphabetic';
  if (spec.kind === 'period') drawOceanPeriod(ctx, spec, p, badge);
  else if (spec.kind === 'landscape') drawOceanLandscape(ctx, spec, p, badge);
  else drawOceanSession(ctx, spec, p, badge);
}

// Render one format to a PNG Blob. Rejects rather than resolving null, so the
// caller's catch — which reports to the operator (reportClientError, in
// shareRecapCard and shareResultCard) — is the one place a failure is seen.
async function oceanCardBlob(kind, model) {
  const size = OCEAN_CARD_SIZES[kind] || OCEAN_CARD_SIZES.session;
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all([oceanFont(700, 36, true), oceanFont(700, 18), oceanFont(600, 16)].map((f) => document.fonts.load(f)));
    } catch { /* a face that cannot load leaves the card in the fallback */ }
  }
  const spec = oceanCardSpec(kind in OCEAN_CARD_SIZES ? kind : 'session', model);
  const badge = await tischBadge();
  const canvas = document.createElement('canvas');
  canvas.width = size[0] * OCEAN_CARD_SCALE;
  canvas.height = size[1] * OCEAN_CARD_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(OCEAN_CARD_SCALE, OCEAN_CARD_SCALE);
  drawOceanCard(ctx, spec, badge);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
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
