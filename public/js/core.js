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
/* One card in a column flow (.hub-cards, .home-dash) — the box that carries the
   vertical spacing, so the CARD never does (#946).

   WebKit does NOT truncate a margin adjoining a column break: it pushes the
   part that did not fit into the next column, so the first card of every column
   after the tallest one starts one gap too low. Spacing held INSIDE the
   break-avoid unit has nowhere to spill, and measures flush in both engines.
   Removing a card must take its slot with it (`slotOf`), or the empty slot
   keeps paying its padding. */
const cardSlot = (el) => {
  const slot = h('<div class="card-slot"></div>');
  slot.appendChild(el);
  return slot;
};
const slotOf = (el) => el.closest('.card-slot') || el;

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
// `opts` is swrRead's: every screen wants the default background re-render, but a
// read taken WHILE A SHEET IS OPEN must pass `{ rerender: false }` — the sheet
// lives on document.body, so uiBusy() cannot see it and a revalidation would
// rebuild the screen underneath it (#916's duplicate flagging reads the TARGET
// round this way).
const fetchRound = async (rid, opts) => {
  const round = await swrRead('round:' + rid, '/api/rounds/' + rid, opts);
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

// Remembered random order per round, so it stays the same when navigating back.
const randomOrderCache = {};
function randomOrderedGames(round, activeGames) {
  const ids = activeGames.map((g) => g.id);
  const cached = randomOrderCache[round.id];
  const sameSet = cached && cached.length === ids.length && ids.every((id) => cached.includes(id));
  const order = sameSet ? cached : (randomOrderCache[round.id] = shuffled(ids));
  return order.map((id) => activeGames.find((g) => g.id === id)).filter(Boolean);
}

// What a member's palette hex is PAINTED as under the round's scheme (#904).
// MEMBER_COLORS are fixed dark tones, tuned to carry white initials on a light
// page (#145). On a dark page a dark disc sinks into the background, and the
// same value is also drawn as TEXT — the voter's name on the vote screen — where
// it lands well under AA. Lifting toward white keeps each colour recognisably
// itself while handing the ink flip to --on-accent, which this scheme has
// already inverted.
//
// Render-time, exactly like resolveAccent(): nothing is stored lifted, so the
// stored value stays a member-colors.js hex and lib/routes/members.js keeps
// validating the same eight (.claude/rules/shared-constants-across-the-stack.md).
// A color-mix() is a legal inline background, so this needs no second palette.
const MEMBER_LIFT = '42%';
function memberTone(color) {
  return isDarkScheme() ? `color-mix(in oklab, ${color}, #fff ${MEMBER_LIFT})` : color;
}

// The palette hex a member OWNS. The palette itself lives in member-colors.js —
// one source of truth shared with lib/routes/members.js, which validates against
// it (#420). Split from the painted tone below because the swatch picker has to
// compare against the STORED value, and under a dark scheme the painted one is a
// color-mix() string that matches nothing.
function memberHex(round, memberId) {
  const idx = round.members.findIndex((m) => m.id === memberId);
  // A stored color (set on the member's detail page) wins; otherwise the color
  // is derived from the member's position, which is append-only and stable.
  const m = idx >= 0 ? round.members[idx] : null;
  if (m && MEMBER_COLORS.includes(m.color)) return m.color;
  return MEMBER_COLORS[(idx >= 0 ? idx : 0) % MEMBER_COLORS.length];
}

const memberColor = (round, memberId) => memberTone(memberHex(round, memberId));

// Colour for one session participant (sessionPeople shape). A guest is not a
// round member, so memberColor() would find no row and hand every guest member
// #0's swatch (#458) — they get the neutral ink instead, which also reads as
// "not one of us" and reinforces the (Gast) label.
// It has to be a SOLID tone, not the light dashed one `.avatar--guest` paints
// with: this value becomes the handover card's full-bleed background and the
// voter's name colour on the page. --ink-soft is the right token for both
// because it is itself a scheme token — dark on a light design, light on a dark
// one — so it clears 4.5:1 as text on the page either way, and the ink ON it is
// --on-accent, which flips with it. It is deliberately NOT passed through
// memberTone(): lifting an already-light tone would take it to near-white, i.e.
// to --ink, and lose the "not one of us" distinction the colour is for
// (.claude/rules/accessibility-contrast-and-modals.md §1).
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
