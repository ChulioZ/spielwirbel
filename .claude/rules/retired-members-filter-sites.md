---
paths:
  - "public/js/member-active.js"
  - "public/js/session-people.js"
  - "public/js/seat-picker.js"
  - "public/js/team-picker.js"
  - "public/js/views-pokale.js"
  - "public/js/win-score.js"
  - "public/js/recap.js"
  - "public/js/owner-picker.js"
  - "public/js/round-rail.js"
  - "public/js/views-round-start.js"
  - "lib/routes/members.js"
---

# A retired member must vanish FORWARD and keep resolving BACKWARD (#1006)

`member.retired` is the one flag in this app whose two halves pull in opposite
directions, and getting either wrong is silent.

**Backward — every id history holds must keep resolving.** Votes are stored as
`votes[memberId][gameId]` and **every game's Spielwirbel-Score is recomputed from
them on demand** (`rawGameStats`, `game-stats.js`). `sessionPeople()` is the
chokepoint every vote read goes through, so a `!m.retired` filter there would
silently shift scores across the whole shelf, the Pokale and the recommender's
taste profile — the exact opposite of what retiring is for. The same goes for
`memberHex` (which indexes into the FULL list, so filtering re-colours everyone
after the retired seat), the Chronik's actor lookup, and `showMember` itself,
which has to open or there is no way back.

**Forward — the person-facing surfaces stop offering them**, through the one
filter `activeMembers()` (`public/js/member-active.js`):

| site | what it decides |
|---|---|
| `views-session.js`, `direct-session.js` | who is seated when a session starts |
| `seat-picker.js` | the seat ring |
| `team-picker.js` | who can be put in a team |
| `views-pokale.js`, `win-score.js` | standings, streaks, trophies |
| `recap.js` | the "two members disagree about most" card |
| `round-rail.js`, `views-round-start.js` | the member strips |
| `owner-picker.js` | who can be recorded as owning a box |
| `views-round-actions.js` | the free seats an invitation may fill |
| `bgg-import.js`, `regal-bulk.js`, `views-round-lookup.js` | whether an owner field is worth showing at all |

**Three of those files spell the predicate out instead of calling the helper** —
`recap.js`, `owner-picker.js` and `win-score.js` — because they are `require`d
from Node, and a `public/js` file cannot `require` a sibling. That is the same
constraint that makes `shelfScoreOf` and `tileValue` injected parameters. It is
one predicate, not a list or a formula, so the copy is licensed; if it ever
becomes more than `!m.retired`, inject it.

## The operator decision that looks like a bug

**Person-facing historical stats DO change when someone is retired**, and that is
deliberate (2026-09-11): `recap.js`'s "game two members disagree about most" can
name a different game afterwards. Do not "fix" it back — the card is about the
people at the table now.

## Why the retire dialog asks about solely-owned games

Not a nicety. `ownedByParty` (`draw-pool.js`) keeps a game in the pool only while
an owner is **seated**, and a retired member is never seated — so games they alone
own would silently leave every draw with nothing on screen to explain it.

## And why it asks about the account link only for your OWN seat

`PATCH …/members/:mid` refuses to release someone else's seat on purpose:
nulling a grantee's link leaves their grant matching on `roundId`+`userId` with
no chair, invitable to someone else
(`.claude/rules/member-seat-self-claim.md` §1). For another person's linked seat
the honest path is „Zugriff entfernen", which drops the grant and the link
together.

**Related:** `.claude/rules/active-games-filter-sites.md` (the same shape one
entity over — a retired GAME, and the enumeration problem it documents),
`.claude/rules/member-seat-self-claim.md`,
`.claude/rules/shared-constants-across-the-stack.md`.
