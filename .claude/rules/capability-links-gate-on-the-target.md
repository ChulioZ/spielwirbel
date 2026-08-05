---
paths:
  - "lib/routes/vote-link.js"
  - "lib/repo/json.js"
  - "lib/repo/postgres.js"
  - "test/vote-link.test.js"
  - "public/js/views-vote-link.js"
---

# A capability token is validated against its TARGET, never against its own row

The vote link (#652) is the app's first unauthenticated capability: `/vote/:token`
lets someone with no account read one session's ballot and write one participant's
column. `session_vote_links` is a global, un-scoped store — resolving the token is
what *produces* the tenant, so there is nothing to scope the lookup by.

The obvious design makes the **row** the authority: mint it when the session is
shared, delete it when the session closes, is cancelled, is deleted, when the
round goes, when the account is erased. That is six cascade sites in two backends,
and **every one of them is a live ballot if it is missed** — no error, no failing
test, just a token that still works after the group thought it was done.

So the row is not the authority. `openBallot()` re-reads the session on **every**
request and refuses unless it exists, is `deviceVoting`, and is neither `done` nor
`cancelled`. Both handlers go through it. A stale row is therefore **inert by
construction**, and the deletions become retention hygiene — worth doing (a row
naming a round and a tenant must not outlive them) but not load-bearing.

**The general form:** when a token points at something that has its own lifecycle,
derive validity from that thing, not from the token's existence. Deleting the
token is then a cleanup you can get wrong safely.

## Every refusal is the SAME 404 — that is a security property, not tidiness

Unknown token, deleted round, erased account, closed session, cancelled session,
a hot-seat session: all answer `404 {"error":"invalid_link"}`, byte for byte. A
distinct "expired" or "closed" state would tell a stranger that the token they
tried is **real**, which is the only feedback brute force needs.

The client cannot diagnose either — `voteLink.deadBody` says voting is over *or*
the link is wrong, deliberately without choosing.

## The trap: the uniform-404 test passes with the gate DELETED

This is the part that cost the effort, and it is the reason this file exists.

The natural test drives each way a link dies — close it, cancel it, delete the
session, delete the round — and asserts the answers are indistinguishable. It
looks like a thorough test of the gate. It is not: **each of those paths also
deletes the row**, so `findSessionVoteLink` returns null and the 404 comes from
the lookup, never reaching the state check. Measured on #652 — deleting the
`!session.deviceVoting || session.done || session.cancelled` line outright left
all 15 route specs green.

Two causes, one output — the same shape as
`.claude/rules/trust-proxy-is-a-hop-count.md`'s `RateLimit-Remaining` split, and
just as easy to read the wrong way round.

**The discriminating test reinstates a stale row on purpose:**

```js
await request(app).post(`/api/rounds/${rid}/sessions/${sid}/close`).send({});
const revived = await repo.createSessionVoteLink({ tenantId: 'default', roundId: rid, sessionId: sid });
assert.ok(await repo.findSessionVoteLink(revived.id));   // the row really is back
assert.equal((await request(app).get(`/api/vote/${revived.id}`)).status, 404);
```

That is exactly what a missed cascade site leaves behind, and it is the **only**
test in the file that reads the gate — confirmed by breaking the gate and watching
that one name go red and nothing else. Assert the row is present first, or a
revive that silently no-ops makes the test vacuous one level down.

Route 1 (test-first) does not reach this either: before the route exists every
one of these 404s anyway. Only the deliberate break discriminates —
`.claude/rules/break-the-code-on-purpose.md`.

## Event-driven deletion has a hole the events cannot reach: ABANDONMENT

The five deletions (voting closed, cancelled, session deleted, round deleted,
account erased) all key off something *happening*. A session that is drawn,
shared and then simply **abandoned** — nobody closes it, the round stays, the
account stays — hits none of them. And since `openBallot` refuses only `done` and
`cancelled`, that link kept working **forever**.

Abandoned draws are ordinary here: the Start tab renders a ticket for one.

It also made `docs/legal/retention.md`'s "deleted when voting ends" **untrue** for
exactly that case, which is what turns this from tidying into a correctness fix —
a retention statement has to describe what actually happens.

So there is a max age (`VOTE_LINK_TTL_DAYS`, default 30 days), in **two** places
that must not be collapsed into one:

- **`openBallot` checks the age**, so the link stops working at the cutoff rather
  than whenever the sweep next runs. This is the control.
- **A 15-minute sweep** (`lib/scheduler.js`) deletes the rows. This is what makes
  the retention record true.

Both read the same cutoff, so the sweep can only ever delete rows the gate is
already refusing — deleting a row can never revoke access the gate would have
granted.

**Two things fail silently here.** A TTL of `0` or less would expire every link
the instant it was minted — silently disabling the feature through a config typo
— so `ttlDays()` falls back to the default rather than honouring it. And in
Postgres, `data->>'createdAt' < ?` answers NULL for a row missing the field, so
without the explicit `IS NULL` arm a malformed row would survive every sweep
forever while the JSON backend deleted it: the two backends disagreeing precisely
where a row can never be reached again (the `demoIpHash` shape,
`.claude/rules/per-ip-live-caps.md` §2).

**Test the sweep on the ROW, not the count.** The contract suite shares a dataset,
so "it deleted ≥1" is satisfied by deleting somebody else's row. And assert that a
*live* link survives — otherwise "delete everything" passes, which is the break
that actually happens.

## The token also had to be kept OUT OF THE LOGS

It rides in the path, and the path is a field the request logger records by
design — so the ordinary logger wrote a working ballot credential into every
line. That trap generalises past this feature and has its own file:
`.claude/rules/secrets-in-paths-reach-the-logs.md`.

## Smaller things that fail quietly

- **Mint idempotently.** The repo returns the existing row for a session that
  already has one, so a second tap on „Link teilen" hands out the URL already in
  the group chat instead of invalidating it and stranding everyone who opened it.
  Postgres re-reads on a `23505` rather than reporting a marker: the loser of a
  mint race wants the winner's token, which is the same answer the ordinary path
  gives.
- **The ballot is built field by field**, never by deleting keys off the session.
  `redactRoundVotes` already keeps an open session's ratings out of the *round*
  read; this is a second, unauthenticated way to read the same session, and a
  whitelist is what stops a future session field leaking by being forgotten. The
  spec asserts over the serialised payload for the same reason.
- **The write takes its round and session ids from the resolved LINK**, never from
  the request — the caller supplies only the token and the person they claim.
- **The log entry has no actor.** A link voter has no account, and
  `sessionLogLines` renders an actor-less `voted` as „Anna hat abgestimmt" — the
  honest reading, and why this needed no new event type. Inventing a placeholder
  actor would be the device claim
  `.claude/rules/per-device-session-voting.md` §5 forbids.
- **Member colours are resolved server-side.** `memberColor()` derives an unset
  colour from the member's index in the round's **full** member list, which the
  ballot deliberately does not carry — so a client-side derivation would need a
  fake round and would hand everyone the wrong swatch.
- **`sanitizePersonVotes` moved to `lib/session-votes.js`** so the public and
  in-app writes share one copy. A second copy is how a link voter's column would
  quietly acquire a guest `retire` flag the in-app one refuses (#458).

**Related:** `.claude/rules/per-device-session-voting.md` (the session this
shares, and why no route in that router is owner-only),
`.claude/rules/round-grant-resolver.md` (the other "resolve, then act as that
tenant" shape — there keyed on an account, here on a token),
`.claude/rules/break-the-code-on-purpose.md`,
`.claude/rules/shared-constants-across-the-stack.md`.
