'use strict';

/*
 * Which stored COPIES of a game title or member name a redaction must reach
 * (#1825). Shared by both repo backends so they recognise a copy identically.
 *
 * Chronik lines:
 *   - a game line carrying `gameId` matches by that id;
 *   - `game_deleted` and every `member_*` line carry no id, so they match by
 *     the old TEXT within the same round. A same-named twin in that round is
 *     blanked too — accepted for a takedown (operator decision, 2026-11-14).
 * Friend-feed rows carry no round or game id at all (#325's allowlist), so they
 * match by title, restricted by the caller to the accounts that can act on the
 * round. `badge_earned` is excluded: its `title` is a catalogue key, not text.
 */

const ID_LESS_GAME_TYPES = new Set(['game_deleted']);
const MEMBER_TYPES = new Set(['member_added', 'member_retired', 'member_restored', 'member_deleted']);
const FEED_TITLE_TYPES = new Set(['game_added', 'session_played', 'games_imported']);

// The field of activity `a` that is a copy of the redacted text, or null.
function activityCopyField(kind, a, targetId, previous) {
  if (!a) return null;
  if (kind === 'game') {
    if (!('title' in a)) return null;
    if (a.gameId === targetId) return 'title';
    if (previous && !a.gameId && ID_LESS_GAME_TYPES.has(a.type) && a.title === previous) return 'title';
    return null;
  }
  if (kind === 'member') {
    if (previous && MEMBER_TYPES.has(a.type) && a.name === previous) return 'name';
  }
  return null;
}

// Whether feed row `e` (already scoped to the round's accounts) copies the title.
function isFeedTitleCopy(e, previous) {
  return Boolean(previous) && FEED_TITLE_TYPES.has(e.type) && e.title === previous;
}

module.exports = { activityCopyField, isFeedTitleCopy, FEED_TITLE_TYPES, MEMBER_TYPES, ID_LESS_GAME_TYPES };
