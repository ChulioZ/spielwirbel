/* Spielwirbel – the voting lobby (#209, made universal in #655). Part of the
   frontend; all files share one global script scope.

   EVERY session lands here after the draw. Each person's votes are written the
   moment they submit them — from this device, from their own phone, or through a
   shared vote link (#652) — instead of one hot-seat wizard holding the whole
   table's ratings in a closure until the end. The screen shows who has voted and
   who has not, lets whoever is holding the device vote for anyone still open,
   offers the shareable link, and closes the voting when the group is ready.

   #655 removed the `deviceVoting` toggle that used to decide between this screen
   and that wizard. Two things came out of that beyond the deleted branch: an
   interrupted evening now costs one person's card rather than the whole table's,
   and the group is no longer asked to predict before the draw who will want to
   vote from their own phone.

   It is ONE screen for everybody. There is no host view and no guest view: the
   device the session was drawn on has no special standing (any invitee can draw
   a session — lib/routes/sessions.js has no owner guard), so the lobby simply
   offers whatever actions make sense for whoever is looking at it. That is also
   what keeps a flat battery on one phone from stranding the evening.

   It lives at the session's own URL, so it survives a cold load: unlike the
   wizard's transient step paths, everything on this screen is server state. */

'use strict';

// Slow on purpose. Votes trickle in over minutes while people are talking, so
// this is "notice within a few seconds", not a live cursor — and every tick is a
// full round read for every device in the room.
const LOBBY_POLL_MS = 5000;

let lobbyPoll = null;

function stopLobbyPoll() {
  if (lobbyPoll) clearInterval(lobbyPoll);
  lobbyPoll = null;
}

// The seat the person at THIS device sits in, if any. Attribution, not access:
// `member.userId` is self-claimed (.claude/rules/member-seat-self-claim.md), and
// the server lets anyone with round access write any joined person's column. So
// this only decides which button we offer first, never what is permitted.
function mySeatIn(round, session) {
  const me = currentUserId();
  if (!me) return null;
  return round.members.find((m) => m.userId === me && (session.memberIds || []).includes(m.id)) || null;
}

// The games this session drew, resolved off the round so the screen works on a
// cold load (someone opening the hub ticket on their own phone) exactly as it
// does straight after the draw. A game deleted since the draw simply drops out.
function sessionGames(round, session) {
  return (session.gameIds || []).map((gid) => round.games.find((g) => g.id === gid)).filter(Boolean);
}

/* The session activity log (#209), rendered identically in the lobby and at the
   foot of the results screen — one builder, so a session reads the same during
   and after it.

   Shown for EVERY session, not only per-device ones. On a shared-device evening
   it says little ("Julian started the session, Julian voted for Anna, …") and
   that is the point: the reader should not have to know which kind of session
   they are looking at to know that the list is complete.

   Names are resolved from the round's members plus this session's guests, and
   the ACTOR may be a member who is not playing at all (someone can draw a
   session they sit out), which is why the lookup is not simply sessionPeople().
   Anything since deleted falls back to a neutral placeholder rather than
   disappearing — a missing line would silently shorten the history. */
function renderSessionLog(round, session, { collapsed } = {}) {
  const byId = new Map((round.members || []).map((m) => [m.id, m.name]));
  (session.guests || []).forEach((g) => byId.set(g.id, personLabel({ name: g.name, guest: true })));
  const lines = sessionLogLines(session, {
    name: (id) => byId.get(id) || null,
    title: (gid) => (round.games.find((g) => g.id === gid) || {}).title || null,
    t,
  });
  if (!lines.length) return null;

  /* reversed: the rows run newest-first, so the implicit numbering counts down.
     No marker is rendered (list-style: none), but the semantics are free and a
     screen reader announces the positions correctly. */
  const listHtml = `<ol class="session-log__list" reversed></ol>`;
  /* Collapsed form (#1055), asked for by the RESULT screen only. Measured on a
     finished six-game session it cost 355px of a 2905px page on every visit,
     for a list most sessions never open — while in the LOBBY the same list is
     the live record of what is happening right now, so that caller keeps the
     open section.

     `<details>` rather than a button plus a hidden div: the disclosure
     semantics, the keyboard control and the expanded/collapsed state are all
     native, and Ctrl-F in the browser opens it. The summary carries `title` and
     not `aria-label` — the visible text is the accessible name, so a label
     attribute would replace it and break SC 2.5.3 (the same reasoning as
     „Session abbrechen" in showResults). */
  const wrap = collapsed
    ? h(`<details class="session-log session-log--fold">
        <summary class="session-log__summary" title="${esc(t('log.open'))}">
          <i class="ti ti-chevron-right session-log__chevron" aria-hidden="true"></i>
          <span class="session-log__summary-title">${esc(t('log.title'))}</span>
          <span class="session-log__summary-meta">${esc(tn(lines.length, 'log.summaryOne', 'log.summary', {
            n: lines.length,
            when: fmtDateTime(lines[0].at),
          }))}</span>
        </summary>
        ${listHtml}
      </details>`)
    : h(`<section class="session-log">
        <h2 class="session-log__title">${esc(t('log.title'))}</h2>
        ${listHtml}
      </section>`);
  const list = wrap.querySelector('.session-log__list');
  lines.forEach((line) => {
    list.appendChild(h(`<li class="session-log__row">
        <span class="session-log__when">${esc(fmtDateTime(line.at))}</span>
        <span class="session-log__what">${esc(line.text)}</span>
      </li>`));
  });
  return wrap;
}

/* `handedOn` is true when we have just come back from someone voting ON THIS
   DEVICE. It is what turns the lobby from a list you organise into a flow that
   keeps driving: the next person still open is offered as the primary action
   („Weiter zu Ben") instead of the screen simply returning to a plain roster.

   That matters because #655 removed the guided multi-person wizard. Without it a
   five-person table would pay one tap per voter plus the effort of noticing who
   is left; with it the tap count is back to roughly one per person, and the one
   real cost of unifying the flows is paid down. It degrades on its own: with
   nobody left there is no next person, and „Abstimmung beenden" is already the
   leading action in that state.

   `dealt` is true only on the one arrival straight from „Loswirbeln" (#1200,
   T10.2): Der Tisch deals each person's boxes out as the drawn games laid on
   the table. Deliberately NOT carried into `currentView` or the poll's
   re-render — a language switch or someone else's vote is not a draw. */
function showSessionLobby(round, session, handedOn, dealt) {
  currentView = () => showSessionLobby(round, session, handedOn);
  // Arriving here always ends any wizard: either we just came out of one, or we
  // never had one. Leaving it registered would let it swallow the next Back.
  endFlow();
  stopLobbyPoll();
  // Same reason as showResults: this is the other screen a cold-loaded session
  // URL resolves to, and a shared lobby link is exactly how a second device
  // arrives (#209) — on the Standard design, until this line.
  applyBackground(round.background, round);
  syncUrl(resultsPath(round.id, session.id));
  setContext(round.name);
  // Deliberately the same on every state, like the wizard's: a tab title must
  // not leak who is still missing to someone glancing at a phone on the table.
  setDocTitle(t('lobby.crumb'), round.name);

  const games = sessionGames(round, session);
  const people = sessionPeople(round, session);
  const voted = new Set(session.votedIds || []);
  const pending = people.filter((p) => !voted.has(p.id));
  const mine = mySeatIn(round, session);
  const iVoted = !!mine && voted.has(mine.id);

  app.innerHTML = '';
  const root = h(`<div class="live-vote">
      <div class="page-head">
        <h1>${esc(t('lobby.title'))}</h1>
        <p class="muted">${esc(tn(games.length, 'lobby.subOne', 'lobby.sub'))}</p>
      </div>
      <div class="live-vote__people" id="lvPeople"></div>
      <div class="live-vote__actions" id="lvActions"></div>
    </div>`);
  if (dealt && designIs('tisch')) root.setAttribute('data-dealt', '');

  // One chip per participant: name, their colour, and whether their vote is in.
  // WHO has voted, never WHAT they voted — the values are redacted server-side
  // while the session is open (lib/session-votes.js) and this screen is exactly
  // why: it has to show progress without revealing a single rating.
  //
  /* The two extra children are Der Tisch's row form (T4.3/T6.5), hidden under
     Klassisch until a design asks for them — the same shape #1191 used.

     They render the person's state SPREAD over the games rather than per-game
     progress, and that is the honest reading rather than a simplification: a
     column is submitted in one POST at the end of the card run
     (`saveVotes` below), so `votedIds` is the only thing that exists and it is
     binary. The sheet's middle state („wertet gerade", two of three filled)
     has no data behind it anywhere in the app, and inventing one would mean
     writing a partial column — which is exactly what the redactor exists to
     stop being observable. So a box is filled when the person is done and open
     when they are not, and the count beside it says the same thing in words. */
  const peopleEl = root.querySelector('#lvPeople');
  people.forEach((p) => {
    const done = voted.has(p.id);
    // aria-hidden: the state line and the count already carry this in words, so
    // announcing N boxes per person would triple the reading of the list for
    // nothing. The boxes are the glanceable form of a fact already spoken.
    const dots = games.map(() => `<span class="live-person__dot${done ? ' is-done' : ''}">
          <i class="ti ${done ? 'ti-check' : 'ti-hourglass'}" aria-hidden="true"></i>
        </span>`).join('');
    const chip = h(`<div class="live-person${done ? ' is-voted' : ''}">
        <span class="live-person__avatar" style="background:${personColor(round, p)}">${avatarFace(initials(p.name), { userId: p.userId })}</span>
        <span class="live-person__name">${esc(personLabel(p))}</span>
        <span class="live-person__state">
          <i class="ti ${done ? 'ti-check' : 'ti-hourglass'}" aria-hidden="true"></i>
          ${esc(t(done ? 'lobby.voted' : 'lobby.waiting'))}
        </span>
        <span class="live-person__dots" aria-hidden="true">${dots}</span>
        <span class="live-person__progress">${esc(t('lobby.progress', {
          n: done ? games.length : 0,
          total: games.length,
        }))}</span>
      </div>`);
    peopleEl.appendChild(chip);
  });

  /* The account-free voters, as one note rather than a badge per row (T4.3).
     Named from `session.guests`, which is the only thing the app actually knows:
     a guest is a participant with no account by construction (#532), so they can
     only be voting through the link. Who is holding the link is NOT knowable —
     any participant may claim any open name on it — so the note says what is
     true of the guests and does not claim to identify the device. */
  const guests = (session.guests || []).filter((g) => people.some((p) => p.id === g.id));
  if (guests.length) {
    peopleEl.appendChild(h(`<div class="live-vote__guests">
        <i class="ti ti-user-plus" aria-hidden="true"></i>
        <span class="live-vote__guests-main">
          <span class="live-vote__guests-title">${esc(tn(guests.length, 'lobby.guestVoterOne', 'lobby.guestVoter', {
            names: joinNames(guests.map((g) => g.name)),
            n: guests.length,
          }))}</span>
          <span class="live-vote__guests-note">${esc(t('lobby.guestVoterNote'))}</span>
        </span>
      </div>`));
  }

  const actions = root.querySelector('#lvActions');

  // Write one person's column, then come back here with the server's own view of
  // who has voted. Refetched rather than patched locally: other people have been
  // voting on their own devices while this one was busy.
  const voteFor = (person, skipIntro) => {
    startVoting(round, session, games, [person], {
      skipIntro,
      saveVotes: async (votes) => {
        await api(
          'POST',
          `/api/rounds/${round.id}/sessions/${session.id}/votes/${person.id}`,
          { votes: votes[person.id] || {} }
        );
      },
      onSaved: async () => {
        const fresh = await fetchRoundFresh(round.id);
        const s = fresh.sessions.find((x) => x.id === session.id);
        // Someone can have closed the voting from another device while this
        // person was rating; then the reveal is where they belong, not here.
        if (!s) return showRound(round.id, 'start');
        if (s.done) return showResults(fresh, s, games, true);
        // `true`: this device just handed the vote on, so the lobby leads with
        // whoever is next rather than making the holder find them.
        showSessionLobby(fresh, s, true);
      },
    });
  };

  // Anyone still open who could take this device next. Your own seat is excluded
  // when the "vote now" button below already offers it — listed twice you appear
  // on one screen under two labels for the same action.
  const hotseat = pending.filter((p) => !mine || p.id !== mine.id);

  // The hand-on (#655): after someone votes here, the next person still open
  // leads. Two conditions, and both are load-bearing:
  //
  // - Only after a vote on THIS device. Arriving at the lobby cold, or watching
  //   someone else's vote land, is not a hand-over and must not push a name at
  //   you.
  // - Only when your own seat is not already leading. An unused personal seat is
  //   the app's established "your turn" affordance, and burying it under a
  //   hand-on to somebody else asks you to pass the phone on while you still
  //   have not voted yourself.
  const iLead = !!(mine && !iVoted);
  const nextUp = handedOn && !iLead && hotseat.length ? hotseat[0] : null;
  if (nextUp) {
    const btn = h(`<button class="btn btn--primary btn--lg live-vote__mine">
        <span class="live-person__avatar live-person__avatar--sm" style="background:${personColor(round, nextUp)}">${avatarFace(initials(nextUp.name), { userId: nextUp.userId })}</span>
        ${esc(t('lobby.next', { name: personLabel(nextUp) }))}
      </button>`);
    // With the handover screen: on this device the next person really is being
    // handed a phone, which is exactly what that screen is for.
    btn.addEventListener('click', () => voteFor(nextUp, false));
    actions.appendChild(btn);
  }

  // Your own seat leads, when you have one and have not used it. No handover
  // screen: you are alone with your own phone.
  if (mine && !iVoted) {
    const me = people.find((p) => p.id === mine.id);
    const btn = h(`<button class="btn btn--primary btn--lg live-vote__mine">
        <i class="ti ti-player-play" aria-hidden="true"></i> ${esc(t('lobby.voteNow'))}
      </button>`);
    btn.addEventListener('click', () => voteFor(me, true));
    actions.appendChild(btn);
  } else if (mine && iVoted && pending.length) {
    // Only while there is actually something to wait for. Once the last vote is
    // in, "waiting for the others" is a sentence about a state that has passed —
    // and it would sit directly above the button that ends the voting.
    actions.appendChild(h(`<p class="muted center live-vote__done">${esc(t('lobby.yourVoteIn'))}</p>`));
  }

  // Anyone still open can vote right here — the hot-seat path, unchanged and
  // fully available. This is what makes a mixed evening work without anybody
  // configuring who sits where before the draw: name-only members and people in
  // the room use this device, everyone else uses their own.
  //
  // Everyone else who can vote here. `nextUp` is dropped for the same reason the
  // own seat is: it is already the leading button.
  const rest = hotseat.filter((p) => !nextUp || p.id !== nextUp.id);
  if (rest.length) {
    const list = h(`<div class="live-vote__hotseat">
        <div class="field__label">${esc(t('lobby.hereLabel'))}</div>
      </div>`);
    rest.forEach((p) => {
      const btn = h(`<button class="btn live-vote__hotseat-btn">
          <span class="live-person__avatar live-person__avatar--sm" style="background:${personColor(round, p)}">${avatarFace(initials(p.name), { userId: p.userId })}</span>
          ${esc(t('lobby.voteHere', { name: personLabel(p) }))}
        </button>`);
      // With the handover screen: on this device the next person really is being
      // handed a phone, which is exactly what that screen is for.
      btn.addEventListener('click', () => voteFor(p, false));
      list.appendChild(btn);
    });
    actions.appendChild(list);
  }

  /* „Am eigenen Gerät mitstimmen" (T4.3/T6.5): the share controls and the action
     that ends the voting, as one paper block beside the people.

     A SIBLING of the actions column, not a child of it. It reads like a child —
     everything in it was one before this issue — but on a desktop T4.3 puts the
     panel beside the people while the voting actions stay under them, and a
     nested panel cannot be placed in a grid its parent owns. Placing it from
     inside the column instead needs `display: contents` on the column plus an
     explicit `grid-row` on the panel, and that row number is a count of who has
     voted and whether anyone is mid-hand-over — i.e. it is right on one session
     and wrong on the next.

     What that costs is the 12px the actions column gave these children for free,
     so the panel restates it (styles.css). The head renders only while someone
     is still open — with every vote in, „Am eigenen Gerät mitstimmen" is a
     heading over a sharing offer nobody needs, and the panel is then just the
     closing action. */
  const panel = h('<div class="live-vote__panel"></div>');

  // Share the session as a link (#652), so people WITHOUT an account can vote
  // from their own phone. Offered above the close button and below the voting
  // actions: it is what you reach for while people are still arriving, not what
  // ends the evening.
  //
  // The link is minted on demand rather than with the draw — most sessions never
  // need one, and a token that exists is a token that can leak.
  if (pending.length) {
    panel.appendChild(h(`<div class="live-vote__panel-head">
        <h2 class="live-vote__panel-title">${esc(t('lobby.panelTitle'))}</h2>
        <p class="live-vote__panel-note">${esc(t('lobby.panelNote'))}</p>
      </div>`));
    const shareRow = h('<div class="live-vote__share-row"></div>');
    const share = h(`<button class="btn live-vote__share">
        <i class="ti ti-link" aria-hidden="true"></i> ${esc(t('lobby.share'))}
      </button>`);
    share.addEventListener('click', async () => {
      share.disabled = true;
      try {
        const { token } = await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/vote-link`, {});
        const url = location.origin + votePath(token);
        // navigator.share is the phone-native path (it opens the chat app the
        // group actually uses); the clipboard is the desktop fallback. Both are
        // behind a user gesture, which is what makes either permissible at all.
        // A cancelled share sheet rejects — it is not an error worth a toast.
        if (navigator.share) {
          try { await navigator.share({ text: t('lobby.shareText', { round: round.name }), url }); } catch { /* dismissed */ }
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          toast(t('lobby.shareCopied'), { tone: 'success' });
        } else {
          // No share sheet and no clipboard (an insecure origin, an old browser):
          // show the URL so it can at least be copied by hand, rather than
          // reporting a success that did not happen.
          showShareUrlSheet(url);
        }
      } catch (e) {
        toast(e.message, { tone: 'error' });
      } finally {
        share.disabled = false;
      }
    });
    shareRow.appendChild(share);

    // The same link as a code on this screen (#1170). Beside the share control
    // rather than inside its sheet: at a table it is the FASTER of the two —
    // five phones scan it at once, where sharing means finding the group chat
    // mid-evening — so it must not be something you reach by first trying the
    // other one.
    const qr = h(`<button class="btn live-vote__qr" type="button">
        <i class="ti ti-qrcode" aria-hidden="true"></i> ${esc(t('lobby.qr'))}
      </button>`);
    qr.addEventListener('click', () => showVoteQrSheet(round, session));
    shareRow.appendChild(qr);
    panel.appendChild(shareRow);
  }

  // Closing is available at every point, not only once everyone is in: someone
  // who never turns up must not be able to hold the evening hostage. It leads
  // only when there is nothing left to wait for.
  const close = h(`<button class="btn ${pending.length ? '' : 'btn--primary '}btn--lg live-vote__close">
      <i class="ti ti-flag" aria-hidden="true"></i> ${esc(t('lobby.close'))}
    </button>`);
  close.addEventListener('click', async () => {
    if (pending.length && !await confirmDialog({
      body: tn(pending.length, 'lobby.closeConfirmOne', 'lobby.closeConfirm'),
      confirmLabel: t('lobby.close'), icon: 'ti-flag', danger: false,
    })) return;
    try {
      stopLobbyPoll();
      await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/close`, {});
      const fresh = await fetchRoundFresh(round.id);
      const s = fresh.sessions.find((x) => x.id === session.id);
      if (!s) return showRound(round.id, 'start');
      // Straight into the finale: the reveal is the moment this whole screen has
      // been holding back, and it belongs on the device that called time.
      showFinale(fresh, s, sessionGames(fresh, s));
    } catch (e) {
      toast(e.message, { tone: 'error' });
      showSessionLobby(round, session);
    }
  });
  panel.appendChild(close);

  /* Who the group is still waiting for (T4.3/T6.5), under an ENABLED button.

     The package draws this two ways and they disagree: T4.3 has „Ergebnis
     zeigen" gold and live with the line beneath it, T6.5 has the same button
     `disabled`. The enabled reading is the one that ships, because the app
     already decided this question the other way and for a reason the sheets do
     not overturn — closing is available at every point so that someone who never
     turns up cannot hold the evening hostage (see the button above). So the line
     is information, not an explanation of a lock, and its wording states the
     fact rather than promising that the action becomes possible later.

     Named while the list is short enough for a name to help, counted after that:
     six names is a paragraph, and the reader's question at that size is „how
     many", not „who". */
  if (pending.length) {
    const names = joinNames(pending.map((p) => personLabel(p)));
    const reason = pending.length === 1
      ? t('lobby.waitingForOne', { name: names })
      : pending.length <= 3
        ? t('lobby.waitingForNamed', { n: pending.length, names })
        : t('lobby.waitingForMany', { n: pending.length });
    panel.appendChild(h(`<p class="live-vote__waiting">${esc(reason)}</p>`));
  }

  root.appendChild(panel);

  // Below the actions: what you can do comes first, what already happened after.
  const log = renderSessionLog(round, session);
  if (log) root.appendChild(log);

  app.appendChild(root);

  // Poll for other devices' votes. `root` still being in the document is the
  // teardown signal — there is no unmount hook, and every navigation replaces
  // app's children, so a detached root means this screen is gone.
  lobbyPoll = setInterval(async () => {
    if (!document.body.contains(root)) return stopLobbyPoll();
    try {
      const fresh = await fetchRoundFresh(round.id);
      const s = fresh.sessions.find((x) => x.id === session.id);
      if (!document.body.contains(root)) return stopLobbyPoll();
      // Gone, or closed from another device — either way this screen is stale.
      if (!s) { stopLobbyPoll(); return showRound(round.id, 'start'); }
      if (s.done) { stopLobbyPoll(); return showResults(fresh, s, sessionGames(fresh, s), true); }
      // Re-render only on a real change: an unconditional rebuild every 5s would
      // fight the user's scroll position and drop focus for no reason.
      const before = (session.votedIds || []).join(',');
      const after = (s.votedIds || []).join(',');
      // `handedOn` rides along: somebody else's vote landing must not silently
      // drop the "next person" button out from under the device that is
      // mid-hand-over. Whoever it names may now have voted, which the re-render
      // resolves on its own — `nextUp` is recomputed from the fresh pending list.
      if (before !== after) showSessionLobby(fresh, s, handedOn);
    } catch { /* a failed poll is not worth a toast; the next tick retries */ }
  }, LOBBY_POLL_MS);
}

/* Last-resort share fallback: no `navigator.share`, no clipboard. Was a
   `prompt()` used as a read-only display — an INPUT dialog for something the
   user can only read, in OS chrome, on a screen the round has themed (#939).
   A field rather than a paragraph because the URL still has to be selectable,
   and it says "copy this" rather than the clipboard path's "copied": nothing
   was copied, and claiming otherwise is the one thing this branch must not do. */
function showShareUrlSheet(url) {
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t('lobby.share'))}">
        <div class="sheet__head">
          <h2>${esc(t('lobby.share'))}</h2>
          <button class="sheet__close" type="button" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <p class="muted">${esc(t('lobby.shareManual'))}</p>
        <input id="shareUrlField" class="input" readonly
          aria-label="${esc(t('lobby.share'))}" value="${esc(url)}" />
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

  // Focus AFTER openSheet, and select the whole URL: a manual copy is the only
  // thing this sheet is for, so it starts one keystroke away.
  const field = sheet.querySelector('#shareUrlField');
  field.focus();
  field.select();
}

/* The vote link as a code to hold up at the table (#1170).

   Drawn by the server (lib/routes/sessions.js), which mints the link through
   the same guard the share button does and encodes the URL it would itself
   serve — so the picture cannot point somewhere the link does not. Fetched on
   every open rather than cached: the code then always shows the link currently
   in force.

   Injected as inline SVG, never as a `data:` image URL — the token would
   otherwise sit in an attribute that a screenshot, a devtools copy or a crash
   report carries off with it. The markup is the server's own. */
function showVoteQrSheet(round, session) {
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog vote-qr" role="dialog" aria-modal="true" aria-label="${esc(t('lobby.qr'))}">
        <div class="sheet__head">
          <h2>${esc(round.name)}</h2>
          <button class="sheet__close" type="button" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="vote-qr__code" role="img" aria-label="${esc(t('lobby.qrAlt'))}">
          <p class="muted center">${esc(t('lobby.qrLoading'))}</p>
        </div>
        <p class="muted center vote-qr__hint">${esc(t('lobby.qrHint'))}</p>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());

  api('POST', `/api/rounds/${round.id}/sessions/${session.id}/vote-link/qr`, {}).then(({ svg }) => {
    // The sheet may be gone by now — a code nobody is waiting for is not an
    // error, and writing into a detached node would hide the next one.
    if (!document.body.contains(backdrop)) return;
    sheet.querySelector('.vote-qr__code').innerHTML = svg;
  }).catch((e) => {
    if (document.body.contains(backdrop)) closeSheet();
    toast(e.message, { tone: 'error' });
  });
}
