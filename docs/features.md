# Features

What the app does, in detail. For a short overview see the
[README](../README.md); for how it is built see
[`architecture.md`](architecture.md).

- **Rounds** – a group with a name and any number of members. The home screen
  is a lobby of round cards (members, game/session counts, last result); a new
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
  game, the title field doubles as a **search-as-you-type lookup**: it queries
  the **PlayStation Store**, **Steam**, the **Nintendo eShop** and the
  **Xbox / Microsoft Store** (digital games) and **BoardGameGeek** (board games)
  together and merges the hits into one
  dropdown. When several stores return the **same title** (e.g. a cross-platform
  game), they collapse into a **single row with one badge per store** — click
  a badge to fill from that store, or the title to use the top match. Pick a
  suggestion to auto-fill the title, cover art and player range, and store a link
  back to the source page (shown on the game's detail
  view). The lookup is optional — manual entry works exactly as before, and the
  app degrades gracefully when a source is unreachable (one provider failing
  still shows the others' results). If the title you type is already in the
  round, the sheet says so — separately for the shelf and for the archive — but
  never stops you saving it, since a second copy is sometimes exactly what you
  mean.
- **Pick the cover of your edition** – a board game is usually printed in a dozen
  languages, and the picture BoardGameGeek serves by default is rarely the box on
  your shelf. So wherever a game is linked to BGG you can open its **edition
  covers** and choose one: while adding the game, on its detail page, and for each
  game in the collection import. Editions in your own UI language come first,
  then English, then the rest; each tile names the edition and its year. The list
  is only fetched when you open it, and — like every other provider picture — the
  cover stays a link to BGG's own servers rather than a copy on this instance.
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
  it again at any time. Accounts mode only, and only for rounds that still have
  BoardGameGeek among their providers.
- **Providers per round** – each round chooses which of the five databases its
  lookups query (a "Provider" screen next to Tags in the round hub). A
  board-games-only group can switch the four digital stores off so their hits
  stop crowding the dropdown — and the requests stop being made at all. A round
  that never configures it queries all five, as before; turning *every* provider
  off is allowed too and simply leaves the title field a plain text input.
  **Provider cover art is hotlinked, not copied:** the picture is loaded straight
  from the store's own servers rather than downloaded onto this instance, because
  re-hosting the four digital stores' box art on a public service needs a licence
  they don't offer (issue #172). BoardGameGeek *does* grant one with its XML API
  token (#117), so BGG covers stay hotlinked only for want of an image-resizing
  pipeline. Your own uploaded covers are stored normally. One
  consequence to expect: if a store moves or removes an image, that cover stops
  showing. A linked game's cover editor therefore offers **"Titelbild von
  \<Anbieter\> holen"**, which re-asks the provider for the current picture —
  one click, whether the game lost its cover or never had one (issue #518).
  Details can be edited inline on the game's detail page. A game added by hand
  (with no source link) can be **linked to a provider after the fact** from its
  detail page: search the providers, pick the match, and choose which differing
  fields (name, cover, player count) to take from it — the source
  link is always saved. A link can also be **removed again** from the same
  detail page if the match turns out to be wrong; a hotlinked provider cover is
  cleared with it (your own uploaded cover is kept). Games are never lost by accident:
  instead of deleting, they are **archived** — kept with a timestamp in a
  browsable archive and restorable any time. There are two archives, because
  the reason matters: **retired** ("Aussortiert") means the group wants rid of
  the game, **completed** ("Durchgespielt") means they finished its content — a
  campaign, a legacy box, a story-driven video game. Alongside them sits the
  **Wunschliste** — games the group wants but does not own yet, added by hand
  through the same add-game sheet or pulled in one shot from a linked
  BoardGameGeek **wishlist**. That import carries **expansions** too, which is
  most of what a real wishlist holds — you own Catan, you want Seefahrer — and
  each one says which game it belongs to. A wish never turns up in a vote, a draw
  or any count of the shelf, because the group cannot put it on the table; "Ins
  Regal" moves it across the day they buy it, and that is when the round's
  Chronik and the Freundeskreis feed report it — wanting a game is not news,
  getting it is. "Ins Regal" on a wished expansion instead records it on its base
  game's expansion list, bringing that game along if the round does not have it
  yet, so the expansion widens what the game can be drawn at rather than becoming
  a box of its own that nobody can play.
  A game is active, retired, completed or wished-for, never two at once, and all
  three lists are reached from the round hub's footer. Every row on those lists
  opens the game's own detail page, so a game keeps its full editing surface —
  title, cover, player range, tags — after it has left the shelf; the page then
  offers only the way back onto it. The distinction carries through to the Pokale tab: a
  retired game stops being named as anyone's favourite or as the game the group
  disagrees about, because retiring it withdraws that preference — while the
  nights you actually played it still count toward "Meistgespielt". A completed
  game keeps counting everywhere. Only a game that is already off the shelf —
  archived or wished-for — can be permanently deleted. Games can be **moved between rounds**: "Spiele verschieben" in the
  shelf's footer lists the round's games — archived ones included, labelled —
  each pre-checked, so confirming untouched consolidates the whole round while
  unchecking splits off just part of the shelf. Moved games keep their covers,
  provider links and tags, and same-named tags are merged into the target. The
  source round stays behind; a moved game drops out of its sessions, since a
  session cannot reference games that now live elsewhere (a session left with
  no games at all is dropped). Moving is owner-only — the action is not offered
  on a round that was shared with you.
- **Tags** – every round can define its own free-form tags (e.g. "outside",
  "quick lunch break", "digital", "co-op") on a dedicated screen, reached from
  the Start tab or, on a wide screen, the round rail. Tags are the single way to categorize games. Assign
  any number of tags to a game — in the add-game sheet or later from the game's
  detail page, creating new tags inline — and filter both the Regal and the
  session draw by them (tri-state chips: off / include / exclude; included tags
  combine with AND, excluded tags reject any match). Each tag can carry an
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
  - **Regal** (shelf) – the game collection as a card grid with custom-tag
    filter chips, a search pill, sorting
    (random / name / rating),
    and the add-game sheet. Each card opens the game's detail page
    ("Spielepass") with its score ring, editable details, a **Jetzt spielen**
    launcher, and the history of sessions it appeared in.
  - **Chronik** – one month-grouped timeline of everything that happened:
    games added / retired / restored and session outcomes.
  - **Pokale** (trophies) – a winners' podium (ties share a step) plus stat
    tiles: most played, best rated, current winning streak, and the
    "Staubfänger" — the game gathering dust the longest. Below the standings,
    a **Rückblick** turns the round's accumulated ratings into a readable
    record: totals, the worst-rated game, the one the group disagrees about
    most, and every member's own favourite.
- **Sessions (hot-seat voting)** – pick who is playing tonight, optionally filter
  the collection by custom tags, and draw a random set of candidate games —
  only games whose player range fits the number of joining members are
  eligible. From a tablet width up the setup screen splits in two: who is at the
  table on the left, and on the right the tag filter, the draw count and a live
  panel showing exactly which games are currently in the pot, so seating one
  more player or excluding a tag visibly changes the shelf beside it. The tags
  and count a round was last drawn with are remembered and preselected the next
  time, so a group that always draws the same way just confirms.
- **Voting** – the draw opens a **lobby** showing who has voted and who has not.
  There is nothing to configure and no mode to pick: every session works the same
  way, and each person's ratings are saved the moment they give them (**1–5** per
  drawn game, plus an optional "retire this" for members). Three ways in, freely
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
  list, the Pokale standings and the win streak untouched. A guest rates games
  but gets no "retire" vote: throwing a game off the shelf is the permanent
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
  distribution, medals for the favourites, and retirement proposals. Pick the
  game you actually played and mark it finished; recording the winner(s) is an
  optional follow-up step afterwards — or
  cancel the session if nothing appealed. Sessions can be deleted later, and a
  single game can be removed from a session's results.
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
- **Languages** – German and English, following the system language by
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
- **Friends (Freundeskreis)** – *accounts mode only* (issue #325). Send a friend
  request to another account by its **username**; the recipient accepts or
  declines it in the in-app inbox. Friends then see each other's activity in a
  **Freundeskreis feed** (a compact section on the home screen plus a dedicated
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
- **Account profiles** – *accounts mode only* (issue #558). Every account has a
  profile at `/u/‹username›`, reachable by clicking a name in the Freundeskreis
  and usable to check you have the right person **before** sending a request.
  It shows the username, its avatar, "member since ‹month›" and the one friend
  action your current relationship allows (send / cancel / accept+decline /
  unfriend) — plus that account's feed, but **only between accepted friends**
  and still only for activity after you became friends. Nothing tenant-private
  is shown: no e-mail address, no shelf, no sessions, no ratings. Signing in is
  required, so profiles are not public web pages and are not crawlable.
