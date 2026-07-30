# Features

What the app does, in detail. For a short overview see the
[README](../README.md); for how it is built see
[`architecture.md`](architecture.md).

- **Rounds** – a group with a name and any number of members. The home screen
  is a lobby of round cards (members, game/session counts, last result); a new
  round is set up on a playful "seats around the table" screen, optionally
  importing the games list from an existing round. Groups change, so a further
  seat can be added later from the "+" in the round's member strip. With accounts on, the seat at
  the head of that table is **yours** — the creator is seated automatically (opt
  out with "Ich spiele mit"), and on any other round a member page offers
  „Das bin ich" so your account can take its own seat. A claimed seat is what
  puts your name on your actions in the Chronik.
- **Games** – each game has a title, a required player range (min–max), any
  number of custom round **tags** (see below), and an optional cover image (paste
  from clipboard or pick a file). When adding a
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
  still shows the others' results).
- **Import a BoardGameGeek collection** – filling a shelf one game at a time is
  the slow part of setting a round up, so link your BGG username once under
  **Konto** and the Regal can pull in everything you have marked as *owned*
  there in one go. You get a checklist to confirm (everything preselected, games
  already on the shelf marked and skipped), and the games arrive with their
  titles, player ranges, covers and a link back to BGG. It is **one-shot and on
  demand** — never a background sync — and it needs no BGG password: a username
  is enough, and you can unlink it again at any time. Accounts mode only, and
  only for rounds that still have BoardGameGeek among their providers.
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
  showing — re-link the game or upload your own picture.
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
  campaign, a legacy box, a story-driven video game. A game is active, retired
  or completed, never two at once, and either archive can be reached from the
  round hub's footer. Only an already-archived game can be permanently
  deleted. Games can be **moved between rounds**: "Spiele verschieben" in the
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
  sections, both archives and the settings screens. All three stay visible on
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
  eligible. The tags and count a round was last drawn with are remembered and
  preselected the next time, so a group that always draws the same way just
  confirms. The device is then passed around: a handover screen names whose
  turn it is, and each member rates every drawn game **1–5** or proposes to
  retire it (member order is randomized).
- **Guests** – a visitor who isn't part of the group can be named on the setup
  screen: they count toward the player range the draw filters by, take their own
  hot-seat turn, can be recorded as a winner, and stay in that session's record
  marked as a guest — but they never join the round, so they leave the member
  list, the Pokale standings and the win streak untouched. A guest rates games
  but gets no "retire" vote: throwing a game off the shelf is the permanent
  group's call.
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
- **Ratings on demand** – a game's average is always computed live from all
  session votes, so deleting a session automatically corrects every average.
- **Designs** – per round, pick a colour scheme (page tone + accent); the
  whole UI derives from it — surfaces, shadows, even the dark "stage" of the
  finale.
- **Languages** – German and English, following the system language by
  default, switchable any time via the picker in the top bar.
- **Shareable links & reload-safe navigation** – the URL reflects the current
  screen (home, a round tab, a game, a member, a session result, …), so a
  reload keeps you where you were and any stable view can be bookmarked or
  linked to. Browser Back/Forward move between visited views.
- **Denser lists on small screens** – a phone shows two shelf columns instead of
  one, roughly halving the scroll of a full shelf, and the home lobby tiles its
  round cards once there is room for a second one.
- **Installable app (PWA)** – a web app manifest and a service worker make the
  app installable to a phone or desktop home screen and let the app shell load
  **offline** (the shell and static assets are cached; live round data still
  needs the network). In keeping with the no-build-step stance, the manifest,
  service worker and icons are plain static files.
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
