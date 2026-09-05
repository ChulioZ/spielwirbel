'use strict';

/*
 * Per-round role enforcement (issue #137) — THE one place a round-level action's
 * required role is decided. Mounted on /api/rounds/:rid in lib/app.js, AFTER
 * resolveRoundGrant (which has already re-scoped req.repo and set req.grant) and
 * BEFORE every round router, so no handler can forget the check.
 *
 * It sets req.roundRole — 'owner' when the caller reached the round by owning it
 * (no grant, which also covers legacy accounts-off mode), otherwise the grant's
 * normalized role — and refuses the request when that role cannot perform the
 * action this path maps to.
 *
 * WHY A TABLE RATHER THAN A GUARD PER HANDLER. Before this, "who may do what"
 * was four hand-placed `if (req.grant) → 403 not_owner` checks, and the model was
 * "a new round-level route is open to grantees unless someone remembers to add
 * one". #411 is what that costs: POST …/games/move-to resolved its targetRoundId
 * through the re-scoped repo, so a grantee could move a shared round's whole
 * shelf into any round the owner had. It shipped, ran in production, and was
 * found later. The default here is the other way round — see UNLISTED below.
 *
 * WHAT THIS IS NOT. It is a FLOOR, not the whole answer: a handler may still
 * narrow further when the decision depends on the request rather than on the
 * role alone. Three do, and all three read the same capability table rather than
 * testing req.grant for truthiness:
 *   - DELETE …/shares/:userId — any grantee may remove their OWN share (leaving),
 *     only 'round.shares.manage' may remove someone else's.
 *   - PATCH …/members/:mid — name and colour are an ordinary write; the userId
 *     link needs 'member.link'.
 *   - DELETE …/sessions/:sid — discarding a session whose voting is still RUNNING
 *     (neither done nor cancelled) is an ordinary write; deleting one that has
 *     resolved either way needs 'session.delete' (#857).
 * That is the difference between "this route costs role X" (here) and "this
 * request costs role X" (there), and only the first can live in a table.
 */

const { normalizeRole, can } = require('../public/js/round-roles');

// Methods that change something. GET/HEAD/OPTIONS are not gated: resolveRoundGrant
// has already bounded the request to exactly the granted round, and every role in
// the ladder may read it, so an unlisted GET leaks nothing. Gating reads would
// also turn a typo'd path into a 403 instead of a 404 for the round's own owner.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// `capability` is the name looked up in public/js/round-roles.js. 'round.write'
// is the ordinary case and is deliberately absent from that file's CAPABILITY_ROLE
// map, so it resolves to the default floor (editor) — naming it here anyway keeps
// every route's requirement stated rather than implied by omission.
//
// Paths are relative to the /api/rounds/:rid mount, `:param` matches one segment.
// Listed literals-first so a literal can never be shadowed by a param pattern.
const ROUTE_ROLES = [
  // The round itself.
  ['PATCH', '/', 'round.edit'],
  ['DELETE', '/', 'round.delete'],

  // Sharing. PATCH changes a grantee's role; DELETE also covers a grantee
  // leaving on their own, which the handler allows below the floor named here.
  ['PATCH', '/shares/:userId', 'round.shares.manage'],
  ['DELETE', '/shares/:userId', 'round.write'],

  // Shelf.
  ['POST', '/games/move-to', 'games.moveOut'],
  ['POST', '/games/copy-to', 'games.copyOut'],
  // Bulk shelf tidying (#832). Each costs exactly what its single-game
  // counterpart costs — retiring is an ordinary write, deleting takes a game's
  // whole rating history with it — because doing one of them to twenty games at
  // once changes the scale, not the kind of act.
  ['POST', '/games/bulk-retire', 'round.write'],
  ['POST', '/games/bulk-delete', 'game.delete'],
  ['POST', '/games/provider-info', 'round.write'],
  ['POST', '/games', 'round.write'],
  ['PATCH', '/games/:gid', 'round.write'],
  ['DELETE', '/games/:gid', 'game.delete'],
  ['POST', '/games/:gid/cover/provider', 'round.write'],
  ['PUT', '/games/:gid/expansions', 'round.write'],
  ['POST', '/games/:gid/retire', 'round.write'],
  ['POST', '/games/:gid/complete', 'round.write'],
  ['POST', '/games/:gid/wish', 'round.write'],
  ['POST', '/games/:gid/acquire-expansion', 'round.write'],

  // Seats.
  ['POST', '/members', 'round.write'],
  ['PATCH', '/members/:mid', 'round.write'],

  // Sessions. Everything about running one is an ordinary write — a co-player
  // starting, voting in, closing or finishing the evening is the whole point of
  // sharing a round. Only destroying a finished one is held back.
  ['POST', '/sessions', 'round.write'],
  // The FLOOR only. One path carries two acts — discarding a running vote and
  // deleting a played evening — and they are told apart by the session's state,
  // which a table keyed on the path cannot see. The handler narrows (#857).
  ['DELETE', '/sessions/:sid', 'session.discard'],
  ['POST', '/sessions/:sid/votes/:pid', 'round.write'],
  ['POST', '/sessions/:sid/close', 'round.write'],
  ['POST', '/sessions/:sid/vote-link', 'round.write'],
  ['POST', '/sessions/:sid/results', 'round.write'],
  ['POST', '/sessions/:sid/choice', 'round.write'],
  ['POST', '/sessions/:sid/finish', 'round.write'],
  ['POST', '/sessions/:sid/cancel', 'round.write'],
  // Multi-table (#796). Both are running a session — computing the split the
  // group is standing around, and turning it into the evening's tables — so both
  // cost the same floor every other session route does.
  ['POST', '/sessions/:sid/tables', 'round.write'],
  ['POST', '/sessions/:sid/split', 'round.write'],
  ['DELETE', '/sessions/:sid/games/:gid', 'round.write'],

  // Chronik.
  ['DELETE', '/activities/:aid', 'activity.delete'],

  // Design.
  ['POST', '/background', 'round.write'],

  // Tags.
  ['POST', '/tags', 'round.write'],
  ['PATCH', '/tags/:tagId', 'round.write'],
  ['DELETE', '/tags/:tagId', 'round.write'],

  // Recommendations. The GET is ungated like every other read; dismissing a
  // suggestion and taking it back are ordinary round writes — a co-player saying
  // "not this one" is the same kind of act as adding a game (#782).
  ['POST', '/recommendations/dismissed', 'round.write'],
  ['DELETE', '/recommendations/dismissed/:externalId', 'round.write'],

  // Provider lookup — only the bulk import writes.
  ['POST', '/lookup/import', 'round.write'],
];

// '/games/:gid/retire' -> /^\/games\/[^/]+\/retire\/?$/
function toPattern(path) {
  if (path === '/') return /^\/?$/;
  const body = path
    .split('/')
    .slice(1)
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^/${body}/?$`);
}

const COMPILED = ROUTE_ROLES.map(([method, path, capability]) => ({
  method, path, capability, pattern: toPattern(path),
}));

// The capability a request needs, or null when nothing in the table claims it.
function capabilityFor(method, path) {
  const hit = COMPILED.find((r) => r.method === method && r.pattern.test(path));
  return hit ? hit.capability : null;
}

function requireRoundRole(req, res, next) {
  // No grant means the caller owns this round (resolveRoundGrant only sets one
  // for a grantee), so they may do everything in it by definition. That is also
  // what keeps legacy/accounts-off mode byte-for-byte unchanged: req.userId is
  // undefined there, no grant is ever resolved, and every request lands here.
  req.roundRole = req.grant ? normalizeRole(req.grant.role) : 'owner';
  if (!req.grant) return next();

  if (!MUTATING.has(req.method)) return next();

  // UNLISTED = REFUSED. This is the whole point of the file: a round-level route
  // added tomorrow is closed to grantees until someone states what it costs,
  // rather than being open until someone remembers to guard it (#411). The
  // failure mode is a visible 403 on a new feature, not a silent escape — and
  // test/round-roles.test.js asserts every mutating route is listed, so the
  // reminder arrives as a red suite rather than as a bug report.
  const capability = capabilityFor(req.method, req.path);
  if (!capability || !can(req.roundRole, capability)) {
    return res.status(403).json({ error: 'not_owner' });
  }
  return next();
}

module.exports = { requireRoundRole, capabilityFor, ROUTE_ROLES, COMPILED };
