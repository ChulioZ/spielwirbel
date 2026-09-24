/* Spielwirbel – Der Tisch's session setup (#1267, T4.1 at 1440, T2.3 at 390).

   The sheet composes the setup as TWO framed panels — „Wer spielt mit?" (the
   seats as a two-column checklist, then the three exception chips) and „Der
   Topf" (the count, the filter, the covers, the owners line) — under a step
   line, with the round rail kept on the left from 1280px up and the one action
   at the foot of the pot.

   This file RE-COMPOSES the form showStartSession() has just built rather than
   building a second one. Every control keeps the node, the id and therefore
   the listener the Klassisch path wires onto it a few lines later, so there is
   one setup with two arrangements, not two setups that can drift — and the
   Klassisch branch never runs a line of this file.

   Frontend shared-scope script; nothing here runs at load time, so its place in
   index.html only has to be before main.js
   (.claude/rules/frontend-script-load-order.md). */

'use strict';

// „Donnerstag, 24.09." — the date is TODAY, because the session this screen
// draws is created now and carries now as its date. The sheet prefixes it with
// „Schritt 1 von 3"; that counter is deliberately left out (operator,
// 2026-09-24): no later screen continues it, and the vote card's own
// „Spiel 2 von 3" would read as its step 2.
function tischSetupDateLine(now = new Date()) {
  return now.toLocaleDateString(localeTag(locale), { weekday: 'long', day: '2-digit', month: '2-digit' });
}

// T2.3's line under the action: „4 spielen mit · 3 von 9 Spielen werden
// gezogen". The drawn number is clamped to the pot — the server draws at most
// what is in it, and „5 von 3" would promise games that do not exist. An empty
// pot has nothing to draw from, so it falls back to the pot's own headline.
function tischDrawSummary(people, potSize, count) {
  const seated = tn(people, 'startSession.tableCountOne', 'startSession.tableCount');
  if (!potSize) return seated + ' · ' + tn(0, 'startSession.availableOne', 'startSession.available');
  const drawn = Math.max(1, Math.min(Number.isInteger(count) ? count : 1, potSize));
  return seated + ' · ' + tn(drawn, 'startSession.drawOfOne', 'startSession.drawOf', { total: potSize });
}

/* Re-compose `form` (and the page head above it) into the sheet's two panels.

   What moves, and why each move keeps the reading order equal to the picture
   (WCAG 2.4.3 — no `order:` anywhere, the DOM IS the layout):
   - the seats' label becomes the panel's <h2>, with the tap hint beside it;
   - the pool's pieces are wrapped in a <section> headed „Der Topf", and the
     count moves UP into that heading row, which is where both sheets draw it —
     so the phone strip's own numeral is hidden in CSS rather than stated twice;
   - the bar's summary moves BELOW the button, which is where T2.3 prints it.
   The ids stay, because showStartSession() finds every node by id after this. */
function composeTischSetup(round, head, form) {
  head.appendChild(h(`<p class="tisch-setup__step">${esc(tischSetupDateLine())}</p>`));
  form.classList.add('setup-grid--tisch');

  const main = form.querySelector('.setup-grid__main');
  main.classList.add('tisch-setup__panel');
  const seatsLabel = main.querySelector('#seatsLabel');
  const seatsHead = h(`<div class="tisch-setup__head">
      <h2 class="tisch-setup__title" id="seatsLabel">${esc(t('startSession.membersLabel'))}</h2>
      <span class="tisch-setup__sub">${esc(t('startSession.seatsTapHint'))}</span>
    </div>`);
  seatsLabel.replaceWith(seatsHead);

  const aside = form.querySelector('.setup-grid__aside');
  const pot = h(`<section class="tisch-setup__panel tisch-pot" aria-labelledby="potHeading">
      <div class="tisch-setup__head">
        <h2 class="tisch-setup__title" id="potHeading">${esc(t('startSession.potHeading'))}</h2>
      </div>
    </section>`);
  // The count leaves the panel's heading for the pot's: an <h2> of its own
  // under „Der Topf" would be a second heading for the same thing.
  const oldTitle = aside.querySelector('#poolTitle');
  const count = h('<p class="tisch-pot__count" id="poolTitle"></p>');
  oldTitle.remove();
  pot.querySelector('.tisch-setup__head').appendChild(count);
  // Moved in DOM order, so the section reads filter → covers → reset in the
  // order they already stood. The owners note is inserted after #poolReset by
  // showStartSession(), i.e. inside this section, where the sheet puts it.
  ['.setup-filterbar', '.setup-panel', '#poolReset'].forEach((sel) => pot.appendChild(aside.querySelector(sel)));
  aside.prepend(pot);

  const bar = aside.querySelector('.setup-bar');
  bar.appendChild(bar.querySelector('#barSummary'));

  // The rail stays on this screen from 1280px up (T4.1). It is the RAIL alone:
  // below 1280 the setup keeps its focused, dock-less column, exactly as today.
  // No section is current — the setup belongs to none — so every row is a live
  // link. Leaving through one discards the unsaved setup exactly as Back does:
  // this screen holds its state in the closure and registers no flow
  // (`endFlow()` at its top), so any navigation away simply drops it.
  app.prepend(buildRoundRail(round, null, 'session'));
}
