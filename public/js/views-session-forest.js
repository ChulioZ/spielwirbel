/* Spielwirbel – Forest's session loop (#1468): Neue Session with the tree stump
   (F2.2 at 390, F4.1 at 1440, F7.7 with twelve people), the vote card (F2.3,
   F4.2), the finale and the result (F2.4, F4.3, F7.9 the tie) and the several
   tables (F4.4, F6.7). Sheets: docs/design/forest/Forest-F2-Phone-Kern.dc.html,
   Forest-F4-Session-Desktop.dc.html, Forest-F6-Phone-Rest.dc.html and
   Forest-F7-Leerzustaende.dc.html.

   Like Ocean's (views-session-ocean.js), everything here RE-COMPOSES markup
   the shared paths have already built: every control keeps its node, its id
   and the listener showStartSession()/startVoting()/showResults() wired onto
   it. The vote card, the result Tafel and its foot and the split tables are the
   composed builders Der Tisch, Ocean, Die Brücke and Das Programmheft share;
   this file adds only what the clearing draws around them. Klassisch never runs
   a line of it — the golden in test/programmheft-session-klassisch-golden.test.js
   pins that, with a Forest control.

   Forest's four themed places (F9.5, operator decisions E2/E3) are the stump
   („Der Baumstumpf", „{n} Spiele auf dem Stumpf"), the count question „Wie
   viele Blätter fliegen?", the setup's „Laub wirbeln" and the reveal verb „Die
   Karten leuchten auf."; every other word is the app's own.

   #1469 (the shared vote and the pass-device blind) builds on this file: it is
   where forestWorn() lives, and its blind and lobby belong at the end of it.

   Frontend shared-scope script; nothing here runs at load time, so its place in
   index.html only has to be before main.js
   (.claude/rules/frontend-script-load-order.md). No module.exports — it builds
   DOM, and the specs reach it through the jsdom harness
   (test/forest-session.test.js). */

'use strict';

/* Is Forest the design worn right now? The one place the session screens ask.
   Spelled here rather than as designIs('forest') at each call site because
   „forest" is ALSO a retired round world (round-marker.js), and
   test/result-tafel.test.js holds views-session.js free of every retired
   world's id — the user design and the world share it
   (.claude/rules/light-design-gate-and-shared-design-ids.md §4). */
function forestWorn() {
  return designIs('forest');
}

// How many leaves the count row draws before it stops adding them. The number
// itself is always in the stepper beside it; the leaves are the picture of it.
const FOREST_COUNT_LEAVES = 8;

/* The setup, re-composed (F2.2, F4.1). `form` is the `.setup-grid`
   showStartSession() has just built; ids stay, because it finds every node by
   id after this.

   - Three columns from 1100px — who plays · the stump · the count and „Laub
     wirbeln" — the same seam Ocean's setup uses, so the aside dissolves in
     forest.css and its two blocks become grid items. No step bar (P6): the
     screen is one screen.
   - The stump is the pool's tile panel, drawn as the stump at EVERY width (the
     compact strip is hidden in forest.css): the kicker „Der Baumstumpf" over
     it, the covers lying on the rings, the count as the pill on its lip, then
     the filter row, the reset and the owners line under it.
   - The count card: „Wie viele Blätter fliegen?" with the app's own line „3 von
     9 Spielen werden gezogen" right beneath it (E3), the leaves and the
     stepper, then „Laub wirbeln" as its own big key.
   - `arriving` marks the count's leaves `data-opening` for motion ritual F10.1
     (#1476): they whirl in on an arrival, and only then — paintForestCount()
     takes the mark off at the first count change.
   DOM order is visual order at every width (WCAG 2.4.3). */
function composeForestSetup(form, arriving) {
  form.classList.add('setup-grid--forest');
  const aside = form.querySelector('.setup-grid__aside');

  // „Wer spielt mit?" with the tap hint and the app's filter note right under
  // it, as F4.1 sets them („Platz antippen = mitspielen · Die Anzahl der
  // Personen filtert die Spiele."). The note node moves; it is not copied.
  const field = form.querySelector('#seatsLabel').parentElement;
  const note = field.querySelector('.field__hint');
  if (note) {
    note.classList.add('forest-setup__hint');
    note.prepend(h(`<span class="forest-setup__tap">${esc(t('startSession.seatsTapHint'))}</span>`));
    field.querySelector('#seatsLabel').after(note);
  }

  const panel = aside.querySelector('.setup-panel');
  // The count reads as the pill on the stump's lip, below the covers.
  panel.appendChild(panel.querySelector('#poolTitle'));
  const stump = h(`<section class="forest-stump" aria-labelledby="potHeading">
      <h2 class="forest-kicker" id="potHeading">${esc(t('startSession.potHeadingForest'))}</h2>
    </section>`);
  stump.appendChild(panel);
  // The owners line is inserted after #poolReset by showStartSession(), so it
  // lands here too, as the stump's footnote.
  ['.setup-filterbar', '#poolReset'].forEach((sel) => stump.appendChild(aside.querySelector(sel)));
  aside.prepend(stump);

  const bar = aside.querySelector('.setup-bar');
  const count = bar.querySelector('.setup-bar__count');
  count.querySelector('label').textContent = t('startSession.countQuestionForest');
  // The app's line under the question, always (E3) — it is the same node the
  // shared updateHint() fills, only moved.
  count.querySelector('label').after(bar.querySelector('#barSummary'));
  count.querySelector('.stepper').before(h(`<span class="forest-leaves"${arriving ? ' data-opening' : ''} aria-hidden="true"></span>`));
  const go = bar.querySelector('#go');
  go.innerHTML = `<i class="ti ti-tornado" aria-hidden="true"></i> ${esc(t('startSession.drawForest'))}`;
}

/* The line under the count question: „3 von 9 Spielen werden gezogen · 3
   spielen mit" — the drawn share FIRST, because it is the question's answer
   (E3), then who plays. The same two strings Der Tisch's summary joins the
   other way round (tischDrawSummary, views-session-setup-tisch.js); an empty
   stump says so in the stump's own words. */
function forestDrawSummary(people, potSize, count) {
  const seated = tn(people, 'startSession.tableCountOne', 'startSession.tableCount');
  if (!potSize) return `0 ${tn(0, 'startSession.potLabelForestOne', 'startSession.potLabelForest')} · ${seated}`;
  const drawn = Math.max(1, Math.min(Number.isInteger(count) ? count : 1, potSize));
  return `${tn(drawn, 'startSession.drawOfOne', 'startSession.drawOf', { total: potSize })} · ${seated}`;
}

// The count's leaves: one per game that will be drawn, capped. Called from
// updateHint(), which every seat, filter and count change reaches under Forest.
// The row is rebuilt only when the number changes: rebuilt leaves are new nodes,
// so under the arrival's `data-opening` they would whirl again (F10.1, #1476) —
// and the first change after the arrival takes that mark off for good.
function paintForestCount(form) {
  const row = form.querySelector('.forest-leaves');
  if (!row) return;
  const n = parseInt(form.querySelector('#count').value, 10);
  const shown = Math.max(0, Math.min(Number.isInteger(n) ? n : 0, FOREST_COUNT_LEAVES));
  const painted = row.dataset.n;
  if (painted === String(n)) return;
  if (painted !== undefined) row.removeAttribute('data-opening');
  row.dataset.n = String(n);
  row.innerHTML = '<span class="forest-leaves__leaf"></span>'.repeat(shown);
  row.classList.toggle('is-more', Number.isInteger(n) && n > FOREST_COUNT_LEAVES);
}

/* The vote card's header, as F2.3 and F4.2 draw it: „Zurück" as a word beside
   its arrow — the corner key is a labelled 44px button, not a bare glyph (T7).
   The button's accessible name is already „Zurück", so the word only makes it
   visible. Used by the review step too, so the two headers match. */
function composeForestVoteCard(card) {
  card.classList.add('vote--forest');
  const back = card.querySelector('#backBtn');
  if (back) back.insertAdjacentHTML('beforeend', ` <span class="vote__undo-word">${esc(t('vote.back'))}</span>`);
}

/* F4.2's two side columns around the card. `people` is everyone voting in this
   session, `person` the one rating now, `votedIds` who is already in, `left`
   how many of this person's cards come after the current one.

   - RATERS (1440 only, hidden below in forest.css): who has rated, who is
     rating, who is still open — the app's words (`lobby.progress` as the
     title, `vote.rater*` per row).
   - HIDDEN: the cards still to come, face down on the dusk with a firefly
     each — the one place on this screen the fireflies carry meaning (E4). It
     is the right-hand column at 1440 and the dark strip under the faces on a
     phone (F2.3). The sheet's sentence („… bis alle gewertet haben") was not
     true of the app — a later card turns up when you reach it, not when
     everyone is done — so the line says what does happen. The last card has
     nothing below it, so the block stands down.

   Returned separately because they stand on either side of the card: the
   raters BEFORE it in the DOM, the hidden cards after it. Neither holds a
   control, so focus order is unaffected. */
function forestVoteSides(round, people, person, votedIds, left) {
  const voted = new Set(votedIds || []);
  const done = people.filter((p) => p.id !== person.id && voted.has(p.id)).length;
  const rows = people.map((p) => {
    const state = p.id === person.id ? 'now' : voted.has(p.id) ? 'done' : 'open';
    const key = { now: 'vote.raterNow', done: 'vote.raterDone', open: 'vote.raterOpen' }[state];
    return `<li class="forest-raters__row is-${state}">
         <span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${avatarFace(initials(p.name), { userId: p.userId })}</span>
         <span class="forest-raters__text"><span class="forest-raters__name">${esc(personLabel(p))}</span>
         <span class="forest-raters__state">${esc(t(key))}</span></span>
       </li>`;
  }).join('');
  const raters = h(`<aside class="forest-raters" aria-labelledby="forestRatersTitle">
       <h2 class="forest-kicker" id="forestRatersTitle">${esc(t('lobby.progress', { n: done, total: people.length }))}</h2>
       <ul class="forest-raters__list">${rows}</ul>
     </aside>`);
  const hidden = left > 0 ? h(`<aside class="forest-hidden">
       <span class="forest-hidden__cards" aria-hidden="true">${'<span class="forest-hidden__card"></span>'.repeat(Math.min(left, 3))}</span>
       <p class="forest-hidden__text">${esc(tn(left, 'vote.hiddenTextForestOne', 'vote.hiddenTextForest'))}</p>
     </aside>`) : null;
  return { raters, hidden };
}

/* The finale's kicker: the reveal verb „Die Karten leuchten auf." (F9.5,
   `vote.revealForest`) over the stage's own title, as the line that names what
   „Sieger enthüllen" is about to do. Decorative and never a control (the
   button keeps the app's „Sieger enthüllen"); the motion that would show it
   happening is F10.4, its own slice. */
function forestFinaleKicker() {
  return h(`<p class="forest-kicker stage__kicker">${esc(t('vote.revealForest'))}</p>`);
}

/* The result's kicker (F2.4, F4.3): „Auf der Lichtung · Sonntag, 14. September
   2026" — decorative, never on a control. It replaces the subtitle, whose date
   it repeats; the game count is in the Tafel's own title. */
function forestResultKicker(session) {
  const day = new Date(session.createdAt).toLocaleDateString(localeTag(locale),
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return h(`<p class="forest-kicker forest-result__kicker">${esc(t('result.kickerForest', { date: day }))}</p>`);
}

/* The fact line under the scene (F2.4, F4.3): „Session Nr. 23 · 9. Sieg für
   Jonas · Nordlichter zum 4. Mal" — built only from counts the app already
   keeps (session-tally.js), each part dropped when it cannot be backed:

   - the number only for a FINISHED session, the only one with a place in the
     round's count (the share card's own rule, sessionNumber);
   - the win only when exactly ONE member won — a shared win has no single
     „n-th", and a guest has no record to count in;
   - the play only when a game was played.

   Refilled from updateTitle(), which every phase change reaches, so a winner
   tap or „Zurücksetzen" moves it with the headline. Empty, it is hidden. */
function paintForestFacts(el, { round, session, finished, game, winnerIds, people }) {
  if (!el) return;
  const parts = [];
  if (finished) {
    parts.push(t('result.factSessionNo', { n: sessionNumber(round, session) }));
    const members = winnerIds.map((id) => people.find((p) => p.id === id)).filter((p) => p && !p.guest);
    if (members.length === 1 && winnerIds.length === 1) {
      parts.push(t('result.factWin', { n: sessionWinNumber(round, session, members[0].id), name: personLabel(members[0]) }));
    }
    if (game) parts.push(t('result.factPlay', { n: sessionPlayNumber(round, session, game.id), game: game.title }));
  }
  el.textContent = parts.join(' · ');
  el.hidden = !parts.length;
}

/* The result, in two columns from 1280px (F4.3, departing from it on purpose
   — #1568, as Ocean's did in #1430): the SIDE column holds the people („Wer
   dabei war") as a ring row, the head, the foot, then the scene — the tree that
   has grown for the played game — and the fact line; the TAFEL column holds the
   badge moment, the ranking and everything after it. F4.3 drew the people as a
   third column and the foot under the Tafel, which works for the few rows it
   drew and not for eight: the ranking ran ~2× the viewport in a 500px column
   while the two beside it stood empty, and „Noch eine Session" came only after
   the whole list. One column below, in the same order.

   The foot sits UNDER THE HEADLINE, not under the scene as Ocean's does
   (operator decision on #1568): the tree is ~520px, so after it the foot
   landed at y≈1150 on a 1440×900 screen, under the fold, and no shrinking of
   the picture brought it above. DOM order is the visual order at every width
   (WCAG 2.4.3, no `order:`): the people, the sentence, the foot, the scene,
   the facts, then the Tafel — which moves „Noch eine Session" ahead of the
   tree and the ranking in tab order, on a phone too, on purpose. Called once
   at the end of showResults(), after the foot is appended; renderTisch() and
   friends hold their nodes by reference, so moving them changes nothing they
   do. */
function composeForestResult(screen, head, peopleEl, facts) {
  screen.classList.add('result-screen--forest');
  const side = h('<div class="forest-result__side"></div>');
  const list = h('<div class="forest-result__tafel"></div>');
  const kids = [...screen.children];
  const tafelAt = kids.findIndex((el) => el.classList.contains('tafel'));
  const foot = kids.find((el) => el.classList.contains('result-foot'));
  if (peopleEl) {
    const people = h('<div class="forest-result__people"></div>');
    people.appendChild(peopleEl);
    side.appendChild(people);
  }
  kids.forEach((el, i) => {
    if (el === foot) return;
    // The badge moment („Neu verdient") opens the Tafel column, as under Ocean
    // (#1430): beside the scene its marks would push the tree down.
    if (el.classList.contains('badge-moment')) list.appendChild(el);
    else if (el === head || (tafelAt >= 0 && i < tafelAt)) side.appendChild(el);
    else list.appendChild(el);
  });
  if (foot) head.after(foot);
  if (facts) side.appendChild(facts);
  screen.replaceChildren(side, list);
}

/* The several tables' head (F4.4, F6.7): the kicker „Aufgeteilt auf 2 Tische"
   (`tables.split`) over the app's own headline „2 Tische, eine Session", and
   only where the results go under it — the people and table counts the other
   designs print there are the kicker's and each table card's to say. */
function composeForestTablesHead(head, tableCount) {
  head.classList.add('page-head--forest-tables');
  head.querySelector('.muted').textContent = t('tables.sameChronik');
  head.firstElementChild.prepend(h(`<p class="forest-kicker">${esc(tn(tableCount, 'tables.splitOne', 'tables.split'))}</p>`));
}

/* ---- #1469 — the shared vote and the pass-device blind (F4.5/F4.6 at 1440,
   F6.5/F6.6 at 390) ---- */

// The tree line along the blind's foot: one height per tree, from F4.6. A
// phone shows the first six (forest.css), as F6.6 draws them.
const FOREST_DUSK_TREES = 14;

/* The pass-device blind (F4.6, F6.6), operator decision E5: the dusk — a dark
   wood where only fireflies glow — the person's ring, „{name}, du bist dran!",
   „Die anderen schauen kurz weg." and one big key, the firefly with ink. It
   replaces Klassisch's card rather than repainting it, as Ocean's, Die
   Brücke's and Das Programmheft's do: that card is one full-bleed person
   colour, and this one is the night.

   It shows NOTHING of the person before — no value, no game, no progress bar
   (the Klassisch card's bar counts the run and would say how far the table
   is). The ring is the person's colour round a light core with the initials
   in ink (F1: colour only as a ring), aria-hidden because the name already
   says who. „Zurück" sits top-left on both sheets, so it leads the DOM
   (WCAG 2.4.3). The ids stay Klassisch's (#goBtn, #backBtn), so startVoting()
   wires this exactly as it wires the card. The fireflies are the screen's
   background (forest.css) and the trees are aria-hidden shapes: decoration. */
function forestBlind(round, person, canBack) {
  const trees = '<span class="forest-blind__tree"></span>'.repeat(FOREST_DUSK_TREES);
  return h(`<div class="handover handover--forest">
      ${canBack ? `<button class="handover__back" id="backBtn"><i class="ti ti-arrow-left" aria-hidden="true"></i> ${esc(t('vote.back'))}</button>` : ''}
      <span class="forest-blind__ring" style="--person:${personColor(round, person)}" aria-hidden="true">${avatarFace(initials(person.name), { userId: person.userId })}</span>
      <h1 class="handover__name">${esc(t('vote.turn', { name: personLabel(person) }))}</h1>
      <p class="handover__sub">${esc(t('vote.handoverSub'))}</p>
      <button class="handover__go" id="goBtn">${esc(t('vote.go'))}</button>
      <span class="forest-blind__trees" aria-hidden="true">${trees}</span>
    </div>`);
}

/* The shared vote (F4.5, F6.5), re-composed from the lobby showSessionLobby()
   has just built. Every control keeps its node and its listener; this only
   moves them and adds the clearing's dusk cards.

   - Under the head, the drawn games face down on the dusk with a firefly each
     — decoration, not progress (the issue), so aria-hidden and one per game
     up to three, as both sheets draw them.
   - The people card opens with the count („2 von 4 gewertet", `lobby.progress`)
     and the line naming who is missing (`lobby.waitingFor*`) — information,
     moved out of the panel. Each row keeps its state word („abgestimmt" /
     „offen") and gets its „Für {name}" key, as both sheets draw it; `hereBtns`
     maps person id → the hot-seat button showSessionLobby() built and wired.
     The rows are people[] in order, so row i is person i.
   - This device: the leading key, then „An diesem Gerät abstimmen" as the
     caption that points at those row keys.
   - The panel: its title, the QR control WHERE THE CODE WOULD BE, the link,
     the note. The code stays behind its button (operator ruling 2026-09-22,
     review U8): `POST …/vote-link/qr` mints the token, so an inline code would
     create a live capability for every session that reaches this screen.
   - „Abstimmung beenden" last, outside the panel — F6.5 ends on it, and at
     1440 forest.css puts it at the end of the this-device row (F4.5). It stays
     enabled while people are open (same ruling; showSessionLobby's comment).

   DOM order is head · cards · people · this device · share · closing at every
   width — F6.5's order. From 1280px the panel takes the right column (F4.5). */
function composeForestLobby(root, people, voted, hereBtns, gameCount) {
  root.classList.add('live-vote--forest');
  const head = root.querySelector('.page-head');
  const peopleEl = root.querySelector('.live-vote__people');
  const actions = root.querySelector('.live-vote__actions');
  const panel = root.querySelector('.live-vote__panel');

  head.after(h(`<div class="forest-lobby__cards" aria-hidden="true">${'<span class="forest-lobby__card"></span>'.repeat(Math.min(Math.max(gameCount, 1), 3))}</div>`));

  const n = people.filter((p) => voted.has(p.id)).length;
  const top = h(`<div class="forest-lobby__head">
      <h2 class="forest-lobby__count">${esc(t('lobby.progress', { n, total: people.length }))}</h2>
    </div>`);
  const waiting = panel.querySelector('.live-vote__waiting');
  if (waiting) top.appendChild(waiting);
  peopleEl.prepend(top);

  const rows = [...peopleEl.querySelectorAll('.live-person')];
  rows.forEach((row, i) => {
    const btn = hereBtns.get(people[i] && people[i].id);
    if (btn) row.appendChild(btn);
  });
  const hotseat = actions.querySelector('.live-vote__hotseat');
  if (hotseat) {
    const label = hotseat.querySelector('.field__label');
    label.className = 'forest-lobby__here';
    actions.appendChild(label);
    hotseat.remove();
  }

  const close = panel.querySelector('.live-vote__close');
  const qr = panel.querySelector('.live-vote__qr');
  if (qr) {
    qr.innerHTML = `<span class="forest-qr__mark"><i class="ti ti-qrcode" aria-hidden="true"></i></span>
      <span class="forest-qr__text"><span class="forest-qr__title">${esc(t('lobby.qr'))}</span>
      <span class="forest-qr__hint">${esc(t('lobby.qrHint'))}</span></span>`;
    const share = panel.querySelector('.live-vote__share');
    share.before(qr);
    const note = panel.querySelector('.live-vote__panel-note');
    panel.querySelector('.live-vote__share-row').after(note);
  }
  if (panel.querySelector('.live-vote__panel-head')) {
    panel.after(close);
  } else {
    // Every vote is in: nothing to share, and closing leads the actions.
    panel.remove();
    actions.after(close);
    root.classList.add('is-all-in');
  }
}
