/* Spielwirbel – the „Weitere Filter" disclosure (#725): playing time,
   complexity, minimum age, categories and mechanics, over the metadata #724
   imports from BoardGameGeek.

   Shared by the two screens that pick games — the session setup screen
   (views-session.js), where it shapes the draw pool, and the Regal
   (views-regal.js), where it filters the shelf — so the two cannot offer
   different controls over the same fields. The predicate they apply lives one
   file further down, in draw-pool.js, because the SERVER applies it too.

   Frontend shared-scope script; load order: see index.html. */

'use strict';

// Ids for the label/control pairs. Only one of these is ever on screen at a
// time, but a counter costs one line and removes the question entirely — the
// `for`/`id` association is what makes each select announce its own name.
let metaFilterSeq = 0;

// Build the whole disclosure, or return NULL when this shelf carries none of the
// fields — a fresh instance without BGG_API_TOKEN, or a Regal of storefront
// games. Rendering an empty „Weitere Filter" there would be a control that can
// never do anything, which is why the tag field already hides itself with no
// round tags rather than showing an empty chip row.
//
//  - `games` are the ACTIVE games the filters will be applied to; every option
//    offered is derived from them (draw-pool.js `metadataFilterOptions`).
//  - `state` is the screen's own filter object, mutated in place and expected to
//    have been through `normalizeMetadataFilters` already, so a value whose
//    referent has vanished is gone before a control could show it.
//  - `onChange` is the screen's refresh — the pool preview here, the cover grid
//    there.
//
// Returns { el, sync, reset }. `reset` clears every filter and repaints the
// controls in place — the empty-pool escape hatch needs that rather than a
// rebuild, which would snap the disclosure shut on the user mid-recovery. It
// deliberately does NOT call `onChange`: the caller is clearing the tag filter
// in the same breath and refreshes once.
function renderMetadataFilter(games, state, onChange) {
  const options = metadataFilterOptions(games);
  if (!hasMetadataFilterOptions(options)) return null;

  const uid = `mf${++metaFilterSeq}`;
  // <details>/<summary> rather than a button plus a class toggle: the platform
  // gives the disclosure its expanded state, its keyboard behaviour and its name
  // for free (.claude/rules/native-button-vs-focusable-span.md). The badge is
  // aria-hidden and the count is restated in the summary's aria-label, exactly
  // as the Regal's collapsed tag filter does it — so it is never conveyed by
  // colour or by a bare glyph alone.
  const el = h(`<details class="mfilter">
      <summary class="mfilter__summary">
        <i class="ti ti-chevron-down mfilter__caret" aria-hidden="true"></i>
        <span>${esc(t('metaFilter.title'))}</span>
        <span class="mfilter__badge" aria-hidden="true" hidden></span>
      </summary>
      <div class="mfilter__body"></div>
    </details>`);
  const body = el.querySelector('.mfilter__body');
  const badge = el.querySelector('.mfilter__badge');
  const summary = el.querySelector('.mfilter__summary');

  const changed = () => { sync(); onChange(); };
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

  function sync() {
    const n = countMetadataFilters(state);
    badge.textContent = String(n);
    badge.hidden = n === 0;
    summary.setAttribute('aria-label', t('metaFilter.label', { n }));
  }
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
    sync();
  }
  sync();
  return { el, sync, reset };
}
