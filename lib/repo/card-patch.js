'use strict';

/*
 * Which of a provider "card" — a cover and a player range — may land on a game
 * that already exists, shared by both backends' `fillGameCards` so they cannot
 * disagree (the import-copy.js shape).
 *
 * A fill, never an overwrite: the card arrives behind a response already sent,
 * so anything the user set on the game in the meantime — a cover they chose, a
 * range they typed — must win. The range is filled as a PAIR and only when
 * neither end is set: a half-set range is a user's edit, and topping it up with
 * BGG's other end could produce min > max.
 *
 * The cover is expected to be gated by the caller (providerCoverUrl) — like
 * updateGame, the repo stores what the route resolved.
 */

const isCount = (n) => Number.isInteger(n) && n > 0;

function cardPatch(game, card) {
  const patch = {};
  if (!game.image && typeof card.image === 'string' && card.image) patch.image = card.image;
  if (game.minPlayers == null && game.maxPlayers == null) {
    const min = isCount(card.minPlayers) ? card.minPlayers : null;
    const max = isCount(card.maxPlayers) ? card.maxPlayers : null;
    if (min != null && max != null && min > max) return patch;
    if (min != null) patch.minPlayers = min;
    if (max != null) patch.maxPlayers = max;
  }
  return patch;
}

module.exports = { cardPatch };
