'use strict';

/*
 * Per-tenant /uploads authorization (issue #955) — the second half of the
 * uploads gate.
 *
 * lib/app.js mounts `/uploads` as `uploadGate -> requireUploadOwner ->
 * storage.serve`. The gate (lib/accounts.js) answers "is this a valid account?";
 * until #955 that was the WHOLE check, so any account — including a free
 * guest-demo one — could fetch any object by key. Keys are 16 hex chars from
 * crypto.randomBytes(8), so enumeration was never the cheap attack; a KNOWN key
 * was: a grantee whose share was revoked, or a cover path that left the round
 * (the public ballot at /api/vote/:token hands them out, a pasted link, a
 * screenshot). This middleware answers the question the gate never asked —
 * WHOSE object is it — and is the one place that decision is made, for both
 * storage backends at once (it sits in front of storage.serve, so disk and S3
 * are covered by construction).
 *
 * The rules:
 *   - a GAME cover  -> the owning tenant, or an account holding a grant on the
 *                      round that references it (#207);
 *   - a PROFILE picture -> any signed-in account. That is the deliberate design
 *                      of #558/#841 and what the privacy policy §16 states, so
 *                      it is a rule here rather than an omission;
 *   - anything else (unreferenced, orphaned, taken down) -> nobody.
 *
 * REFUSAL IS 404, NEVER 403, and a miss and a refusal go through the SAME
 * branch below — so "this key exists but is not yours" is indistinguishable
 * from "no such key" by construction rather than by two hand-matched responses.
 * A 403 would confirm the object exists, which is most of what a probe wants.
 *
 * The moderation read path (lib/routes/admin.js) is deliberately NOT affected:
 * it is mounted on /api/admin and reads cross-tenant on purpose, because an
 * abuse notice names an image and not a tenant
 * (.claude/rules/admin-moderation-surface.md).
 */

const repo = require('./repo');
const accounts = require('./accounts');
const { DEFAULT_TENANT } = require('./tenant');

/*
 * Two positive-only caches, because this runs on EVERY image GET and a Regal
 * screen is ~30 of them in parallel. Both are per-process and hold nothing a
 * second replica would need to see: each process resolves independently and the
 * worst a stale entry can do is serve an owner their own object for another
 * TTL. So this is not the kind of in-memory state
 * .claude/rules/deploy-invariants-are-pinned-in-code.md warns about — no
 * ceiling and no per-caller bound rides on it.
 *
 * NEGATIVES ARE NEVER CACHED, and that asymmetry is the load-bearing part: a
 * cached "no owner" would hide a just-uploaded cover from the person who
 * uploaded it, for the length of the TTL, with no error anywhere. Positives are
 * safe because an object's owner never changes — it is created with its
 * reference and a takedown/erasure deletes the bytes, so storage.serve 404s
 * anyway once the cache does expire.
 *
 * GRANTS ARE NEVER CACHED EITHER: a revoked share must stop working at once,
 * which is exactly what #955's acceptance criteria test. They are also only
 * consulted when the tenant check has already failed, so the common path pays
 * nothing for that.
 */
const TTL_MS = 60_000;
const CACHE_MAX = 2000;

function cacheGet(cache, key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(cache, key, value) {
  // delete-then-set so the Map's insertion order stays a true eviction order
  // for a key that is merely being refreshed.
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

const ownerCache = new Map();
const tenantCache = new Map();

// Exported for the tests, which drive several tenants through one process and
// must not read a previous case's answer.
function resetUploadAccessCache() {
  ownerCache.clear();
  tenantCache.clear();
}

async function ownerOf(image) {
  const cached = cacheGet(ownerCache, image);
  if (cached !== undefined) return cached;
  const owner = await repo.findImageOwner(image);
  if (owner) cacheSet(ownerCache, image, owner);
  return owner;
}

// The tenant this request acts as. Mirrors lib/tenant.js's resolveTenantId, with
// two deliberate differences: the credential may ride the `sa` cookie (an <img>
// GET cannot send a header — that is why requireUploadAccount exists at all),
// and an account whose row is GONE resolves to null rather than falling back to
// 'default'. The fallback would hand a stateless-but-still-signed token from an
// erased account the legacy production group's covers, which is the same trap
// resolveTenantId's ERASED branch closes for /api.
async function callerTenantId(req) {
  if (!accounts.accountsEnabled()) return DEFAULT_TENANT;
  const uid = req.uploadUserId;
  if (!uid) return null;
  const cached = cacheGet(tenantCache, uid);
  if (cached !== undefined) return cached;
  const user = await repo.getUserById(uid);
  if (!user) return null;
  const tid = user.tenantId || DEFAULT_TENANT;
  cacheSet(tenantCache, uid, tid);
  return tid;
}

async function requireUploadOwner(req, res, next) {
  // Mounted at /uploads, so req.path is the key with a leading slash. Decoding
  // can throw on a malformed escape ('%ZZ'); that is a key nothing can own.
  let key;
  try {
    key = decodeURIComponent(req.path);
  } catch {
    return res.sendStatus(404);
  }
  const image = '/uploads' + key;

  const owner = await ownerOf(image);
  // Unreferenced object, or one whose reference was cleared by a takedown or an
  // account erasure. Nobody may read it — including the tenant that uploaded it,
  // which is the honest answer: the app itself no longer points at it.
  if (!owner) return res.sendStatus(404);

  // A profile picture is readable by any signed-in account (#558/#841, policy
  // §16) — the app resolves other people's faces across tenants by design
  // (friends, shared rounds). uploadGate has already refused an anonymous
  // caller, which is the part that still has to hold.
  if (owner.kind === 'account') return next();

  const tenantId = await callerTenantId(req);
  if (tenantId && owner.tenantId && tenantId === owner.tenantId) return next();

  // Not ours: a live grant on the round that references this cover is the one
  // remaining way in (#207). Read fresh every time — see the cache note above.
  if (req.uploadUserId && owner.roundId) {
    const grants = await repo.listGrantsForUser(req.uploadUserId);
    if (grants.some((g) => g.roundId === owner.roundId)) return next();
  }

  // Same branch as the miss above, on purpose.
  return res.sendStatus(404);
}

module.exports = { requireUploadOwner, resetUploadAccessCache };
