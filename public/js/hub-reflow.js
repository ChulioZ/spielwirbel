/* Spielwirbel – moving a hub's cells between two DOM arrangements at a
   breakpoint (#1496).

   A hub whose desktop columns cut ACROSS its phone order cannot be one grid of
   slots: the slots share row lines, so a short column waits for the tallest
   one beside it and opens a hole (Die Brücke's Missionskontrolle sat ~700px
   above „Zuletzt gespielt"). Column wrappers fix that, but only at the width
   that has columns — on a phone the same cells must stay in the phone order,
   which is also the tab order. So the frame keeps BOTH arrangements and this
   moves its cells between them: DOM order is the visual order at every width,
   and no `order` is needed anywhere.

   `matchMedia`'s `change`, never `resize`: it fires once per crossing, not per
   pixel. A listener whose hub has left the document is dropped the next time
   any hub registers, so re-rendering the Start tab does not pile them up.
   Without matchMedia (jsdom, an old browser) the narrow arrangement stands —
   the phone order, which reads correctly at any width.

   Part of the frontend; all files share one global script scope. Dependency-
   free, so it loads with the helpers before the views
   (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

const hubReflows = [];

function reflowAt(query, root, apply) {
  for (let i = hubReflows.length - 1; i >= 0; i--) {
    const r = hubReflows[i];
    if (!r.root.isConnected) {
      r.mq.removeEventListener('change', r.onChange);
      hubReflows.splice(i, 1);
    }
  }
  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query) : null;
  apply(!!(mq && mq.matches));
  if (!mq || typeof mq.addEventListener !== 'function') return;
  const onChange = (e) => apply(e.matches);
  mq.addEventListener('change', onChange);
  hubReflows.push({ root, mq, onChange });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { reflowAt, hubReflows };
}
