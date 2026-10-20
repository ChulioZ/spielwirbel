/* Spielwirbel – Konto: an index of its sections beside them (#1376, #1582). */

'use strict';

/* The Konto's index (#1376 P5.3 for Das Programmheft, every non-Tisch design
   since #1582): a list of the screen's sections beside the sections
   themselves, every one still on the page. The shared screen is first grouped
   into sections (composeKontoCards, so every form and handler is Klassisch's),
   then laid out as two columns — the index on the left, the sections on the
   right. Each design's stylesheet draws both; Klassisch's base rules live in
   styles.css, and below 1024px every design hides the index again.

   Programmheft's sheet draws the index as if it switched between pages; it
   does not here. Hiding every section but one would move entries out of reach
   (handover §2), so each index entry only JUMPS to its section — a button that
   scrolls the section's heading into view and hands it focus. Buttons, not
   `#hash` links: a fragment navigation fires popstate, which the router answers
   with a full re-render.

   The index is built from the headings actually on the page, so a demo (fewer
   sections) and an instance offering one design (no design heading) get an
   index that matches.

   Its own file rather than a branch inside views-account.js, for
   views-account-tisch.js's reason: that file is on the token budget's
   allowlist, and a composition of the screen is a concern of its own. Loaded
   after views-account.js; called only at render time. */
function composeKontoIndex() {
  composeKontoCards();
  const sections = [...app.children].filter((el) => el.matches('.konto-card, .konto-design'));
  const layout = h('<div class="konto-ph"></div>');
  const nav = h(`<nav class="konto-index" aria-label="${esc(t('konto.index.label'))}"><ul class="konto-index__list"></ul></nav>`);
  const body = h('<div class="konto-ph__body"></div>');
  const list = nav.querySelector('ul');
  if (sections.length) sections[0].before(layout);
  for (const section of sections) {
    body.appendChild(section);
    const heading = section.querySelector('.konto-section__h, h2');
    if (!heading) continue;
    const item = h(`<li><button type="button" class="konto-index__link">${esc(heading.textContent)}</button></li>`);
    item.querySelector('button').addEventListener('click', () => {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      section.scrollIntoView({ block: 'start' });
    });
    list.appendChild(item);
  }
  layout.appendChild(nav);
  layout.appendChild(body);
}
