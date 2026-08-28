'use strict';

/* Driving the ONE filter control (#827/#844) from a jsdom spec.

   Since #844 the panel's body opens as an OVERLAY (`openEditor`), so a spec that
   wants a control has to open it first — and the body then lives under
   `document.body`, not under `#app`. Three spec files drive it (the panel itself,
   the tag bulk toggle, the AND/OR mode), and each of them got the same four
   things wrong on the way, so the kit is shared rather than copied
   (.claude/rules/shared-constants-across-the-stack.md applied to a test harness):

    - jsdom implements NO `matchMedia`, and `usesEditorSheet()` reads it off
      `window`. Without a stub every trigger click throws INSIDE the listener,
      which jsdom swallows into `window.onerror` — the panel simply never opens
      and nothing says why.
    - `false` = below the breakpoint = the SHEET branch, which is what these
      specs drive. The popover branch is routed-tested in
      test/editor-presentation.test.js and in filter-panel.test.js.
    - every query must go through `dom.document`; a `dom.app` query silently
      finds nothing once the body has moved out of the page.
    - an overlay survives `dom.app.innerHTML = ''`, so a spec that re-renders the
      screen still has the PREVIOUS spec's panel on screen — which reads as "the
      panel is already open" in a spec that never opened one. Hence `closePanel`
      and the `beforeEach` every one of them registers. */

const assert = require('node:assert/strict');

function filterPanelKit(dom) {
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');

  const trigger = () => dom.document.querySelector('.fbar__trigger');
  const panelBody = () => dom.document.querySelector('.editor--filter, .popover--filter');
  const closePanel = () => dom.run('closeSheet(); closePopover();');
  const openPanel = () => {
    const t = trigger();
    assert.ok(t, 'no filter trigger on screen to open');
    if (!panelBody()) t.click();
    return panelBody();
  };
  // The tag half, which both tag specs used to reach straight out of `#app`.
  const tagSection = () => {
    const body = openPanel();
    const section = body && body.querySelector('.fpanel__group');
    assert.ok(section, 'the open panel carries no tag section');
    return section;
  };
  const appliedChips = () =>
    [...dom.document.querySelectorAll('.fbar__chips .fchip__label')].map((el) => el.textContent);
  const triggerLabel = () => trigger().getAttribute('aria-label');

  return { trigger, panelBody, openPanel, closePanel, tagSection, appliedChips, triggerLabel };
}

module.exports = { filterPanelKit };
