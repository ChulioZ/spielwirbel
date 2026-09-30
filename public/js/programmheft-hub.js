/* Spielwirbel – Das Programmheft's lobby and round hub (#1372; sheets P2.1,
   P2.5, P3.1, P3.2, P6.1).

   The markup Das Programmheft composes differently from Klassisch, and nothing
   else: the hub as a printed front page (the round's name as the masthead
   line, the members row, the lead story, the black box with the one action,
   the side column and the bottom strip), the lobby's round tiles, and the
   „Extrablatt" for a session still running. Every caller branches on
   designIs('programmheft') and Klassisch never reaches this file, so its DOM is
   the default path, untouched — test/programmheft-hub-lobby.test.js pins that
   against a signature captured before this file existed.

   Split out rather than written into views-round-start.js / views-home.js for
   the seam test in .claude/rules/token-friendly-source-files.md, the same
   shape as ocean-hub.js beside it.

   No module.exports: every function here builds DOM, so requiring it from Node
   would enter the coverage report almost entirely unreachable
   (.claude/rules/frontend-helper-modules-and-coverage.md). The specs reach it
   through the jsdom harness.

   Part of the frontend; all files share one global script scope. Loaded before
   views-round-start.js and after views-home.js — both call in at render time,
   never at load time (.claude/rules/frontend-script-load-order.md). */

'use strict';

/* The hub's frame (P3.2 desktop, P2.1 phone). DOM order is the PHONE order and
   the reading order: the head, then the black box with the one action, the
   lead story, the suggestions, the side column, anything else the Start tab
   has to say, and the bottom strip. From 1280 up programmheft.css places the
   four middle cells in three columns — the lead in the first — so the one
   place visual order leaves DOM order is the lead sitting LEFT of the box it
   follows; see the CSS for why the box keeps its lead position in the DOM. */
function phHubFrame() {
  const root = h(`<div class="ph-hub">
       <div class="ph-hub__head"></div>
       <div class="ph-hub__grid">
         <div class="ph-hub__box"></div>
         <div class="ph-hub__lead"></div>
         <div class="ph-hub__suggest"></div>
         <div class="ph-hub__side"></div>
       </div>
       <div class="ph-hub__more"></div>
       <div class="ph-hub__strip"></div>
     </div>`);
  const q = (sel) => root.querySelector(sel);
  // The box's kicker is the programme's „Neue Session" — the setup screen's
  // own title, so the box names where its button leads.
  q('.ph-hub__box').appendChild(h(`<p class="ph-box__kicker">${esc(t('startSession.title'))}</p>`));
  return {
    root,
    head: q('.ph-hub__head'),
    box: q('.ph-hub__box'),
    lead: q('.ph-hub__lead'),
    suggest: q('.ph-hub__suggest'),
    side: q('.ph-hub__side'),
    more: q('.ph-hub__more'),
    strip: q('.ph-hub__strip'),
  };
}

/* The visible „Schnellstart" over the presets inside the box (P3.2). The chip
   row is already a group NAMED „Schnellstart" (hub.preset.label), so the
   printed line is aria-hidden: a screen reader meets the name once. */
function phPresetsLabel() {
  return h(`<p class="ph-box__label" aria-hidden="true">${esc(t('hub.preset.label'))}</p>`);
}

/* The head (P3.2, P2.1): the round's marker as a bar over the name, the two
   counts as the meta line, and the members row — „Mitglieder", every seat
   captioned with its name and win count, „Platz dazu", and the way to the
   round's Einstellungen at the row's end.

   The counts are roundStandings() (views-pokale.js), never a second tally, for
   the reason oceanHeroCompose gives. A zero is not printed. The captions are
   real text inside each seat's link, so they complete its accessible name. */
function phHeroCompose(round, hero) {
  hero.insertAdjacentElement('afterbegin', h('<span class="ph-marker" aria-hidden="true"></span>'));
  const seatRow = hero.querySelector('.hero__members');
  const members = h(`<div class="ph-members">
       <span class="ph-members__label">${esc(t('hub.members'))}</span>
     </div>`);
  seatRow.insertAdjacentElement('beforebegin', members);
  members.appendChild(seatRow);

  const { wins, rankOf } = roundStandings(round);
  /* A seat is a colour SQUARE with its caption beside it (P3.2), so the
     member's colour moves off the link onto the square: the link grows to hold
     the caption and must stay the one click target. */
  const caption = (el, name, n, lead) => {
    const sq = h('<span class="seat__sq"></span>');
    sq.style.background = el.style.background;
    el.style.background = '';
    while (el.firstChild) sq.appendChild(el.firstChild);
    el.appendChild(sq);
    const text = h(`<span class="seat__text"><span class="seat__name">${esc(name)}</span></span>`);
    if (n > 0) {
      text.appendChild(h(`<span class="seat__wins${lead ? ' seat__wins--lead' : ''}">${esc(tn(n, 'pokale.winsOne', 'pokale.wins'))}</span>`));
    }
    el.appendChild(text);
  };
  const seats = [...seatRow.querySelectorAll(':scope > a.avatar:not(.avatar--retired)')];
  activeMembers(round).forEach((m, i) => {
    if (seats[i]) caption(seats[i], m.name, wins[m.id] || 0, rankOf[m.id] === 1);
  });
  // aria-hidden: the „+" button's aria-label is its name already.
  const add = seatRow.querySelector(':scope > .avatar--add');
  if (add) {
    const sq = h('<span class="seat__sq"></span>');
    while (add.firstChild) sq.appendChild(add.firstChild);
    add.appendChild(sq);
    add.appendChild(h(`<span class="seat__text" aria-hidden="true"><span class="seat__name">${esc(t('hub.seat.add'))}</span></span>`));
  }
  const retired = (round.members || []).filter((m) => !memberIsActive(m));
  seatRow.querySelectorAll(':scope > a.avatar--retired').forEach((el, i) => {
    if (retired[i]) caption(el, retired[i].name, 0, false);
  });

  // The row's end: the round's Einstellungen, where P3.2 prints it. From 1280
  // up the section line carries the same link; below that the hub's own
  // „Einstellungen" button at the page's foot does, so programmheft.css shows
  // this one only where the members row runs the full width.
  const settings = h(`<a class="ph-members__settings"><i class="ti ti-settings" aria-hidden="true"></i><span>${esc(t('rail.settings'))}</span></a>`);
  navLink(settings, roundPath(round.id, 'settings'), () => showRoundSettings(round.id));
  members.appendChild(settings);
}

/* The lead story (P3.2 column 1, P2.1 „Zuletzt gespielt"): the last played
   game's cover (COVER_HERO: from 1280 up it spans the whole lead column), the
   kicker with its date, the headline in the results screen's
   own words — the winners printed in the vermilion — two facts, and
   „Ergebnis ansehen". ONE link, like the ticket it replaces: the whole story
   opens that result.

   The headline is result.titleWonOne/Many (or the ending's own title, or
   titlePlayed): P9 says the form is new and the wording the app's. The names
   are cut out of the finished sentence rather than re-assembled around it, so
   no locale's word order is assumed. */
function phLead({ game, winnerNames, ending, when, score, pot }) {
  const cover = game.image
    ? `<span class="ph-lead__cover" style="background-image:url('${coverUrl(game.image, COVER_HERO)}')"></span>`
    : `<span class="ph-lead__cover">${coverPlaceholder(game)}</span>`;
  const MARK = '\u0000';
  let headline;
  if (winnerNames.length) {
    const sentence = tn(winnerNames.length, 'result.titleWonOne', 'result.titleWonMany', { game: game.title, names: MARK });
    const [before, after = ''] = sentence.split(MARK);
    headline = `${esc(before)}<span class="ph-lead__winner">${esc(joinNames(winnerNames))}</span>${esc(after)}`;
  } else {
    const meta = ENDING_LABELS[ending];
    headline = esc(t(meta ? meta.title : 'result.titlePlayed', { game: game.title }));
  }
  const facts = [];
  if (score) facts.push([t('result.colScore'), score]);
  if (pot) facts.push([tn(pot, 'startSession.potLabelOne', 'startSession.potLabel'), String(pot)]);
  return h(`<a class="ph-lead">
       ${cover}
       <span class="ph-lead__text">
         <span class="ph-lead__kicker">${esc(t('round.lastPlayedLabel'))} · ${esc(when)}</span>
         <span class="ph-lead__headline">${headline}</span>
         <span class="ph-lead__facts">${facts.map(([k, v]) => `<span class="ph-lead__fact"><span class="ph-lead__fact-k">${esc(k)}</span><span class="ph-lead__fact-v">${esc(v)}</span></span>`).join('')}</span>
         <span class="ph-lead__open">${esc(t('hub.lead.open'))} <i class="ti ti-arrow-right" aria-hidden="true"></i></span>
       </span>
     </a>`);
}

/* A lobby tile (P3.1, P6.1): the round's marker as a bar across the top, the
   state kicker, the name in the display face, the members as colour squares
   with their names, the last session, and the two counts at the foot.

   The same data and the same one link as Klassisch's `.round-card`; only the
   composition is the Programmheft's. The seat cap and the „+N" are the lobby's
   own (LOBBY_AVATAR_CAP), passed in rather than re-derived. P3.1 also prints a
   cover of the last game: the round summary carries no image, so the tile has
   none (an open question on #1372, not a second read). */
function phRoundCard(r, { stack, seatCount, lastLine, invite }) {
  const voting = (r.openSessions || []).some((s) => s.stage === 'voting');
  const kicker = voting ? t('round.liveLabel') : r.shared ? t('home.shared') : '';
  return h(`<a class="round-card round-card--ph" style="${markerStyle(r)}">
       <span class="round-card__bar" aria-hidden="true"></span>
       <span class="round-card__body">
         ${kicker ? `<span class="round-card__kicker${voting ? ' round-card__kicker--live' : ''}">${esc(kicker)}</span>` : ''}
         <span class="round-card__name">${esc(r.name)}</span>
         <span class="avatar-stack" style="--seat-n:${seatCount}">${stack}</span>
         ${lastLine}${invite}
         <span class="round-card__foot">
           <span>${esc(tn(r.gameCount, 'home.chip.gamesOne', 'home.chip.games'))}</span>
           <span>${esc(tn(r.playedCount, 'home.chip.sessionsOne', 'home.chip.sessions'))}</span>
         </span>
       </span>
     </a>`);
}

/* A session still running, as the programme's „Extrablatt" (P3.1 above the
   headline, P6.1 first on the page): the black label, one line naming the
   round and the state, and the step as a vermilion button with ink print.

   The same link as the Klassisch ticket — the session path the router resolves
   by state — and the same strings; a vote still open keeps its draw secret, so
   it names no game, exactly as the ticket does. */
function phResumeNotice({ round, session }) {
  const voting = session.stage === 'voting';
  const state = voting ? t('round.liveLabel') : session.gameTitle || t('round.inProgressDeciding');
  const text = [round.name, state, fmtDateTime(session.at)].join(' · ');
  return h(`<a class="ph-extra">
       <span class="ph-extra__label">${esc(t('home.phExtra'))}</span>
       <span class="ph-extra__text">${esc(text)}</span>
       <span class="ph-extra__go">${esc(voting ? t('round.liveVote') : t('home.resume.result'))} <i class="ti ti-arrow-right" aria-hidden="true"></i></span>
     </a>`);
}

/* The lobby's line beside the wordmark (P3.1 „Kiosk · Donnerstag, 19. September
   2026"): the programme's dateline, in the reader's locale. */
function phLobbyKicker() {
  const date = new Date().toLocaleDateString(localeTag(getLocale()), { dateStyle: 'full' });
  return t('home.phKicker', { date });
}
