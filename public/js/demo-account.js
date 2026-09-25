/* Spielwirbel – the GUEST DEMO lifecycle (#427), split out of account.js by #969:
   mint a throwaway seeded account, enter it, resume it on a later visit, and end
   it.

   Its own file because the demo is a whole parallel way into the app with its
   own storage key — the demo marker is a THIRD key beside access and refresh
   (.claude/rules/guest-demo-accounts.md), which `demo-marker.js` reaches from
   outside through `clearTokens`.

   Part of the frontend; all files share one global script scope. Loads after
   views-auth.js (it calls showRegister at click time). See index.html. */

'use strict';

/* --------------------------------- guest demo ------------------------------- */

// Start a guest demo (#427): mint a throwaway seeded account and drop the
// visitor straight into it. Wired to the landing CTA and to the /demo deep link
// so a launch post can link people directly into a running demo.
//
// `busy` is the button the click came from (if any) — disabled for the duration,
// because seeding a whole round is not instantaneous and a second click would
// mint a second demo tenant and abandon the first.
async function startDemo(busy) {
  // `disabled` is the whole busy state — .btn:disabled already dims it, and
  // seeding a round takes a moment, so a second click would mint a second demo
  // tenant and abandon the first.
  if (busy) busy.disabled = true;

  // Prefer the demo this browser already holds (#502). Without this, a visitor
  // who left without ending it strands that demo's slot for the rest of its TTL
  // and takes a second one — repeatable, so one visitor can drain the pool.
  //
  // resumeDemo() clears the marker on a definitive refusal, so falling through
  // to a fresh mint here IS the fail-forward path: a purged, expired or spent
  // marker never leaves the visitor at a dead end.
  if (getDemoToken()) {
    const resumed = await resumeDemo();
    if (resumed) {
      accountUser = resumed;
      return enterDemo();
    }
  }
  // A failure has to leave the visitor looking at SOMETHING. When the click came
  // from the landing page (`busy` is its button) that page is already rendered
  // and a toast is enough — but the /demo deep link reaches here with nothing
  // drawn at all, because bootApp() returned before choosing a screen. Without
  // this, a 503 at the ceiling turns a shared launch link into a blank page.
  const fail = (key) => {
    if (busy) busy.disabled = false;
    // routeTo('/') rather than showLanding(): both land on the landing page for
    // a logged-out visitor (views-home.js), but routeTo REPLACES the /demo entry
    // instead of pushing '/' on top of it — /demo is a side effect, never a view
    // Back should return to. Since #501 that also supersedes the manual
    // history.replaceState this used to do before showLanding().
    else routeTo('/');
    toast(t(key), { tone: 'error' });
  };

  let res;
  try {
    res = await authFetch('/demo', { locale: getLocale() });
  } catch {
    return fail('demo.start.failed');
  }
  const { ok, data } = res;
  if (!ok || !data || !data.accessToken) {
    // The capacity refusal is its own message: "try again shortly" is true and
    // actionable, while the generic failure text would read as the app being
    // broken at exactly the moment we are asking someone to judge it.
    const code = (data && data.error) || '';
    if (code === 'demo_unavailable') return fail('demo.start.busy');
    if (code === 'demo_disabled') return fail('demo.start.disabled');
    return fail('demo.start.failed');
  }
  setTokens(data.accessToken, data.refreshToken);
  // The mint is one of the two places the marker is written EXPLICITLY: there is
  // no previous refresh token to match against, so setTokens' rotation rule
  // cannot recognise this as a demo (see public/js/demo-marker.js).
  setDemoToken(data.refreshToken);
  accountUser = data.user || null;
  return enterDemo();
}

// Land in the demo. Home rather than whatever path the visitor arrived at:
// /demo is not a view, and enterApp() would otherwise try to route to it.
function enterDemo() {
  history.replaceState({}, '', '/');
  authScreen(false);
  setupAccountUi();
  routeTo('/');
}

// Re-enter the demo this browser already holds (#502) by exchanging the stashed
// refresh token for a fresh pair. Returns the demo's user object, or null when
// the marker no longer resolves — the caller then mints a fresh demo.
async function resumeDemo() {
  const token = getDemoToken();
  if (!token) return null;
  let res;
  try {
    res = await authFetch('/refresh', { refreshToken: token });
  } catch {
    // A network error is NOT proof the demo is gone, so the marker survives it.
    return null;
  }
  if (!res.ok || !res.data.accessToken) {
    // Purged, expired, or already spent: a definitive refusal, so drop the
    // marker and let the caller mint a fresh demo in the same click.
    clearDemoToken();
    return null;
  }
  setTokens(res.data.accessToken, res.data.refreshToken);
  // The second explicit write: the refresh above SPENT the stashed token, and
  // setTokens could not match it because SA_REFRESH was cleared when the visitor
  // left. From here on the two are equal and rotations carry the marker along.
  setDemoToken(res.data.refreshToken);

  const me = await probeMe();
  // The marker must only ever resume a DEMO. Anything else (a purge landing
  // mid-flight, a marker that somehow points at a real account) is treated as no
  // marker at all rather than logging the visitor into it.
  if (me.status !== 200 || me.data.demo !== true) {
    clearTokens();
    clearDemoToken();
    return null;
  }
  return me.data;
}

// End a demo deliberately (#502): erase it server-side so its slot is freed
// immediately, then leave to the landing page. This is the one exit the server
// can recognise — every other one keeps the demo alive for the resume above.
async function endDemo() {
  // Best-effort: the visitor is leaving either way, and the TTL purge is the
  // backstop if the call never lands.
  try { await accountApi('DELETE', '/demo'); } catch {}
  clearTokens();
  clearDemoToken(); // nothing left to resume — the CTA must offer a fresh demo
  invalidateRoundCache();
  accountUser = null;
  setupAccountUi();
  showLanding();
}

// The persistent "this is a demo" marker. Deliberately NOT a toast(): a toast is
// the confirmation/error channel and disappears, while this has to keep being
// true for as long as the demo lasts — the visitor must never be surprised that
// their round was deleted.
//
// The element lives permanently in index.html and is toggled with the `hidden`
// attribute. That attribute only hides via the UA stylesheet, so styles.css
// carries an explicit `.demo-banner[hidden] { display: none }` — without it the
// component's own `display` wins and the banner shows for everyone
// (.claude/rules/hidden-attribute-vs-display-rule.md).
function setupDemoBanner() {
  const bar = document.getElementById('demoBanner');
  if (!bar) return;
  const on = accountsActive() && isLoggedIn() && isDemoAccount();
  bar.hidden = !on;
  document.body.classList.toggle('has-demo-banner', on);
  if (!on) return;
  const text = document.getElementById('demoBannerText');
  const cta = document.getElementById('demoBannerCta');
  if (text) text.textContent = t('demo.banner.text');
  // The express reference to the terms (#520). A demo account is created without
  // registration, so its user never sees the register form's terms line — and
  // this banner is the only surface BOTH demo entry points share (the landing
  // CTA and the /demo deep link, which bootApp() handles as a side effect
  // without rendering the landing page at all). Revealed only on an instance
  // whose legal pages actually resolve. Re-localized here with the text and CTA
  // — which is why applyStaticTexts() (core.js) now calls this function on a
  // language switch; before #520 none of the three followed the picker.
  const terms = document.getElementById('demoBannerTerms');
  if (terms) {
    terms.textContent = t('demo.banner.terms');
    withAppConfig((cfg) => { terms.hidden = !(cfg && cfg.footer); });
  }
  if (cta) {
    cta.textContent = t('demo.banner.cta');
    cta.onclick = () => leaveDemoForRegister();
  }
}

// Leave a demo for the register screen — the banner's CTA and, under Der Tisch,
// the demo hub's „Gefällt dir das?" card (#1280) share this ONE exit.
//
// Registering from inside a demo starts a FRESH account — nothing carries over
// (#427 rules that out: it would need the cross-tenant re-tenanting write path
// removed in #405). So drop the demo's tokens first, or the new visitor to the
// register screen is still holding a logged-in session.
//
// The resume MARKER deliberately survives (#502): this exit abandons the demo
// without ending it, so it stays alive server-side and the landing CTA must
// offer to re-enter it rather than minting a second one.
function leaveDemoForRegister() {
  clearTokens();
  accountUser = null;
  setupDemoBanner();
  setupAccountUi();
  showRegister();
}

