/* Spielwirbel – the ONE filter control (#827) the two game-picking screens
   carry: the round's own tags (#238/#241/#726) and the filters over the
   metadata #724 imports from BoardGameGeek (#725).

   It is one control because narrowing the pool is one job. Until #827 the two
   were separate affordances — an always-open chip row plus a collapsed „Weitere
   Filter" drawer, and in the Regal a third, phone-only „Filter" button over the
   chips alone — so the screen asked the same question in three grammars and the
   user had to learn which one held what.

   Shared by the session setup screen (views-session.js), where it shapes the
   draw pool, and the Regal (views-regal.js), where it filters the shelf, so the
   two cannot offer different controls over the same fields. The predicate they
   apply lives one file further down, in draw-pool.js, because the SERVER
   applies it too. The TAG half is built by each screen and handed in: the two
   screens genuinely differ there (the setup screen has no persisted state to
   prune, the Regal does), while the metadata half is identical on both.

   ## The presentation is an OVERLAY, not an inline disclosure (#844)

   #827 shipped it as a <details>, which unfolded IN the page. On the setup
   screen the trigger shares a `flex-wrap` row with the count stepper, so the
   open body's full-row flex-basis pushed the trigger itself onto the next line —
   one click moved two things the user had not asked to move — and the pool
   preview, which is the whole point of adjusting a filter, was shoved down out
   of view exactly while it was being adjusted.

   So it opens through `openEditor` instead: an anchored popover from 860px up, a
   bottom sheet below (.claude/rules/popover-vs-sheet-editors.md). The trigger
   cannot move, by construction — the body is no longer in the page's flow at all
   — and the preview stays where it is. The applied filters live OUTSIDE the
   overlay as removable chips, which is what the count badge could never do: a
   number says how many are on, never which.

   Frontend shared-scope script; load order: see index.html. */

'use strict';

// Ids for the label/control pairs. Only one metadata body is ever on screen at a
// time, but a counter costs one line and removes the question entirely — the
// `for`/`id` association is what makes each select announce its own name.
let metaFilterSeq = 0;

// Clear every metadata filter, IN PLACE and with no DOM involved.
//
// Separate from the controls on purpose: the empty-pool escape hatch has to work
// while the panel is CLOSED (#844), i.e. when no select or chip exists to
// repaint. The two lists are emptied in place (`length = 0`, not a fresh `[]`),
// because the caller and every chip's paint closure hold the same array —
// reassigning would leave both reading a list this function no longer writes to.
function clearMetadataFilters(state) {
  state.maxPlaytime = null;
  state.weightMin = null;
  state.weightMax = null;
  state.youngestAge = null;
  state.categories.length = 0;
  state.mechanics.length = 0;
}

// Build the metadata half — the rows that filter on BGG's imported fields — or
// return NULL when this shelf carries none of them: a fresh instance without
// BGG_API_TOKEN, or a Regal of hand-typed games. Rendering an empty control
// there would be one that can never do anything, which is why the tag field
// already hides itself with no round tags rather than showing an empty chip row.
//
//  - `games` are the ACTIVE games the filters will be applied to; every option
//    offered is derived from them (draw-pool.js `metadataFilterOptions`).
//  - `state` is the screen's own filter object, mutated in place and expected to
//    have been through `normalizeMetadataFilters` already, so a value whose
//    referent has vanished is gone before a control could show it.
//  - `onChange` is the screen's refresh — the pool preview here, the cover grid
//    there. `renderFilterPanel` wraps it so the applied chips resync too.
//
// Called on every OPEN rather than once per screen (#844), which is what keeps
// the #736 backfill honest: `foldGameInfoList` fills the game objects in place,
// so re-deriving the options here picks up metadata that arrived since the
// screen was drawn, with no rebuild and nothing to invalidate.
//
// Returns { el, repaint }. `repaint` re-reads `state` into every widget without
// rebuilding them — what the applied chips and the escape hatch need when they
// change a filter from outside this body.
function renderMetadataFilter(games, state, onChange) {
  const options = metadataFilterOptions(games);
  if (!hasMetadataFilterOptions(options)) return null;

  const uid = `mf${++metaFilterSeq}`;
  // A plain container: the trigger and the applied chips belong to
  // `renderFilterPanel` below, which wraps this together with the tag half.
  const el = h('<div class="mfilter"></div>');
  const body = el;

  const changed = onChange;
  // One entry per control, each re-reading `state` into its own widget. That is
  // what lets `repaint` follow a filter changed from OUTSIDE this body — an
  // applied chip's ×, or the empty-pool escape hatch — without a rebuild.
  const painters = [];

  // One labelled <select> row. `values` are the ladder's steps, `format` turns a
  // step into its option text, and `key` is the field on `state` it writes —
  // null for "no restriction", which is what the leading „Egal" option means.
  const selectRow = (labelKey, key, values, format) => {
    const id = `${uid}-${key}`;
    const row = h(`<div class="mfilter__row">
        <label class="mfilter__label" for="${id}">${esc(t(labelKey))}</label>
        <select class="sort-select mfilter__select" id="${id}"></select>
      </div>`);
    const sel = row.querySelector('select');
    sel.appendChild(h(`<option value="">${esc(t('metaFilter.any'))}</option>`));
    values.forEach((v) => sel.appendChild(h(`<option value="${v}">${esc(format(v))}</option>`)));
    const paint = () => { sel.value = state[key] === null || state[key] === undefined ? '' : String(state[key]); };
    paint();
    painters.push(paint);
    sel.addEventListener('change', () => {
      state[key] = sel.value === '' ? null : Number(sel.value);
      changed();
    });
    return row;
  };

  if (options.playtime) {
    body.appendChild(selectRow('metaFilter.playtime', 'maxPlaytime', PLAYTIME_CHOICES,
      (v) => t('metaFilter.playtimeOption', { n: v })));
  }
  if (options.weight) {
    // Two bounds in one row, because they are one question. An inverted pick is
    // impossible to make here — choosing a minimum above the current maximum
    // carries the maximum up with it, and vice versa — which is the friendly
    // half of the swap `normalizeMetadataFilters` applies to a hand-crafted one.
    const row = h(`<div class="mfilter__row mfilter__row--range">
        <span class="mfilter__label" id="${uid}-wl">${esc(t('metaFilter.weight'))}</span>
        <span class="mfilter__range" role="group" aria-labelledby="${uid}-wl"></span>
      </div>`);
    const range = row.querySelector('.mfilter__range');
    const bounds = [['weightMin', 'metaFilter.weightMin'], ['weightMax', 'metaFilter.weightMax']]
      .map(([key, labelKey]) => {
        const sel = h(`<select class="sort-select mfilter__select" aria-label="${esc(t(labelKey))}"></select>`);
        sel.appendChild(h(`<option value="">${esc(t('metaFilter.any'))}</option>`));
        WEIGHT_CHOICES.forEach((v) => sel.appendChild(h(`<option value="${v}">${v}</option>`)));
        const paint = () => { sel.value = state[key] === null || state[key] === undefined ? '' : String(state[key]); };
        paint();
        painters.push(paint);
        range.appendChild(sel);
        return { sel, key };
      });
    bounds.forEach(({ sel, key }, i) => {
      sel.addEventListener('change', () => {
        state[key] = sel.value === '' ? null : Number(sel.value);
        const other = bounds[1 - i];
        const otherVal = state[other.key];
        // Carry the other bound along rather than refusing the pick: the user
        // just said what they want, and an empty pool with two visible numbers
        // that contradict each other is the worst of both.
        const inverted = state[key] !== null && otherVal !== null &&
          (i === 0 ? state[key] > otherVal : state[key] < otherVal);
        if (inverted) {
          state[other.key] = state[key];
          other.sel.value = String(state[key]);
        }
        changed();
      });
    });
    body.appendChild(row);
  }
  if (options.age) {
    body.appendChild(selectRow('metaFilter.age', 'youngestAge', AGE_CHOICES,
      (v) => t('metaFilter.ageOption', { n: v })));
  }

  // A plain multi-select chip row, NOT the tri-state tag cycle: these combine
  // with OR (draw-pool.js `matchesAnyOf`), so there is no "reject this one"
  // state to reach and a third click would have nothing to mean.
  //
  // `.mfilter__chips` rather than the app's shared `.filter-chips`: the Regal's
  // phone block hides `.regal-filter .filter-chips` behind its own "Filter"
  // button, and this disclosure mounts inside `.regal-filter` — so borrowing the
  // class would collapse these chips behind a control that does not govern them.
  const chipGroup = (labelKey, key, values) => {
    const id = `${uid}-${key}`;
    const group = h(`<div class="mfilter__group">
        <div class="field__label" id="${id}">${esc(t(labelKey))}</div>
        <div class="mfilter__chips" role="group" aria-labelledby="${id}"></div>
      </div>`);
    const row = group.querySelector('.mfilter__chips');
    values.forEach((v) => {
      const chip = h(`<button type="button" class="chip">${esc(v)}</button>`);
      const paint = () => {
        const on = state[key].includes(v);
        chip.classList.toggle('is-on', on);
        chip.setAttribute('aria-pressed', String(on));
      };
      chip.addEventListener('click', () => {
        const at = state[key].indexOf(v);
        if (at >= 0) state[key].splice(at, 1);
        else state[key].push(v);
        paint();
        changed();
      });
      paint();
      painters.push(paint);
      row.appendChild(chip);
    });
    return group;
  };

  if (options.categories.length) body.appendChild(chipGroup('metaFilter.categories', 'categories', options.categories));
  if (options.mechanics.length) body.appendChild(chipGroup('metaFilter.mechanics', 'mechanics', options.mechanics));

  // Re-read `state` into every widget. The controls are not rebuilt, so a
  // <select> the user has open keeps its identity and the chip rows keep their
  // listeners; only the values move.
  function repaint() { painters.forEach((paint) => paint()); }
  return { el, repaint };
}

// =================== The applied filters, as removable chips ===================

// The tag half's chips, built here rather than on each screen: both screens hold
// the same tri-state map over the same round tags, so one function is what stops
// the Regal and the setup screen from offering different chips over one control
// (.claude/rules/shared-constants-across-the-stack.md).
//
// `afterRemove` is the screen's own repaint of the tag CHIPS INSIDE the panel
// (plus its bulk/mode toggles) — not its data refresh, which the caller already
// runs for every chip kind.
function tagFilterChips(roundTags, tagFilter, afterRemove) {
  return (roundTags || [])
    .filter((tg) => tagFilter.has(tg.id))
    .map((tg) => ({
      // An excluded tag says so IN WORDS („ohne Solo"), not by a colour or a
      // glyph alone: include and exclude are opposite filters and a chip row is
      // read at a glance (.claude/rules/accessibility-contrast-and-modals.md §3).
      label: tagFilter.get(tg.id) === 'exclude'
        ? t('metaFilter.chipTagExcluded', { name: tg.name })
        : tg.name,
      remove: () => { tagFilter.delete(tg.id); afterRemove(); },
    }));
}

// One entry per REMOVABLE filter, `{ label, remove }`, tags first — the panel's
// own section order, and the half a group recognises.
//
// The granularity is deliberately FINER than `countMetadataFilters`, which
// counts controls (all categories are one). A chip whose × cleared six
// categories at once would not be a chip; each selected value gets its own. That
// is also why the count this feeds the trigger's accessible name is computed
// from `chips.length` rather than from `countMetadataFilters` — one number, one
// source, so the label can never disagree with what is on screen.
// `countMetadataFilters` is untouched: the SERVER uses it (lib/routes/sessions.js)
// to decide whether a draw carried filters at all, which is a different question.
function activeFilterChips(state, tagSection) {
  const f = state || {};
  const out = tagSection && tagSection.chips ? tagSection.chips() : [];

  if (f.maxPlaytime !== null && f.maxPlaytime !== undefined) {
    out.push({
      label: t('metaFilter.playtimeOption', { n: f.maxPlaytime }),
      remove: () => { f.maxPlaytime = null; },
    });
  }
  // The two bounds are ONE filter, exactly as `countMetadataFilters` treats them
  // and as the panel renders them: an inverted pair admits nothing at all, so
  // clearing one half and leaving the other is not a state worth reaching from a
  // chip. Which of the three phrasings applies depends on which bounds are set.
  const lo = isFiniteNum(f.weightMin) ? f.weightMin : null;
  const hi = isFiniteNum(f.weightMax) ? f.weightMax : null;
  if (lo !== null || hi !== null) {
    out.push({
      label: lo !== null && hi !== null ? t('metaFilter.chipWeight', { min: lo, max: hi })
        : lo !== null ? t('metaFilter.chipWeightMin', { min: lo })
          : t('metaFilter.chipWeightMax', { max: hi }),
      remove: () => { f.weightMin = null; f.weightMax = null; },
    });
  }
  if (f.youngestAge !== null && f.youngestAge !== undefined) {
    out.push({
      label: t('metaFilter.chipAge', { n: f.youngestAge }),
      remove: () => { f.youngestAge = null; },
    });
  }
  // Per VALUE, not per list. `indexOf` at removal time rather than a captured
  // index: an earlier chip may have spliced the array since this closure was
  // built, and a stale index would drop somebody else's pick.
  ['categories', 'mechanics'].forEach((key) => {
    (f[key] || []).forEach((v) => {
      out.push({
        label: v,
        remove: () => { const at = f[key].indexOf(v); if (at >= 0) f[key].splice(at, 1); },
      });
    });
  });
  return out;
}

// =================== The one filter control ===================

// The trigger plus the applied-filter chips. Returns NULL when there is nothing
// to filter by at all (no round tags AND no metadata on the shelf), so a round
// of hand-typed games without tags sees no filter affordance rather than an
// empty one.
//
//  - `tagSection` is `{ el, chips, reset }` built by the calling screen, or null
//    when the round has no tags. `chips()` is READ on every sync rather than
//    passed in as a list, because the chips mutate the screen's own map and a
//    copy taken at build time would describe a state the user has already left.
//
// Returns { el, sync, reset, isOpen }. A screen calls `sync()` after a tag chip
// moves; the metadata controls route through `onChange` and resync themselves.
function renderFilterPanel(games, state, onChange, tagSection) {
  if (!hasMetadataFilterOptions(metadataFilterOptions(games)) && !tagSection) return null;

  // A real <button>, not the old <summary>: the disclosure's expanded state is
  // gone with it, so `aria-expanded` is set by hand and kept true only while an
  // overlay is actually up (.claude/rules/native-button-vs-focusable-span.md).
  const el = h(`<div class="fbar">
      <button type="button" class="fbar__trigger" aria-expanded="false">
        <i class="ti ti-filter" aria-hidden="true"></i>
        <span>${esc(t('games.filter'))}</span>
      </button>
      <div class="fbar__chips"></div>
    </div>`);
  const trigger = el.querySelector('.fbar__trigger');
  const chipRow = el.querySelector('.fbar__chips');

  // The open overlay's body, or null. Also the answer to `isOpen()`, so there is
  // one fact rather than a flag that can disagree with the DOM.
  let live = null;

  function appliedChip(entry) {
    const chip = h(`<span class="fchip">
        <span class="fchip__label">${esc(entry.label)}</span>
        <button type="button" class="fchip__x" aria-label="${esc(t('metaFilter.removeFilter', { name: entry.label }))}"><i class="ti ti-x" aria-hidden="true"></i></button>
      </span>`);
    chip.querySelector('.fchip__x').addEventListener('click', () => {
      entry.remove();
      // The open panel's own control has to follow the chip that just vanished —
      // an un-pressed category chip, a select back on „Egal".
      if (live) live.repaint();
      sync();
      onChange();
    });
    return chip;
  }

  function sync() {
    const chips = activeFilterChips(state, tagSection);
    trigger.setAttribute('aria-label', t('games.filterLabel', { n: chips.length }));
    chipRow.replaceChildren(...chips.map(appliedChip));
    // `.fbar__chips` declares its own `display`, so the attribute alone would not
    // hide it and an empty row would still cost the bar's gap
    // (.claude/rules/hidden-attribute-vs-display-rule.md).
    chipRow.hidden = chips.length === 0;
  }

  trigger.addEventListener('click', () => {
    // Second click on the trigger closes it. `openPopover`'s outside-click guard
    // exempts the anchor — which is this button — so without this the popover
    // would stay up and the click would read as dead.
    if (live) { live.close(); return; }
    trigger.setAttribute('aria-expanded', 'true');
    openEditor(trigger, 'filter', t('games.filter'), (container, close) => {
      // `tabindex="-1"` so focus can be moved ONTO the body when it opens: the
      // sheet is `aria-modal`, and leaving focus on the trigger behind the
      // backdrop is the state `trapFocus` has to rescue on the first Tab. The
      // body rather than its first <select>, which is the standard dialog
      // pattern and avoids handing arrow keys to a control nobody aimed at.
      // `focusables()` skips `tabindex="-1"`, so it does not become a tab stop.
      const body = h('<div class="fpanel__body" tabindex="-1"></div>');
      // Tags first — they are the round's own vocabulary, so they are the half a
      // group recognises; the metadata rows follow in the order draw-pool.js
      // states them. The two stay visibly separate sections: a provider fact and
      // a round's own word combine differently and must not read as one
      // vocabulary (.claude/rules/provider-metadata-is-a-filter-not-a-tag.md).
      //
      // `tagSection.el` is MOVED in (appendChild moves a node), so every chip
      // listener and the user's current picks survive being closed and reopened.
      if (tagSection) body.appendChild(tagSection.el);
      const meta = renderMetadataFilter(games, state, () => { sync(); onChange(); });
      if (meta) body.appendChild(meta.el);
      container.appendChild(body);
      live = { repaint: () => { if (meta) meta.repaint(); }, close };
      // Returned, not called here: `build` runs on a DETACHED node in the popover
      // path, so a focus() in it is a silent no-op — both presentations invoke
      // this once the container is live (.claude/rules/popover-vs-sheet-editors.md
      // §2). `preventScroll` because a page scroll CLOSES a popover, so scrolling
      // the card into view would dismiss it on the way in.
      return () => body.focus({ preventScroll: true });
    }, () => {
      // Every exit funnels here — ×, Escape, Back, a backdrop tap, an outside
      // click, the page scroll that tears a popover down. Wrapping only the
      // `close` above would leave `aria-expanded` stuck on true for four of them.
      live = null;
      trigger.setAttribute('aria-expanded', 'false');
    });
  });

  // Clears BOTH halves: the empty-pool escape hatch offers one button because
  // the user sees one filter control, and clearing half of it would leave the
  // pool empty with chips still showing. It touches no control it does not have
  // to, so it works with the panel closed — which is the state it is called in.
  function reset() {
    if (tagSection && tagSection.reset) tagSection.reset();
    clearMetadataFilters(state);
    if (live) live.repaint();
    sync();
  }
  sync();
  return { el, sync, reset, isOpen: () => !!live };
}
