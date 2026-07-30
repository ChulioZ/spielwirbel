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

So on a self-hosted, password-gated instance every shelf change reads
**"· von <first member>"** in the Chronik, naming someone who did nothing. That is
live in `routes/games.js` today (found while building #563, filed separately) —
`routes/members.js` carries the guarded version:

```js
const actorSeat = (round, uid) => (uid ? round.members.find((m) => m.userId === uid) || {} : {}).id;
```

## Why no test caught it

Both repo backends take `actorMemberId` as an explicit **parameter**, so the
contract suite passes a real seat id and exercises the write correctly; the
defect lives entirely in the *route's* resolution of that argument. And the
absent-vs-present distinction is invisible unless asserted directly — the entry
still serialises fine, the Chronik still renders, and a plausible name appears.

The assertion that catches it is `assert.equal('actorMemberId' in entry, false)`
on an accounts-off write — not a truthiness check, since the bug produces a
*real* id rather than a null. Verified by removing the guard on purpose and
watching exactly that assertion redden.

**When adding a route that logs an attributed activity**, either guard the uid or
reuse the guarded helper. `addActivity` omits the key when the value is falsy, so
the only job is to make sure the value really is falsy when nobody is acting.

**Related:** `.claude/rules/member-seat-self-claim.md` (why a seat's `userId` is
absent rather than null, which is the precondition for this trap),
`.claude/rules/postgres-backend.md` (absent-key parity generally),
`.claude/rules/product-event-logging.md` (the separate `trackEvent` allowlist,
which carries no actor at all).
