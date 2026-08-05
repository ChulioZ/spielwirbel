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
# Every session collects votes incrementally (#209, universal since #655)

A session's votes are written **one person's column at a time**, as each is
submitted (`POST …/sessions/:sid/votes/:pid`), and the session is ended by
`…/close`. There is no second mode: #655 deleted the `deviceVoting` toggle that
used to choose between this and a hot-seat wizard holding the whole table's
ratings in a closure until one final POST.

Four properties the old shape provided **by accident** stop holding once writes
are incremental. They were the cost of #209's opt-in; since #655 they are simply
how every session works.

## 1. Vote secrecy was a side effect of writing once, at the end

`GET /api/rounds/:rid` ships every session's `votes` verbatim, and always did.
That was harmless only because the wizard kept every vote in a closure — there
was nothing on the server to leak. Write incrementally and the same untouched
endpoint hands the second voter the first voter's ratings, which is exactly what
the handover screen's "don't peek" and the finale gate exist to prevent,
delivered as JSON.

`lib/session-votes.js` `redactRoundVotes` is the fix, applied at **both** places
`lib/routes/rounds.js` serialises a round (the GET and the rename response — the
rename replaces the client's whole round object). An open session goes out with
`votes: {}` plus `votedIds`; once `done`, the full map goes out, because that is
the reveal.

**`isVotingOpen` is now `!done && !cancelled`** — no mode check. Removing that
condition widened the redaction from an opt-in subset to every session, which is
one condition fewer and fails in the safe direction: it can only ever redact
more. A direct-pick session (#532) is born `done`, so it is never open and needs
no special case.

**`votedIds` must filter on a NON-EMPTY map.** An empty column means "submitted
nothing", not "has not voted", and `Object.keys(votes)` alone would mark people
done the moment anything seeded a key. Verified by breaking exactly that line.

## 2. `…/results` is LEGACY — keep it, and keep it MERGING

It replaces the whole map, which was right for the wizard and is wrong now that
each column is written separately. It survives only because the service worker
serves the shell **cache-first**, so a browser still holding the pre-#655 bundle
runs the old wizard and POSTs here; deleting the route would strand that client
with an evening it has already collected.

So it **merges** (`{ ...prev, ...votes }`) instead of replacing. A stale client
believes it holds every vote, and it no longer does — someone may have voted from
the lobby or a shared link while it ran. Merging keeps its own columns for the
people it collected and leaves everyone else's alone; replacing would erase them
silently while the stale client reported success. Delete the route a release or
two on, once no such bundle can plausibly still be in use.

## 3. There is no host — `lib/routes/sessions.js` has NO `req.grant` guard

No route in the sessions router is owner-only. So **any invitee can start, vote
in and close a session**, and "the owner's device" is a fiction: it is the
*starting* device and holds no special standing. The lobby is deliberately one
screen for everybody, offering whatever actions fit whoever is looking at it —
which is also what stops a flat battery on one phone from stranding the evening.

The per-person write therefore takes the authority `…/results` always had (anyone
with round access may write any joined person's column) rather than inventing
one. `member.userId` decides only which button the *client* offers first —
attribution, not access (`.claude/rules/member-seat-self-claim.md`). Per-action
permissions inside a round are #137's job; do not grow one here. The public vote
link (#652) extends the same authority to whoever the group hands the URL to,
which is what sharing it means — see
`.claude/rules/capability-links-gate-on-the-target.md`.

## 4. The session LOG is what makes a mixed evening legible — and it names accounts

Once votes arrive from several places, "who did what" stops being derivable from
the session at all. `public/js/session-log.js` + `lib/session-events.js` record
it, rendered in the lobby and again on the results screen.

- **It records the ACCOUNT, never the device.** The server sees which account
  sent a request; it cannot know who was holding the hardware, and Anna handing
  her phone to Ben is indistinguishable from Anna tapping it herself. So the
  wording is „Anna hat für Ben abgestimmt", not „Ben hat an Annas Gerät
  abgestimmt". Do not "improve" the copy toward devices. A **link** voter has no
  account at all, so their entry carries no actor and renders as „Anna hat
  abgestimmt" — the honest reading, and why that needed no new event type.
- **Entries are appended inside `withSession`**, never by a second call
  afterwards. A separate append can fail on its own, leaving a session whose
  state moved with no entry saying so — and a log that is quietly incomplete is
  worse than none, because it is read as authoritative.
- **The type list and the phrasing live in ONE file**, which the backend requires
  out of `public/js/`. The server writes types and the client renders them, so a
  type with no phrase renders as **nothing at all** — the fourth entry in
  `.claude/rules/shared-constants-across-the-stack.md`.

**It renders newest-first, and the reversal belongs in the BUILDER.** The stored
array stays append-ordered because `pushSessionEvents` bounds it with
`slice(-MAX)`; reverse it at the write end and the cap starts dropping the
newest entries, which is invisible until a session runs long enough to hit 200.

## The hand-on: what replaced the guided wizard

#655 removed the multi-person walk-through, which was the one real UX cost —
a five-person table would otherwise pay a tap per voter *plus* the effort of
noticing who is left. So after a vote lands **on this device** the lobby leads
with the next person still open („Weiter zu Ben") instead of returning to a plain
roster. Two conditions, both load-bearing and both covered by a spec:

- **only after a vote on this device** (`handedOn`) — arriving cold, or watching
  someone else's vote land, is not a hand-over and must not push a name at you;
- **only when your own unused seat is not already leading** — burying "vote now"
  under a hand-on asks you to pass the phone on before you have voted yourself.

It needs no empty case: with nobody left there is no next person, and „Abstimmung
beenden" is already the primary action in that state.

## Smaller things

- **The lobby's poll teardown is DOM containment.** There is no unmount hook, so
  the interval checks `document.body.contains(root)` and clears itself. It
  re-renders only when `votedIds` actually changed; an unconditional 5s rebuild
  would fight the user's scroll and focus. It carries `handedOn` through, or
  somebody else's vote landing would drop the hand-on button mid-hand-over.
- **`startVoting` has ONE caller and always gets one person.** Its `people` loop
  and `shuffled()` are kept rather than flattened: the generality costs four
  lines, while collapsing it would touch every guard written against `votes` as a
  map. What its `beforeunload` and leave guard now protect is **one person's
  cards**, not the table's evening — a smaller blast radius, still worth a
  confirm (`.claude/rules/session-flow-history.md`).
- **`live-vote`, not `lobby-*`.** That prefix is the HOME screen's round list;
  two unrelated "lobbies" in one stylesheet is how a selector styles the wrong
  screen. The i18n keys are `lobby.*` — namespaced separately, no collision.
- **The lobby renders a game COUNT, never a title.** The draw stays secret until
  the reveal, so the ticket and the lobby both say "3 Spiele ausgelost".

**Related:** `.claude/rules/session-flow-history.md` (the card-level flow this
reuses), `.claude/rules/capability-links-gate-on-the-target.md` (the account-free
route into the same write), `.claude/rules/round-grant-resolver.md` and
`.claude/rules/member-seat-self-claim.md` (why a grant, not a seat, is the access
decision), `.claude/rules/postgres-backend.md`,
`.claude/rules/pwa-service-worker.md` (the cache-first shell that is why
`…/results` still exists).
