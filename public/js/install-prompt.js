/* Spielwirbel – the PWA install nudge (issue #616).

   The app has been installable since #142, and until now nothing anywhere said
   so. That matters more here than in the generic case: #143/#144 were closed
   won't-do, so the PWA *is* the mobile app, and since #209 every member loads
   it on their own phone during a session.

   The platforms do not fill the gap. Chrome's own prompt is heuristic and, once
   dismissed, stays quiet for months; iOS Safari has no `beforeinstallprompt` at
   all and shows no banner ever, so the only route there is Share → „Zum
   Home-Bildschirm" — two taps into a menu nobody opens for this purpose. Hence
   two presentations: a real button where one can work, short instructions where
   it cannot.

   Its own small file, not an export from a view, for the coverage reason in
   .claude/rules/frontend-helper-modules-and-coverage.md. Loaded before core.js
   and dependency-free: the decision helpers are pure so they can be unit-tested
   from Node, and nothing here calls t()/toast() — the views own the wording. */

'use strict';

// The one localStorage key this feature adds. Named in the § 25 TDDDG storage
// inventory in lib/legal.js (both languages) — a new on-device store is a
// disclosure, however small (.claude/rules/keep-legal-docs-current.md).
const INSTALL_DISMISSED_KEY = 'sw_install_offer';

// The stashed `beforeinstallprompt` event. It fires early and exactly once per
// page load, so the listener below is registered at LOAD time — installing it
// lazily when the Konto screen opens would miss it and leave a device that can
// install showing the iOS instructions or nothing at all.
let deferredInstallPrompt = null;
// Set by the `appinstalled` event, so the affordances disappear within the same
// page load rather than lingering until a reload.
let appIsInstalled = false;

// PURE. Is this an iOS/iPadOS browser, i.e. one where no programmatic install
// prompt can ever exist? Every iOS browser is WebKit, so this is about the
// platform and not about Safari specifically.
//
// iPadOS 13+ sends a *desktop* Macintosh user agent, so the touch-point count is
// the only thing separating an iPad from a Mac. Getting that wrong is not
// cosmetic in either direction: a Mac would be told to tap a Share button it
// does not have, and an iPad would be offered nothing at all.
function isIosDevice(env) {
  const ua = String((env && env.userAgent) || '');
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && Number((env && env.maxTouchPoints) || 0) > 1;
}

// PURE. Which affordance a screen should render, from an explicit environment.
// `installed` wins over everything: an app already on the home screen must be
// offered nothing, and on iOS that is the only signal there is.
function installStateFrom(env) {
  if (!env) return 'none';
  if (env.installed) return 'installed';
  if (env.canPrompt) return 'prompt';
  if (isIosDevice(env)) return 'ios';
  return 'none';
}

// The live browser, read at call time so a state that changed mid-session
// (`appinstalled`, a late `beforeinstallprompt`) is reflected on the next render.
function installEnv() {
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  let standalone;
  try {
    standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  } catch { standalone = false; }
  return {
    // navigator.standalone is the iOS-only answer to the same question.
    installed: appIsInstalled || standalone || nav.standalone === true,
    canPrompt: !!deferredInstallPrompt,
    userAgent: nav.userAgent || '',
    maxTouchPoints: nav.maxTouchPoints || 0,
  };
}

function installState() {
  return installStateFrom(installEnv());
}

// Show the browser's own install dialog. Resolves to the user's answer, or
// 'unavailable' when there is no stashed event — a caller must never assume the
// dialog appeared. The event is single-use, so it is dropped either way;
// declining leaves the state at 'none' rather than re-offering a spent prompt.
async function runInstallPrompt() {
  const evt = deferredInstallPrompt;
  if (!evt) return 'unavailable';
  deferredInstallPrompt = null;
  try {
    evt.prompt();
    const choice = await evt.userChoice;
    return (choice && choice.outcome) || 'dismissed';
  } catch {
    return 'unavailable';
  }
}

// Has this device already been offered — and answered — the post-session card?
// Only that one placement consults it; the Konto section is permanent.
//
// Reads false when storage is unavailable (private mode, a disabled store), so
// the failure mode is "offered again" rather than "silently never offered".
function installOfferDismissed() {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissInstallOffer() {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  } catch { /* storage unavailable — the offer simply comes back next time */ }
}

// Remove `el` if the app is installed while it is on screen. `once` matters:
// `appinstalled` fires at most once per page load, so the listener cannot
// accumulate across re-renders.
function hideOnInstalled(el) {
  if (typeof window === 'undefined' || !el) return;
  window.addEventListener('appinstalled', () => el.remove(), { once: true });
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppress Chrome's own mini-infobar so the app decides where and when to
    // ask; without this the browser's banner and our button compete.
    e.preventDefault();
    deferredInstallPrompt = e;
  });
  window.addEventListener('appinstalled', () => {
    appIsInstalled = true;
    deferredInstallPrompt = null;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isIosDevice,
    installStateFrom,
    INSTALL_DISMISSED_KEY,
  };
}
