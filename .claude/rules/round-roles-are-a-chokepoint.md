---
paths:
  - "lib/round-access.js"
  - "lib/routes/**"
  - "lib/tenant.js"
  - "public/js/round-roles.js"
  - "public/js/views-*.js"
---
# A round-level route's required role is stated in ONE table — and UNLISTED means REFUSED (#137)

Before #137 the permission model inside a shared round was **four hand-placed
`if (req.grant) → 403 not_owner` checks**, so a new round-level route was open to
every grantee unless somebody remembered to add a fifth. That default cost a real
escape: `POST …/games/move-to` resolved its `targetRoundId` through the re-scoped
repo, so a grantee could move a shared round's whole shelf into **any** round the
owner had. It shipped, ran in production, and was found later (#411).

## The model

Three levels. **`owner` is implicit** — the round's owner holds no grant at all,
so the value never appears in `round_grants.role`.

| Role | May |
|---|---|
| `owner` | everything |
| `coowner` | everything below, plus delete a session, delete a Chronik entry, delete a game, rename the round |
| `editor` | run sessions (start, vote, close, finish, cancel, share a vote link), manage the shelf, seats, tags and the design |

Four things stay **owner-only for every grantee role, co-owners included**, and
the split is deliberate: a co-owner is trusted with the round's *content*, never
with its *access control* or with where its data lives.

- `round.delete` — destroying the round and every session, rating and cover in it
- `round.shares.manage` — revoking someone else's access, or changing their role
  (co-owner-and-up here would be self-promotion in one hop)
- `member.link` — relinking a seat to an account; not about trust, it is what
  keeps `round_grants.memberId` in sync with the seat
  (`.claude/rules/member-seat-self-claim.md`)
- `games.moveOut` — #411's hole

## Where it lives, and why in two files

`public/js/round-roles.js` holds the ladder and the **capability** each guarded
action costs; `lib/round-access.js` holds the **route → capability** table and the
middleware, mounted on `/api/rounds/:rid` right after `resolveRoundGrant`.

The ladder is shared because the views hide what the server refuses — the eighth
entry in `.claude/rules/shared-constants-across-the-stack.md`. The **table** is
deliberately *not* shared: the client speaks in capabilities and never in paths,
so exporting it would ship a list with no reader.

## The three things that are load-bearing

**1. UNLISTED = REFUSED.** A mutating route the table does not name is refused for
a grantee. That is the whole point — the default for something nobody has
classified is closed, so a route added tomorrow 403s instead of silently
inheriting full access. `test/round-roles.test.js` asserts every mutating route
the routers actually register is in the table (by walking `router.stack`), so the
reminder arrives as a **red suite** rather than as a puzzling 403 in production.
The reverse direction is asserted too: an entry naming a route that no longer
exists reads as coverage while guarding nothing.

**Both directions are only as good as the router list they walk, and that list is
a HAND-COPY of `lib/app.js`.** `MOUNTS` in that spec names the sub-routers to
inspect, and `/recommendations` was missing from it from #682 until #782 — so for
two months both guards above reported full coverage while never having opened
that file. Nothing could go red: a router with no mutating route is
indistinguishable from a router nobody looked at. It cost nothing only by luck,
and the moment that router grew its first write the omission would have handed
every grantee an ungated 403 with no explanation. `MOUNTS` now has its own
completeness test against `lib/app.js`'s `app.use('/api/rounds/:rid/…')` lines —
**add a new sub-router there as well as in the app**, and note the assertion that
the scan itself found a plausible number of mounts, which is what stops a drifted
regex from making the check vacuous.

**GET is not gated**, on purpose. `resolveRoundGrant` has already bounded the
request to exactly the granted round and every role may read it, so an unlisted
GET leaks nothing — while gating reads would turn a typo'd path into a 403 for
the round's own **owner** instead of a 404.

**2. No grant ⇒ role `owner` ⇒ straight through.** That one line is what keeps
legacy accounts-off mode byte-for-byte unchanged: `req.userId` is never set there,
no grant is ever resolved, and every caller passes. Do not start consulting the
table before checking for a grant.

**3. The table is a FLOOR, not the whole answer.** Two handlers narrow further,
because their cost depends on the **request** rather than on the route — and both
read the same capability table rather than testing `req.grant` for truthiness, so
there is still one definition of who may do what:

- `DELETE …/shares/:userId` — any grantee may remove their **own** share
  (leaving); only `round.shares.manage` may remove someone else's.
- `PATCH …/members/:mid` — name and colour are an ordinary write; the `userId`
  link needs `member.link`.

"This route costs role X" belongs in the table; "this *request* costs role X" does
not, and forcing it in would need a condition nobody could read.

## The frontend trap: an owner's round carries NO role key

`roundCan(round, capability)` is the client's entry point, and the natural
one-liner is wrong:

```js
can(round.role, capability)          // WRONG — hides everything from the owner
```

A round payload carries `shared`/`role` **only for a grantee**
(`lib/routes/rounds.js`), so an owner's round has no `role`; `normalizeRole` reads
that `undefined` as the *lowest* role, and every guarded control vanishes from the
UI of the person who owns the round. Their absence is what means "you own this",
so the owner branch is spelled out. That fallback is deliberate in the other
direction — an unknown role from the database loses power rather than gaining it.

## What changed for existing data and existing behaviour

- **Live grants carry `'member'`**, a placeholder predating any role meaning. It
  reads as `editor` — exactly what such a grantee could already do — so no live
  share changed behaviour. No migration code (CLAUDE.md).
- **Renaming a round moved up**, and it is the one *reduction* in what a plain
  grantee may do. #562 had deliberately left it open ("acting within the round,
  like editing a member name"); the round's name is what identifies it on every
  other person's home screen, so it joined the destructive four (operator
  decision, 2026-08-13). `test/round-grants-access.test.js` pins both halves.

**Related:** `.claude/rules/round-grant-resolver.md` (the re-scope this sits on
top of, and why RLS stays un-widened),
`.claude/rules/shared-constants-across-the-stack.md` (why the ladder is one file),
`.claude/rules/member-seat-self-claim.md` (the seat-link matrix),
`.claude/rules/per-device-session-voting.md` §3 (why running a session stays an
ordinary write).
