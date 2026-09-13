'use strict';

/* The search-as-you-type provider lookup: the provider name tables, the query
   helpers, and `attachLookup` — the control that owns a text input, its
   suggestion menu, the debounce, the in-flight sequence guard and the keyboard
   handling.

   Split out of views-round-lookup.js by #956. A control/screen seam, the same
   one tag-chips.js is: `attachLookup(round, input, menu, onPick, onInput)` knows
   nothing about which sheet it is inside, and the two sheets that use it are
   edited for entirely different reasons than the search behaviour is. The
   provider tables are shared further still — views-round-detail.js renders
   „Auf {provider} ansehen" from them and lookup-nav.js reads MAX_SUGGESTIONS.

   Adding a provider is `.claude/rules/add-game-lookup-provider.md`; the ranking
   of hits lives next door in lookup-score.js. No `module.exports`: DOM
   throughout (see round-theme.js's header for the coverage constraint). */

// --- Shared add-game / link-provider lookup plumbing ---
// Provider display names are proper nouns, not translated (see the source link).
//
// The four storefronts are LOOKUP-RETIRED (#744) but stay named here, and that is
// deliberate: games linked to them are still on real shelves, and the game-detail
// page renders „Auf {provider} ansehen" from this table. The four retired
// storefronts were nameable here until #981 cleared the last stored links to
// them; an id with no entry still degrades to the raw string rather than
// throwing, which is the behaviour a future retirement relies on.
const PROVIDER_LABELS = { bgg: 'BoardGameGeek' };
function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider;
}
// The same names, short enough to sit in a button (#817). „Auf BoardGameGeek
// ansehen" measured 275px against a 343px phone card, so the game-detail link
// and the cover-fetch button take these instead.
//
// The fallback chains to providerLabel, NOT to the raw id: a missing short entry
// must land on the full name rather than on a bare provider id.
const PROVIDER_LABELS_SHORT = { bgg: 'BGG' };
function providerLabelShort(provider) {
  return PROVIDER_LABELS_SHORT[provider] || providerLabel(provider);
}
// There were per-provider brand marks here until #790 — a badge row under each
// suggestion, one badge per provider offering that title. They went with the
// title-grouping layer that produced them: with a single provider every badge
// row held exactly one badge, duplicating the title button beside it. Note the
// "Powered by BGG" attribution the XML API licence requires is a separate,
// self-hosted mark in the site footer (public/index.html) and is untouched.

// The lookup queries every provider in parallel and merges the hits into one
// menu, each result carrying its own provider. Providers are rendered
// *progressively* (a fast provider's hits show before a slow one settles) and
// the merged list is ranked by how well each title matches the query, re-sorted
// in place as each provider arrives. One provider failing must not hide the
// others' results — only an all-providers failure shows the error state.
//
// This is the registry order, which doubles as the interleave priority. It must
// mirror lib/providers/index.js — a name here the server does not register only
// ever produces a 400 per keystroke. Since #744 it holds BGG alone, and the
// lookup is UNCONDITIONAL: the per-round `providers` setting that used to filter
// this list went with the four storefronts it existed to switch off.
const LOOKUP_PROVIDERS = ['bgg'];
const MAX_SUGGESTIONS = 10;

// Both hops carry the ACTIVE UI locale (#505), for a provider that answers in
// whatever language it is asked for.
//
// It is the app's own locale, deliberately not the browser's Accept-Language:
// a user who switched the picker would otherwise still get their OS language.
// The server maps it through a closed per-provider table, so an invented value
// only ever falls back. BGG ignores it entirely (#117), so today this is
// contract rather than effect — keep sending it.
async function searchProvider(rid, provider, q) {
  const lang = encodeURIComponent(getLocale());
  const res = await api('GET', `/api/rounds/${rid}/lookup/search?provider=${provider}&q=${encodeURIComponent(q)}&lang=${lang}`);
  return ((res && res.results) || []).map((r) => Object.assign({ provider }, r));
}

// Fetch one provider's detail for a round, honouring its enabled list server-side.
function lookupDetail(rid, r) {
  return api('GET', `/api/rounds/${rid}/lookup/game?provider=${encodeURIComponent(r.provider)}&id=${encodeURIComponent(r.providerId)}&lang=${encodeURIComponent(getLocale())}`);
}

// Unique per attached lookup, so the option ids `aria-activedescendant` points
// at can never collide (both sheets hard-code the same `#lookupMenu` id).
let lookupSeq = 0;

// Wire search-as-you-type merged provider suggestions onto an input + menu.
// onPick(result) fires when a suggestion is chosen; onInput() (optional) fires
// on every manual edit. Returns { closeMenu, search, isOpen }: closeMenu dismisses
// the menu programmatically (e.g. after a pick), search(q) runs a lookup immediately
// (e.g. for a prefilled value on open), isOpen() reports whether the menu is
// showing — the sheets ask before letting Escape through (see below). Shared by
// showAddGame and showLinkProvider so the two lookups stay in sync.
//
// Keyboard model (#542): this is an APG *editable combobox with a listbox
// popup*. DOM focus stays in the input at all times and ArrowDown/ArrowUp move
// an `aria-activedescendant` highlight, which is what makes the whole menu
// operable without touching the mousedown-before-blur race the mouse path needs
// — Tab moving focus into the menu would blur the input and destroy the very
// row being reached, so every menu element is `tabindex="-1"` and stays out of
// the tab order (and out of the sheet's focus trap).
function attachLookup(round, input, menu, onPick, onInput) {
  const rid = round.id;
  const active = LOOKUP_PROVIDERS;
  // An empty registry keeps the field a plain title input with no dropdown, and
  // the inert stubs let callers keep calling closeMenu()/search()/isOpen()
  // unconditionally. Unreachable while a provider ships — kept because the
  // sheets' Escape handling calls isOpen() before anything else, so the day this
  // list is empty it must not throw (.claude/rules/lookup-menu-keyboard-combobox.md §1).
  if (!active.length) return { closeMenu() {}, search() {}, isOpen: () => false };

  let searchTimer;
  let searchSeq = 0; // guards against out-of-order responses
  const uid = ++lookupSeq;

  // Combobox wiring. The menu keeps whatever id the sheet gave it; only the
  // option ids need to be unique across sheet opens.
  if (!menu.id) menu.id = 'lookupMenu-' + uid;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', t('lookup.suggestions'));
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', menu.id);
  input.setAttribute('aria-autocomplete', 'list');

  // One entry per row, in visual order: { el, provider, providerId, pick }.
  // Since #790 that is exactly one per hit — no badges, so no second stop on a
  // choice the title button already offers.
  let options = [];
  let activeIdx = -1;
  // The identity of the active option, so a re-render can find it again — see
  // lookupOptionIndex in lookup-nav.js.
  let activeRef = null;

  // The menu is `position: fixed` (see styles.css), so it floats free of the
  // sheet's scroll box and can't be clipped by it. That means we place it
  // ourselves against the input's viewport rect: below by default, flipped
  // above when there's more room there, and capped so it never runs off-screen.
  function positionMenu() {
    const r = input.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const gap = 4;
    const edge = 8; // keep a little clearance from the viewport edge
    const spaceBelow = vh - r.bottom - gap - edge;
    const spaceAbove = r.top - gap - edge;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    const avail = Math.max(openUp ? spaceAbove : spaceBelow, 120);
    // Grow a bit wider than the input so long titles have room, but stay within
    // the viewport; keep the menu left-anchored to the input, shifting left only
    // if it would overflow the right edge.
    const width = Math.min(Math.max(r.width, 440), vw - 2 * edge);
    const left = Math.max(edge, Math.min(r.left, vw - edge - width));
    menu.style.left = left + 'px';
    menu.style.width = width + 'px';
    menu.style.maxHeight = Math.min(340, avail) + 'px';
    if (openUp) {
      menu.style.top = 'auto';
      menu.style.bottom = (vh - r.top + gap) + 'px';
    } else {
      menu.style.bottom = 'auto';
      menu.style.top = (r.bottom + gap) + 'px';
    }
  }
  // Reposition while open so the menu tracks the input if the sheet scrolls or
  // the window resizes; listeners are bound only while the menu is visible.
  const reposition = () => { if (!menu.hidden) positionMenu(); };
  function openMenu() {
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    positionMenu();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
  }

  function closeMenu() {
    menu.hidden = true;
    menu.innerHTML = '';
    // Clear the highlight with the DOM it pointed at: a stale
    // aria-activedescendant names an element that no longer exists, which some
    // screen readers report as the still-current option.
    options = [];
    activeIdx = -1;
    activeRef = null;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
  }
  const isOpen = () => !menu.hidden;
  function showMenuMsg(msg) {
    // role="presentation" so a status line never joins the listbox as a
    // pickable option — the menu must contain options and nothing else.
    menu.innerHTML = `<div class="lookup__msg muted" role="presentation">${esc(msg)}</div>`;
    options = [];
    activeIdx = -1;
    input.removeAttribute('aria-activedescendant');
    openMenu();
  }

  // Keep the active row visible without touching any other scroll container:
  // the menu is `position: fixed`, so it is the offsetParent of its rows, and
  // scrollIntoView() here could scroll the sheet (or the page) behind it.
  function scrollIntoMenu(el) {
    const row = el.closest('.lookup__opt') || el;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }

  function setActive(idx) {
    const prev = options[activeIdx];
    if (prev) {
      prev.el.classList.remove('is-active');
      prev.el.setAttribute('aria-selected', 'false');
    }
    activeIdx = idx;
    const next = options[idx];
    if (!next) {
      activeRef = null;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    next.el.classList.add('is-active');
    next.el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', next.el.id);
    activeRef = { provider: next.provider, providerId: next.providerId };
    scrollIntoMenu(next.el);
  }

  function runSearch(q) {
    const seq = ++searchSeq;
    showMenuMsg(t('lookup.searching'));
    const hits = []; // accumulates across providers as each resolves
    let pending = active.length;
    let anyFulfilled = false;

    // One row per hit, ranked by how well its title answers the query. Re-run on
    // every arrival so a late provider's rows slot in place.
    //
    // Hits are deliberately NOT collapsed by title (#790): BGG returns several
    // genuinely distinct games under one exact name ("Scout"), and folding them
    // into one row made every hit but the survivor impossible to link at all —
    // there is no "show more" and no way to type an id. The year is what tells
    // the rows apart, the same disambiguator BGG's own search uses.
    function render() {
      if (seq !== searchSeq) return; // a newer keystroke superseded this search
      const rows = hits.slice()
        .sort((a, b) => b.score - a.score || a.prio - b.prio ||
          (a.title || '').trim().length - (b.title || '').trim().length || a.order - b.order)
        .slice(0, MAX_SUGGESTIONS);
      if (!rows.length) {
        if (pending > 0) return showMenuMsg(t('lookup.searching'));
        return showMenuMsg(anyFulfilled ? t('lookup.noResults') : t('lookup.error'));
      }
      menu.innerHTML = '';
      options = [];
      // Both events, because the two input modes need different ones and each is
      // useless for the other: mousedown fires before the input's blur tears the
      // menu down (a click listener alone never runs for a mouse pick), while a
      // keyboard/AT activation only ever dispatches click. `done` keeps a real
      // pointer click — which fires both — from picking twice.
      const bindPick = (el, hit) => {
        let done = false;
        const fire = (e) => {
          e.preventDefault();
          if (done) return;
          done = true;
          onPick(hit);
        };
        el.addEventListener('mousedown', fire);
        el.addEventListener('click', fire);
        return fire;
      };
      rows.forEach((hit, ri) => {
        const thumb = hit.thumbnail
          ? `<img class="lookup__thumb" src="${esc(hit.thumbnail)}" alt="" loading="lazy" />`
          : `<span class="lookup__thumb lookup__thumb--none" aria-hidden="true"><i class="ti ${hit.provider === 'bgg' ? 'ti-dice-3' : 'ti-device-gamepad-2'}"></i></span>`;
        // The year rides inside the button, so it is part of the option's
        // accessible name — which is the whole point on a set of rows whose
        // titles are identical. Muted and parenthesized, so it reads as an
        // aside rather than as part of the game's name; absent when BGG has
        // none, rather than rendering an empty element that shifts the row.
        const year = hit.year ? `<span class="lookup__year">(${esc(hit.year)})</span>` : '';
        // The row is presentational: a listbox's children must be its options,
        // and the option here is the title button.
        const row = h(`<div class="lookup__opt" role="presentation">
            <button type="button" class="lookup__pick" id="lk${uid}-${ri}" role="option" aria-selected="false" tabindex="-1">${thumb}<span class="lookup__title">${esc(hit.title)}</span>${year}</button>
          </div>`);
        const pickBtn = row.querySelector('.lookup__pick');
        options.push({ el: pickBtn, provider: hit.provider, providerId: hit.providerId, pick: bindPick(pickBtn, hit) });
        menu.appendChild(row);
      });
      // A muted, non-clickable hint while a slower provider is still pending.
      if (pending > 0) menu.appendChild(h(`<div class="lookup__msg muted" role="presentation">${esc(t('lookup.loadingMore'))}</div>`));
      openMenu();
      // Re-locate the highlight by identity, never by index: this re-render may
      // have inserted a faster provider's rows above it or re-sorted around it.
      setActive(lookupOptionIndex(options, activeRef));
    }

    active.forEach((provider, prio) => {
      searchProvider(rid, provider, q).then((list) => {
        if (seq !== searchSeq) return;
        anyFulfilled = true;
        list.forEach((r, order) => hits.push(Object.assign({ score: scoreHit(r.title, q), prio, order }, r)));
      }, () => { /* provider failed — leave its hits out, others still render */ })
        .then(() => { pending--; render(); });
    });
  }

  input.addEventListener('input', () => {
    if (onInput) onInput();
    // Typing invalidates the highlight — the next render's rows answer a
    // different query, so carrying a selection into them would pick a game the
    // user is no longer looking at.
    activeRef = null;
    const q = input.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) return closeMenu();
    searchTimer = setTimeout(() => runSearch(q), 300);
  });
  input.addEventListener('blur', () => setTimeout(closeMenu, 150));

  // Keyboard operation (#542). Focus never leaves the input, so this one handler
  // owns the whole menu.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Only when the menu is actually open — with it closed, Escape still
      // belongs to the sheet. The sheets' own handler runs first (document,
      // capture phase) and defers to isOpen(), so this is the fallback for any
      // caller that isn't a sheet.
      if (!isOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (e.key === 'Enter') {
      const opt = options[activeIdx];
      if (opt) opt.pick(e); // preventDefault is the pick handler's own job
      return;
    }
    if (!isOpen()) return;
    const next = nextLookupIndex(activeIdx, options.length, e.key);
    // null = not a key this widget owns; leave the caret keys alone.
    if (next === null) return;
    e.preventDefault(); // ArrowUp/Down would otherwise jump the caret
    setActive(next);
  });

  // Kick off a search immediately (no debounce), respecting the same
  // minimum-length guard as typing. Used to search a prefilled value on open.
  function search(q) {
    clearTimeout(searchTimer);
    q = (q || '').trim();
    if (q.length < 2) return closeMenu();
    runSearch(q);
  }

  return { closeMenu, search, isOpen };
}
