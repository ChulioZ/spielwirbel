/* Spielwirbel – the ONE filter control the two game-picking screens carry
   (#827): a single disclosure holding both ways to narrow a shelf — the round's
   own tags (#238/#241/#726) and the filters over the metadata #724 imports from
   BoardGameGeek (#725).

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

   Frontend shared-scope script; load order: see index.html. */

'use strict';

// Ids for the label/control pairs. Only one of these is ever on screen at a
// time, but a counter costs one line and removes the question entirely — the
// `for`/`id` association is what makes each select announce its own name.
let metaFilterSeq = 0;

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
//    there. `renderFilterPanel` wraps it so the shared badge resyncs too.
//
// Returns { el, reset }. `reset` clears every filter and repaints the controls
// in place — the empty-pool escape hatch needs that rather than a rebuild, which
// would snap the panel shut on the user mid-recovery. It deliberately does NOT
// call `onChange`: the panel clears the tag half in the same breath and
// refreshes once.
function renderMetadataFilter(games, state, onChange) {
  const options = metadataFilterOptions(games);
  if (!hasMetadataFilterOptions(options)) return null;

  const uid = `mf${++metaFilterSeq}`;
  // A plain container: the disclosure, its summary and the count badge belong to
  // `renderFilterPanel` below, which wraps this together with the tag half.
  const el = h('<div class="mfilter"></div>');
  const body = el;

  const changed = onChange;
  // One entry per control, each re-reading `state` into its own widget. That is
  // what lets `reset` clear the filters without rebuilding the disclosure.
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

  // The two lists are emptied IN PLACE (`length = 0`, not a fresh `[]`), because
  // the caller and every chip's paint closure hold the same array — reassigning
  // would leave both reading a list this function no longer writes to.
  function reset() {
    state.maxPlaytime = null;
    state.weightMin = null;
    state.weightMax = null;
    state.youngestAge = null;
    state.categories.length = 0;
    state.mechanics.length = 0;
    painters.forEach((paint) => paint());
  }
  return { el, reset };
}

// =================== The one filter control (#827) ===================

// Wrap the two halves — the round's tags and the BGG metadata rows — in a single
// disclosure: one control, one count, one place to look. Returns NULL when there
// is nothing to filter by at all (no round tags AND no metadata on the shelf), so
// a round of hand-typed games without tags sees no filter affordance rather than
// an empty one.
//
//  - `tagSection` is `{ el, count, reset }` built by the calling screen, or null
//    when the round has no tags. `count()` is READ on every sync rather than
//    passed in as a number, because the chips mutate the screen's own map and a
//    copy taken at build time would report a count the user has already changed.
//
// Returns { el, sync, reset }. A screen calls `sync()` after a tag chip moves;
// the metadata controls route through `onChange` and resync themselves.
function renderFilterPanel(games, state, onChange, tagSection) {
  const meta = renderMetadataFilter(games, state, () => { sync(); onChange(); });
  if (!meta && !tagSection) return null;

  // <details>/<summary> rather than a button plus a class toggle: the platform
  // gives the disclosure its expanded state, its keyboard behaviour and its
  // accessible name for free (.claude/rules/native-button-vs-focusable-span.md).
  // The badge is aria-hidden and the count is restated in the summary's
  // aria-label, so it is never conveyed by colour or by a bare glyph alone.
  const el = h(`<details class="fpanel">
      <summary class="fpanel__summary">
        <i class="ti ti-filter" aria-hidden="true"></i>
        <span>${esc(t('games.filter'))}</span>
        <span class="fpanel__badge" aria-hidden="true" hidden></span>
      </summary>
      <div class="fpanel__body"></div>
    </details>`);
  const body = el.querySelector('.fpanel__body');
  const badge = el.querySelector('.fpanel__badge');
  const summary = el.querySelector('.fpanel__summary');

  // Tags first — they are the round's own vocabulary, so they are the half a
  // group recognises; the metadata rows follow in the order draw-pool.js states
  // them. The two stay visibly separate sections inside the one panel: a
  // provider fact and a round's own word combine differently and must not read
  // as one vocabulary (.claude/rules/provider-metadata-is-a-filter-not-a-tag.md).
  if (tagSection) body.appendChild(tagSection.el);
  if (meta) body.appendChild(meta.el);

  // ONE number over both halves. They were deliberately two badges while they
  // were two controls collapsing on different triggers (the chips only below
  // 860px, the drawer at every width) — with a single control and a single
  // trigger there is no "which of the two is filtering" question left for a
  // second number to answer, and both sections are labelled inside.
  function sync() {
    const n = countMetadataFilters(state) + (tagSection ? tagSection.count() : 0);
    badge.textContent = String(n);
    badge.hidden = n === 0;
    summary.setAttribute('aria-label', t('games.filterLabel', { n }));
  }
  // Clears BOTH halves: the empty-pool escape hatch offers one button because
  // the user sees one filter control, and clearing half of it would leave the
  // pool empty with the badge still lit.
  function reset() {
    if (tagSection && tagSection.reset) tagSection.reset();
    if (meta) meta.reset();
    sync();
  }
  sync();
  return { el, sync, reset };
}
