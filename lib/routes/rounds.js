'use strict';

/* Routes for rounds: list, detail, create (optionally importing games), rename, delete. */

const express = require('express');
const { z } = require('zod');
const repo = require('../repo');
const storage = require('../storage');
const { validateBody } = require('../validate');
const quota = require('../quota');
const { actorSeat } = require('../actor-seat');
// Vote secrecy (#209): a session still collecting votes from several devices
// must not ship the ratings already cast. Applied to every round payload that
// leaves this router — the only two places a full round reaches a client.
const { redactRoundVotes } = require('../session-votes');
const { trackEvent, logger } = require('../observability');
// #137: the role ladder is shared with the frontend, which hides what a role may
// not do (.claude/rules/shared-constants-across-the-stack.md). The route-to-role
// table itself lives in lib/round-access.js and has already run by the time any
// handler here is reached; `can` is only used where the answer depends on the
// REQUEST rather than on the route (leaving your own share, below).
const { ROUND_ROLES, normalizeRole, can } = require('../../public/js/round-roles');

const router = express.Router();

// A grantee's role travels with every round payload this router emits, so the
// client can hide the actions their role forbids. Owners get no key at all —
// exactly like `shared`, whose absence already means "you own this".
const withGrantFlags = (out, req) =>
  (req.grant ? { ...out, shared: true, role: normalizeRole(req.grant.role) } : out);

// The round's name — declared once and shared by create and rename (#562), so
// the two cannot drift into different rules for the same field. A rename that
// accepted what creation rejects (or the reverse) is the silent kind of
// inconsistency .claude/rules/shared-constants-across-the-stack.md is about.
const roundNameSchema = z.preprocess(
  (v) => String(v || '').trim(),
  z.string().min(1, 'Round name is missing')
);

// Create-round body. `members` is normalized (each entry stringified, trimmed,
// blanks dropped), and `importFromRoundId` is passed through untouched.
// `members` carries no `min(1)` since #421: the creator is seated automatically
// in accounts mode, so a round with only them is legitimate (and the common way
// to start one). "At least one member" is checked in the HANDLER instead, where
// the owner seat is known — the schema alone cannot see it.
const createRoundSchema = z.object({
  name: roundNameSchema,
  members: z
    .preprocess(
      (v) => (Array.isArray(v) ? v.map((m) => String(m || '').trim()).filter(Boolean) : []),
      z.array(z.string())
    ),
  // #421 opt-out, default on: only an explicit `false` suppresses the seat.
  ownerSeat: z.boolean().optional(),
  importFromRoundId: z.unknown().optional(),
});

// Rename body: the name and nothing else. Members, design and the shelf each
// have their own routes, so this stays a single-field patch.
const renameRoundSchema = z.object({ name: roundNameSchema });

// Compact list for the home screen: identity, live counts, the round's design
// and a "last played" highlight so the lobby cards can tell each round's story.
// Computed by the data layer (listRoundSummaries) so the Postgres backend can
// answer it in one small statement instead of assembling every game/session of
// the tenant just to count them — the response shape is unchanged.
router.get('/', async (req, res) => {
  const own = await req.repo.listRoundSummaries();
  // #207 home-merge: append the rounds the caller has been GRANTED (each fetched
  // as its own single-round summary under the OWNER tenant, so we never read the
  // owner's other rounds), flagged `shared` so the UI can mark them and hide
  // owner-only actions. req.userId is set only in accounts mode, so legacy mode
  // returns own rounds exactly as before. A grant whose round is gone (owner
  // deleted it) yields null and is skipped.
  const shared = [];
  if (req.userId) {
    for (const g of await repo.listGrantsForUser(req.userId)) {
      const summary = await repo.forTenant(g.ownerTenantId).getRoundSummary(g.roundId);
      if (summary) shared.push({ ...summary, shared: true, role: normalizeRole(g.role) });
    }
  }
  res.json([...own, ...shared]);
});

router.get('/:rid', async (req, res) => {
  const round = await req.repo.getRound(req.params.rid);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  // Tell the client when it reached this round through a GRANT rather than owning
  // it (resolveRoundGrant sets req.grant), so the UI marks it shared and hides
  // the actions the caller's role forbids. Owners get the round unchanged (no
  // extra key).
  res.json(withGrantFlags(redactRoundVotes(round), req));
});

router.post('/', async (req, res) => {
  const body = validateBody(createRoundSchema, req, res);
  if (!body) return;

  // Per-tenant round cap (#139): only in the public multi-tenant mode, so
  // today's single-tenant instance is unaffected. A state cap — count the
  // tenant's current rounds; deleting one frees a slot.
  if (quota.enforced()) {
    const limit = quota.roundsPerTenant();
    // Summaries, not full rounds: only the count matters here, and the summary
    // read doesn't drag every game/session row out of the database.
    const rounds = await req.repo.listRoundSummaries();
    if (rounds.length >= limit) {
      return res.status(403).json({ error: 'quota_rounds', limit });
    }
  }

  // #421: seat the creator. Before this, NO creation path ever linked a member
  // to an account (only invitation-accept did), so every round's owner sat in an
  // unlinked seat — blank Chronik attribution, and their own chair offered in the
  // invite dialog's free-seat picker. The name is resolved SERVER-side (same
  // convention and 'Gast' fallback as invitation-accept) so a client can never
  // dictate the seat's name. req.userId is unset in legacy mode, so that mode
  // writes no owner and a member stays byte-identical to before: { id, name }.
  let owner = null;
  if (req.userId && body.ownerSeat !== false) {
    const user = await repo.getUserById(req.userId);
    owner = { name: (user && user.username) || 'Gast', userId: req.userId };
  }
  if (!owner && body.members.length === 0)
    return res.status(400).json({ error: 'At least one member is required' });

  // The data layer mints ids and (optionally) copies the active games — with
  // their links, ranges, metadata and tags (#921) — from an existing round.
  //
  // `limits` reaches the repo rather than being checked here for the reason
  // moveGames gives (.claude/rules/reparenting-rows-between-rounds.md §3): the
  // number of tags the import would create is only known after the remap. Only
  // the tag cap can be hit — the games come from one round, so they are already
  // bounded by that round's own cap — and it is capped silently rather than
  // refusing the round.
  const round = await req.repo.createRound({
    name: body.name,
    members: body.members,
    owner,
    importFromRoundId: body.importFromRoundId || null,
    limits: quota.enforced() ? { maxTags: quota.tagsPerRound() } : null,
  });
  trackEvent('round_created', { tenantId: req.tenantId });
  res.status(201).json(round);
});

// Rename a round (#562). The name was typed once at creation and was then
// immutable for the round's whole life, although it is the most visible string
// the round owns (lobby card, top-bar context, rail identity, Start heading) and
// everything else — member names, game titles, tags, the design — is editable.
//
// Since #137 this costs 'round.edit', i.e. co-owner and up — the requirement is
// stated in lib/round-access.js's table, not guarded here. It was open to every
// grantee until then (#562's reasoning: renaming is acting WITHIN the round, the
// same class as editing a member name); the round's name is what identifies it on
// every other person's home screen, so it moved up with the other three
// destructive actions (operator decision, 2026-08-13). The rename is still
// recorded in the activity feed, so an owner can see who changed it.
router.patch('/:rid', async (req, res) => {
  const body = validateBody(renameRoundSchema, req, res);
  if (!body) return;

  // The light read (no games/sessions payload) — it gives both the round-vs-
  // nothing 404 and the members the actor's seat is resolved against.
  const meta = await req.repo.getRoundMeta(req.params.rid);
  if (!meta) return res.status(404).json({ error: 'Round not found' });

  const round = await req.repo.renameRound(req.params.rid, body.name, actorSeat(meta, req.userId));
  if (!round) return res.status(404).json({ error: 'Round not found' });
  // Same flags GET /:rid sets, for the same reason: a client that replaces its
  // round object with this response must not silently lose the markers that hide
  // forbidden actions from a grantee — and the same vote redaction, since this
  // response replaces the client's whole round object.
  res.json(withGrantFlags(redactRoundVotes(round), req));
});

// Owner-only ('round.delete'), enforced by lib/round-access.js before this runs:
// a grant lets a grantee act WITHIN a shared round, never destroy the owner's
// whole round and every session, rating and cover in it.
router.delete('/:rid', async (req, res) => {

  // The data layer hands back the cover paths the round freed — it is the only
  // place that can still see them, since the games cascade away with the round.
  const deleted = await req.repo.deleteRound(req.params.rid);
  if (deleted === null) return res.status(404).json({ error: 'Round not found' });

  // Rows first, bytes second (as in the game delete and the admin erasure): the
  // references are already gone, so a failed object delete leaves an orphaned
  // file, never a broken cover. The round IS deleted at this point, so nothing
  // in here may throw its way into a 500 — the whole loop body is guarded and a
  // failure is logged and stepped over, never surfaced as a failed deletion.
  // The isImageReferenced check matters because createRound's importFromRoundId
  // copies a cover path across rounds rather than the file; storage.remove
  // ignores hotlinked provider URLs by construction (#172).
  for (const image of deleted.images) {
    try {
      if (!(await req.repo.isImageReferenced(image))) await storage.remove(image);
    } catch (err) {
      logger.error({ event: 'round_delete_object_failed', err: err.message });
    }
  }

  // #207: the round is gone, so no share may survive it. Its grants and
  // invitations live in GLOBAL stores that deleteRound above didn't touch —
  // revoke every grant and cancel every pending invitation, clearing the
  // invitees' now-un-actionable inbox items.
  for (const g of await repo.listGrantsForRound(req.params.rid)) {
    await repo.deleteGrant(req.params.rid, g.userId);
  }
  for (const v of await repo.listInvitationsForRound(req.params.rid)) {
    if (v.status !== 'pending') continue;
    await repo.resolveInvitation(v.id, 'declined');
    const item = (await repo.listInbox(v.inviteeUserId)).find(
      (it) => it.type === 'round_invitation' && it.payload && it.payload.invitationId === v.id);
    if (item) await repo.dismissInboxItem(v.inviteeUserId, item.id);
  }

  res.json({ ok: true });
});

// #207: revoke a share (owner removes a grantee) or LEAVE one (grantee removes
// their own). The grant is deleted and the freed member seat is UNLINKED but
// kept — its ratings and session history stay on the round. A grantee may only
// remove their OWN share; the owner may remove any. Either way req.repo is scoped
// to the owner tenant (the owner's own, or a grantee's grant re-scope), so the
// member unlink lands on the right round.
router.delete('/:rid/shares/:userId', async (req, res) => {
  const target = req.params.userId;
  // The route's own floor (lib/round-access.js) is 'round.write', because LEAVING
  // is something any grantee may do. Cutting someone ELSE's access is
  // 'round.shares.manage' — owner-only — and that half depends on who is named in
  // the path rather than on the route, which is why it is decided here. It reads
  // the same capability table the chokepoint does, so there is still one
  // definition of who may manage shares. An owner has role 'owner' and passes for
  // any target; legacy accounts-off callers likewise (no grant → owner).
  if (target !== req.userId && !can(req.roundRole, 'round.shares.manage')) {
    return res.status(403).json({ error: 'not_owner' });
  }
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'round_not_found' });

  const removed = await repo.deleteGrant(req.params.rid, target);
  if (!removed) return res.status(404).json({ error: 'not_shared' });
  if (removed.memberId) {
    const member = round.members.find((m) => m.id === removed.memberId);
    if (member && member.userId === target) {
      await req.repo.updateMember(req.params.rid, removed.memberId, { userId: null });
    }
  }
  res.status(204).end();
});

// #137: who shares this round, and with which role — what the member page needs
// to render the role control beside a grantee's seat. Owner-only, and guarded
// HERE rather than by lib/round-access.js's table: that table gates mutating
// methods only, so a read needs its own line. It is a deliberate one — a grantee
// has no business enumerating the owner's other grantees and their standing.
//
// Kept off GET /:rid on purpose: that is the hot round read, and this costs a
// global grants query that only the owner, only on the member page, ever needs.
router.get('/:rid/shares', async (req, res) => {
  if (!can(req.roundRole, 'round.shares.manage')) return res.status(403).json({ error: 'not_owner' });
  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'round_not_found' });
  const grants = await repo.listGrantsForRound(req.params.rid);
  res.json(grants.map((g) => ({ userId: g.userId, memberId: g.memberId, role: normalizeRole(g.role) })));
});

// #137: change a grantee's role. Owner-only ('round.shares.manage', enforced by
// lib/round-access.js), which is what stops a co-owner promoting themselves — a
// co-owner is trusted with the round's CONTENT, never with who may reach it.
//
// 'owner' is deliberately not assignable: ownership is not a grant (the owner
// holds none at all), so writing it here would produce a grant whose role
// outranks every guard while the real owner still owns the round. Handing a round
// over is a different feature; refusing the value keeps the ladder honest.
const shareRoleSchema = z.object({
  role: z.enum(ROUND_ROLES.filter((r) => r !== 'owner')),
});

router.patch('/:rid/shares/:userId', async (req, res) => {
  const body = validateBody(shareRoleSchema, req, res);
  if (!body) return;

  const round = await req.repo.getRoundMeta(req.params.rid);
  if (!round) return res.status(404).json({ error: 'round_not_found' });

  // The GLOBAL repo: grants are cross-tenant by nature and absent from
  // TENANT_METHODS (.claude/rules/round-grant-resolver.md).
  const updated = await repo.updateGrantRole(req.params.rid, req.params.userId, body.role);
  if (!updated) return res.status(404).json({ error: 'not_shared' });
  res.json({ userId: req.params.userId, role: updated.role });
});

module.exports = router;
