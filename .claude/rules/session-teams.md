---
paths:
  - "public/js/session-people.js"
  - "public/js/team-picker.js"
  - "lib/routes/sessions.js"
  - "test/session-people.test.js"
  - "test/sessions.test.js"
  - "public/js/views-session.js"
---
# A session team (#575) is addressed by POSITION on the wire — and a team win stays a flat list

`session.teams = [{ id, personIds }]` groups two or more of a session's
participants — members and guests in any mix — into one playing party. It rides
in the same opaque session blob as `guests` (#458), so it needed no schema
change, no migration and no repo method. Four things about it are load-bearing
and each fails quietly.

## 1. The client CANNOT name a guest by id, so the wire format is positional

Guest ids are minted server-side inside the very request that starts the session
(`resolveGuests`, `lib/routes/sessions.js`), so at POST time no guest id exists
anywhere in the browser. A team therefore arrives as

```jsonc
"teams": [{ "memberIds": ["m1"], "guestIndices": [1] }]   // m1 plus guests[1]
```

and `resolveTeams` maps the positions against the guests it has just minted.
Reaching for a flat `personIds` here is the obvious design and it cannot work.

**The client side of that has its own trap, and it is the sharper one.** A
position is only stable until an *earlier* guest is removed — after which every
later index silently points one person to the left, and a team formed with Eli
would submit Dana. So `renderGuestPicker` carries `el.guestKeys`, an
index-aligned array of stable client-local keys (`g1`, `g2`, …), and the team
picker holds **keys**, resolving them to positions only in `teamPayload()`, at
submit time. Measured in a browser: with a team on the second guest, the payload
reads `guestIndices: [1]`, and after removing the first guest it reads `[0]` —
still the same person.

Nothing about this is visible in a test that never removes a guest, and the
failure is a silently mis-paired team, not an error.

## 2. A team counts as ONE player, and the arithmetic lives in two places

The draw's pool filter (`drawPool`, `lib/draw.js` since #486) matches a game's
`minPlayers`/`maxPlayers` against the
number of **parties**, not bodies — six people in three pairs are looking for a
three-player game, which is often exactly why teams were formed:

**Since #634 the two places are the COUNT only.** The comparison it feeds is
`fitsPlayerCount` in `public/js/draw-pool.js`, which both sides require — so the
half that used to be two hand-synced expressions is now one, and what remains
duplicated below is the arithmetic that produces the number, which genuinely
differs per caller (a stored session versus three live pickers).

```js
playerCount = memberIds.length + guests.length - teamedPeople + teams.length
```

`lib/routes/sessions.js` computes it for the real pool and `showStartSession()` for
the live preview, and **the two must move together**. The count stays in the
route on purpose — `drawPool` takes it as a parameter rather than re-deriving it
from `round.members`, which would silently drop the guests and flatten the teams.
It is the standing constraint in — the standing constraint in
`.claude/rules/active-games-filter-sites.md`, now with a second term in it.

Direct-pick mode consults no player range at all (pinned by a spec since #532),
so teams change no pool there; they exist on that sheet purely so a team that won
can be recorded. That is why the two screens pass a **different note** to
`renderTeamPicker` — the direct-play one must not promise a filter it does not
apply.

**The seat picker's centre count stays a HEADCOUNT** ("5 playing"), deliberately:
it is a table with people around it, and `startSession.tableCount` says so. Its
`extraCount` is still just the guests. The party count is explained by the team
field's own note instead of being shown as a second number nobody asked for.

## 3. `winnerIds` stays a flat list of PERSON ids — that is the whole design

The winner picker offers one chip per party (`sessionParties`), and tapping a
team's chip writes **every one of its people** into `winnerIds`. Nothing
downstream learns that teams exist: the Pokale standings, the win streak, the
Chronik winner names and the recap keep reading `winnerIds` exactly as before.
Verified end to end — one tap on „Anna and Dana (guest)" stored `[anna, dana]`
and the Pokale tab showed *Anna · 1 win*, with the guest dropped by the
pre-existing `wid in wins` guard.

Two consequences worth knowing rather than rediscovering:

- **A team win breaks a winning streak**, because the streak card counts only
  nights with a *sole* winner (`ws.length !== 1`). That is the existing meaning
  of a shared win and #575 deliberately did not change it. A team containing a
  guest additionally makes the whole session skipped by `wonByGuest`
  (`.claude/rules/session-guests-are-not-members.md` §3).
- **A team chip counts as selected only when ALL of its people are in.** A
  partially-set list — hand-crafted, or written before the team existed — reads as
  *not* selected, so one tap completes it rather than clearing it.

## 4. Claim the people only AFTER the size check, or a dropped team steals them

Both resolvers — `resolveTeams` in the route (wire → stored records) and
`teamsForPeople` in `session-people.js` (stored records → resolved people, on
every read) — enforce the same two rules: nobody is in two teams, and a team
below `MIN_TEAM_SIZE` is dropped. They are named apart on purpose: one grep must
not return two functions with different shapes. The order is what makes them
compose:

```js
if (personIds.length < MIN_TEAM_SIZE) return;   // drop first …
personIds.forEach((pid) => claimed.add(pid));   // … then claim
```

Claim first and a team that is *about* to be discarded takes its people out of
the next, valid one — they vanish from the parties entirely, which on the winner
picker means a person who played cannot be recorded as having won.

The read-side resolver is not belt-and-braces: a member removed from the round
after the fact shrinks their team, and a team down to one person must stop being
a team — otherwise that person appears twice on the picker, once inside the
"team" and once as themselves. Both resolvers exist because the stored blob is
the one thing a hand-crafted request can shape freely.

**Only one input shape can see this ordering, and the obvious test is not it.**
A single too-small team passes either way: the team is discarded in both
versions, and `claimed` is never read again, so the parties come out identical.
It takes a **dropped team followed by a valid one wanting the same person**:

```js
teams: [{ personIds: ['m1', 'gone'] },   // resolves to one -> dropped
        { personIds: ['m1', 'm2'] }]     // must still get m1
```

Broken, the second team keeps only `m2`, falls below the minimum too, and *both*
vanish — so a pair that played together silently becomes two solo parties. The
first version of this test used a lone one-person team and stayed **green against
the broken code**; it was the break-on-purpose loop that exposed it, not review
(`.claude/rules/break-the-code-on-purpose.md`, which carries this as a worked
example of a fixture too small to fail).
Both suites now pin the two-team shape (`test/session-people.test.js`,
`test/sessions.test.js`).

## Smaller things

- **Teams are never named by hand.** `partyName()` joins the members' labels
  ("Anna, Ben und Dana (Gast)"), so a guest keeps their marker inside a team and
  there is no new free-text field to cap, moderate or disclose. It duplicates
  core.js's two-line `joinNames` on purpose: `session-people.js` loads *before*
  `core.js` and must stay requirable from Node, where core.js is not loadable.
- **`.team-pool` needs its paired `[hidden]` rule.** It declares `display: flex`,
  which beats the UA stylesheet's `[hidden]`, so hiding the empty pool takes
  `.team-pool[hidden] { display: none }`
  (`.claude/rules/hidden-attribute-vs-display-rule.md`). Verified by computed
  style, never by `el.hidden`, which answers about the attribute and not the
  pixels.
- **Nothing here may be a `.ds-row`** — the picker lives inside a `.field`, where
  `.field label` (0,1,1) beats `.ds-row` (0,1,0) and flattens the row
  (`.claude/rules/label-rows-lose-to-field-label.md`).
- **Voting is untouched.** Teammates each take their own hot-seat turn and rate
  individually, so the vote map keys stay person ids and `gameStats`, the voter
  strip, the finale and the recap needed no change at all. That was a deliberate
  scope choice, not an omission.
- **Teams are frozen at the start**, like the seats and the guest list — the
  same setup-time-only decision as #533.

## Verifying a change here

Drive it against the committed `dev-temp-data` config with the service worker
cleared (`.claude/rules/pwa-service-worker.md`). Two things cost time:

- **The setup screen has no cold-loadable URL** — `resolveRoute` maps every
  transient session path to the round hub — so reach it by clicking `.hub-cta` /
  `.rail__cta` (`.claude/rules/session-flow-history.md`). `routeTo` *is* reachable
  as a `window` global, which is the cheapest way back out
  (`.claude/rules/in-app-nav-links.md` §1).
- **A screenshot taken after a programmatic `scrollIntoView` comes back blank**
  while every DOM probe stays healthy — the artifact family in
  `.claude/rules/preview-pane-paint-artifacts.md`. Resize to a viewport tall
  enough to hold the whole screen and capture right after a fresh `navigate`
  instead of scrolling to the field.

**Related:** `.claude/rules/session-guests-are-not-members.md` (the guests these
group, and the resolver they share),
`.claude/rules/active-games-filter-sites.md` (the pool arithmetic's other half),
`.claude/rules/shared-constants-across-the-stack.md` (`MIN_TEAM_SIZE` crosses the
boundary in the same file as the guest caps),
`.claude/rules/postgres-backend.md` (absent-key parity, which `teams` also keeps).
