/* Spielwirbel – the per-device voting lobby (#209). Part of the frontend; all
   files share one global script scope.

   A session drawn with `deviceVoting` collects each person's votes separately,
   as they submit them, instead of running one hot-seat wizard to the end. This
   screen is what stands in for that wizard: it shows who has voted and who has
   not, lets whoever is holding the device vote — for themselves or for anyone
   still open — and closes the voting when the group is ready.

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
function renderSessionLog(round, session) {
  const byId = new Map((round.members || []).map((m) => [m.id, m.name]));
  (session.guests || []).forEach((g) => byId.set(g.id, personLabel({ name: g.name, guest: true })));
  const lines = sessionLogLines(session, {
    name: (id) => byId.get(id) || null,
    title: (gid) => (round.games.find((g) => g.id === gid) || {}).title || null,
    t,
  });
  if (!lines.length) return null;

  const wrap = h(`<section class="session-log">
      <h2 class="session-log__title">${esc(t('log.title'))}</h2>
      <!-- reversed: the rows run newest-first, so the implicit numbering counts
           down. No marker is rendered (list-style: none), but the semantics are
           free and a screen reader announces the positions correctly. -->
      <ol class="session-log__list" reversed></ol>
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

function showSessionLobby(round, session) {
  currentView = () => showSessionLobby(round, session);
  // Arriving here always ends any wizard: either we just came out of one, or we
  // never had one. Leaving it registered would let it swallow the next Back.
  endFlow();
  stopLobbyPoll();
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

  // One chip per participant: name, their colour, and whether their vote is in.
  // WHO has voted, never WHAT they voted — the values are redacted server-side
  // while the session is open (lib/session-votes.js) and this screen is exactly
  // why: it has to show progress without revealing a single rating.
  const peopleEl = root.querySelector('#lvPeople');
  people.forEach((p) => {
    const done = voted.has(p.id);
    const chip = h(`<div class="live-person${done ? ' is-voted' : ''}">
        <span class="live-person__avatar" style="background:${personColor(round, p)}">${esc(initials(p.name))}</span>
        <span class="live-person__name">${esc(personLabel(p))}</span>
        <span class="live-person__state">
          <i class="ti ${done ? 'ti-check' : 'ti-hourglass'}" aria-hidden="true"></i>
          ${esc(t(done ? 'lobby.voted' : 'lobby.waiting'))}
        </span>
      </div>`);
    peopleEl.appendChild(chip);
  });

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
        showSessionLobby(fresh, s);
      },
    });
  };

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
  // Your own seat is left out when the button above already offers it: listed in
  // both places you appear twice on one screen, under two labels, for what is
  // the same action bar the handover screen.
  const hotseat = pending.filter((p) => !mine || p.id !== mine.id);
  if (hotseat.length) {
    const list = h(`<div class="live-vote__hotseat">
        <div class="field__label">${esc(t('lobby.hereLabel'))}</div>
      </div>`);
    hotseat.forEach((p) => {
      const btn = h(`<button class="btn live-vote__hotseat-btn">
          <span class="live-person__avatar live-person__avatar--sm" style="background:${personColor(round, p)}">${esc(initials(p.name))}</span>
          ${esc(t('lobby.voteHere', { name: personLabel(p) }))}
        </button>`);
      // With the handover screen: on this device the next person really is being
      // handed a phone, which is exactly what that screen is for.
      btn.addEventListener('click', () => voteFor(p, false));
      list.appendChild(btn);
    });
    actions.appendChild(list);
  }

  // Closing is available at every point, not only once everyone is in: someone
  // who never turns up must not be able to hold the evening hostage. It leads
  // only when there is nothing left to wait for.
  const close = h(`<button class="btn ${pending.length ? '' : 'btn--primary '}btn--lg live-vote__close">
      <i class="ti ti-flag" aria-hidden="true"></i> ${esc(t('lobby.close'))}
    </button>`);
  close.addEventListener('click', async () => {
    if (pending.length && !confirm(t('lobby.closeConfirm', { n: pending.length }))) return;
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
      toast(e.message);
      showSessionLobby(round, session);
    }
  });
  actions.appendChild(close);

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
      if (before !== after) showSessionLobby(fresh, s);
    } catch { /* a failed poll is not worth a toast; the next tick retries */ }
  }, LOBBY_POLL_MS);
}
