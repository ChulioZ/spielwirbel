'use strict';

/*
 * Web push for chat messages (issue #1785).
 *
 * Off unless all three VAPID variables are set (`VAPID_PUBLIC_KEY`,
 * `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), so a self-hosted instance without them
 * behaves exactly as before: /api/config reports `push: false`, the Konto row
 * and the thread bells stay hidden, and `notifyChat` returns at once.
 *
 * What it must never do, each asserted in test/push.test.js:
 *  - carry a message's TEXT. The payload is the thread's NAME (a round's name or
 *    the other party's username), one fixed localised line, the in-app path and
 *    the thread key — nothing a message author typed. It travels through Apple's,
 *    Google's or Mozilla's push service; encryption hides it from them, but the
 *    promise in the privacy policy is that it is not there at all;
 *  - log an endpoint. A subscription endpoint plus its keys is a capability to
 *    push to that device (.claude/rules/secrets-in-paths-reach-the-logs.md), so a
 *    failure logs the push service's status code and nothing else;
 *  - fail OR DELAY the post that triggered it. The routes call
 *    `notifyChatLater` (fire-and-forget), every send is bounded by a timeout,
 *    and every error is swallowed after logging — the message is already stored;
 *  - push more than once per thread per COLLAPSE_MS while it stays unread. The
 *    window lives in memory, which is sound only because `numReplicas` is pinned
 *    to 1 (.claude/rules/deploy-invariants-are-pinned-in-code.md); the overlap
 *    of two containers during a deploy can at worst send one extra push.
 *
 * A dead subscription (404/410 from the push service) is deleted on the spot.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const webpush = require('web-push');
const repo = require('./repo');
const { logger } = require('./observability');
const { LOCALES } = require('../public/js/locales');

const COLLAPSE_MS = 10 * 60 * 1000;
const SEND_TIMEOUT_MS = 5000;
// How long the push service may hold an undelivered message (seconds). A chat
// nudge a day old is worth nothing; the thread itself is still there.
const TTL_SECONDS = 12 * 60 * 60;
const LANG_DIR = path.join(__dirname, '..', 'public', 'js', 'lang');

function vapid() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || '').trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

function pushEnabled() { return !!vapid(); }
function vapidPublicKey() { const v = vapid(); return v ? v.publicKey : null; }

/* The one line a push says, in the subscriber's language. Read from the SPA's
   own translation tables (the link-preview loader's technique), so the push
   cannot drift from the strings the app shows, and cached per locale. */
const lines = new Map();
function newMessageLine(locale) {
  const code = LOCALES.some((l) => l.code === locale) ? locale : 'en';
  if (!lines.has(code)) {
    const context = { I18N: {} };
    vm.runInNewContext(fs.readFileSync(path.join(LANG_DIR, `${code}.js`), 'utf8'), context);
    lines.set(code, context.I18N[code]['push.newMessage']);
  }
  return lines.get(code);
}

// The transport, swappable for the specs: they must assert the exact payload
// and drive 404/410 without a push service.
let sender = (subscription, body, options) => webpush.sendNotification(subscription, body, options);
function setSender(fn) { sender = fn; }

// (account, thread) → when it was last pushed. See the header for why memory.
// Bounded: past COLLAPSE_SWEEP_AT entries, every slot whose window has closed
// is dropped — an expired slot decides nothing, so forgetting it is exact.
const lastPushed = new Map();
const COLLAPSE_SWEEP_AT = 5000;
function claimSlot(slot, now) {
  if (lastPushed.size >= COLLAPSE_SWEEP_AT) {
    for (const [k, t] of lastPushed) if (now - t >= COLLAPSE_MS) lastPushed.delete(k);
  }
  lastPushed.set(slot, now);
}
function resetCollapse() { lastPushed.clear(); }
function collapseSize() { return lastPushed.size; }

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'push_timeout' })), SEND_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

/*
 * Push one recipient about a new message in `thread`. `unread` is the thread's
 * unread count for that recipient AFTER the post (the chat inbox's recount), so
 * `1` means "the first unread one" — which always pushes, whatever the window
 * says: the recipient has read everything before it. A larger count inside the
 * window is the same unread burst and is collapsed.
 */
async function notifyChat(userId, { thread, name, url, unread, now = Date.now() }) {
  const keys = vapid();
  if (!keys || !userId || !thread) return 0;
  try {
    const slot = `${userId}\u0000${thread}`;
    const last = lastPushed.get(slot);
    if (unread > 1 && last != null && now - last < COLLAPSE_MS) return 0;
    // Claimed BEFORE the first await: sends run concurrently (notifyChatLater),
    // so two quick messages would otherwise both read an empty slot and both push.
    claimSlot(slot, now);
    // …and handed back when nothing is sent, so a mute (or no device) does not
    // swallow the first push after it is lifted.
    const release = () => { if (last == null) lastPushed.delete(slot); else lastPushed.set(slot, last); };
    const muted = await repo.listPushMutes(userId);
    if (muted.includes(thread) || muted.includes(parentThread(thread, url))) { release(); return 0; }
    const subs = await repo.listPushSubscriptions(userId);
    if (!subs.length) { release(); return 0; }
    // One account's devices in parallel: each is bounded by its own timeout.
    const results = await Promise.all(subs.map(async (sub) => {
      const payload = JSON.stringify({ title: name || 'Spielwirbel', body: newMessageLine(sub.locale), url, tag: thread });
      try {
        await withTimeout(sender({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
          TTL: TTL_SECONDS,
          vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
          urgency: 'normal',
          topic: topicOf(thread),
        }));
        return 1;
      } catch (err) {
        const status = err && err.statusCode;
        if (status === 404 || status === 410) {
          await repo.deleteDeadPushSubscription(sub.endpoint);
          logger.info({ event: 'push_subscription_expired', status });
        } else {
          logger.warn({ event: 'push_send_failed', status: status || null, code: (err && (err.code || err.name)) || null });
        }
        return 0;
      }
    }));
    return results.reduce((a, b) => a + b, 0);
  } catch (err) {
    logger.error({ event: 'push_notify_failed', code: (err && (err.code || err.name)) || null });
    return 0;
  }
}

/* Fire-and-forget, which is how the chat routes call it: the post has already
   answered by the time a push service is even contacted, so a slow or dead push
   service costs the sender nothing. notifyChat never rejects. `drainPushes` lets
   a spec wait for the sends it triggered instead of racing them. */
const inflight = new Set();
function notifyChatLater(userId, opts) {
  if (!pushEnabled()) return;
  const p = notifyChat(userId, opts);
  inflight.add(p);
  p.finally(() => inflight.delete(p));
}
async function drainPushes() {
  while (inflight.size) await Promise.all([...inflight]);
}

/* A session comment's thread is `session:<sid>`, and muting its ROUND mutes it
   too: the comments also stream into the round's Chat tab, so a muted round
   that kept buzzing for every comment would not be muted. The round id rides
   the comment's url (`/round/<rid>/session/<sid>`), which notifyChat already
   has, so no lookup is needed. */
function parentThread(thread, url) {
  if (!thread.startsWith('session:')) return null;
  const m = /^\/round\/([^/]+)\//.exec(url || '');
  return m ? `round:${decodeURIComponent(m[1])}` : null;
}

/* The Topic header lets the push service replace an undelivered push for the
   same thread rather than queue a second one. It must be at most 32 characters
   of the URL-safe base64 alphabet, so it is a short hash of the key, never the
   key itself (which carries an id). */
function topicOf(thread) {
  return crypto.createHash('sha256').update(thread).digest('base64url').slice(0, 32);
}

module.exports = {
  pushEnabled, vapidPublicKey, notifyChat, notifyChatLater, drainPushes, newMessageLine, parentThread,
  setSender, resetCollapse, collapseSize, COLLAPSE_MS, COLLAPSE_SWEEP_AT,
};
