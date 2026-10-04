---
paths:
  - "public/js/session-people.js"
  - "lib/routes/sessions.js"
  - "public/js/views-session.js"
  - "public/js/guest-picker.js"
  - "public/js/seat-picker.js"
  - "test/session-people.test.js"
  - "test/repo.test.js"
  - "public/js/session-tally.js"
  - "test/tie-rule.test.js"
  - "lib/session-remove-person.js"
---
# A session guest (#458) is a PERSON without a member row — and ~10 sites assumed those are the same thing

`session.guests = [{ id, name }]` adds participants who vote in one session and
never join the round. The data half was free (a session is an opaque JSON blob in
both backends, so no schema change, no migration, no repo method). **The whole
cost of the feature was that every screen resolved an id against
`round.members`**, and a guest id has no row there.

`public/js/session-people.js` is the one resolver — `sessionPeople(round,
session)` → `[{ id, name, guest }]`, `personLabel(person)` → `"Anna (Gast)"`. It
gets its own file for the `coverage:ci` reason in
`.claude/rules/frontend-helper-modules-and-coverage.md`, and it also holds the two
limits `lib/routes/sessions.js` **requires out of it** — `MAX_SESSION_GUESTS` and
`GUEST_NAME_MAX` (`.claude/rules/shared-constants-across-the-stack.md`). Both are
shared rather than duplicated because the server is deliberately *lenient*: it
truncates the list and each name instead of 400ing, so a drifted client copy would
drop guests and clip names with **no error anywhere** — the palette bug's failure
mode, minus even the 400 that eventually exposed it.

## 1. `memberColor()` does not fail for a non-member — it returns member #0's colour

```js
const idx = round.members.findIndex((m) => m.id === memberId);   // -1
return MEMBER_COLORS[(idx >= 0 ? idx : 0) % MEMBER_COLORS.length];  // member #0
```

So every guest would have rendered in the first member's swatch: no error, no
blank, just a visitor wearing Anna's colour on the handover card, the progress bar
and the voter strip. `personColor(round, person)` (core.js) is the guarded
version. **Any future "person who is not a round member" hits this same silent
fallback** — route it through `personColor`, never `memberColor`.

## 2. The guest tone needs TWO values, and one custom property cannot serve both

The obvious tidy-up — one `--guest-*` variable for "the guest colour" — breaks one
of its two uses, because the two are opposites:

| Use | Needs |
|---|---|
| `.avatar--guest` (results, finale, seat-like chips) | a **light** fill with `--ink-soft` text and a dashed edge — the `.nr-seat--empty` "free seat" language |
| `personColor()` → the handover card's full-bleed `background`, and `.vote__who strong`'s text colour | a **dark** tone: `.handover`'s text is `--on-accent` (white in a light scheme), and the name sits on the page |

Hence `.avatar--guest` uses the page-derived neutrals while `personColor()`
returns `var(--ink-soft)`, the dark tone under the card's `--on-accent` text (the
bars are `.claude/rules/accessibility-contrast-and-modals.md` §1's; the ratios
first recorded here were measured on the pre-#1202 round palettes, which are
gone). Put the light tone in `personColor` and the handover card renders light
text on near-white.

There is a **third** value: on the dark finale stage the page-derived neutrals are
a near-white disc, so `.stage__voter-avatar .avatar--guest` retakes the
`--stage-*` family. It is declared after `.stage__voter-avatar .avatar` because
the two tie at (0,2,0) on `border-color` — order decides, as in
`.claude/rules/responsive-content-width.md`.

## 3. A guest is DROPPED from a win — and a night only guests won is SKIPPED

The Pokale **win counts** exclude guests for free: `wins` is keyed by round
member and the loop guards `if (wid in wins)`. The **streak** (`winStreak` in
`public/js/session-tally.js`, the one copy the Pokale card and the Programmheft
share card both read) has to do it explicitly, and it treats two nights
differently:

- **Members among the winners** — `memberWinners()` drops the guest ids, and
  what is left is an ordinary win. Since **#1421** a shared win continues the
  streak for every winner, so `[Anna, guest]` extends Anna's streak exactly as
  `[Anna, Nils]` extends both of theirs.
- **Only guests won** (`wonOnlyByGuests`) — the night is filtered out of
  `chrono` and neither breaks nor extends. Counted as an ordinary win it would
  leave no member among the candidates, the walk would stop, and the card would
  silently blank a member's real streak — breaking it under another name, which
  looks like a regression rather than a rule being applied.

`test/tie-rule.test.js` (test 2) and `test/session-tally.test.js` pin both.

**Until #1421 this section said the opposite, and it was right for the code of
the time.** The streak was SOLE-win only, any night with a guest among its
winners was skipped (`wonByGuest`), and dropping the guest ids was called wrong
because `[Anna, guest]` would become a sole Anna win. #1421 (operator decision
2026-09-26, recorded in `session-tally.js`'s header) made a shared win a full
win for each winner, which is what makes dropping the guest correct now. Do not
restore the old skip: it would discard a member's real win.

## 4. A guest votes on exactly the same scale — there is no asymmetry left

A guest rates (their opinion of a game they played belongs in `gameStats`, or the
results screen and the game's own average silently disagree), and since **#909**
that is the whole story: the scale is 1–5 for everybody and the vote card renders
the identical five tiles whoever is holding it.

**This section used to describe the app's sharpest per-role branch, and it is
worth knowing what it was, because two of the three mechanisms it named are
gone.** A guest could not vote a game off the shelf — that is the permanent group
governing its collection — so a member's card carried a sixth control the
guest's did not: an "Aussortieren" toggle at first, then (#797) a leading trash
tile that was the **zero** of a 0–5 scale. #909 removed the option from
*everyone*, and the branch went with it: `dropGuestRetireFlags()` in
`lib/routes/sessions.js` and the `isGuest ? { rating } : { rating, retire }`
split in `sanitizePersonVotes` are both deleted, and there is no longer a shape
only a member may write.

What survives is the reason the branch was cheap while it existed, and it is
still the rule to keep: the tile was **omitted, never cast and filtered later**,
which is what let `gameStatsForSession` iterate `sessionPeople()`, and
`rawGameStats` (the raw half of `gameStats` since #894) iterate `sessionRaters()`
(`sessionPeople()` plus anyone removed after rating, #1538), with **no
guest-specific exclusion at all**. Apply that shape to the next control only some people may
use: keep it out of the payload rather than stripping it downstream, or every
aggregate over votes grows a role check.

The other durable half is the **continue-guard**, which #797 collapsed from two
questions into one ("a rating, or the flag unless you are a guest" became "is
this game anywhere on your scale") and #909 simplified again to a plain
`Number.isFinite(v.rating)`. `vote.toast.needRatingOnly` went with the first
collapse. A future edit that re-splits it is re-introducing a difference the data
no longer has.

## 4b. Teams (#575) reuse this resolver — and add a second unit above the person

`sessionParties()` groups the people above into **playing parties**: one entry per
team plus one per un-teamed person. Two things here bear on this file directly:

- **The guest tone and `personColor` are unchanged** — a team has no colour of
  its own, and a guest inside a team keeps their marker, because the team's name
  is built from `personLabel()`.
- **A team win is a shared win**, so since #1421 it continues the streak for
  every member of the team (§3); a guest inside the team is dropped from the win,
  and only a night won by guests alone is skipped.

The rest — the positional wire format, the party-count arithmetic and why
`winnerIds` stays flat — is in `.claude/rules/session-teams.md`.

## 5. Smaller things

- **A guest OWNS NOTHING (#971).** `game.ownerIds` holds member ids, the pickers
  offer `round.members` only, and `ownedByParty` is handed the joining **seats**
  rather than the party — so a guest can neither be recorded as an owner nor
  satisfy the owner clause. That is deliberate and it has one accepted cost: a
  game whose only real owner is somebody outside the round cannot be expressed,
  so it stays ownerless and therefore **always drawable**. The alternative — a
  guest-owner — is worse, because a guest is ephemeral by design (§1) and the
  ownership would vanish with the session that created it. Recording it properly
  would need a third state ("owned by nobody here"), not a guest.
- **`guests` is absent, never `[]`.** The route spreads
  `...(guests.length ? { guests } : {})`; the contract suite pins the absent key
  in both backends (`.claude/rules/postgres-backend.md`). Unlike
  the retired `round.providers` setting there is **no** meaningful third state —
  absent and `[]` read the same.
- **A guest SITS ON THE RING since #1016** — `renderSeatPicker`
  (`public/js/seat-picker.js`, split out of core.js by the same issue) takes the
  guest list itself and renders a dashed seat per guest plus a „+" seat that adds
  one. It replaced an `extraCount` callback, and the replacement is the point:
  the ring used to be told only how many other people there were, so the two
  controls answering „wer ist am Tisch" could disagree. The argument is
  **required**, not optional — an absent-means-no-guests default renders a
  finished-looking ring that silently cannot take a visitor.

  `renderGuestPicker` is gone with the field it built; `createGuestList(note)`
  (`public/js/guest-picker.js`) is what remains — the live `guests`/`guestKeys`
  arrays the team picker reads, `add`/`remove`, and the per-screen note. The note
  is still a **parameter** (now a property of the list), because the draw flow's
  wording promises a vote the direct-play flow does not have; it is the hint
  under the ring's name input.

  **MAX_SESSION_GUESTS is enforced by the ABSENCE of the „+" seat**, not by a
  check in `add()`. So `startSession.toast.guestMax` is unreachable and gone, and
  there is no second copy of the limit to drift from the server's.
- **A guest participant is a `<span>`, not an `<a>`** — there is no member page to
  link to, and an anchor with no href is neither focusable nor styled
  (`.claude/rules/in-app-nav-links.md`). The round-member surfaces (hero, rail,
  podium, seat picker) needed no guard at all: they iterate `round.members`, which
  a guest is never in.
- **The privacy policy did change.** A guest name is free text about a *third
  party* by definition, so §5 and `vvt.md` row 3 name it explicitly and the
  policy's revision was bumped (`PRIVACY_REVISION` since #521) (`.claude/rules/keep-legal-docs-current.md`). No new processor, no
  new recipient, no new on-device storage.

## Verification traps met on the way

- **`node --test` given a path that does not exist reports success for it.** A
  break-on-purpose loop was pointed at a misremembered filename for the repo
  contract suite (it runs from `test/repo.test.js`, not from a `repo.json`-named
  sibling). The run printed a clean pass and *looked* like the assertion was
  wired when it had never executed. So any break-the-code-on-purpose check must
  confirm the **baseline test count** first — `ℹ pass 27` where that file has 90
  is the tell, and it is the only one you get.
- **The setup screen has no cold-loadable URL.** `resolveRoute` maps every
  transient session path to the round hub, so reach it by clicking `.hub-cta` /
  `.rail__cta` (`.claude/rules/session-flow-history.md`). And `resultsPath` is
  `/round/:rid/session/:sid` — **no** `/results` suffix, despite the function's
  name; the suffixed URL falls back to the hub, which reads as the screen being
  broken.
- The service worker serves `public/js/**` cache-first, so clear it before
  believing **any** of the above (`.claude/rules/pwa-service-worker.md`).

## The three follow-ups, now decided

All three were filed and reviewed on 2026-07-29; none is still open as a
"possible follow-up".

- **Guests in the "Jetzt spielen" sheet — BUILT (#532).** The payoff is not the
  vote (there is no voting phase) but **winner attribution**: the results
  screen's finish + winner picker draws its chips from `sessionPeople()`, so
  before this a guest who won a directly-started game could not be recorded at
  all, and the only workarounds were to make them a permanent member or to use
  the draw flow instead. The server side was mostly *deleting* a special case —
  `resolveGuests` now runs for both modes. The player range is still **not**
  consulted in direct-pick mode, so guests gain no filtering role there; a spec
  pins that a chosen game stays playable however many guests are named.
- **Adding to the guest list after the draw — WON'T DO (#533).** Round
  *members* cannot be added to a session after the draw either, so who joins the
  table is a setup-time decision for every participant. That is also why #532
  belongs in the sheet rather than on the results screen. **Taking someone OUT is
  the exception since #1538**, for a guest and a member alike:
  `removePersonFromSession` (`lib/session-remove-person.js`) drops them from
  `memberIds`/`guests`, the winners and their team, and records them in
  `removedPeople` so their ratings still count through `sessionRaters()`.
- **Promoting a guest to a permanent member — WON'T DO (#531).** Guest ids are
  minted **per session** (see the `resolveGuests` note above), so there is no
  stable guest identity to re-attribute history along: "the same Dana" across
  three sessions is three unrelated ids, and nothing in the data says they are
  one person.
