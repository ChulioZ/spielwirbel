---
paths:
  - "lib/demo.js"
  - "lib/repo/**"
  - "public/js/demo-marker.js"
  - "test/demo.test.js"
---
# A per-IP LIVE-COUNT cap (#502): three things that fail quietly

`MAX_LIVE_DEMOS_PER_IP` bounds how many guest demos one source may **hold at
once** — distinct from `DEMO_RATE_LIMIT_MAX`, which bounds how fast one source
may **mint**. The split is the same one
`.claude/rules/bounding-bulk-registration-mail.md` draws, with one extra twist:
here the rate limiter genuinely was not enough, because leaving a demo freed no
slot. Start → leave → start again stranded them one at a time, so a single
visitor with no scripting and no IP rotation could empty a 100-slot pool in a few
hours and leave the landing CTA telling real visitors the demo is busy.

## 1. A new default ceiling silently breaks every existing spec in the file

`test/demo.test.js` mints from **one** supertest source address, so the default
of 3 refused every mint **from the twelfth test onward**. The refusal is a polite
`503`, so the symptom was `res.body.user` being `undefined` in a dozen specs that
have nothing to do with the cap — `TypeError: Cannot read properties of undefined
(reading 'id')`, pointing at seeding, localisation and identity tests. Nothing
named the cap anywhere.

The file already raises `AUTH_RATE_LIMIT_MAX` and `RATE_LIMIT_MAX` to 1e6 at the
top for exactly this reason; `MAX_LIVE_DEMOS_PER_IP` now joins them, and the two
specs that exercise the cap set their own ceiling.

**Sizing a cap spec against the shared loopback bucket is not enough**, either —
that is the "size relative to what is already live" trap in
`.claude/rules/guest-demo-accounts.md`, and in its per-IP form it bites harder:
the count depends on every *other* spec in the file. So each cap spec sets
`TRUST_PROXY: '1'` and drives its own `X-Forwarded-For` address (TEST-NET
`198.51.100.x`), which makes it independent of file order outright rather than
arithmetically.

Note the corollary for **production**: the cap is only per-visitor if `req.ip` is
the visitor. With a wrong `TRUST_PROXY` hop count it becomes one bucket shared by
everyone and the demo refuses the fourth visitor overall — see
`.claude/rules/trust-proxy-is-a-hop-count.md`.

## 2. `null === null` matches; `= NULL` never does — the backends disagree by default

An unattributable mint stores `demoIpHash: null`. Counting on a null hash must
answer **0**, or every such row collapses into one shared bucket. The two
backends get there from opposite directions:

| Backend | Expression | Answer for a null needle |
|---|---|---|
| JSON | `u.demoIpHash === ipHash` | **matches every null row** |
| Postgres | `data->>'demoIpHash' = ?` | **matches nothing** (SQL three-valued logic) |

So the guard `if (!ipHash) return 0;` is *load-bearing* in `json.js` and
*belt-and-braces* in `postgres.js`. Both keep it, so the contract holds by
construction rather than by each backend's accidental semantics.

**The verification consequence is the part worth remembering:** removing the
guard reddens the contract suite on JSON and leaves Postgres **fully green**. A
green Postgres run is therefore not evidence that line does anything — measured,
104/104 passing with it deleted. Don't delete it on that basis.

## 3. The two liveness predicates must stay exact complements

The cap counts *live* demos, so ending or purging one has to free the IP's slot
immediately — otherwise „Demo beenden" would punish the people doing the right
thing. `countLiveDemoUsersByIp` reuses the same `liveDemo` predicate as
`countLiveDemoUsers`, which is what keeps that true without a second definition
drifting.

## The marker that makes the cap survivable

A cap alone would be hostile: a visitor who left and came back would be refused
by their own abandoned demo. So the browser keeps a **resume marker**
(`public/js/demo-marker.js`, a third localStorage key holding the demo's refresh
token) and re-enters its own demo instead of minting a second one.

**Its one fragile rule:** `POST /refresh` *spends* the presented token, so the
marker must follow every rotation or it goes stale after the first silent refresh
— and a resume then fails and silently mints a second demo, i.e. the exact bug
the marker exists to prevent. It fails invisibly: the demo works, the visitor
just gets a fresh empty one next time.

The rule is **token identity, not "am I a demo"**:

```js
demoMarkerFollowsRotation(demoToken, currentRefreshToken)  // all three must line up
```

Both operands must be non-empty (`null === null` again), and that is not
theoretical: a visitor who abandons a demo via the register CTA and then signs up
for real still holds the marker, and their **real** account's refreshes must not
overwrite it. The mint and the resume therefore write the marker *explicitly* —
neither has a previous token to match against.

Consequently `clearTokens()` must **not** touch the marker (that is what keeps an
abandoned demo resumable), while „Demo beenden" clears it along with the account.

## Why resumption is browser-local and never by IP

Returning a demo by IP would drop two strangers behind the same CGNAT, corporate
or mobile NAT into **one account**, each seeing the names and games the other
typed. The address is used only as a *bound*, never as an identity — and it is
stored only as an HMAC keyed with `SESSION_SECRET`, so it cannot be reversed by
hashing the IPv4 space. It lives and dies with the demo row, which is its whole
retention story (policy §5 + `vvt.md` row 17).

Tab-close detection was rejected for the same class of reason: `pagehide` +
`sendBeacon` is unreliable on mobile Safari **and** indistinguishable from a
reload, so erasing there would delete a demo out from under someone who just
refreshed.

**Related:** `.claude/rules/guest-demo-accounts.md` (the demo this bounds, and
the test traps it already documents),
`.claude/rules/bounding-bulk-registration-mail.md` (the resource-vs-mechanism
split), `.claude/rules/trust-proxy-is-a-hop-count.md` (what makes `req.ip` real),
`.claude/rules/erased-account-token-fallback.md` (why ending mid-session needs no
client work), `.claude/rules/postgres-backend.md` (absent-key parity, which
`demoIpHash` also has to keep).
