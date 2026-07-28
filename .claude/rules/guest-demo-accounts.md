# The guest demo (#427): five things that fail silently

`POST /api/account/demo` mints a throwaway, pre-seeded account so a visitor can
try the app without registering. `lib/demo.js` (logic) + `lib/demo-seed.js`
(content) + `lib/scheduler.js` (the purge job). Each item below produced no error
and no failing test in the obvious implementation.

## 1. The `demo-` TENANT PREFIX is what excludes demo traffic from the counters

Demo tenants must not inflate `round_created` / `session_created` — those numbers
exist to answer "is anyone actually using this", and every tourist would corrupt
them. The obvious implementation passes a flag from each call site into
`trackEvent`. Two reasons that is the wrong shape here:

- **A call site can forget.** There are five today and the next one is written by
  someone who has never heard of demo mode.
- **In-memory state classifies inconsistently.** Production runs **two replicas**
  (#215), so a registry of demo tenant ids built at mint time is only known to the
  replica that minted it; the same tenant would be excluded or not depending on
  which replica answered the request.

So the classification rides on the tenant id itself — `demo-<16 hex>` versus a
real tenant's bare 16 hex, which cannot collide — and `trackEvent` skips it in one
line. No call site knows demo mode exists.

**The literal is duplicated** in `lib/observability.js` rather than required from
`lib/demo.js`, because demo.js pulls in the repo and observability is required by
almost everything (a cycle). `test/demo.test.js` asserts the two strings are equal
— that assertion is the entire licence for the copy, exactly as
`.claude/rules/shared-constants-across-the-stack.md` allows for `TAG_ICONS`.

## 2. A demo account NEEDS a unique synthetic e-mail — `null === null`

`createUser` refuses a duplicate address, and the JSON backend compares with
`u.email === fields.email`. Leaving the address null therefore makes the **second
demo ever minted** answer `'email_taken'` — the first one works, so this passes
every manual smoke test and breaks in production on visitor number two. (Postgres
would not catch it either, in the opposite direction: NULLs never conflict in a
unique index, so the two backends would silently disagree.)

Each demo gets `demo-<8 hex>@demo.invalid`. `.invalid` is reserved by RFC 2606, so
the address can never route anywhere.

Likewise `identities: []` — with no password identity the login route can never
authenticate a demo account, so the minted tokens are the only way in. That is
what makes it genuinely disposable rather than an unadvertised permanent account.

## 3. The seeded games' PLAYER RANGES must fit the seeded seat count

The draw pool filters on `minPlayers`/`maxPlayers` (`routes/sessions.js`). The
demo seats four — the visitor's own owner seat (#421) plus three — so a shelf of
games capping at 2 makes the visitor's **first action** answer *"No matching games
in this round"*. On the one screen the demo exists to demonstrate, that reads as
the app being broken.

This bit during development: God of War Ragnarök resolved to `maxPlayers: 1` and
was dropped for that reason alone. `test/demo.test.js` pins the arithmetic over
the declared numbers rather than asserting "a game exists".

Note the owner seat means `round.members.length` is **1 + the typed names** — the
fixture trap `.claude/rules/member-seat-self-claim.md` describes, here in the seed.

## 4. Cover URLs must be RESOLVED, never written by hand

Seeded covers are hotlinks to the providers' own CDNs, exactly like a real user's
linked game (`.claude/rules/provider-cover-hotlinking.md`) — the app never copies
cover bytes, and a marketing-grade page is the *worst* place to start.
`scripts/resolve-demo-covers.js` regenerates the block:

```bash
node --env-file-if-exists=.env scripts/resolve-demo-covers.js
```

Three things learned building it:

- **BGG cannot be resolved without `BGG_API_TOKEN`.** The XML API answers **401**,
  and `boardgamegeek.com` answers **403** to a direct page read, so there is no
  back door. Their transform paths are signed as well
  (`.claude/rules/provider-cover-sizing.md`), so a hand-edited URL is guaranteed
  to render nothing. Run the script through Node's `--env-file-if-exists`, which
  loads the token without anyone reading it.
- **PS Store `detail()` returns `imageUrl: null`** for many products while
  `search()` returns a perfectly good thumbnail on the same allowlisted host — so
  the resolver takes the cover from a search hit **matched back to the exact
  product id**. Never the query's first result: PS Store search is fuzzy enough
  that "Gran Turismo 7" resolves to *Grandia*, and "It Takes Two" to its
  friend-pass DLC.
- **A PS thumbnail is a 3840×2160 master** (8.3 MP, ~31 MB decoded). That is fine
  and is what a real user's game stores, because `coverUrl()` sizes it at render
  time — measured 370×208 / 0.08 MP. Verify that rather than assuming it, or a
  nine-card demo shelf becomes the app's heaviest screen.

A rotted cover degrades to the app's own gradient, so it is cosmetic and never
urgent. Do **not** "fix" one by saving the image into `public/img`.

## 5. The `/demo` deep link must render something when it FAILS

`bootApp()` handles `/demo` as a side effect and returns, so on that path
**nothing has been drawn yet**. The natural failure handling — `toast(...)` and
return — therefore leaves a completely **blank page** whenever the demo is
refused, which is exactly what a launch-post link hitting the `MAX_LIVE_DEMOS`
ceiling does. `startDemo()`'s failure path renders the landing when it was not
invoked from a button.

The tell that separates the two entry points is the `busy` argument: a click from
the landing page passes its button (that page is already rendered, a toast
suffices), the deep link passes nothing.

## Smaller things worth keeping

- **The scheduler starts in `server.js`, never `lib/app.js`.** The suite imports
  `createApp()` dozens of times; a timer there keeps `node --test` alive after the
  last assertion — a hung CI run with no failing test pointing at it. Jobs are
  exported and directly runnable (`runJob(name)`) so a test never waits on a timer.
- **The purge is idempotent**, which is what makes two replicas both running it
  safe rather than merely tolerated: it re-reads what is expired each tick, and
  `eraseAccount` on an already-erased id answers null.
- **A demo row with no `demoExpiresAt` reads as EXPIRED, never live.** Counted as
  live it would hold a capacity slot forever; never listed it would leak rows. The
  two repo predicates are exact complements so a row can never be both.
- **The cap bounds the RESOURCE, the limiter bounds one caller** — the same split
  as `.claude/rules/bounding-bulk-registration-mail.md`. The per-IP limiter is not
  the defence: rotating IPs walk around it, and `MAX_LIVE_DEMOS` is what actually
  holds. The refusal is **503 `demo_unavailable`**, deliberately not the limiter's
  429: the client shows a different message for capacity than for rate limiting.

  **#502 added a THIRD bound between those two** — `MAX_LIVE_DEMOS_PER_IP`
  (default 3), a per-source *live count* rather than a rate. It exists because the
  reasoning above had a hole: an honest visitor needed no IP rotation at all to
  drain the pool, since leaving a demo froze its slot for the full TTL and a
  second click minted another. Ending a demo (`DELETE /api/account/demo`) and
  browser-local resume landed with it. All three share the one 503, so a test that
  drives one must put the other two out of reach or it can pass vacuously — see
  `.claude/rules/per-ip-live-caps.md`, which also covers why adding that default
  broke a dozen unrelated specs in `test/demo.test.js`.
- **Demo accounts cannot send friend requests or round invitations**
  (`demo.refuseDemoAccount` on those two POSTs). "We didn't build a UI for it" is
  not a control — the endpoints are reachable by hand with the demo's own token,
  and a throwaway account that is purged within the day is an unattributable spam
  channel into a real user's inbox.
- **A demo has no password identity, so the Konto screen must not offer the
  password form.** `change-password` answers `invalid_credentials` whatever is
  typed — i.e. *"your current password is wrong"* about a password that never
  existed, which a visitor cannot possibly act on. `showAccount()` branches on
  `me.demo` and shows an explanation instead. The same screen shows `—` rather
  than the synthetic `…@demo.invalid` address, which would otherwise read as an
  e-mail the visitor never gave. Any future account surface needs the same check:
  the demo is a real account row with two things deliberately missing.
- **Tests must build their own app.** `test/helpers.js` runs accounts-OFF, so a
  demo spec written against the shared app asserts something simply false rather
  than failing usefully — the same trap
  `.claude/rules/liveness-vs-readiness-probes.md` notes for the probes. And size
  cap/count assertions **relative to what is already live**: the file shares one
  `DATA_DIR`, so a hardcoded ceiling passes alone and fails in file order.

**Related:** `.claude/rules/provider-cover-hotlinking.md` (why the covers are
links, and why the landing *screenshots* may not contain any),
`.claude/rules/provider-cover-sizing.md` (the render-time sizing this depends on),
`.claude/rules/erased-account-token-fallback.md` (why purging mid-session needs no
client work), `.claude/rules/member-seat-self-claim.md` (the owner seat the seed
creates), `.claude/rules/hidden-attribute-vs-display-rule.md` (the demo CTA and
banner both ship `hidden` and need the paired `[hidden]` rule).
