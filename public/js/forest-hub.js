/* Spielwirbel – Forest's lobby and round hub (#1466; sheets F2.1, F3.1, F3.2,
   F6.1).

   The markup Forest composes differently from Klassisch, and nothing else: the
   hub's three columns (the people, the tree stump with the one action, the
   previews), the round's head with its ribbon marker, the stump itself, the
   „Zuletzt gespielt" card, the lobby's clearings and the „Leuchtzeichen"
   notice for a session still running. Every caller branches on
   designIs('forest') and Klassisch never reaches this file, so its DOM is the
   default path, untouched — test/forest-hub-lobby.test.js pins that against
   the signature captured before #1372 (test/fixtures/klassisch-hub-lobby.json).

   The SHARED CHROME this slice styles — the Kopf (.topbar), the Telefonkopf,
   the Wegweiser (the rail from 1280, the dock strip from 860), the phone dock
   and the Fuß — is not built here: it is the markup every design shares, and
   forest.css's #1466 section restyles it, so later Forest slices inherit it on
   every screen without a line of JS.

   The frame is Ocean's shape (ocean-hub.js) on purpose: F3.2 draws the same
   three columns and puts „Nicht im Regal" under the people exactly where O3.2
   puts it, so views-round-start.js drives both through one `cols` object.

   No module.exports: every function here builds DOM, so requiring it from Node
   would enter the coverage report almost entirely unreachable
   (.claude/rules/frontend-helper-modules-and-coverage.md). The specs reach it
   through the jsdom harness.

   Part of the frontend; all files share one global script scope. Loaded before
   views-round-start.js and after views-home.js — both call in at render time,
   never at load time (.claude/rules/frontend-script-load-order.md). */

'use strict';

/* The hub's frame: three real DOM columns plus the cells views-round-start.js
   appends to the root („Nicht im Regal", the quiet actions). DOM order is the
   PHONE order (F2.1: the head, the stump, the stories, the previews, the lists),
   so the phone needs no `order`; from 860 forest.css sets the previews beside
   the rest, from 1280 the three columns of F3.2 with the lists under the
   people. */
function forestHubFrame() {
  const root = h(`<div class="forest-hub">
       <div class="forest-hub__crew"></div>
       <div class="forest-hub__main"></div>
       <div class="forest-hub__aside"></div>
     </div>`);
  return {
    root,
    crew: root.querySelector('.forest-hub__crew'),
    main: root.querySelector('.forest-hub__main'),
    aside: root.querySelector('.forest-hub__aside'),
  };
}

/* The stump (F1 „Baumstumpf", F2.1, F3.2): bark, rings and the one action as
   the green heart of it. The rings are the wrapper's own background — pure
   picture, no text — and the button stays the same element with the same
   handler, name and disabled reason; only its frame changes. Its label stays
   „Session wirbeln" (operator decision E1): „Laub wirbeln" is Neue Session's.

   Without a button (`null`, a round with no game — F7.3) the stump shows ONLY
   its rings: the locked „Session wirbeln" would be a second, dead action
   beside the empty table's „Spiel hinzufügen", and its reason („ab dem ersten
   Spiel") is the table's own sentence. Picture only, so aria-hidden. */
function forestStump(btn) {
  const stump = h(`<div class="forest-stump${btn ? '' : ' forest-stump--empty'}"></div>`);
  if (!btn) {
    stump.setAttribute('aria-hidden', 'true');
    return stump;
  }
  btn.classList.add('forest-stump__core');
  stump.appendChild(btn);
  return stump;
}

/* The visible „Schnellstart" in front of the chips (F3.2). The chip row is
   already a group NAMED „Schnellstart" (hub.preset.label), so the printed word
   is aria-hidden: a screen reader meets the name once. It sits INSIDE the row,
   so it wraps with the chips in a long language rather than leaving them. */
function forestPresetsLabel() {
  return h(`<span class="forest-quick__label" aria-hidden="true">${esc(t('hub.preset.label'))}</span>`);
}

/* The decorative line under the round's name (F2.1, F3.2): „Marker Tanne".
   Never on a control. The sheet also prints „Runde seit Oktober 2025", but a
   round stores no creation date and a month guessed from its oldest game or
   session would be wrong for any round older than its data — so that half is
   left out on purpose (operator decision on #1466, 2026-10-03). The marker's
   name is the one the VIEWER's design gives it, like its colour. */
function forestMarkerLine(round) {
  const marker = markerColors(round);
  return marker && marker.labelKey ? t('hub.forestMarker', { name: t(marker.labelKey) }) : '';
}

/* The head (F3.2 left column, F2.1 top): the ribbon marker beside the name,
   the line under it, the way to the round's Einstellungen, and the members
   under „Mitglieder · N" — every seat captioned with its name and, where there
   is one, the win count.

   The counts are roundStandings() (views-pokale.js), never a second tally, for
   the reason oceanHeroCompose gives. A zero is not printed. The captions are
   real text inside each seat's link, so they complete its accessible name.

   The Einstellungen link is the head's at EVERY width (a gear on a phone, the
   gear and the word from 860), so forest.css retires the hub's foot button
   that carries the same link elsewhere — one link, one place. */
function forestHeroCompose(round, hero) {
  const h1 = hero.querySelector('h1');
  const head = h(`<div class="forest-head">
       <span class="forest-ribbon" aria-hidden="true"></span>
       <div class="forest-head__text"></div>
     </div>`);
  hero.insertBefore(head, h1);
  const text = head.querySelector('.forest-head__text');
  text.appendChild(h1);
  const markerLine = forestMarkerLine(round);
  if (markerLine) text.appendChild(h(`<span class="forest-head__marker">${esc(markerLine)}</span>`));
  const settings = h(`<a class="forest-head__settings"><i class="ti ti-settings" aria-hidden="true"></i><span>${esc(t('rail.settings'))}</span></a>`);
  navLink(settings, roundPath(round.id, 'settings'), () => showRoundSettings(round.id));
  text.appendChild(settings);

  const seatRow = hero.querySelector('.hero__members');
  const members = h(`<div class="forest-members">
       <span class="forest-members__label">${esc(t('hub.members'))} · ${activeMembers(round).length}</span>
     </div>`);
  seatRow.insertAdjacentElement('beforebegin', members);
  members.appendChild(seatRow);

  const { wins } = roundStandings(round);
  /* A seat is a RING with its caption under or beside it (F2.1, F3.2), so the
     member's colour and the initials move off the link into `.seat__ring`: the
     link grows to hold the caption and stays the one click target. */
  const ring = (el) => {
    const r = h('<span class="seat__ring"></span>');
    r.style.background = el.style.background;
    el.style.background = '';
    while (el.firstChild) r.appendChild(el.firstChild);
    el.appendChild(r);
  };
  const caption = (el, name, n) => {
    ring(el);
    const cap = h(`<span class="seat__text"><span class="seat__name">${esc(name)}</span></span>`);
    if (n > 0) cap.appendChild(h(`<span class="seat__wins">${esc(tn(n, 'pokale.winsOne', 'pokale.wins'))}</span>`));
    el.appendChild(cap);
  };
  const seats = [...seatRow.querySelectorAll(':scope > a.avatar:not(.avatar--retired)')];
  activeMembers(round).forEach((m, i) => {
    if (seats[i]) caption(seats[i], m.name, wins[m.id] || 0);
  });
  // aria-hidden: the „+" button's aria-label is its name already.
  const add = seatRow.querySelector(':scope > .avatar--add');
  if (add) ring(add);
  if (add) add.appendChild(h(`<span class="seat__text" aria-hidden="true"><span class="seat__name">${esc(t('hub.seat.add'))}</span></span>`));
  const retired = (round.members || []).filter((m) => !memberIsActive(m));
  seatRow.querySelectorAll(':scope > a.avatar--retired').forEach((el, i) => {
    if (retired[i]) caption(el, retired[i].name, 0);
  });
}

/* „Zuletzt gespielt" (F3.2 centre, F2.1): the kicker with its date, the cover,
   the game in the display face, who won — or how it ended — the score, and
   „Ergebnis ansehen". ONE link, like the ticket it replaces: the whole card
   opens that result. Every string is the app's own (hub.lead.open is the
   Programmheft's lead story's).

   F3.2's fact line („4 dabei · Jonas' 3. Sieg in Folge") is left out: it is new
   copy over a streak the app derives nowhere for a single session. */
function forestLead(round, session) {
  const game = round.games.find((g) => g.id === session.chosenGameId);
  const people = sessionPeople(round, session);
  const winners = (session.winnerIds || []).map((wid) => personLabel(people.find((p) => p.id === wid))).filter(Boolean);
  const ending = ENDING_LABELS[sessionEnding(session)];
  const result = winners.length
    ? `<i class="ti ti-crown" aria-hidden="true"></i>${esc(tn(winners.length, 'detail.playWonOne', 'detail.playWonMany', { names: joinNames(winners) }))}`
    : esc(ending ? t(ending.key) : t('sessions.played'));
  const sst = gameStatsForSession(round, session, game.id);
  const pill = sst.avg !== null
    ? `<span class="score-pill" style="--sc:${scoreColor(sst.score)}" data-stop="${scoreStop(sst.score)}">${fmtAvg(displayScore(sst.score))}</span>`
    : '';
  const cover = game.image
    ? `<span class="forest-last__cover" style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"></span>`
    : `<span class="forest-last__cover">${coverPlaceholder(game)}</span>`;
  const when = new Date(session.createdAt).toLocaleDateString(localeTag(getLocale()), { day: 'numeric', month: 'short' });
  const card = h(`<a class="forest-last">
       <span class="forest-last__kicker">${esc(t('round.lastPlayedLabel'))} · ${esc(when)}</span>
       <span class="forest-last__row">
         ${cover}
         <span class="forest-last__text">
           <span class="forest-last__title">${esc(game.title)}</span>
           <span class="forest-last__result${winners.length ? ' forest-last__result--won' : ''}">${result}</span>
           ${pill}
         </span>
       </span>
       <span class="forest-last__open">${esc(t('hub.lead.open'))} <i class="ti ti-arrow-right" aria-hidden="true"></i></span>
     </a>`);
  navLink(card, resultsPath(round.id, session.id), () => showResults(round, session));
  return card;
}

/* A lobby tile (F3.1, F6.1): the round as a clearing — the marker as a ribbon
   hanging from the sign's top edge, the members as rings in the light, a band
   of trees along the clearing's foot and a badge while a vote is running —
   over the round's name, its two counts and its last session.

   The same data and the same one link as Klassisch's `.round-card`; only the
   composition is Forest's. The ribbon carries no text (rule T2) — the name sits
   on the card below it. The seat cap and the „+N" are the lobby's own
   (LOBBY_AVATAR_CAP), passed in rather than re-derived. */
function forestRoundCard(r, { stack, stackAttrs, seatCount, lastLine, invite }) {
  const voting = (r.openSessions || []).some((s) => s.stage === 'voting');
  const stats = [
    tn(r.gameCount, 'home.chip.gamesOne', 'home.chip.games'),
    tn(r.playedCount, 'home.chip.sessionsOne', 'home.chip.sessions'),
  ].join(' · ');
  // The app's own last-played line already opens on „Zuletzt:", so it takes
  // no kicker of its own (F3.1 draws one; saying it twice would be noise).
  const last = lastLine || invite ? `<span class="round-card__last-wrap">${lastLine}${invite}</span>` : '';
  return h(`<a class="round-card round-card--forest" style="${markerStyle(r)}">
       <span class="round-card__clearing">
         <span class="round-card__ribbon" aria-hidden="true"></span>
         ${voting ? `<span class="round-card__live">${esc(t('round.liveLabel'))}</span>` : ''}
         <span class="avatar-stack" style="--seat-n:${seatCount}" ${stackAttrs}>${stack}</span>
         <span class="round-card__trees" aria-hidden="true"></span>
       </span>
       <span class="round-card__body">
         <span class="round-card__name">${esc(r.name)}${r.shared ? ` <span class="round-card__shared"><i class="ti ti-users" aria-hidden="true"></i> ${esc(t('home.shared'))}</span>` : ''}</span>
         <span class="round-card__stats">${esc(stats)}</span>
         ${last}
       </span>
     </a>`);
}

/* A session still running, as Forest's notice (F3.1 top right, F6.1 under the
   greeting): the play glyph on a dusk disc, „Leuchtzeichen" over the state and
   the round, when it started, and the next step.

   The same link as the Klassisch ticket — the session path the router resolves
   by state — and the same strings; a vote still open keeps its draw secret, so
   it names no game, exactly as the ticket does. */
function forestResumeNotice({ round, session }) {
  const voting = session.stage === 'voting';
  const title = voting
    ? `${t('round.liveLabel')} · ${round.name}`
    : session.gameTitle || t('round.inProgressDeciding');
  const meta = [voting ? '' : round.name, fmtDateTime(session.at)].filter(Boolean).join(' · ');
  return h(`<a class="forest-notice">
       <span class="forest-notice__disc" aria-hidden="true"><i class="ti ti-player-play"></i></span>
       <span class="forest-notice__text">
         <span class="forest-notice__kicker">${esc(t('home.forestSignal'))}</span>
         <span class="forest-notice__title">${esc(title)}</span>
         <span class="forest-notice__meta">${esc(meta)}</span>
         <span class="forest-notice__go">${esc(voting ? t('round.liveVote') : t('home.resume.result'))} <i class="ti ti-arrow-right" aria-hidden="true"></i></span>
       </span>
     </a>`);
}

/* ===== #1471 — the empty, young and long-language states (F7.1–F7.6) =====

   F7's rule: „An empty clearing is light and calm" — one title, one line in
   soft ink and, where there is something to do, exactly one action. None of
   these blocks invents a figure or a state: each says only what the app's own
   thresholds already decide (roundIsYoung, YOUNG_ROUND_SERIES_FROM, the Pokale
   and Chronik empty screens), in their own strings — the Programmheft's P7
   blocks (#1377) are the precedent, in Forest's material. */

/* What stands under the stump on a young round (F7.3–F7.5), or null:
   - no game (F7.3): the empty table — „Der Stumpf ist noch leer" and the two
     ways to fill it, „Spiel hinzufügen" the primary. The stump then shows only
     its rings (forestStump(null)), so this table's primary is the page's one.
   - games, nothing played (F7.4): what is waiting, in the display face, and why
     there are no scores yet.
   - played, but under YOUNG_ROUND_SERIES_FROM (F7.5): when series come. */
function forestYoung(round, activeGames) {
  if (!activeGames.length) return hubEmptyTable(round, { titleKey: 'hub.young.emptyTitleForest' });
  if (roundIsYoung(round)) {
    return h(`<div class="forest-young">
         <p class="forest-young__title">${esc(tn(activeGames.length, 'hub.young.readyOne', 'hub.young.ready'))}</p>
         <p class="forest-young__text">${esc(t('hub.young.readyText'))}</p>
       </div>`);
  }
  const played = youngRoundPlayed(round, hubDeps());
  if (played >= YOUNG_ROUND_SERIES_FROM) return null;
  return h(`<div class="forest-young">
       <p class="forest-young__text">${esc(tn(YOUNG_ROUND_SERIES_FROM, 'hub.young.seriesOne', 'hub.young.series'))}</p>
     </div>`);
}

/* A LOCKED block in the right column (F7.3, F7.4): the preview's title, the
   state in ink and the sentence in soft ink. With `tab` the title is the link
   to that sub-page — a preview is navigation, so an empty one still leads
   there (hub-previews.js's header). Without it the block is a plain notice. */
function forestLocked(round, { title, state = '', text, tab = null }) {
  const block = h(`<section class="hub-card forest-locked">
       <h2 class="forest-locked__title">${tab ? '<a></a>' : esc(title)}</h2>
       ${state ? `<p class="forest-locked__state">${esc(state)}</p>` : ''}
       <p class="forest-locked__text">${esc(text)}</p>
     </section>`);
  if (tab) {
    const link = block.querySelector('.forest-locked__title a');
    link.textContent = title;
    navLink(link, roundPath(round.id, tab), () => showRound(round.id, tab));
  }
  return block;
}

/* The right column's previews on a young round (F7.3, F7.4): each preview that
   has nothing to show yet stands as a locked block in its place instead of
   vanishing. The Regal only while the shelf is empty; Pokale and Chronik only
   before the first played session, in the words their own empty screens use. */
function forestAsidePreviews(round, activeGames, { regal, pokale, chronik }) {
  const played = round.sessions.some((s) => s.finished);
  return [
    regal || (!activeGames.length ? forestLocked(round, {
      title: t('hub.tab.regal'), state: tn(0, 'home.chip.gamesOne', 'home.chip.games'), text: t('hub.young.lock'), tab: 'regal',
    }) : null),
    pokale || (!played ? forestLocked(round, {
      title: t('hub.tab.pokale'), state: t('pokale.emptyTitle'), text: t('pokale.empty'), tab: 'pokale',
    }) : null),
    chronik || (!played ? forestLocked(round, {
      title: t('hub.tab.chronik'), state: t('chronik.emptyTitle'), text: t('chronik.empty'), tab: 'chronik',
    }) : null),
  ].filter(Boolean);
}

/* The Rundenpuls of a round with games and no played session (F7.4), which
   hubPulseCard leaves out: a locked block saying when the numbers come. The
   threshold is the pulse's own floor — the first played session in every
   design since #1586, so the sheet's „ab der ersten Session" holds here too;
   only the bars wait for YOUNG_ROUND_SERIES_FROM. */
function forestLockedPulse(round, activeGames) {
  if (!activeGames.length || !roundIsYoung(round)) return null;
  return forestLocked(round, {
    title: t('hub.pulse.title'),
    text: tn(1, 'hub.young.pulseOne', 'hub.young.pulse'),
  });
}

/* The empty lobby (F7.1): a row of trees over the greeting, the app's first-run
   sentence in place of „Welche Runde spielt heute?", and ONE action — the same
   link as Klassisch's `.lobby-cta`, as the design's primary button. `head` is
   the lobby head views-home.js already built (its h1 is the page's).

   The sheet's „Beispielrunde ansehen" is left out for the reason tischLobbyAlt
   gives (operator, #1269): only a signed-in account sees this lobby, and with
   one login slot the demo would sign it out of itself. */
function forestFirstRun(head, onboard) {
  const first = h(`<section class="forest-first">
       <span class="forest-first__trees" aria-hidden="true"></span>
     </section>`);
  first.appendChild(head);
  head.querySelector('.lobby-head__sub').textContent = t(onboard ? 'home.onboard.sub' : 'home.empty.sub');
  const cta = h(`<a class="btn btn--primary forest-first__cta"><i class="ti ti-plus" aria-hidden="true"></i> ${esc(t('home.newRound'))}</a>`);
  navLink(cta, '/round/new', () => showNewRound());
  first.appendChild(cta);
  return first;
}
