/* Spielwirbel – how long a round tag's name may be.
   Its own file so it is the SINGLE source of truth: the frontend loads it as a
   shared-scope script and every tag-name input renders `maxlength` from it,
   while lib/routes/tags.js requires it for the create/rename schema. It used to
   be a literal in the route plus a hand-copied `30` in each input, and the
   add-game sheet's input had none at all — so a long name there came back as
   the route's English 400 in every UI language.
   Dependency-free and tiny by design (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

const TAG_NAME_MAX = 30;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TAG_NAME_MAX };
}
