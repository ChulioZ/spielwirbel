/* Spielwirbel – what the round hub can say about itself (#923).

   The Start tab used to render a ticket and a button. Everything here is the
   material for the cards that fill it: which games are worth putting on the
   table, how the round is doing, what is quietly broken, and what happened on
   this day in a past year.

   Every function is PURE and derives from the round payload the hub already
   holds — no fetch, no stored field, no denormalization. Sessions stay the
   single source of truth (CLAUDE.md §Architecture), so deleting one removes its
   effect from every card here for free.

   Its dependencies arrive in `deps` rather than off the shared scope, for the
   reason recap.js and period-recap.js state: a public/js file cannot require()
   a sibling, so injection is what keeps this usable both as a shared-scope
   frontend script and as a CommonJS module the tests require, without a second
   copy of any rule. `deps` is
   { outcomeOf, monthKeyOf, neutralScore, filterOptions, normalizeMetadata,
   fitsMetadata } — sessionOutcome (session-outcome.js), periodKeyOf
   (period-recap.js), PRIOR_DEFAULT (vote-score.js) and the three
   metadata-filter functions (draw-pool.js). Each is injected rather than
   restated because a second copy of any of them is exactly the drift
   .claude/rules/shared-constants-across-the-stack.md exists to prevent: the
   pulse must count the same evenings the Chronik counts, and a preset chip must
   narrow the pool the draw will actually narrow.

   Load order: see index.html — after draw-pool.js, vote-score.js and
   period-recap.js, whose values it is handed. */

'use strict';

// How many active games a shelf needs before naming three of them says
// anything. Below this, "play one of these" is a list of most of the shelf.
const SUGGEST_MIN_SHELF = 6;
// A game put on the table inside this window is not something the hub needs to
// suggest — the group has just played it and knows.
const SUGGEST_RECENT_DAYS = 60;
// How many months of bars the pulse shows, and how much evidence it needs
// before drawing them: one played session makes a chart of one bar.
const PULSE_MONTHS = 12;
const PULSE_MIN_SESSIONS = 2;
// Rows per Kümmerliste section. The card names what to fix, it is not a report.
const CARE_ROW_MAX = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// Only evenings that actually happened, asked through `sessionOutcome` and never
// through `s.finished`/`s.cancelled` directly: a split parent (#796) is neither
// played nor cancelled, and sixteen sites got that wrong before the outcome
// existed (.claude/rules/shared-constants-across-the-stack.md §11). Its tables
// are the sessions that were played, and they count individually — which is
// what the Chronik shows above these cards.
// Prefixed `hub`, and that is not cosmetic: period-recap.js already declares a
// top-level `const playedSessions`, and two classic scripts sharing one global
// LEXICAL scope cannot both declare the same const — the second one throws
// "Identifier … has already been declared" and takes the entire app down at
// load. The two also mean subtly different things (that one asks `s.finished`
// directly), which is the second reason not to merge them.
const hubPlayedSessions = (round, deps) =>
  (round.sessions || []).filter((s) => deps.outcomeOf(s) === 'played');

// When each game was last actually put on the table, as a ms timestamp. A game
// was PLAYED when it is a played session's `chosenGameId`; merely appearing in
// that session's `gameIds` means it was drawn and voted on, which is not the
// same thing and must not silence a suggestion.
function hubLastPlayedAt(round, deps) {
  const at = new Map();
  hubPlayedSessions(round, deps).forEach((s) => {
    if (!s.chosenGameId) return;
    const ts = Date.parse(s.createdAt);
    if (!Number.isFinite(ts)) return;
    const prev = at.get(s.chosenGameId);
    if (prev === undefined || ts > prev) at.set(s.chosenGameId, ts);
  });
  return at;
}

/* Up to three games worth putting on the table, each with the reason it is
   there — the positive mirror of the retirement banner sitting above.

   ONE GAME PER REASON KIND, in the order below. A shelf with twenty unplayed
   games would otherwise fill the card with three identical sentences; three
   different angles is what makes it worth reading. A kind with no candidate
   contributes nothing, so the card can honestly hold one row or two.

   `exclude` is the set of game ids the retirement banner is proposing in this
   same render. Without it the screen recommends and nags the same game, which
   reads as the app disagreeing with itself.

   `statsByGame` is the caller's `roundScoreIndex` — never rebuilt here, because
   `playCounts` walks every session and a second index per render is the O(n²)
   trap that function's header describes. */
function gameSuggestions(round, activeGames, opts, deps) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const stats = o.statsByGame || {};
  const exclude = o.exclude instanceof Set ? o.exclude : new Set(o.exclude || []);
  const neutral = deps.neutralScore;
  const shelf = (activeGames || []).filter((g) => !exclude.has(g.id));
  // The floor is measured on the ACTIVE shelf, not on what survives the
  // exclusion: a round whose shelf is big enough to suggest from does not stop
  // being one because the banner is nagging about two of them.
  if ((activeGames || []).length < SUGGEST_MIN_SHELF) return [];

  const played = hubLastPlayedAt(round, deps);
  const never = shelf.filter((g) => !played.has(g.id));
  const seen = new Set();
  const out = [];
  const take = (game, reason) => {
    if (!game || seen.has(game.id)) return;
    seen.add(game.id);
    out.push({ game, reason });
  };

  // 1. Never played, and not already voted down. Ranked by score, so the pick
  // is the most promising of them.
  //
  // THE FLOOR MATTERS AND IS EASY TO MISS: "never played" does not mean
  // "never voted on". A game can be drawn and rated in several sessions without
  // ever being the one that hit the table, so it carries real opinions while
  // qualifying here. Two members rating it {1,1,3,3} over two draws leaves it
  // at a shrunk 1.0 and — at four votes against a bar of three times the member
  // count — well under the retirement banner's evidence threshold, so nothing
  // else on this screen says a word about it. Without the floor the hub would
  // headline it as „wie wär's mit", which is the positive card confidently
  // recommending the shelf's least-wanted box.
  //
  // `neutral` is the bar because an unrated game IS the prior: admitting
  // `>= neutral` keeps every genuinely unknown game (the common case) and drops
  // only the ones the group has already spoken against.
  take(
    never
      .filter((g) => !seen.has(g.id) && suggestScore(stats, g, neutral) >= neutral)
      .sort((a, b) => suggestScore(stats, b, neutral) - suggestScore(stats, a, neutral))[0],
    { kind: 'never' }
  );

  // 2. Longest not played, among games that HAVE been played. Reported in whole
  // months, so it only speaks once the gap is worth mentioning.
  //
  // `!seen.has` on every candidate list below, not just inside take(): a
  // candidate the previous row already claimed must not be SELECTED, or the
  // best pick is spent on a duplicate and take() silently drops the row
  // entirely — the card loses a whole reason rather than showing its
  // runner-up. Found by the spec, which asserted three kinds and got two.
  const stale = shelf
    .filter((g) => played.has(g.id) && !seen.has(g.id) && suggestScore(stats, g, neutral) >= neutral)
    .sort((a, b) => played.get(a.id) - played.get(b.id))[0];
  if (stale) {
    const months = Math.floor((now - played.get(stale.id)) / (DAY_MS * 30));
    if (months >= 3) take(stale, { kind: 'longAgo', months });
  }

  // 3. The best-liked game the group has not had out recently. Read through the
  // shelf score the pills and the ring already show (#894) — never a second
  // curve, which is what vote-score.js is one file for.
  //
  // The bar is the SCORE PRIOR, injected rather than picked: `PRIOR_DEFAULT` is
  // what we assume about a game nobody has said anything about, so "above it"
  // means this game's own evidence has moved it there. A literal 3.5 here would
  // be a magnitude nobody could argue with, and it would silently stop meaning
  // what it says the moment the prior is retuned — which vote-score.js's header
  // explicitly expects to happen.
  const loved = shelf
    .filter((g) => !seen.has(g.id))
    .filter((g) => {
      const at = played.get(g.id);
      return at === undefined || now - at > SUGGEST_RECENT_DAYS * DAY_MS;
    })
    .filter((g) => suggestScore(stats, g, neutral) > neutral)
    .sort((a, b) => suggestScore(stats, b, neutral) - suggestScore(stats, a, neutral))[0];
  if (loved) take(loved, { kind: 'loved', score: (stats[loved.id] || {}).score });

  return out;
}

// A game's shelf score for ordering, with "no votes yet" sorting last rather
// than as a zero — an unrated game is unknown, not bad.
function suggestScore(stats, game, neutral) {
  const s = (stats || {})[game.id];
  const v = s && s.score;
  return typeof v === 'number' && Number.isFinite(v) ? v : neutral;
}

/* The quick-start presets: a filter the shelf can actually express, offered as
   a chip that jumps into the session setup with it already applied.

   Two gates, and both are the difference between a chip and a chip that looks
   broken:

   - the shelf must OFFER the field (`filterOptions`). On an instance with no
     BGG_API_TOKEN, or a shelf of hand-typed games, `playtime` is false and
     `normalizeMetadataFilters` drops `maxPlaytime` silently — so the chip would
     open the setup screen having changed nothing at all.
   - it must NARROW something without emptying it. A filter that admits the
     whole shelf is a chip that does nothing; one that admits none of it is a
     chip that opens an empty pool.

   WHAT THE GATE DELIBERATELY DOES NOT SEE: the round's remembered TAG filter.
   A chip merges over `lastSessionFilters`, which keeps its `tagIds`, so a shelf
   with four short games none of which carries the remembered tag opens on an
   empty pool despite the gate. Keeping the tags is the right default — they are
   how this group usually draws — and the miss is visible rather than silent:
   the pool count and the clear-filters control are both on the screen the chip
   opens. Closing it properly would mean expressing the tag clause here, which
   draw-pool.js's header explains is the one clause the two sides legitimately
   spell differently (resolved id lists server-side, a tri-state chip map in the
   client).

   The filter is normalized through the SAME function the setup screen applies
   to a stored preset, so what the chip promises and what the screen does are
   one decision rather than two. */
function quickPresets(activeGames, deps) {
  const shelf = activeGames || [];
  const options = deps.filterOptions(shelf);
  const candidates = [
    { id: 'short', metadata: { maxPlaytime: 60 }, needs: options.playtime },
    { id: 'light', metadata: { weightMax: 2 }, needs: options.weight },
    { id: 'meaty', metadata: { weightMin: 3 }, needs: options.weight },
    { id: 'family', metadata: { youngestAge: 8 }, needs: options.age },
  ];
  return candidates
    .filter((c) => c.needs)
    .map((c) => ({ id: c.id, metadata: deps.normalizeMetadata(c.metadata, options) }))
    .filter((c) => {
      const n = shelf.filter((g) => deps.fitsMetadata(g, c.metadata)).length;
      return n > 0 && n < shelf.length;
    })
    .slice(0, 3);
}

/* The round's pulse: how often it meets, when it last did, and how much of the
   shelf has ever reached the table.

   Bucketed by the LOCAL calendar through the injected `monthKeyOf`, which is
   period-recap.js's own rule: a session that started at 22:00 on July 31
   belongs to the group's July, and every other date on these screens is local
   already. The axis is generated by walking a local Date and asking the same
   function, so the twelve labels and the buckets cannot spell a month key two
   different ways. */
function roundPulse(round, activeGames, opts, deps) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const played = hubPlayedSessions(round, deps);

  const counts = new Map();
  let newest = null;
  played.forEach((s) => {
    const keys = deps.monthKeyOf(s.createdAt);
    if (keys) counts.set(keys.month, (counts.get(keys.month) || 0) + 1);
    const ts = Date.parse(s.createdAt);
    if (Number.isFinite(ts) && (newest === null || ts > newest)) newest = ts;
  });

  const months = [];
  for (let i = PULSE_MONTHS - 1; i >= 0; i--) {
    // Local noon on the 1st, walked back i months. `toISOString()` may land on
    // the previous day in UTC, which does not matter: monthKeyOf parses it back
    // in the same local zone, so the round trip is exact by construction.
    const d = new Date(now);
    d.setDate(1);
    d.setHours(12, 0, 0, 0);
    d.setMonth(d.getMonth() - i);
    const key = deps.monthKeyOf(d.toISOString()).month;
    months.push({ key, at: d.getTime(), count: counts.get(key) || 0 });
  }

  /* `total` is the sum over the BARS, not over every played session ever — and
     the floor is applied to it, not to `played.length`.

     Found in the browser: a round with one evening last month and one thirteen
     months ago read „2 Sessions in 12 Monaten" under a chart showing a single
     filled bar. The card would then be stating a number the picture directly
     above it contradicts, which is worse than either alone. Same reason the
     floor moved: the pulse is a claim about the last twelve months, so a round
     whose only evenings predate them has no pulse to draw. */
  const total = months.reduce((n, m) => n + m.count, 0);
  if (total < PULSE_MIN_SESSIONS) return null;

  // `daysSinceLast` deliberately looks past the window: once the card is on
  // screen at all, "last played 400 days ago" is exactly the fact worth having.
  const everPlayed = new Set(
    played.map((s) => s.chosenGameId).filter(Boolean)
  );
  const shelf = activeGames || [];
  return {
    months,
    total,
    daysSinceLast: newest === null ? null : Math.max(0, Math.floor((now - newest) / DAY_MS)),
    shelfSize: shelf.length,
    neverPlayed: shelf.filter((g) => !everPlayed.has(g.id)).length,
  };
}

/* The Kümmerliste: gaps that quietly degrade other features, each one fixable
   from a screen this card links to.

   The third row is the one that pays for the card: a game with no player range
   falls out of a filtered draw without ever saying so, because `fitsOwnRange`
   treats an absent bound as "admits everybody" only when BOTH are absent — a
   half-filled range is a game nobody will be offered at most table sizes.

   IT SAYS NOTHING UNTIL THE ROUND HAS PLAYED. Every row here is about a feature
   the group is already using — the Siegwertung, a filtered draw, recognising a
   box in a list — and none of them bites before the first session. Without the
   floor a brand-new round of two hand-typed games meets a „Kümmerliste"
   nagging about two missing covers as its very first content, which is both
   wrong (a game added five minutes ago is not a loose end) and exactly the
   empty-card first impression #923's own acceptance criteria rule out. Found by
   test/empty-state.test.js, whose young-round fixture is that round. */
function careList(round, activeGames, deps) {
  const shelf = activeGames || [];
  const isRange = (v) => typeof v === 'number' && Number.isFinite(v);
  const plays = hubPlayedSessions(round, deps);
  if (!plays.length) return { winnerless: [], winnerlessTotal: 0, coverless: [], coverlessTotal: 0, noRange: [], noRangeTotal: 0, empty: true };
  const winnerless = plays
    .filter((s) => !(s.winnerIds || []).length && s.chosenGameId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const coverless = shelf.filter((g) => !g.image);
  const noRange = shelf.filter((g) => !isRange(g.minPlayers) || !isRange(g.maxPlayers));
  const out = {
    winnerless: winnerless.slice(0, CARE_ROW_MAX),
    winnerlessTotal: winnerless.length,
    coverless: coverless.slice(0, CARE_ROW_MAX),
    coverlessTotal: coverless.length,
    noRange: noRange.slice(0, CARE_ROW_MAX),
    noRangeTotal: noRange.length,
  };
  out.empty = !out.winnerlessTotal && !out.coverlessTotal && !out.noRangeTotal;
  return out;
}

/* „Heute vor einem Jahr" — a played session on today's local month and day in a
   past year. Rare by construction: on 364 days of the year this returns null
   and the card is not rendered at all.

   Matched on the local month/day for the same reason the pulse buckets locally,
   and the newest qualifying year wins, so a round that has met on this date
   three times tells the most recent story rather than the oldest. */
function anniversary(round, opts, deps) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const today = new Date(now);
  const best = hubPlayedSessions(round, deps)
    .filter((s) => s.chosenGameId)
    .map((s) => ({ s, d: new Date(s.createdAt) }))
    .filter(({ d }) => !Number.isNaN(d.getTime()))
    .filter(({ d }) =>
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate() &&
      d.getFullYear() < today.getFullYear())
    .sort((a, b) => b.d.getFullYear() - a.d.getFullYear())[0];
  if (!best) return null;
  const game = (round.games || []).find((g) => g.id === best.s.chosenGameId);
  if (!game) return null;
  return { session: best.s, game, years: today.getFullYear() - best.d.getFullYear() };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SUGGEST_MIN_SHELF, SUGGEST_RECENT_DAYS, PULSE_MONTHS, PULSE_MIN_SESSIONS, CARE_ROW_MAX,
    gameSuggestions, quickPresets, roundPulse, careList, anniversary,
  };
}
