/* Spielwirbel – core: DOM helpers, API, small utilities, stats,
   design application. Part of the frontend; all files share one global script
   scope. Load order: see index.html. */

'use strict';

const app = document.getElementById('app');
const context = document.getElementById('context');
const toastEl = document.getElementById('toast');

// The brand mark is a real link to '/' (#330), so it can be opened in a new tab
// and its address copied like any other. The callback is an arrow so
// showHome/confirmLeave (defined in later scripts) are only resolved on click –
// they do not exist yet while core.js is loading. confirmLeave (router.js) gives
// a flow holding unsaved state — the vote wizard — the chance to ask before this
// discards it (#329); a modified click never reaches it, but it opens a *new*
// tab and leaves this one's votes untouched.
navLink(document.getElementById('homeBtn'), '/', () => {
  if (confirmLeave()) showHome();
});

// Re-invoked when the language changes, to re-render the current screen.
let currentView = () => showHome();

// ---- small helpers ---------------------------------------------------------

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

// Toasts carry confirmations AND errors, so they must reach a screen reader
// (#145). The element is an aria-live region declared in index.html, and it must
// stay in the accessibility tree permanently for that to work: a live region
// that is inserted (or un-`hidden`) with its text already in place is NOT
// announced. So visibility is a class, never the `hidden` attribute — the empty
// region sits in the tree and only its text content changes, which is exactly
// the mutation aria-live listens for.
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-on');
    // Clear the text too, so the next identical message is still a change the
    // live region reports rather than a no-op mutation.
    toastEl.textContent = '';
  }, 2200);
}

async function api(method, url, body, _retried) {
  const opts = { method, headers: {} };
  // Accounts mode (#138): attach the account access token. getAccessToken() is
  // null in legacy/shared-password mode, so this is a no-op there.
  const token = getAccessToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = 'Error';
    let payload;
    try { payload = await res.json(); msg = payload.error || msg; } catch {}
    // Session expired or missing while a gate is on. In accounts mode (#138) try
    // a silent token refresh once and retry, then fall back to the login screen;
    // in legacy shared-password mode (issue #129) bounce to '/', which the server
    // serves the login page for when locked.
    if (res.status === 401 && payload && payload.error === 'auth_required') {
      if (accountsActive()) {
        if (!_retried && (await refreshAccessToken())) return api(method, url, body, true);
        onSessionLost();
      } else {
        // Locked out of the shared-password gate: drop the persisted cache
        // before bouncing, so the login page never fronts stale round data.
        invalidateRoundCache();
        // Loop breaker (#399): a client that mis-detected legacy mode against
        // an accounts-mode server gets a 401 here on its first data fetch, and
        // the reload re-runs boot into the same 401 — endlessly. One bounce per
        // 10s; within that window, surface the thrown error instead.
        let lastBounce = 0;
        try { lastBounce = Number(sessionStorage.getItem('authBounceAt')) || 0; } catch { /* storage off */ }
        if (Date.now() - lastBounce > 10000) {
          try { sessionStorage.setItem('authBounceAt', String(Date.now())); } catch { /* storage off */ }
          window.location.assign('/');
        }
      }
    }
    throw new Error(msg);
  }
  // Any successful mutation may change round data, so drop the cached round —
  // the next navigation re-fetches fresh. GETs (and failed calls, which threw
  // above) leave the cache alone. api() is the one chokepoint every request
  // goes through, which makes this invalidation airtight.
  if (method !== 'GET') invalidateRoundCache();
  return res.status === 204 ? null : res.json();
}

/* Stale-while-revalidate navigation cache (store: js/swr.js, loaded earlier).
 *
 * Every navigation used to block on a fresh fetch behind a "…" placeholder —
 * the dominant felt latency on the hosted deploy, where each data request
 * costs a full server round trip. Now a view renders INSTANTLY from the last
 * known data (persisted in localStorage, so even a cold app start paints
 * real content) while the fetch runs in the background; if it returns
 * something different, the current view re-renders once, silently.
 *
 * Correctness guards, all load-bearing:
 *  - api() clears the whole cache on every successful mutation (see above),
 *    so a post-mutation navigation always awaits fresh data — the user never
 *    sees their own change flash back to the old state. Stale renders can
 *    only show *another* device's lag, which the background refresh corrects.
 *  - A background refresh only re-renders while the SAME view instance is
 *    current (swrRenderToken, bumped by syncUrl on every navigation) and no
 *    sheet/popover is open (uiBusy) — never yanking UI out from under an
 *    interaction. A skipped re-render is fine: the cache is already fresh for
 *    the next navigation.
 *  - The re-rendered view re-reads the cache within the freshness window, so
 *    refresh -> re-render -> refresh can't loop (see swr.js beginRevalidate).
 *  - The auth flows (account.js) clear the store on login/logout/session
 *    loss, so no cached data survives an identity change.
 * Views never mutate returned objects in place (same contract as before). The
 * mid-session "must be fresh" fetches use fetchRoundFresh, which awaits the
 * network and seeds the cache. */
const SWR_FRESH_MS = 5000;
const swrStore = createSwrStore({
  storage: (() => { try { return window.localStorage; } catch { return null; } })(),
  storageKey: 'spielwirbel.swr.v1',
});
let swrRenderToken = 0; // bumped by syncUrl (router.js) on every navigation
function invalidateRoundCache() {
  swrStore.clear();
}
// True while a background re-render would destroy something the user is in
// the middle of: an open sheet/popover, or a focused form field anywhere in
// the app (member rename, tag creation, the Regal search box — a re-render
// replaces the node and eats the keystrokes). A skipped re-render is always
// safe: the cache is already fresh for the next navigation.
function uiBusy() {
  if (document.querySelector('.sheet-backdrop') || activePopover) return true;
  const el = document.activeElement;
  return !!el && app.contains(el) && el.matches('input, textarea, select');
}
// Serve the cached value for `key` (instantly, however old) and revalidate in
// the background; block only on a cache miss. `rerender: false` still refreshes
// the cache but never re-renders the view — for form screens, where a rebuild
// would wipe what the user is typing.
async function swrRead(key, url, { rerender = true } = {}) {
  const cached = swrStore.get(key);
  if (cached === undefined) {
    const value = await api('GET', url);
    swrStore.set(key, value);
    return value;
  }
  if (swrStore.beginRevalidate(key, SWR_FRESH_MS)) {
    const token = swrRenderToken;
    api('GET', url)
      .then((fresh) => {
        swrStore.endRevalidate(key);
        const changed = JSON.stringify(fresh) !== JSON.stringify(swrStore.get(key));
        swrStore.set(key, fresh);
        if (rerender && changed && token === swrRenderToken && !uiBusy()) currentView();
      })
      .catch(() => swrStore.endRevalidate(key));
  }
  return cached;
}
/* Resolve the profile pictures of any seat linked to an account (#841) BEFORE
   the view renders, so avatarFace() is a pure cache read at every render site
   and no screen has to re-render when a photo arrives.

   Costs nothing for a round whose seats are all name-only — the overwhelmingly
   common case, since member.userId is set only by the seat self-claim (#421) —
   because primeAvatars returns without a request when there is nothing missing.
   In accounts-off mode the endpoint 404s and primeAvatars swallows it, leaving
   the initials that mode has always shown.

   Wrapping the two SWR readers rather than each view is what keeps the promise
   in member-avatar.js's header true: a screen cannot forget to prime and then
   quietly render initials for someone the screen next to it shows a photo of. */
const fetchAvatars = (ids) =>
  api('GET', '/api/account/avatars?ids=' + ids.map(encodeURIComponent).join(','));
const primePeople = async (rounds) => {
  const ids = [].concat(rounds || []).flatMap((r) => ((r && r.members) || []).map((m) => m.userId));
  await primeAvatars(ids, fetchAvatars);
};
const fetchRoundList = async (opts) => {
  const rounds = await swrRead('rounds', '/api/rounds', opts);
  await primePeople(rounds);
  return rounds;
};
const fetchRound = async (rid) => {
  const round = await swrRead('round:' + rid, '/api/rounds/' + rid);
  await primePeople(round);
  return round;
};
// The activity feed lives on its own endpoint (#197), hence its own key.
const fetchActivities = (rid) => swrRead('acts:' + rid, `/api/rounds/${rid}/activities`);
// Await the network and seed the cache — for flows that must observe their own
// just-written state (mid-session refreshes) where a stale render would lie.
async function fetchRoundFresh(rid) {
  const round = await api('GET', '/api/rounds/' + rid);
  swrStore.set('round:' + rid, round);
  return round;
}

// Top-bar context label (#348). Plain, non-clickable text: the current round's
// name while inside a round, empty on the home/auth screens. It is context, not
// navigation — the brand mark is the sole "home" affordance, and the rail/tabs
// plus each sub-screen's own heading carry the rest of the wayfinding. Uses
// textContent, so a round name needs no escaping.
function setContext(label) {
  context.textContent = label || '';
}

// The browser tab / window title for the current screen (#522), the sibling of
// setContext above: both write app chrome from inside a view, and both are
// re-run on a language switch because every view re-applies them from its
// `currentView` re-render.
//
// Variadic, most specific first: setDocTitle(t('hub.tab.regal'), round.name).
// The joining is docTitle() in js/doc-title.js — pure, so it is unit-tested
// there; what stays here is the one line that touches the DOM and therefore
// cannot be (.claude/rules/frontend-helper-modules-and-coverage.md).
//
// Call it AFTER the view's data has loaded, not next to `currentView` at the
// top: a round's name only exists once fetchRound resolves, and naming a screen
// before it can name its subject just puts a bare screen label in the tab for a
// moment and then replaces it.
//
// Names are passed RAW, never through esc() — the odd one out in a codebase
// that escapes every interpolation. The `document.title` setter takes a plain
// string and parses no markup (verified: an <img onerror> in a round name adds
// no node and runs nothing), exactly like setContext's textContent. Escaping
// here would not harden anything and would put a literal "&amp;" in the tab of
// every round with an ampersand in its name.
function setDocTitle(...parts) {
  document.title = docTitle(parts, t('app.title'));
}

/* The one way back from a screen that persistent chrome does not reach (#623):
   the nine round sub-screens — eight call sites, since the two archives share a
   renderer — plus `/u/:username` and `/round/new`. It goes at the TOP of the
   content column, at every width. `fallback` is the only thing that differs per
   call site: where to land when there is no in-app history to go back through
   (see navBack in router.js).

   Top of the content, and not hidden anywhere, are both corrections rather than
   preferences. The rail is "up", not "back": HUB_TAB_OF maps each sub-screen to
   exactly ONE owning section, so opening a game from Pokale and clicking Regal
   is a different — usually wrong — destination. And below 860px a sub-screen
   renders no dock either (`.dock--sub { display: none }`), so this control is
   the only navigation on the screen.

   The `back-row` class is not decoration: it must stay distinguishable from the
   OTHER `.section.center` blocks (the results screen's "delete session" sits in
   a byte-identical wrapper), which is what a width-scoped hide once got wrong
   by a hair — see test/content-width.test.js. */
function backRow(fallback) {
  const row = h(`<div class="back-row"><button type="button" class="back-link"><i class="ti ti-chevron-left" aria-hidden="true"></i>${esc(t('common.back'))}</button></div>`);
  row.querySelector('button').addEventListener('click', () => navBack(fallback));
  return row;
}

// Join names for the active language: "A", "A and B", "A, B and C".
function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' ' + t('list.and') + ' ' + names[names.length - 1];
}

// Texts that live outside the rendered views (top bar). Re-applied on language change.
function applyStaticTexts() {
  const home = document.getElementById('homeBtn');
  home.innerHTML =
    `<i class="ti ti-tornado" aria-hidden="true"></i> <span class="topbar__word">${esc(t('app.title'))}</span>`;
  // These controls are icon-only (or, for the picker, unlabelled), so the
  // aria-label is the ONLY thing a screen reader announces. index.html can only
  // carry one hardcoded language, so every one of them is localized here — this
  // runs on locale init AND on every change. Leaving the static markup in place
  // announced "Home"/"Language"/"Account" in English over an otherwise German UI
  // (#145); only the feedback button was being localized.
  home.setAttribute('aria-label', t('a11y.home'));
  document.getElementById('langPicker').setAttribute('aria-label', t('a11y.language'));
  document.getElementById('feedbackBtn').setAttribute('aria-label', t('feedback.button'));
  document.getElementById('supportBtn').setAttribute('aria-label', t('support.button'));
  document.getElementById('accountBtn').setAttribute('aria-label', t('a11y.account'));
  // #inboxBtn was the one control this list missed when #145 wrote it — it kept
  // index.html's hardcoded „Postfach" and announced that to every reader,
  // whatever their language. It reuses the inbox screen's own title rather than
  // gaining an `a11y.*` key: the button opens exactly that screen, so a second
  // string for the same thing could only ever drift from it.
  document.getElementById('inboxBtn').setAttribute('aria-label', t('inbox.title'));
  // Shared site footer (issues #224/#134): link labels, re-localized on
  // language change like the aria-labels above.
  document.getElementById('footerFaq').textContent = t('footer.faq');
  document.getElementById('footerKontakt').textContent = t('footer.contact');
  document.getElementById('footerImpressum').textContent = t('footer.impressum');
  document.getElementById('footerPrivacy').textContent = t('footer.privacy');
  document.getElementById('footerTerms').textContent = t('footer.terms');
  // Trust claims (#323), same re-localization as the links above.
  document.getElementById('footerTrustHosting').textContent = t('footer.trustHosting');
  document.getElementById('footerTrustNoTracking').textContent = t('footer.trustNoTracking');
  // The demo banner is static chrome too, and was NOT re-localized on a language
  // switch — its text and CTA stayed in the boot language while the footer above
  // switched correctly (pre-existing; found verifying #520). That matters more
  // now the banner carries the express reference to the Nutzungsbedingungen: a
  // legal reference shown in a language the reader did not choose is a weaker
  // one. setupDemoBanner lives in the later-loaded account.js — safe here, since
  // this runs long after every script has loaded, and it is a no-op (it just
  // re-hides the banner) whenever the session is not a demo.
  setupDemoBanner();
  // The terms-change notice (#521) is static chrome for the same reason and
  // carries a legal reference too, so it follows the picker as well. Also a
  // no-op whenever the account is up to date.
  setupTermsBanner();
}

// Shared footer LINK visibility (issues #224/#134). The links start hidden in
// the markup and are shown only when the server says the public surfaces behind
// them are configured (GET /api/config — mail delivery for Kontakt AND the
// Impressum address for the legal pages). All-or-nothing by design: a
// half-ready instance shows no links rather than broken ones. Plain fetch
// (not api()): the endpoint is public and a failure must never bounce to login
// — on any error the links just stay hidden. The footer element itself is
// always rendered: it also carries the ungated "Powered by BGG" attribution
// BGG's XML API terms require (#117).
function initFooter() {
  fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      if (cfg && cfg.footer) {
        document.getElementById('footerLinks').hidden = false;
        // Trust claims (#323): revealed on the same operator-instance gate as
        // the links — the EU-hosting claim is only true where the operator has
        // configured the public surfaces, so an unconfigured instance shows it
        // no more than it shows the legal links.
        document.getElementById('footerTrust').hidden = false;
        // Feedback entry point (#321): the top-bar button opens the public
        // contact form with the Feedback category preselected and the current
        // SPA screen passed along. Gated on the SAME cfg.footer flag as the
        // footer links — the contact page is hidden while mail/Impressum are
        // unconfigured, so its entry point must be too. Revealed and wired here
        // together, so a hidden button is never clickable, and only once
        // (initFooter runs a single time from main.js).
        const fb = document.getElementById('feedbackBtn');
        fb.hidden = false;
        // In-context DSA notice entry point (#559): the Freundeskreis feed's
        // per-item report button opens the same contact form, so it rides the
        // SAME gate — a button that opens a page saying the channel is
        // unavailable is worse than no button. Module state rather than a
        // stashed cfg, so views read it at render time and stay clear of the
        // load-order trap (.claude/rules/frontend-script-load-order.md).
        setContactAvailable(true);
        fb.addEventListener('click', () => {
          const q = new URLSearchParams({ category: 'feedback', path: location.pathname });
          // Open in a new tab (#390) so the SPA stays loaded behind the contact
          // page; noopener prevents a window.opener leak.
          window.open('/kontakt.html?' + q.toString(), '_blank', 'noopener');
        });
      }
      // Support link (#173): same config fetch, same degradation — no URL (or
      // any error) leaves the button hidden. initSupport lives in the
      // later-loaded support.js; safe here because this callback runs long
      // after every script has loaded (frontend-script-load-order.md).
      if (cfg && cfg.donateUrl) initSupport(cfg.donateUrl);
    })
    .catch(() => {});
}

// Language picker in the top bar.
function setupLangPicker() {
  const sel = document.getElementById('langPicker');
  sel.innerHTML = SUPPORTED_LOCALES.map(
    (loc) => `<option value="${loc}">${LOCALE_LABELS[loc]}</option>`
  ).join('');
  sel.value = getLocale();
  sel.addEventListener('change', () => {
    setLocale(sel.value);
    applyStaticTexts();
    currentView(); // re-render the current screen in the new language
  });
}

// Games list sorting – kept for the running session. Defaults to rating
// (best first); the per-round reset in renderRegalTab re-applies this default.
let gamesSort = 'avg';
// Regal filter state – kept for the running session, scoped to one round.
// Reset (along with gamesSort) when a different round's Regal is opened.
// `tags` is a tri-state Map<tagId, 'include'|'exclude'> (#241); absence = ignore.
// `tagMode` is how the INCLUDED tags combine (#726) — 'all' (every one) or
// 'any' (at least one). It survives while the control that sets it is hidden,
// which is why it lives here rather than inside renderRegalTab.
let regalFilters = { tags: new Map(), query: '', tagMode: 'all' };
let regalFiltersRid = null;

// Chronik filter state (#793) – the timeline's chip choice ('all' | 'sessions' |
// 'changes'), kept for the running session and scoped to one round, exactly like
// regalFilters above. It lives here rather than inside renderChronikTab because
// every return to the tab re-runs that whole render — a session card and
// „Zurück", a hub-tab switch, a language switch — so a local would reset the
// choice on each visit and the filter had to be re-applied per session opened.
let chronikFilter = 'all';
let chronikFilterRid = null;

// Tri-state custom-tag filter (#241), shared by the Regal and start-session tag
// chips. State lives in a Map<tagId, 'include'|'exclude'> — a tag absent from the
// map is ignored. Clicking a chip cycles ignore -> include -> exclude -> ignore.
const TAG_STATES = [undefined, 'include', 'exclude'];
// Advance one tag to its next state in the cycle, mutating the map, and return
// the new state (undefined = back to ignore, so the entry is removed).
function cycleTagState(map, id) {
  const next = TAG_STATES[(TAG_STATES.indexOf(map.get(id)) + 1) % TAG_STATES.length];
  if (next) map.set(id, next);
  else map.delete(id);
  return next;
}
// Reflect a tag chip's state on its element: the fill class, the glyph (a ban
// icon for exclude), and an accessible label so include vs exclude is
// distinguishable without relying on color alone (a11y).
// `mode` (#726) is the ACTIVE combination mode, and it only changes the included
// label — "only games with it" states AND semantics out loud, so in 'any' mode
// that sentence is simply wrong. It is the one string in the app that says what
// the filter means, which is why it must follow the control rather than the
// control merely sitting above it.
function paintTagChip(chip, name, state, tagIcon, mode = 'all') {
  chip.classList.toggle('is-on', state === 'include');
  chip.classList.toggle('is-excluded', state === 'exclude');
  // The ban glyph still wins for the exclude state (#255): it conveys filter
  // semantics, not tag identity, and losing it would make include/exclude
  // indistinguishable without color.
  const icon = state === 'exclude' ? 'ti-ban' : tagIconClass(tagIcon);
  const key =
    state === 'include' ? (mode === 'any' ? 'tags.filter.includedAny' : 'tags.filter.included')
    : state === 'exclude' ? 'tags.filter.excluded'
    : 'tags.filter.ignored';
  chip.setAttribute('aria-label', t(key, { name }));
  chip.innerHTML = `<i class="ti ${icon}" aria-hidden="true"></i>${esc(name)}`;
}
// The AND/OR control above a tri-state chip row (#726), on both screens that
// carry the filter — the session setup screen and the Regal, which already
// share the chips and the bulk toggle.
//
// `state` is the screen's own filter state object; the control reads and writes
// its `tagMode` key in place, so the choice survives while the control is
// inert. That matters: with fewer than two included tags the two modes draw the
// same pool, so the control would be noise — but dropping to one tag and adding
// another back must restore what the user picked, not silently reset it.
//
// Two plain buttons rather than a role="radiogroup": both are Tab-reachable and
// Enter/Space-activated by the platform, where a radiogroup would owe arrow-key
// roving. `aria-pressed` plus a check glyph carry the selection, so it is never
// conveyed by colour alone (.claude/rules/accessibility-contrast-and-modals.md).
//
// Returns { el, sync }: `sync` re-reads the map and enables or inerts the
// control, so every chip click and the bulk toggle must call it.
function renderTagModeToggle(state, map, onChange) {
  const el = h(`<div class="tag-mode" role="group" aria-label="${esc(t('tags.filter.modeLabel'))}"></div>`);
  const opts = [['all', 'tags.filter.modeAll'], ['any', 'tags.filter.modeAny']].map(([mode, key]) => {
    const btn = h(`<button type="button" class="tag-mode__opt"><i class="ti ti-check" aria-hidden="true"></i>${esc(t(key))}</button>`);
    btn.addEventListener('click', () => {
      if (state.tagMode === mode) return;
      state.tagMode = mode;
      paint();
      onChange();
    });
    el.appendChild(btn);
    return { btn, mode };
  });
  const paint = () => opts.forEach(({ btn, mode }) => {
    const on = state.tagMode === mode;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  // Below two included tags the two modes mean the same thing, so the control is
  // useless — but it must NOT leave the flow (#787). It sits above the chip row,
  // and the tri-state cycle necessarily walks the included count across that
  // boundary, so hiding it moved the chips ~30px between the two clicks one
  // cycle needs and the second click landed on a different tag. Inert instead:
  // native `disabled` keeps it unclickable and out of the Tab order (and states
  // that to assistive tech), while `paint()` above keeps the current pick
  // showing — the state it holds still applies the moment a second tag joins.
  const sync = () => {
    const off = includedTagCount(map) < 2;
    el.classList.toggle('tag-mode--inert', off);
    opts.forEach(({ btn }) => { btn.disabled = off; });
  };
  paint();
  sync();
  return { el, sync };
}
// The bulk toggle that sits above a tri-state chip row (#723) — on the session
// setup screen and in the Regal, which share the chips through the two helpers
// above and so must share this too.
//
// Its rule is NOT `showMoveGames`'s select-all/none, on purpose: there the
// useful question is "is everything on?", here it is "is there any filter to
// clear?". So any non-empty map — including a mixed 2-included/1-excluded one —
// offers the clear action, which makes wiping a #252 preset one click instead of
// the two-click walk that prompted the request.
//
// `repaint` re-paints every chip from the (mutated) map; `onChange` is the
// screen's own refresh — the pool preview here, the grid plus the count badge
// there. The returned `sync` must also run on every CHIP click, or the label
// keeps promising the action the map no longer needs.
function renderTagBulkToggle(map, roundTags, repaint, onChange) {
  const btn = h('<button type="button" class="link-btn tag-bulk"></button>');
  // No aria-pressed: this is an action whose accessible name changes, not a
  // two-state control. Announcing it as "pressed" would describe the filter's
  // state with a word that belongs to the button.
  const sync = () => { btn.textContent = t(map.size ? 'tags.filter.clearAll' : 'tags.filter.selectAll'); };
  btn.addEventListener('click', () => {
    if (map.size) map.clear();
    else roundTags.forEach((tg) => map.set(tg.id, 'include'));
    sync();
    repaint();
    onChange();
  });
  sync();
  return { el: btn, sync };
}
// Build the curated tag-icon picker (#255): a grid of glyph buttons, exactly
// one active, following the MEMBER_COLORS swatch pattern (a fixed set, no free
// input). Since #293 the grid is collapsed behind a trigger showing the current
// glyph — 20 always-open buttons dominated the narrow tag popover, making an
// optional nicety read as the main task.
// Returns { trigger, grid, get }: the two parts are handed back separately, not
// as one wrapper, because every call site wants the trigger inline in an
// existing input row and the grid on its own line below it — a wrapper would
// force the grid into that row's flex layout. `get()` reads the current pick, so
// a caller can create/patch a tag with whatever is selected at submit time.
// `selected` is the tag's stored icon (or null/undefined for an unset one,
// which lands on the default `tags` glyph — the same one it already renders).
// `opts.expanded` drops the trigger entirely and renders the bare grid: the
// Tags screen's per-tag edit already toggles the picker open from its own pencil
// button, and nesting a second disclosure inside that would be one click too many.
let iconPickerSeq = 0;
function tagIconPicker(selected, opts) {
  let current = TAG_ICONS.includes(selected) ? selected : 'tags';
  const expanded = !!(opts && opts.expanded);
  const gridId = `icon-picker-${++iconPickerSeq}`;
  const grid = h(`<div class="icon-picker" id="${gridId}" role="group" aria-label="${esc(t('tags.chooseIcon'))}"${expanded ? '' : ' hidden'}></div>`);
  const trigger = expanded ? null : h(`<button type="button" class="icon-picker__trigger" aria-expanded="false"
       aria-controls="${gridId}" title="${esc(t('tags.chooseIcon'))}" aria-label="${esc(t('tags.chooseIcon'))}">
       <i class="ti ${tagIconClass(current)}" aria-hidden="true"></i>
       <i class="ti ti-chevron-down icon-picker__caret" aria-hidden="true"></i>
     </button>`);
  const setOpen = (open) => {
    grid.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    // The grid changes the card's height in place, and an anchored popover is
    // placed ONCE — content that grows afterwards hangs off a fold it cannot be
    // scrolled back from (#519, #722). A no-op when no popover is open, which is
    // what lets this picker also live inline on the Tags screen and in the
    // add-game form (.claude/rules/anchored-popover-is-placed-once.md).
    repositionPopover();
  };
  if (trigger) trigger.addEventListener('click', () => setOpen(grid.hidden));
  TAG_ICONS.forEach((key) => {
    const label = t(`tags.icons.${key}`);
    // data-icon carries the key so a caller can read it off the button it was
    // clicked on, rather than inferring it from the button's position.
    const btn = h(`<button type="button" class="icon-picker__btn${key === current ? ' is-active' : ''}"
         data-icon="${esc(key)}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${key === current}">
         <i class="ti ${tagIconClass(key)}" aria-hidden="true"></i>
       </button>`);
    btn.addEventListener('click', () => {
      current = key;
      grid.querySelectorAll('.icon-picker__btn').forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
      if (trigger) {
        trigger.querySelector('.ti').className = `ti ${tagIconClass(key)}`;
        setOpen(false);
      }
    });
    grid.appendChild(btn);
  });
  return { trigger, grid, get: () => current };
}

// How many tags the map currently includes — what decides whether offering a
// combination mode means anything at all (#726).
function includedTagCount(map) {
  let n = 0;
  for (const state of map.values()) if (state === 'include') n++;
  return n;
}
// A game passes the tri-state tag filter iff it satisfies the included tags and
// carries none of the excluded ones. `map` is Map<tagId, 'include'|'exclude'>.
// `mode` (#726) decides how the included ones combine: 'all' — the default —
// requires every one, 'any' at least one. Excluded tags reject a game carrying
// any of them in BOTH modes; the mode widens what qualifies, never what is
// rejected. Anything other than the exact string 'any' reads as 'all', so the
// second caller cannot silently change behaviour by passing a stray value.
//
// Kept in step with lib/draw.js's server-side clause by tests on both sides —
// the two express one rule over different inputs (a chip map here, resolved id
// lists there), which is why they are deliberately not shared
// (.claude/rules/shared-constants-across-the-stack.md).
function matchesTagFilter(map, gameTagIds, mode = 'all') {
  const ids = gameTagIds || [];
  let included = 0;
  let hits = 0;
  for (const [id, state] of map) {
    if (state === 'exclude' && ids.includes(id)) return false;
    if (state === 'include') {
      included++;
      if (ids.includes(id)) hits++;
    }
  }
  if (included === 0) return true;
  return mode === 'any' ? hits > 0 : hits === included;
}
// Remembered random order per round, so it stays the same when navigating back.
const randomOrderCache = {};
function randomOrderedGames(round, activeGames) {
  const ids = activeGames.map((g) => g.id);
  const cached = randomOrderCache[round.id];
  const sameSet = cached && cached.length === ids.length && ids.every((id) => cached.includes(id));
  const order = sameSet ? cached : (randomOrderCache[round.id] = shuffled(ids));
  return order.map((id) => activeGames.find((g) => g.id === id)).filter(Boolean);
}

// The Spielwirbel-Score fields both stat functions carry (#893). Spread rather
// than nested so `st.score` reads exactly like `st.avg` at the call sites, and
// so a screen that has not switched over yet keeps working untouched.
//
// `score` is null for an empty list, matching `avg`, so every `!== null` guard
// already on screen transfers as-is.
//
// `tiles` is the per-tile histogram, and it is part of the contract: it carries
// "how many voted 2", which `vetoes`/`retires` cannot express and which the
// lone-dissenter guard in retireRecommendations() needs (#922). It is scored
// through `scoreTally` rather than `scoreRatings` — the two are the same
// function over two input shapes, so this is behaviour-identical and leaves ONE
// counting loop instead of a second one beside it. Admission goes through
// `tileValue` for the same reason scoreRatings' does: an off-scale stray has to
// be skipped by the histogram and the score alike, or the two would disagree
// about who voted.
function scoreFields(ratings) {
  const tiles = TILE_VALUE.map(() => 0);
  (Array.isArray(ratings) ? ratings : []).forEach((r) => { if (tileValue(r) !== null) tiles[r] += 1; });
  const s = scoreTally(tiles);
  return s
    ? { score: s.score, low: s.low, vetoes: s.vetoes, retires: s.retires, tiles }
    : { score: null, low: null, vetoes: 0, retires: 0, tiles };
}

// Rating stats of a game within ONE session. Iterates the session's PEOPLE, not
// the round's members, so a guest's rating counts too (#458) — a guest actually
// played the game, and leaving their vote out would make this screen and the
// game's own average silently disagree. A guest can carry no `retire` flag (the
// scale offers them no zero tile, and the server strips a hand-crafted one), so
// `sortCount` needs no guest exclusion.
//
// A retirement proposal counts as a rating of 0 rather than as no rating at all
// (#797) — `effectiveRating` is the one place that rule lives, so a legacy vote
// carrying both a rating and the flag resolves the same way here as on the
// server.
function gameStatsForSession(round, session, gameId) {
  const ratings = [];
  let sortCount = 0;
  sessionPeople(round, session).forEach((p) => {
    const v = (session.votes[p.id] || {})[gameId];
    if (!v) return;
    if (wantsRetire(v)) sortCount++;
    const r = effectiveRating(v);
    if (r !== null) ratings.push(r);
  });
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  // `avg` is kept beside `score`: the detail screen prints the honest mean next
  // to the Spielwirbel-Score, and the per-member stats are about how a PERSON
  // votes rather than how good a game is, so a game-scoring curve would be a
  // category error there (#893).
  return { avg, ...scoreFields(ratings), count: ratings.length, sortCount };
}

// Rating stats of a game across ALL (still existing) sessions. Computed on
// demand on purpose: sessions are the single source of truth, so deleting a
// session automatically removes its effect.
function gameStats(round, gameId) {
  const ratings = [];
  let sortCount = 0;
  let sessions = 0;
  let votesCast = 0; // total votes cast (rating and/or "retire")
  round.sessions.forEach((s) => {
    if (!s.gameIds.includes(gameId)) return;
    sessions++;
    // Guests included, for the same reason as gameStatsForSession above (#458).
    sessionPeople(round, s).forEach((p) => {
      const v = (s.votes[p.id] || {})[gameId];
      if (!v) return;
      votesCast++;
      if (wantsRetire(v)) sortCount++;
      const r = effectiveRating(v);
      if (r !== null) ratings.push(r);
    });
  });
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  return { avg, ...scoreFields(ratings), count: ratings.length, sortCount, sessions, votesCast };
}

// Retirement suggestions: games often suggested for retirement and/or with a
// very low average. Thresholds chosen so nothing is suggested until there are
// enough votes (no false alarm from a few votes).
function retireRecommendations(activeGames, statsByGame, minVotes) {
  const SORT_SHARE = 0.5; // at least half want it retired
  // "very low" on the SCORE scale. Was `LOW_AVG = 2.0` against the raw mean
  // (#797); the veto curve makes a 2,0 far easier to reach, so the threshold
  // came down with it (#893) rather than quietly widening what gets proposed.
  //
  // 1.0 is not a magnitude, it is an ANCHOR: it is exactly what a flat 2 from
  // everybody scores — „eher nicht" all round, the worst a game can be while
  // still getting a real rating from every voter. That is the bar for saying
  // "this one is dragging the shelf down", and reading it that way is what
  // keeps a retune honest.
  //
  // The value 1.5 was tried first and is WRONG, for a reason worth recording:
  // a game rated {0,4,5,3} — three of four people like it, one wants it gone —
  // scores exactly 1.5, so the rating branch would archive-nag a game the
  // SORT_SHARE branch had just correctly declined at 25%. One dissenter must
  // not retire a game on their own; that is what SORT_SHARE is for.
  //
  // The SECOND correction (#922) is not to the number but to its DIVISOR. The
  // 1.5-was-wrong analysis above was done entirely at n=4, where one dissenter
  // weighs `TILE_VALUE[1] / 4`; at n=3 the same dissent weighs -5/3 and {1,4,4}
  // lands on exactly 1.0. So the anchor was being reached by group size rather
  // than by how the game was received — {1,4,4} proposed, {1,4,4,4} not. The
  // threshold stayed at 1.0 and the rating branch grew the lone-dissenter guard
  // below instead, which is group-size independent by construction.
  // Pinned by test/retire-score-threshold.test.js, demo fixture included.
  const LOW_SCORE = 1.0;
  const recs = [];
  activeGames.forEach((g) => {
    const st = statsByGame[g.id];
    if (!st || st.votesCast < minVotes) return;
    const share = st.votesCast ? st.sortCount / st.votesCast : 0;
    const reasons = [];
    if (share >= SORT_SHARE)
      reasons.push(t('rec.reasonSort', { n: st.sortCount, pct: Math.round(share * 100) }));
    // The rating branch declines when the low score rests on a SINGLE voter
    // (#922): exactly one vote below 2, and nobody at 2. Both low tiles count,
    // not just the 1 — a lone trash vote is already SORT_SHARE's job, and it
    // correctly declines it at 33%. Requiring nobody at 2 is what keeps the
    // anchor intact: „eher nicht" from anyone else still leaves the game
    // proposable, so this suppresses a dissenting minority of one and nothing
    // wider.
    //
    // SORT_SHARE above is deliberately NOT gated: half the group asking for the
    // shelf is a majority however the score reads.
    const loneDissenter = st.tiles[0] + st.tiles[1] === 1 && st.tiles[2] === 0;
    if (st.score !== null && st.score <= LOW_SCORE && !loneDissenter)
      reasons.push(t('rec.reasonAvg', { avg: fmtAvg(displayScore(st.score)) }));
    if (!reasons.length) return;
    const severity = share + (st.score !== null ? Math.max(0, 3 - st.score) / 3 : 0);
    recs.push({ game: g, reasons, severity });
  });
  recs.sort((a, b) => b.severity - a.severity);
  return recs;
}

// Recommendation box minimized for this session (per round).
const minimizedRecs = new Set();

// ---- Design ----

const STANDARD_ACCENT = '#c2410c';

// The accent a stored design should actually paint with. Rounds save a snapshot
// of the palette, so when a theme's accent is corrected — as Sand and Pfirsich
// were for contrast (#145) — a round that picked it earlier still carries the
// old, failing value. Resolving against the current THEMES on every render fixes
// those rounds the next time they are drawn, which is the same render-time (not
// capture-time) approach cover sizing takes and keeps the repo free of one-time
// migration code (CLAUDE.md). An unknown page — a legacy or hand-edited design —
// keeps whatever was stored. THEMES lives in a later-loaded file and is only
// read here at call time, which the load order allows.
function resolveAccent(bg) {
  const theme = THEMES.find((th) => th.page.toLowerCase() === String(bg.page).toLowerCase());
  return theme ? theme.accent : bg.accent;
}

// The mobile browser toolbar and the installed PWA's chrome are tinted from
// <meta name="theme-color">, which index.html ships at the standard accent — so
// inside a Schiefer or Blaugrau round the frame around the app stayed
// brand-orange (#523). It follows the ACCENT rather than the page colour: the
// standard theme's accent IS that static default, so the chrome is a saturated
// brand tone at every moment and nothing flips when a round is entered or left.
// Keep this in lockstep with the --brand the caller just applied, never with a
// re-derivation — the two must not be able to disagree.
function setThemeColor(accent) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', accent);
}

// Apply the round's design: page background + accent color. Everything else —
// placeholders, borders, accent surfaces, the page glow and the finale stage —
// derives from these two custom properties via CSS color-mix (see styles.css).
function applyBackground(bg) {
  const root = document.documentElement.style;
  if (bg && bg.type === 'theme' && bg.page && bg.accent) {
    const accent = resolveAccent(bg);
    root.setProperty('--page-bg', bg.page);
    root.setProperty('--brand', accent);
    setThemeColor(accent);
  } else if (bg && bg.type === 'color' && bg.color) {
    // Legacy stored design: only a page color, standard accent.
    root.setProperty('--page-bg', bg.color);
    root.removeProperty('--brand');
    setThemeColor(STANDARD_ACCENT);
  } else {
    // No design -> fall back to the :root defaults.
    root.removeProperty('--page-bg');
    root.removeProperty('--brand');
    setThemeColor(STANDARD_ACCENT);
  }
}

// Color for an average 0–5: deep red (retire) → red → yellow → green (good).
// The lightness is 30%, not the more obvious 42%, for contrast (#145): the scale
// is used BOTH as a fill under white text (.score-pill) and as text/stroke on the
// page (.gd-ring__num, the ring). At 42% the yellow-green middle only reached
// 2.4:1 under white — every rating badge in the app failed WCAG AA. 30% is the
// lightest value that clears 4.5:1 under white across the whole hue range (worst
// case 4.5 at avg 3.0) while the ring still clears the 3:1 large-text bar on
// every theme page. The hue is untouched, so the red→yellow→green reading is
// unchanged; don't lighten it back without re-checking both uses.
function avgColor(avg) {
  const hue = Math.max(0, Math.min(120, ((avg - 1) / 4) * 120));
  // Below 1 the hue formula is already clamped at 0, so the retirement end of
  // the scale came out the SAME red as a 1 (#890). Invisible where one tile is
  // lit at a time; not in the results chart, which paints all six rungs side by
  // side. Deepen the lightness instead of bending the hue: continuous, and a
  // provable no-op for avg >= 1, which is what bounds the ripple through every
  // other avgColor/scoreColor consumer. Darker is also the safe direction for
  // both uses — more contrast under white text, and more against every (light)
  // theme page as text.
  const light = 30 - 10 * Math.max(0, Math.min(1, 1 - avg));
  return `hsl(${hue}, 60%, ${light}%)`;
}

// What a score PRINTS as. The curve can carry a score below zero — five vetoes
// score −5 — and a negative reads as a broken app rather than as a bad game, so
// every display clamps at the floor. Ranking deliberately uses the unclamped
// value, so two games at the floor still sort by how bad they actually are;
// `computePlaces` then ties them on the displayed number, which is what makes
// two floored games correctly share a place (#893).
const displayScore = (score) => Math.max(SCORE_MIN, score);

// The score's colour. `avgColor`'s ramp is defined over the 0–5 tile scale, so
// the score's floor is the deep red a 0 already gets — one ramp, two domains.
// Keep `avgColor` for anything on the tile scale itself (the selected vote
// tile, the distribution chart) and this for anything on the score scale.
const scoreColor = (score) => avgColor(displayScore(score));

// Why this score is what it is, in a few words — „1× gar nicht" (#893).
//
// This is the PRIMARY explanation of the number, not the ⓘ sheet: it explains
// THIS game at the moment the group is deciding, which a popup describing the
// principle in general cannot. Empty whenever there is nothing to say, which is
// the common case — a game nobody rated below 3 scores exactly its raw average,
// so a reason line there would be noise claiming a divergence that is not
// happening.
//
// The two counts stay separate sentences rather than one "unhappy" total: the
// trash tile is members-only (#458) and says something about the SHELF, while
// the 1 is about tonight. Both, in the rare case a game collected each, reads
// as the two distinct complaints it is.
function scoreReason(st) {
  const parts = [];
  if (st.retires) parts.push(tn(st.retires, 'score.reasonRetireOne', 'score.reasonRetire', { n: st.retires }));
  if (st.vetoes) parts.push(tn(st.vetoes, 'score.reasonVetoOne', 'score.reasonVeto', { n: st.vetoes }));
  return parts.join(' · ');
}

// The avatar palette itself lives in member-colors.js — one source of truth
// shared with lib/routes/members.js, which validates against it (#420).
function memberColor(round, memberId) {
  const idx = round.members.findIndex((m) => m.id === memberId);
  // A stored color (set on the member's detail page) wins; otherwise the color
  // is derived from the member's position, which is append-only and stable.
  const m = idx >= 0 ? round.members[idx] : null;
  if (m && MEMBER_COLORS.includes(m.color)) return m.color;
  return MEMBER_COLORS[(idx >= 0 ? idx : 0) % MEMBER_COLORS.length];
}

// Colour for one session participant (sessionPeople shape). A guest is not a
// round member, so memberColor() would find no row and hand every guest member
// #0's swatch (#458) — they get the neutral ink instead, which also reads as
// "not one of us" and reinforces the (Gast) label.
// It has to be a DARK tone, not the light dashed one `.avatar--guest` paints
// with: this value becomes the handover card's full-bleed background (white text
// on it) and the voter's name colour on the page. --ink-soft clears 4.5:1 both
// under white and on the darkest theme page, which is the bar every text colour
// here has to meet (.claude/rules/accessibility-contrast-and-modals.md §1).
function personColor(round, person) {
  return person.guest ? 'var(--ink-soft)' : memberColor(round, person.id);
}

// Initials for an avatar: first letters of the first two words, or the first
// two letters of a single-word name.
function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const raw = parts.length >= 2 ? parts[0][0] + parts[1][0] : String(name).trim().slice(0, 2);
  return raw.toUpperCase();
}

// Seat-picker around a table: tap a member to toggle whether they join tonight.
// `joining` is a Set of member ids, mutated in place; at least one member must
// stay in. `onChange` (optional) runs after a toggle. `extraCount` (optional) is
// a function returning further players who are at the table but hold no seat —
// the session's guests (#458) — so the centre count matches the player count the
// draw pool is actually filtered by. Returns the table element to append where
// needed, carrying a `refreshSeats()` so a caller whose `extraCount` changed can
// redraw it (the guest list lives outside the picker). Shared by the
// start-session screen and the "Jetzt spielen" sheet.
function renderSeatPicker(round, joining, onChange, extraCount) {
  const table = h(`<div class="nr-table">
      <div class="nr-table__ring"></div>
      <div class="nr-table__center"></div>
    </div>`);
  const tableCenter = table.querySelector('.nr-table__center');
  function render() {
    table.querySelectorAll('.nr-seat').forEach((el) => el.remove());
    const extra = typeof extraCount === 'function' ? extraCount() : 0;
    tableCenter.textContent = tn(joining.size + extra, 'startSession.tableCountOne', 'startSession.tableCount');
    const cx = 140, cy = 118, rx = 112, ry = 92;
    round.members.forEach((m, i) => {
      const angle = ((-90 + (i * 360) / round.members.length) * Math.PI) / 180;
      const joined = joining.has(m.id);
      // aria-pressed carries the in/out state (#145). Without it the seat is
      // announced as a bare name and whether that member is playing tonight is
      // conveyed by color and a "+" glyph alone — unusable without sight, on the
      // control that decides who is in the session.
      const seat = h(`<button type="button" class="nr-seat${joined ? '' : ' nr-seat--out'}"
           aria-pressed="${joined}" title="${esc(m.name)}">
           <span class="nr-seat__avatar"${joined ? ` style="background:${memberColor(round, m.id)}"` : ''}>${
             joined ? avatarFace(initials(m.name), { userId: m.userId }) : '<i class="ti ti-plus" aria-hidden="true"></i>'
           }</span>
           <span class="nr-seat__name">${esc(m.name)}</span>
         </button>`);
      seat.style.left = cx + rx * Math.cos(angle) + 'px';
      seat.style.top = cy + ry * Math.sin(angle) - 23 + 'px';
      seat.addEventListener('click', () => {
        if (joining.has(m.id)) {
          if (joining.size === 1) return toast(t('startSession.toast.noMembers'));
          joining.delete(m.id);
        } else {
          joining.add(m.id);
        }
        render();
        if (onChange) onChange();
      });
      table.appendChild(seat);
    });
  }
  render();
  table.refreshSeats = render;
  return table;
}

// Accent color of a round's stored design (fallback: the standard accent).
// Works with both the full round object and the home-screen summary.
function themeAccent(bg) {
  // Same normalization as applyBackground, so a home-screen emblem never shows a
  // different accent than the round screen it opens.
  return bg && bg.type === 'theme' && bg.accent ? resolveAccent(bg) : STANDARD_ACCENT;
}

// --- Anchored popover (small floating menu next to a clicked element) ---
// Used for the inline edit menus on the game detail page. Only one is open at a
// time; it closes on Escape, an outside click, or a page scroll/resize.
let activePopover = null;
function closePopover() {
  if (!activePopover) return;
  const { el, restoreTo, onClose } = activePopover;
  // Hand focus back to the control that opened it, the way trapFocus does for a
  // sheet (#145) — without it a keyboard user who closes a popover is dropped to
  // <body> and restarts from the top of the document (#424). Only when focus is
  // still *inside* the popover (or nowhere): once the user has clicked into some
  // other control, yanking it back would fight them for it. Read before the
  // remove() below, which moves focus to <body> on its own.
  const held = el.contains(document.activeElement) || !document.activeElement || document.activeElement === document.body;
  el.remove();
  document.removeEventListener('mousedown', activePopover.onDoc, true);
  document.removeEventListener('keydown', activePopover.onKey, true);
  window.removeEventListener('resize', activePopover.onGone, true);
  window.removeEventListener('scroll', activePopover.onScroll, true);
  activePopover = null;
  if (held && restoreTo && document.contains(restoreTo) && typeof restoreTo.focus === 'function') restoreTo.focus();
  // AFTER the teardown and the focus restore, so a hook that reads the world
  // back — `aria-expanded` on the trigger, a deferred rebuild — sees the closed
  // state rather than the one it is being told about. Fired for EVERY exit
  // (Escape, outside click, page scroll, resize), which is the whole reason it
  // exists: a caller that only wraps the `close` it was handed misses all four.
  if (typeof onClose === 'function') onClose();
}
// Re-place the open popover after its content changed height. A no-op when no
// popover is open, which is what lets a component that may live in EITHER
// presentation — the edition-cover picker sits in a popover on desktop, a sheet
// on a phone and inline in the add-game form — call it unconditionally.
function repositionPopover() {
  if (activePopover && activePopover.place) activePopover.place();
}

// `build(el, close)` may return a callback, which runs once the popover is in
// the document AND positioned. Anything that needs a live element — above all
// `input.focus()` — belongs there: build() itself runs on a detached node, so a
// focus() call in it is a silent no-op, which is why the tags/players editors'
// autofocus never worked on any platform (#422).
function openPopover(anchor, build, onClose) {
  // Captured before the replace-close below, so THIS popover's opener is the
  // restore target even when it replaces one that was already open.
  const restoreTo = document.activeElement;
  closePopover();
  const el = h('<div class="popover"></div>');
  const close = () => closePopover();
  const attached = build(el, close);
  document.body.appendChild(el);
  place();

  // Prefer below the anchor; flip above if it wouldn't fit. Clamp horizontally,
  // and — since #739 — vertically too, to the room the chosen side actually has:
  // the card is placed wholly on one side, so a card taller than the larger side
  // has no legal placement and used to be put past the fold regardless. The
  // arithmetic (which side, how much room, how far it may be squeezed) is in
  // `popover-fit.js`; everything DOM-shaped about it stays here.
  //
  // Re-runnable, and re-run through repositionPopover() whenever the content
  // changes size (#519): the placement is decided from `el.offsetHeight`, so a
  // popover that GROWS after it was placed — the edition-cover grid expanding —
  // keeps a `top` chosen for its old height and can run off the bottom of the
  // viewport. There is no recovering from that by scrolling either: a page
  // scroll closes the popover (onScroll below), so the overflow is simply
  // unreachable. Placement is idempotent, so re-running it is safe.
  //
  // A ResizeObserver would do this with no caller involvement and was tried
  // first. It is not used because it cannot be VERIFIED here: the Claude Code
  // Browser pane never fires one at all — measured on a plain div whose height
  // was changed 50px -> 200px, zero callbacks — the same dead-observer artifact
  // that stops IntersectionObserver working there
  // (.claude/rules/preview-pane-paint-artifacts.md). An explicit call is
  // deterministic and testable; an untestable mechanism is not worth its silence.
  function place() {
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    const kids = [...el.children];
    // From a clean slate every time: a previous run may have clamped the card,
    // and both the anchor and the viewport can have moved since.
    el.style.maxHeight = '';
    el.classList.remove('popover--clamped');
    kids.forEach((k) => { k.style.minHeight = ''; });
    const natural = el.offsetHeight;
    const fit = popoverFit(natural, r.top, r.bottom, window.innerHeight);
    if (fit.clamped) {
      // No child may be squeezed past its own content while the card is clamped.
      // A give-way child carries `min-height: 0` precisely so its card's CSS cap
      // can bite (`.exp-pick`), and under a tighter clamp that lets it collapse
      // to nothing while its own content keeps its floor — which then paints ON
      // TOP of the next child (#728; measured here at 107px). Barred, the child
      // stops at its content and the card scrolls the rest, which is the whole
      // reason the clamp needs no floor of its own.
      //
      // Inline rather than a rule, because the declarations that set that 0 are
      // more specific than any class this could add — a stylesheet fight decided
      // by source order is exactly what .claude/rules/ warns off.
      kids.forEach((k) => { k.style.minHeight = 'auto'; });
      el.style.maxHeight = fit.height + 'px';
      // A clamped card has to scroll itself, or the clamp merely trades "past
      // the fold" for "clipped" — which is worse, because nothing indicates
      // there is more. The class carries that (plus the `overscroll-behavior`
      // that keeps reaching its end from scrolling the page and closing it).
      el.classList.add('popover--clamped');
    }
    const h = el.offsetHeight;
    el.style.top = (fit.above ? window.scrollY + r.top - h - fit.gap : window.scrollY + r.bottom + fit.gap) + 'px';
    let left = window.scrollX + r.left;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - el.offsetWidth - margin;
    left = Math.max(window.scrollX + margin, Math.min(left, maxLeft));
    el.style.left = left + 'px';
  }

  const onDoc = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onGone = () => close();
  // Capture-phase scroll on window also fires for scrolls *inside* the popover —
  // a single-line <input> scrolls as soon as its text overflows, which silently
  // closed the popover mid-typing (#247). Ignore those; a page scroll targets
  // `document` (not contained by `el`), so it still closes as before.
  const onScroll = (e) => { if (!el.contains(e.target)) close(); };
  document.addEventListener('mousedown', onDoc, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onGone, true);
  window.addEventListener('scroll', onScroll, true);
  activePopover = { el, restoreTo, onDoc, onKey, onGone, onScroll, place, onClose };
  if (typeof attached === 'function') attached();
  return { el, close };
}

// Read a single image from the clipboard (used to set a cover image on click).
// Returns a Blob, or null after showing a toast explaining what went wrong.
async function readClipboardImage() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      toast(t('addGame.toast.useShortcut'));
      return null;
    }
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const imgType = it.types.find((ty) => ty.startsWith('image/'));
      if (imgType) return await it.getType(imgType);
    }
    toast(t('addGame.toast.noImage'));
    return null;
  } catch {
    toast(t('addGame.toast.pasteFail'));
    return null;
  }
}

// Copy of an array in random order (Fisher–Yates).
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Inline "<icon> label" markup for buttons/badges/tags; the label is escaped.
const iconText = (icon, text) => `<i class="ti ${icon}" aria-hidden="true"></i> ${esc(text)}`;

// Lazy cover loading (#198). Covers render as CSS background-image, which the
// browser can't natively lazy-load — so a long list (Regal grid, Chronik,
// archive) would fire every cover request on its first paint. Each list render
// creates ONE loader; registered elements get their image only as they
// approach the viewport. The observer is scoped to the render (not shared
// globally) so it is GC'd together with the view's discarded nodes.
// `loadCover(watchEl, url, targetEl)`: observe `watchEl`, set the image on
// `targetEl` (defaults to `watchEl`). Watch the OUTER card when the card uses
// `content-visibility: auto` — skipped content has no layout boxes, so a
// descendant would never report a real intersection.
function createCoverLoader() {
  const apply = (el, url) => { el.style.backgroundImage = `url('${url}')`; };
  if (!('IntersectionObserver' in window))
    return (watchEl, url, targetEl) => apply(targetEl || watchEl, url);
  const pending = new WeakMap();
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const p = pending.get(entry.target);
        if (p) apply(p.target, p.url);
        io.unobserve(entry.target);
      });
    },
    // Start fetching one viewport-height early so scrolling rarely catches an
    // empty frame, while a first paint still skips everything far below.
    { rootMargin: '100% 0px' }
  );
  return (watchEl, url, targetEl) => {
    pending.set(watchEl, { url, target: targetEl || watchEl });
    io.observe(watchEl);
  };
}

// Turn an <a> into a link to a game's detail page (the `.game-link` class
// carries cursor/hover/focus styling). Used from the session results, Pokale
// and member screens; `showGameDetail` is resolved at call time (it lives in a
// later-loaded script).
//
// Since #330 the element must be an anchor, and navLink gives it the real href
// — so the role="button"/tabindex/Enter-Space scaffolding this used to hand-roll
// is gone: an <a href> is focusable and Enter-activated natively. Space
// deliberately no longer activates it; that is button semantics, and on a link
// the key scrolls, which is what a screen-reader user now correctly expects.
//
// `opts.redundant` marks a link that only repeats an adjacent one pointing at
// the same game — a cover thumbnail next to its own title (#145). It stays
// clickable with the mouse but leaves the tab order and the accessibility tree,
// because the alternative is a second, *nameless* control on every result row:
// an image element has no text, so it announced as unlabelled.
function makeGameLink(el, rid, gid, opts) {
  el.classList.add('game-link');
  if (opts && opts.redundant) {
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('tabindex', '-1');
  }
  navLink(el, gamePath(rid, gid), () => showGameDetail(rid, gid));
}

// Turn an <a> into a link to a member's detail page (the `.member-link` class
// carries cursor/hover/focus styling). Used from the Start hero row, the Pokale
// podium and the session results; `showMember` is resolved at call time (it
// lives in a later-loaded script). Same anchor contract as makeGameLink above.
function makeMemberLink(el, rid, mid) {
  el.classList.add('member-link');
  navLink(el, memberPath(rid, mid), () => showMember(rid, mid));
}

// GAME_ICON / gameHue / coverPlaceholder live in js/cover.js (loaded earlier),
// which is pure and dependency-free so the test suite can require it.

// Plain localized player-count text ("2–4 Personen"), or '' when the game
// predates the player-count feature (one/both fields missing). The plain form is
// reused wherever a range is shown without the .tag chrome (e.g. the
// link-provider value preview, issue #183).
const playersText = (min, max) => {
  if (!Number.isInteger(min) || !Number.isInteger(max)) return '';
  return min === max
    ? tn(min, 'players.one', 'players.single', { n: min })
    : t('players.range', { min, max });
};
