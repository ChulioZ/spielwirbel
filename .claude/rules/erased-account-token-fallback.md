---
paths:
  - "lib/tenant.js"
  - "lib/accounts.js"
  - "lib/upload-access.js"
  - "lib/routes/admin/**"
  - "test/admin.test.js"
---
# A valid token for a DELETED user must 401 — never fall back to 'default'

`lib/tenant.js` resolves a request's tenant. Its fallback chain is deliberate and
mostly right — no token / an invalid token → the `'default'` tenant, so the
legacy shared-password mode keeps working unchanged. But the original code
collapsed one more case into that same fallback:

```js
const user = await repo.getUserById(uid);
return (user && user.tenantId) || DEFAULT_TENANT;   // WRONG for a missing user
```

**Access tokens are stateless HS256 JWTs with a 15-minute TTL** (`lib/accounts.js`),
and `requireApiAccount` checks only the *signature* — it never loads the row. So a
token minted before an account's row disappears stays valid afterwards, and that
line handed it **the `'default'` tenant**: on production, the legacy group's
entire real dataset, readable *and writable*, for up to 15 minutes.

Before #273 this was close to unreachable (a user row only vanished if someone
hand-deleted it in `psql`). **Operator erasure made it a routine code path**, which
is how it surfaced — the erasure route test asserted the token was refused and got
a `200` back instead.

**Rule:** distinguish *"this request names no account"* from *"this token names an
account that does not exist"*.

- No/invalid Bearer token → `'default'` (the legacy fallback — keep it).
- A token that verifies but whose uid resolves to **no user row** → refuse.
  `lib/tenant.js` returns an `ERASED` marker and the middleware answers
  **`401 auth_required`**.

`auth_required` specifically, not a new code: `core.js`'s `api()` already treats
it as session-lost — one silent `refreshAccessToken()`, which fails because the
refresh tokens died with the row, then a bounce to login. Correct behaviour for a
deleted account with zero client-side changes.

The same reasoning is why suspension is enforced here rather than only at login
(`.claude/rules/admin-moderation-surface.md`): anything that revokes an account
has to bite at the *tenant resolution* step, because that is the only place the
user row is loaded on an ordinary `/api` request. A guard placed at login alone is
always up to one access-token TTL late.

**Guarded by** `test/admin.test.js` → *"erasure removes the account, its rounds and
its cover objects"*, which asserts the erased account's still-valid token gets a
401 and no rounds. If that assertion ever flips to a 200, this bug is back.

`/uploads` makes the same split, one step later. `requireUploadAccount` still
checks only the token's signature, so a gone account's token passes the gate. But
since #955 the ownership check behind it (`requireUploadOwner`,
`lib/upload-access.js`) resolves the caller's tenant with `callerTenantId`, which
returns `null` for a missing row — never `'default'`. So an erased account's token
reads no game cover. Until it expires it can still read profile pictures, which
any signed-in account may read by design (#558/#841).
