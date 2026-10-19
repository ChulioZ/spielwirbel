/* Spielwirbel – a hub tile's FILL region (#1683).

   In a design that lays the hub's tiles out as a row-major grid, every tile
   stretches to the tallest tile in its row (Der Tisch from 1280px, #1496). The
   Regal, the Chronik and „Wie wär's mit" then sat half empty under one or two
   lines. That height is already spent, so a tile renders MORE items than its
   base content into a fill region, and this file shows the whole ones that fit.

   The contract, and why each half is load-bearing:

   - The region is ALWAYS in the markup, every item `hidden`. Whether a design
     gives it any room is CSS's call (styles.css keeps `.hub-fill` at
     `display: none`; a stretched design shows it with `contain: size`), so no
     renderer asks which design it is in. A region with no height hides
     everything, which is what Klassisch and every column flow get.
   - `contain: size` makes the region contribute ZERO intrinsic height, so the
     row is still sized by the tallest tile's base content. Unhiding items here
     can therefore never make the row taller, and fitting cannot feed back into
     the size it is fitting into.
   - An item that does not fit ENTIRELY is `hidden`, not merely clipped. The
     suggestion rows are links: a CSS-only clip would leave invisible,
     focusable links in the tab order and in the accessibility tree
     (WCAG 2.4.7 / 2.4.11). Once one item overflows, every later one is hidden
     too, so the visible set is always a prefix — never a hole in the order.

   It re-runs whenever the region's size changes, through one shared
   ResizeObserver; its first delivery after `observe()` is the pass after first
   layout. Without ResizeObserver (jsdom) nothing runs and every item stays
   hidden, which is the honest answer for an engine with no layout. NOTE the
   Browser pane fires no ResizeObserver either
   (.claude/rules/preview-pane-paint-artifacts.md), so the fill looks dead
   there: verify it in headless Chrome or the WebKit probe.

   Dependency-free with the module.exports guard, so the fitting rule is
   specced in Node over stubbed rects
   (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

// Half a pixel of slack: rects come back fractional, and an item whose bottom
// sits 0.2px past the region's edge after rounding is not cut through.
const HUB_FILL_SLACK = 0.5;

/* Show the whole items that fit inside `region`, hide the rest. Measures with
   every item shown — which costs nothing, because the region's own size cannot
   move (`contain: size`) — then hides from the first one whose bottom edge
   passes the region's. Only the bottom: the region's content wraps (the cover
   strip) or stacks (the rows), so a too-wide item is not a case — and a row
   bleeds to the card's edge on purpose (`.hub-row`'s negative margin), which a
   sideways check would read as overflowing. Returns how many are visible. */
function fitHubFill(region) {
  const items = [...region.children];
  items.forEach((el) => { el.hidden = false; });
  const box = region.getBoundingClientRect();
  let shown = 0;
  let full = box.height <= 0 || box.width <= 0;
  items.forEach((el) => {
    if (!full) {
      const r = el.getBoundingClientRect();
      full = r.bottom > box.bottom + HUB_FILL_SLACK;
    }
    if (full) el.hidden = true;
    else shown++;
  });
  return shown;
}

/* One observer for every region on the page. A region is dropped when it
   leaves the document — a re-render replaces the whole hub, and a detached
   element reports a size change to zero, which is the delivery that lets it
   go rather than holding the old hub alive.

   ONLY once it has been attached: a region is observed while its card is still
   being built, and a delivery that lands before the card is appended reports
   the same zero. Dropping it then would leave a hub whose fill never runs. */
let hubFillObserver = null;
const hubFillAttached = new WeakSet();
function hubFillObserve(region) {
  if (typeof ResizeObserver === 'undefined') return;
  if (!hubFillObserver) {
    hubFillObserver = new ResizeObserver((entries) => {
      entries.forEach(({ target }) => {
        if (target.isConnected) {
          hubFillAttached.add(target);
          fitHubFill(target);
        } else if (hubFillAttached.has(target)) {
          hubFillObserver.unobserve(target);
        }
      });
    });
  }
  hubFillObserver.observe(region);
}

/* The region itself: `items` are elements (or HTML strings), each one whole
   item. Returns null for an empty list, so a caller can append the result
   unconditionally through a filter. `className` adds the tile's own layout
   (the Regal's cover strip is a wrapping row, the others are lists). */
function hubFill(items, className) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  const region = document.createElement('div');
  region.className = 'hub-fill' + (className ? ' ' + className : '');
  list.forEach((item) => {
    const el = typeof item === 'string' ? h(item) : item;
    el.hidden = true;
    region.appendChild(el);
  });
  hubFillObserve(region);
  return region;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fitHubFill, HUB_FILL_SLACK };
}
