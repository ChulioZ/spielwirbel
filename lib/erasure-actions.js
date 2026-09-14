'use strict';

/*
 * The moderation-log actions that are Art. 17(3)(b)/(e) Löschnachweise and are
 * therefore EXEMPT from the 3-year retention purge (#311) — kept permanently,
 * because they are the evidence that an erasure request was honoured.
 *
 * ONE LIST, required by both repo backends, because the exemption is the whole
 * safety property of the purge and two hand-kept copies of it is the palette bug
 * waiting to happen (.claude/rules/shared-constants-across-the-stack.md). It is
 * a dependency-free module so `lib/repo/*.js` can require it without the cycle
 * that pulling it out of `lib/retention.js` would create — retention requires
 * the repo.
 *
 * BOTH ACTIONS, and this is the correction #311's own issue body needs: it
 * specified `user_erased` alone. That is the OPERATOR-side erasure (#273).
 * Since #419 the normal case is `account_deleted`, the self-service deletion a
 * user performs from their own settings — equally an Art. 17 proof, and by now
 * the majority of them. docs/legal/retention.md's Jahresprüfung names both and
 * warns in as many words that a purge exempting only `user_erased` "löscht also
 * genau die Nachweise, um die es überwiegend geht"; lib/routes/account.js says
 * the same where it writes the record. Adding a third erasure path means adding
 * it here, in the same change.
 */

const ERASURE_ACTIONS = ['user_erased', 'account_deleted'];

module.exports = { ERASURE_ACTIONS };
