'use strict';

/*
 * The account record as the Art. 15/20 export hands it to the data subject
 * (criterion L-013, legal audit 2026-10-04).
 *
 * WHY THIS IS NOT `safeUser` (lib/routes/admin/users.js). That projection feeds
 * the operator's account LIST, where showing less is the point — a search
 * result has no business carrying someone's design choice or BGG handle. The
 * export answers the opposite question, "what do you hold about me?", and
 * answering it through the list's projection silently left out about a dozen
 * stored fields: the BGG username, the passkeys, both notification switches,
 * the stats visibility, the pending e-mail change and its address, and more.
 * So the two are separate on purpose, and widening the list's projection to
 * fix the export would have been the wrong repair.
 *
 * STILL AN ALLOWLIST, not "every key minus the secrets". A denylist would ship a
 * new secret field to the requester by default, which is the failure the
 * stored-shape projections in this codebase are all built to rule out
 * (lib/me-projection.js says why). What keeps the allowlist from falling behind
 * is test/account-export-fields.test.js: it registers a real account, gives it
 * a passkey and a pending e-mail change through the real routes, and requires
 * every stored key to be either exported here or named in NOT_EXPORTED with a
 * reason. A field added to the account record therefore fails that spec until
 * somebody decides which list it belongs on.
 *
 * STORED VALUES, NOT RESOLVED ONES. The account screen's projection
 * (meProjection) folds an absent key into its default; this one reports what is
 * actually held, with `null` for a key the record does not carry. An Art. 15
 * answer describes the data, not the app's reading of it.
 */

/*
 * What the export deliberately withholds, and why. Each entry is a stored key the
 * requester gets nothing from and that would be HARMFUL in a file they are about
 * to e-mail themselves: material that authenticates, or that verifies something
 * that authenticates.
 */
const NOT_EXPORTED = {
  verification: 'the hashed one-time e-mail-verification challenge — verification material, '
    + 'and its only use is to check a link that was mailed to the account',
  reset: 'the hashed one-time password-reset challenge — same reason as `verification`',
  refreshTokens: 'hashes of the live sign-in sessions — each entry stands for a working credential',
};

// Per identity type, the stored keys that are withheld. A password identity's
// hash is the account's password in verifiable form; nothing else is stored on it.
const IDENTITY_NOT_EXPORTED = {
  password: { hash: 'the Argon2id hash of the password' },
  passkey: {},
};

// The pending e-mail change (#1076): the address the change waits on is personal
// data and goes out; the token hash verifies the confirmation link and does not.
const PENDING_EMAIL_NOT_EXPORTED = {
  tokenHash: 'verifies the confirmation link mailed to the new address',
};

const or = (v) => (v === undefined ? null : v);

// One stored identity. An unknown future type answers its `type` only, so a new
// provider's token cannot reach an export by being forgotten here.
function identityExport(i) {
  if (!i || typeof i !== 'object') return null;
  if (i.type === 'password') return { type: 'password' };
  if (i.type === 'passkey') {
    return {
      type: 'passkey',
      // Not a secret: the public key only VERIFIES a signature, and the id is what
      // the browser is told at every sign-in. Both are listed in vvt.md row 2 as
      // stored, so an export that omitted them would under-answer the record.
      credentialId: or(i.credentialId),
      publicKey: or(i.publicKey),
      counter: or(i.counter),
      transports: Array.isArray(i.transports) ? i.transports : [],
      name: or(i.name),
      createdAt: or(i.createdAt),
      lastUsedAt: or(i.lastUsedAt),
    };
  }
  return { type: String(i.type || '') };
}

function pendingEmailExport(p) {
  if (!p || typeof p !== 'object') return null;
  return { email: or(p.email), expiresAt: or(p.expiresAt), sentAt: or(p.sentAt) };
}

function accountExport(u) {
  return {
    id: u.id,
    email: or(u.email),
    username: or(u.username),
    createdAt: or(u.createdAt),
    tenantId: or(u.tenantId),
    emailVerified: or(u.emailVerified),
    identities: (Array.isArray(u.identities) ? u.identities : []).map(identityExport).filter(Boolean),
    pendingEmail: pendingEmailExport(u.pendingEmail),
    disabled: or(u.disabled),
    disabledAt: or(u.disabledAt),
    disabledReason: or(u.disabledReason),
    bggUsername: or(u.bggUsername),
    avatar: or(u.avatar),
    notifyRoundInvitations: or(u.notifyRoundInvitations),
    notifyFriendRequests: or(u.notifyFriendRequests),
    notifiedAt: or(u.notifiedAt),
    statsVisible: or(u.statsVisible),
    bgStats: or(u.bgStats),
    acceptedTermsRevision: or(u.acceptedTermsRevision),
    lastSeenNewsRevision: or(u.lastSeenNewsRevision),
    design: or(u.design),
    designChooserSeen: or(u.designChooserSeen),
    // The three demo fields (#427/#502) ride only on a demo account, so an
    // ordinary export does not carry three nulls about a feature it never used.
    ...(u.demo === true
      ? { demo: true, demoExpiresAt: or(u.demoExpiresAt), demoIpHash: or(u.demoIpHash) }
      : {}),
  };
}

module.exports = { accountExport, NOT_EXPORTED, IDENTITY_NOT_EXPORTED, PENDING_EMAIL_NOT_EXPORTED };
