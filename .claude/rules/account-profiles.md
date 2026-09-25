---
paths:
  - "lib/routes/profile.js"
  - "lib/routes/friends.js"
  - "public/js/views-profile.js"
  - "public/js/views-friends.js"
  - "public/js/feed-view.js"
  - "test/profile.test.js"
---
# The account profile (#558) sits AHEAD of the tenant gate — so it re-checks suspension itself

`GET /api/account/profile/:username` renders `/u/:username`. It is mounted on
`/api/account/profile` beside invitations and friends, i.e. **before** the `/api`
tenant gate — correctly, because the caller is usually a stranger to the
subject's tenant. Three consequences of that placement fail silently.

**„A profile crosses no tenant" stopped being true in #1089**: it now carries
`stats`, an aggregate over every round the SUBJECT has a seat in, read via
`repo.forTenant(...)` on the module-level repo (`lib/user-stats.js`) since
`req.repo` does not exist ahead of the gate. The placement is still right — the
CALLER is never scoped into those tenants — and §4 keeps the disclosure honest.

## 1. Suspension is enforced on the `/api` gate, which this route never reaches

`lib/tenant.js` refuses a **suspended** account (`user.disabled`) with
`403 account_disabled` — and it does so in `withTenant`, mounted on `/api`. Every
`/api/account/*` router sits *ahead* of that gate, so nothing there inherits the
check.

That is fine for the routes where the suspended account is the **caller** (they
cannot get an access token past login anyway). It is **not** fine when the
suspended account is the **subject**: a suspended account whose profile stayed
browsable is a hole in the moderation surface
(`.claude/rules/admin-moderation-surface.md`), and nothing about the route's own
code hints that the guard it needs lives two mounts away.

So `lib/routes/profile.js` checks `target.disabled` itself, and answers the
**identical** `404 user_not_found` as an unknown handle:

```js
if (!target || target.disabled) return res.status(404).json({ error: 'user_not_found' });
```

Identical, not a distinct code — a separate `account_suspended` would tell any
logged-in stranger that a named account exists *and* has been moderated, which is
a disclosure about a moderation action to someone with no business knowing.
`test/profile.test.js` pins it with `assert.deepEqual(suspended.body,
unknown.body)` rather than two status checks, so a future distinct code fails.

**A username, unlike an e-mail, is deliberately NOT anti-enumerated** — a
username is public by design (#320), which is why the unknown case is a plain
404 here and in `POST /api/account/friends`. Don't "harden" it into `{ ok: true }`
by analogy with the e-mail rules in `.claude/rules/user-accounts.md`; that would
break the one thing the screen exists for (confirming you have the right person
before sending a request).

## 2. The friends-only feed must keep `/friends/feed`'s acceptedAt cutoff

The profile re-implements the feed read for a **single** account, and the
tempting simplification — read that account's events and return them — silently
drops the cutoff that makes the feed privacy-preserving: a brand-new friend would
see the friend's **entire prior history** the moment the request was accepted.

`feedFor(uid, since)` keeps the same `String(e.at) >= String(since)` compare, and
`since` is the friendship's `acceptedAt`, read from the caller's own row. The
events are also only assembled inside the `accepted` branch, so a stranger's
profile carries no `events` key at all rather than an empty array — the two are
easy to conflate and only the first is provably right.

Verified by breaking both on purpose
(`.claude/rules/break-the-code-on-purpose.md`): removing the cutoff reddens the
feed test, and hoisting the `feedFor` call above the friendship branch reddens
**two**.

## 2b. The SELF feed has no cutoff, and the demo may read its own profile

Both are #1089 and both look like §2 being relaxed. They are not. The cutoff
dates a disclosure from the moment consent was given; your own profile discloses
nothing to anybody, so `feedFor(target.id, null)` is right and a cutoff would
hide your own history from you.

The demo refusal (#877) likewise applies only to a profile that is **not** the
caller's own. **The ordering is the load-bearing part, and the natural spelling
is wrong:** the "is this me?" test compares the requested handle against the
CALLER'S OWN username, *before* the target lookup. Keying it off `target.id ===
me` — written that way here first — reintroduces a username oracle for demos,
since an unknown handle then 404s where a real one 403s. `test/profile.test.js`
pins the two answers as `deepEqual`.

## 3. The four friendship states are derived from the CALLER's rows

`incoming` vs `outgoing` is not a property of the friendship — it is a property
of *who is asking*. Both come from one `listFriendships(me)` read and the same
`otherParty` definition `lib/routes/friends.js` uses, so the two surfaces cannot
drift on what "incoming" means. The test asserts the same row reads `outgoing`
for the sender and `incoming` for the addressee **and** that both report the same
`friendshipId`, which is what makes it a statement about one row rather than two
coincidences.

## 4. `stats` is absent, never empty — and the payload is safe BY CONSTRUCTION

The play record (#1089) follows `events`' shape: a stranger, a pending request
and a friend whose `statsVisible` is off get **no `stats` key at all** — `null`
would be indistinguishable from an account with nothing to show.

- **The filtering lives in `lib/user-stats.js`, not here.** It returns numbers,
  game titles and cover paths only — never a round name, round id, member name or
  tenant id — so the friend branch cannot leak by forgetting a field. A
  route-level redaction list is the version that rots.
- **`target.statsVisible !== false`**, so an account predating the field reads as
  VISIBLE, matching `meProjection`; the legacy shape needs its own spec
  (`.claude/rules/defaulted-account-fields-need-a-legacy-shape-spec.md`).
- The SUBJECT always sees their own numbers. The toggle governs what friends see,
  and hiding a figure from the person it is about would make the setting
  unverifiable from the screen offering it.
- **`plays` (#1147, `lib/user-plays.js`) is SELF-ONLY, whatever `statsVisible`
  says** — a per-session list with dates and the subject's own ratings, which
  never went through #1089's friend-disclosure pass. Setting it in the friend
  branch "because `stats` is there" is the natural edit and the wrong one; the
  spec pins a `statsVisible: true` friend getting `stats` and no `plays`.

## The row link: a row with buttons can never become the anchor

The Freundeskreis rows hold action buttons, and **a `<button>` inside an `<a>` is
invalid HTML** — the Chronik `.tl-act` case in
`.claude/rules/in-app-nav-links.md` §3. So only the avatar+name half becomes a
real `<a href>` (`friendRowMain`), and the row **keeps `ds-row--static`**: it is
not itself a click target and must not promise one.

This is worth stating because the issue specified the opposite (drop the
modifier, add a row-level click handler with a `closest()` bail-out), and
`.claude/rules/ds-row-is-a-click-target.md` predicted the same. Both were wrong,
and the simpler shape is strictly better: **with no row-level handler there is no
modified-click double-navigation to guard against at all.** The bail-out exists
in the Chronik only because that row does have its own handler.

An account with no resolvable username (mid-erasure) renders a `<div>`, not an
anchor — an `<a>` with no usable target is not a link (not focusable, no
affordance), the rule `in-app-nav-links.md` states for `statCard`'s `linkMid`.

## Verifying a change here

Two real accounts are awkward to make in a dev instance (registration needs a
mailed link, and a demo cannot befriend anyone), so **stub `window.accountApi`**
and drive `showProfile` (`public/js/views-profile.js` since #1089, split out of
views-friends.js when the screen gained real content) through the five states —
it is a top-level `function`
declaration and therefore a real `window` property
(`.claude/rules/in-app-nav-links.md` §1). `window.isDemoAccount` is stubbable the
same way, which is the only practical way to see the non-demo "send request"
button from inside a demo.

The live route itself is reachable without any of that: mint a demo and read
`/profile/<own handle>` (self), `/profile/<UPPERCASE>` (case-insensitivity) and
`/profile/nobody-xyz` (the 404).

For the modified-click assertion use the `document`-level `defaultPrevented`
sink, never `dispatchEvent(new MouseEvent('click', { metaKey: true }))` — Chrome
honours the modifier on the *event* but ignores it for the synthetic click's
default action and performs a same-tab navigation, tearing the probe down. Probe
every modified click **before** any plain one, since a plain one re-renders
`#app` and detaches everything you are holding.

**Related:** `.claude/rules/ds-row-is-a-click-target.md` (the affordance the rows
keep opting out of, and the prediction this corrects),
`.claude/rules/in-app-nav-links.md` (the `navLink` contract and the probing
traps), `.claude/rules/user-accounts.md` (why the e-mail is anti-enumerated and
the username is not), `.claude/rules/guest-demo-accounts.md` (the demo branch),
`.claude/rules/keep-legal-docs-current.md` (policy §5 + `vvt.md` row 2 grew a
paragraph for the registration date, with a `PRIVACY_REVISION` bump — and
deliberately **not** a `TERMS_REVISION` one, which would have fired the terms
banner).
