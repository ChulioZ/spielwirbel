/* Spielwirbel – Ocean's session loop (#1213): the setup (O2.2 at 390, O4.1 at
   1440), the vote card's desktop side columns (O4.2), and the result's columns
   (O2.4, O4.4). Sheets: docs/design/ocean/Ocean-O2-Phone-Kern.dc.html and
   Ocean-O4-Session-Desktop.dc.html.

   Like Der Tisch's setup (views-session-setup-tisch.js), everything here
   RE-COMPOSES markup the Klassisch path has already built: every control keeps
   its node, its id and therefore the listener showStartSession()/showResults()
   wire onto it, so there is one setup and one result with an Ocean arrangement,
   not two that can drift. Klassisch never runs a line of this file.

   What Ocean composes, and why it is markup rather than paint:
   - SETUP: three columns — who plays, the Muschel, the count and „Abtauchen".
     The pool's tile panel becomes the shell with its count as a pill UNDER the
     covers, and the filter row and the owners line move into the shell's column,
     below it, where both sheets draw them. The count gets its bubbles and the
     summary goes under the button.
   - VOTE (1440 only): „wer hat schon gewertet" on the left and „in der Tiefe"
     on the right of the card. Both are built for every width and hidden below
     the desktop breakpoint in ocean.css, the same render-both shape the rail and
     the dock use.
   - RESULT: the people as their own column, the head and the band (the whale)
     in the middle, the Tafel and the foot on the right.

   DOM order is visual order at every width (WCAG 2.4.3): nothing below relies
   on `order:` or on a grid placement that runs against the source.

   Frontend shared-scope script; nothing here runs at load time, so its place in
   index.html only has to be before main.js
   (.claude/rules/frontend-script-load-order.md). No module.exports — it builds
   DOM, and the specs reach it through the jsdom harness
   (test/ocean-session.test.js, .claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

/* Is Ocean the design worn right now? The one place the session screens ask.
   Spelled here rather than as designIs('ocean') at each call site because
   „ocean" is ALSO a retired round world (round-marker.js), and
   test/result-tafel.test.js holds views-session.js free of every retired
   world's id — the user design and the world share it
   (.claude/rules/light-design-gate-and-shared-design-ids.md). */
function oceanWorn() {
  return designIs('ocean');
}

// How many bubbles the count row draws before it stops adding them. The number
// itself is always in the stepper beside it; the bubbles are the picture of it.
const OCEAN_COUNT_BUBBLES = 8;

/* The setup, re-composed. `form` is the `.setup-grid` showStartSession() has
   just built; ids stay, because it finds every node by id after this. */
function composeOceanSetup(form) {
  form.classList.add('setup-grid--ocean');
  const aside = form.querySelector('.setup-grid__aside');

  /* The Muschel. The tile panel is the shell at every width under Ocean (the
     compact strip is hidden in CSS), and its headline — „9 Spiele in der
     Muschel" — moves BELOW the covers, where both sheets set it as the pill on
     the shell's lip. The section keeps the headline as its name, so the covers
     are announced under it whatever order they are read in. */
  const panel = aside.querySelector('.setup-panel');
  panel.appendChild(panel.querySelector('#poolTitle'));
  const shell = h('<section class="ocean-muschel" aria-labelledby="poolTitle"></section>');
  shell.appendChild(panel);
  // Under the shell: the filter row (its trigger and the applied chips), then
  // the way out of an empty pool. The owners line is inserted after #poolReset
  // by showStartSession(), so it lands here too, as the shell's footnote.
  ['.setup-filterbar', '#poolReset'].forEach((sel) => shell.appendChild(aside.querySelector(sel)));
  aside.prepend(shell);

  /* The count and the one action. The count question and the button are two of
     Ocean's five themed words (docs/design/ocean/README.md): „Wie viele holen
     wir hoch?" and „Abtauchen". The page title stays „Neue Session". */
  const bar = aside.querySelector('.setup-bar');
  bar.querySelector('.setup-bar__count label').textContent = t('startSession.countQuestionOcean');
  bar.querySelector('.stepper').before(h('<span class="ocean-count" aria-hidden="true"></span>'));
  const go = bar.querySelector('#go');
  go.innerHTML = `<i class="ti ti-wave-sine" aria-hidden="true"></i> ${esc(t('round.startSessionOcean'))}`;
  // The line under the action, as O2.2 prints it under „Abtauchen".
  bar.appendChild(bar.querySelector('#barSummary'));
}

// The count's bubbles: one per game that will be drawn, capped. Called from
// updateHint(), which every count change reaches under Ocean.
function paintOceanCount(form) {
  const row = form.querySelector('.ocean-count');
  if (!row) return;
  const n = parseInt(form.querySelector('#count').value, 10);
  const shown = Math.max(0, Math.min(Number.isInteger(n) ? n : 0, OCEAN_COUNT_BUBBLES));
  row.innerHTML = '<span class="ocean-count__bubble"></span>'.repeat(shown);
  row.classList.toggle('is-more', Number.isInteger(n) && n > OCEAN_COUNT_BUBBLES);
}

/* O4.2's two side columns. `people` is everyone voting in this session, `person`
   the one rating now, `votedIds` who is already in, `left` how many of this
   person's cards come after the current one. Returned separately because they
   stand on either side of the card: the raters BEFORE it in the DOM, the deep
   after it. */
function oceanVoteSides(round, people, person, votedIds, left) {
  const voted = new Set(votedIds || []);
  const done = people.filter((p) => p.id !== person.id && voted.has(p.id)).length;
  const rows = people.map((p) => {
    const state = p.id === person.id ? 'now' : voted.has(p.id) ? 'done' : 'open';
    const key = { now: 'vote.raterNow', done: 'vote.raterDone', open: 'vote.raterOpen' }[state];
    return `<li class="ocean-raters__row is-${state}">
         <span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${avatarFace(initials(p.name), { userId: p.userId })}</span>
         <span class="ocean-raters__text"><span class="ocean-raters__name">${esc(personLabel(p))}</span>
         <span class="ocean-raters__state">${esc(t(key))}</span></span>
       </li>`;
  }).join('');
  const raters = h(`<aside class="ocean-raters" aria-labelledby="oceanRatersTitle">
       <h2 class="ocean-side__title" id="oceanRatersTitle">${esc(t('lobby.progress', { n: done, total: people.length }))}</h2>
       <ul class="ocean-raters__list">${rows}</ul>
     </aside>`);
  // The last card has nothing below it, so the column stands down rather than
  // promising cards that are not there.
  const deep = left > 0 ? h(`<aside class="ocean-deep" aria-labelledby="oceanDeepTitle">
       <h2 class="ocean-side__title" id="oceanDeepTitle">${esc(t('vote.deepOcean'))}</h2>
       <p class="ocean-deep__text">${esc(tn(left, 'vote.deepTextOceanOne', 'vote.deepTextOcean'))}</p>
       <span class="ocean-deep__cards" aria-hidden="true">${'<span class="ocean-deep__card"></span>'.repeat(Math.min(left, 3))}</span>
     </aside>`) : null;
  return { raters, deep };
}

/* The result, in columns (O4.4): the people, then the head with the band (the
   whale), then the Tafel with everything after it. Called once at the end of
   showResults(), after the foot is appended; renderTisch() and friends hold
   their nodes by reference, so moving them changes nothing they do.

   `peopleEl` is Der Tisch's crowned „Wer dabei war" row, which the shared
   composition puts inside the head; here it is the first column instead. */
function composeOceanResult(screen, head, peopleEl) {
  screen.classList.add('result-screen--ocean');
  const people = h('<div class="ocean-result__people"></div>');
  const main = h('<div class="ocean-result__main"></div>');
  const side = h('<div class="ocean-result__side"></div>');
  const kids = [...screen.children];
  const tafelAt = kids.findIndex((el) => el.classList.contains('tafel'));
  kids.forEach((el, i) => {
    if (el === head || (tafelAt >= 0 && i < tafelAt)) main.appendChild(el);
    else side.appendChild(el);
  });
  if (peopleEl) people.appendChild(peopleEl);
  screen.replaceChildren(...(peopleEl ? [people] : []), main, side);
}
