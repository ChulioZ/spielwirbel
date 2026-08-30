# Configuration & deployment

Every setting is a plain environment variable; `.env.example` is the
authoritative list. This page explains what each group does and why.
For a first local run, the [README](../README.md) quick start is enough —
nothing here is required to start the app.

## Storage, network and limits

Use PostgreSQL instead of the JSON file: `DATABASE_URL=postgres://… npm start` (the
app runs its Knex migrations on start, so the schema is created/updated
automatically; add `DATABASE_SSL=true` for managed Postgres that requires TLS).
Unset, it uses `DATA_DIR/data.json` as before. Migrations can also be run
explicitly with `npm run migrate` (and authored with `npm run migrate:make -- <name>`).

Store cover images in S3-compatible object storage instead of on local disk (for
a stateless, scalable app tier): `S3_BUCKET=my-bucket npm start`. Set `S3_ENDPOINT`
(+ usually `S3_FORCE_PATH_STYLE=true`) for non-AWS stores like Cloudflare R2,
Backblaze B2 or MinIO; credentials come from `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`
or the AWS default provider chain. Unset, images stay under `DATA_DIR/uploads` as
before. See the S3 block in `.env.example`.

Behind a TLS-terminating proxy: `TRUST_PROXY=<hops> npm start` (so rate limiting
sees the real client IP). The value is the **number of proxy hops** between the
internet and the app — not a boolean, and not always 1: on Railway it is **2**.
Too low and `req.ip` resolves to your own proxy, silently turning every per-IP
limit into one bucket shared by everyone behind it; `true` is worse, since the
client can then spoof `X-Forwarded-For` and evade the limits. Verify it after
setting it — see [`deploy-railway.md`](deploy-railway.md)
("Verifying `TRUST_PROXY`").

Tune the limits with `RATE_LIMIT_MAX` (global, per 15 min),
`CONTACT_RATE_LIMIT_MAX` (contact-form submissions, per 15 min, default 5),
`REGISTER_RATE_LIMIT_MAX` (registrations, per 15 min, default 10 — see below) and
`DEMO_RATE_LIMIT_MAX` (guest demos, per 15 min, default 5 — see below), and
`VOTE_LINK_RATE_LIMIT_MAX` (the public vote link `/api/vote/…`, per 15 min,
default 60 — higher because it is an ordinary user action, not a signup), and
`AVATAR_RATE_LIMIT_MAX` (profile-picture uploads, per 15 min, default 10 — the
one endpoint whose cost is decoding attacker-supplied bytes, so it gets a much
lower ceiling than the account surface around it).

Voting by shared link (issue #652): a per-device session can be shared as
`/vote/<token>` so people **without an account** vote from their own phone.
`VOTE_LINK_TTL_DAYS` (default 30) is the backstop on how long such a link stays
valid — a link normally dies the moment voting closes, but a session that is
abandoned rather than closed reaches none of the event-driven deletions, so
without a max age its link would never expire. The link stops working at that
cutoff (checked in the route) and a 15-minute sweep deletes the rows.

Contact form (issues #224/#272): a public, login-free page at `/kontakt.html`
with a bilingual form that POSTs to `/api/contact`, which e-mails the operator —
the phone-free second communication channel a German Impressum (§ 5 DDG) relies
on, and the DSA notice-and-action channel: a category select turns a message
into a structured Art. 16 report (reported URL + good-faith statement; a CSAM
report may be anonymous), which is acknowledged to the notifier by mail
(Art. 16(4)). Every accepted submission is **also stored** (the operator
panel's Meldungen inbox), so a lost mail can never mean a notice left no
record — storing happens before sending. Delivery goes to `CONTACT_TO` (falling
back to `MAIL_FROM`) via the same SMTP setup as the account mails. It has its
own low rate limit and a server-side honeypot for spam, and in
`NODE_ENV=production` it **fails loud** (`502` with a fallback e-mail) rather
than silently dropping a message when mail is unconfigured — so configure
`SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` + `MAIL_FROM` + `CONTACT_TO`
before relying on it in production. A shared site footer links to it — but the
footer (and the form itself) only appears once the public `GET /api/config`
reports the instance ready: mail configured **and** the Impressum identity set
(all-or-nothing, so a half-configured deploy shows no public footer rather than
a broken one).

Legal pages (issues #134/#140): `GET /impressum`, `GET /datenschutz` and
`GET /nutzungsbedingungen` serve the server-rendered DDG Impressum, the DSGVO
privacy policy and the terms of use / DSA content rules (German authoritative,
English courtesy translation on the same page). The operator identity comes from
env at request time — `IMPRESSUM_ADDRESS` (postal address, may be multi-line)
and `IMPRESSUM_EMAIL` — so no address ever lives in the repo; while either is
unset all three routes answer 404 and the site footer stays hidden. The
registration form links the terms; the internal notice-and-action workflow and
retention schedule live in `docs/legal/`.

Serving one deployment under several domains: `CANONICAL_HOST` + `REDIRECT_HOSTS`
(issue #230) 301 the branded non-canonical domains onto a single canonical origin
(default: `spielwirbel.de`/`.com` + `www` → `spielwirbel.app`). It's an
allowlist, so it never touches the canonical host, a platform domain like
`*.up.railway.app`, or a load-balancer health-check host. Point them at your own
domains, or set `REDIRECT_HOSTS` empty to disable. See the block in `.env.example`.

Support link (issue #173): set `DONATE_URL=https://…` to show the top-bar heart
button that opens the donation sheet (see Features). The URL is opaque to the
app and is served to the client through the public `GET /api/config` (as
`donateUrl`, `null` when unset), so the button also works before login. Unset
(the default) the feature does not exist.

Guest demo mode (issue #427): set `DEMO_ENABLED=true` (on top of
`ACCOUNTS_ENABLED`) and the landing page offers **"Ohne Anmeldung ausprobieren"**
alongside registering, plus a `/demo` deep link so a launch post can point
straight into a running demo. One click mints a throwaway account with its own
tenant, seeded with a ready-to-play round — nine games with real provider covers,
four seats and two finished sessions, so Chronik and Pokale have content on
arrival — and drops the visitor into the app with no e-mail and no password.

The account is strictly disposable: a persistent in-app banner says so, it holds
no password identity (so it can never be logged back into), it cannot send friend
requests or round invitations, and registering afterwards starts a fresh, empty
account — nothing carries over. Expired demos are deleted together with their
rounds and any uploaded covers by a background job (`lib/scheduler.js`, started
from `server.js`).

A visitor keeps **one** demo rather than accumulating them (issue #502). The
account menu offers **"Demo beenden"**, which erases the demo immediately and
frees its slot; every other way of leaving (registering, closing the tab) keeps it
alive, and a return visit to the landing page offers **"Demo fortsetzen"** to
re-enter that same demo instead of minting a second one.

Tune it with `DEMO_TTL_HOURS` (how long a demo lives, default 24),
`MAX_LIVE_DEMOS` (how many exist at once, default 100 — past it the endpoint
answers a friendly "try again shortly" rather than minting without limit) and
`MAX_LIVE_DEMOS_PER_IP` (how many one source may hold at once, default 3; stored
as an HMAC of the address, never the address itself). Unset,
`POST /api/account/demo` 404s and the landing page shows no demo button, so a
self-hosted instance is unchanged.

Per-tenant quotas (issue #139): in the public multi-tenant mode (`ACCOUNTS_ENABLED=true`)
each tenant is capped on rounds (`MAX_ROUNDS_PER_TENANT`, default 10), games per
round (`MAX_GAMES_PER_ROUND`, default 1000), custom tags per round
(`MAX_TAGS_PER_ROUND`, default 30), member seats per round
(`MAX_MEMBERS_PER_ROUND`, default 50), expansions per game
(`MAX_EXPANSIONS_PER_GAME`, default 40), and dismissed recommendations per round
(`MAX_DISMISSED_RECOMMENDATIONS_PER_ROUND`, default 500, issue #782). Per
**account** rather than per
tenant: accepted friends (`MAX_FRIENDS_PER_USER`, default 500), open outgoing
friend requests (`MAX_FRIEND_REQUESTS_PER_USER`, default 50) and passkeys
(`MAX_PASSKEYS_PER_USER`, default 20, issue #418). With accounts off (the
default, single-tenant deploy) these are inert. See the quotas block in `.env.example`.

Require a login: set `AUTH_PASSWORD=…` (and optionally `SESSION_SECRET=…`) to gate
the whole app behind a single shared password — an unauthenticated visitor gets a
login page and the API returns `401`. Leave `AUTH_PASSWORD` unset and the app
stays open with no access control (the default for a bare local checkout; the
maintainer's hosted instance instead runs the account model below, with no shared
password). Tune the login brute-force
limit with `AUTH_RATE_LIMIT_MAX` (attempts per 15 min, default 100). The session is
a signed, httpOnly cookie (marked `Secure` automatically behind a TLS proxy).

User accounts (issue #135): the token-first account model — register with
e-mail + username + password (Argon2id-hashed), e-mail verification, login issuing
short-lived access tokens + rotating refresh tokens, and password reset — lives under
`/api/account`. Login accepts **either the e-mail address or the username** as the
identifier (issue #431); password reset stays e-mail-only, since the link has to
reach an inbox. A logged-in account changes its password on the **Konto** screen
(`/konto`, issue #482) instead of going through that recovery flow: it
re-authenticates with the current password, then signs every *other* device out
and mails the owner a notification. The same screen is where an account
**deletes itself** (issue #419): `DELETE /api/account` erases the account, its
tenant's whole round data and its uploaded cover objects, gated on the current
password *plus* the account's own username typed out, and preceded by a
confirmation naming the real counts (rounds, games, sessions, images, and how
many other accounts lose access to shared rounds). It is immediate and has no
undo — the operator-side erasure (#273) stays for assisted and DSA-driven cases.
The **username** (issue #320) is an app-wide unique public handle
(3–30 characters of `a–z A–Z 0–9 _ -`, matched case-insensitively but stored as
typed) chosen at registration and not self-renamable: it is how an account is
named in an abuse report, how invitations (#207) find it, and how it logs in, so
no account can exist without one. It is **off by default**: set `ACCOUNTS_ENABLED=true` *and* a
strong `SESSION_SECRET` to expose it. Verification/reset mails go out via
plain SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, links built
from `APP_BASE_URL`); unconfigured, they are logged instead of sent. Production
sends through the operator's own mailbox rather than a transactional provider,
so the mails carry no tracking pixel and no rewritten links (#440).

**Passkeys** (issue #418) are a second credential on the same account, added on
the Konto screen and used from the login screen's "Mit Passkey anmelden" button.
They live under `/api/account/passkeys` (register/list/rename/remove), with the
usernameless login pair at `…/passkeys/login` — the only unauthenticated part,
because signing in with a passkey has no session yet. That flow deliberately
takes **no identifier at all**: an e-mail-first passkey login would have to
answer "does this address have credentials?", which register and forgot-password
are carefully built never to answer.

A passkey never replaces the password — losing every device must not lock anyone
out — so the mailed reset path stays exactly as it is. `WEBAUTHN_RP_ID` is the
domain a credential is bound to (default: `CANONICAL_HOST`); treat it as
permanent once anyone has registered one, since changing it silently invalidates
every existing passkey. Set it to `localhost` for local development, and use
`WEBAUTHN_ORIGIN` only when the origin is not simply `https://<rp-id>` (a port,
a staging host). Verification uses `@simplewebauthn/server`; the browser half is
dependency-free.

Two bounds keep bulk registration from draining that mailbox's sending quota
(#448) — which matters because verification mail is the only way through signup,
so an exhausted quota breaks registration for *everyone*: a tighter per-IP cap on
`POST /api/account/register` (`REGISTER_RATE_LIMIT_MAX`, default 10 per 15 min)
and a global daily circuit breaker on all outbound mail (`MAIL_DAILY_MAX`,
default 200 per UTC day). Past the budget, sends are refused and logged as
`mail_daily_budget_exhausted` rather than delivered; set it below your mail
provider's own daily limit. Both counters are per process and in memory. How
much of the day's budget is spent shows on the admin panel's Kennzahlen card.

Since #618 that budget has **two classes**, derived from the same number rather
than from a second env var. The **last quarter** of `MAIL_DAILY_MAX` is reserved
for *critical* mail — verification, password reset, contact-form delivery — so
the inbox notifications (round invitations, friend requests) can never spend the
headroom signup depends on. A notification refused by the reserve logs
`mail_notification_budget_reserved`, deliberately a different event from
`mail_daily_budget_exhausted`: the first means the breaker is doing its job, the
second means registration is affected right now.

When accounts are enabled the app runs in **accounts mode** (issue #138): the SPA
shows an in-app onboarding flow — register → confirm e-mail → log in, plus password
reset and a first-run empty state — and the `/api` data routes require a valid
account token (there is no anonymous access, and each account sees only its own
tenant's rounds, #136). **This is what the maintainer's hosted instance runs**:
public registration opened on 2026-07-24 (#219) and `AUTH_PASSWORD` was removed,
so production is accounts-only — plus the guest demo below, enabled there since
2026-07-27, so the app can also be tried without registering. With accounts **off** (still the default for a
fresh checkout) the shared-password gate above is unchanged. *Roles within a
shared tenant are still follow-up work (#137).*

**Layered mode** (issue #266): the shared-password gate and accounts can run at the
**same time** — set `AUTH_PASSWORD` **and** `ACCOUNTS_ENABLED` (with a dedicated
`SESSION_SECRET`). The instance stays sealed behind the shared password (register
and login sit behind it, so it is **not** public sign-up) while everyone inside
uses real accounts. This is the recommended go-live path: run layered until every
account flow is proven, then simply **remove `AUTH_PASSWORD`** to open public
registration. Migrating an instance that already holds pre-accounts data needed
one extra chore — a one-time **„Standard-Daten übernehmen"** admin action that
re-tenanted the `default` rounds into a fresh owner account. It ran on this
deployment during the 2026-07-24 go-live and was **removed again in #405**, since
a standing cross-tenant write escape has no purpose on a public instance; a fresh
deployment never needed it. A self-hoster migrating an existing shared-password
instance should run the claim from a revision that still has it (any commit
before #405) and then upgrade — see
[`deploy-railway.md`](deploy-railway.md).

Operator moderation (issues #268/#272/#273/#274/#275): setting `ADMIN_PASSWORD`
exposes `/admin.html` + `/api/admin`, the standalone operator panel for acting
on abuse notices and data-subject requests. It shows the stored contact
submissions as a **Meldungen inbox** (a reported `/uploads/…` path hands off to
the image lookup with the takedown reason prefilled; deciding a notice records
the outcome and can notify the notifier with redress information, Art. 16(5));
it can resolve a notice by reported
cover path, round link, username, e-mail address or tenant id (with a per-tenant
summary shown against the quota ceilings); take a cover image down (deletes the object
*and* clears every reference) — after which the panel generates the DSA
**Art. 17 statement of reasons** from the log entry, copyable or sent by mail
with the delivery recorded on the entry; **redact** any user-authored text — round name,
game title, member name, tag name, feedback message — by overwriting the field
with `[entfernt]` while preserving the original wording on the log entry a DSA
Art. 17 statement of reasons has to quote (redaction never deletes a row);
suspend or restore an account without deleting anything, effective immediately
(existing access tokens stop working); replace an unlawful **username** with a
neutral handle derived from the account id, keeping the previous one on the log
entry (#320); **export** everything held for one
account as JSON (GDPR Art. 15/20); and perform an Art. 17 **erasure** — the
account, its tenant's rounds and the stored cover objects — which demands a
reason plus the account's own e-mail typed as confirmation and refuses if a
second account still shares the tenant. Every action lands in a log filterable
by tenant, action and date range; the erasure entry records only ids, date,
reason and counts, never the erased content, since the log outlives the erasure
it evidences.

The panel opens with a **Kennzahlen** card: how much this instance is being used
— accounts (verified / unverified / suspended, plus new ones in the last 7 and
30 days), how many of them own at least one round, rounds, games, sessions
(finished, and in the last 30 days), live guest demos against their cap, the
day's outbound mail against the `MAIL_DAILY_MAX` budget (a per-process counter —
with several replicas the card shows the answering process's share, not a
global sum), shared
rounds / open invitations / friendships, and the **quota ceilings paired with
the highest value anyone currently holds** against each, so "is someone about to
be refused?" is answerable without a database console. Every field is a count —
**no secret value and no personal data is ever returned**, and demo tenants are
excluded from everything but their own row. A **Feedback** card shows what users sent through the contact form's
Feedback category (with the sender's address only where they provided one).
The Feedback and Protokoll cards page rather than truncate (`100 von 342`,
**Mehr laden**) and export *every* entry as UTF-8 CSV (BOM included, so Excel
renders umlauts correctly).

The tables themselves are **search-first and row-click** (issue #403). The
**Konten** card fetches nothing until the operator searches (by partial e-mail,
username or tenant id — `GET /api/admin/users?q=…` filters server-side), so no
account's e-mail address leaves the server just because the panel was opened;
an explicit **„Alle anzeigen"** still lists every registered account. Guest-demo
accounts are never listed and never match a search (issue #506) — they are
throwaway rows the scheduler purges on its own. Rows across Konten,
Meldungen, Feedback and Texte der Runde carry no inline buttons: clicking one
(or focusing it and pressing Enter) opens a dialog holding the full record and
every action that applies to it. Individual **Feedback** entries and
**Meldungen** are deleted from there — feedback freely, while a *decided* notice
is protected (it is Art. 17 retention evidence) behind an explicit confirmation.

`ADMIN_PASSWORD` must be a **separate** secret from `AUTH_PASSWORD`: the latter
is shared with everyone using the instance, while these powers cross tenant
boundaries. Optionally set `ADMIN_SESSION_SECRET` to sign the admin cookie
(otherwise `SESSION_SECRET`, then the password itself). Leave `ADMIN_PASSWORD`
unset — the default — and the entire surface `404`s.

Add-game lookup: BoardGameGeek is the only provider, and it needs
`BGG_API_TOKEN` — a bearer token from a registered application
([boardgamegeek.com/applications](https://boardgamegeek.com/applications), see
[Using the XML API](https://boardgamegeek.com/using_the_xml_api)). Requests are
made server-side and cached, as BGG's terms ask, and the app displays the
required linked "Powered by BGG" logo in its footer. Leave the token unset and the
lookup simply returns nothing. (Four digital storefronts were providers too
until #744 retired them; games already linked to one keep their link and their
cover, and the five `*_LOCALE`/`STEAM_CC` variables that configured them are
gone.)

The BGG metadata those requests bring back (complexity, playing time, minimum
age, categories, mechanics) is filled in lazily, in the background, at the points
it is about to be read — including the session setup screen and the Regal, whose
„Filter" control derives its metadata half from it (issue #736). A session draw that
carries such a filter waits for that fill before drawing, since a game the
provider was never asked about passes every filter; `DRAW_BACKFILL_TIMEOUT_MS`
(default 4000) caps that wait, after which the draw proceeds with the values
already stored. An unfiltered draw never waits.

BGG carries at most 20 games per request, so a freshly imported collection needs
several. A collection import and an open of either filter screen start a **paced
background pass** over the shelf; the screen answers after its first batch, so
the controls appear at once and the rest fills behind the response.
`PROVIDER_INFO_BATCH_PAUSE_MS` (default 2000) is the gap between two of those
requests.

### The BoardGameGeek game corpus (issue #681)

A local pool of a few thousand ranked BGG games — their ratings, complexity,
player counts, mechanics and categories — that recommendation features score
against, and that the provider-metadata backfill above reads **before** asking
BGG (#829): a game the corpus already knows is filled with no upstream request
at all, so only what it lacks is fetched. It exists because BGG's API has **no browse, filter or attribute-search
endpoint at all**: "which games would fit this group?" cannot be asked upstream,
so the app has to hold its own candidate pool.

There is no on/off switch. An instance with nothing uploaded simply has an empty
corpus, and the features reading it show their own empty state.

**Filling it is a manual operator step, by design.** BGG publishes the pool as a
single CSV, covered by the same licence as the XML API — but
[boardgamegeek.com/data_dumps/bg_ranks](https://boardgamegeek.com/data_dumps/bg_ranks)
requires a logged-in **BGG session cookie**, not `BGG_API_TOKEN`, so the server
cannot fetch it. In the operator panel's **BGG-Korpus** card:

1. download `boardgames_ranks_<date>.zip` from that page while logged in to BGG,
2. unzip it locally (the app takes the `.csv`, not the ZIP — this repo has no
   unzip dependency and one is not worth adding for a monthly operator action),
3. upload the CSV.

Expansions, unranked games and games under the ratings floor are dropped on
ingest, and the best-ranked `BGG_CORPUS_SIZE` survive. Roughly monthly is ample;
the card shows the dump's age and turns amber past 45 days.

**How the two limits interact — measured on a real dump, 2026-08-14.** Of
**180,000** rows, **162,517** were dropped by the filters and **17,483** were
eligible, so at the default ceiling of 5000 the cap — not the ratings floor —
was deciding what the corpus held, discarding 12,483 qualifying games. The upload
reports those two numbers apart for exactly this reason.

That makes `BGG_CORPUS_SIZE` a knob worth setting deliberately rather than
leaving at its default. **Set it above the eligible count and
`BGG_CORPUS_MIN_RATINGS` becomes the only gate**, which is the more principled
model: the floor answers "is BGG's data on this game worth believing", while a
rank cutoff answers nothing in particular. The default stays conservative (5000
is a ~6-hour fill) because a fresh self-hosted instance should not spend a day of
upstream requests before it has decided whether it wants the feature.

The per-game attributes are then filled in by a background job
(`lib/scheduler.js`) at `BGG_CORPUS_BATCHES_PER_TICK` requests of 20 ids per
15-minute tick, spread thin because BGG's terms ask for *few* requests rather
than fast ones. At the defaults that is 40 batches an hour, so the one-time fill
scales linearly with the ceiling:

| Corpus size | Storage | One-time fill |
|---|---|---|
| 5,000 | ~6 MB | ~6 h |
| 10,000 | ~11 MB | ~12.5 h |
| 20,000 | ~20 MB | ~25 h |

Storage is not the constraint at any of these — an enriched row measures
**0.7–1.3 KB** (the famous games carry far more category, mechanic and family
links than the tail). Upstream requests are, which is what the ceiling is really
budgeting. Steady state is negligible either way: a 17,000-game corpus on the
30-day refresh window spends about 30 of the ~960 batches available per day.

It needs `BGG_API_TOKEN`; without one the corpus stays un-enriched rather than
erroring. Re-uploading a dump **keeps** the enrichment of every game still in it,
so a monthly refresh costs a handful of requests, not another full pass — and
raising the ceiling later only pays for the newly admitted games.

| Variable | Default | What it does |
|---|---|---|
| `BGG_CORPUS_SIZE` | `5000` | how many games to keep, best-ranked first; above the eligible count it stops binding and the ratings floor decides |
| `BGG_CORPUS_MIN_RATINGS` | `100` | ratings floor below which BGG's averages are noise |
| `BGG_CORPUS_BATCHES_PER_TICK` | `10` | `/thing` requests per tick; `0` pauses enrichment |
| `BGG_CORPUS_STALE_DAYS` | `30` | when an enriched row is refreshed |

Nothing in the corpus is personal data — it is public metadata about published
games, fetched server-side — so it needs no privacy-policy or VVT entry.

Wish-list prices (issue #679) are **off** unless `PRICES_ENABLED=true`: opening a
wished-for game that carries a provider link then shows what it costs right now —
board games through the
[Brettspielpreise.de / BoardGamePrices](https://boardgameprices.co.uk/api/plugin)
API (keyed on the BGG id already stored on the game). The hop is made
server-side and cached for an hour, as the aggregator's terms ask; only the
game's id is transmitted, so no personal data leaves and the visitor's browser
contacts nothing. With the flag unset the route `404`s and no price
section renders anywhere.

`PRICES_DESTINATION` / `PRICES_CURRENCY` (default `DE`/`EUR`) are the fallback
market for any UI locale with no mapping of its own — `de` maps to DE/EUR and
`en` to GB/GBP. The aggregator supports exactly DK, SE, GB, DE and US as
destinations; there is no AT or CH one, so Austrian and Swiss readers see German
shipping estimates. `PRICES_SITENAME` (default `spielwirbel.app`) is the host we
identify as, which is their attribution mechanism.

The **last price** each lookup answered is stored and used as a fallback
(issue #688): when the source cannot be reached, the wish still shows that price
rather than nothing, led by its age („Preis von vor 3 Tagen") instead of the
quiet retrieval footnote a fresh price carries. It is read *only* when a live
lookup is unavailable, never in place of one, and
`PRICES_FALLBACK_MAX_AGE_DAYS` (default 7) is the age past which nothing is shown
at all — a stale price presented as current is a misleading omission, so that
ceiling is correctness rather than cache sizing. A background sweep deletes rows
past it. Nothing personal is stored: one row per game, destination, currency and
edition, holding the game's id and the price, global and un-scoped.

When a price source fails it is **paused for `PRICES_FAILURE_COOLDOWN_SECONDS`**
(default 120) rather than retried on the next page view. A success is cached for
an hour but a failure deliberately is not, so without the pause a sustained
upstream outage costs the full request timeout on *every* wish-detail view — and
keeps hammering an upstream that is already failing. The pause is per **source**,
so a second source would keep answering while one is out, and it never hides a
price already held: a cached answer is still served while its source is down. Set `0`
to disable. The board-game request timeout deliberately sits **above** the
aggregator's own ~10 s gateway budget, so an upstream `504` is logged as such
instead of being masked by our own abort.

There are deliberately **no affiliate or commission links, ever** (operator
decision 2026-08-07). That is what keeps the operator non-commercial here and
removes the ad-labelling duty (§ 5a Abs. 4 UWG); it is a legal posture, not a
config switch, so don't add an affiliate parameter as a "harmless" follow-up.

Instance-wide public statistics (issue #564) are **live by default** — the one
opt-**out** switch here. `PUBLIC_STATS_ENABLED=false` makes `GET
/api/stats/public` answer `404`, renders nothing on any surface and stops the
rebuild job making provider requests; anything else, including unset, publishes.
It is inverted on purpose: this is the only feature that renders on a *public*
page, so the switch that matters is the one that takes it down quickly, and the
per-metric floors below already prevent a small instance from publishing weak
numbers.

What appears: the logged-out landing page and a shareable `/entdecken` screen
show how many **rounds**, **players**, shelf **games** and played **sessions**
the instance holds, plus the games on the most shelves, played most this week /
month / year, and best rated. „Players“ counts member seats across all rounds,
not accounts — most people in a round never hold one, which is the point of the
app — and „games“ counts the active Regal only, so wishes and archived games are
excluded.

Two properties are worth knowing. **Game names come from BoardGameGeek, never
from the title someone typed** — the aggregate is keyed on the provider link and
the display name is resolved from the provider, so no user-authored byte can
reach the public page. The cost of that guarantee is that games with no provider
link never appear in the rankings, although they still count in the totals. And
because the rankings show hotlinked covers, an anonymous visitor’s browser
contacts BoardGameGeek, which until now only happened inside the signed-in app —
the privacy policy’s sections 5 and 7 and `docs/legal/vvt.md` row 22 cover both.

Each metric hides itself until it clears its own minimum, which is what makes
shipping it on safe: `PUBLIC_STATS_MIN_ROUNDS` / `_PLAYERS` / `_GAMES` /
`_SESSIONS` (25/100/500/100) for the counters. Most-owned pairs
`PUBLIC_STATS_MIN_SHELVES` (3) — the number the card *displays*, since a round
has one Regal — with `PUBLIC_STATS_MIN_OWNER_TENANTS` (2), which stops one
person with several rounds reaching the podium alone. The three period cards get
their own floors, because three sessions in a week is a fact and three in a year
is noise: `PUBLIC_STATS_MIN_PLAYS_WEEK` / `_MONTH` / `_YEAR` (3/8/25) each with
a `_PLAY_TENANTS_` spread (2/3/5). Best rated pairs `PUBLIC_STATS_MIN_RATINGS`
(5) with `PUBLIC_STATS_MIN_RATING_TENANTS` (2) — the count floor is why the card
can rank on the average at all. Like every ceiling here they are read per call,
so raising one pulls a single metric back without a deploy. A `0` is honoured
rather than falling back to the default.

The payload is rebuilt by the background scheduler and served from memory —
nothing is computed per request and nothing is stored — and
`PUBLIC_STATS_RESOLVE_MAX` (default 20) caps how many *new* provider lookups one
rebuild may make. Only games that could actually reach a podium are resolved
(ranking happens on the raw numbers first) and successful lookups are memoized,
so a steady state costs no upstream requests.

Observability: logs go to stdout as structured JSON; set `LOG_LEVEL`
(`silent`/`error`/`warn`/`info`, default `info`) to tune verbosity, and
`ERROR_WEBHOOK_URL` to have unexpected 500s POSTed to an alerting webhook (a
non-2xx reply from it is logged at `warn`, so a misconfigured webhook can't fail
silently).

Two probe endpoints, both unauthenticated and exempt from rate limiting so a
monitor can poll them freely, and both excluded from the request log:

| Endpoint | Answers | Use it for |
|---|---|---|
| `/healthz` | `{ status: 'ok', uptime, timestamp }` — always 200 while the process is up | liveness; the container health check |
| `/readyz` | `200 {"status":"ok"}`, or **`503 {"status":"degraded"}`** when the data backend is unreachable | uptime monitoring / alerting |

`/healthz` deliberately never touches the database, so it answers 200 straight
through a database outage — which is exactly when every data route is failing.
That is why `/readyz` exists; point external alerting at it. The readiness result
is cached for a few seconds, so polling it cannot drive database load. Don't make
`/readyz` the *deploy* health check: a transient database blip would then
restart-loop the container.

### A filled local dev instance

A fresh clone starts empty, so a UI change gets verified against a blank Regal,
an empty Chronik and empty Pokale. `scripts/seed-dev.js` fills a **throwaway**
dataset with the same content the guest demo uses — curated games with real
cover art, tags, four seats and two finished sessions with votes:

```bash
node scripts/seed-dev.js        # seeds .devdata/ (German); `en` for English
DATA_DIR=/tmp/x node scripts/seed-dev.js   # or any other throwaway folder
```

It refuses three things: a set **`DATABASE_URL`** (which would route the seed
into Postgres, where `DATA_DIR` protects nothing), the default **`data/`**
directory (which on a maintainer's machine can hold a real instance's data), and
a target that already holds rounds or accounts (delete it and re-run rather than
seeding on top). Stop any server running against the target first — a live
server holds the dataset in memory and overwrites the file on its next save.

It also creates one local account, `dev@spielwirbel.invalid` /
`spielwirbel-dev`, whose tenant is the same `default` one the round belongs to.
That is what makes the seed visible in **both** auth modes: unauthenticated when
accounts are off, and after logging in as that account when they are on (which
is what the committed `dev-temp-data` preview config runs). The credentials are
deliberately worthless — they only ever exist inside a gitignored throwaway
dataset, so never point the script at a dataset anyone else can reach.

### Measuring what an agent session costs

The `.claude/skills/` workflows are read by an agent on every tool call, so their
size and the number of calls they provoke are a real running cost. `npm run
session-cost` reports it from Claude Code's own transcripts:

```bash
npm run session-cost              # the 5 largest sessions of this repo
npm run session-cost -- --limit 10
npm run session-cost -- <path-to-session.jsonl>
```

For each session it prints the request count, the context at the **first** request
(the fixed preamble — `CLAUDE.md`, the always-on rules, the loaded skills, memory
— which is re-read on every later call), the cache-read total, and the largest
tool results. Images are counted as calls rather than by their base64 length,
which would overstate them by two orders of magnitude. It reads only
`~/.claude/projects/`; it never touches `data/`.

### Configuration via a `.env` file

All settings above are plain environment variables (see `.env.example` for the
full list). To keep them in a file instead of the command line, copy the
template and start with `start:env`:

```bash
cp .env.example .env      # then edit .env and fill in what you need
npm run start:env         # loads .env, then runs the server
```

`start:env` uses Node's built-in `--env-file-if-exists` (Node ≥ 20.12; a missing
`.env` is fine), so there is no extra dependency. **`.env` is gitignored** — it
may hold your `SESSION_SECRET` and provider credentials, so never commit it.
Plain `npm start` ignores
`.env` and reads only real environment variables.

### With Docker

A production container image is provided (`Dockerfile`, `node:22-slim`, runs as a
non-root user). Build and run it directly:

```bash
docker build -t spieleabend .
docker run -p 3000:3000 -v spieleabend-data:/data spieleabend
```

Or use Compose — `docker compose up` builds the image and wires the same
persistent volume. Data (rounds, sessions, uploaded covers) lives on the mounted
**`/data`** volume, so it survives restarts and redeploys; point `DATABASE_URL` /
`S3_BUCKET` elsewhere for a stateless app tier. Configure everything via
`-e`/`environment:` (see `.env.example`). The image sets `NODE_ENV=production`, so
it serves the content-hashed build (`dist/`).

**TLS is not in the image** — terminate it at a reverse proxy or managed platform
in front of the container, then set `TRUST_PROXY` to the number of proxy hops in
front of it (see issue #156; it is **2** on Railway). On merge to
`main`, CI publishes the image to the GitHub Container Registry
(`ghcr.io/chulioz/spielwirbel`), so a host can pull it instead of building.

> ⚠️ **Self-hosters: the image moved.** With the Spielwirbel rebrand (#230) the
> repository was renamed `game-sessions` → `spielwirbel`, so the published image
> is now **`ghcr.io/chulioz/spielwirbel`**. GHCR packages do **not** auto-redirect
> like repo URLs, so the old `ghcr.io/chulioz/game-sessions` tags are frozen and
> receive no new builds. Update your `docker-compose.yml`/`docker run` to pull the
> new path.

### Deploying to Railway (production)

The production target is [Railway](https://railway.com): it builds the
`Dockerfile` (config in `railway.json`, health-checked at `/healthz`) and
auto-deploys on push to `main`. Pair it with **managed PostgreSQL** (Railway
plugin → `DATABASE_URL`, the #127 backend) and **Cloudflare R2** for cover images
(S3-compatible → the #128 backend via `S3_ENDPOINT`); Railway terminates TLS at
its edge, so set `TRUST_PROXY=2` (Railway has two proxy hops — verify it, a wrong
count silently collapses every per-IP rate limit into one shared bucket). The
full step-by-step — EU region, custom
domain, and the account/secret steps only you can do — is in
[`deploy-railway.md`](deploy-railway.md).
