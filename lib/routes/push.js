'use strict';

/*
 * Web push settings (issue #1785), mounted at /api/account/push.
 *
 * Account-scoped like friends and direct messages: a subscription belongs to an
 * account and a device, never to a tenant, so this sits ahead of the tenant gate
 * and scopes every query to req.userId. A guest-demo account gets nothing
 * (refuseDemoAccount on the whole router) — a throwaway account has no business
 * registering a real device.
 *
 *   GET    /                → { available, publicKey, mutes }
 *   PUT    /subscription    → store THIS device's subscription
 *   DELETE /subscription    → forget it (opt-out, sign-out)
 *   PUT    /mutes           → { thread, muted } — mute or unmute one thread
 *
 * The endpoint is the one value here that the SERVER later fetches, so it is the
 * SSRF surface: lib/push.js POSTs to it. It is therefore accepted only when its
 * host is a known browser push service (`isAllowedPushEndpoint`) — an allowlist,
 * never a sanitiser (.claude/rules/allowlist-request-values-that-reach-a-url.md).
 * It is never logged and never echoed back: with the keys it is a capability to
 * push to that device.
 */

const express = require('express');
const { z } = require('zod');
const repo = require('../repo');
const accounts = require('../accounts');
const demo = require('../demo');
const push = require('../push');
const { validateBody } = require('../validate');
const { trackEvent } = require('../observability');
const { SUPPORTED_LOCALES } = require('../../public/js/locales');

const router = express.Router();

router.use((req, res, next) => {
  if (!accounts.accountsEnabled()) return res.status(404).json({ error: 'accounts_disabled' });
  next();
});
router.use(accounts.requireUser, demo.refuseDemoAccount);

/* The browser push services. Exact hosts, plus the two vendors that shard by
   subdomain (Apple's web push, Microsoft's WNS). Anything else — an internal
   address, an attacker's server — is refused before it is stored, so the
   sender can never be pointed at it. */
const PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

function isAllowedPushEndpoint(value) {
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const endpointSchema = z.string().max(2048).refine(isAllowedPushEndpoint, 'endpoint');
const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().min(16).max(256).regex(B64URL),
    auth: z.string().min(8).max(64).regex(B64URL),
  }),
  // The device's UI language, for the one line a push says. Unknown → English.
  locale: z.string().max(10).optional(),
});
const unsubscribeSchema = z.object({ endpoint: z.string().max(2048) });

// The chat inbox's thread keys (lib/chat-inbox.js) plus a session's own.
const THREAD_RE = /^(round|session|dm):[A-Za-z0-9_-]{1,80}$/;
const muteSchema = z.object({ thread: z.string().regex(THREAD_RE), muted: z.boolean() });

function requireEnabled(req, res, next) {
  if (!push.pushEnabled()) return res.status(404).json({ error: 'push_disabled' });
  next();
}

router.get('/', async (req, res) => {
  if (!push.pushEnabled()) return res.json({ available: false, publicKey: null, mutes: [] });
  res.json({ available: true, publicKey: push.vapidPublicKey(), mutes: await repo.listPushMutes(req.userId) });
});

router.put('/subscription', requireEnabled, async (req, res) => {
  const body = validateBody(subscriptionSchema, req, res);
  if (!body) return;
  const locale = SUPPORTED_LOCALES.includes(body.locale) ? body.locale : 'en';
  const had = (await repo.listPushSubscriptions(req.userId)).length > 0;
  await repo.putPushSubscription(req.userId, {
    endpoint: body.endpoint, keys: body.keys, locale, createdAt: new Date().toISOString(),
  });
  // An account's FIRST device only, so the event counts opt-ins, not devices.
  if (!had) {
    const me = await repo.getUserById(req.userId);
    trackEvent('push_enabled', { tenantId: me && me.tenantId });
  }
  res.json({ ok: true });
});

// Never errors on an unknown endpoint: sign-out calls this best-effort, and a
// device whose subscription already died must still be able to leave.
router.delete('/subscription', async (req, res) => {
  const body = validateBody(unsubscribeSchema, req, res);
  if (!body) return;
  await repo.deletePushSubscription(req.userId, body.endpoint);
  res.json({ ok: true });
});

router.put('/mutes', requireEnabled, async (req, res) => {
  const body = validateBody(muteSchema, req, res);
  if (!body) return;
  await repo.setPushMute(req.userId, body.thread, body.muted);
  res.json({ thread: body.thread, muted: body.muted });
});

module.exports = router;
module.exports.isAllowedPushEndpoint = isAllowedPushEndpoint;
