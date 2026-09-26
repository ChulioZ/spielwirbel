# Tech & architecture

How the app is put together, and what every file is for. The constraints
behind these choices — and why they are not up for casual revision — are in
[`CLAUDE.md`](../CLAUDE.md).

- **Backend:** Node.js + [Express](https://expressjs.com/). Routes read and write
  through a small **data-access layer** (`lib/repo/`) with two interchangeable
  backends: by default a single `data/data.json` file (loaded into memory, written
  atomically on every change — zero-dependency, right for local/home use), or
  **PostgreSQL** when `DATABASE_URL` is set (the stateless path for a hosted
  deployment; the app ensures its schema on startup). All round data is
  **tenant-scoped** (issue #136): every request resolves to a tenant (the single
  `default` tenant unless user accounts are enabled) and the data layer only
  ever sees that tenant's rounds — on Postgres additionally enforced by
  row-level security in the database itself. Cover images go through a
  matching storage seam (`lib/storage/`): files under `data/uploads/` by default,
  or **S3-compatible object storage** when `S3_BUCKET` is set (so uploads survive
  an ephemeral/scaled host). Only the `/uploads/<key>` path is persisted either
  way.
- **Frontend:** plain HTML/CSS/vanilla JS under `public/` — **no build step for
  development** (`npm start` serves `public/` directly). An *optional*
  cache-busting build (`npm run build`, issue #141) mirrors `public/` into
  `dist/` with content-hashed, minified JS/CSS for production; the server serves
  it only under `NODE_ENV=production`. It exists purely to bust stale asset
  caches after a deploy — not a bundler or framework.
- **Designs are per USER, and one design may be a whole layout** (issue #1184).
  A design used to be per *round* and was only ever two colours: a page tone and
  an accent, written as inline custom properties on `<html>`. The
  designs the programme ships (`docs/design/`) change layout as well as colour,
  so they need a root hook every rule can key off and a stylesheet of their own:
  `<html data-design="…">`, set by `applyDesign()` (`public/js/design.js`) from
  the registry in `public/js/designs.js`, with one **override stylesheet per
  design under `public/css/designs/`, injected on first wear** rather than
  shipped in `index.html`. Klassisch has no override file — `styles.css` *is*
  Klassisch — and declares no colours, which is what makes "Klassisch looks as it
  always did" a property of the code rather than a coincidence of two hexes.

  Three consequences worth knowing before touching any of it. **A design's
  colours live in the registry, its layout in the stylesheet**, because the
  contrast suite resolves each design's tokens from `page`/`accent`/`scheme`
  against `styles.css` — a colour in an override file would ship unmeasured.
  **Rounds own no design since the flip (#1202)**: `paintDesign()`
  (`public/js/round-theme.js`) puts the account's design on every screen, and a
  round screen adds only its colour marker (`applyMarker`). A round's stored
  `background` is still read — `public/js/round-marker.js` maps a retired palette
  or world onto the marker it becomes. **Every account wears Der Tisch until it
  answers the chooser**, resolved lazily on read in `lib/account-design.js` with
  no migration. And **the gate is in code, not an env var** — each registry entry carries `enabled`, the server strips the
  disabled ones under `NODE_ENV=production` and reports the rest on
  `GET /api/config`, so enabling a design is a one-line PR. See
  `.claude/rules/design-stylesheets-are-shell-assets.md` for the two cache
  traps that come with a runtime-injected shell asset.
- **Hardening:** [helmet](https://helmetjs.github.io/) sets security headers
  (CSP, `X-Content-Type-Options`, frame options, HSTS) and
  [express-rate-limit](https://express-rate-limit.mintlify.app/) caps requests
  with a generous global limit, which the static shell assets are exempt from
  (#464) so a page load costs one request rather than ~50.
  Mutating request bodies are validated at the router boundary with
  [zod](https://zod.dev/) schemas (via `lib/validate.js`).
  TLS is expected to terminate at a reverse proxy (`TRUST_PROXY` then forwards
  the real client IP); see the env vars below. Responses are gzip-compressed
  ([compression](https://github.com/expressjs/compression)), and content-hashed
  build assets are served immutable (`sw.js` stays no-cache so updates roll out).
- **Observability:** a `/healthz` liveness probe and a `/readyz` readiness probe
  that checks the data backend, structured JSON
  request/error logs to stdout (`LOG_LEVEL`, no bodies or personal data), and a
  central error handler so unexpected throws never leak a stack trace — they
  return a generic 500 and are logged (and optionally forwarded to
  `ERROR_WEBHOOK_URL`). The same logger also emits a handful of product-usage
  events (round/session/game/tag created, session finished) carrying only the
  event name and tenant id — no analytics service, no cookies, no client-side
  tracking. See `lib/observability.js`.
- **Runs entirely on your machine.** Fonts and the icon set are self-hosted
  under `public/fonts/`, and the subtle background grain is an inline SVG in the
  stylesheet — no CDNs. The only runtime external calls are **opt-in**: the
  add-game lookup queries BoardGameGeek server-side (via
  `/api/rounds/:rid/lookup/*`) only when you type a title to search; it sends
  just the search text, and the app works fully without it. **BoardGameGeek
  needs a key:** its XML API requires a registered application and a bearer
  token in `BGG_API_TOKEN` (create one at
  [boardgamegeek.com/applications](https://boardgamegeek.com/applications)).
  Without it the lookup silently returns nothing — nothing logs and nothing
  errors, so check the env var itself if games stop being found. Because BGG
  answers a search with the name that *matched*, typing a title in your own
  language finds and fills in that name. Four digital storefronts (PlayStation
  Store, Steam, Nintendo eShop, Xbox) were lookup providers until #744 retired
  them; games already linked to one keep their link and their cover.

```
server.js            starts the HTTP server (the only place that listens)
lib/
  app.js             builds the Express app: static files + route modules,
                     plus the SPA fallback (serves index.html for frontend
                     routes so deep links / reloads work)
  repo/              data-access layer: the async API every route reads/writes
                     through (getRound + typed mutators). One seam, two backends:
    index.js         picks the backend (DATABASE_URL ? postgres : json)
    json.js          default backend — the data/data.json store below
    postgres.js      PostgreSQL backend (Knex query builder), used when DATABASE_URL set
    saved-filters.js a round's saved session filters (#1328): the unique-name,
                     per-round cap and exact-permutation rules, run by both
                     backends inside their own lock
    import-copy.js   what travels when a new round imports another round's
                     games (#921) — shared by both backends so a copy carries
                     the same fields whichever one is running
    corpus-file.js   the JSON backend's BGG-corpus store (issue #681) — its OWN
                     file under DATA_DIR, never data.json, because store.js
                     rewrites that whole file on every mutation
    corpus-backfill.js  the one-off window in which both backends re-queue
                     corpus rows enriched before covers were parsed (#779);
                     deletable once the corpus has turned over
    migrations/      versioned Knex schema migrations (npm run migrate)
  tenant.js          resolves each request's tenant and scopes the repo to it
  round-access.js    the one place a round-level action's required role is
                     decided — the route-to-capability table plus the middleware
                     that refuses an unlisted mutating route (issue #137)
  store.js           the JSON backend's engine: in-memory data + atomic
                     load/save to the data/ folder, id/activity helpers
  storage/           cover-image storage: one seam, two backends
    index.js         picks the backend (S3_BUCKET ? s3 : disk)
    disk.js          default backend — files under DATA_DIR/uploads
    s3.js            S3-compatible object storage, used when S3_BUCKET set
  upload-access.js   decides WHOSE /uploads object a request may read — the
                     owning tenant, a grantee on the referencing round, or (for
                     a profile picture) any signed-in account (issue #955)
  upload.js          multer image-upload config (persists via lib/storage) —
                     two instances, one per kind; both sniff magic bytes and
                     then re-encode, so the stored type is always ours
  avatar.js          re-encodes an account profile picture to one square webp,
                     stripping EXIF/GPS and flattening animation (issue #841)
  cover.js           re-encodes an uploaded game cover to a bounded webp — fitted
                     INSIDE the ceiling (never cropped), EXIF/GPS stripped, plus
                     the "already converted?" predicate the operator backfill
                     presses against (issue #867)
  auth.js            shared-password gate (active when AUTH_PASSWORD is set)
  admin.js           operator gate for the moderation surface (separate
                     ADMIN_PASSWORD; 404s unless set — issue #268)
  admin-exclusions.js  which tenants the panel's „Funktionsnutzung" card leaves
                     out (ADMIN_EXCLUDE_TENANTS), so its shares describe other
                     people's usage rather than the operator's own (issue #1174)
  accounts.js        user-account primitives: Argon2id passwords, access/refresh
                     tokens (issue #135; off unless ACCOUNTS_ENABLED)
  webauthn.js        passkey primitives (issue #418): the RP identity and the
                     stateless, scope-separated signed challenge. The
                     attestation/assertion crypto itself is
                     @simplewebauthn/server's; this is the policy around it
  quota.js           per-tenant state caps — rounds/tenant, games/round,
                     tags/round, members/round (issue #139; inert unless
                     ACCOUNTS_ENABLED)
  web-manifest.js    GET /manifest.webmanifest per design (#1199): the static
                     file untouched for a colourless design (Klassisch), else
                     the file re-dressed in the design's icons, theme and
                     splash colour — the face's (Der Tisch) for the bare URL,
                     any selectable one for ?design=<id>. Reads no
                     account; mounted in front of express.static, as open as
                     the file
  faq.js             the server-rendered FAQ page, one language per page in
                     every shipped locale (#1088), with each answer an instance
                     cannot honestly give gated out (issue #489)
  feed.js            the Freundeskreis activity feed's allowlisted events (#325)
  feed-events.js     the feed's accepted event types, one dependency-free set
                     both repo backends require rather than each holding a copy
  corpus.js          the licensed BoardGameGeek game corpus (issue #681): the
                     operator-uploaded ranks dump, filtered and capped, plus the
                     bounded, resumable enrichment pass that fills each row's
                     attributes from /thing. A local candidate pool exists
                     because BGG's API has no browse or attribute search at all
  calendar-periods.js
                     the current calendar week / month / year on ONE fixed zone
                     (Europe/Berlin), for the Discover podiums (issue #964).
                     Both repo backends take their boundaries from here rather
                     than each deriving them, so the two cannot drift; DST is
                     avoided by construction, never handled
  public-stats.js    the instance-wide statistics published on the landing page
                     and /entdecken (issue #564; off unless
                     PUBLIC_STATS_ENABLED). Ranks the repo's raw provider-keyed
                     aggregate, resolves only the handful of games that could
                     reach a podium from the provider — never from the
                     user-typed title — and caches the payload for the route
  actor-seat.js      which member seat to attribute a round activity to; one
                     definition shared by the games and members routes (#563)
  edition.js         the printing a game's cover was picked from, normalized and
                     bounded once for both writers — the single add (flat
                     multipart fields) and the bulk import (a map beside
                     `covers`) — so they cannot accept different things (#742)
  recommend.js       "das könnte euch auch gefallen" (issue #682): the taste
                     profile built from a round's own shelf and sessions, and
                     the deterministic weighted score that ranks the corpus
                     against it. Pure, no model, no outbound call — every
                     recommendation is a real BGG row that says why it is there
  recommend-spotlights.js  the three spotlight tiles above that list (#1228):
                     each re-scores the same candidates with ONE term altered
                     (taste inverted, complexity shifted half a step, pool cut
                     to rarely-rated rows) — scored in recommend.js's one pass
  corpus-cache.js    the corpus held in process memory for that scoring, so a
                     recommendation costs no multi-megabyte read per request;
                     dropped on every write lib/corpus.js makes, plus a TTL for
                     the writes another replica made (issue #682)
  draw-filters.js    the FILTER half of a draw (tags, tag mode, metadata,
                     multi-table, count) resolved against a round — one function
                     shared by the session draw and the saved-filter route
                     (issue #1328)
  draw.js            the session draw's game pool + shuffle: the one named
                     "is this game active" predicate both of the sessions
                     route's guards go through (issue #486)
  game-owners.js     which members of a round own a game: the owner-id
                     validation and the per-seat memory of the last selection,
                     shared by the add-game and BGG-import write paths
                     (issue #971)
  session-votes.js   vote secrecy for a session collecting votes from several
                     devices: strips the ratings already cast out of the round
                     payload while voting is open, leaving only who has voted
                     (issue #209)
  session-split.js   splitting one voted session across several tables (#796):
                     the proposals, the validation a hand-edited arrangement
                     must pass, and the child sessions a confirm creates — the
                     part of that flow that needs only a round and a session
  session-events.js  writes the session activity log: builds one entry and
                     appends it inside the repo mutator's own read-modify-write,
                     so the log cannot drift from what it records (issue #209)
  demo.js            guest demo mode: mints, seeds and purges throwaway demo
                     accounts (issue #427; off unless DEMO_ENABLED)
  demo-seed.js       the content a demo tenant is seeded with — three rounds,
                     each with its colour marker, games (hotlinked provider covers plus
                     resolved provider metadata), tags, sessions and per-locale
                     text (issues #427, #953)
  user-stats.js      one account's play record aggregated over every member seat
                     it holds, in its own and in shared rounds (issue #1089).
                     Runs public/js/member-stats.js per seat rather than
                     re-deriving it, and returns plain numbers and game titles
                     only — no round name, round id, member name or tenant id.
                     Its `badges` are the account-tier Abzeichen, from
                     public/js/achievements.js (issue #1387)
  user-plays.js      the same walk, as a flat list: one row per finished session
                     the account sat at (time, game, its own rating), for the
                     own profile's „Dein Rückblick" — bucketed into months on
                     the CLIENT, by the reader's calendar (issue #1147)
  demo-tenant.js     the one definition of the `demo-` tenant-id prefix that
                     classifies a tenant as a demo, dependency-free so the repo
                     backends and the logger can require it without a cycle
  vote-link.js       the vote link's TTL (issue #652): the age half of the
                     public route's gate, plus the sweep that deletes rows past
                     it. Exists because an ABANDONED session — never closed,
                     never cancelled — reaches none of the five event-driven
                     deletions, so without a max age its link never expires
  erasure-actions.js the moderation-log actions that are Art. 17(3) erasure
                     proofs and are therefore exempt from the retention purge
                     (issue #311). One list, dependency-free, so both repo
                     backends require it without the cycle that keeping it in
                     retention.js would create
  retention.js       the moderation log's 3-year retention purge (issue #311):
                     the year-end cutoff #140's promise is written in, plus the
                     sweep and its audit record. Deletes nothing before 2030 by
                     construction — the earliest entries that can expire are
                     2026's
  scheduler.js       background jobs, started from server.js only: the
                     expired-demo purge (issue #427), the expired-vote-link
                     sweep (issue #652), the stored-price sweep (issue #688),
                     the moderation-log retention purge (issue #311), the
                     public-statistics rebuild (issue #564) and the BGG
                     corpus enrichment pass (issue #681)
  shutdown.js        the SIGTERM/SIGINT drain server.js installs — stops the
                     scheduler, lets in-flight requests finish, destroys the
                     pool, with a force-exit fallback. A factory taking its
                     collaborators, so it is testable without opening a port
  mail.js            outbound e-mail (SMTP via nodemailer when SMTP_HOST is
                     set, else logged to an in-memory outbox), plus the global
                     daily send budget (MAIL_DAILY_MAX, issue #448) and its
                     critical/notification split (issue #618)
  notify.js          e-mails an actionable inbox item to its recipient (round
                     invitations, friend requests — issue #618): a per-type
                     allowlist, the two per-account opt-outs, a one-per-hour
                     per-recipient throttle and coalescing
  legal.js           server-rendered Impressum / privacy policy /
                     Nutzungsbedingungen in DE + EN (issues #134/#140)
  account-design.js  which design an account wears (resolved against the
                     registry's `enabled` gate) and when a change counts as
                     going back to Klassisch — shared by /me, the two design
                     routes and the operator's „Designs" tile (issue #1201)
  me-projection.js   the ONE description of what a client may see about an
                     account (issue #785) — answered by GET /me and by all
                     three endpoints that start a session (password login,
                     passkey login, demo), so the client's `accountUser` is
                     never missing a field, and so the stored record's hashes
                     and challenges cannot leak through a hand-built payload
  canonical.js       301s the branded non-canonical domains onto one origin
                     (issue #230; an allowlist, never an inverse rule)
  validate.js        zod request-body schemas applied at the router boundary
  tag-icons.js       the curated tag-icon set (mirrored by public/js/tag-icons.js,
                     with a test asserting the two stay identical)
  csv.js             RFC 4180 CSV writer for the operator panel's exports
                     (issue #288) — quotes every field, so a feedback message
                     with commas/quotes/newlines cannot corrupt the file, and
                     neutralizes leading =/+/-/@ so it cannot become an Excel
                     formula — plus the matching reader (issue #681) the BGG
                     ranks dump is parsed with
  observability.js   structured logging, /healthz + /readyz, central error handler
  status.js          aggregate usage metrics + the quota ceilings for the
                     operator panel's two Kennzahlen cards — Grenzen &
                     Kontingente and Funktionsnutzung (issues #274/#404/#1124) —
                     counts only, never a secret value and never personal data
  provider-info.js   lazy backfill of BGG's standard metadata onto linked
                     games (issues #717/#724/#736/#828/#829): eligibility (a
                     TTL-stamped attempt marker) and the best-effort fill every
                     trigger point shares — game-detail open, collection
                     import, session start, the two filter screens' shelf-wide
                     fill, and the one blocking fill a filtered draw performs.
                     Its header lists all five; only games the provider was
                     really asked about are stamped. Reads the local BGG corpus
                     first (#829) — one query, one write for the whole shelf —
                     and asks BGG only about what it lacks, in paced batches of
                     at most 20 ids (#828)
  provider-cache.js  the shared 10-minute cache for provider hops (search,
                     detail, collection, cover refresh), so a repeated click
                     or a debounced keystroke costs nothing upstream. A caller
                     may pass its own TTL for one hop — prices/ does, because
                     its upstream requires an hour
  providers/         external game-database providers for the add-game lookup
    index.js         provider registry + image-host allowlist, the frozen
                     legacy cover hosts the CSP still renders (#744), and
                     cover resolution for a stored source link (issue #518)
    bgg.js           BoardGameGeek: search + detail + owned-collection import
                     via BGG's official XML API2 under an application token
                     (board games) — the only registered provider since #744
  prices/            what a wished-for game costs right now (issue #679).
                     Deliberately NOT a second entry under providers/: those
                     answer "which game is this?" and are wired into the
                     add-game lookup; a price source answers a different
                     question and must not reach that registry.
                     Off unless PRICES_ENABLED=true
    index.js         dispatch on the game's stored source link, the hour-long
                     cache, the degrade-to-{available:false} contract, and the
                     stored last-known price (#688) served — age-first — while
                     a source is unreachable, swept past its display ceiling
    boardgameprices.js  Brettspielpreise.de / BoardGamePrices, keyed on the
                     BGG id (board games): picks the GAME's own edition (the box
                     its cover was picked from, #742), falling back to the
                     reader's language, and the cheapest in-stock offer whose
                     shipping is known. The market — where it ships and in what
                     currency — follows the reader either way
  routes/            Express routers, one per resource; mounted by app.js
                     above. Under lib/ so every backend concern lives in one
                     package and app.js never reaches upward out of its own
                     package to find them
    auth.js          /api/auth              (shared-password login/logout/status)
    account.js       /api/account           (user accounts: register, verify
                                             e-mail (+ resend), login, refresh,
                                             logout, forgot/reset password,
                                             change password (#482), delete the
                                             account itself (#419), me,
                                             acknowledge a terms change (#521),
                                             and the per-user notification inbox
                                             (#207) — 404 unless ACCOUNTS_ENABLED)
    invitations.js   /api/account/invitations (round-sharing: send / accept /
                                             decline; the inviter fixes the
                                             member-seat take-over (#207) —
                                             404 unless ACCOUNTS_ENABLED)
    friends.js       /api/account/friends   (friendships + Freundeskreis feed:
                                             send / accept / decline / unfriend,
                                             list, feed paged by ?before= (#325, #1357) —
                                             404 unless ACCOUNTS_ENABLED)
    profile.js       /api/account/profile   (public account profile by username:
                                             handle, registration month, the
                                             caller's friendship state, and the
                                             friends-only feed; later pages at /:username/feed (#558, #1357) —
                                             404 unless ACCOUNTS_ENABLED)
    passkeys.js      /api/account/passkeys  (WebAuthn: registration options +
                                             verify, list, rename, remove, plus
                                             the usernameless login pair under
                                             .../passkeys/login, which is the one
                                             unauthenticated part (#418) —
                                             404 unless ACCOUNTS_ENABLED)
    client-error.js  /api/client-error      (browser-side fault reports, #1149 —
                                             unauthenticated, own rate limit,
                                             closed payload allowlist; feeds its
                                             OWN ring buffer, never the instance
                                             warn/error one)
    contact.js       /api/contact           (public contact form / DSA notice
                                             intake → stores every submission +
                                             e-mails the operator + acknowledges
                                             reports; also the 'feedback' category
                                             (#321), stored-only via the feedback
                                             store, no mail; no auth, own rate
                                             limit, honeypot; fails loud in prod)
    legal.js         /impressum, /datenschutz,
                     /nutzungsbedingungen    (server-rendered legal pages,
                                             identity from IMPRESSUM_* env;
                                             404 until configured)
    faq.js           /faq                   (the FAQ page — public, login-free
                                             and never 404s, unlike the legal
                                             pages above; resolves ?lang →
                                             Accept-Language → de; #489/#1088)
    admin/           /api/admin             (operator moderation — 404 unless
                                             ADMIN_PASSWORD. ONE mount in
                                             lib/app.js; the sub-routers compose
                                             in index.js, because they share the
                                             prefix and seven mounts would run
                                             authLimiter seven times — issue #996)
      index.js       the gate, login/logout/me, and the sub-router mounts
      shared.js      the schemas and the paging shape more than one needs
      status.js      instance status + the recent warn/error ring buffer
      corpus.js      the licensed BGG corpus ingest (issue #681)
      storage.js     object-storage usage + the orphan estimate (issue #941),
                     behind a button because it lists the whole bucket; reports
                     only, never deletes
      moderation.js  lookup by image/round/e-mail/tenant, per-tenant summary,
                     round text + redaction, takedown
      users.js       account suspend/restore/rename, GDPR export + erasure
      log.js         the filterable action log and the feedback inbox, + CSV
      notices.js     the DSA notices inbox, decisions and Art. 17 statements
    recommendations.js …/recommendations    (games the round does not own,
                                            scored from the BGG corpus — #682)
    lookup.js        …/lookup               (search/game — provider proxy for
                                             BoardGameGeek; round-scoped, plus the
                                             BGG-only covers/expansions/import hops)
    rounds.js        /api/rounds            (list — incl. granted rounds (#207);
                                             detail, create, delete; revoke/leave
                                             a share via …/:rid/shares/:userId)
    games.js         …/games                (add [+cover hotlink/source],
                                             edit [+link to provider],
                                             retire/restore, complete/restore,
                                             delete, move some/all to another
                                             round)
    members.js       …/members              (add a seat, edit name / avatar
                                             color, claim/release your own seat)
    sessions.js      …/sessions             (start, results, choice, finish,
                                             cancel, delete, remove one game,
                                             mint the public vote link (#652))
    vote-link.js     /api/vote/:token       (PUBLIC, outside the auth gate: read
                                             one session's ballot and submit one
                                             claimed participant's votes — the
                                             account-free half of #209/#612)
    activities.js    …/activities           (list the feed [GET], delete an entry)
    marker.js        …/marker               (PATCH the round's colour marker,
                                             0-7 — issue #1187)
    tags.js          …/tags                 (create a custom tag [deduped], set its icon, delete one)
    saved-filters.js …/filters              (save the setup under a name, rename,
                                             reorder, delete — the hub's quick-start
                                             chips, issue #1328)
public/
  index.html
  login.html         standalone login page (shown only when AUTH_PASSWORD is set)
  kontakt.html       standalone public contact form (bilingual, no login needed)
  admin.html         standalone operator moderation page (needs ADMIN_PASSWORD)
  styles.css
  css/
    designs/         one override stylesheet per USER design (#1184), fetched
                     on demand by js/design.js; Klassisch has none, because
      tisch.css      styles.css IS Klassisch
      ocean.css
  manifest.webmanifest  PWA manifest (installable app metadata + icons) —
                     Klassisch's; lib/web-manifest.js derives every other
                     design's (the face's included) from it
  robots.txt         crawl policy; every noindex page stays crawl-ALLOWED (#510)
  sitemap.xml        the four public URLs, on the canonical host
  sw.js              service worker: precache the app shell, offline fallback
  fonts/             self-hosted fonts + Tabler icon set
  icons/             PWA / home-screen app icons (192, 512, apple-touch), the
                     "Powered by BGG" attribution logo shown in the footer, and
                     og-image.png (the 1200×630 card link previews show) —
                     Klassisch's marks
    tisch/           Der Tisch's own marks (#1199): felt + gold whirl icons, a
                     maskable one, apple-touch, favicon and its og-image.png,
                     rendered by scripts/render-design-marks.js
    ocean/           Ocean's own marks (#1222): the whirl in Gischt on the
                     accent water, the same six files, same script
  img/               product screenshots on the logged-out landing page — the
                     shelf, the voting screen and a session result, all phone
                     width, one set per UI locale (landing-*.<locale>.webp),
                     generated once from throwaway data and committed (see
                     .claude/rules/)
    tisch/           the same three shots with the app wearing Der Tisch
                     (#1199), shown once the face moves to it
  js/
    pages/           scripts for the standalone HTML pages above. Each is a
                     self-contained IIFE loaded by its OWN document only, so it
                     shares nothing with the SPA's single global scope below —
                     enforced by its own eslint block (no SPA globals, and the
                     two rules the shared scope relaxes stay on)
      login.js       login.html's own script (only when AUTH_PASSWORD is set)
      kontakt.js     kontakt.html's own script (the bilingual contact form)
      admin.js       admin.html's own script, so no privileged code ships in
                     the SPA
      face.js        stamps FACE_DESIGN onto login.html's and kontakt.html's
                     <html data-design> from <head>, after designs.js (#1198)
    error-report.js  browser-side fault reporting (#1149): the fault-kind enum,
                     the route-shape redaction and the bounded reporter — loads
                     FIRST, shared with the backend, which requires it
    locales.js       the set of shipped UI locales (code, native label, BCP-47
                     tag) — shared with the backend, which requires it
    i18n.js          translation engine (t(), locale detection, plural rules)
    lang/en.js       English strings
    lang/de.js       German strings
    lang/es.js       Spanish strings
    lang/fr.js       French strings
    lang/it.js       Italian strings
    lang/nl.js       Dutch strings
    lang/pt.js       Portuguese strings
    lang/fi.js       Finnish strings
    lang/ko.js       Korean strings
    core.js          DOM/API helpers, SWR fetches, member colours, the
                     language picker  (loads first)
    empty-state.js   the app's one "nothing here yet" component — medallion,
                     optional title, sub-line; shares its rules with .lobby-cta
                     (issue #869)
    auth-tokens.js   the token layer (#135): the access/refresh/demo keys, the
                     cached /me projection, the silent-refresh retry and
                     onSessionLost — what core.js's api() chokepoint reads
                     through (split out of account.js by #969)
    account.js       boot + the route gate: what a visitor sees first
    views-auth.js    the auth screens: login, register, forgot, the verify and
                     reset landings, the rate-limited state, passkey login
    demo-account.js  the guest-demo lifecycle: start, enter, resume, end (#427)
    account-chrome.js the terms banner (#521), the top-bar account menu, the
                     inbox badge and the „Was ist neu" dot (#741)
    auth-error.js    maps an auth API error code to the localized message each
                     form shows (issue #399)
    username-policy.js
                     what a username may be: the charset/length pattern, and the
                     handles refused because they would read as an official
                     account (admin, moderator, anything containing the brand) —
                     the single source of truth lib/routes/account.js enforces
    passkey.js       WebAuthn browser glue (issue #418): the base64url ⇄
                     ArrayBuffer conversions every credential crossing the wire
                     needs, plus thin create()/get() wrappers and the feature
                     detection the login button is gated on
    demo-marker.js   the browser-local marker that lets a returning visitor
                     re-enter their own guest demo instead of minting a second
                     one, and the rule that keeps it valid across token
                     rotation (issue #502)
    support.js       the donation/support sheet (issue #173; hidden unless
                     DONATE_URL is set)
    confirm-dialog.js
                     the themed confirmation sheet that replaced window.confirm
                     at every destructive moment (issue #939) — a promise-
                     returning helper on the shared openSheet plumbing
    ranking.js       tie-aware podium places ("1, 2, 2, 4")
    podium.js        arranges ranked members into the Pokale podium's three
                     rank columns — a tie shares one step and grows SIDEWAYS,
                     never upward, or it overtops the winner (#891, #897)
    session-share.js the plain-text summary behind the results screen's „Teilen"
                     button — built from the view model the screen just rendered,
                     so the two cannot drift (issue #526)
    bgstats.js       builds the BG Stats createPlay link a finished session can
                     be handed to — one play per URL, nothing sent server-side
                     (issue #485)
    recap.js         the round's taste record behind the Pokale tab's Rückblick:
                     best/worst rated, the most divisive game and each member's
                     favourite, all derived from session votes (issue #484)
    period-recap.js  the same idea for ONE calendar month or year, beside the
                     all-time Rückblick: which periods have content, and what
                     was played, rated and shelved in one of them (issue #800)
    account-recap.js the same slice for one ACCOUNT across all its rounds, from
                     the own profile's play list: sessions, games, most played,
                     own best-rated, first-time games — no wins (issue #1147)
    recap-card.js    draws that period recap onto a canvas and hands it out as a
                     PNG the user shares — never any cover art, which may not be
                     redistributed and would taint the canvas (issue #800)
    card-glyphs.js   the Tabler outlines a canvas draws (whirl, crown, check,
                     the five faces) as Path2D data, read once out of the
                     bundled woff2 — a canvas never loads the icon font (#1199)
    recap-card-tisch.js
                     Der Tisch's share card (#1199): one 1080×1350 layout for a
                     session, a split session and a period recap, drawn when
                     that design is worn — felt head, played game, people, Tafel
    recap-card-ocean.js
                     Ocean's share card (#1220): a 1080×1350 session card, a
                     1200×630 landscape one and a 1080×1350 period recap —
                     water above, every string on an opaque band below
    hub-insights.js  the Start tab's derivations: which games are worth putting
                     on the table, how often the round meets, what is quietly
                     broken, and what was played on this day in a past year
                     (issue #923)
    shelf-profile.js the Regal-Steckbrief's builder: the active shelf's seat,
                     playing-time and weight bands, its top mechanics and
                     categories, and the gaps under three games (issue #1173)
    shelf-profile-card.js
                     the Steckbrief as a shareable PNG — flat fills, no SVG, no
                     pattern, the same-origin BGG badge (issue #1173)
    off-shelf.js     the four off-shelf destinations (Aussortiert, Durchgespielt,
                     Wunschliste, Könnte euch gefallen) with their counts — one
                     definition, used by the Regal's sheet, the rail and the
                     hub's „Nicht im Regal" group (issue #1185)
    cover.js         deterministic per-title gradient for games with no cover
    cover-size.js    rewrites provider cover URLs to a frame-appropriate size
    tag-icons.js     the curated tag-icon set (mirrors lib/tag-icons.js)
    member-colors.js the curated avatar palette — the single source of truth
                     lib/routes/members.js validates against (issue #420)
    member-active.js which members are still PLAYING — the one filter the
                     forward-looking surfaces (session setup, teams, rankings,
                     trophies) apply, while history keeps resolving a retired
                     seat unchanged (issue #1006)
    round-marker.js  a round's COLOUR MARKER (#1187): the design-neutral
                     index 0-7, the tables mapping every retired round design
                     (by id, or a pre-#903 page hex) onto one (#1202), the id
                     hash that assigns one at creation, and the resolver.
                     Required by both repo backends and by lib/routes/marker.js
    round-theme.js   how the worn design and the round's marker reach the
                     page: the --page-bg/--brand pair and data-scheme
                     (paintDesign), the marker tokens (applyMarker),
                     <meta name="theme-color">, and the rating ramp that
                     flips with the scheme (issues #956, #1202)
    designs.js       the USER design registry (#1184): which designs an
                     account may wear, each one's page/accent/scheme and
                     override stylesheet, the `enabled` gate and the face
                     design. Required by lib/app.js so GET /api/config and
                     the client work from one list
    design.js        applying a user design: <html data-design>, the
                     on-demand stylesheet link and the head's brand marks,
                     then paintDesign() (#1184)
    design-picker.js the design cards the Konto screen and the one-time
                     first-start chooser both render, that chooser sheet,
                     and the Konto section (#1186); under Der Tisch the
                     chooser prints posters/rows from the registry (#1277)
    round-roles.js   the owner/co-owner/editor ladder and what each may do,
                     required by lib/round-access.js so the views hide exactly
                     what the server refuses (issue #137)
    provider-info-fields.js
                     WHICH provider fields a game carries and what counts as a
                     value worth storing (#724), required by both repo
                     backends, the games route and the backfill, and asked by
                     the client's wantsGameInfo() — one definition, so no copy
                     decides on its own whether an empty answer erases a
                     stored value or whether a game still needs a fetch
    draw-pool.js     which games a draw may pick from: the active-collection
                     check, the player-range fit and the filters over BGG's
                     imported metadata (issue #725), required by lib/draw.js so
                     the setup screen's live preview and the real draw apply one
                     predicate (issue #634)
    filter-panel.js  the ONE „Filter" control: the round's tags and the
                     metadata filters — playing time, complexity, minimum age,
                     categories, mechanics — behind one trigger that opens a
                     popover (or a sheet on a phone), with the applied filters
                     beside it as removable chips; shared by the session setup
                     screen and the Regal (issues #725, #827, #844)
    wish-expansion.js which game a wished EXPANSION is acquired onto: the base
                     games of this round its provider links name, and the
                     resulting attach / pick / create-the-base decision
                     (issue #664)
    bulk-tidy.js     what a bulk shelf-tidying selection costs the round — does
                     it reach into any past session? Shared by the Regal's
                     selection mode, the three off-shelf screens and the move
                     sheet, so all three warn in the same words (issue #832)
    session-outcome.js what became of a session — open, played, cancelled or, since
                     #796, SPLIT across several tables; derived from the child
                     ids rather than from a third boolean, and required by
                     lib/routes/sessions.js and lib/recommend.js
    table-split.js   the multi-table objective, the seeded search that optimises
                     it and the per-table numbers the builder shows; also the
                     relaxed pool predicate lib/draw.js applies in that mode
                     (issue #796)
    session-log.js   the session activity log's event types and their phrasing —
                     one list, written by lib/session-events.js and rendered by
                     the lobby and the results screen (issue #209)
    news.js          the „Was ist neu" entry list + its newest revision — a code
                     constant that ships with the release it describes, read by
                     the /neu screen and by lib/routes/account.js (issue #741)
    avatar-policy.js what a profile picture may be — byte cap, stored square,
                     accepted types — offered by the Konto picker and validated
                     by lib/avatar.js + lib/upload.js (issue #841)
    cover-policy.js  what an uploaded game cover may be — byte cap, ceiling on
                     the stored long edge, output format — offered by the two
                     paste sites and validated by lib/upload.js + lib/cover.js
                     (issue #867)
    member-avatar.js the ONE decision of photo-vs-initials, used by every avatar
                     render site, plus the per-page id→picture cache and the
                     broken-image fallback (issue #841)
    owner-picker.js  the owner chip row the add-game sheet, the BGG import sheet
                     and the game detail page share, plus the rule deciding what
                     it starts out selected (issue #971)
    session-people.js who took part in ONE session (members who joined + that
                     session's guests), how they group into playing parties
                     (issue #575) and how a guest name is labelled; also holds
                     the guest cap lib/routes/sessions.js enforces (issue #458)
    vote-score.js    what a SET of votes is worth: the Spielwirbel-Score, a
                     per-tile value curve applied to each vote before
                     averaging, so a game one person does not want to play
                     stops outranking a game everybody is fine with. Required
                     by lib/recommend.js and lib/session-split.js (issue #893)
    rating-faces.js  the mood face each rung of the 1-5 scale wears, so the two
                     vote cards and the session result distribution name a
                     rating with the same glyph; also the scale's own bounds,
                     derived from the face list (issues #890, #909)
    vote-advance.js  the beat between a rating tap and the next card, plus the
                     longer window taps are ignored for, so one tap per game
                     can never let a double-tap rate the following one
                     (issue #1168)
    vote-path.js     the path a shared vote link lives at, built by the client
                     that hands the link around and by the server that draws
                     the same URL as a QR code (issues #652, #1170)
    seat-picker.js   the seat ring both session-starting screens open with: the
                     round's members as in/out toggles, that session's guests
                     beside them, and a „+" seat that adds one (issues #458,
                     #1016)
    guest-picker.js  the live guest list that ring drives — names, stable keys
                     for the team picker, and the per-screen note (issues #458,
                     #532)
    team-picker.js   the team field: group two or more of those people into one
                     party, shared by the same two screens (issue #575)
    setup-addons.js  the add-on chip row those two fields now sit behind: one
                     chip per rare session option, each carrying its own state,
                     with the open one unfolding into a single body BELOW the
                     row (issue #1015)
    score-info.js    the ⓘ that explains the Spielwirbel-Score, once per screen
                     beside its primary occurrence (issue #893)
    game-info.js     BGG provider-info surfaces (issues #717/#724): the info
                     sheet the two vote cards open, the ⓘ affordance itself,
                     and the game-detail section — one body builder for all
                     three. Plus the shelf-wide fill the session setup screen
                     and the Regal fire on mount (#736), folded into the games
                     they already hold so the filter controls and the pool
                     catch up without a re-render
    swr.js           stale-while-revalidate cache: views render instantly from
                     the last known data while a background fetch refreshes
    lookup-cover.js  which cover image a picked provider match yields
    lookup.js        the search-as-you-type provider lookup: the provider name
                     tables and attachLookup, the control that owns an input,
                     its suggestion menu, the debounce and the in-flight
                     sequence guard (issue #956)
    lookup-score.js  how well a hit's title answers the query (drives the
                     cross-provider ranking; folds punctuation + diacritics)
    lookup-title.js  which title a picked provider match fills in (BGG keeps the
                     matched name, so a German search stays German)
    lookup-nav.js    which suggestion the keyboard has active in the lookup
                     dropdown, and how it survives a re-render (issue #542)
    bgg-covers.js    which of a game's BGG edition covers is offered first
                     (the reader's language, then English) and which duplicate
                     box arts are dropped (issue #519); plus what a pick says
                     about its PRINTING, kept on the game row rather than
                     discarded with the rest of the cover object (#742)
    cover-picker.js  the collapsible grid of those covers, shared by the three
                     screens that offer it: the add-game sheet, the game-detail
                     cover editor and the collection-import list
    doc-title.js     joins a screen's browser-tab title, most specific part
                     first, ahead of the brand (issue #522)
    live-region.js   the app's two aria-live regions: toast() for what everyone
                     sees, announce() for what only a screen reader is told
                     (issues #145, #1168)
    popover-fit.js   which side of its anchor a popover goes on and how far it
                     may be squeezed to stay reachable there (issue #739)
    sheet.js         the bottom sheet — the app's modal overlay primitive,
                     used by eleven other modules — plus openEditor, which
                     picks popover-or-sheet by viewport (issue #956)
    popover.js       the anchored popover itself: one open at a time, placed
                     next to its anchor, closing on Escape/outside click/
                     scroll; placement is one-shot (issue #956)
    tag-chips.js     the tri-state custom-tag filter shared by the Regal and
                     the start-session screen: chips, mode + bulk toggles,
                     icon picker, match predicate (issue #956)
    vendor/sortable.min.js  SortableJS, committed verbatim — the app's one
                     vendored library, byte-identical to the `sortablejs`
                     devDependency (a test asserts it) so Dependabot tracks it;
                     its MIT LICENSE sits beside it (issue #1180)
    reorder-drag.js  the one wrapper around it: drag a tile into place, as a
                     second way to do what the Tags screen's arrows do; owns
                     every Sortable option (issue #1180)
    game-stats.js    what a game is worth to a round — the score fields, the
                     per-session and per-round rollups, the shelf index, the
                     retirement recommendations, and how a score prints
                     (issue #956)
    report-link.js   builds the contact-form deep link behind the Freundeskreis
                     feed's per-item report button (issue #559)
    install-prompt.js stashes the browser's install event and decides which
                     install affordance a screen may offer — a real button, the
                     iOS Share-sheet steps, or nothing (issue #616)
    focus-trap.js    keeps Tab inside an open sheet + restores focus on close
    page-lock.js     freezes the page behind an open sheet, so it can't scroll
                     away underneath it (issue #622)
    session-path.js  URLs for the transient session-flow screens, so browser/OS
                     Back steps through the vote wizard (issue #329)
    nav-link.js      turns a nav element into a real <a href> that still routes
                     in-app on a plain click, so Cmd/middle-click opens a new
                     tab and "Copy link address" works (issue #330)
    round-rail.js    the desktop navigation rail (from 1280px): round identity,
                     the four sections, the off-shelf rows (from off-shelf.js),
                     and one Einstellungen entry
    landing-moments.js  the landing hero's stage: the app's own pot, vote and
                     Tafel played once from the shipped components and their own
                     keyframes (issue #1091)
    views-landing.js logged-out marketing landing page shown at / in accounts
                     mode before registration (issue #322)
    views-home.js    the home dashboard (#842) — greeting, resume tickets for
                     sessions still running, the round lobby, and the tile row
                     (Freundeskreis / Entdecken / news) — plus new round
    views-round.js        round hub SHELL: the Start/Regal/Chronik/Pokale tab
                          strip, the round fetch, the inline round-name editor
    views-round-start.js  Start tab: hero, the one big CTA, the tickets, and
                          what the tab composes below them (#923)
    hub-cards.js          the Start tab's card renderers, their shared frame and
                          the quick-start chips, split out of the above at its
                          own #923 seam (issue #1189)
    ocean-hub.js          Ocean's composition of the lobby and the round hub:
                          the hub's columns, the shell with the one action, the
                          crew captions, the lobby tiles and notice (#1211)
    saved-filters.js      a round's saved session filters (#1328): the chip's
                          prefill, the setup screen's „Filter speichern" sheet
                          and the Einstellungen list
    hub-previews.js       the hub's previews of Regal, Pokale and Chronik, and
                          its „Nicht im Regal" group (issue #1185)
    views-regal.js        Regal tab: the games library (search, filters, grid)
    views-shelf-profile.js
                          the Regal-Steckbrief: its Start card, its screen
                          (/round/:rid/shelf-profile) and its share (#1173)
    regal-bulk.js         the Regal's selection mode and its four bulk actions
                          (tags, owners, retire, delete), lifted out of
                          views-regal.js so each is editable on its own (#1000)
    views-chronik.js      Chronik tab: the month-grouped session/shelf timeline
    views-period-recap.js
                          the Chronik's shareable month/year recap section, and
                          the share delivery its card (and the account recap's
                          and the Regal-Steckbrief's) goes out through (#1345)
    views-pokale.js       Pokale tab: podium + fun stats, and the Rückblick
    views-archive.js      the three off-shelf screens (retired / completed /
                          Wunschliste) through one renderer
    views-recommend.js    "das könnte euch auch gefallen": ranked games the
                          round does not own, each card naming up to three
                          reasons it was picked (#682, #772)
    game-editors.js  the game page's five field editors — players, owners,
                     tags, cover and expansions (issue #968). Split out of
                     views-round-detail.js, whose remaining seam ran INSIDE
                     showGameDetail; each takes one explicit context instead of
                     closing over that function's scope
    views-round-detail.js game detail, plus the wish-list price block it
                          renders
    views-round-settings.js round Einstellungen screen: the round-level actions
                          (invite, move games, delete/leave) in one place (#561),
                          plus the two sub-screens it links to — the colour
                          marker picker and the tag manager (#956, #1187)
    views-round-actions.js  the two sheets that screen opens: move games, invite
    views-round-lookup.js the two lookup sheets: add a game, link an existing
                          game to a provider
    add-game-search.js  Der Tisch's search-first add step: hits as rows with
                        their own state, then the BGG import or the form (#1264)
    bgg-import.js    the one-shot BoardGameGeek collection import: the
                     account gate, the owned/wish picker, the error
                     phrasing (#481, moved out in #956)
    direct-session.js „Jetzt spielen" — start a session for one game with
                     no vote and no draw, straight to the results screen
    member-stats.js  one member's statistics, derived on demand from the
                     round's sessions. Split out of views-member.js by #1075;
                     a pure derivation, edited when a statistic changes rather
                     than when the screen does
    achievements.js  the Abzeichen catalogue (21 entries: member, round,
                     account) and their states, tiers and earning dates,
                     replayed on demand from the finished sessions — nothing
                     stored. Also required by lib/user-stats.js for the
                     account tier (issue #1387)
    views-badges.js  the Abzeichen in Klassisch (issue #1388): the shared
                     `.badge` markup every design skins, Pokale › Abzeichen,
                     the result moment, the Chronik rows, the hub line, the
                     Tischkarte row and the tap-open card
    views-member.js  member detail page (die Tischkarte: the Siegquote ring,
                     the initials watermark, the figure strip and its
                     the two game boxes; name/colour editing)
    vote-card-composed.js Der Tisch's vote card (#1268): the felt header, the card
                     with cover and meta, the worded faces, the hand-off line
                     and the vote link's felt intro; both vote cards build
                     their faces through its voteMoodButton()
    views-session.js session setup, the rating cards, finale, results
    result-tafel-composed.js Der Tisch's result: the column-header Tafel of compact
                     rows with pills, the crowned people, the foot (#1275)
    views-session-tables.js the multi-table builder and, once confirmed, the split
                     summary linking to the evening's tables (issue #796)
    views-session-live.js the voting lobby every session opens (#655): who has voted, vote for
                     yourself or for anyone still open on this device, and end
                     the voting (issue #209)
    views-session-setup-tisch.js Der Tisch's setup as two panels („Wer spielt mit?",
                     „Der Topf"), the step line, the rail kept (#1267)
    views-session-ocean.js Ocean's session loop (#1213): the setup in three columns
                     with the Muschel, the vote card's desktop side columns, and
                     the result arranged in columns
    views-vote-link.js the PUBLIC /vote/:token screen (#652): claim your name
                     from the participant list and rate the drawn games without
                     an account — the only view that runs logged out
    views-inbox.js   per-user notification inbox (#207; accounts mode only)
    views-news.js    the pulled „Was ist neu" screen at /neu, reached from the
                     account menu; opening it marks the entries seen (#741)
    views-stats.js   instance-wide public statistics (#564): the /entdecken
                     screen, the landing-page block and the home dashboard
                     panel, all from one payload and one card renderer. Renders
                     nothing at all — no heading, no container — when the
                     feature is off or every metric is still below its threshold
    feed-view.js     the friend feed's two presentations (#325, #1132): the row
                     for a narrow section, the tile grid where the feed is the
                     content. A component with three callers on three screens
    views-friends.js Der Kreis view + home dashboard tile (#325; since #842
                     it invites rather than vanishing when you have no friends).
                     Holds the account vocabulary the profile shares (colour,
                     avatar, name, send error, report button)
    views-profile.js the account profile at /u/:username (#558; accounts mode
                     only) — die Spielerkarte, one card in the account's own
                     colour carrying its play record (#1089, rebuilt in #1132),
                     the state action, the „…" menu and the tiled activity feed
    views-account.js Konto settings: identity + change password (#482; accounts mode only)
    views-account-tisch.js Konto as Der Tisch's dashboard: „Du" card of setting rows, Design card, BGG + danger cards (#1265)
    router.js        URL ↔ view routing (History API): deep links, reloads
    main.js          bootstrap: route from the current URL              (loads last)
    pwa.js           registers the service worker (installable + offline)
scripts/
  build.js           optional cache-busting build: mirrors public/ into dist/
                     with content-hashed, minified js/css (npm run build)
  seed-dev.js        fills a throwaway DATA_DIR (.devdata/ by default) with the
                     guest demo's rounds + a local dev account, so a fresh clone
                     has something to look at; refuses the real data/
  resolve-demo-covers.js
                     re-resolves the demo seed's cover hotlinks AND provider
                     metadata against the providers, and prints one ready-to-paste
                     games block per round for lib/demo-seed.js
  session-cost.js    reports what an agent session cost (requests, the fixed
                     preamble, the largest tool results) from Claude Code's own
                     transcripts — so a workflow change can be measured
  capture-landing-shots.js
                     regenerates the committed landing-page product screenshots
                     (public/img/landing-*.webp) — seeds a throwaway dataset and
                     drives headless Chrome over CDP, one run for every locale;
                     --design=tisch shoots Der Tisch's set into public/img/tisch/
  landing-desktop-shot.js
                     that run's one desktop capture — the round hub at 1440 wide
                     for the band under the landing hero (#1199) — its viewport,
                     probe and crop
  cdp.js             the dependency-free Chrome DevTools Protocol client both
                     image scripts drive headless Chrome with
  render-design-marks.js
                     renders a design's app icons, favicon and link-preview
                     image to the PNGs its registry row names (#1199), with
                     headless Chrome over CDP and the design's own tokens
  landing-seed-data.js
                     the per-locale seed that run puts in (round name, seats,
                     tags, invented titles, provider metadata) — a flat table,
                     so adding a language edits this file and not the pipeline
test/                automated tests (node --test + supertest); view specs
                     run the real frontend under jsdom (test/support/dom.js)
data/                all user data (git-ignored)
  data.json          created on first run
  uploads/           cover images
dist/                optional build output (git-ignored; npm run build)
Dockerfile           production container image (node pinned to an exact patch,
                     non-root, writes to DATA_DIR=/data; no VOLUME instruction —
                     Railway's builder rejects it, see .claude/rules/)
.dockerignore        keeps secrets + user data out of the build context
docker-compose.yml   one-command run with a persistent /data volume
knexfile.js          Knex config (Postgres) shared by the app + the migrate CLI
railway.json         Railway build/deploy config (see docs/deploy-railway.md)
.github/workflows/   CI: tests, lint, secret scan, Docker image build + publish
.github/             dependabot.yml, FUNDING.yml, and the contributor-facing
                     ISSUE_TEMPLATE/ forms + PULL_REQUEST_TEMPLATE.md
```

The frontend files are plain `<script>`s that share one global scope; **load
order matters** (see `index.html`).

## Design programme (`docs/design/`)

Since 2026-09-19 the app has moved from per-round colour schemes and worlds to
**per-user designs** (issues #1183–#1207; the flip, #1202, made Der Tisch the
face and retired the round designs). Everything that decides how that
works lives under `docs/design/`, not in this file: the handover that fixes the
information architecture every design shares, the vocabulary rule (nouns and
navigation are Spielwirbel's, only the ritual may be themed), the review of the
first design package („Der Tisch", `docs/design/tisch/`), the audit script that
measured it, and the procedure for taking the next package to issues. The
sheets in `docs/design/tisch/` are design references rendered by a small
runtime, not app code — see `docs/design/README.md` for how to open them.

## Development scripts, testing and CI

```bash
npm test              # automated tests (Node's built-in runner + supertest)
                      # view specs run the real frontend under jsdom, see
                      # test/support/dom.js and .claude/rules/
npm run coverage      # tests with a coverage report (built-in, no extra deps)
npm run lint          # ESLint (flat config)
npm run check:syntax  # node --check over all JS files
npm run build         # optional: content-hash + minify js/css into dist/
npm run migrate       # apply pending Postgres migrations (needs DATABASE_URL)
npm run migrate:make -- <name>  # scaffold a new Postgres migration file
```

`coverage` uses Node's built-in `--experimental-test-coverage`, so it needs no
extra dependency. CI also runs `coverage:ci`, which adds line/function/branch
thresholds and fails the build if coverage drops below them (Node ≥ 22.8).

`build` (issue #141) is **optional** and only for production: it writes a
`dist/` mirror of `public/` with content-hashed, minified JS/CSS (via
[`esbuild`](https://esbuild.github.io/)) so a changed asset gets a fresh URL and
never serves stale after a deploy. The server uses `dist/` only under
`NODE_ENV=production`; plain `npm start` always serves the live-editable
`public/` tree, so day-to-day development stays build-free. Delete `dist/` (or
just don't build) to go back to serving `public/`.

CI runs the test suite plus a coverage check, lint, and syntax checks on every
push and pull request, and a gitleaks secret scan fails the build if a credential
is ever committed; Dependabot keeps dependencies updated via weekly PRs — npm
packages, the GitHub Actions, and the Dockerfile's Node base image. The base
image and every third-party action are pinned to an exact patch / a commit SHA,
so a runtime or action security release arrives as a reviewable, CI-tested PR
rather than through a mutable tag nobody controls; the admin panel's „Grenzen &
Kontingente" card reports the Node version the running process is actually on.
