'use strict';

/* The curated icon set a custom round tag may carry (issue #255).
   Stored as a short key on the tag (`icon`), rendered client-side as
   `ti-<key>`. Deliberately a fixed allowlist, not a free icon search: every
   entry must exist in the bundled `public/fonts/tabler-icons.woff2` AND be
   declared in `public/fonts/tabler-icons.css`, or it renders as nothing at all
   (see .claude/rules/tabler-icon-codepoints.md).

   `tags` is first because it is also the fallback for a tag with no icon —
   every tag that existed before this feature renders exactly as it did.

   MIRRORED in public/js/tag-icons.js, which the frontend needs in its shared
   global scope. test/tag-icons.test.js asserts the two lists are identical —
   same discipline as the en/de i18n key parity test. */
const TAG_ICONS = [
  'tags',
  'dice-3',
  'dice-5',
  'cards',
  'chess',
  'puzzle',
  'device-gamepad-2',
  'sword',
  'shield',
  'rocket',
  'brain',
  'ghost',
  'building-castle',
  'world',
  'users',
  'crown',
  'trophy',
  'star',
  'flame',
  'sparkles',
];

module.exports = { TAG_ICONS };
