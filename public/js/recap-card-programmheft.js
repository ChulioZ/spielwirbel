/* Spielwirbel – Das Programmheft's shareable card (#1381), from
   docs/design/programmheft/Programmheft-P8-Farben.dc.html (P8.4
   „Rückblickkarte").

   One portrait form, drawn at 540x675 and exported at 1080x1350 (x2), for a
   session and for a period recap. A newspaper front page: the vermilion
   masthead, the round's marker band, the round's name over a 3px rule, the
   played game's box with its „Gespielt" stamp beside the headline, three
   facts, and a table of at most three rows.

   THE EXPORTED SIZE IS WHAT THE RULES APPLY TO. The smallest drawn text is
   12px, which is 24px in the image — keep that relationship if anything here
   changes (test/recap-card-programmheft.test.js asserts every font it sets).

   Two inks are DISPLAY-ONLY: the vermilion and the score ramp's light end are
   3.8:1 on paper, which P1 allows only for Anton from 24px. PROGRAMMHEFT_CARD_TEXT
   marks them `display`, and the spec asserts every fillText in one of those
   inks is set in Anton at 24px or more.

   No text on the cover (P8.4): the stamp stands on its own paper below it. The
   card carries itself on facts — game, winner, score, streak, count — and on a
   tie the winner's name becomes a list while the table stays three rows.

   The constraints of recap-card.js and recap-card-tisch.js all hold: no cover
   art, no pattern, no SVG (WebKit taints a canvas on a pattern from an SVG
   image — .claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md), no icon
   font. Only surfaces and type; the one image is the same-origin BGG badge via
   drawImage.

   Colours are Das Programmheft's tokens as a COPY (PROGRAMMHEFT_CARD_TOKENS),
   licensed by the parity test against test/support/theme.js — the
   TISCH_CARD_TOKENS shape and reason
   (.claude/rules/shared-constants-across-the-stack.md): the token names are
   shared by every design, so a live read under any other cascade would paint
   that design's colours under this layout.

   „AUSGABE NR." (the sheet's masthead number) is NOT drawn: nothing in the data
   counts editions, and the issue said to drop it rather than invent a counter.
   The masthead carries the session's number in the round instead
   (sessionNumber, session-tally.js) — the one count the data backs.

   No module.exports — DOM/canvas code, reached through the jsdom harness. Load
   order: after recap-card.js (recapColor, recapFit, recapMarker,
   recapCardBlocks) and recap-card-tisch.js (tischWrap, tischRuns, tischBadge). */

'use strict';

const PROGRAMMHEFT_CARD_SCALE = 2;
const PROGRAMMHEFT_CARD_W = 540;
const PROGRAMMHEFT_CARD_H = 675;
const PROGRAMMHEFT_CARD_PAD = 22;
// P8.4: „the table stays three rows".
const PROGRAMMHEFT_CARD_ROWS = 3;

// Das Programmheft's tokens, keyed by their name in programmheft.css (see the
// header for why a copy; the parity test is what keeps it one). `--page-bg`
// and `--brand` are the registry's `page` and `accent`, which paintDesign
// writes and the test resolves the same way.
const PROGRAMMHEFT_CARD_TOKENS = {
  '--page-bg': '#fbfaf6', '--ink': '#141414', '--ink-soft': '#5f5b56', '--brand': '#b8330f',
  '--vermilion': '#e8451c', '--on-vermilion': '#141414', '--gold-soft': '#f6e7b9',
  '--ramp-1': '#e8451c', '--ramp-2': '#b23d1c', '--ramp-3': '#7a4a3a', '--ramp-4': '#4a3f3a',
  '--ramp-5': '#141414', '--veto-ink': '#b8330f',
};

// Every ink the card writes text in, and what it is written on. `display`
// pairs clear only the large-text bar (3:1) and may be drawn only in Anton at
// 24px or more — P1's rule for the vermilion. Data rather than prose, so the
// spec can measure each pair and check every fillText against the list.
const PROGRAMMHEFT_CARD_TEXT = [
  { ink: '--ink', on: '--page-bg' },
  { ink: '--ink-soft', on: '--page-bg' },
  { ink: '--brand', on: '--page-bg' },
  { ink: '--on-vermilion', on: '--vermilion' },
  { ink: '--ink', on: '--gold-soft' },
  { ink: '--ramp-2', on: '--page-bg' },
  { ink: '--ramp-3', on: '--page-bg' },
  { ink: '--ramp-4', on: '--page-bg' },
  { ink: '--ramp-5', on: '--page-bg' },
  { ink: '--veto-ink', on: '--page-bg' },
  { ink: '--vermilion', on: '--page-bg', display: true },
  { ink: '--ramp-1', on: '--page-bg', display: true },
];

function programmheftPalette() {
  const p = {};
  for (const [name, value] of Object.entries(PROGRAMMHEFT_CARD_TOKENS)) p[name.slice(2)] = value;
  return p;
}

const programmheftFont = (weight, size, display) =>
  `${display ? 400 : weight} ${size}px ${display ? '"Anton", "Archivo", sans-serif' : '"Archivo", sans-serif'}`;

// The round's marker as one of Das Programmheft's eight, with its deep stop,
// or Zinnober — the design's default (P8.2). Matched like oceanCardMarker: a
// marker another design painted is not one of these, and falls back.
function programmheftCardMarker() {
  const set = designMarkers('programmheft');
  const mine = recapMarker();
  const hit = mine && set.find((m) => recapColor(m.color) === mine.color);
  const m = hit || set[0] || { color: PROGRAMMHEFT_CARD_TOKENS['--vermilion'] };
  return { color: m.color, deep: m.deep || m.color };
}

/* What the results screen adds to its share model under this design, at click
   time like the rest of it: the long date, the session's number in the round
   and the winner's streak as of THIS session. The streak is the Pokale's own
   (winStreak) over the finished sessions up to this one, with this session
   taken as the closure holds it — its stored copy may not be finished yet — and
   it waits for YOUNG_ROUND_SERIES_FROM exactly as the Pokale card does. */
function programmheftEdition(round, session, winnerIds) {
  const at = String(session.createdAt);
  const before = (round.sessions || []).filter((s) => s.id !== session.id && s.finished && String(s.createdAt) <= at);
  const here = { ...session, finished: true, winnerIds: (winnerIds || []).slice() };
  const run = winStreak(round, [...before, here], { sessionEnding, sessionPartyCount });
  const young = youngRoundPlayed(round, hubDeps()) < YOUNG_ROUND_SERIES_FROM;
  // This session's winners hold the run whenever it ends here — a tie included
  // (#1421), since the walk starts from their night.
  const own = run.lastId === session.id && run.memberIds.length > 0;
  return {
    dayLong: new Date(session.createdAt).toLocaleDateString(localeTag(locale), { day: 'numeric', month: 'long', year: 'numeric' }),
    sessionNo: sessionNumber(round, session),
    streak: !young && own && run.n >= 2 ? run.n : null,
  };
}

/* ---------------------------------------------------------------- the model */

// The card's content as plain data — the one pass both the drawing and the
// spec read, so what is drawn is what was decided here.
function programmheftCardSpec(kind, model) {
  if (kind === 'period') {
    const blocks = recapCardBlocks(model);
    return {
      kind,
      masthead: '',
      round: model.heading || '',
      date: '',
      cover: false,
      headline: [{ text: String(model.periodLabel || ''), hot: false }],
      facts: [
        { k: t('periodRecap.label.sessions'), v: String(model.sessions) },
        { k: t('periodRecap.label.gamesPlayed'), v: String(model.gamesPlayed) },
        ...blocks.shelf.map((s) => ({ k: s.label, v: `${s.plus ? '+' : ''}${s.n}` })),
      ],
      rows: blocks.rows.map((r) => ({ label: r.label, title: r.value, score: r.sub || '', stop: null, win: false })),
    };
  }

  const masthead = model.sessionNo ? t('card.programmheft.sessionNo', { n: model.sessionNo }) : '';
  const date = model.dayLong || model.day || '';
  // A split session names its tables; it has no winner or score of its own.
  if (model.outcome === 'split') {
    return {
      kind, masthead, round: model.roundName || '', date, cover: false,
      headline: [{ text: t('result.titleSplit'), hot: false }],
      facts: [],
      rows: (model.tables || []).slice(0, PROGRAMMHEFT_CARD_ROWS).map((tb, i) => ({
        place: String(i + 1), title: tb.title || '', score: '', stop: null, win: false,
      })),
    };
  }

  // The headline is the results screen's own sentence — the builder the text
  // share uses — minus the trophy, an emoji the canvas would draw in whatever
  // colour face the platform has. The winners' names are the vermilion run.
  const winners = model.winnerNames || [];
  const names = winners.length ? joinNames(winners) : '';
  let sentence = shareHeadline(model, t, joinNames, tn) || t('result.title');
  if (sentence.startsWith(SHARE_TROPHY)) sentence = sentence.slice(SHARE_TROPHY.length).trimStart();
  const headline = tischRuns(sentence, names).map((r) => ({ text: r.text, hot: r.gold }));

  const played = model.playedTitle ? (model.rows || []).find((r) => r.title === model.playedTitle && r.count) : null;
  const facts = [];
  if (played) facts.push({ k: t('card.programmheft.score'), v: fmtAvg(played.score) });
  if (winners.length > 1) facts.push({ k: t('card.programmheft.shared'), v: t('card.programmheft.winners', { n: winners.length }) });
  else if (model.streak) facts.push({ k: t('card.programmheft.streak'), v: t('card.programmheft.streakN', { n: model.streak }) });
  else if (played) facts.push({ k: t('card.programmheft.ratings'), v: String(played.count) });
  const people = Array.isArray(model.people) ? model.people.length : 0;
  if (people) facts.push({ k: t('card.programmheft.present'), v: String(people) });

  return {
    kind: 'session',
    masthead,
    round: model.roundName || '',
    date,
    cover: !!model.playedTitle && !model.cancelled,
    headline,
    facts: facts.slice(0, 3),
    rows: (model.rows || []).filter((r) => r.place && r.count).slice(0, PROGRAMMHEFT_CARD_ROWS).map((r) => ({
      place: String(r.place),
      title: r.title,
      score: fmtAvg(r.score),
      stop: rampStop(r.score),
      win: !!model.playedTitle && r.title === model.playedTitle,
    })),
  };
}

/* ------------------------------------------------------------------ drawing */

// Tracked text, drawn letter by letter: `ctx.letterSpacing` is not in every
// WebKit this app supports. `align` 'right' ends the run at x.
function programmheftTracked(ctx, text, x, y, track, maxW, align) {
  let s = String(text || '');
  const widthOf = (str) => [...str].reduce((w, ch) => w + ctx.measureText(ch).width, 0) + Math.max(0, [...str].length - 1) * track;
  while (s.length > 1 && widthOf(s) > maxW) s = `${s.slice(0, -2).trimEnd()}…`;
  let cx = align === 'right' ? x - widthOf(s) : x;
  for (const ch of s) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
  return widthOf(s);
}

// The masthead band: „SPIELWIRBEL" in Anton, the session's number beside it.
function programmheftMasthead(ctx, spec, p) {
  const W = PROGRAMMHEFT_CARD_W;
  const pad = PROGRAMMHEFT_CARD_PAD;
  ctx.fillStyle = p.vermilion;
  ctx.fillRect(0, 0, W, 40);
  ctx.fillStyle = p['on-vermilion'];
  ctx.font = programmheftFont(400, 24, true);
  const brandW = programmheftTracked(ctx, t('app.title').toUpperCase(), pad, 30, 4.8, W / 2);
  if (spec.masthead) {
    ctx.font = programmheftFont(700, 12);
    programmheftTracked(ctx, spec.masthead.toUpperCase(), W - pad, 25, 1.7, W - pad * 3 - brandW, 'right');
  }
}

// The round's name over the 3px rule, the date at the rule's right end.
function programmheftHeadRow(ctx, spec, p, marker) {
  const pad = PROGRAMMHEFT_CARD_PAD;
  const inner = PROGRAMMHEFT_CARD_W - pad * 2;
  ctx.fillStyle = marker.color;
  ctx.fillRect(pad, 56, inner, 8);
  const base = 104;
  let dateW = 0;
  if (spec.date) {
    ctx.fillStyle = p['ink-soft'];
    ctx.font = programmheftFont(700, 12);
    dateW = programmheftTracked(ctx, spec.date.toUpperCase(), pad + inner, base, 1.44, inner / 2, 'right');
  }
  ctx.fillStyle = p.ink;
  ctx.font = programmheftFont(400, 34, true);
  ctx.fillText(recapFit(ctx, String(spec.round).toUpperCase(), inner - dateW - (dateW ? 16 : 0)), pad, base);
  ctx.fillRect(pad, 110, inner, 3);
  return 113;
}

// The played game's box: a flat stand-in in the round's marker, never a real
// cover (constraint 1 of recap-card.js), and never any text on it.
function programmheftCover(ctx, x, y, w, h, marker) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, marker.color);
  g.addColorStop(1, marker.deep);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

// „Gespielt" on its own paper, in a vermilion frame, below the box.
function programmheftStamp(ctx, x, y, p) {
  ctx.font = programmheftFont(400, 24, true);
  const label = t('result.stamp').toUpperCase();
  const w = [...label].reduce((s, ch) => s + ctx.measureText(ch).width, 0) + (label.length - 1) * 2.4 + 22;
  ctx.fillStyle = p['page-bg'];
  ctx.fillRect(x, y, w, 36);
  ctx.strokeStyle = p.vermilion;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, 33);
  ctx.fillStyle = p.brand;
  programmheftTracked(ctx, label, x + 11, y + 28, 2.4, w);
}

// The headline in Anton capitals, the winners' names in vermilion, stepping the
// size down before giving up a line. Returns the height it used.
function programmheftHeadline(ctx, runs, x, y, maxW, maxH, from, p) {
  const upper = runs.map((r) => ({ text: r.text.toUpperCase(), gold: r.hot }));
  let size = from;
  let lh = 0;
  let lines = null;
  for (; size >= 24; size -= 2) {
    ctx.font = programmheftFont(400, size, true);
    lh = Math.round(size * 1.05);
    lines = tischWrap(ctx, upper, maxW, Math.max(1, Math.floor(maxH / lh)));
    if (lines) break;
  }
  if (!lines) {
    size = 24;
    lh = Math.round(size * 1.05);
    ctx.font = programmheftFont(400, size, true);
    lines = (tischWrap(ctx, upper, maxW, 99) || []).slice(0, Math.max(1, Math.floor(maxH / lh)));
  }
  lines.forEach((line, i) => {
    let cx = x;
    const by = y + size * 0.9 + i * lh;
    line.forEach((run) => {
      ctx.fillStyle = run.gold ? p.vermilion : p.ink;
      ctx.fillText(run.text, cx, by);
      cx += ctx.measureText(run.text).width;
    });
  });
  return lines.length * lh;
}

// Up to three facts to a line, each under a 2px rule: a small label over an
// Anton figure. Returns the height used.
function programmheftFacts(ctx, facts, y, p) {
  if (!facts.length) return 0;
  const pad = PROGRAMMHEFT_CARD_PAD;
  const inner = PROGRAMMHEFT_CARD_W - pad * 2;
  const colW = (inner - 24) / 3;
  const lineH = 60;
  facts.forEach((f, i) => {
    const x = pad + (i % 3) * (colW + 12);
    const top = y + Math.floor(i / 3) * lineH;
    ctx.fillStyle = p.ink;
    ctx.fillRect(x, top, colW, 2);
    ctx.fillStyle = p['ink-soft'];
    ctx.font = programmheftFont(700, 12);
    programmheftTracked(ctx, String(f.k).toUpperCase(), x, top + 18, 1.44, colW);
    ctx.fillStyle = p.ink;
    ctx.font = programmheftFont(400, 30, true);
    ctx.fillText(recapFit(ctx, f.v, colW), x, top + 52);
  });
  return Math.ceil(facts.length / 3) * lineH;
}

// The score's ink on paper: the ramp by rung, the veto stamp's accent-ink.
function programmheftScoreInk(stop, p) {
  if (stop === 'veto') return p['veto-ink'];
  return p[`ramp-${stop}`] || p.ink;
}

// The table: place, title, score, a 1px ink rule under each row; the played
// game's row on gold-soft, where every ink is ink.
function programmheftSessionRows(ctx, rows, y, p) {
  const pad = PROGRAMMHEFT_CARD_PAD;
  const inner = PROGRAMMHEFT_CARD_W - pad * 2;
  const h = 34;
  rows.forEach((r, i) => {
    const top = y + i * h;
    if (r.win) { ctx.fillStyle = p['gold-soft']; ctx.fillRect(pad, top, inner, h); }
    ctx.fillStyle = p.ink;
    ctx.fillRect(pad, top + h - 1, inner, 1);
    ctx.font = programmheftFont(400, 24, true);
    ctx.fillText(r.place, pad + 6, top + 27);
    let scoreW = 0;
    if (r.score) {
      scoreW = ctx.measureText(r.score).width;
      ctx.fillStyle = r.win ? p.ink : programmheftScoreInk(r.stop, p);
      ctx.fillText(r.score, pad + inner - 6 - scoreW, top + 27);
    }
    ctx.fillStyle = p.ink;
    ctx.font = programmheftFont(700, 15);
    ctx.fillText(recapFit(ctx, r.title, inner - 42 - scoreW - 16), pad + 42, top + 23);
  });
  return rows.length * h;
}

// The period card's named rows: a label over the title, the figure at right.
function programmheftNamedRows(ctx, rows, y, p) {
  const pad = PROGRAMMHEFT_CARD_PAD;
  const inner = PROGRAMMHEFT_CARD_W - pad * 2;
  const h = 52;
  rows.forEach((r, i) => {
    const top = y + i * h;
    ctx.fillStyle = p.ink;
    ctx.fillRect(pad, top + h - 1, inner, 1);
    ctx.font = programmheftFont(400, 24, true);
    const scoreW = r.score ? ctx.measureText(r.score).width : 0;
    if (r.score) ctx.fillText(r.score, pad + inner - scoreW, top + 38);
    ctx.fillStyle = p['ink-soft'];
    ctx.font = programmheftFont(700, 12);
    programmheftTracked(ctx, String(r.label).toUpperCase(), pad, top + 18, 1.44, inner - scoreW - 16);
    ctx.fillStyle = p.ink;
    ctx.font = programmheftFont(700, 15);
    ctx.fillText(recapFit(ctx, r.title, inner - scoreW - 16), pad, top + 40);
  });
  return rows.length * h;
}

// "Powered by BGG" — a licence requirement wherever BGG data appears, as on
// the other designs' cards. A same-origin PNG, so drawImage leaves the canvas
// clean.
function programmheftFoot(ctx, badge, p) {
  const pad = PROGRAMMHEFT_CARD_PAD;
  const base = PROGRAMMHEFT_CARD_H - 20;
  ctx.fillStyle = p.ink;
  ctx.font = programmheftFont(700, 14);
  ctx.fillText('spielwirbel.app', pad, base);
  if (!(badge && (badge.naturalWidth || badge.width))) return;
  const w = 96;
  const bh = w * ((badge.naturalHeight || badge.height) / (badge.naturalWidth || badge.width));
  ctx.drawImage(badge, PROGRAMMHEFT_CARD_W - pad - w, base - bh + 3, w, bh);
}

function drawProgrammheftCard(ctx, spec, badge) {
  const p = programmheftPalette();
  const W = PROGRAMMHEFT_CARD_W;
  const H = PROGRAMMHEFT_CARD_H;
  const pad = PROGRAMMHEFT_CARD_PAD;
  const inner = W - pad * 2;
  const marker = programmheftCardMarker();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = p['page-bg'];
  ctx.fillRect(0, 0, W, H);

  programmheftMasthead(ctx, spec, p);
  let y = programmheftHeadRow(ctx, spec, p, marker) + 14;

  if (spec.cover) {
    const cw = 170;
    const ch = Math.round(cw * 4 / 3);
    programmheftCover(ctx, pad, y, cw, ch, marker);
    programmheftStamp(ctx, pad, y + ch + 8, p);
    programmheftHeadline(ctx, spec.headline, pad + cw + 16, y, inner - cw - 16, ch + 44, 38, p);
    y += ch + 8 + 36;
  } else {
    y += programmheftHeadline(ctx, spec.headline, pad, y, inner, spec.kind === 'period' ? 130 : 200, spec.kind === 'period' ? 60 : 38, p);
  }
  y += 16;
  y += programmheftFacts(ctx, spec.facts, y, p);
  y += 10;
  if (spec.kind === 'period') programmheftNamedRows(ctx, spec.rows, y, p);
  else programmheftSessionRows(ctx, spec.rows, y, p);

  programmheftFoot(ctx, badge, p);
  // The sheet's 1px ink frame, drawn last so nothing paints over it.
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}

// Render one card to a PNG Blob. Rejects rather than resolving null, so the
// caller's catch — which reports to the operator (reportClientError, in
// shareRecapCard and shareResultCard) — is the one place a failure is seen.
async function programmheftCardBlob(kind, model) {
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all([programmheftFont(400, 38, true), programmheftFont(700, 15), programmheftFont(700, 12)]
        .map((f) => document.fonts.load(f)));
    } catch { /* a face that cannot load leaves the card in the fallback */ }
  }
  const spec = programmheftCardSpec(kind === 'period' ? 'period' : 'session', model);
  const badge = await tischBadge();
  const canvas = document.createElement('canvas');
  canvas.width = PROGRAMMHEFT_CARD_W * PROGRAMMHEFT_CARD_SCALE;
  canvas.height = PROGRAMMHEFT_CARD_H * PROGRAMMHEFT_CARD_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(PROGRAMMHEFT_CARD_SCALE, PROGRAMMHEFT_CARD_SCALE);
  drawProgrammheftCard(ctx, spec, badge);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
