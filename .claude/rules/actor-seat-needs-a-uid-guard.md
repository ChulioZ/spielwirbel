# `actorSeat(round, undefined)` matches the FIRST UNLINKED seat — attribution needs a uid guard

Activity entries carry an optional `actorMemberId` ("· von Anna" in the Chronik),
resolved from the acting account to its seat in this round. The helper is a
one-liner, duplicated per route, and the obvious version is wrong:

```js
const actorSeat = (round, uid) => (round.members.find((m) => m.userId === uid) || {}).id;   // WRONG
```

**An unclaimed seat has no `userId` key at all**, so `m.userId` evaluates to
`undefined` — and when `uid` is *also* `undefined`, `undefined === undefined` is
true and `.find()` returns **the first unlinked member**. The action is then
attributed to whoever happens to sit in that chair.

`uid` is undefined on every ordinary request in **accounts-off mode**
(`req.userId` is set only in accounts mode, `.claude/rules/accounts-mode-gate.md`),
which is exactly the mode where *no* seat should ever be named.

## Measured

Against a fresh accounts-off instance with members `['Alice', 'Bob']`, adding one
game through `POST /api/rounds/:rid/games`:

```json
{"type":"game_added","title":"Catan","actorMemberId":"110ad42927fab38a"}
                                      ^ === members[0].id, i.e. Alice
```

So on a self-hosted, password-gated instance every shelf change read
**"· von <first member>"** in the Chronik, naming someone who did nothing — all
four of `lib/routes/games.js`'s activities (`game_added`, `game_retired`,
`game_completed`, `game_deleted`).

**Fixed in #563.** There is now exactly one definition, `lib/actor-seat.js`,
required by both `lib/routes/games.js` and `lib/routes/members.js`:

```js
function actorSeat(round, uid) {
  if (!uid) return undefined;                       // <- the whole fix
  const seat = (round.members || []).find((m) => m.userId === uid);
  return seat ? seat.id : undefined;
}
```

It is shared rather than copied deliberately: a per-route copy is precisely how
the two drifted, and the drift is invisible (`.claude/rules/shared-constants-across-the-stack.md`).
**`seatOf` in `lib/routes/invitations.js` is a different helper and is safe as it
stands** — it returns the member rather than an id, and both call sites are
either behind `accounts.requireUser` (so `req.userId` is guaranteed) or pass a
resolved `invitee.id`. Don't fold it in; do keep the precondition in mind if a
third call site appears.

## Why no test caught it

Both repo backends take `actorMemberId` as an explicit **parameter**, so the
contract suite passes a real seat id and exercises the write correctly; the
defect lives entirely in the *route's* resolution of that argument. And the
absent-vs-present distinction is invisible unless asserted directly — the entry
still serialises fine, the Chronik still renders, and a plausible name appears.

The assertion that catches it is `'actorMemberId' in entry` on an accounts-off
write — **not** a truthiness or null check, since the bug produces a *real* member
id, so `assert.ok(!entry.actorMemberId)` passes against it. Pinned in
`test/games.test.js` (all four activities) and `test/members.test.js`; removing
the guard from `lib/actor-seat.js` reddens both.

**Pair such a test with an anti-vacuous assertion on the feed's length.** The
games spec asserts the feed actually holds the add + retire + complete, and that
is what caught its own first draft: `addGame` in `test/games.test.js` resolves to
the supertest **response**, not the game, so `game.id` was `undefined`, both
follow-up calls 404'd, and the attribution assertion passed against a feed of one
entry. An "expected N, got 1" failure is the only signal you get.

**When adding a route that logs an attributed activity**, either guard the uid or
reuse the guarded helper. `addActivity` omits the key when the value is falsy, so
the only job is to make sure the value really is falsy when nobody is acting.

**Related:** `.claude/rules/member-seat-self-claim.md` (why a seat's `userId` is
absent rather than null, which is the precondition for this trap),
`.claude/rules/postgres-backend.md` (absent-key parity generally),
`.claude/rules/product-event-logging.md` (the separate `trackEvent` allowlist,
which carries no actor at all).
