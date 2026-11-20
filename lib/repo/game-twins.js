'use strict';

/*
 * The row shape of `findGamesByBggId` (#1843), shared by both backends so the
 * JSON tree and the Postgres rows cannot answer in two shapes.
 *
 * A "twin" is the same BGG game on another round's shelf. The row carries the
 * four fields the game page can offer to copy across (title, player range,
 * playing time, pitch) plus the provider playing time, which the prompt needs to
 * show a twin's CURRENT figure when it has no override of its own. Nothing else
 * of the game travels: the prompt is a summary-sized read
 * (.claude/rules/railway-db-same-region.md).
 *
 * Absent-key parity with the stored game: `playtimeOverride` and `pitch` are
 * present only when the game has one, exactly as getGame returns them.
 */

function twinRow(roundId, roundName, game) {
  const row = {
    roundId,
    roundName,
    gameId: game.id,
    title: game.title,
    minPlayers: game.minPlayers ?? null,
    maxPlayers: game.maxPlayers ?? null,
    minPlaytime: game.minPlaytime ?? null,
    maxPlaytime: game.maxPlaytime ?? null,
  };
  if (game.playtimeOverride) row.playtimeOverride = structuredClone(game.playtimeOverride);
  if (typeof game.pitch === 'string' && game.pitch) row.pitch = game.pitch;
  return row;
}

// One order for both backends: by round name, then ids, so a contract case can
// compare whole arrays rather than sets.
function sortTwins(rows) {
  return rows.sort((a, b) =>
    String(a.roundName).localeCompare(String(b.roundName)) ||
    (a.roundId < b.roundId ? -1 : a.roundId > b.roundId ? 1 : 0) ||
    (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0));
}

module.exports = { twinRow, sortTwins };
