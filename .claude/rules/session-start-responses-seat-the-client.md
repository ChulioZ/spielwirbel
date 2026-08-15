---
paths:
  - "lib/me-projection.js"
  - "lib/routes/account.js"
  - "lib/routes/passkeys.js"
  - "public/js/account.js"
---
# A response that STARTS a session seats `accountUser` for its whole lifetime — send the full projection

`public/js/account.js` seats its module-level `accountUser` straight from
whatever started the session (`accountUser = data.user || null`), and refreshes
it from `GET /api/account/me` only on the **next cold load**. So a field the
session-start response omits is not merely absent from one payload — it reads
`undefined` for every screen the user visits until they reload.

Three endpoints have that power:

| Endpoint | File |
|---|---|
| `POST /api/account/login` | `lib/routes/account.js` |
| `POST /api/account/passkeys/login` | `lib/routes/passkeys.js` |
| `POST /api/account/demo` | `lib/routes/account.js` |

All three used to hand-build `{ id, email, username, ...termsAcceptanceOf(user) }`.

## What that shipped

The „Was ist neu" dot (#741) **re-lit on every login** for accounts that had
already read the screen. The stored `lastSeenNewsRevision` was correct the whole
time; `hasUnseenNews()` simply compared `undefined` against the newest revision.
Opening `/neu` cleared it, so did any full reload — which made it read as a
flaky client rather than as a missing response field.

Three more fields were sitting behind the same trap unnoticed — `bggUsername`,
`notifyRoundInvitations`/`notifyFriendRequests`, `bgStats`. They misbehaved
nowhere only because nothing happened to read them off `accountUser` before the
next `/me`. The bug was armed for whichever field someone read first.

Note the direction of the history: #521 hit this exact wall and solved it by
adding the terms fields **to all three payloads by hand**, with a comment saying
why. #741 shipped after, did not know to do the same, and nothing said so. A fix
that depends on the next person remembering a list is the bug, one release later.

## The rule

**A route never assembles a user payload of its own.** It answers
`meProjection(user)` from `lib/me-projection.js` — the single description of what
a client may see about an account — and a new field is added there once.

That also makes the security half structural rather than remembered: the stored
record holds password hashes, refresh tokens and the verification/reset
challenges, so a hand-built payload is one careless line away from leaking one.
Widening these three responses to the full projection **narrows** that risk.

Two consequences worth stating, because both look like regressions:

- **`POST /demo` no longer sets `demo: true` by hand.** The projection derives
  `demo`/`demoExpiresAt` from the stored record, which `createDemoAccount`
  writes. Restating it in the route would let the banner read a flag that
  disagrees with what `/me` reports on the very next load.
- **The passkey route projects `{ ...user, identities }`** — the same object it
  mints the session from, rather than the pre-write `user` whose identities are
  stale by that point. That makes **no difference to the output today**, since the
  projection exposes nothing identity-derived; it is there so it stays correct if
  it ever does (a "this account has a passkey" field is the obvious candidate).
  Don't read it as load-bearing, and don't "simplify" it either — the cost is one
  spread and the alternative is a payload built from a record the route has
  already superseded.

## The test that keeps it true

Each of the three responses is asserted to carry **exactly** `/me`'s keys, with
the expected list **derived from a live `/me` call** rather than restated:

```js
assert.deepEqual(Object.keys(login.body.user).sort(), Object.keys(me.body).sort());
```

A hand-copied key list in the test would be the same drift one layer further out
(`.claude/rules/shared-constants-across-the-stack.md`). The specs live in
`test/account.test.js` (login, demo) and `test/passkeys.test.js` (passkey login);
`test/news-screen.test.js` pins the client end — a payload with the stamp absent
dots a provably caught-up account, which is *why* the parity matters.

**A fourth session-start endpoint needs its own parity spec.** Nothing walks the
routers to find one, so this is a discipline, not a check.

**Related:** `.claude/rules/shared-constants-across-the-stack.md` (the same
"two descriptions of one thing, and the forgotten copy rots" shape, for values
crossing the client/server boundary),
`.claude/rules/defaulted-account-fields-need-a-legacy-shape-spec.md` (what a new
field in the projection owes an account that predates it),
`.claude/rules/user-accounts.md`.
