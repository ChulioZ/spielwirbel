/* Spielwirbel – Das Programmheft's session loop (#1374): Neue Session (P2.2 at
   390, P4.1 at 1440, P7.7 with twelve people), the vote card (P2.3, P4.2), the
   result (P2.4, P4.3, P7.9 the tie) and the several tables (P4.4, P6.7).
   Sheets: docs/design/programmheft/Programmheft-P2-Phone-Kern.dc.html,
   Programmheft-P4-Session-Desktop.dc.html, Programmheft-P6-Phone-Rest.dc.html
   and Programmheft-P7-Leerzustaende.dc.html.

   Like Die Brücke's (views-session-bruecke.js), everything here RE-COMPOSES
   markup the shared paths have already built: every control keeps its node, its
   id and the listener showStartSession()/startVoting()/showResults() wired onto
   it. The vote card, the result Tafel, the band with its foot and the split
   tables are the composed builders Der Tisch, Ocean and Die Brücke share; this
   file adds only what the programme prints around them. Klassisch never runs a
   line of it — test/programmheft-session-klassisch-golden.test.js pins that.

   The programme renames nothing (P9): every word on these screens is the app's
   own string. The one new key is the report's kicker word „Spielbericht".

   Frontend shared-scope script; nothing here runs at load time, so its place in
   index.html only has to be before main.js
   (.claude/rules/frontend-script-load-order.md). No module.exports — it builds
   DOM, and the spec reaches it through the jsdom harness
   (test/programmheft-session.test.js). */

'use strict';

/* The setup, re-composed. `head` is the page head, `form` the `.setup-grid`
   showStartSession() has just built; ids stay, because it finds every node by
   id after this.

   - The round's marker runs as a rule over the title (P4.1), so the round is
     marked on the one screen that has no masthead line of its own. There is no
     step bar (operator decision E1): the screen is one screen.
   - The seats' label becomes a kicker heading with the tap hint beside it.
   - The pot becomes its own section headed „Der Topf": the filter row in the
     heading line, then the count as the big vermilion numeral beside the games
     listed by name and playtime, then the reset and the owners line. The
     compact strip is hidden in programmheft.css — one presentation of the pot
     at every width.
   - The bar is the black box at the foot (P1's Kasten), „Loswirbeln →".
   - The section line stays from 1280px (P4.1), as Der Tisch keeps its rail
     (T4.1). No section is current: the setup belongs to none.
   DOM order is visual order at every width (WCAG 2.4.3). */
function composeProgrammheftSetup(round, head, form) {
  // The setup is reached from the hub, a deep link and the Chronik's „Noch eine
  // Session"; only the first has applied the marker, so the rule reads it here.
  applyMarker(round);
  head.classList.add('page-head--ph-setup');
  head.prepend(h('<span class="ph-rule" aria-hidden="true"></span>'));
  form.classList.add('setup-grid--ph');

  const main = form.querySelector('.setup-grid__main');
  const seatsLabel = main.querySelector('#seatsLabel');
  const seatsHead = h(`<div class="ph-setup__head">
      <h2 class="ph-kicker" id="seatsLabel">${esc(t('startSession.membersLabel'))}</h2>
      <span class="ph-setup__hint">${esc(t('startSession.seatsTapHint'))}</span>
    </div>`);
  seatsLabel.replaceWith(seatsHead);

  const aside = form.querySelector('.setup-grid__aside');
  const pot = h(`<section class="ph-pot" aria-labelledby="potHeading">
      <div class="ph-pot__head"><h2 class="ph-kicker" id="potHeading">${esc(t('startSession.potHeading'))}</h2></div>
    </section>`);
  pot.querySelector('.ph-pot__head').appendChild(aside.querySelector('.setup-filterbar'));
  // The count stays the panel's <h2> (#poolTitle, filled by updateHint) — the
  // big numeral and its noun ARE the pot's headline, so the section's own
  // heading is the kicker above it and the count is the sub-heading. The owners
  // line is inserted after #poolReset by showStartSession(), so it lands here
  // too, as the section's foot.
  pot.appendChild(aside.querySelector('.setup-panel'));
  pot.appendChild(aside.querySelector('#poolReset'));
  aside.prepend(pot);

  const go = form.querySelector('#go');
  go.innerHTML = `${esc(t('startSession.draw'))} <i class="ti ti-arrow-right" aria-hidden="true"></i>`;

  app.prepend(buildRoundRail(round, null, 'session'));
}

/* What the vote card prints beyond the shared composition (P2.3, P4.2):
   „Zurück" as a word beside its arrow — the sheet's corner key is a labelled
   44px button, not a bare glyph — and the two scale ends under the five cells
   („← gar nicht … unbedingt →"; the README keeps the doubled ends on purpose).
   The ends are the Klassisch card's own row and keys, so a reader hears the
   cells' words once, in their buttons; the row is aria-hidden. */
function composeProgrammheftVoteCard(card) {
  card.classList.add('vote--ph');
  const back = card.querySelector('#backBtn');
  if (back) back.insertAdjacentHTML('beforeend', ` <span class="vote__undo-word">${esc(t('vote.back'))}</span>`);
  const rating = card.querySelector('.rating');
  if (rating) {
    rating.after(h(`<div class="rating-scale" aria-hidden="true"><span>← ${esc(t('vote.scaleLow'))}</span><span>${esc(t('vote.scaleHigh'))} →</span></div>`));
  }
}

/* The report's kicker (P4.3, P2.4, P7.9): „Spielbericht · Sonntag, 14.
   September 2026 · 3 Spiele · 4 dabei", and — for a settled session, the only
   one that HAS a place in the round's count — „Session Nr. 23" beside it, the
   share card's own number (sessionNumber, session-tally.js), so the screen and
   the card it shares can never disagree. */
function programmheftReportKicker(round, session, games, people) {
  const day = new Date(session.createdAt).toLocaleDateString(localeTag(locale),
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const line = [
    t('result.reportKicker'),
    day,
    tn(games.length, 'home.chip.gamesOne', 'home.chip.games'),
    tn(people.length, 'chronik.seatedOne', 'chronik.seated'),
  ].join(' · ');
  const no = session.finished ? `<span class="ph-report__no">${esc(t('card.programmheft.sessionNo', { n: sessionNumber(round, session) }))}</span>` : '';
  return h(`<p class="ph-report">${esc(line)}${no}</p>`);
}

/* The several tables' kicker (P4.4, P6.7): „Spielbericht · Samstag, 20.
   September 2026 · 2 Tische · 7 dabei". */
function programmheftTablesKicker(session, tableCount, peopleCount) {
  const day = new Date(session.createdAt).toLocaleDateString(localeTag(locale),
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return h(`<p class="ph-report">${esc([
    t('result.reportKicker'),
    day,
    tn(tableCount, 'tables.countOne', 'tables.count'),
    tn(peopleCount, 'chronik.seatedOne', 'chronik.seated'),
  ].join(' · '))}</p>`);
}
