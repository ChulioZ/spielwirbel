/* Spielwirbel – Konto as Das Programmheft composes it (#1376). */

'use strict';

/* Das Programmheft's Konto (#1376, P5.3): a programme's CONTENTS beside its
   pages. The shared screen is composed into sections exactly as Ocean and Die
   Brücke do it (composeKontoCards, so every form and handler is Klassisch's),
   and then laid out as two columns — an index of those sections on the left,
   the sections themselves on the right, every one still on the page.

   The sheet draws the index as if it switched between pages; it does not here.
   Hiding every section but one would move entries out of reach (handover §2),
   so each index entry only JUMPS to its section — a button that scrolls the
   section's heading into view and hands it focus. Buttons, not `#hash` links:
   a fragment navigation fires popstate, which the router answers with a full
   re-render.

   The index is built from the headings actually on the page, so a demo (fewer
   sections) and an instance offering one design (no design heading) get an
   index that matches.

   Its own file rather than a branch inside views-account.js, for
   views-account-tisch.js's reason: that file is on the token budget's
   allowlist, and a design's composition of the screen is a concern of its
   own. Loaded after views-account.js; called only at render time. */
function composeKontoProgramme() {
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
