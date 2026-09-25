/* Spielwirbel – Ocean's lobby and round hub (#1211; sheets O2.1, O2.5, O3.1,
   O3.2, O6.1).

   The markup Ocean composes differently from Klassisch, and nothing else: the
   hub's three columns, the shell the one action sits in, the crew's captions,
   the lobby's round tiles and the notice for a session still running. Every
   caller branches on designIs('ocean') and Klassisch never reaches this file,
   so its DOM is the default path, untouched.

   Split out rather than written into views-round-start.js / views-home.js for
   the seam test in .claude/rules/token-friendly-source-files.md: the Start tab
   is one flow at 630 lines and the lobby another at 550, and a design's
   composition is independently editable from both. Same shape as Der Tisch's
   result-tafel-composed.js and vote-card-composed.js.

   No module.exports: every function here builds DOM, so requiring it from Node
   would enter the coverage report almost entirely unreachable
   (.claude/rules/frontend-helper-modules-and-coverage.md). The specs reach it
   through the jsdom harness.

   Part of the frontend; all files share one global script scope. Loaded before
   views-round-start.js and after views-home.js — both call in at render time,
   never at load time (.claude/rules/frontend-script-load-order.md). */

'use strict';

/* The hub's frame: three real DOM columns plus a fourth cell for „Nicht im
   Regal". DOM order is the PHONE order (O2.1: crew, shell, the rest, the
   previews), so the phone needs no `order` at all; from 1280 up ocean.css puts
   the columns side by side and drops the off-shelf cell under the crew (O3.2),
   the one place visual order leaves DOM order — navigation after content,
   which is where a keyboard user meets it on the phone too. */
function oceanHubFrame() {
  const root = h(`<div class="ocean-hub">
       <div class="ocean-hub__crew"></div>
       <div class="ocean-hub__main"></div>
       <div class="ocean-hub__aside"></div>
     </div>`);
  return {
    root,
    crew: root.querySelector('.ocean-hub__crew'),
    main: root.querySelector('.ocean-hub__main'),
    aside: root.querySelector('.ocean-hub__aside'),
  };
}

/* The shell (O1.9 „Knopfkern", O2.1, O3.2): two sand halves drawn behind the
   one action, which becomes the bubble. The halves are aria-hidden spans — pure
   picture, no text, never a ground for anything but the bubble — and the
   button stays the same element with the same handler, name and disabled
   reason; only its frame changes. */
function oceanShell(btn) {
  const shell = h(`<div class="ocean-shell">
       <span class="ocean-shell__lid" aria-hidden="true"></span>
       <span class="ocean-shell__base" aria-hidden="true"></span>
     </div>`);
  btn.classList.add('ocean-shell__pearl');
  shell.appendChild(btn);
  return shell;
}

/* The crew (O2.1 row, O3.2 list): the round's name with its tide line — the
   marker as a row of dots — the two counts as one quiet line under it, and
   every seat captioned with its name and, where there is one, the win count.

   The counts are roundStandings() (views-pokale.js), never a second tally —
   the seat that shows „9 Siege" and the Pokale preview beside it must agree,
   the reason tischSeatHints gives. A zero is not printed: „0 Siege" on every
   newcomer is noise, not a record.

   The caption is REAL text inside the seat's link, so it completes the link's
   accessible name (the initials were all it had). The leader's crown is
   aria-hidden: the count beside it already says it. */
function oceanHeroCompose(round, hero) {
  const h1 = hero.querySelector('h1');
  h1.insertAdjacentElement('afterend', h('<span class="ocean-tide" aria-hidden="true"></span>'));
  const chips = hero.querySelector('.hero__chips');
  hero.querySelector('.ocean-tide').insertAdjacentElement('afterend', chips);

  const seatRow = hero.querySelector('.hero__members');
  const { wins, rankOf } = roundStandings(round);
  const caption = (el, name, n, lead) => {
    const text = h(`<span class="seat__text"><span class="seat__name">${esc(name)}</span></span>`);
    if (n > 0) {
      text.appendChild(h(`<span class="seat__wins">${lead ? '<i class="ti ti-crown" aria-hidden="true"></i>' : ''}${esc(tn(n, 'pokale.winsOne', 'pokale.wins'))}</span>`));
    }
    el.appendChild(text);
  };
  const seats = [...seatRow.querySelectorAll(':scope > a.avatar:not(.avatar--retired)')];
  activeMembers(round).forEach((m, i) => {
    if (seats[i]) caption(seats[i], m.name, wins[m.id] || 0, rankOf[m.id] === 1);
  });
  // aria-hidden: the „+" button's aria-label is its name, and would override a
  // caption inside it anyway — the same call tischSeatHints makes.
  const add = seatRow.querySelector(':scope > .avatar--add');
  if (add) add.appendChild(h(`<span class="seat__text" aria-hidden="true"><span class="seat__name">${esc(t('hub.seat.add'))}</span></span>`));
  const retired = (round.members || []).filter((m) => !memberIsActive(m));
  seatRow.querySelectorAll(':scope > a.avatar--retired').forEach((el, i) => {
    if (retired[i]) caption(el, retired[i].name, 0, false);
  });
}

/* A lobby tile (O3.1, O6.1): the round as a stretch of water — the members as
   rings floating on the tide line, which carries the round's MARKER, and a
   badge while a vote is running — over the round's name, its two counts and
   its last session.

   The same data and the same one link as Klassisch's `.round-card`; only the
   composition is Ocean's. The seat cap and the „+N" bubble are the lobby's own
   (LOBBY_AVATAR_CAP), passed in rather than re-derived. */
function oceanRoundCard(r, { stack, seatCount, lastLine, invite }) {
  const voting = (r.openSessions || []).some((s) => s.stage === 'voting');
  const stats = [
    tn(r.gameCount, 'home.chip.gamesOne', 'home.chip.games'),
    tn(r.playedCount, 'home.chip.sessionsOne', 'home.chip.sessions'),
  ].join(' · ');
  // The app's own last-played line already opens on „Zuletzt:", so it takes
  // no kicker of its own (O3.1 draws one; saying it twice would be noise).
  const last = r.lastPlayed ? `<span class="round-card__last-wrap">${lastLine}</span>` : '';
  return h(`<a class="round-card round-card--ocean" style="${markerStyle(r)}">
       <span class="round-card__water">
         <span class="round-card__tide" aria-hidden="true"></span>
         <span class="avatar-stack" style="--seat-n:${seatCount}">${stack}</span>
         ${voting ? `<span class="round-card__live">${esc(t('round.liveLabel'))}</span>` : ''}
       </span>
       <span class="round-card__body">
         <span class="round-card__name">${esc(r.name)}${r.shared ? ` <span class="round-card__shared"><i class="ti ti-users" aria-hidden="true"></i> ${esc(t('home.shared'))}</span>` : ''}</span>
         <span class="round-card__stats">${esc(stats)}</span>
         ${last}${invite}
       </span>
     </a>`);
}

/* A session still running, as Ocean's notice (O3.1 top right, O6.1 first on
   the page): a bubble with the play glyph, the kicker naming the state and the
   round, the title, and when it started with the next step.

   The same link as the Klassisch ticket — the session path the router resolves
   by state — and the same strings; a vote still open keeps its draw secret, so
   it names no game, exactly as the ticket does. */
function oceanResumeNotice({ round, session }) {
  const voting = session.stage === 'voting';
  // A running vote is about the ROUND (the draw is secret), a result waiting to
  // be entered is about its game — so the round moves into the meta line there.
  const title = voting ? round.name : session.gameTitle || t('round.inProgressDeciding');
  const meta = [voting ? '' : round.name, fmtDateTime(session.at),
    voting ? t('round.liveVote') : t('home.resume.result')].filter(Boolean).join(' · ');
  return h(`<a class="ocean-notice">
       <span class="ocean-notice__bubble" aria-hidden="true"><i class="ti ti-player-play"></i></span>
       <span class="ocean-notice__text">
         <span class="ocean-notice__kicker">${esc(t(voting ? 'round.liveLabel' : 'round.inProgressLabel'))}</span>
         <span class="ocean-notice__title">${esc(title)}</span>
         <span class="ocean-notice__meta">${esc(meta)} <i class="ti ti-arrow-right" aria-hidden="true"></i></span>
       </span>
     </a>`);
}
