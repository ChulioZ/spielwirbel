/* Spielwirbel – the session activity log (#209): what happened during a session,
   and who did it.

   Per-device voting made a session's history genuinely ambiguous. Before it,
   every vote was entered on one device by whoever was holding it, so "who did
   what" needed no recording. Now the owner may hot-seat two people here, a third
   votes from their own device, a fourth is hot-seated on THAT person's device,
   and any participant can end the voting for everyone. This turns that into
   something the group can read afterwards.

   ## It records the ACCOUNT, not the device

   The server sees which account submitted a request; it cannot see which piece
   of hardware that request came from, and it must not pretend otherwise — Anna
   handing her phone to Ben is indistinguishable from Anna tapping it herself.
   So the log says „Anna hat für Ben abgestimmt", never „Ben hat an Annas Gerät
   abgestimmt". That is the same accountability without a claim we cannot back.

   ## Why the type list lives HERE

   The server writes these events and the client renders them, so a type the
   client has no phrase for renders as nothing at all — the silent half of the
   drift `.claude/rules/shared-constants-across-the-stack.md` is about. One list,
   in a dependency-free file the frontend loads as a script and `lib/
   session-events.js` requires, rather than two that must be kept in step.

   Pure and DOM-free, so the suite can require it and the coverage gate stays
   happy (.claude/rules/frontend-helper-modules-and-coverage.md). `t` is injected
   for the reason session-share.js injects it: a public/js file cannot require a
   sibling, and `t` lives in i18n.js. */

'use strict';

// Every event a session can record, mapped to the i18n key that phrases it.
// An event whose type is not in here is dropped at the WRITE end
// (lib/session-events.js), so the log can never hold something no screen can
// say — the allowlist discipline of .claude/rules/product-event-logging.md.
const SESSION_EVENTS = {
  started: 'log.started',
  voted: 'log.voted', // resolved to votedSelf/votedFor below — it needs two names
  voting_closed: 'log.closed',
  game_chosen: 'log.chose',
  game_unchosen: 'log.unchose',
  game_removed: 'log.removedGame',
  finished: 'log.finished',
  unfinished: 'log.unfinished',
  cancelled: 'log.cancelled',
  uncancelled: 'log.uncancelled',
};

// Cap on a single session's log. Choosing and un-choosing a game is one tap
// each, so an indecisive evening could otherwise grow the session blob without
// bound — and the blob is read whole on every round fetch.
const SESSION_LOG_MAX = 200;

/* One line per event, NEWEST FIRST.

   The stored array stays append-ordered — `pushSessionEvents` bounds it with
   `slice(-MAX)`, which only drops the oldest while that holds — so the reversal
   is a display concern and lives here rather than at the write end. On a running
   session the newest line is the one the reader is waiting for, and a list that
   grows all evening must not push it further down the screen each time.

   `name(id)` resolves a member or guest id to a label, `title(gid)` a game id;
   both may return null for something deleted since, which the fallbacks cover.

   A vote is the only entry needing two names, and the distinction is the whole
   point of the log: „Anna hat abgestimmt" when it was her own seat, „Anna hat
   für Ben abgestimmt" when she submitted his. With no actor at all (a
   password-only instance, where no request carries an account) it degrades to
   the first form, which is the honest reading there: the person rated, on the
   one device the round runs from. */
function sessionLogLines(session, { name, title, t }) {
  const events = (session && session.events) || [];
  const who = (id) => (id && name(id)) || t('log.someone');
  return events
    .filter((e) => e && SESSION_EVENTS[e.type])
    .map((e) => {
      const actor = who(e.actor);
      let text;
      if (e.type === 'voted') {
        const person = (e.personId && name(e.personId)) || t('log.someone');
        text = !e.actor || e.actor === e.personId
          ? t('log.votedSelf', { name: person })
          : t('log.votedFor', { actor, name: person });
      } else if (e.type === 'game_chosen' || e.type === 'game_removed') {
        text = t(SESSION_EVENTS[e.type], {
          actor,
          game: (e.gameId && title(e.gameId)) || t('log.aGame'),
        });
      } else {
        text = t(SESSION_EVENTS[e.type], { actor });
      }
      return { at: e.at, text };
    })
    .reverse();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SESSION_EVENTS, SESSION_LOG_MAX, sessionLogLines };
}
