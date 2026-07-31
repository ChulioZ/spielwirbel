/* Spielwirbel – the edition-cover picker (#519).

   A collapsible grid of every box art BoardGameGeek holds for one game, so a
   round can show the printing that is actually on their table instead of
   whatever /thing serves as the item's default image.

   It is its own file, and not part of any view, because THREE screens open the
   same grid: the add-game sheet's cover field, the game-detail cover editor and
   the collection-import list (public/js/views-round-lookup.js and
   views-round-detail.js). Keeping one renderer is what stops the three drifting
   — and it has no module.exports guard on purpose: it is DOM-only, so requiring
   it from a test would drag an almost-unreachable file into the coverage report
   (.claude/rules/frontend-helper-modules-and-coverage.md). The pure half — the
   language-first sort and the dedupe — lives in bgg-covers.js and IS unit
   tested. */

'use strict';

// A picker for one game. Returns the container element; the caller places it.
//
//   roundId     – the lookup route is round-scoped (#294), so a round with BGG
//                 switched off gets an enforced 403 rather than an answer
//   externalId  – the game's BGG id
//   current     – the cover URL shown today, highlighted in the grid (or null)
//   onPick      – called with the chosen { imageUrl, edition, year, languages }
//
// The element exposes `setCurrent(url)` so a caller whose cover changes by some
// other route (a clipboard paste in the add-game sheet) can keep the highlight
// honest without rebuilding the grid.
//
// The fetch is LAZY — nothing is requested until the grid is expanded. That is
// the whole reason this is a second request rather than part of detail():
// `versions=1` makes the body 2.5–5x heavier and ~200 ms slower (measured
// 2026-07-28), which every pick would otherwise pay for a picker most picks
// never open.
function editionCoverPicker(roundId, externalId, current, onPick) {
  const el = h(`<div class="cover-picker">
      <button type="button" class="link-btn cover-picker__toggle" aria-expanded="false">
        <i class="ti ti-photo" aria-hidden="true"></i> <span></span>
      </button>
      <div class="cover-picker__body" hidden></div>
    </div>`);
  const toggle = el.querySelector('.cover-picker__toggle');
  const label = toggle.querySelector('span');
  const body = el.querySelector('.cover-picker__body');
  let covers = null; // null = not fetched yet
  let chosen = current || null;

  const paintLabel = () => {
    label.textContent = body.hidden ? t('coverPicker.open') : t('coverPicker.close');
  };

  const paintCurrent = () => {
    body.querySelectorAll('.cover-pick').forEach((tile) => {
      const on = !!chosen && tile.dataset.url === chosen;
      tile.classList.toggle('is-current', on);
      tile.setAttribute('aria-pressed', String(on));
    });
  };

  // Everything that changes the body's height goes through here. The desktop
  // cover editor is an ANCHORED popover, placed once from its own height, and a
  // page scroll CLOSES it — so a card that grew after placement hangs off the
  // bottom of the viewport unreachably. repositionPopover() is a no-op in the
  // sheet and inline presentations, so this component stays presentation-blind.
  function setBody(...nodes) {
    body.replaceChildren(...nodes);
    repositionPopover();
  }

  function renderGrid() {
    const sorted = sortEditionCovers(covers, getLocale());
    if (!sorted.length) {
      setBody(h(`<p class="muted cover-picker__msg">${esc(t('coverPicker.empty'))}</p>`));
      return;
    }
    const grid = h('<div class="cover-picker__grid" role="group"></div>');
    grid.setAttribute('aria-label', t('coverPicker.groupLabel'));
    sorted.forEach((c) => {
      const caption = coverCaption(c);
      // A real <button>, not a focusable div: focus, Enter and Space all come
      // from the platform (.claude/rules/native-button-vs-focusable-span.md).
      // aria-pressed makes "this is the cover in use" more than a colour
      // (.claude/rules/accessibility-contrast-and-modals.md §3).
      const tile = h(`<button type="button" class="cover-pick" aria-pressed="false"
          aria-label="${esc(caption || t('coverPicker.tileFallback'))}">
          <img class="cover-pick__img" src="${esc(c.imageUrl)}" alt="" loading="lazy" />
          <span class="cover-pick__caption">${esc(caption)}</span>
        </button>`);
      tile.dataset.url = c.imageUrl;
      tile.addEventListener('click', () => {
        chosen = c.imageUrl;
        paintCurrent();
        onPick(c);
      });
      grid.appendChild(tile);
    });
    setBody(grid);
    paintCurrent();
  }

  async function load() {
    setBody(h(`<p class="muted cover-picker__msg">${esc(t('coverPicker.loading'))}</p>`));
    try {
      const res = await api('GET', `/api/rounds/${roundId}/lookup/covers?provider=bgg&id=${encodeURIComponent(externalId)}`);
      covers = res.covers || [];
    } catch {
      // Left as null so re-opening retries rather than caching the failure.
      setBody(h(`<p class="muted cover-picker__msg">${esc(t('coverPicker.error'))}</p>`));
      return;
    }
    renderGrid();
  }

  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    paintLabel();
    // Collapsing shrinks the card, which also needs the popover re-placed.
    if (body.hidden) return repositionPopover();
    if (covers === null) load();
    else renderGrid();
  });

  paintLabel();
  el.setCurrent = (url) => { chosen = url || null; paintCurrent(); };
  return el;
}
