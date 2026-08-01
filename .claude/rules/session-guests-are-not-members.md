---
paths:
  - "public/js/session-people.js"
  - "lib/routes/sessions.js"
  - "public/js/views-session.js"
  - "public/js/guest-picker.js"
  - "test/session-people.test.js"
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
| `personColor()` → the handover card's full-bleed `background`, and `.vote__who strong`'s text colour | a **dark** tone: `.handover` is `color: #fff`, and the name sits on the page |

Hence `.avatar--guest` uses the page-derived neutrals while `personColor()`
returns `var(--ink-soft)` (5.78:1 under white, 4.95:1 on Schiefer — the two bars
`.claude/rules/accessibility-contrast-and-modals.md` §1 sets). Put the light tone
in `personColor` and the handover card renders white text on near-white.

There is a **third** value: on the dark finale stage the page-derived neutrals are
a near-white disc, so `.stage__voter-avatar .avatar--guest` retakes the
`--stage-*` family. It is declared after `.stage__voter-avatar .avatar` because
the two tie at (0,2,0) on `border-color` — order decides, as in
`.claude/rules/responsive-content-width.md`.

## 3. "A guest win must not break the streak" is NOT the default behaviour

The Pokale **win counts** exclude guests for free: `wins` is keyed by round
member and the loop guards `if (wid in wins)`. The **streak** looks like it does
too, and does the opposite:

```js
if (ws.length !== 1) break;
streakMember = ws[0];              // a guest id passes this
…
const streakM = round.members.find((m) => m.id === streakMember);   // undefined
if (streakM && streak >= 2) { … }  // card silently vanishes
```

A night won solely by a guest therefore **blanks a member's real streak** — which
is breaking it under another name, and looks like the feature quietly regressed
rather than like a rule being applied. So `chrono` filters out any session with a
guest among its winners: it neither breaks nor extends. Verified by removing that
one `.filter()` in the browser and watching "Siegesserie Anna 2 Siege in Folge"
disappear against otherwise identical data.

Note filtering the *guest ids* out of `winnerIds` instead is also wrong, in the
other direction: `[Anna, guest]` would become a sole Anna win and **extend** the
streak.

## 4. The retire control is not RENDERED for a guest — that is what removes the aggregation logic

A guest rates (their opinion of a game they played belongs in `gameStats`, or the
results screen and the game's own average silently disagree) but gets no
"Aussortieren" toggle: throwing a game off the shelf is the permanent group
governing its collection.

Omitting the control rather than casting and filtering the flag is what lets
`gameStats`/`gameStatsForSession` iterate `sessionPeople()` with **no
guest-specific exclusion at all** — there is simply never a guest `retire` flag.
Two consequences follow and both are load-bearing:

- `dropGuestRetireFlags()` in `lib/routes/sessions.js` strips one from a hand-crafted
  `POST …/results`, so the invariant holds for data too, not just for the UI.
- The guard in `POST …/results` is in the **route, not the repo** — the contract
  suite pins that the store happily persists a guest `retire`, which is what
  proves the guard was not quietly moved down a layer (same shape as
  `.claude/rules/admin-moderation-surface.md`'s notice-retention guard).
- The "rate or flag to continue" guard becomes rating-only for a guest, hence the
  separate `vote.toast.needRatingOnly` key.

## 4b. Teams (#575) reuse this resolver — and add a second unit above the person

`sessionParties()` groups the people above into **playing parties**: one entry per
team plus one per un-teamed person. Two things here bear on this file directly:

- **The guest tone and `personColor` are unchanged** — a team has no colour of
  its own, and a guest inside a team keeps their marker, because the team's name
  is built from `personLabel()`.
- **A team win is a shared win**, so it breaks a streak exactly as §3 describes,
  and a team holding a guest makes `wonByGuest` skip the whole session. Neither
  is new behaviour; both are now reachable one step more easily.

The rest — the positional wire format, the party-count arithmetic and why
`winnerIds` stays flat — is in `.claude/rules/session-teams.md`.

## 5. Smaller things

- **`guests` is absent, never `[]`.** The route spreads
  `...(guests.length ? { guests } : {})`; the contract suite pins the absent key
  in both backends (`.claude/rules/postgres-backend.md`). Unlike
  `round.providers` there is **no** meaningful third state — absent and `[]` read
  the same (`.claude/rules/round-provider-config.md`).
- **`renderSeatPicker` grew `extraCount` + `refreshSeats`.** The centre count has
  to include guests, but the guest list lives outside the picker — so the picker
  takes a *function* and exposes its own `render` on the returned element for the
  caller to re-run. **Since #532 the "Jetzt spielen" sheet passes both** — it
  offers guests too, and the guest field itself is shared by the two screens as
  `renderGuestPicker` (`public/js/guest-picker.js`), which returns the whole
  `.field` with the live names on `el.guests`, the same element-with-a-method
  shape. Its hint text is a **parameter**, because the draw flow's note promises
  a vote the direct-play flow does not have.
- **A guest participant is a `<span>`, not an `<a>`** — there is no member page to
  link to, and an anchor with no href is neither focusable nor styled
  (`.claude/rules/in-app-nav-links.md`). The round-member surfaces (hero, rail,
  podium, seat picker) needed no guard at all: they iterate `round.members`, which
  a guest is never in.
- **The privacy policy did change.** A guest name is free text about a *third
  party* by definition, so §5 and `vvt.md` row 3 name it explicitly and `REVISION`
  was bumped (`.claude/rules/keep-legal-docs-current.md`). No new processor, no
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
- **Editing the guest list after the draw — WON'T DO (#533).** Round *members*
  cannot be added to a session after the draw either, so who is at the table is
  a setup-time decision for every participant. That is also why #532 belongs in
  the sheet rather than on the results screen.
- **Promoting a guest to a permanent member — WON'T DO (#531).** Guest ids are
  minted **per session** (see the `resolveGuests` note above), so there is no
  stable guest identity to re-attribute history along: "the same Dana" across
  three sessions is three unrelated ids, and nothing in the data says they are
  one person.
