/* Spielwirbel – views: the add-game / link-provider search-as-you-type lookup
   plumbing (provider helpers, attachLookup), the add-game and link-provider
   sheets, and starting a session directly from a game. Loaded after
   views-round.js; shares one global script scope. */

// --- Shared add-game / link-provider lookup plumbing ---
// Provider display names are proper nouns, not translated (see the source link).
//
// The four storefronts are LOOKUP-RETIRED (#744) but stay named here, and that is
// deliberate: games linked to them are still on real shelves, and the game-detail
// page renders „Auf {provider} ansehen" from this table. Drop an entry and that
// link silently degrades to the bare id (`psstore`), which reads as a bug in the
// one place the stored link is still useful. They are absent from
// LOOKUP_PROVIDERS below — being nameable is not being queryable.
const PROVIDER_LABELS = { psstore: 'PlayStation Store', bgg: 'BoardGameGeek', steam: 'Steam', nintendo: 'Nintendo eShop', xbox: 'Xbox' };
function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider;
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

// Opens as a bottom sheet over the current screen (usually the Regal).
//
// `wish` (#560) creates onto the Wunschliste instead of the shelf. It is the same
// sheet throughout — the lookup, the cover, the player range and the tags are
// exactly as useful for a game the group wants as for one they own — so only the
// wording, the POST field and where dismissing returns to differ.
function showAddGame(round, { wish = false } = {}) {
  const sheetTitle = wish ? t('addGame.wishTitle') : t('addGame.title');
  const back = wish ? () => showWishlist(round.id) : () => showRound(round.id, 'regal');
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(sheetTitle)}">
        <div class="sheet__head">
          <h2>${esc(sheetTitle)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="field">
          <label for="title">${esc(t('addGame.titleLabel'))}</label>
          <div class="lookup" id="lookup">
            <input id="title" class="input" placeholder="${esc(t('addGame.titlePlaceholder'))}" autocomplete="off" aria-describedby="dupHint" />
            <div class="lookup__menu" id="lookupMenu" hidden></div>
          </div>
          <div class="muted field__hint">${esc(t('addGame.searchHint'))}</div>
          <div class="field__hint field__hint--dup" id="dupHint" role="status" aria-live="polite" aria-atomic="true"></div>
        </div>
        ${canImportBgg() ? `<div class="toolbar" style="margin:-8px 0 18px">
          <button type="button" id="bggImportFromAdd" class="link-btn"><i class="ti ti-download" aria-hidden="true"></i> ${esc(wish ? t('bggImport.wishLink') : t('bggImport.link'))}</button>
        </div>` : ''}
        <div class="field">
          <label>${esc(t('addGame.playersLabel'))}</label>
          <div class="stepper-row">
            <div class="stepper" data-for="minPlayers">
              <button type="button" class="stepper__btn" data-d="-1" aria-label="−"><i class="ti ti-minus" aria-hidden="true"></i></button>
              <input id="minPlayers" class="stepper__val" inputmode="numeric" value="2" aria-label="${esc(t('addGame.minPlayersPlaceholder'))}" />
              <button type="button" class="stepper__btn" data-d="1" aria-label="+"><i class="ti ti-plus" aria-hidden="true"></i></button>
            </div>
            <span class="muted">–</span>
            <div class="stepper" data-for="maxPlayers">
              <button type="button" class="stepper__btn" data-d="-1" aria-label="−"><i class="ti ti-minus" aria-hidden="true"></i></button>
              <input id="maxPlayers" class="stepper__val" inputmode="numeric" value="4" aria-label="${esc(t('addGame.maxPlayersPlaceholder'))}" />
              <button type="button" class="stepper__btn" data-d="1" aria-label="+"><i class="ti ti-plus" aria-hidden="true"></i></button>
            </div>
            <span class="muted">${esc(t('addGame.playersUnit'))}</span>
          </div>
        </div>
        <div class="field">
          <label>${esc(t('addGame.tagsLabel'))}</label>
          <div class="filter-chips" id="tagSeg" hidden></div>
          <div class="toolbar" style="margin-top:6px">
            <input id="newTag" class="input" placeholder="${esc(t('tags.addPlaceholder'))}" style="flex:1" autocomplete="off" />
            <button type="button" id="addTagBtn" class="btn">${esc(t('tags.add'))}</button>
          </div>
        </div>
        <div class="field">
          <label>${esc(t('addGame.imageLabel'))}</label>
          <div id="pasteZone" class="paste-zone" tabindex="0">
            <div class="paste-zone__hint">
              <div class="paste-zone__icon"><i class="ti ti-photo" aria-hidden="true"></i></div>
              <div>${esc(t('addGame.pasteHint'))}</div>
              <div class="muted" style="font-size:14px">${esc(t('addGame.pasteSub'))}</div>
            </div>
            <img class="paste-zone__preview" alt="" hidden />
          </div>
          <div class="toolbar" style="margin-top:10px">
            <button type="button" id="pasteBtn" class="btn"><i class="ti ti-clipboard" aria-hidden="true"></i> ${esc(t('addGame.pasteBtn'))}</button>
            <button type="button" id="clearImg" class="btn btn--ghost" hidden>${esc(t('addGame.removeImage'))}</button>
          </div>
          <div id="coverPickerSlot"></div>
        </div>
        <div class="toolbar sheet__actions">
          <button id="save" class="btn btn--primary btn--lg"><i class="ti ti-plus" aria-hidden="true"></i> ${esc(t('addGame.save'))}</button>
          <button id="saveMore" class="btn btn--lg">${esc(t('addGame.saveMore'))}</button>
        </div>
      </div>
    </div>`);
  const form = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  // Games added via "Speichern & weiteres" keep the sheet open, so the Regal
  // behind it is only re-rendered when the sheet is finally dismissed. Track
  // whether any game was added while open and refresh on every close path.
  let addedWhileOpen = false;
  const dismiss = () => {
    closeSheet(addedWhileOpen ? back : undefined);
  };

  // Assigned below by attachLookup; the Escape handler asks it whether the
  // lookup menu is open (it can only fire long after that assignment).
  let lookup = null;
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    // The open lookup menu owns Escape (#542) — dismissing a dropdown must not
    // tear down the whole sheet and discard everything typed into it. This
    // handler is on document/capture, so it runs BEFORE the input's own keydown
    // listener and has to make the decision here rather than letting the lookup
    // stop the event; stopPropagation then keeps the two from both acting.
    if (lookup && lookup.isOpen()) {
      e.preventDefault();
      e.stopPropagation();
      lookup.closeMenu();
      return;
    }
    dismiss();
  };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) dismiss();
  });
  form.querySelector('.sheet__close').addEventListener('click', dismiss);

  // Switching to the bulk import replaces this sheet rather than stacking on it.
  // openSheet tears the old one down synchronously and reuses its history marker,
  // so Back still dismisses exactly one sheet — a leading closeSheet() here would
  // queue a pop that lands AFTER the import sheet opens and dismisses it
  // (.claude/rules/sheet-history-back-dismissal.md §2).
  const importFromAdd = form.querySelector('#bggImportFromAdd');
  if (importFromAdd) importFromAdd.addEventListener('click', () => showBggImport(round, wish ? 'wishlist' : 'own'));

  // Custom round tags (#238): toggle the round's existing tags onto the new
  // game, or create one inline (added to the round's tag list immediately; a
  // duplicate name reuses the existing tag — the server dedupes).
  const selectedTagIds = new Set();
  const roundTags = (round.tags || []).slice(); // local copy; never mutate the cached round
  const tagSeg = form.querySelector('#tagSeg');
  function renderTagChips() {
    tagSeg.hidden = roundTags.length === 0;
    tagSeg.replaceChildren(...roundTags.map((tg) => {
      const chip = h(`<button type="button" class="chip${selectedTagIds.has(tg.id) ? ' is-on' : ''}" aria-pressed="${selectedTagIds.has(tg.id)}"><i class="ti ${tagIconClass(tg.icon)}" aria-hidden="true"></i>${esc(tg.name)}</button>`);
      chip.addEventListener('click', () => {
        if (selectedTagIds.has(tg.id)) selectedTagIds.delete(tg.id);
        else selectedTagIds.add(tg.id);
        const on = selectedTagIds.has(tg.id);
        chip.classList.toggle('is-on', on);
        chip.setAttribute('aria-pressed', String(on));
      });
      return chip;
    }));
  }
  renderTagChips();
  const newTagInput = form.querySelector('#newTag');
  // Icon picker for the inline "create new tag" (#255). The trigger sits in the
  // new-tag toolbar so the row reads as one sub-form; the grid it expands opens
  // directly below it (#293).
  const tagPicker = tagIconPicker(null);
  newTagInput.after(tagPicker.trigger);
  newTagInput.closest('.toolbar').after(tagPicker.grid);
  const createTag = async () => {
    const name = newTagInput.value.trim();
    if (!name) return;
    try {
      const tag = await api('POST', `/api/rounds/${round.id}/tags`, { name, icon: tagPicker.get() });
      if (!roundTags.some((x) => x.id === tag.id)) roundTags.push(tag);
      selectedTagIds.add(tag.id);
      newTagInput.value = '';
      renderTagChips();
    } catch (e) { toast(e.message === 'quota_tags' ? t('tags.toast.quota') : e.message); }
  };
  form.querySelector('#addTagBtn').addEventListener('click', createTag);
  newTagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createTag(); }
  });

  // Player-count steppers: digits only, +/- clamp at 1.
  const minInput = form.querySelector('#minPlayers');
  const maxInput = form.querySelector('#maxPlayers');
  [minInput, maxInput].forEach((inp) => {
    inp.addEventListener('input', () => {
      const digits = inp.value.replace(/\D/g, '');
      if (inp.value !== digits) inp.value = digits;
    });
  });
  form.querySelectorAll('.stepper').forEach((st) => {
    const input = st.querySelector('.stepper__val');
    st.querySelectorAll('.stepper__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cur = parseInt(input.value, 10);
        const next = (Number.isInteger(cur) ? cur : 1) + parseInt(btn.dataset.d, 10);
        input.value = Math.max(1, next);
      });
    });
  });

  // --- Image via clipboard ---
  let pastedBlob = null;
  // A store suggestion can supply a cover URL and a source link; a manual paste
  // or a manual title edit clears them (see setImage / the lookup input handler).
  let chosenImageUrl = null;
  let chosenSource = null;
  // Which PRINTING the chosen cover is (#742) — set only when the URL came from
  // an edition tile, cleared by every other way the cover can change. Declared
  // beside chosenImageUrl for the same TDZ reason as coverPicker below: setImage
  // is hoisted and reads it.
  let chosenEdition = null;
  // Declared up here, not next to setCoverPicker below: setImage() reads it and
  // is a hoisted function declaration, so a `let` further down would be a TDZ
  // trap the moment anything called it earlier.
  let coverPicker = null;
  const pasteZone = form.querySelector('#pasteZone');
  const preview = form.querySelector('.paste-zone__preview');
  const clearBtn = form.querySelector('#clearImg');

  function setImage(blob) {
    if (preview.src && preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    chosenImageUrl = null; // a pasted/cleared image overrides a provider cover
    chosenEdition = null; // …and so is not any BGG printing (#742)
    if (coverPicker) coverPicker.setCurrent(null);
    pastedBlob = blob;
    if (blob) {
      preview.src = URL.createObjectURL(blob);
      preview.hidden = false;
      pasteZone.classList.add('has-image');
      clearBtn.hidden = false;
    } else {
      preview.removeAttribute('src');
      preview.hidden = true;
      pasteZone.classList.remove('has-image');
      clearBtn.hidden = true;
    }
  }

  // ⌘V anywhere on the page (the listener removes itself when the sheet closes).
  function onPaste(e) {
    if (!document.body.contains(pasteZone)) {
      document.removeEventListener('paste', onPaste);
      return;
    }
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const blob = it.getAsFile();
        if (blob) { setImage(blob); toast(t('addGame.toast.pasted')); e.preventDefault(); }
        return;
      }
    }
  }
  document.addEventListener('paste', onPaste);

  // Button: Clipboard API, reliable on click (also without a keyboard).
  form.querySelector('#pasteBtn').addEventListener('click', async () => {
    const blob = await readClipboardImage();
    if (blob) { setImage(blob); toast(t('addGame.toast.pasted')); }
  });

  clearBtn.addEventListener('click', () => setImage(null));
  pasteZone.addEventListener('click', () => pasteZone.focus());

  // Show a provider cover from its URL (no local blob yet — the server downloads
  // it on save). Cleared like any other image via the remove button.
  // `cover` is the picker's own object when the URL came from an edition tile
  // (#742), and absent for a provider's default art — so the edition is cleared
  // by default and set only where a printing was actually chosen. Routing it
  // through the one function that changes the cover is what keeps the two from
  // ever describing different boxes.
  function showProviderImage(url, cover) {
    if (preview.src && preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    pastedBlob = null;
    chosenImageUrl = url;
    chosenEdition = cover ? editionFromCover(cover) : null;
    preview.src = url;
    preview.hidden = false;
    pasteZone.classList.add('has-image');
    clearBtn.hidden = false;
    if (coverPicker) coverPicker.setCurrent(url);
  }

  // Edition covers (#519), offered once a BoardGameGeek suggestion has been
  // picked — it is the only provider with a per-edition image set.
  //
  // Rendered INLINE in this field, never as a second sheet: openSheet tears down
  // an already-open sheet synchronously, so a picker sheet opened from here
  // would destroy this form and everything typed into it
  // (.claude/rules/sheet-history-back-dismissal.md §2).
  const pickerSlot = form.querySelector('#coverPickerSlot');
  function setCoverPicker(source) {
    if (coverPicker) { coverPicker.remove(); coverPicker = null; }
    if (!source || source.provider !== 'bgg') return;
    coverPicker = editionCoverPicker(round.id, source.externalId, chosenImageUrl, (c) => {
      showProviderImage(c.imageUrl, c);
      toast(t('coverPicker.toast.picked'));
    });
    pickerSlot.appendChild(coverPicker);
  }

  // --- Search-as-you-type suggestions (PlayStation Store + BoardGameGeek + Steam) ---
  const titleInput = form.querySelector('#title');
  const menu = form.querySelector('#lookupMenu');

  // Duplicate-title hint (#524): advisory only — it never blocks saving, since a
  // second row is sometimes intended (two physical copies, a standalone edition).
  // Games added via "Speichern & weiteres" are tracked locally rather than pushed
  // into `round`, which is the caller's cached object and must not be mutated —
  // without them the hint would go blind in exactly the bulk-adding flow where
  // duplicates are most likely.
  // It is also the one announced live region outside toast() (#584): it is the
  // only signal that a duplicate is about to be created, so it has to reach a
  // screen reader too. That is why it is never `hidden` and never display:none
  // — a region revealed with its text already in place is NOT announced
  // (`.claude/rules/accessibility-contrast-and-modals.md` §4). It sits in the
  // tree permanently and empty; only its text changes, which is the mutation
  // aria-live listens for. `.is-on` carries the spacing, not the existence.
  const dupHint = form.querySelector('#dupHint');
  const addedGames = [];
  function refreshDupHint() {
    const state = existingTitleState((round.games || []).concat(addedGames), titleInput.value);
    // Clear the text when there is no duplicate, so re-typing the same title is
    // still a change the live region reports rather than a no-op mutation —
    // same reason toast() blanks itself on hide.
    dupHint.textContent = state ? t(`addGame.dupHint.${state}`) : '';
    dupHint.classList.toggle('is-on', !!state);
  }
  titleInput.addEventListener('input', refreshDupHint);

  // Fill the player controls from a provider detail object.
  function applyDetail(d) {
    if (Number.isInteger(d.minPlayers)) minInput.value = d.minPlayers;
    if (Number.isInteger(d.maxPlayers)) maxInput.value = d.maxPlayers;
    // A provider with a known min but an unknown (null) max — e.g. Steam for a
    // multiplayer title — would otherwise leave max at the form's default (4),
    // inventing a range the provider never claimed. Cap max at min instead; the
    // user can raise it before saving.
    else if (Number.isInteger(d.minPlayers)) maxInput.value = d.minPlayers;
  }

  async function pickSuggestion(r) {
    lookup.closeMenu();
    titleInput.value = r.title;
    // Assigning .value fires no input event, so the hint has to be nudged by
    // hand — and a lookup pick is the likeliest way to land on a game you
    // already own.
    refreshDupHint();
    chosenSource = { provider: r.provider, externalId: r.providerId, url: '' };
    // Offer this game's edition covers straight away (BGG only) — the grid
    // itself stays unfetched until the user expands it.
    setCoverPicker(chosenSource);
    // A store cover comes from the search thumbnail; a BGG cover arrives with the
    // detail call.
    if (r.thumbnail && !pastedBlob) showProviderImage(r.thumbnail);
    let d;
    try {
      d = await lookupDetail(round.id, r);
    } catch {
      toast(t('lookup.error'));
      return;
    }
    titleInput.value = pickedTitle(r, d) || titleInput.value;
    refreshDupHint();
    chosenSource.url = d.url || '';
    applyDetail(d);
    if (d.imageUrl && !pastedBlob) showProviderImage(d.imageUrl);
    toast(t('addGame.toast.filled', { provider: providerLabel(r.provider) }));
  }

  // A manual edit no longer matches the picked suggestion — so the edition
  // covers of the game that was picked no longer belong to what is being typed.
  lookup = attachLookup(round, titleInput, menu, pickSuggestion, () => {
    chosenSource = null;
    setCoverPicker(null);
  });

  async function save(again) {
    const title = form.querySelector('#title').value.trim();
    if (!title) return toast(t('addGame.toast.needTitle'));
    const minPlayers = parseInt(minInput.value, 10);
    const maxPlayers = parseInt(maxInput.value, 10);
    if (!Number.isInteger(minPlayers) || minPlayers < 1 || !Number.isInteger(maxPlayers) || maxPlayers < 1)
      return toast(t('addGame.toast.needPlayers'));
    if (maxPlayers < minPlayers) return toast(t('addGame.toast.playersRange'));
    const fd = new FormData();
    fd.append('title', title);
    fd.append('minPlayers', minPlayers);
    fd.append('maxPlayers', maxPlayers);
    selectedTagIds.forEach((x) => fd.append('tagIds', x));
    // Only sent when true: the route coerces anything unrecognised to false, so
    // an omitted field and 'false' mean the same thing, and omitting keeps the
    // ordinary add-game request byte-identical to what it has always been.
    if (wish) fd.append('wish', 'true');
    if (pastedBlob) {
      const ext = (pastedBlob.type && pastedBlob.type.split('/')[1]) || 'png';
      fd.append('image', pastedBlob, 'pasted.' + ext);
    } else if (chosenImageUrl) {
      fd.append('imageUrl', chosenImageUrl);
      // Only alongside the URL it belongs to, and only when a printing was
      // actually picked — the route stores the edition solely on the
      // provider-cover branch anyway, so sending it otherwise could not take
      // effect and would just be noise on the wire.
      if (chosenEdition) {
        fd.append('editionName', chosenEdition.name);
        if (chosenEdition.year != null) fd.append('editionYear', chosenEdition.year);
        // Repeated per value, like tagIds — multipart has no array form.
        chosenEdition.languages.forEach((l) => fd.append('editionLanguages', l));
      }
    }
    if (chosenSource) {
      fd.append('sourceProvider', chosenSource.provider);
      fd.append('sourceExternalId', chosenSource.externalId);
      if (chosenSource.url) fd.append('sourceUrl', chosenSource.url);
    }
    try {
      const created = await api('POST', `/api/rounds/${round.id}/games`, fd);
      addedGames.push({ title: (created && created.title) || title });
      toast(wish ? t('addGame.toast.savedWish') : t('addGame.toast.saved'));
      if (again) {
        // Keep the sheet open for the next game; the player range stays.
        // Mark dirty so dismissing the sheet re-renders the Regal (issue #34).
        addedWhileOpen = true;
        chosenSource = null;
        setCoverPicker(null);
        lookup.closeMenu();
        form.querySelector('#title').value = '';
        refreshDupHint();
        setImage(null);
        form.querySelector('#title').focus();
      } else {
        closeSheet(back);
      }
    } catch (e) { toast(e.message === 'quota_games' ? t('addGame.toast.quota') : e.message); }
  }
  form.querySelector('#save').addEventListener('click', () => save(false));
  form.querySelector('#saveMore').addEventListener('click', () => save(true));
  form.querySelector('#title').focus();
}

// =================== Link an existing game to a provider (issue #74) ===================

// Sheet for attaching a provider to a game that has no source yet: search the
// providers (prefilled with the game's title), pick a match, then choose which
// differing fields (name, cover, players) to overwrite. The source link is
// always saved; the field overrides default to "take everything".
function showLinkProvider(round, game) {
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t('linkProvider.title'))}">
        <div class="sheet__head">
          <h2>${esc(t('linkProvider.title'))}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="field">
          <label for="linkTitle">${esc(t('linkProvider.searchLabel'))}</label>
          <div class="lookup" id="lookup">
            <input id="linkTitle" class="input" placeholder="${esc(t('addGame.titlePlaceholder'))}" autocomplete="off" />
            <div class="lookup__menu" id="lookupMenu" hidden></div>
          </div>
          <div class="muted field__hint">${esc(t('linkProvider.searchHint'))}</div>
        </div>
        <div id="linkResult"></div>
      </div>
    </div>`);
  const form = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  // See showAddGame: an open lookup menu owns Escape, so it can be dismissed
  // without losing the sheet (#542).
  let lookup = null;
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (lookup && lookup.isOpen()) {
      e.preventDefault();
      e.stopPropagation();
      lookup.closeMenu();
      return;
    }
    closeSheet();
  };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  form.querySelector('.sheet__close').addEventListener('click', closeSheet);

  const input = form.querySelector('#linkTitle');
  const menu = form.querySelector('#lookupMenu');
  const resultBox = form.querySelector('#linkResult');
  input.value = game.title;

  // Wire the shared lookup; a manual edit clears the pending match panel.
  lookup = attachLookup(round, input, menu, pickSuggestion, () => { resultBox.innerHTML = ''; });
  // The title is already filled in, so search for it right away — setting
  // input.value above doesn't fire an 'input' event, so trigger it explicitly.
  lookup.search(game.title);

  async function pickSuggestion(r) {
    lookup.closeMenu();
    input.value = r.title;
    resultBox.innerHTML = `<div class="section muted">${esc(t('lookup.searching'))}</div>`;
    let d;
    try {
      d = await lookupDetail(round.id, r);
    } catch {
      resultBox.innerHTML = '';
      toast(t('lookup.error'));
      return;
    }
    renderMatch(r, d);
  }

  // Show the picked provider match and offer only the fields that actually
  // differ from the current game, each as a toggle chip (on = overwrite).
  function renderMatch(r, d) {
    const fields = [];
    // Cover: offer whenever the provider returns one — a remote URL can't be
    // compared to a local /uploads path, so always treat it as "differs".
    const coverUrl = providerMatchCover(r, d);
    if (coverUrl) fields.push({ key: 'image', label: t('linkProvider.field.image') });
    if ((Number.isInteger(d.minPlayers) && d.minPlayers !== game.minPlayers) ||
        (Number.isInteger(d.maxPlayers) && d.maxPlayers !== game.maxPlayers))
      fields.push({ key: 'players', label: t('linkProvider.field.players') });
    // Weight (#717, BGG only). The chip sends a
    // BOOLEAN: applyLink asks for the field and the server resolves the value
    // from the provider itself, so a client chooses whether to take the info but
    // never what it says. #724's metadata gets no chip (it is not a preview
    // anyone opts into) and #729's description no longer exists.
    if (d.weight != null && game.weight == null)
      fields.push({ key: 'weight', label: t('linkProvider.field.weight') });
    // Name: the add-game flow takes the provider title outright, so offer it
    // here too (issue #180). Show it first — the name is the most prominent
    // field — but only when it actually differs (trimmed, case-insensitive).
    const provTitle = pickedTitle(r, d).trim();
    if (provTitle && provTitle.toLowerCase() !== (game.title || '').trim().toLowerCase())
      fields.unshift({ key: 'title', label: t('linkProvider.field.title') });

    resultBox.innerHTML = '';
    const box = h('<div class="section"></div>');
    box.appendChild(h(`<div class="link-match"><strong>${esc(provTitle)}</strong> · ${esc(providerLabel(r.provider))}</div>`));

    let chips = null;
    if (fields.length) {
      box.appendChild(h(`<div class="muted field__hint" style="margin:10px 0 6px">${esc(t('linkProvider.overridePrompt'))}</div>`));
      // A wrapper holds every toggle (the cover block + the filter-chips row), so
      // isOn(chips, key) keeps finding each chip by [data-field] wherever it sits.
      chips = h('<div class="link-fields"></div>');
      const chipEl = (f) => {
        const chip = h(`<button type="button" class="chip is-on" data-field="${f.key}" aria-pressed="true"><i class="ti ti-check" aria-hidden="true"></i>${esc(f.label)}</button>`);
        chip.addEventListener('click', () => {
          chip.setAttribute('aria-pressed', String(chip.classList.toggle('is-on')));
        });
        return chip;
      };
      // Cover override: pair the "Titelbild" toggle with a preview of the exact
      // image it would apply, so the user isn't opting in blind (issue #179). The
      // remote provider URL renders because CSP img-src lists the provider hosts.
      const imageField = fields.find((f) => f.key === 'image');
      if (imageField) {
        const cover = h('<div class="link-cover"></div>');
        cover.appendChild(h(`<img class="link-cover__img" src="${esc(coverUrl)}" alt="" loading="lazy" />`));
        cover.appendChild(chipEl(imageField));
        chips.appendChild(cover);
      }
      // The players field: pair the toggle with a muted "current value → provider
      // value" line, so — like the cover preview above — the user sees exactly what
      // an on-toggle overwrites (issue #183). The "to" side is what the game
      // *becomes* (applyLink merges), so an absent provider sub-value falls back to
      // the game's own, not a blank.
      const notSet = t('linkProvider.notSet');
      const fieldChange = (key) => {
        if (key === 'players') {
          const toMin = Number.isInteger(d.minPlayers) ? d.minPlayers : game.minPlayers;
          const toMax = Number.isInteger(d.maxPlayers) ? d.maxPlayers : game.maxPlayers;
          return { from: playersText(game.minPlayers, game.maxPlayers) || notSet,
            to: playersText(toMin, toMax) || notSet };
        }
        // One decimal, like every weight display (#717).
        if (key === 'weight') return { from: notSet, to: t('gameInfo.weightValue', { n: d.weight.toFixed(1) }) };
        return null; // title: already shown in the header
      };
      const rest = fields.filter((f) => f.key !== 'image');
      if (rest.length) {
        const list = h('<div class="link-field-list"></div>');
        rest.forEach((f) => {
          const field = h('<div class="link-field"></div>');
          field.appendChild(chipEl(f));
          const change = fieldChange(f.key);
          if (change)
            field.appendChild(h(`<div class="link-field__change"><span>${esc(change.from)}</span> <span class="link-field__arrow" aria-hidden="true">→</span> <span class="link-field__to">${esc(change.to)}</span></div>`));
          list.appendChild(field);
        });
        chips.appendChild(list);
      }
      box.appendChild(chips);
    } else {
      box.appendChild(h(`<div class="muted field__hint" style="margin:10px 0">${esc(t('linkProvider.noDiff'))}</div>`));
    }

    const apply = h(`<div class="toolbar sheet__actions"><button class="btn btn--primary btn--lg"><i class="ti ti-link" aria-hidden="true"></i> ${esc(t('linkProvider.apply'))}</button></div>`);
    apply.querySelector('button').addEventListener('click', () => applyLink(r, d, chips));
    box.appendChild(apply);
    resultBox.appendChild(box);
  }

  function isOn(chips, key) {
    if (!chips) return false;
    const chip = chips.querySelector(`[data-field="${key}"]`);
    return !!chip && chip.classList.contains('is-on');
  }

  async function applyLink(r, d, chips) {
    const body = { sourceProvider: r.provider, sourceExternalId: r.providerId };
    if (d.url) body.sourceUrl = d.url;
    if (isOn(chips, 'title')) body.title = pickedTitle(r, d).trim();
    const coverUrl = providerMatchCover(r, d);
    if (isOn(chips, 'image') && coverUrl) body.imageUrl = coverUrl;
    if (isOn(chips, 'players')) {
      if (Number.isInteger(d.minPlayers)) body.minPlayers = d.minPlayers;
      if (Number.isInteger(d.maxPlayers)) body.maxPlayers = d.maxPlayers;
    }
    // A boolean, not a value — the server resolves the weight from the provider
    // (#717), so the sheet only ever says WHICH fields to take.
    if (isOn(chips, 'weight')) body.applyWeight = true;
    try {
      await api('PATCH', `/api/rounds/${round.id}/games/${game.id}`, body);
      toast(t('linkProvider.linked'));
      closeSheet(() => showGameDetail(round.id, game.id));
    } catch (e) { toast(e.message); }
  }

  input.focus();
  input.select();
}

// =================== Jetzt spielen (direct-pick session sheet) ===================

// Bottom sheet: pick who joins, then start a session for one specific game with
// no vote and no draw, landing straight on the results screen with that game
// already chosen. Opened from the game detail page and the Pokale cards.
function startDirectSession(round, game) {
  const label = t('directPlay.title', { title: game.title });
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
        <div class="sheet__head">
          <h2>${esc(label)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="field">
          <label>${esc(t('startSession.membersLabel'))}</label>
          <div id="seatMount"></div>
        </div>
        <div id="guestMount"></div>
        <div id="teamMount"></div>
        <div class="toolbar sheet__actions">
          <button id="startDirect" class="btn btn--primary btn--lg"><i class="ti ti-player-play" aria-hidden="true"></i> ${esc(t('directPlay.start'))}</button>
        </div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  const joining = new Set(round.members.map((m) => m.id));
  // Guests (#532). The field is always visible, like the setup screen's — the
  // sheet roughly doubles in height, which is the accepted price of the two ways
  // into a session looking the same. There is no voting phase here, so a guest
  // is a participation record and, above all, a pickable winner: the results
  // screen's winner chips come from sessionPeople(), members ∪ guests.
  // No pool preview to refresh either (direct-pick consults no player range),
  // so the only thing following the count is the table's centre.
  const guestPicker = renderGuestPicker(t('directPlay.guestsNote'), () => {
    seatTable.refreshSeats();
    teamPicker.refreshTeams();
  });
  // Teams (#575). Nothing here is filtered by a player range — direct-pick
  // consults none — so a team changes no pool: it is here so a team that wins
  // can be recorded in one tap, the same argument that brought guests to this
  // sheet in #532. Hence its own note, which promises no filtering.
  const teamPicker = renderTeamPicker(round, joining, guestPicker, t('directPlay.teamsNote'), null);
  const seatTable = renderSeatPicker(round, joining, () => teamPicker.refreshTeams(), () => guestPicker.guests.length);
  sheet.querySelector('#seatMount').replaceWith(seatTable);
  sheet.querySelector('#guestMount').replaceWith(guestPicker);
  sheet.querySelector('#teamMount').replaceWith(teamPicker);

  const dismiss = () => closeSheet();
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) dismiss();
  });
  sheet.querySelector('.sheet__close').addEventListener('click', dismiss);

  sheet.querySelector('#startDirect').addEventListener('click', async () => {
    if (joining.size === 0) return toast(t('startSession.toast.noMembers'));
    try {
      const data = await api('POST', `/api/rounds/${round.id}/sessions`, {
        gameId: game.id,
        memberIds: [...joining],
        guests: guestPicker.guests, // names only; the server mints the ids (#458)
        teams: teamPicker.teamPayload(), // guests by POSITION in `guests` (#575)
      });
      closeSheet(() => showResults(round, data.session, data.games));
    } catch (e) { toast(e.message); }
  });
}

/* ---------------------- BGG collection import (#481) ----------------------- */

// Whether a round can offer the one-shot BoardGameGeek collection import.
// Accounts only — the handle hangs off the account. The per-round provider gate
// this also used to consult went with #744; BGG is now always queryable, so the
// account is the whole condition, and the round no longer decides anything.
function canImportBgg() {
  return accountsActive();
}

// Import a linked BoardGameGeek collection into this round — the OWNED shelf
// into the Regal (`status: 'own'`, #481) or the WISHLIST into the Wunschliste
// (`status: 'wishlist'`, #560). One sheet for both: the two differ in the query
// parameter, the title and where they return to, and giving the second its own
// near-copy is how the picker, the five states and the cover choice would drift.
//
// The sheet opens immediately and fills in afterwards: a collection fetch is far
// heavier than a search (BGG may even queue it), so opening only once the answer
// is in would read as a dead button for several seconds.
async function showBggImport(round, status = 'own') {
  const wish = status === 'wishlist';
  const title = wish ? t('bggImport.wishTitle') : t('bggImport.title');
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog sheet--list" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__head">
          <h2>${esc(title)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="bgg-import"></div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  const body = backdrop.querySelector('.bgg-import');
  document.body.appendChild(backdrop);

  // Games added while the sheet was open are only visible once the Regal behind
  // it re-renders, so every close path has to refresh — and the navigation goes
  // THROUGH closeSheet, never on the line after it, or the queued history pop
  // races the push (.claude/rules/sheet-history-back-dismissal.md).
  // A wishlist import returns to the wish list, not to the Regal — the games it
  // just created are invisible on the shelf, so landing there would read as the
  // import having done nothing.
  let imported = false;
  const back = wish ? () => showWishlist(round.id) : () => showRound(round.id, 'regal');
  const dismiss = () => closeSheet(imported ? back : undefined);

  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  sheet.querySelector('.sheet__close').addEventListener('click', dismiss);

  // --- the states -----------------------------------------------------------

  const msg = (text, hint) => h(`<div class="bgg-import__msg">
      <p>${esc(text)}</p>${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
    </div>`);

  // Link (or correct) the BGG handle without leaving the sheet. The Konto screen
  // owns the same field, but sending a user there mid-import and expecting them
  // to come back is a flow nobody completes.
  function renderLinkForm(current, errorText) {
    body.replaceChildren();
    if (errorText) body.appendChild(msg(errorText));
    const form = h(`<form class="bgg-import__link">
        <div class="field">
          <label for="bggName">${esc(t('bggImport.handleLabel'))}</label>
          <input id="bggName" class="input" autocomplete="off" spellcheck="false" value="${esc(current || '')}" />
          <p class="field__hint muted">${esc(t('bggImport.handleHint'))}</p>
        </div>
        <div class="toolbar sheet__actions">
          <button class="btn btn--primary btn--lg" type="submit">${esc(t('bggImport.handleSave'))}</button>
        </div>
      </form>`);
    body.appendChild(form);
    const input = form.querySelector('#bggName');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      try {
        await accountApi('PATCH', '/me', { bggUsername: name });
      } catch (ex) {
        if (ex.message === 'auth') return; // accountApi already bounced a dead session
        return toast(ex.message === 'invalid_bgg_username' ? t('bggImport.toast.badHandle') : ex.message);
      }
      load();
    });
    input.focus();
  }

  // The candidate list, in two halves (#625). Everything importable is
  // preselected — the common case is "import my shelf" — and the games already
  // on the shelf follow in a collapsed section instead of sitting inert in the
  // middle of the one list the user is meant to act on. They are still SHOWN,
  // never dropped: the list is the user's own collection, and losing half of it
  // reads as the import having failed (.claude/rules/bgg-collection-import.md).
  function renderPicker(games) {
    const fresh = games.filter((g) => !g.present);
    const present = games.filter((g) => g.present);

    // A native <details>: focusable, Enter/Space-activated and toggled by the
    // platform, all of which a hand-rolled disclosure would have to
    // re-implement (.claude/rules/native-button-vs-focusable-span.md). Compact
    // and title-only — the heading carries the "already on the shelf" meaning,
    // so no per-row state label — and collapsed on load at every width.
    const presentSection = () => {
      const sec = h(`<details class="bgg-import__present">
          <summary class="bgg-import__present-head">${esc(t('bggImport.presentSection'))}</summary>
          <ul class="bgg-import__present-list"></ul>
        </details>`);
      const ul = sec.querySelector('.bgg-import__present-list');
      // NOT a .ds-row: these are not click targets, and that component promises
      // one through `cursor: pointer` + a hover lift
      // (.claude/rules/ds-row-is-a-click-target.md).
      present.forEach((g) => {
        ul.appendChild(h(`<li class="bgg-import__present-item" title="${esc(g.title)}">${esc(g.title)}</li>`));
      });
      return sec;
    };

    if (!fresh.length) {
      // The message already says everything the intro would, so it replaces it
      // rather than following a line reading "… 0 noch nicht im Regal".
      body.replaceChildren(msg(t('bggImport.allPresent')));
      body.appendChild(presentSection());
      return;
    }

    body.replaceChildren(h(`<p class="muted">${esc(tn(games.length, 'bggImport.introOne', 'bggImport.intro', { m: fresh.length }))}</p>`));

    const picker = h(`<div class="bgg-import__picker">
        <div class="move-list__head">
          <span class="bgg-import__count muted" aria-live="polite"></span>
          <button class="link-btn bgg-import__toggle" type="button"></button>
        </div>
        <div class="ds-list bgg-import__list" role="group" aria-label="${esc(t('bggImport.games'))}"></div>
      </div>`);
    const list = picker.querySelector('.bgg-import__list');
    // Per-game cover choices, keyed by external id, sent with the import (#519).
    // Only what the user actually changed goes on the wire; everything else
    // keeps the cover the collection itself reported.
    const chosenCovers = {};
    // …and which printing each of those covers is (#742), same keying.
    const chosenEditions = {};
    // NOT wrapped in a .field: `.field label` beats `.ds-row` on specificity and
    // silently flattens every row (.claude/rules/label-rows-lose-to-field-label.md).
    fresh.forEach((g) => {
      const players = g.minPlayers
        ? t('bggImport.players', { min: g.minPlayers, max: g.maxPlayers || g.minPlayers })
        : '';
      // A wishlist candidate may be an EXPANSION (#664), which is not a game the
      // round would ever play — it lands on its base game's row on acquisition.
      // Say so here, and say which game, or the picker offers "Seefahrer" beside
      // "Catan" as if the two were the same kind of thing. A parent already on
      // the shelf is named by the round's own title (#705); these candidates are
      // BGG by construction, so the provider is not read off the row.
      const expansionNote = !g.expansion ? ''
        : (g.expansionOf || []).length
          ? t('bggImport.expansionOf', { titles: expansionParentTitles(g.expansionOf, 'bgg', round.games).join(', ') })
          : t('bggImport.expansionUnknown');
      const meta = [players, expansionNote].filter(Boolean).join(' · ');
      // The row is a <label> so the whole line toggles its checkbox — which is
      // exactly why the thumbnail and the cover picker are SIBLINGS of it rather
      // than children: a click inside the label would otherwise (un)select the
      // game every time the user reached for a cover.
      const item = h(`<div class="bgg-import__item">
          <div class="bgg-import__lead">
            <span class="bgg-import__thumb">${coverPlaceholder({ image: g.imageUrl, title: g.title })}</span>
            <label class="ds-row bgg-import__row">
              <div class="ds-row__main">
                <span class="bgg-import__name" title="${esc(g.title)}">${esc(g.title)}</span>
                ${meta ? `<span class="muted bgg-import__state">${esc(meta)}</span>` : ''}
              </div>
              <div class="ds-row__meta">
                <input type="checkbox" class="provider-row__box" value="${esc(g.externalId)}" checked />
              </div>
            </label>
          </div>
        </div>`);
      const thumb = item.querySelector('.bgg-import__thumb');
      const paintThumb = (url) => {
        thumb.style.backgroundImage = url ? `url('${url}')` : '';
        thumb.classList.toggle('has-image', !!url);
      };
      paintThumb(g.imageUrl);

      item.appendChild(editionCoverPicker(round.id, g.externalId, g.imageUrl, (c) => {
        chosenCovers[g.externalId] = c.imageUrl;
        // The printing that cover belongs to (#742), kept beside it so the
        // imported row can be labelled — and priced — as the box the user chose.
        chosenEditions[g.externalId] = editionFromCover(c);
        paintThumb(c.imageUrl);
      }));
      list.appendChild(item);
    });

    const go = h(`<div class="toolbar sheet__actions">
        <button class="btn btn--primary btn--lg bgg-import__go"><i class="ti ti-download" aria-hidden="true"></i> ${esc(t('bggImport.submit'))}</button>
      </div>`);
    body.appendChild(picker);
    // Before the actions bar, which is `position: sticky; bottom: 0` — anything
    // after it scrolls underneath its opaque background.
    if (present.length) body.appendChild(presentSection());
    body.appendChild(go);

    const boxes = [...list.querySelectorAll('input')];
    const countEl = picker.querySelector('.bgg-import__count');
    const toggle = picker.querySelector('.bgg-import__toggle');
    const submit = go.querySelector('.bgg-import__go');
    const picked = () => boxes.filter((b) => b.checked).map((b) => b.value);

    const sync = () => {
      const n = picked().length;
      countEl.textContent = tn(n, 'bggImport.selectedOne', 'bggImport.selected');
      toggle.textContent = n === boxes.length ? t('moveGames.selectNone') : t('moveGames.selectAll');
      submit.disabled = n === 0;
    };
    boxes.forEach((b) => b.addEventListener('change', sync));
    toggle.addEventListener('click', () => {
      const all = picked().length === boxes.length;
      boxes.forEach((b) => { b.checked = !all; });
      sync();
    });
    sync();

    submit.addEventListener('click', async () => {
      const ids = picked();
      if (!ids.length) return;
      submit.disabled = true;
      try {
        // Only the covers of games actually being imported ride along — a
        // choice made and then deselected must not reach the server.
        const covers = {};
        const editions = {};
        ids.forEach((id) => {
          if (!chosenCovers[id]) return;
          covers[id] = chosenCovers[id];
          // Only beside its own cover: the server stores an edition solely when
          // the picked URL survives the host allowlist, so an edition without one
          // could never apply.
          if (chosenEditions[id]) editions[id] = chosenEditions[id];
        });
        const res = await api('POST', `/api/rounds/${round.id}/lookup/import?provider=bgg&status=${status}`, { externalIds: ids, covers, editions });
        imported = imported || res.imported > 0;
        toast(tn(res.imported, 'bggImport.toast.doneOne', 'bggImport.toast.done'));
        dismiss();
      } catch (e) {
        submit.disabled = false;
        toast(bggImportError(e.message));
      }
    });
  }

  // --- load -----------------------------------------------------------------

  async function load() {
    body.replaceChildren(h(`<p class="muted">${esc(t('bggImport.loading'))}</p>`));
    let res;
    try {
      res = await api('GET', `/api/rounds/${round.id}/lookup/collection?provider=bgg&status=${status}`);
    } catch (e) {
      body.replaceChildren(msg(bggImportError(e.message)));
      return;
    }
    if (res.state === 'no_username') return renderLinkForm('', null);
    if (res.state === 'invalid_user') return renderLinkForm('', t('bggImport.unknownUser'));
    if (res.state === 'queued') {
      body.replaceChildren(msg(t('bggImport.queued'), t('bggImport.queuedHint')));
      const retry = h(`<div class="toolbar sheet__actions"><button class="btn btn--primary btn--lg">${esc(t('bggImport.retry'))}</button></div>`);
      retry.querySelector('button').addEventListener('click', () => load());
      body.appendChild(retry);
      return;
    }
    if (!res.games.length) {
      // The empty state has to name the shelf it looked at, or "nothing marked
      // as owned" is simply wrong advice for someone whose wishlist is empty.
      body.replaceChildren(wish
        ? msg(t('bggImport.wishEmpty'), t('bggImport.wishEmptyHint'))
        : msg(t('bggImport.empty'), t('bggImport.emptyHint')));
      return;
    }
    renderPicker(res.games);
  }

  load();
}

// Map the import's server error codes to localized text. Anything unrecognised
// falls through as-is, matching how the other sheets surface a raw message.
function bggImportError(code) {
  const known = {
    quota_games: 'bggImport.toast.quota',
    provider_unreachable: 'bggImport.toast.unreachable',
    no_bgg_username: 'bggImport.toast.noHandle',
    queued: 'bggImport.queued',
    invalid_user: 'bggImport.unknownUser',
  }[code];
  return known ? t(known) : code;
}
