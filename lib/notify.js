'use strict';

/*
 * E-mail for ACTIONABLE inbox items (issue #618) — round invitations (#207) and
 * friend requests (#325).
 *
 * Why these two and nothing else: both are written by a named human directing a
 * request at one specific person, and both need a decision from that person. The
 * ambient activity — the Freundeskreis feed — lives in a different store
 * (addFeedEvent) and is deliberately not in the inbox, so "an inbox item" is
 * already the right unit. The sharpest case is a round invitation, which exists
 * to reach someone who is NOT currently in the app: delivering it in-app only
 * means an invited stranger sees it whenever they next happen to log in, which
 * may be never.
 *
 * The two risks this module is shaped around are not "spamminess":
 *
 *  1. THE MAIL BUDGET. lib/mail.js caps sends globally through a mailbox.org
 *     account with no ESP headroom, and the mail that stops going out when it
 *     trips is VERIFICATION mail — i.e. signup breaks for everyone. So these
 *     sends are booked as `notification`, a class that may never touch the
 *     reserved tail of the day's budget.
 *  2. MAIL BOMBING. Every existing friend-request cap is per-SENDER, and
 *     declining deletes the row, so A can re-request B immediately and
 *     repeatedly. Nothing bounded mail per RECIPIENT. In-app that was a UI
 *     annoyance; with an e-mail path it points at a real mailbox and its "mark as
 *     spam" button — which matters more than usual because our deliverability
 *     rests on our own domain's reputation at mailbox.org rather than an ESP's
 *     shared pool. Hence the per-recipient throttle below. Same reasoning as
 *     .claude/rules/mail-sending-endpoints-need-a-per-account-cooldown.md, one
 *     step on: there the attacker names a victim's address, here a username.
 */

const repo = require('./repo');
const mail = require('./mail');
const { appBaseUrl } = require('./canonical');
const { isDemoTenant } = require('./demo-tenant');
const { logger } = require('./observability');

// At most one notification mail per recipient per hour. Deliberately keyed to the
// RECIPIENT (see risk 2 above) rather than to the sender or the item: the thing
// being protected is one mailbox, and any number of senders can aim at it.
const NOTIFY_THROTTLE_MS = 60 * 60 * 1000;

/*
 * The per-type allowlist, and the load-bearing part of this module: the inbox is
 * a GENERIC store, so without it a future item type would inherit the mail path
 * silently — someone adds `repo.addInboxItem(uid, { type: 'whatever' })` and
 * discovers it mails people only when a user complains. A type absent from here
 * mails nobody, and turning that off is a deliberate edit.
 *
 * (Not a .claude/rules/shared-constants-across-the-stack.md case: `pref` names a
 * field on the user record, not a value the client picks from a list.)
 *
 * `who` deliberately reads the payload's USERNAME and nothing else. A username is
 * `[a-zA-Z0-9_-]{3,30}` (public/js/username-policy.js) and already refuses the
 * handles that would read as an official account, whereas the round NAME sitting
 * right beside it in the same payload is free text. Putting free text into a
 * message sent from our own domain would lend our sender reputation to whatever
 * a stranger typed — and the recipient learns the round's name the moment they
 * open the inbox anyway, so the mail gives up nothing by leaving it out.
 */
const NOTIFIABLE = {
  round_invitation: {
    pref: 'notifyRoundInvitations',
    subject: 'Spielwirbel: Einladung zu einer Runde / Round invitation',
    who: (payload) => payload.inviterUsername,
    de: (who) => `${who || 'Jemand'} hat dich zu einer Runde eingeladen.`,
    en: (who) => `${who || 'Someone'} invited you to a round.`,
  },
  friend_request: {
    pref: 'notifyFriendRequests',
    subject: 'Spielwirbel: Neue Freundschaftsanfrage / New friend request',
    who: (payload) => payload.requesterUsername,
    de: (who) => `${who || 'Jemand'} möchte sich mit dir befreunden.`,
    en: (who) => `${who || 'Someone'} would like to be friends with you.`,
  },
};

// Bilingual DE-then-EN in one body, like every other account mail: the server has
// no locale context (an account stores none), so it cannot pick. text/plain only
// — never an html part (.claude/rules/transactional-mail-provider.md).
//
// Both links are absolute and short enough to survive quoted-printable's 76-column
// wrap (.claude/rules/mailed-links-must-fit-one-qp-line.md); re-measure if either
// path grows. The /konto link IS the unsubscribe path — this is 1:1 transactional
// mail rather than bulk, so it carries no List-Unsubscribe header.
function body(de, en) {
  const inbox = `${appBaseUrl()}/inbox`;
  const konto = `${appBaseUrl()}/konto`;
  return [
    'Hallo!', '', de, '', 'Hier geht es zu deinem Postfach:', inbox, '',
    `Diese Benachrichtigungen kannst du jederzeit in deinem Konto abschalten:\n${konto}`,
    '', '---', '',
    'Hi!', '', en, '', 'Open your inbox:', inbox, '',
    `You can turn these notifications off in your account any time:\n${konto}`,
  ].join('\n');
}

// The coalesced message: sent instead of naming one request when the recipient
// has several unread items waiting. No stored counter is needed — the inbox
// itself is the count — and it is why a throttled item is never LOST: the next
// send past the window names the running total.
const COALESCED = {
  subject: 'Spielwirbel: Neue Anfragen / New requests',
  text: (n) => body(
    `In deinem Postfach warten ${n} offene Anfragen auf dich.`,
    `You have ${n} open requests waiting in your inbox.`,
  ),
};

/*
 * In-flight sends. The routes deliberately do NOT await notifyInboxItem — a
 * wedged SMTP connection must not hold `POST /api/account/friends` open, and a
 * mail hiccup must not fail an invitation that has already been created. That
 * makes the work invisible to a caller, so this set gives one back: `idle()` is
 * what a test awaits instead of racing the send, and what a future graceful
 * shutdown would drain.
 */
const inFlight = new Set();

// Resolves once nothing is in flight. Loops because a settling notification could
// in principle enqueue another (nothing does today, and the loop means nothing
// silently starts to).
async function idle() {
  while (inFlight.size) await Promise.all([...inFlight]);
}

// Best-effort notification for one freshly added inbox item. NEVER rejects: the
// returned promise is not awaited by its callers, and an unhandled rejection
// would take the process down over a mail failure.
function notifyInboxItem(userId, item) {
  const p = deliver(userId, item)
    .catch((e) => logger.warn({ event: 'inbox_notification_failed', message: e.message }))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
  return p;
}

async function deliver(userId, item) {
  const spec = NOTIFIABLE[(item || {}).type];
  if (!spec) return;

  const user = await repo.getUserById(userId);
  if (!user) return;

  // Two recipients that must never be mailed, neither of which is about
  // preference:
  //
  //  - a GUEST DEMO (#427) holds a synthetic `…@demo.invalid` address, reserved
  //    by RFC 2606 precisely so it can never route. Every such send is a
  //    guaranteed bounce that spends real budget and costs real domain
  //    reputation. A demo cannot SEND either of these requests, but a real
  //    account can address one by its `demo-<hex>` username.
  //  - an UNVERIFIED account's address is not a confirmed channel — it may well
  //    belong to someone who mistyped it, or to a stranger whose address was
  //    squatted. Such an account cannot even log in (`email_not_verified`), so it
  //    could never read the inbox the mail points at, and mailing it repeatedly
  //    is the amplifier the whole per-account cooldown discipline exists to deny.
  if (isDemoTenant(user.tenantId) || !user.emailVerified) return;

  // Absent key means ON — accounts predating #618 carry neither field, and the
  // preference has to read the same for them as for an account that has never
  // touched the toggle. Same shape as meProjection's `!== false`.
  if (user[spec.pref] === false) return;

  const sentAt = Date.parse(user.notifiedAt || '');
  // `|| ''` is load-bearing: Date.parse('') is NaN, so an account that has never
  // been notified falls through to "send". Never `|| 0` — Date.parse(0) coerces
  // to the string '0' and resolves to the year 2000, a real timestamp.
  if (Number.isFinite(sentAt) && Date.now() - sentAt < NOTIFY_THROTTLE_MS) return;

  const unread = (await repo.listInbox(userId)).filter((it) => !it.read).length;
  const message = unread > 1
    ? { subject: COALESCED.subject, text: COALESCED.text(unread) }
    : { subject: spec.subject, text: body(spec.de(spec.who(item.payload || {})), spec.en(spec.who(item.payload || {}))) };

  // Booked as `notification`, so it can never spend the tail of the day's budget
  // that verification mail depends on (lib/mail.js). A refusal there throws and
  // is caught by notifyInboxItem — deliberately WITHOUT stamping `notifiedAt`
  // below, so a mail the recipient never got does not also suppress the next one.
  await mail.send({ to: user.email, ...message, kind: 'notification' });
  await repo.updateUser(userId, { notifiedAt: new Date().toISOString() });
}

module.exports = { notifyInboxItem, idle, NOTIFY_THROTTLE_MS, NOTIFIABLE };
