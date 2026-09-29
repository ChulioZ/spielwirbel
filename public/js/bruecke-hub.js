/* Spielwirbel – Die Brücke's lobby and round hub (#1238; sheets B2.1, B2.2,
   B3.1).

   The markup Die Brücke composes differently from Klassisch, and nothing else:
   the hub's frame of named slots, the Missionskontrolle panel the one action
   sits in, the members' captions, the two decorative lines and the lobby's
   „Eingehendes Signal" notice. Every caller branches on designIs('bruecke'), so
   Klassisch never reaches this file and its DOM stays the default path.

   Split out for the seam test in .claude/rules/token-friendly-source-files.md,
   exactly as ocean-hub.js was: the Start tab and the lobby are each one flow,
   and a design's composition is independently editable from both.

   No module.exports: everything here builds DOM, so the specs reach it through
   the jsdom harness (.claude/rules/frontend-helper-modules-and-coverage.md).

   Part of the frontend; all files share one global script scope. Loaded before
   views-round-start.js and after views-home.js — both call in at render time,
   never at load time (.claude/rules/frontend-script-load-order.md). */

'use strict';

/* The hub's frame: ONE grid of named slots in the PHONE order (B2.2) —
   members, Missionskontrolle, running sessions, Zuletzt gespielt, Wie wär's
   mit, Rundenpuls, Kümmerliste, the previews, the rest of the cards, Nicht im
   Regal, the quiet actions. DOM order is the phone's reading and tab order, so
   the phone needs no `order` at all.

   Why slots in one grid rather than three column wrappers (Ocean's shape): the
   desktop columns (B3.1) cut ACROSS the phone order — the Rundenpuls and the
   Kümmerliste stand under the members at 1440 but after „Wie wär's mit" at
   390 — so column wrappers would force either a phone order that leaves the
   sheet or a tab order that leaves the picture. bruecke.css places each slot
   in a grid area from 1280 up instead. An empty slot is `display: none`. */
const BRUECKE_HUB_SLOTS = [
  'crew', 'mission', 'feed', 'last', 'suggest', 'pulse', 'care',
  'previews', 'more', 'offshelf', 'actions',
];

function brueckeHubFrame() {
  const root = h('<div class="bruecke-hub"></div>');
  const slots = { root };
  BRUECKE_HUB_SLOTS.forEach((name) => {
    slots[name] = root.appendChild(h(`<div class="bruecke-hub__${name}"></div>`));
  });
  return slots;
}

/* Missionskontrolle (B2.2, B3.1): the panel the one action sits in. Its title
   is the panel's inscription — never navigation, never a label on a control
   (B9 „Zierüberschrift") — and „Bereit" beside it says the button can fire; a
   round without games gets no state, its button already says why it is locked.

   The ignition is the same button with the same handler, name and disabled
   reason; the two rings and the cross-hair are aria-hidden spans, pure picture.
   The presets follow it inside the panel, because they modify it. */
function brueckeMission(btn, ready) {
  const panel = h(`<section class="bruecke-mission">
       <div class="bruecke-mission__head">
         <h2 class="bruecke-mission__title">${esc(t('hub.bruecke.control'))}</h2>
         ${ready ? `<span class="bruecke-mission__state">${esc(t('hub.bruecke.ready'))}</span>` : ''}
       </div>
       <div class="bruecke-mission__ignition">
         <span class="bruecke-mission__ring" aria-hidden="true"></span>
         <span class="bruecke-mission__ring bruecke-mission__ring--inner" aria-hidden="true"></span>
       </div>
     </section>`);
  btn.classList.add('bruecke-mission__fire');
  panel.querySelector('.bruecke-mission__ignition').appendChild(btn);
  return panel;
}

/* The members and the decorative line (B2.2 row, B3.1 list).

   „Mission {n} · Crew {m}" leads the counts line under the name — decorative
   (B9 „Zierzeilen": never on a button, a label or the dock, never before a
   name), so it is aria-hidden; the counts beside it are the app's own. {n} is
   the NEXT session's number, as the sheet reads it (23 played → Mission 24).

   Each seat is captioned with its name and, where there is one, the win count
   as the app words it („5 Siege") — plus the bare number the phone prints under
   the square, aria-hidden since the words already say it. The counts are
   roundStandings() (views-pokale.js), never a second tally, for the reason
   tischSeatHints gives. A zero is not printed. The caption is REAL text inside
   the seat's link, so it completes the link's accessible name. */
function brueckeHeroCompose(round, hero, playedCount) {
  const members = activeMembers(round);
  hero.querySelector('.hero__chips').prepend(h(`<span class="bruecke-line" aria-hidden="true">${esc(t('hub.bruecke.mission', { n: playedCount + 1, m: members.length }))}</span>`));

  const seatRow = hero.querySelector('.hero__members');
  seatRow.prepend(h(`<h2 class="bruecke-crew__title">${esc(t('hub.bruecke.crew', { n: members.length }))}</h2>`));
  const { wins } = roundStandings(round);
  /* The seat's fill moves from the link onto a `.seat__face` square around the
     initials, so the link itself can be a row (1440) or a column (390) with the
     caption beside or under that square, and the person colour stays a FILL
     under night ink (bruecke.css rule 1) — never the colour of the name. */
  const caption = (el, name, n) => {
    const face = h('<span class="seat__face"></span>');
    face.style.background = el.style.background;
    el.style.background = '';
    face.append(...el.childNodes);
    el.appendChild(face);
    const text = h(`<span class="seat__text"><span class="seat__name">${esc(name)}</span></span>`);
    if (n > 0) {
      text.appendChild(h(`<span class="seat__wins">${esc(tn(n, 'pokale.winsOne', 'pokale.wins'))}</span>`));
      el.appendChild(h(`<span class="seat__n" aria-hidden="true">${n}</span>`));
    }
    el.appendChild(text);
  };
  const seats = [...seatRow.querySelectorAll(':scope > a.avatar:not(.avatar--retired)')];
  members.forEach((m, i) => { if (seats[i]) caption(seats[i], m.name, wins[m.id] || 0); });
  // aria-hidden: the „+" button's aria-label is its name — the same call
  // tischSeatHints makes. „Platz dazu" wraps to two lines on the phone rather
  // than being shortened (bruecke.css), never „Platz".
  const add = seatRow.querySelector(':scope > .avatar--add');
  if (add) add.appendChild(h(`<span class="seat__text" aria-hidden="true"><span class="seat__name">${esc(t('hub.seat.add'))}</span></span>`));
  const retired = (round.members || []).filter((m) => !memberIsActive(m));
  seatRow.querySelectorAll(':scope > a.avatar--retired').forEach((el, i) => {
    if (retired[i]) caption(el, retired[i].name, 0);
  });
}

/* The top bar's decorative status line (B3.1 „T+ 00:14:52 · Orbit stabil").
   Decoration only (B9 „Zierzeilen"), so it rides on the bar as a data
   attribute that bruecke.css prints through `content: attr() / ""` — out of
   the accessibility tree, and shown only while the lobby or the hub is on
   screen and only from 1280 (the phone bar has no room for it). Written on
   every lobby/hub render so a language switch re-words it. */
function brueckeStatus() {
  const bar = document.querySelector('.topbar');
  if (bar) bar.setAttribute('data-status', t('bruecke.status'));
}

/* A session still running, as Die Brücke's notice card (B2.1): the kicker
   „Eingehendes Signal" over the app's own title — „Abstimmung läuft · {round}"
   while it is voted on, the game (or „wird noch entschieden") once it waits for
   a result — then when it started, and the next step as the card's action line.
   The same link and the same strings as the Klassisch ticket; a vote still open
   keeps its draw secret, so it names no game, exactly as the ticket does. */
function brueckeResumeNotice({ round, session }) {
  const voting = session.stage === 'voting';
  const title = voting
    ? `${t('round.liveLabel')} · ${round.name}`
    : session.gameTitle || t('round.inProgressDeciding');
  const meta = [voting ? '' : round.name, fmtDateTime(session.at)].filter(Boolean).join(' · ');
  return h(`<a class="bruecke-notice">
       <span class="bruecke-notice__kicker">${esc(t('home.brueckeSignal'))}</span>
       <span class="bruecke-notice__title">${esc(title)}</span>
       <span class="bruecke-notice__meta">${esc(meta)}</span>
       <span class="bruecke-notice__go">${esc(voting ? t('round.liveVote') : t('home.resume.result'))} <i class="ti ti-arrow-right" aria-hidden="true"></i></span>
     </a>`);
}
