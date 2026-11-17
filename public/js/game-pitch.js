/* Spielwirbel – a game's pitch line (#1837): one short sentence the round
   writes in its own words („Würfel als Arbeiter, fies, 45 min"), shown under
   the title on the vote card so a voter knows what a game is before rating it.

   The STORED shape is `pitch: '<text>'` on the game row, trimmed, one line, at
   most GAME_PITCH_MAX characters. The key is ABSENT on a game without one — a
   clear deletes it, never stores '' or null — for the absent-key parity both
   repo backends keep (.claude/rules/postgres-backend.md).

   Shared across the stack (.claude/rules/shared-constants-across-the-stack.md):
   the editor caps its input at GAME_PITCH_MAX and checks with `gamePitchFrom`,
   and POST/PATCH …/games validate with the same function, so the editor cannot
   accept a value the route then 400s.

   Loaded as a shared-scope script by index.html and required from Node, so it
   is dependency-free. */

'use strict';

const GAME_PITCH_MAX = 90;

/* What a typed pitch becomes: `{ pitch: '<trimmed>' }`, `{ pitch: null }` for
   a blank one (which CLEARS it), or `{ error }` naming what is wrong. A newline
   is refused rather than folded into a space: the card has room for one line,
   and silently rewriting what the user typed would hide that. Counted in code
   points, not UTF-16 units, so an emoji costs one character like it looks. */
function gamePitchFrom(value) {
  if (value === null || value === undefined) return { pitch: null };
  if (typeof value !== 'string') return { error: 'type' };
  const text = value.trim();
  if (!text) return { pitch: null };
  if (/[\r\n\u2028\u2029]/.test(text)) return { error: 'newline' };
  if ([...text].length > GAME_PITCH_MAX) return { error: 'long' };
  return { pitch: text };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GAME_PITCH_MAX, gamePitchFrom };
}
