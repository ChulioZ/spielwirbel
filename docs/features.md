# Features

What the app does, in detail. For a short overview see the
[README](../README.md); for how it is built see
[`architecture.md`](architecture.md).

- **Rounds** – a group with a name and any number of members. The home screen
  is a dashboard (issue #842): any **sessions still running** across all your
  rounds sit at the top as resume tickets — one tap back into the vote, or into
  the results screen if the vote is closed but the evening was never recorded —
  then the lobby of round cards (members, game/session counts, last result), then
  a row of tiles for the Freundeskreis, Entdecken and „Was ist neu". A new
  round is set up on a playful "seats around the table" screen, optionally
  importing the games list from an existing round. The **name can be corrected
  later** — click it on the round's Start screen (or in the desktop rail) and
  type; the change is noted in the Chronik, so on a shared round everyone can
  see who renamed it. Groups change, so a further
  seat can be added later from the "+" in the round's member strip. With accounts on, the seat at
  the head of that table is **yours** — the creator is seated automatically (opt
  out with "Ich spiele mit"), and on any other round a member page offers
  „Das bin ich" so your account can take its own seat. A claimed seat is what
  puts your name on your actions in the Chronik.
- **Games** – each game has a title, a required player range (min–max), any
  number of custom round **tags** (see below), and an optional cover image (paste
  from clipboard or pick a file). A game's detail page can also record the
  **expansions the round owns** for it — ticked off the list BoardGameGeek
  already knows for the base game, or typed in by hand — so "do we still have
  Seefahrer?" is answered by the app. An expansion that seats more (or fewer)
  people widens the range the draw filters by, which is how the 5–6-player
  extension stops a six-person evening from hiding the game you own. When adding a
  game, the title field doubles as a **search-as-you-type lookup** against
  **BoardGameGeek**. Hits with the **same title** collapse into a **single
  row** — a game printed in several editions offers one entry to click rather
  than a dozen near-identical ones. Pick a
  suggestion to auto-fill the title, cover art and player range, and store a link
  back to the source page (shown on the game's detail
  view). The lookup is optional — manual entry works exactly as before, and the
  app degrades gracefully when the lookup is unreachable. If the title you type is already in the
  round, the sheet says so — separately for the shelf and for the archive — but
  never stops you saving it, since a second copy is sometimes exactly what you
  mean.
- **Know what you are voting on** – a game linked to BoardGameGeek carries its
  community **complexity** (the 1–5 weight, shown to one decimal), its **playing
  time**, a **minimum age**, and BGG's **categories** and **mechanics**. Both
  voting screens — the hot-seat card and the shared vote link — show a small ⓘ
  next to the title that opens them in a sheet, and the game's detail page shows
  them as their own section, so a voter facing an unfamiliar game sees more than
  a cover. Playing time is shown as a **range** wherever the bounds differ
  (`20–600 Min.`), because that spread is what tells you a game is a campaign
  rather than a filler. BGG's **community rating** is shown on the detail page
  only, and never on either voting screen — a score next to a ballot anchors the
  vote. BGG's *rank* and *geek rating* are not imported at all, and neither is
  the game's **description** — publisher blurbs turned out to put readers off
  rather than help them decide, and playing time answers a real question in four
  characters. Games added before this feature fill in silently the next time
  their detail page opens or a session draws them; categories and mechanics stay
  in English (BGG has no translations).
- **Pick the cover of your edition** – a board game is usually printed in a dozen
  languages, and the picture BoardGameGeek serves by default is rarely the box on
  your shelf. So wherever a game is linked to BGG you can open its **edition
  covers** and choose one: while adding the game, on its detail page, and for each
  game in the collection import. Editions in your own UI language come first,
  then English, then the rest; each tile names the edition and its year. The list
  is only fetched when you open it, and — like every other provider picture — the
  cover stays a link to BGG's own servers rather than a copy on this instance.
  The choice is **remembered**: the game's detail page names the printing under
  its cover („Ausgabe: Deutsche Erstausgabe · 2021"), and if the game is on the
  Wunschliste the price below is quoted for *that* box rather than for whichever
  edition matches the language you happen to read the app in. Picking a different
  cover moves both; pasting your own picture drops the label, since it no longer
  describes a BGG printing.
- **Import a BoardGameGeek collection** – filling a shelf one game at a time is
  the slow part of setting a round up, so link your BGG username once under
  **Konto** and the Regal can pull in everything you have marked as *owned*
  there in one go. You get a checklist to confirm — everything preselected, and
  the games already on your shelf tucked into a collapsed section below it, so
  the list you act on holds only what can actually be added — and the games
  arrive with their titles, player ranges, covers and a link back to BGG. Each
  row shows the cover it would import and lets you swap in a different edition's
  before you confirm. It is **one-shot and on demand** — never a background
  sync — and it needs no BGG password: a username is enough, and you can unlink
  it again at any time. Accounts mode only.
- **Provider cover art is hotlinked, not copied:** the picture is loaded straight
  from the provider's own servers rather than downloaded onto this instance,
  because re-hosting third-party box art on a public service needs a licence
  (issue #172). BoardGameGeek *does* grant one with its XML API
  token (#117), so BGG covers stay hotlinked only for want of an image-resizing
  pipeline. Your own uploaded covers are stored normally. One
  consequence to expect: if a store moves or removes an image, that cover stops
  showing. A linked game's cover editor therefore offers **"Titelbild von
  \<Anbieter\> holen"**, which re-asks the provider for the current picture —
  one click, whether the game lost its cover or never had one (issue #518).
  Details can be edited inline on the game's detail page. A game added by hand
  (with no source link) can be **linked to a provider after the fact** from its
  detail page: search BoardGameGeek, pick the match, and choose which differing
  fields (name, cover, player count) to take from it — the source
  link is always saved. A link can also be **removed again** from the same
  detail page if the match turns out to be wrong; a hotlinked provider cover is
  cleared with it (your own uploaded cover is kept). Games are never lost by accident:
  instead of deleting, they are **archived** — kept with a timestamp in a
  browsable archive and restorable any time. There are two archives, because
  the reason matters: **retired** ("Aussortiert") means the group wants rid of
  the game, **completed** ("Durchgespielt") means they finished its content — a
  campaign or a legacy box. Alongside them sits the
  **Wunschliste** — games the group wants but does not own yet, added by hand
  through the same add-game sheet or pulled in one shot from a linked
  BoardGameGeek **wishlist**. Wished **expansions** are first-class too — most of
  what a real wishlist holds is "you own Catan, you want Seefahrer" — and whether
  imported or added by hand, each one says which game it belongs to. A wish never turns up in a vote, a draw
  or any count of the shelf, because the group cannot put it on the table; "Ins
  Regal" moves it across the day they buy it, and that is when the round's
  Chronik and the Freundeskreis feed report it — wanting a game is not news,
  getting it is. "Ins Regal" on a wished expansion instead records it on its base
  game's expansion list, bringing that game along if the round does not have it
  yet, so the expansion widens what the game can be drawn at rather than becoming
  a box of its own that nobody can play.
  Where the instance has it switched on (`PRICES_ENABLED`), opening a wished game
  that carries a provider link also shows **what it costs right now** — the
  cheapest in-stock offer including shipping via Brettspielpreise.de, with the
  time it was retrieved and a link out. The last price seen is kept: it appears immediately — led by its age
  („Preis von vor 3 Tagen") plus a checking note — while the current price is
  looked up, stands in when the price service is out, and is never passed off as
  current or shown past seven days. A lookup that settles on "nobody stocks
  this" says so instead of showing nothing. Which **edition** is priced follows
  the cover the round picked, so everyone in it sees one price for one wish;
  where it ships to and in what currency still follows each reader. Read-only and
  server-side: no alerts, no price history, and no affiliate links of any kind.
  Beside those three lists the shelf offers **„Das könnte euch auch
  gefallen"** — games the round does *not* own, ranked against its own taste.
  The profile comes from the three things BoardGameGeek cannot know: which games
  this group actually rated well, which ones it keeps putting on the table, and
  how many people really sit at their table (parties, so a team counts once).
  That middle one matters most to a round that picks its games directly instead
  of voting: those evenings leave no ratings behind, so without counting the
  plays the app would know nothing about them. Everything else — quality, complexity,
  mechanics, categories, the community's verdict on player counts — comes from
  the local BGG corpus, and the two are joined by plain weighted arithmetic:
  no model, no AI, no outbound call, and every entry a real BGG row that cannot
  be invented. Each card says **why** it is there ("Ähnliche Mechaniken wie
  Wingspan und Terraforming Mars", „Am besten mit 4 Personen"), and one tap
  puts it on the Wunschliste — or, with the **ban icon** beside it („Nicht
  interessiert"), takes the title off the list for good. That icon shows no
  text but is labelled for screen readers, so the card's actions fit one row on
  a phone. The dismissal belongs to the round rather than to one
  person, is undoable both on the spot and later from „Ignorierte anzeigen", and
  creates **no game row**: it hides a suggestion without claiming the round owns
  anything. It also only ever hides — it never re-trains the ranking, so nobody
  can steer the list into a corner by tapping. Games already in the round in any
  state — including retired, the sharpest signal of all — are never suggested
  back, and a round with too few linked games is told so rather than shown a
  confident guess.
  A game is active, retired, completed or wished-for, never two at once. All
  three lists — and the recommendations beside them — are reached from „Nicht im
  Regal" in the shelf's header on a phone or tablet, and from the left rail's own
  group from 1280px up. Every row on those lists
  opens the game's own detail page, so a game keeps its full editing surface —
  title, cover, player range, tags — after it has left the shelf; the page then
  offers only the way back onto it. The distinction carries through to the Pokale tab: a
  retired game stops being named as anyone's favourite or as the game the group
  disagrees about, because retiring it withdraws that preference — while the
  nights you actually played it still count toward "Meistgespielt". A completed
  game keeps counting everywhere. Deleting one game permanently requires it to be
  off the shelf first — archived or wished-for — so nothing in the active
  collection can be erased by a single stray tap.
  A shelf can also be **tidied in bulk**. The Regal has a „Auswählen" mode that
  turns the covers into a selection: it keeps the search, the tag chips, the
  metadata filters and the sort working, so „Alle auswählen" means everything you
  have narrowed to, and the picked games can be retired — or deleted outright —
  in one confirmed action. The same selection sits on the two archives and the
  Wunschliste, for delete only. It exists because the shelf can be *filled* in
  one action by the BoardGameGeek import: undoing a 200-game import used to be
  some 400 taps. Bulk delete is the one path that accepts a game still on the
  shelf, deliberately — being made to retire 200 games before deleting them is
  the two-step in bulk, i.e. the problem rather than the fix — and it is a
  co-owner action, behind a confirm naming the count and saying that the games
  leave every past session with it.
  Games can be **moved between rounds**: "Spiele verschieben" in the
  round's Einstellungen lists the round's games — archived ones included, labelled —
  each pre-checked, so confirming untouched consolidates the whole round while
  unchecking splits off just part of the shelf. Moved games keep their covers,
  provider links and tags, and same-named tags are merged into the target. The
  source round stays behind; a moved game drops out of its sessions, since a
  session cannot reference games that now live elsewhere (a session left with
  no games at all is dropped). Moving is owner-only — the action is not offered
  on a round that was shared with you.
- **Tags** – every round can define its own free-form tags (e.g. "outside",
  "quick lunch break", "co-op") on a dedicated screen, reached from
  the Start tab or, on a wide screen, the round rail. Tags are the single way to categorize games. Assign
  any number of tags to a game — in the add-game sheet or later from the game's
  detail page, creating new tags inline — and filter both the Regal and the
  session draw by them (tri-state chips: off / include / exclude; excluded tags
  reject any match). With two or more tags included, a small control above the
  chips chooses how they combine — "all tags" (a game must carry every one, the
  default) or "any tag" (at least one); the choice is remembered with the rest of
  the round's last draw. A toggle above the chips
  selects every tag at once, or clears the whole filter in one click whenever
  anything is filtered. Each tag can carry an
  **icon** picked from a curated set, shown next to its name everywhere the tag
  appears; a tag without one keeps the default tag glyph, and the icon can be
  changed later from the Tags screen.
  Deleting a tag simply unassigns it from every game.
- **Members** – each member has a detail page (opened from the Start hero row,
  the Pokale podium, or a session's participant list) with their stats — wins,
  sessions joined, win rate, average rating given, and favorite game — and lets
  you rename them and pick their avatar color from the curated palette.
- **Round hub** – each round is a small app of its own, with four sections
  presented per screen size: a floating bottom dock on phones, a tab strip at
  the top of the content column on tablets, and from 1280px a persistent left
  rail carrying the round's identity, the "start session" action, the four
  sections, the two archives, the Wunschliste and one Einstellungen entry. All
  three stay visible on
  the round's sub-screens, marking the section they belong to:
  - **Start** – the launchpad: hero with the members, a big "start session"
    button, resumable in-progress sessions, the last played result, and gentle
    retire recommendations for games that are rated low or often proposed for
    retirement.
  - **Regal** (shelf) – the game collection as a card grid with one „Filter"
    control holding both the custom-tag chips and the imported-BGG-metadata
    filters (see Sessions below), a search pill, sorting
    (random / name / rating),
    and the add-game sheet. Each card opens the game's detail page
    ("Spielepass") with its score ring, editable details, a **Jetzt spielen**
    launcher, and the history of sessions it appeared in.
  - **Chronik** – one month-grouped timeline of everything that happened:
    games added / retired / restored and session outcomes. Above the timeline,
    a **period recap** sums up one calendar month or year — sessions played,
    distinct games, the period's most-played and best-rated game, and what was
    added, retired or completed — over a picker offering only periods that
    actually have something in them. Any of them can be shared as an image: the
    card is drawn on the device and handed to the share sheet (or saved), so
    nothing is published anywhere.
  - **Pokale** (trophies) – a winners' podium (ties share a step) plus stat
    tiles: most played, best rated, current winning streak, and the
    "Staubfänger" — the game gathering dust the longest. Below the standings,
    a **Rückblick** turns the round's accumulated ratings into a readable
    record: totals, the worst-rated game, the one the group disagrees about
    most, and every member's own favourite. Pokale is the all-time record; the
    time-scoped view of the same idea is the Chronik's period recap above.
- **Sessions (hot-seat voting)** – pick who is playing tonight, optionally narrow
  the collection, and draw a random set of candidate games — only games whose
  player range fits the number of joining members are eligible. Narrowing happens
  in one place: a single **„Filter"** control beside the draw count. It opens over
  the screen rather than pushing it around — an anchored panel on a desktop, a
  sheet on a phone — so the pool preview it is shaping stays where it is, and
  whatever is currently filtering sits beside the button as chips you can drop one
  at a time. It holds both kinds of filter as labelled sections. The
  first is the round's own custom tags; the second is over the metadata imported
  from BoardGameGeek rather than anything the round maintains — a playing-time
  budget, a complexity range, the age of the youngest person at the table, and
  category / mechanic chips. That second half offers only
  the values the round's own games actually carry — a fifteen-game shelf lists
  the handful of categories those games have, not BGG's ~84 — and it is absent
  entirely on a shelf with no such data. A game BGG knows nothing about always
  stays in the pot. The data itself is fetched in the background as the shelf is
  looked at, so on a round whose games were added before this existed the
  controls fill themselves in over the first few visits rather than staying
  empty; a draw that uses one of these filters waits briefly for that to happen. From a tablet width up the setup screen splits in two: who is
  at the table on the left, and on the right the filter control, the draw count
  and a live panel showing exactly which games are currently in the pot, so
  seating one more player or excluding a tag visibly changes the shelf beside
  it. The tags,
  filters and count a round was last drawn with are remembered and preselected
  the next time, so a group that always draws the same way just confirms.
- **Voting** – the draw opens a **lobby** showing who has voted and who has not.
  There is nothing to configure and no mode to pick: every session works the same
  way, and each person's ratings are saved the moment they give them: one scale
  per drawn game, running from a trash tile — "get rid of it", the **zero** of
  the scale and members-only — up through **1–5**. Three ways in, freely
  mixed within one evening:
  - **pass the device around** – tap whoever is next, a handover screen names
    them so nobody peeks, and when they are done the lobby leads with the next
    person still open;
  - **from your own phone** – anyone whose seat is linked to their account opens
    the round and rates from wherever they are;
  - **from a shared link** – see below.

  Nobody has to be assigned a place beforehand — whoever is holding a device
  votes with it. Ratings stay secret until someone ends the voting, which anyone
  in the round can do, so a missing player or a flat battery never strands the
  evening. Because votes are saved as they are given rather than held until the
  end, an interrupted evening loses at most the card someone was on.
- **Voting by shared link, without an account** – any running session can be
  shared as one URL (a "share" button in the lobby, mint-on-demand). Its holder
  opens it, claims their own name from the session's participant list and rates
  the drawn games on their phone — no sign-up, nothing to install. The link is a
  capability for exactly that one session: it shows the round name, the drawn
  games and who has voted so far, and never a single rating, the result, or
  anything else about the round. It cannot add players (the draw already filtered
  the pool by the player count), and it stops working the moment voting closes,
  the session is cancelled or deleted, or 30 days pass.
- **What happened in a session** – every session keeps a short record of who
  started it, whose votes were submitted by whom, who ended the voting and who
  recorded the result, shown while voting runs and again under the results. It
  names the account that acted, not the device: "Anna voted for Ben" is something
  the app can actually know, "Ben voted on Anna's device" is not. Shared-device
  sessions keep it too, so the list always reads as complete.
- **Guests** – a visitor who isn't part of the group can be named on the setup
  screen: they count toward the player range the draw filters by, take their own
  hot-seat turn, can be recorded as a winner, and stay in that session's record
  marked as a guest — but they never join the round, so they leave the member
  list, the Pokale standings and the win streak untouched. A guest's scale starts
  at 1, with no trash tile: throwing a game off the shelf is the permanent
  group's call.
- **Teams** – two or more of the people joining a session — members and guests
  in any mix — can be grouped into a team that plays and wins together, for that
  session only. A team counts as **one player** when the draw matches a game's
  player range, so six people in three pairs can draw a three-player game, and
  the winner picker offers the team as a single chip: recording it credits every
  member individually, so the standings and the history read as before.
- **Jetzt spielen** (play now) – when the group already knows what they want,
  launch a session for **one specific game** straight from its detail page or a
  Pokale tile: pick who joins and skip the vote entirely, landing directly on
  the results screen with that game chosen.
- **Finale & results** – votes stay sealed until everyone is done, then a
  little show reveals the results: per-game average (colored by score), rating
  distribution (six bars, the leftmost being the retirement proposals), medals
  for the favourites, and how many want each game gone. Pick the
  game you actually played and mark it finished; recording the winner(s) is an
  optional follow-up step afterwards — or
  cancel the session if nothing appealed. Sessions can be deleted later, and a
  single game can be removed from a session's results.
- **Several tables from one vote** – a group too big for a single game ticks
  **„Mehrere Tische"** before the draw. The pool then admits any game that seats
  *some* table of three or more rather than the whole party, everyone votes once
  together as usual, and the results screen is replaced by a **table builder**: it
  proposes complete splits of the people and the drawn games, one per feasible
  number of tables, and the group picks between them or moves people and games by
  hand. Each table shows the average and the *lowest* rating among the people
  actually sitting at it, both updating live as anyone is moved, and it names —
  by name — everyone seated at a game they said they did not want to play. No
  score is shown: how many tables a room has is knowledge the app does not have,
  so the trade-off is the thing the group picks between rather than a number to
  argue with. There is no upper limit on the table count — a group of sixty gets a
  dozen tables or more. Confirming creates one ordinary session per table, with
  its game already chosen; the parent reads as **„Aufgeteilt"**, links to its
  tables, and each table links back. The proposals are computed once, on the
  server, and never move afterwards, so everyone in the room is looking at the
  same split.
- **Push a play to BG Stats** – a finished session can be handed to
  [BG Stats](https://www.bgstatsapp.com/) as a play: the game, the date, who took
  part and who won, as one link the user taps on their own device (nothing is
  sent server-side, and ratings deliberately do not travel — BG Stats has no
  per-player rating field). Off by default and enabled per account under
  **Konto → BG Stats**, because a website cannot tell whether the app is
  installed and the push happens on the tapping person's own device.
- **Ratings on demand** – a game's average is always computed live from all
  session votes, so deleting a session automatically corrects every average.
- **Designs** – per round, pick a colour scheme (page tone + accent); the
  whole UI derives from it — surfaces, shadows, the dark "stage" of the
  finale, and the mobile browser / installed-app chrome around the page.
- **Languages** – German, English, Spanish, French and Italian, following the system language by
  default, switchable any time via the picker in the top bar.
- **Shareable links & reload-safe navigation** – the URL reflects the current
  screen (home, a round tab, a game, a member, a session result, …), so a
  reload keeps you where you were and any stable view can be bookmarked or
  linked to. Browser Back/Forward move between visited views. Every screen the
  persistent navigation does *not* reach — a game, a member, a session's
  results, the archives, the round's settings screens, a profile, the new-round
  form — opens with a back control at the top of the content, which returns you
  where you came from rather than to a fixed parent. Opening a screen always
  lands you at its top; going back restores the position you left.
- **Denser lists on small screens** – a phone shows two shelf columns instead of
  one, roughly halving the scroll of a full shelf, and the home lobby tiles its
  round cards once there is room for a second one.
- **Installable app (PWA)** – a web app manifest and a service worker make the
  app installable to a phone or desktop home screen and let the app shell load
  **offline** (the shell and static assets are cached; live round data still
  needs the network). In keeping with the no-build-step stance, the manifest,
  service worker and icons are plain static files. Two places offer the install
  rather than leaving it to be discovered (issue #616): a permanent section on
  the Konto screen, and one dismissible card after a session is finished. Where
  the browser supports it that section opens the real install dialog; on iOS,
  which has no such API, it shows the two Share-menu steps instead.
- **Link previews** – sharing the app's URL in a messenger or on social media
  renders a card (title, description and a 1200×630 brand image) instead of a
  bare link. The Open Graph/Twitter tags live statically in `index.html` because
  scrapers don't run JavaScript; every deep link shows the same generic card, so
  no round or member name ever ends up in a preview.
- **Feedback** – a button in the top bar opens the contact form with a
  **Feedback** category preselected, together with the screen it was written on
  (issue #321). Submissions are **anonymous by default**: giving an e-mail
  address so the operator can reply is optional, for every category. The operator
  reads what comes in from the moderation panel (see below) — there is no
  third-party feedback service and no analytics script involved.
- **FAQ** – a public page at `/faq` (issue #489), linked from the site footer and
  from the bottom of the logged-out landing page, answering what people ask
  before signing up: whether everyone needs an account, whether it is really
  free, whether there is an app, whether it does more than board games, and what
  happens to the data. German (authoritative) and English in one document. It is
  **server-rendered**, and that is what keeps it honest on a self-hosted
  instance: an answer that instance cannot truthfully give — donations where
  `DONATE_URL` is unset, the account answers with accounts off, the data answers
  where no privacy policy is published — is left out of the page entirely rather
  than hidden with JavaScript a crawler never runs. Questions touching personal
  data link `/datenschutz` instead of restating it.
- **Support link (donations)** – when the operator sets `DONATE_URL`, a heart
  button in the top bar opens a small sheet whose single action is a plain
  link to the operator's donation page (new tab). Donations are voluntary and
  unlock nothing; the app contains no payment code and embeds no third-party
  widget — nothing is loaded from (or sent to) the donation platform until the
  link is clicked. With `DONATE_URL` unset the button does not exist.
- **Passkeys** – *accounts mode only* (issue #418). Sign in with a fingerprint,
  face or device PIN instead of a password. A passkey is an **additional**
  credential, never a replacement: the password and the e-mail reset stay
  exactly as they are, so losing every device cannot lock anyone out. Set them
  up under **Konto → Passkeys** (several per account, each renamable and
  removable); the login screen then offers **"Mit Passkey anmelden"**, which
  needs **no e-mail address typed at all** — the device offers whichever
  credential it holds for the site. Every device class works: Touch ID on a Mac,
  Windows Hello, Android and iOS biometrics, credentials synced through iCloud
  Keychain / Google Password Manager / 1Password, roaming hardware keys, and the
  cross-device QR flow (register on a laptop, sign in on a phone). **No
  biometric data ever reaches the server** — the fingerprint or face never
  leaves the device, and only a public key, which can unlock nothing, is stored.
  The button appears only on browsers that support WebAuthn.
- **Sharing a round, with roles** – *accounts mode only* (issues #207, #137).
  The owner invites another account by its **username** from Einstellungen →
  „Mitspielende einladen", fixing both the **seat** they take (an existing
  user-less member, or a fresh one) and their **role**. Two roles are on offer:
  - **Mitspielen** (player) – the default, and everything a round is normally
    for: start sessions and vote in them, add and edit games, retire or complete
    them, manage seats, tags and the round's design.
  - **Mitverwaltung** (co-manager) – all of that, plus the destructive actions:
    delete a session, delete a Chronik entry, delete an archived game, and
    rename the round.

  Four things stay with the **owner alone**, whatever role they hand out:
  deleting the round, changing or revoking anyone's access, relinking a seat to
  an account, and moving the shelf into another round. So a co-manager is
  trusted with the round's *content*, never with who may reach it — they cannot
  promote themselves. The role can be changed later, or the share revoked, from
  that person's member page; a grantee can always leave a round themselves.
  Whatever the UI offers, the server decides: an action a role may not perform
  is refused even if the request is made by hand.
- **Friends (Freundeskreis)** – *accounts mode only* (issue #325). Send a friend
  request to another account by its **username**; the recipient accepts or
  declines it in the in-app inbox. Friends then see each other's activity in a
  **Freundeskreis feed** (a tile on the home dashboard plus a dedicated
  view at `/freunde`): only "*added a game*" and "*played a game*" notes with the
  **game title and cover** — never member names, ratings, votes or round names,
  and only for activity after you became friends. A friendship shares **no round
  data**; it is purely social. Unfriending is unilateral and immediate in both
  directions. With accounts off the whole feature is inert.
- **E-mail for actionable inbox items** – *accounts mode only* (issue #618). A
  round invitation or a friend request is also **e-mailed** to its recipient, not
  only dropped in the in-app inbox — an invitation exists to reach someone who is
  *not* in the app, so in-app-only delivery meant an invited stranger saw it
  whenever they next happened to log in. Only those two item types are mailed
  (an explicit allowlist, so a future inbox type mails nobody until someone
  decides it should), and nothing about the Freundeskreis feed ever is. Both can
  be switched off individually under **Konto → Benachrichtigungen**; the mail
  links there. Bounded three ways: at most **one message per recipient per
  hour** (several requests inside the window are combined into one that names
  the count), a quarter of the daily send budget reserved for verification and
  password mail that notifications may never touch, and no mail at all to guest
  demo accounts or unverified addresses. The body names the sender's public
  username and the kind of request — never a round name or any other free text.
- **„Was ist neu"** (issue #741). A small screen at `/neu`, reached from the
  account menu, listing the handful of genuinely new capabilities that have
  shipped — newest first, in your language. A **dot on the account button**
  appears when there is an entry you have not seen, and the „Was ist neu" row
  inside that menu repeats it (issue #764) — the button is a menu rather than a
  destination, so without the second mark the trail ends at five unlabelled
  rows. Opening the screen is the acknowledgement and clears both. Deliberately **pulled, never pushed**: no
  banner, no toast, no interstitial, because the app already has one strip that
  legally has to be read (the terms-change notice) and a second one on a cadence
  would teach people to dismiss both unread. The bar for adding an entry is high
  — a new capability, never a fix, a tweak or a redesign — so most releases add
  nothing and the list starts out empty. Entries live in the deployed code, so a
  self-hosted instance shows exactly what shipped with its version. With accounts
  off the screen still opens; there is simply no account to badge it against.
- **Account profiles** – *accounts mode only* (issue #558). Every account has a
  profile at `/u/‹username›`, reachable by clicking a name in the Freundeskreis
  and usable to check you have the right person **before** sending a request.
  It shows the username, its avatar, "member since ‹month›" and the one friend
  action your current relationship allows (send / cancel / accept+decline /
  unfriend) — plus that account's feed, but **only between accepted friends**
  and still only for activity after you became friends. Nothing tenant-private
  is shown: no e-mail address, no shelf, no sessions, no ratings. Signing in is
  required, so profiles are not public web pages and are not crawlable.
- **Entdecken** – *live by default; PUBLIC_STATS_ENABLED=false takes it down* (issue #564). Publishes
  the whole instance at a glance: how many rounds, players, shelf games and
  played sessions it holds, plus the games on the most shelves and the ones most
  played this week / month / year, and the best-rated. It appears on the logged-out landing
  page, on a shareable `/entdecken` screen and as a home-dashboard tile showing
  the first few rankings with their cover art —
  and, unlike everything above, is **public**: a visitor with no account sees it.
  Two consequences follow from that. Every game name comes from BoardGameGeek
  rather than from the title someone typed, so nothing user-authored can reach
  the page — which also means a hand-typed game counts in the totals but never
  appears in the rankings. And each figure stays hidden until enough is behind
  it (a ranking needs several *different* accounts behind it, not one account
  with several rounds),
  so the page fills in on its own as an instance grows instead of publishing a
  number that flatters nobody. Demo accounts are excluded throughout.
  Because the `/entdecken` screen is meant to be *shared* with people who have
  never seen the app, a logged-out visitor is offered a way in at the bottom of
  it (issue #786): the demo where the instance has one, otherwise registering or
  logging in. A logged-in visitor sees the statistics alone.
