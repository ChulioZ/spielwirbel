'use strict';

/* The tri-state custom-tag filter (#241): the chip cycle, the chips themselves,
   the all/any mode toggle, the bulk toggle, the icon picker, and the predicate
   that decides whether a game's tags match the current selection.

   Split out of core.js by #956. A real seam — it is one shared CONTROL, used by
   the Regal and the start-session screen, and nothing in it reads a score, a
   session or a design. It sits beside filter-panel.js (the overlay that hosts
   it) rather than inside it, because the chips are also rendered outside that
   panel.

   The filter STATE (`regalFilters`, `chronikFilter`) deliberately stayed in
   core.js: it is per-screen view state with a round-id guard, owned by the
   screens rather than by this control, and moving it would make this file the
   home of something it does not decide.

   `repositionPopover()` is called from the icon picker because opening the icon
   grid changes the card's height in place and placement is one-shot — see
   popover.js. No `module.exports` (DOM; the coverage constraint in
   round-theme.js's header). */

// Tri-state custom-tag filter (#241), shared by the Regal and start-session tag
// chips. State lives in a Map<tagId, 'include'|'exclude'> — a tag absent from the
// map is ignored. Clicking a chip cycles ignore -> include -> exclude -> ignore.
const TAG_STATES = [undefined, 'include', 'exclude'];
// Advance one tag to its next state in the cycle, mutating the map, and return
// the new state (undefined = back to ignore, so the entry is removed).
function cycleTagState(map, id) {
  const next = TAG_STATES[(TAG_STATES.indexOf(map.get(id)) + 1) % TAG_STATES.length];
  if (next) map.set(id, next);
  else map.delete(id);
  return next;
}
// Reflect a tag chip's state on its element: the fill class, the glyph (a ban
// icon for exclude), and an accessible label so include vs exclude is
// distinguishable without relying on color alone (a11y).
// `mode` (#726) is the ACTIVE combination mode, and it only changes the included
// label — "only games with it" states AND semantics out loud, so in 'any' mode
// that sentence is simply wrong. It is the one string in the app that says what
// the filter means, which is why it must follow the control rather than the
// control merely sitting above it.
function paintTagChip(chip, name, state, tagIcon, mode = 'all') {
  chip.classList.toggle('is-on', state === 'include');
  chip.classList.toggle('is-excluded', state === 'exclude');
  // The ban glyph still wins for the exclude state (#255): it conveys filter
  // semantics, not tag identity, and losing it would make include/exclude
  // indistinguishable without color.
  const icon = state === 'exclude' ? 'ti-ban' : tagIconClass(tagIcon);
  const key =
    state === 'include' ? (mode === 'any' ? 'tags.filter.includedAny' : 'tags.filter.included')
    : state === 'exclude' ? 'tags.filter.excluded'
    : 'tags.filter.ignored';
  chip.setAttribute('aria-label', t(key, { name }));
  chip.innerHTML = `<i class="ti ${icon}" aria-hidden="true"></i>${esc(name)}`;
}
// The AND/OR control above a tri-state chip row (#726), on both screens that
// carry the filter — the session setup screen and the Regal, which already
// share the chips and the bulk toggle.
//
// `state` is the screen's own filter state object; the control reads and writes
// its `tagMode` key in place, so the choice survives while the control is
// inert. That matters: with fewer than two included tags the two modes draw the
// same pool, so the control would be noise — but dropping to one tag and adding
// another back must restore what the user picked, not silently reset it.
//
// Two plain buttons rather than a role="radiogroup": both are Tab-reachable and
// Enter/Space-activated by the platform, where a radiogroup would owe arrow-key
// roving. `aria-pressed` plus a check glyph carry the selection, so it is never
// conveyed by colour alone (.claude/rules/accessibility-contrast-and-modals.md).
//
// Returns { el, sync }: `sync` re-reads the map and enables or inerts the
// control, so every chip click and the bulk toggle must call it.
function renderTagModeToggle(state, map, onChange) {
  const el = h(`<div class="tag-mode" role="group" aria-label="${esc(t('tags.filter.modeLabel'))}"></div>`);
  const opts = [['all', 'tags.filter.modeAll'], ['any', 'tags.filter.modeAny']].map(([mode, key]) => {
    const btn = h(`<button type="button" class="tag-mode__opt"><i class="ti ti-check" aria-hidden="true"></i>${esc(t(key))}</button>`);
    btn.addEventListener('click', () => {
      if (state.tagMode === mode) return;
      state.tagMode = mode;
      paint();
      onChange();
    });
    el.appendChild(btn);
    return { btn, mode };
  });
  const paint = () => opts.forEach(({ btn, mode }) => {
    const on = state.tagMode === mode;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  // Below two included tags the two modes mean the same thing, so the control is
  // useless — but it must NOT leave the flow (#787). It sits above the chip row,
  // and the tri-state cycle necessarily walks the included count across that
  // boundary, so hiding it moved the chips ~30px between the two clicks one
  // cycle needs and the second click landed on a different tag. Inert instead:
  // native `disabled` keeps it unclickable and out of the Tab order (and states
  // that to assistive tech), while `paint()` above keeps the current pick
  // showing — the state it holds still applies the moment a second tag joins.
  const sync = () => {
    const off = includedTagCount(map) < 2;
    el.classList.toggle('tag-mode--inert', off);
    opts.forEach(({ btn }) => { btn.disabled = off; });
  };
  paint();
  sync();
  return { el, sync };
}
// The bulk toggle that sits above a tri-state chip row (#723) — on the session
// setup screen and in the Regal, which share the chips through the two helpers
// above and so must share this too.
//
// Its rule is NOT `showTransferGames`'s select-all/none, on purpose: there the
// useful question is "is everything on?", here it is "is there any filter to
// clear?". So any non-empty map — including a mixed 2-included/1-excluded one —
// offers the clear action, which makes wiping a #252 preset one click instead of
// the two-click walk that prompted the request.
//
// `repaint` re-paints every chip from the (mutated) map; `onChange` is the
// screen's own refresh — the pool preview here, the grid plus the count badge
// there. The returned `sync` must also run on every CHIP click, or the label
// keeps promising the action the map no longer needs.
function renderTagBulkToggle(map, roundTags, repaint, onChange) {
  const btn = h('<button type="button" class="link-btn tag-bulk"></button>');
  // No aria-pressed: this is an action whose accessible name changes, not a
  // two-state control. Announcing it as "pressed" would describe the filter's
  // state with a word that belongs to the button.
  const sync = () => { btn.textContent = t(map.size ? 'tags.filter.clearAll' : 'tags.filter.selectAll'); };
  btn.addEventListener('click', () => {
    if (map.size) map.clear();
    else roundTags.forEach((tg) => map.set(tg.id, 'include'));
    sync();
    repaint();
    onChange();
  });
  sync();
  return { el: btn, sync };
}
// Build the curated tag-icon picker (#255): a grid of glyph buttons, exactly
// one active, following the MEMBER_COLORS swatch pattern (a fixed set, no free
// input). Since #293 the grid is collapsed behind a trigger showing the current
// glyph — 20 always-open buttons dominated the narrow tag popover, making an
// optional nicety read as the main task.
// Returns { trigger, grid, get }: the two parts are handed back separately, not
// as one wrapper, because every call site wants the trigger inline in an
// existing input row and the grid on its own line below it — a wrapper would
// force the grid into that row's flex layout. `get()` reads the current pick, so
// a caller can create/patch a tag with whatever is selected at submit time.
// `selected` is the tag's stored icon (or null/undefined for an unset one,
// which lands on the default `tags` glyph — the same one it already renders).
// `opts.expanded` drops the trigger entirely and renders the bare grid: the
// Tags screen's per-tag edit already toggles the picker open from its own pencil
// button, and nesting a second disclosure inside that would be one click too many.
let iconPickerSeq = 0;
function tagIconPicker(selected, opts) {
  let current = TAG_ICONS.includes(selected) ? selected : 'tags';
  const expanded = !!(opts && opts.expanded);
  const gridId = `icon-picker-${++iconPickerSeq}`;
  const grid = h(`<div class="icon-picker" id="${gridId}" role="group" aria-label="${esc(t('tags.chooseIcon'))}"${expanded ? '' : ' hidden'}></div>`);
  const trigger = expanded ? null : h(`<button type="button" class="icon-picker__trigger" aria-expanded="false"
       aria-controls="${gridId}" title="${esc(t('tags.chooseIcon'))}" aria-label="${esc(t('tags.chooseIcon'))}">
       <i class="ti ${tagIconClass(current)}" aria-hidden="true"></i>
       <i class="ti ti-chevron-down icon-picker__caret" aria-hidden="true"></i>
     </button>`);
  const setOpen = (open) => {
    grid.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    // The grid changes the card's height in place, and an anchored popover is
    // placed ONCE — content that grows afterwards hangs off a fold it cannot be
    // scrolled back from (#519, #722). A no-op when no popover is open, which is
    // what lets this picker also live inline on the Tags screen and in the
    // add-game form (.claude/rules/anchored-popover-is-placed-once.md).
    repositionPopover();
  };
  if (trigger) trigger.addEventListener('click', () => setOpen(grid.hidden));
  TAG_ICONS.forEach((key) => {
    const label = t(`tags.icons.${key}`);
    // data-icon carries the key so a caller can read it off the button it was
    // clicked on, rather than inferring it from the button's position.
    const btn = h(`<button type="button" class="icon-picker__btn${key === current ? ' is-active' : ''}"
         data-icon="${esc(key)}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${key === current}">
         <i class="ti ${tagIconClass(key)}" aria-hidden="true"></i>
       </button>`);
    btn.addEventListener('click', () => {
      current = key;
      grid.querySelectorAll('.icon-picker__btn').forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
      if (trigger) {
        trigger.querySelector('.ti').className = `ti ${tagIconClass(key)}`;
        setOpen(false);
      }
    });
    grid.appendChild(btn);
  });
  return { trigger, grid, get: () => current };
}

// How many tags the map currently includes — what decides whether offering a
// combination mode means anything at all (#726).
function includedTagCount(map) {
  let n = 0;
  for (const state of map.values()) if (state === 'include') n++;
  return n;
}
// A game passes the tri-state tag filter iff it satisfies the included tags and
// carries none of the excluded ones. `map` is Map<tagId, 'include'|'exclude'>.
// `mode` (#726) decides how the included ones combine: 'all' — the default —
// requires every one, 'any' at least one. Excluded tags reject a game carrying
// any of them in BOTH modes; the mode widens what qualifies, never what is
// rejected. Anything other than the exact string 'any' reads as 'all', so the
// second caller cannot silently change behaviour by passing a stray value.
//
// Kept in step with lib/draw.js's server-side clause by tests on both sides —
// the two express one rule over different inputs (a chip map here, resolved id
// lists there), which is why they are deliberately not shared
// (.claude/rules/shared-constants-across-the-stack.md).
function matchesTagFilter(map, gameTagIds, mode = 'all') {
  const ids = gameTagIds || [];
  let included = 0;
  let hits = 0;
  for (const [id, state] of map) {
    if (state === 'exclude' && ids.includes(id)) return false;
    if (state === 'include') {
      included++;
      if (ids.includes(id)) hits++;
    }
  }
  if (included === 0) return true;
  return mode === 'any' ? hits > 0 : hits === included;
}
