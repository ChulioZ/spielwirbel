---
paths:
  - "lib/routes/sessions.js"
  - "lib/session-votes.js"
  - "lib/session-events.js"
  - "public/js/session-log.js"
  - "lib/routes/rounds.js"
  - "public/js/views-session-live.js"
  - "public/js/views-session.js"
  - "public/js/router.js"
---
# Per-device voting (#209): the hot-seat flow was hiding five things for free

A `deviceVoting` session collects each person's column as they submit it
(`POST …/sessions/:sid/votes/:pid`) and is closed by `…/close`, instead of the
wizard POSTing one whole map to `…/results` at the end. Five properties the old
shape provided **by accident** stop holding the moment writes become incremental
— the last of them being that nobody had to ask who did what, because there was
only ever one device and one person holding it.

## 1. Vote secrecy was a side effect of writing once, at the end

`GET /api/rounds/:rid` ships every session's `votes` verbatim, and always did.
That was harmless only because the hot-seat wizard kept every vote in a closure
until the finale — there was simply nothing on the server to leak. Write
incrementally and the same untouched endpoint hands the second voter the first
voter's ratings, which is exactly what the handover screen's "don't peek" and the
finale gate exist to prevent, delivered as JSON.

`lib/session-votes.js` `redactRoundVotes` is the fix, applied at **both** places
`lib/routes/rounds.js` serialises a round (the GET and the rename response —
the rename replaces the client's whole round object). An open device session goes
out with `votes: {}` plus `votedIds`; once `done`, the full map goes out as
before, because that is the reveal.

**`votedIds` must filter on a NON-EMPTY map.** The wizard seeds
`votes[personId] = {}` for everyone up front, so key presence proves nothing —
`Object.keys(votes)` alone marks every participant as done the instant the
session starts. Verified by breaking exactly that line.

## 2. `…/results` REPLACES the map — it must refuse a per-device session

That is correct for the wizard (its closure holds everyone's votes) and
destructive here, where each column was written separately and any one caller
holds at most its own. A stale or hand-rolled client calling it would silently
discard everyone else's votes and report success. Hence the
`if (stored.deviceVoting) → 400 device_voting` guard, and the mirror-image
`if (!session.deviceVoting) → 400 not_device_voting` on the two new routes: the
two modes must never interleave on one session.

Both repo mutators go through the existing `withSession` read-modify-write, which
is what makes two simultaneous submissions safe — Postgres takes `FOR UPDATE`, so
the later writer sees the earlier one's column instead of clobbering it. Never
"read the map, merge in the client, write it back".

## 3. There is no host — `lib/routes/sessions.js` has NO `req.grant` guard

Unlike `DELETE /rounds/:rid`, `…/games/move-to` and `PATCH …/members/:mid`, no
route in the sessions router is owner-only. So **any invitee can start, vote in
and close a session**, and "the owner's device" is a fiction: it is the *starting*
device, and it holds no special standing. The lobby is deliberately one screen for
everybody, offering whatever actions fit whoever is looking at it — which is also
what stops a flat battery on one phone from stranding the evening.

The per-person write therefore takes the **same** authority `…/results` always
had (anyone with round access may write any joined person's column) rather than
inventing one. `member.userId` decides only which button the *client* offers
first — attribution, not access (`.claude/rules/member-seat-self-claim.md`).
Per-action permissions inside a round are #137's job; do not grow one here.

## 4. `showResultsById` gave up on a STALE SWR cache — and that is the entry point

`fetchRound` is stale-while-revalidate, so a session created on another device is
missing from this one's cache until the background refresh lands — by which time
`showResultsById` has already rendered the hub. Pre-existing, and harmless while
the only thing at that URL was a finished session nobody deep-links to. The lobby
lives at the same URL and is reached by exactly such a link, so a failed lookup
now refetches once with `fetchRoundFresh` before giving up.

Reproducing it needs a genuinely stale cache: create the session with `fetch()`
(not through the app), confirm `swrStore.get('round:'+rid)` does **not** hold it,
then cold-load the session URL.

## 5. The session LOG is what makes a hybrid evening legible — and it names accounts

Once votes can arrive from several accounts, "who did what" stops being derivable
from the session at all. `public/js/session-log.js` + `lib/session-events.js`
record it, rendered in the lobby and again on the results screen.

Three things about it are load-bearing:

- **It records the ACCOUNT, never the device.** The server sees which account
  sent a request; it cannot know who was holding the hardware, and Anna handing
  her phone to Ben is indistinguishable from Anna tapping it herself. So the
  wording is „Anna hat für Ben abgestimmt", not „Ben hat an Annas Gerät
  abgestimmt" — the same accountability without a claim we cannot back. Do not
  "improve" the copy toward devices.
- **Entries are appended inside `withSession`**, not by a second call afterwards.
  A separate append can fail on its own, leaving a session whose state moved with
  no entry saying so — and a log that is quietly incomplete is worse than none,
  because it is read as authoritative.
- **The type list and the phrasing live in ONE file**, which the backend requires
  out of `public/js/`. The server writes types and the client renders them, so a
  type with no phrase renders as **nothing at all** — no error, no 400, just a
  shorter history. That inversion (server writes, client renders) is why it is
  the fourth entry in `.claude/rules/shared-constants-across-the-stack.md`.

The log is shown for shared-device sessions too, where it says little. That is
deliberate: a reader should not have to know which kind of session they are
looking at in order to know the list is complete.

**It renders newest-first, and the reversal belongs in the BUILDER.** The stored
array must stay append-ordered, because `pushSessionEvents` bounds it with
`slice(-MAX)` — reverse it at the write end and the cap starts dropping the
newest entries instead of the oldest, which is invisible until a session runs
long enough to hit 200.

## Smaller things

- **The lobby's poll teardown is DOM containment.** There is no unmount hook, so
  the interval checks `document.body.contains(root)` and clears itself — every
  navigation replaces `#app`'s children, so a detached root means the screen is
  gone. It also re-renders only when `votedIds` actually changed; an
  unconditional 5s rebuild would fight the user's scroll and focus.
- **The setup toggle must not stay armed while disabled.** Deselecting the last
  linked member unchecks it, or the draw submits `deviceVoting` for a session
  nobody can vote remotely in — a lobby with no way into it.
- **`startVoting` grew an `opts` argument rather than a second implementation.**
  The history-entry-per-step, the #329 leave guard and the `beforeunload` block
  are machinery a copy would have to get right again
  (`.claude/rules/session-flow-history.md`); `saveVotes`/`onSaved`/`skipIntro`
  reuse it, and absent opts is the original behaviour byte for byte. The teardown
  (`saved`, listener removal, `endFlow()`) stays in `finish()`, not in the
  callback — a wizard left registered as the active flow swallows the next Back.
- **The toggle's row must not live in a `.field`** — `.field label` (0,1,1) beats
  `.ds-row` (0,1,0) and flattens it
  (`.claude/rules/label-rows-lose-to-field-label.md`). Verified by computed
  style: `display: flex`, and `cursor: default` once disabled.
- **`live-vote`, not `lobby-*`.** That prefix is the HOME screen's round list
  (`.lobby-list`/`.lobby-head`/`.lobby-cta`); two unrelated "lobbies" in one
  stylesheet is how a selector styles the wrong screen. The i18n keys are
  `lobby.*` — they are namespaced separately and do not collide.

**Related:** `.claude/rules/session-flow-history.md` (the wizard this reuses),
`.claude/rules/round-grant-resolver.md` and
`.claude/rules/member-seat-self-claim.md` (why a grant, not a seat, is the access
decision), `.claude/rules/postgres-backend.md` (the absent-key parity
`deviceVoting` keeps), `.claude/rules/pwa-service-worker.md` (the cache-first
shell that served a pre-fix bundle twice while verifying this).
