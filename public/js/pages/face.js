'use strict';

/*
 * The FACE design for the two static pages outside the SPA (#1198) —
 * login.html and kontakt.html. Loaded in <head>, right after /js/designs.js,
 * and deliberately synchronous: it writes <html data-design> before the body
 * is parsed, so the page never paints Klassisch first and repaints.
 *
 * Why FACE_DESIGN and not GET /api/config's `faceDesign`: lib/app.js builds
 * that value FROM this constant (.claude/rules/shared-constants-inventory.md),
 * so the two cannot disagree — and the request would arrive after the first
 * paint. /faq and the legal pages get the same attribute from the server
 * (lib/faq.js, lib/legal.js); views-vote-link.js does the same in the SPA.
 *
 * The attribute alone does nothing: each page carries its own copy of the
 * face-ready designs' tokens under `:root[data-design="…"]`, pinned by
 * test/standalone-page-brand.test.js. Under Klassisch no such block matches,
 * so the page renders exactly as it did before this file existed.
 */
(function () {
  if (typeof FACE_DESIGN === 'string') document.documentElement.dataset.design = FACE_DESIGN;
})();
