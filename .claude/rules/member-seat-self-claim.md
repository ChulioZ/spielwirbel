# `member.userId` is SELF-claim only, and the creator's seat is created, not migrated (#421)

`member.userId` links a round seat to an account. It is **attribution, not
access** — access comes from `round_grants`
(`.claude/rules/round-grant-resolver.md`), and claiming a seat must never create
a grant. That split is what makes the following safe *and* what made the
pre-#421 route quietly dangerous.

## 1. The route used to take any user's id from anyone with round access

`PATCH /api/rounds/:rid/members/:mid` accepted `{ userId: <any existing user> }`
with no "is that you" check. Two consequences, neither of which throws:

- It would seat a **stranger's** account on a round they were never invited to.
- Worse, an owner could `PATCH { userId: null }` a **grantee's** seat.
  `resolveRoundGrant` matches on `roundId` + `userId` and **never consults
  `grant.memberId`**, so the grant survives: the invitee keeps full access with
  no chair, their old seat reappears in the invite dialog's free-seat list, and
  it can be handed to someone else.

So the guard is about *whose* seat this is, never about the value being
well-formed. The matrix, in `routes/members.js`:

| Request | Answer |
|---|---|
| caller reached the round via a grant (`req.grant`) | **403 `not_owner`** |
| no `req.userId` (legacy / accounts off) | **403 `not_self`** |
| `userId: null` on a seat that isn't yours | **403 `not_self`** |
| `userId: <not the caller>` (including an unknown id) | **403 `not_self`** |
| `userId: me` on a seat linked to someone else | **409 `seat_taken`** |
| `userId: me` while you already hold another seat here | **400 `already_seated`** |

An unknown id is deliberately folded into `not_self` rather than kept as the old
400 `Unknown user` — that answer doubled as "does this id exist?".
`already_seated` exists because `actorSeat` (`routes/games.js`) and `seatOf`
(`routes/invitations.js`) both `.find()`, so two seats for one account is
undefined behaviour. Name and colour edits stay open to grantees; only the link
is restricted.

**A grantee releases their seat through `DELETE …/shares/:userId`**, which drops
the grant and the link together. Don't add a grantee path here — it would desync
`round_grants.memberId` from the seat.

## 2. Owners were NEVER seated — by any path, in any round

Worth stating plainly because it reads like a migration artefact and isn't: the
only writer of `member.userId` before #421 was invitation-accept. `POST
/api/rounds` built members as `{ id, name }`, so **every** round's creator sat
unlinked — blank Chronik attribution for the owner, and their own chair offered
in the invite dialog's seat picker.

`createRound` now takes an `owner` (`{ name, userId }`) and **prepends** it.
Three things about that:

- **The name is resolved server-side** from the account's username (with the same
  `'Gast'` fallback as invitation-accept), so a client can never dictate the
  seat's name. Renaming is the member page's ordinary name edit.
- **Prepend, not append** — and the Postgres backend gets it by inserting the
  owner row *first*, so it takes the lowest `seq` and every read (all of which
  `ORDER BY seq`) agrees with the JSON backend's array prepend.
- **Absent-key parity is the fragile half.** Only the owner carries `userId`; the
  typed members must keep exactly `{ id, name }`. A Postgres column default or a
  `userId: null` on the others silently splits the backends
  (`.claude/rules/postgres-backend.md`). The contract suite asserts
  `'userId' in members[1] === false`.

`ownerSeat: false` is the **opt-out** (only an explicit `false` suppresses it),
and because the creator now occupies a seat, `members` lost its `min(1)`: a solo
round is legitimate. "At least one member" moved into the handler, which is the
only place that can see both the typed names and the owner seat.

There is **no backfill** for existing rounds — claiming is the manual fix, one
seat at a time (CLAUDE.md: no permanent migration code).

## 3. Moving seats is deliberately a two-step, and silent

While you hold a seat, no *other* member's page offers „Das bin ich" — and it
shows no hint saying why. Release („Das bin ich nicht"), then claim the other.
A seat-move on claim would unlink a chair you are not looking at and silently
make it invitable, which is the bug this issue exists to close.

„Das bin ich nicht" takes **no confirmation** — it only nulls the link and the
button one click later puts it back. That is deliberately unlike the neighbouring
„Zugriff entfernen", which cuts another person's access and they cannot undo it.
Those two now live in **separate branches** of the member page: before #421 they
were one `member.userId` check, so an owner-claimed seat would have offered
„Zugriff entfernen" → `DELETE …/shares/:userId` → 404 `not_shared`.

## The fixture trap this plants in every existing test

`round.members[0]` is no longer the first *typed* member in accounts mode — it is
the creator's own seat. Anything picking a seat by index now picks the owner's.
`seedShare` in `test/round-grants-access.test.js` did exactly that and seated the
grantee in the owner's chair; the suite stayed green because nothing asserted the
owner's seat separately. **Pick seats by name in fixtures**, and expect member
counts in accounts-mode specs to be one higher than the names you typed. Specs
whose subject is unrelated to seating (the invitation flow) pass `ownerSeat:
false` instead, so their member arrays stay exactly as written.

**Related:** `.claude/rules/round-grant-resolver.md` (why the grant, not the
seat, is the access decision), `.claude/rules/tenancy-rls.md`,
`.claude/rules/label-rows-lose-to-field-label.md` (why the new-round form's
„Ich spiele mit" checkbox sits *outside* the members `.field`).
