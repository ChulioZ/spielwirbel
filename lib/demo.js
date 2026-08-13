'use strict';

/*
 * Guest demo mode (issue #427): one click on the landing page mints a
 * throwaway, pre-seeded, fully writable account so a visitor can run the whole
 * voting flow without registering. The account expires and is purged; nothing
 * converts it into a real one.
 *
 * Double-gated like every other optional surface here: DEMO_ENABLED=true AND
 * accounts.accountsEnabled(). A self-hosted instance that sets neither is
 * byte-for-byte unchanged, and the endpoint 404s rather than advertising itself.
 *
 * Three things below are load-bearing and each fails quietly if undone:
 *
 *  - THE TENANT ID CARRIES A 'demo-' PREFIX, and that is not cosmetic. It is how
 *    trackEvent (lib/observability.js) excludes demo traffic from the operator's
 *    product counters without a single call site knowing about demo mode, and it
 *    keeps working across processes — production can run more than one replica
 *    (#215), so anything based on in-memory state would classify the same tenant
 *    differently depending on which replica answered. A real tenant id is 16 hex
 *    characters and can never collide with it.
 *  - THE SYNTHETIC E-MAIL MUST BE UNIQUE. createUser refuses a duplicate address,
 *    and in the JSON backend `null === null`, so leaving it empty would make the
 *    SECOND demo ever minted answer 'email_taken'. The address is under the
 *    reserved .invalid TLD (RFC 2606), so it can never receive or send mail.
 *  - A DEMO ACCOUNT HAS NO PASSWORD IDENTITY. `identities: []` means the login
 *    route can never authenticate it — its access/refresh tokens are the only way
 *    in, which is what makes the account genuinely disposable.
 */

const crypto = require('crypto');
const repo = require('./repo');
const accounts = require('./accounts');
const { logger } = require('./observability');
const seed = require('./demo-seed');
// See the header: this prefix is what classifies a tenant as demo, everywhere.
// It lives in its own dependency-free leaf module because the repo backends and
// lib/observability.js need it too and cannot require this file back (cycle).
const { DEMO_TENANT_PREFIX, isDemoTenant } = require('./demo-tenant');
// The current terms revision (#521). lib/legal.js requires nothing, so this
// cannot introduce a cycle.
const { TERMS_REVISION } = require('./legal');
// The current „Was ist neu" revision (#741) — a dependency-free leaf like
// legal.js, so requiring it here introduces no cycle either.
const { newsRevision } = require('../public/js/news');

const DEFAULT_TTL_HOURS = 24;
const DEFAULT_MAX_LIVE = 100;
const DEFAULT_MAX_LIVE_PER_IP = 3;

const iso = (ms) => new Date(ms).toISOString();

// Read per call, never at module load, so a test — or a live re-tune from the
// Railway dashboard — picks up the current env (the same discipline the
// rate-limit ceilings and quotas use, see .claude/rules/security-middleware.md).
function demoEnabled() {
  return process.env.DEMO_ENABLED === 'true' && accounts.accountsEnabled();
}

// How long a demo account lives before the purge job deletes it.
function ttlMs() {
  const hours = Number(process.env.DEMO_TTL_HOURS) || DEFAULT_TTL_HOURS;
  return hours * 60 * 60 * 1000;
}

// The ceiling on demo accounts alive at once. The per-IP limiter bounds one
// caller's convenience; this bounds the RESOURCE — rows and cover-less rounds an
// IP-rotating caller could otherwise mint without limit. Same split as the
// registration-mail budget (.claude/rules/bounding-bulk-registration-mail.md).
function maxLiveDemos() {
  return Number(process.env.MAX_LIVE_DEMOS) || DEFAULT_MAX_LIVE;
}

// How many live demos ONE source may hold at once (#502). The global ceiling
// above bounds the resource; this bounds one visitor, who could otherwise strand
// slots without rotating an IP or scripting anything: leaving a demo (logout, the
// banner's register CTA, a closed tab) drops the client's tokens while the row
// keeps its slot for the full TTL, so start -> leave -> start again burns two.
//
// Deliberately not 1: a household or an office behind one NAT must still be able
// to run two demos at once. It is not a replacement for the per-IP rate limiter
// either — that bounds the RATE of minting, this bounds the live COUNT.
function maxLiveDemosPerIp() {
  return Number(process.env.MAX_LIVE_DEMOS_PER_IP) || DEFAULT_MAX_LIVE_PER_IP;
}

// Key the per-IP cap on a HASH, never the raw address (#502). HMAC rather than a
// bare digest so the value cannot be reversed by hashing the ~4 billion IPv4
// addresses; the key is the same SESSION_SECRET the access tokens are signed
// with, which is guaranteed to exist wherever the demo runs (demoEnabled()
// requires accountsEnabled(), which requires the secret).
//
// Returns null when there is no address or no secret, and callers treat that as
// "cannot attribute this mint" — the cap is skipped rather than collapsing every
// unattributable visitor into one shared bucket.
function hashIp(ip) {
  const secret = accounts.signingSecret();
  if (!ip || !secret) return null;
  return crypto.createHmac('sha256', secret).update(String(ip)).digest('hex');
}

/* --------------------------------- guards ---------------------------------- */

// Refuse an action that would reach a REAL person from a throwaway account.
// Mount after accounts.requireUser (which sets req.userId).
//
// Sharing and inviting are out of scope for the demo (#427) — but "we didn't
// build a UI for it" is not a control, and these endpoints are reachable by hand
// with the demo's own token. Without this, a demo account is an anonymous,
// zero-cost way to send friend requests and round invitations to named strangers,
// i.e. a spam channel that lands in a real user's inbox and is unattributable
// because the sender is purged within the day.
//
// Deliberately narrow: it guards the two OUTBOUND sends, not the reads or the
// accept/decline routes. A demo account has nothing to accept, so blocking those
// would add no safety and would turn its (empty) Freundeskreis screen into an
// error state.
async function refuseDemoAccount(req, res, next) {
  try {
    const user = req.userId ? await repo.getUserById(req.userId) : null;
    if (user && user.demo === true) return res.status(403).json({ error: 'demo_forbidden' });
    return next();
  } catch (err) {
    return next(err);
  }
}

/* --------------------------------- seeding --------------------------------- */

// Build the round the visitor lands in. Everything goes through the ordinary
// tenant-scoped repo mutators (never raw SQL), so the demo exercises exactly the
// code paths a real round does and cannot drift from them — which also means a
// bug that would break a real round breaks the demo first, where we see it.
async function seedTenant(tenantId, userId, locale) {
  const scoped = repo.forTenant(tenantId);
  const text = seed.textFor(locale);

  // The visitor gets a real owner seat (#421), so the Chronik attributes their
  // actions and the round never offers their own chair in a seat picker.
  const round = await scoped.createRound({
    name: text.roundName,
    members: text.members,
    owner: { name: text.ownerSeat, userId },
  });

  // Tags first: a game references them by id, so they have to exist before the
  // games that carry them.
  const tagIdByKey = {};
  for (const key of Object.keys(seed.DEMO_TAGS)) {
    const used = seed.DEMO_GAMES.some((g) => (g.tags || []).includes(key));
    if (!used) continue;
    const tag = await scoped.addTag(round.id, seed.tagNameFor(key, locale), seed.DEMO_TAGS[key].icon);
    if (tag) tagIdByKey[key] = tag.id;
  }

  const ownerSeatId = round.members[0].id;
  const gameIds = [];
  for (const spec of seed.DEMO_GAMES) {
    const game = await scoped.createGame(
      round.id,
      {
        title: spec.title,
        minPlayers: spec.minPlayers,
        maxPlayers: spec.maxPlayers,
        // A hotlinked provider URL, never a copy — see lib/demo-seed.js.
        image: spec.image || null,
        source: spec.source,
        tagIds: (spec.tags || []).map((k) => tagIdByKey[k]).filter(Boolean),
      },
      ownerSeatId
    );
    gameIds.push(game ? game.id : null);
  }

  await seedSessions(scoped, round, gameIds);
  return round;
}

// Two finished sessions, so Chronik and Pokale render content instead of empty
// states on arrival. Written through createSession + saveSessionResults +
// setSessionChoice + finishSession — the same four steps the real flow takes, in
// the same order, so a seeded session is indistinguishable from a played one.
async function seedSessions(scoped, round, gameIds) {
  const memberIds = round.members.map((m) => m.id);
  for (const spec of seed.DEMO_SESSIONS) {
    const picked = spec.gameIndexes.map((i) => gameIds[i]).filter(Boolean);
    const chosen = gameIds[spec.chosenIndex];
    if (picked.length === 0 || !chosen) continue;
    const createdAt = iso(Date.now() - spec.daysAgo * 24 * 60 * 60 * 1000);

    // votes[personId][gameId] = { rating, retire } — the exact shape
    // lib/routes/sessions.js persists. `retire` is always false here: a seeded
    // round must not arrive with games already flagged for the archive.
    const votes = {};
    memberIds.forEach((mid, seat) => {
      const row = spec.ratings[seat] || [];
      votes[mid] = {};
      picked.forEach((gid, gi) => {
        votes[mid][gid] = { rating: row[gi] != null ? row[gi] : 3, retire: false };
      });
    });

    const session = await scoped.createSession(round.id, {
      createdAt,
      tagIds: null,
      excludeTagIds: null,
      requestedCount: picked.length,
      memberIds,
      gameIds: picked,
      votes: {},
      chosenGameId: null,
      chosenAt: null,
      finished: false,
      finishedAt: null,
      winnerIds: [],
      cancelled: false,
      cancelledAt: null,
      done: false,
    });
    if (!session) continue;

    await scoped.saveSessionResults(round.id, session.id, votes);
    await scoped.setSessionChoice(round.id, session.id, chosen);
    await scoped.finishSession(round.id, session.id, {
      finished: true,
      winnerIds: spec.winners.map((seat) => memberIds[seat]).filter(Boolean),
    });
  }
}

/* --------------------------------- minting --------------------------------- */

// Mint a demo account + tenant and seed it. Returns the created user, or the
// marker 'unavailable' when the live-demo ceiling is reached — the caller turns
// that into a friendly refusal rather than an error, because it is a capacity
// answer, not a fault.
//
// The cap is checked BEFORE any write, so a refused request leaves nothing
// behind. It is deliberately not a reservation: two requests racing at the
// ceiling can both pass and mint one demo over it, which costs one extra
// throwaway round and is far cheaper than the locking a hard cap would need.
async function createDemoAccount(locale, ipHash) {
  const now = iso(Date.now());
  const live = await repo.countLiveDemoUsers(now);
  if (live >= maxLiveDemos()) {
    logger.warn({ event: 'demo_capacity_reached', live, max: maxLiveDemos() });
    return 'unavailable';
  }

  // The per-source cap (#502). Only checked when the mint can be attributed: a
  // falsy hash must SKIP the check, never be passed down as a value — both
  // backends compare the stored field exactly, so counting on `null` would
  // match every row that has no hash (pre-#502 rows, and every mint made
  // without an address) and turn them into one shared bucket that refuses the
  // fourth visitor overall.
  //
  // Note req.ip is only the visitor's address if TRUST_PROXY is a correct hop
  // count (.claude/rules/trust-proxy-is-a-hop-count.md); production runs 2.
  if (ipHash) {
    const perIp = await repo.countLiveDemoUsersByIp(now, ipHash);
    if (perIp >= maxLiveDemosPerIp()) {
      logger.warn({ event: 'demo_ip_capacity_reached', live: perIp, max: maxLiveDemosPerIp() });
      return 'unavailable';
    }
  }

  const suffix = crypto.randomBytes(4).toString('hex');
  // One clock read for both stamps, so the TTL is measured from the row's own
  // creation rather than from whenever the cap queries above happened to finish.
  const mintedAt = Date.now();
  const user = await repo.createUser({
    // Unique and unroutable — see the header. Never shown to the visitor.
    email: `demo-${suffix}@demo.invalid`,
    // Fits the registration policy in public/js/username-policy.js (which this
    // path does NOT run — a generated handle needs no gatekeeping, and the
    // reserved list must never be able to block a mint). Shown in the account
    // menu, so it should read as what it is rather than as a random handle.
    username: `demo-${suffix}`,
    createdAt: iso(mintedAt),
    tenantId: `${DEMO_TENANT_PREFIX}${crypto.randomBytes(8).toString('hex')}`,
    // Nothing to verify: there is no address and no mail is ever sent. Leaving
    // this false would make the account fail the login/refresh guards it has to
    // pass to use the app at all.
    emailVerified: true,
    // No credential at all — the minted tokens are the only way in.
    identities: [],
    verification: null,
    reset: null,
    refreshTokens: [],
    disabled: false,
    disabledAt: null,
    disabledReason: null,
    bggUsername: null,
    // Written for absent-key parity with register (#521) — the two creation
    // sites must produce the same key set or the backends diverge
    // (.claude/rules/postgres-backend.md). A demo is purged within the day and
    // will never see a terms change, so the value itself never matters here.
    acceptedTermsRevision: TERMS_REVISION,
    // The „Was ist neu" seen-state (#741), written here for the same absent-key
    // parity reason as the revision above. Stamped current so a demo is born
    // caught up: a visitor trying the app for ten minutes has no history to be
    // told about, and a dot on their very first screen is noise.
    lastSeenNewsRevision: newsRevision(),
    // The three fields that make this account a demo. Every other key above is
    // present-but-null for the absent-key parity the two backends require
    // (.claude/rules/postgres-backend.md) — and so is demoIpHash, which is null
    // rather than absent when the mint could not be attributed.
    demo: true,
    demoExpiresAt: iso(mintedAt + ttlMs()),
    // Lives and dies with the row, so the purge and the self-end below are its
    // whole retention story — no separate reaper, no new retention promise.
    demoIpHash: ipHash || null,
  });

  // Both markers are unreachable here (the suffix is random and the address is
  // synthetic), but createUser's contract allows them, so treat them as the
  // capacity answer rather than returning a string where a user is expected.
  if (typeof user === 'string') {
    logger.warn({ event: 'demo_mint_collision', reason: user });
    return 'unavailable';
  }

  await seedTenant(user.tenantId, user.id, locale);
  return user;
}

/* --------------------------------- erasing --------------------------------- */

// Erase ONE demo account: its row, its tenant's rounds, and the cover objects
// those held. The single deletion path, shared by the TTL purge below and by the
// visitor ending their own demo (#502) — written once so the two cannot drift.
//
// Returns null when there is no such account, the marker 'tenant_shared' when
// eraseAccount refuses (unreachable for a demo, whose tenant is 1:1 by
// construction, but reported honestly rather than as a success that did not
// happen — the trap `.claude/rules/admin-cross-tenant-escape.md` §2 describes), and
// otherwise { rounds, images } counting what actually went.
//
// Rows first, bytes second — exactly as the admin erasure route does, and with
// no reference re-check: eraseAccount cascades the WHOLE tenant and an import can
// only copy a path within one tenant, so nothing that survives can still point at
// a collected object. storage.remove() ignores anything that is not an /uploads/
// path, which is what makes the seeded hotlinks safe to pass through here
// (.claude/rules/provider-cover-hotlinking.md).
async function endDemo(userId, storage) {
  const result = await repo.eraseAccount(userId);
  if (!result) return null;
  if (typeof result === 'string') return result;

  let images = 0;
  for (const image of result.images || []) {
    try {
      await storage.remove(image);
      images += 1;
    } catch (e) {
      // A failed object delete leaves an orphaned file, never a broken cover —
      // the reference is already gone. Never abort the rest.
      logger.warn({ event: 'demo_erase_image_failed', message: e.message });
    }
  }
  return { rounds: result.rounds || 0, images };
}

/* --------------------------------- purging --------------------------------- */

// Delete every demo account whose TTL has lapsed, together with its tenant's
// rounds and any cover objects those held. The backstop for every exit we cannot
// recognise — since #502 a visitor can also end their demo deliberately, but a
// closed tab or an abandoned browser still lands here.
//
// eraseAccount (#273) is reused (through endDemo) rather than a second deletion
// path being written: it already cascades the tenant's rows and hands back the
// freed '/uploads/<key>' paths. A demo round's covers are hotlinks, which
// storage.remove() ignores by construction — but a visitor can upload their own
// cover during the demo, so the paths still have to be cleaned up
// (.claude/rules/deletion-paths-must-free-cover-objects.md).
//
// A purge mid-session needs no client work: the erased account's still-valid
// access token resolves to ERASED -> 401 auth_required -> the SPA bounces to
// login (.claude/rules/erased-account-token-fallback.md).
async function purgeExpiredDemos(storage) {
  const expired = await repo.listExpiredDemoUsers(iso(Date.now()));
  let purged = 0;
  let rounds = 0;
  for (const uid of expired) {
    let result;
    try {
      result = await endDemo(uid, storage);
    } catch (e) {
      // One bad account must not abort the sweep — the next tick would hit it
      // again and stall the purge forever.
      logger.warn({ event: 'demo_purge_failed', message: e.message });
      continue;
    }
    if (!result || typeof result === 'string') continue;
    purged += 1;
    rounds += result.rounds;
  }
  if (purged) logger.info({ event: 'demo_purged', purged, rounds });
  return { purged, rounds };
}

module.exports = {
  DEMO_TENANT_PREFIX,
  DEFAULT_TTL_HOURS,
  DEFAULT_MAX_LIVE,
  DEFAULT_MAX_LIVE_PER_IP,
  demoEnabled,
  ttlMs,
  maxLiveDemos,
  maxLiveDemosPerIp,
  hashIp,
  isDemoTenant,
  refuseDemoAccount,
  createDemoAccount,
  endDemo,
  purgeExpiredDemos,
  seedTenant,
};
