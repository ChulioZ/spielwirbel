/* Spielwirbel – Forest's tier 2b (#1474; sheet Forest-F14-Tier2b): the markup
   Forest composes differently on the round's Einstellungen, kept out of
   views-round-settings.js because that file sits close to the 700-line budget
   (.claude/rules/token-friendly-source-files.md).

   The other F14 screens — the profile, the Freundeskreis and its feed, the
   inbox, „Was ist neu" and „Entdecken" — take the row forms and decorations the
   earlier designs already share (feed rows, composed inbox rows, the news kind,
   the BGG mark in the head) and are otherwise forest.css's #1474 section alone.

   Every builder here is called only under designIs('forest'), so Klassisch's
   DOM never sees any of it (test/forest-tier2b.test.js pins that with a golden
   snapshot). No module.exports — it builds DOM, so requiring it from Node would
   enter the coverage report unreachable
   (.claude/rules/frontend-helper-modules-and-coverage.md).

   Part of the frontend; all files share one global script scope. Loaded after
   views-round-settings.js; it is called at render time, never at load time
   (.claude/rules/frontend-script-load-order.md). */

'use strict';

/* Forest's Einstellungen (F14.1): every section a card on the clearing, in two
   columns from 1100px — the round's own set-up on the LEFT (the name, the
   marker, „Runde einrichten" with its tags, the saved filters), what acts on
   the round on the RIGHT („Runde verwalten", then the Gefahrenzone). Below
   1100px the two simply stack, in that order. DOM order is the reading order
   (WCAG 2.4.3); the grid only places it.

   Composed AFTER the shared build out of its own nodes, like Ocean's, Das
   Programmheft's and Die Brücke's, so every handler showRoundSettings wired is
   the one that runs. The marker card states, in the app's own sentence
   (`marker.note`), that the marker is the ROUND's and that everyone sees it in
   their own design — the picker must not read as a Forest-only setting. */
function composeForestSettings(round, rid) {
  const head = app.querySelector(':scope > .page-head');
  const kids = [...app.children];
  const after = kids.slice(kids.indexOf(head) + 1);
  const main = h('<div class="rs-fo__col"></div>');
  const aside = h('<div class="rs-fo__col rs-fo__col--act"></div>');

  // The name heads the set-up (F14.1 „Name der Runde"). Renaming is co-owner
  // and up (#137); below that the card is simply absent, as on Das
  // Programmheft — the name is already the screen's context.
  if (roundCan(round, 'round.edit')) main.appendChild(forestNameCard(round));

  const marker = h(`<section class="rs-fo__card rs-fo__card--marker">
       <h2 class="rs-section__h">${esc(t('marker.title'))}</h2>
       <p class="rs-fo__note">${esc(t('marker.note'))}</p>
     </section>`);
  marker.appendChild(renderMarkerGrid(round, rid));
  main.appendChild(marker);

  // Each heading opens a card that takes its siblings up to the next one.
  // „Runde verwalten" and the Gefahrenzone are the right-hand column.
  const manage = t('roundSettings.manage');
  let card = null;
  let col = main;
  after.forEach((el) => {
    if (el.matches('h2.rs-section__h')) {
      const danger = el.classList.contains('rs-section__h--danger');
      if (danger || el.textContent === manage) col = aside;
      card = h(`<section class="rs-fo__card${danger ? ' rs-fo__card--danger' : ''}"></section>`);
      col.appendChild(card);
    }
    if (card) card.appendChild(el);
  });

  // F14.1 shows the round's tags in the set-up. They stay the Tags screen's to
  // edit — the row above still leads there — so here they are the app's own
  // read-only tag labels, not chips: a chip in Forest is a control (F1.4).
  const tagsRow = main.querySelector(`a.rs-row[href="${roundPath(rid, 'tags')}"]`);
  const tags = round.tags || [];
  if (tagsRow && tags.length) {
    tagsRow.closest('.ds-list').after(h(`<p class="rs-fo__tags">${tags
      .map((tg) => `<span class="tag tag--custom"><i class="ti ${tagIconClass(tg.icon)}" aria-hidden="true"></i>${esc(tg.name)}</span>`)
      .join(' ')}</p>`));
  }

  const cols = h('<div class="rs-fo"></div>');
  cols.appendChild(main);
  cols.appendChild(aside);
  app.appendChild(cols);
}

/* The round's name as an always-open field in a card (F14.1). The label is the
   new-round form's own („Name der Runde") — the same field asked again, so no
   new copy — and a real <label for>, the sheet's markup. The commit is
   wireRoundNameField's (views-round-settings.js), shared with Das Programmheft:
   on blur, Enter blurs, Escape restores. */
function forestNameCard(round) {
  const card = h(`<section class="rs-fo__card rs-fo__card--name">
       <label class="rs-fo__label" for="rsFoName">${esc(t('newRound.nameLabel'))}</label>
       <input class="input rs-fo__name" id="rsFoName" type="text" autocomplete="off" enterkeyhint="done" />
     </section>`);
  wireRoundNameField(card.querySelector('input'), round);
  return card;
}
