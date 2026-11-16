'use strict';

/*
 * Operator-confirmed scoring direction per BoardGameGeek game (#1786).
 *
 * „Niedrigere Punktzahl gewinnt" (#1630) is a per-round switch, so every round
 * tracking points for the same game has to get it right on its own. The operator
 * can confirm the direction once, for every round, from what the rounds have set
 * (the admin screen „Spieleinstellungen", lib/routes/admin/game-scoring.js).
 *
 * THE CONFIRMATION IS AN OVERLAY ON READ, never a write into tenant data. The
 * repo facade (lib/repo/index.js `forTenant`) passes every round and game read
 * through `overlayRound`/`overlayGame`, which replace `lowScoreWins` with the
 * confirmed value and add `scoringLocked: true`. The round's own stored value is
 * never touched, so revoking a confirmation restores it, and a confirmation
 * performs no cross-tenant write at all (.claude/rules/admin-cross-tenant-escape.md
 * holds by construction). Every consumer — records, the result order, the
 * profile's bests, the BG Stats push — keeps reading `game.lowScoreWins`.
 *
 * Only BGG-linked games take part: the BGG id is the only identity a game has
 * across rounds. An unlinked game keeps its per-round switch forever.
 *
 * No repo import here: lib/repo/index.js requires this module, so the loader is
 * handed in (`confirmedLoader`) rather than required, which would be a cycle.
 */

// A game's BGG id, or null. A digits-only externalId on the bgg provider —
// anything else (another provider, a hand-typed title) has no cross-round
// identity and stays per-round.
function bggIdOf(game) {
  const s = game && game.source;
  if (!s || s.provider !== 'bgg') return null;
  const id = String(s.externalId == null ? '' : s.externalId);
  return /^[0-9]+$/.test(id) ? id : null;
}

// Mutates and returns `game`. Callers hand it a SNAPSHOT (both backends return
// fresh objects from every read), never a live store object.
function overlayGame(game, confirmed) {
  if (!game || !confirmed || !confirmed.size) return game;
  const id = bggIdOf(game);
  if (!id || !confirmed.has(id)) return game;
  // Absent-key parity with the stored shape: false is absence (#1630).
  if (confirmed.get(id)) game.lowScoreWins = true;
  else delete game.lowScoreWins;
  game.scoringLocked = true;
  return game;
}

function overlayRound(round, confirmed) {
  if (round && Array.isArray(round.games)) round.games.forEach((g) => overlayGame(g, confirmed));
  return round;
}

/* The confirmed map, cached for CONFIRMED_TTL_MS. Every round read needs it, and
   it changes only when the operator presses a button — so a database round trip
   per read would spend the one-round-trip read contract
   (.claude/rules/postgres-backend.md) on a value that is the same nearly always.

   The cache is process-local, which is safe here for a specific reason: the
   admin route calls `invalidate()` after every write, so the process that served
   the click is exact at once, and any other process (Railway's deploy overlap,
   .claude/rules/deploy-invariants-are-pinned-in-code.md) converges within the
   TTL. The one place staleness would be WRONG rather than late — refusing a
   round's change to a locked game — reads the setting fresh
   (lib/routes/games.js). */
const CONFIRMED_TTL_MS = 30 * 1000;

// The generic half, shared with the category confirmation (lib/game-categories.js,
// #1787): `build(rows)` turns the settings rows into the Map the overlay reads.
function settingsCache(listSettings, build, now = () => Date.now()) {
  let cached = null;
  let at = 0;
  let pending = null;
  async function load() {
    if (cached && now() - at < CONFIRMED_TTL_MS) return cached;
    // Concurrent reads share one query rather than each starting their own.
    if (!pending) {
      pending = (async () => {
        const map = build(await listSettings());
        cached = map;
        at = now();
        return map;
      })().finally(() => { pending = null; });
    }
    return pending;
  }
  load.invalidate = () => { cached = null; };
  return load;
}

function confirmedLoader(listSettings, now = () => Date.now()) {
  return settingsCache(listSettings, (rows) => {
    const map = new Map();
    for (const s of rows) {
      if (s.state === 'confirmed') map.set(String(s.bggId), !!s.lowScoreWins);
    }
    return map;
  }, now);
}

/* The admin list's state for one game.
   - confirmed: the operator fixed the direction.
   - dismissed: „Zurückstellen" — until one more round contributes than at the
     moment of dismissal, which is why the row stores that count.
   - open: everything else, including a dismissal a new round has outgrown. */
function settingState(setting, rounds) {
  if (!setting) return 'open';
  if (setting.state === 'confirmed') return 'confirmed';
  if (setting.state === 'dismissed' && rounds <= (Number(setting.dismissedAtRounds) || 0)) return 'dismissed';
  return 'open';
}

/* Fold the backends' per-(game, round) rows into one entry per BGG id.

   Each backend returns one row per ROUND that has at least one finished session
   with points for a game carrying that BGG id: `{ bggId, low, titles }`, where
   `low` is that round's own stored switch and `titles` the distinct titles its
   games carry. Folding here, not in SQL, keeps the counting rule in one place
   for both backends.

   The title is the most common one across rounds (ties alphabetically), only as
   a fallback: the route prefers the licensed corpus name, which no user typed. */
function foldScoringRounds(rows) {
  const byId = new Map();
  for (const r of rows || []) {
    const id = String(r.bggId);
    const e = byId.get(id) || { bggId: id, rounds: 0, lowWins: 0, titles: new Map() };
    e.rounds += 1;
    if (r.low) e.lowWins += 1;
    for (const t of r.titles || []) {
      const title = String(t || '').trim();
      if (title) e.titles.set(title, (e.titles.get(title) || 0) + 1);
    }
    byId.set(id, e);
  }
  return [...byId.values()].map((e) => {
    const [title] = [...e.titles.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0] || [null];
    return { bggId: e.bggId, rounds: e.rounds, lowWins: e.lowWins, highWins: e.rounds - e.lowWins, title };
  });
}

module.exports = {
  bggIdOf,
  overlayGame,
  overlayRound,
  confirmedLoader,
  settingsCache,
  settingState,
  foldScoringRounds,
  CONFIRMED_TTL_MS,
};
