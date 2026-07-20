// The curated icon set a custom round tag may carry (issue #255), mirrored
// from lib/tag-icons.js — the backend owns validation, but these scripts share
// one global scope and can't require() it. test/tag-icons.test.js asserts the
// two lists stay identical.
//
// Every key must be declared in public/fonts/tabler-icons.css or it renders as
// nothing at all, silently (.claude/rules/tabler-icon-codepoints.md).
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

// The Tabler class for a tag's icon. An unset icon — every tag created before
// #255 — falls back to `ti-tags`, the glyph tags already rendered with, so
// existing rounds look unchanged. An unknown key (hand-edited data, or a key
// removed from the set later) falls back the same way rather than emitting a
// `ti-` class with no rule behind it, which would render as blank.
function tagIconClass(icon) {
  return TAG_ICONS.includes(icon) ? `ti-${icon}` : 'ti-tags';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TAG_ICONS, tagIconClass };
}
