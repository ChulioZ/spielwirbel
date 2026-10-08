'use strict';

/* Round invite-link expiry (#1515). The logic half, split exactly like
   lib/vote-link.js: `lib/routes/join.js` applies the gate and `lib/scheduler.js`
   runs the sweep, so the timer-only half is still drivable from a test.

   Seven days, fixed (operator decision on #1515). Unlike the vote link this is
   not an env var: the vote link's 30 days had to stretch over pre-meetup cases
   nobody could predict, while an invitation either reaches its person within a
   week or the owner mints a fresh one in one tap. A knob nobody needs is one
   more thing for a self-hoster to misread. */

const repo = require('./repo');

const INVITE_LINK_TTL_DAYS = 7;

// Links created before this instant are expired — ISO, compared as text like
// the vote link's cutoff, because that is how both backends store `createdAt`.
function inviteLinkCutoff(now = Date.now()) {
  return new Date(now - INVITE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// The gate's half. A row without `createdAt` is malformed and fails CLOSED —
// this link writes a grant, so "ageless" is the one reading it must never get.
function isInviteLinkExpired(link, now = Date.now()) {
  if (!link || !link.createdAt) return true;
  return link.createdAt < inviteLinkCutoff(now);
}

// When the link stops working, for the owner's list. Derived, never stored, so
// it cannot disagree with the gate above.
function inviteLinkExpiresAt(link) {
  return new Date(Date.parse(link.createdAt) + INVITE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// The sweep's half: it makes docs/legal/retention.md's „7 Tage" true for links
// nobody revoked. Same cutoff as the gate, so it only removes rows the gate is
// already refusing — deleting one can never revoke access early.
async function purgeExpiredInviteLinks() {
  return repo.deleteExpiredRoundInviteLinks(inviteLinkCutoff());
}

module.exports = {
  INVITE_LINK_TTL_DAYS, inviteLinkCutoff, isInviteLinkExpired, inviteLinkExpiresAt, purgeExpiredInviteLinks,
};
