'use strict';

/* Web push for chat messages (#1785) — the browser half.

   Per DEVICE: the opt-in lives on this browser's PushManager subscription, and
   the server only stores what this device registered. The permission prompt is
   asked for inside the Konto toggle's change handler and nowhere else, so it can
   only ever follow an explicit tap (the issue's acceptance criterion; Safari also
   refuses a prompt that no gesture started).

   Mutes are per ACCOUNT and per thread (`round:<rid>`, `session:<sid>`,
   `dm:<account id>`), fetched once per page and cached here, so every thread's
   bell reads one answer.

   Everything degrades to "not offered": no service worker, no PushManager (iOS
   outside a home-screen app), no VAPID on the server (`/api/config` push:false),
   a logged-out visitor. Nothing here may throw into a view. */

let pushState = null; // { available, publicKey, mutes: Set } once fetched

function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
}

// iOS/iPadOS only expose PushManager to a page opened from the home screen.
function pushNeedsInstall() {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || navigator.standalone === true;
  return ios && !standalone;
}

async function loadPushState() {
  if (pushState) return pushState;
  const res = await api('GET', '/api/account/push');
  pushState = { available: !!res.available, publicKey: res.publicKey, mutes: new Set(res.mutes || []) };
  return pushState;
}

function resetPushState() { pushState = null; }

// The VAPID public key arrives base64url; PushManager wants the raw bytes.
function pushKeyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/* Opt in on this device. Returns 'on', 'denied' or throws. Must be called from
   a user gesture — see the header. */
async function enablePush() {
  const state = await loadPushState();
  if (!state.available) throw new Error('push_disabled');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKeyBytes(state.publicKey) });
  }
  const json = sub.toJSON();
  await api('PUT', '/api/account/push/subscription', {
    endpoint: json.endpoint, keys: json.keys, locale: getLocale(),
  });
  return 'on';
}

/* Opt out on this device: the server forgets it first (so no push is sent to a
   device that just said no), then the browser drops the subscription. Used by
   the toggle and by logout; never throws. */
async function disablePush() {
  try {
    const sub = await currentPushSubscription();
    if (!sub) return;
    try { await api('DELETE', '/api/account/push/subscription', { endpoint: sub.endpoint }); } catch {}
    await sub.unsubscribe();
  } catch {}
}

// Whether to offer push at all: the server has VAPID (the cached /api/config,
// auth-tokens.js), a real account is signed in, and the browser can do it — or
// could, once installed (iOS; the Konto row then explains instead).
function pushOffered(cfg) {
  return !!(cfg && cfg.push) && isLoggedIn() && !isDemoAccount() && (pushSupported() || pushNeedsInstall());
}

/* A subscription the browser still holds is re-registered under whoever is
   signed in now, once per boot: it repairs a device the server dropped (a
   410 that later recovered) and MOVES one whose previous account's session
   merely expired, so that account stops receiving pushes here. Never prompts. */
async function syncPushSubscription() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const sub = await currentPushSubscription();
    if (!sub) return;
    const json = sub.toJSON();
    await api('PUT', '/api/account/push/subscription', { endpoint: json.endpoint, keys: json.keys, locale: getLocale() });
  } catch {}
}

function isPushMuted(thread) { return !!(pushState && pushState.mutes.has(thread)); }

async function setPushMuted(thread, muted) {
  const res = await api('PUT', '/api/account/push/mutes', { thread, muted });
  if (pushState) {
    if (res.muted) pushState.mutes.add(thread); else pushState.mutes.delete(thread);
  }
  return res.muted;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pushKeyBytes, pushNeedsInstall };
}
