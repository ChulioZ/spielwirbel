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
  add-game lookup queries the PlayStation Store, Steam, the Nintendo eShop, the
  Xbox / Microsoft Store and BoardGameGeek server-side (via
  `/api/rounds/:rid/lookup/*`, and only the providers that round enabled) only
  when you type a title to search; it sends just the search text, and the app
  works fully without it. The four digital stores need no key or account.
  **BoardGameGeek does:** its XML API requires a registered application and a
  bearer token in `BGG_API_TOKEN` (create one at
  [boardgamegeek.com/applications](https://boardgamegeek.com/applications)).
  Without it the board-game search silently returns nothing and the other four
  providers carry on — nothing logs and nothing errors, so check the env var
  itself if board games stop being found. Because
  BGG answers a search with the name that *matched*, typing a title in your own
  language finds and fills in that name. The four **digital storefronts** answer
  in the language the app is set to (the top-bar picker), so an English UI gets
  English titles and English store links and a German one gets German — no
  configuration needed. `PSSTORE_LOCALE`, `STEAM_CC` / `STEAM_LOCALE`,
  `NINTENDO_LOCALE` and `XBOX_LOCALE` remain as the **fallback** a self-hosted
  instance can pin (they still default to the German store), used only for a
  language none of those stores serves.

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
    migrations/      versioned Knex schema migrations (npm run migrate)
  tenant.js          resolves each request's tenant and scopes the repo to it
  store.js           the JSON backend's engine: in-memory data + atomic
                     load/save to the data/ folder, id/activity helpers
  storage/           cover-image storage: one seam, two backends
    index.js         picks the backend (S3_BUCKET ? s3 : disk)
    disk.js          default backend — files under DATA_DIR/uploads
    s3.js            S3-compatible object storage, used when S3_BUCKET set
  upload.js          multer image-upload config (persists via lib/storage)
  auth.js            shared-password gate (active when AUTH_PASSWORD is set)
  admin.js           operator gate for the moderation surface (separate
                     ADMIN_PASSWORD; 404s unless set — issue #268)
  accounts.js        user-account primitives: Argon2id passwords, access/refresh
                     tokens (issue #135; off unless ACCOUNTS_ENABLED)
  quota.js           per-tenant state caps — rounds/tenant, games/round,
                     tags/round, members/round (issue #139; inert unless
                     ACCOUNTS_ENABLED)
  faq.js             the server-rendered FAQ page, DE + EN, with each answer an
                     instance cannot honestly give gated out (issue #489)
  feed.js            the Freundeskreis activity feed's allowlisted events (#325)
  actor-seat.js      which member seat to attribute a round activity to; one
                     definition shared by the games and members routes (#563)
  draw.js            the session draw's game pool + shuffle: the one named
                     "is this game active" predicate both of the sessions
                     route's guards go through (issue #486)
  session-votes.js   vote secrecy for a session collecting votes from several
                     devices: strips the ratings already cast out of the round
                     payload while voting is open, leaving only who has voted
                     (issue #209)
  session-events.js  writes the session activity log: builds one entry and
                     appends it inside the repo mutator's own read-modify-write,
                     so the log cannot drift from what it records (issue #209)
  demo.js            guest demo mode: mints, seeds and purges throwaway demo
                     accounts (issue #427; off unless DEMO_ENABLED)
  demo-seed.js       the content a demo tenant is seeded with — games (hotlinked
                     provider covers), tags and per-locale text
  demo-tenant.js     the one definition of the `demo-` tenant-id prefix that
                     classifies a tenant as a demo, dependency-free so the repo
                     backends and the logger can require it without a cycle
  vote-link.js       the vote link's TTL (issue #652): the age half of the
                     public route's gate, plus the sweep that deletes rows past
                     it. Exists because an ABANDONED session — never closed,
                     never cancelled — reaches none of the five event-driven
                     deletions, so without a max age its link never expires
  scheduler.js       background jobs, started from server.js only: the
                     expired-demo purge (issue #427) and the expired-vote-link
                     sweep (issue #652)
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
  canonical.js       301s the branded non-canonical domains onto one origin
                     (issue #230; an allowlist, never an inverse rule)
  validate.js        zod request-body schemas applied at the router boundary
  tag-icons.js       the curated tag-icon set (mirrored by public/js/tag-icons.js,
                     with a test asserting the two stay identical)
  csv.js             RFC 4180 CSV writer for the operator panel's exports
                     (issue #288) — quotes every field, so a feedback message
                     with commas/quotes/newlines cannot corrupt the file, and
                     neutralizes leading =/+/-/@ so it cannot become an Excel
                     formula
  observability.js   structured logging, /healthz + /readyz, central error handler
  status.js          aggregate usage metrics + the quota ceilings for the
                     operator panel's Kennzahlen card (issues #274/#404) —
                     counts only, never a secret value and never personal data
  provider-cache.js  the shared 10-minute cache for provider hops (search,
                     detail, collection, cover refresh), so a repeated click
                     or a debounced keystroke costs nothing upstream
  providers/         external game-database providers for the add-game lookup
    index.js         provider registry + image-host allowlist, the round's
                     enabled-provider decode, and cover resolution for a
                     stored source link (issue #518)
    locales.js       maps a request's UI locale onto each storefront's own
                     spelling of it, through a closed table (never
                     interpolated — it reaches a fetched URL path)
    psstore.js       PlayStation Store: search + detail via the store's
                     server-rendered page data (digital games)
    bgg.js           BoardGameGeek: search + detail + owned-collection import
                     via BGG's official XML API2 under an application token
                     (board games)
    steam.js         Steam: search + detail via the store's public JSON
                     endpoints (storesearch / appdetails) (digital games)
    nintendo.js      Nintendo eShop: search + detail via Nintendo of Europe's
                     public Solr endpoint (Switch games)
    xbox.js          Xbox / Microsoft Store: search via the storefront
                     autosuggest API, detail via the public catalog service
                     (digital games)
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
                                             list, feed (#325) —
                                             404 unless ACCOUNTS_ENABLED)
    profile.js       /api/account/profile   (public account profile by username:
                                             handle, registration month, the
                                             caller's friendship state, and the
                                             friends-only feed (#558) —
                                             404 unless ACCOUNTS_ENABLED)
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
                                             pages above; issue #489)
    admin.js         /api/admin             (operator moderation: instance
                                             status, lookup by image/round/
                                             e-mail/tenant, per-tenant summary,
                                             round text + redaction, takedown,
                                             notices inbox + decisions, Art. 17
                                             statements of reasons,
                                             account suspend/restore, GDPR
                                             export + erasure,
                                             filterable action log, user feedback,
                                             recent warn/error logs —
                                             404 unless ADMIN_PASSWORD)
    lookup.js        …/lookup               (search/game — provider proxy: PS Store, BGG, Steam, Nintendo, Xbox;
                                             round-scoped, refuses a provider the round disabled)
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
    background.js    …/background           (set the design)
    tags.js          …/tags                 (create a custom tag [deduped], set its icon, delete one)
    providers.js     …/providers            (set which lookup providers this round queries)
public/
  index.html
  login.html         standalone login page (shown only when AUTH_PASSWORD is set)
  kontakt.html       standalone public contact form (bilingual, no login needed)
  admin.html         standalone operator moderation page (needs ADMIN_PASSWORD)
  styles.css
  manifest.webmanifest  PWA manifest (installable app metadata + icons)
  robots.txt         crawl policy; every noindex page stays crawl-ALLOWED (#510)
  sitemap.xml        the four public URLs, on the canonical host
  sw.js              service worker: precache the app shell, offline fallback
  fonts/             self-hosted fonts + Tabler icon set
  icons/             PWA / home-screen app icons (192, 512, apple-touch), the
                     "Powered by BGG" attribution logo shown in the footer, and
                     og-image.png (the 1200×630 card link previews show)
  img/               product screenshots on the logged-out landing page — the
                     shelf in two widths plus the voting screen, one set per UI
                     locale (landing-*.<locale>.webp), generated once from
                     throwaway data and committed (see .claude/rules/)
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
    locales.js       the set of shipped UI locales (code, native label, BCP-47
                     tag) — shared with the backend, which requires it
    i18n.js          translation engine (t(), locale detection, plural rules)
    lang/en.js       English strings
    lang/de.js       German strings
    core.js          DOM/API helpers, stats, design, language picker  (loads first)
    account.js       onboarding + auth UI (login/register/verify/reset), token wiring
    auth-error.js    maps an auth API error code to the localized message each
                     form shows (issue #399)
    username-policy.js
                     what a username may be: the charset/length pattern, and the
                     handles refused because they would read as an official
                     account (admin, moderator, anything containing the brand) —
                     the single source of truth lib/routes/account.js enforces
    demo-marker.js   the browser-local marker that lets a returning visitor
                     re-enter their own guest demo instead of minting a second
                     one, and the rule that keeps it valid across token
                     rotation (issue #502)
    support.js       the donation/support sheet (issue #173; hidden unless
                     DONATE_URL is set)
    ranking.js       tie-aware podium places ("1, 2, 2, 4")
    session-share.js the plain-text summary behind the results screen's „Teilen"
                     button — built from the view model the screen just rendered,
                     so the two cannot drift (issue #526)
    bgstats.js       builds the BG Stats createPlay link a finished session can
                     be handed to — one play per URL, nothing sent server-side
                     (issue #485)
    recap.js         the round's taste record behind the Pokale tab's Rückblick:
                     best/worst rated, the most divisive game and each member's
                     favourite, all derived from session votes (issue #484)
    cover.js         deterministic per-title gradient for games with no cover
    cover-size.js    rewrites provider cover URLs to a frame-appropriate size
    tag-icons.js     the curated tag-icon set (mirrors lib/tag-icons.js)
    member-colors.js the curated avatar palette — the single source of truth
                     lib/routes/members.js validates against (issue #420)
    draw-pool.js     which games a draw may pick from: the active-collection
                     check and the player-range fit, required by lib/draw.js so
                     the setup screen's live preview and the real draw apply one
                     predicate (issue #634)
    wish-expansion.js which game a wished EXPANSION is acquired onto: the base
                     games of this round its provider links name, and the
                     resulting attach / pick / create-the-base decision
                     (issue #664)
    session-log.js   the session activity log's event types and their phrasing —
                     one list, written by lib/session-events.js and rendered by
                     the lobby and the results screen (issue #209)
    session-people.js who took part in ONE session (members who joined + that
                     session's guests), how they group into playing parties
                     (issue #575) and how a guest name is labelled; also holds
                     the guest cap lib/routes/sessions.js enforces (issue #458)
    guest-picker.js  the guest name field (chips + input), shared by the two
                     screens that start a session (issue #532)
    team-picker.js   the team field: group two or more of those people into one
                     party, shared by the same two screens (issue #575)
    swr.js           stale-while-revalidate cache: views render instantly from
                     the last known data while a background fetch refreshes
    lookup-group.js  collapses same-title provider hits into one multi-badge row
    lookup-cover.js  which cover image a picked provider match yields
    lookup-score.js  how well a hit's title answers the query (drives the
                     cross-provider ranking; folds punctuation + diacritics)
    lookup-title.js  which title a picked provider match fills in (BGG keeps the
                     matched name, so a German search stays German)
    lookup-nav.js    which suggestion the keyboard has active in the lookup
                     dropdown, and how it survives a re-render (issue #542)
    bgg-covers.js    which of a game's BGG edition covers is offered first
                     (the reader's language, then English) and which duplicate
                     box arts are dropped (issue #519)
    cover-picker.js  the collapsible grid of those covers, shared by the three
                     screens that offer it: the add-game sheet, the game-detail
                     cover editor and the collection-import list
    doc-title.js     joins a screen's browser-tab title, most specific part
                     first, ahead of the brand (issue #522)
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
                     the four sections, the two archives + the Wunschliste, and
                     one Einstellungen entry
    views-landing.js logged-out marketing landing page shown at / in accounts
                     mode before registration (issue #322)
    views-home.js    lobby + new round
    views-round.js        round hub (Start/Regal/Chronik/Pokale tabs) + Start tab
    views-round-tabs.js   Regal, Chronik, Pokale tabs + the three off-shelf
                          screens (retired / completed / Wunschliste)
    views-round-detail.js game detail, design picker, tags + providers screens,
                          sheet helpers
    views-round-settings.js round Einstellungen screen: the round-level actions
                          (invite, move games, delete/leave) in one place (#561)
    views-round-lookup.js provider lookup, add game, link provider
    views-member.js  member detail page (stats, name/color editing)
    views-session.js session setup, the rating cards, finale, results
    views-session-live.js the voting lobby every session opens (#655): who has voted, vote for
                     yourself or for anyone still open on this device, and end
                     the voting (issue #209)
    views-vote-link.js the PUBLIC /vote/:token screen (#652): claim your name
                     from the participant list and rate the drawn games without
                     an account — the only view that runs logged out
    views-inbox.js   per-user notification inbox (#207; accounts mode only)
    views-friends.js Freundeskreis view + home feed section (#325) and the
                     account profile at /u/:username (#558; accounts mode only)
    views-account.js Konto settings: identity + change password (#482; accounts mode only)
    router.js        URL ↔ view routing (History API): deep links, reloads
    main.js          bootstrap: route from the current URL              (loads last)
    pwa.js           registers the service worker (installable + offline)
scripts/
  build.js           optional cache-busting build: mirrors public/ into dist/
                     with content-hashed, minified js/css (npm run build)
  seed-dev.js        fills a throwaway DATA_DIR (.devdata/ by default) with the
                     guest demo's round + a local dev account, so a fresh clone
                     has something to look at; refuses the real data/
  resolve-demo-covers.js
                     re-resolves the demo seed's cover hotlinks against the
                     providers and prints a DEMO_GAMES block for lib/demo-seed.js
  capture-landing-shots.js
                     regenerates the committed landing-page product screenshots
                     (public/img/landing-*.webp) — seeds a throwaway dataset and
                     drives headless Chrome over CDP, one run for every locale
test/                automated tests (node --test + supertest); view specs
                     run the real frontend under jsdom (test/support/dom.js)
data/                all user data (git-ignored)
  data.json          created on first run
  uploads/           cover images
dist/                optional build output (git-ignored; npm run build)
Dockerfile           production container image (node:22-slim, non-root,
                     writes to DATA_DIR=/data; no VOLUME instruction — Railway's
                     builder rejects it, see .claude/rules/)
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
is ever committed; Dependabot keeps dependencies updated via weekly PRs.
