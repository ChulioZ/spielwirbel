/* Spielwirbel – views: a round's game detail screen, the design/background
   picker (THEMES) and the shared sheet open/close helpers. Loaded after
   views-round.js; shares one global script scope. */

// Coordinated designs: light background + matching accent color. The first is
// the default (warm cream + orange). Labels are translation keys. Accents are
// kept soft and slightly muted so they sit well next to the member colors,
// the gold family and the neutral surfaces.
const THEMES = [
  { labelKey: 'theme.standard', page: '#f4f1ea', accent: '#c2410c', std: true },
  { labelKey: 'theme.blaugrau', page: '#eef2f7', accent: '#3a67b1' },
  { labelKey: 'theme.salbei', page: '#eaf1ea', accent: '#397a4b' },
  { labelKey: 'theme.rose', page: '#f6ecf1', accent: '#b23a72' },
  { labelKey: 'theme.lavendel', page: '#efedf8', accent: '#6d55c4' },
  // Sand and Pfirsich were darkened for contrast (#145): the accent is not just
  // a fill, it is also link/breadcrumb TEXT on the page (`--brand`), and at
  // #a2701d / #c95633 those two sat at 3.8:1 — so picking either theme put every
  // link in the app below AA. Both now clear 4.5:1 on their own page and on
  // white. Any new theme has to clear both; test/a11y-contrast.test.js checks it.
  { labelKey: 'theme.sand', page: '#f6efe2', accent: '#91641a' },
  { labelKey: 'theme.schiefer', page: '#e9eef3', accent: '#33688f' },
  { labelKey: 'theme.pfirsich', page: '#f8ede6', accent: '#b34d2e' },
];

async function showBackground(rid) {
  currentView = () => showBackground(rid);
  syncUrl(roundPath(rid, 'design'));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  setContext(round.name);
  setDocTitle(t('round.design'), round.name);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'design');
  app.appendChild(backRow(() => showRound(rid)));
  app.appendChild(h(`<div class="page-head"><h1>${esc(t('design.title'))}</h1></div>`));

  const sec = h(`<div class="section"><h2>${esc(t('design.scheme'))}</h2></div>`);
  sec.appendChild(
    h(`<div class="muted" style="margin-bottom:14px">${esc(t('design.note'))}</div>`)
  );

  const bg = round.background;
  const currentPage = bg && bg.type === 'theme' ? (bg.page || '').toLowerCase() : null;

  // Theme cards: each is a tiny live preview of the palette — page background,
  // an accent "button", a text line and the accent dot.
  const swatches = h('<div class="theme-cards"></div>');
  THEMES.forEach((th) => {
    const active = th.std ? !currentPage : currentPage === th.page.toLowerCase();
    const sw = h(`<button class="theme-card${active ? ' is-active' : ''}" aria-pressed="${active}" style="background:${th.page}" title="${esc(t(th.labelKey))}">
         <span class="theme-card__bar" style="background:${th.accent}"></span>
         <span class="theme-card__line"></span>
         <span class="theme-card__line theme-card__line--short"></span>
         <span class="theme-card__name" style="color:${th.accent}">${esc(t(th.labelKey))}</span>
         <span class="theme-card__check" style="background:${th.accent}"><i class="ti ti-check" aria-hidden="true"></i></span>
       </button>`);
    sw.addEventListener('click', async () => {
      const payload = th.std
        ? { type: 'none' }
        : { type: 'theme', page: th.page, accent: th.accent };
      try {
        const saved = await api('POST', `/api/rounds/${rid}/background`, payload);
        applyBackground(saved.background);
        swatches.querySelectorAll('.theme-card').forEach((el) => {
          el.classList.remove('is-active');
          el.setAttribute('aria-pressed', 'false');
        });
        sw.classList.add('is-active');
        sw.setAttribute('aria-pressed', 'true');
        toast(t('design.toast.set'));
      } catch (e) { toast(e.message); }
    });
    swatches.appendChild(sw);
  });
  sec.appendChild(swatches);
  app.appendChild(sec);
}

// =================== Tags (custom round tags, #238) ===================

// Manage the round's tag list: create (deduped server-side) and delete (which
// silently unassigns the tag from every game). Assignment to games happens in
// the add-game sheet and the game detail's tag popover, not here.
async function showTags(rid) {
  currentView = () => showTags(rid);
  syncUrl(roundPath(rid, 'tags'));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  setContext(round.name);
  setDocTitle(t('tags.title'), round.name);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'tags');
  app.appendChild(backRow(() => showRound(rid)));
  app.appendChild(h(`<div class="page-head"><h1>${esc(t('tags.title'))}</h1></div>`));

  const sec = h('<div class="section"></div>');
  sec.appendChild(h(`<div class="muted" style="margin-bottom:14px">${esc(t('tags.note'))}</div>`));

  const addRow = h(`<div class="toolbar" style="margin-bottom:14px">
       <input class="input" style="flex:1" maxlength="30" placeholder="${esc(t('tags.addPlaceholder'))}"
              aria-label="${esc(t('tags.addPlaceholder'))}" />
       <button class="btn btn--primary"><i class="ti ti-plus" aria-hidden="true"></i> ${esc(t('tags.add'))}</button>
     </div>`);
  const input = addRow.querySelector('input');
  // Icon picker for the new tag (#255). The trigger sits inline in the name row
  // so it reads as one sub-form (#293); the grid it expands still gets the full
  // width on its own line below.
  const picker = tagIconPicker(null);
  input.after(picker.trigger);
  // A duplicate name returns the existing tag (the server dedupes) — detected
  // here by its id already being known, for the right toast.
  const existingIds = new Set((round.tags || []).map((tg) => tg.id));
  const add = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      const tag = await api('POST', `/api/rounds/${rid}/tags`, { name, icon: picker.get() });
      toast(existingIds.has(tag.id) ? t('tags.toast.exists') : t('tags.toast.added'));
      showTags(rid);
    } catch (e) { toast(e.message === 'quota_tags' ? t('tags.toast.quota') : e.message); }
  };
  // Select the submit button explicitly: the icon-picker trigger (#293) is also
  // a <button> and sits earlier in the row, so a bare `querySelector('button')`
  // would silently bind "add" to the trigger and leave Hinzufügen inert.
  addRow.querySelector('.btn--primary').addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });
  sec.appendChild(addRow);
  sec.appendChild(picker.grid);

  const tags = round.tags || [];
  if (tags.length === 0) {
    sec.appendChild(h(`<div class="empty"><p>${esc(t('tags.empty'))}</p></div>`));
  } else {
    const list = h('<div class="ds-list ds-list--tiles"></div>');
    tags.forEach((tg) => {
      const n = round.games.filter((g) => (g.tagIds || []).includes(tg.id)).length;
      const row = h(`<div class="ds-row ds-row--static tag-row">
           <div class="ds-row__main"><span class="tag tag--custom"><i class="ti ${tagIconClass(tg.icon)}" aria-hidden="true"></i>${esc(tg.name)}</span></div>
           <div class="ds-row__meta"><span class="muted tag-row__count">${esc(tn(n, 'tags.gamesOne', 'tags.games'))}</span></div>
         </div>`);
      // Change an existing tag's icon (#255) — the Tags screen is the only
      // surface that edits a tag; the popover and add-game sheet only create
      // and assign. Expands the picker inline rather than opening a dialog.
      const edit = h(`<button class="tag-act" aria-label="${esc(t('tags.editIcon'))}" title="${esc(t('tags.editIcon'))}"><i class="ti ti-pencil" aria-hidden="true"></i></button>`);
      edit.addEventListener('click', () => {
        const open = row.nextElementSibling;
        if (open && open.classList.contains('icon-picker')) { // second click closes it
          open.remove();
          return;
        }
        // Expanded: the pencil button IS the disclosure here (#293), so the
        // picker must not add a second one inside it.
        const p = tagIconPicker(tg.icon, { expanded: true });
        p.grid.querySelectorAll('.icon-picker__btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            try {
              await api('PATCH', `/api/rounds/${rid}/tags/${tg.id}`, { icon: btn.dataset.icon });
              toast(t('tags.toast.iconUpdated'));
              showTags(rid);
            } catch (e) { toast(e.message); }
          });
        });
        row.after(p.grid);
      });
      row.querySelector('.ds-row__meta').appendChild(edit);
      const del = h(`<button class="tag-act tag-act--danger" aria-label="${esc(t('tags.delete'))}"><i class="ti ti-trash" aria-hidden="true"></i></button>`);
      del.addEventListener('click', async () => {
        if (n > 0 && !confirm(t('tags.deleteConfirm', { name: tg.name }))) return;
        try {
          await api('DELETE', `/api/rounds/${rid}/tags/${tg.id}`);
          toast(t('tags.toast.deleted'));
          showTags(rid);
        } catch (e) { toast(e.message); }
      });
      row.querySelector('.ds-row__meta').appendChild(del);
      list.appendChild(row);
    });
    sec.appendChild(list);
  }
  app.appendChild(sec);
}

// The three game-detail editors (tags, players, cover) have ONE builder each
// and two presentations (#422): an anchored popover from 860px up, a bottom
// sheet below it. The anchored form is unusable on a phone — focusing its input
// makes the browser scroll the page to reveal it, and `openPopover`'s own
// page-scroll teardown then closes the popover out from under the keyboard, so
// there was no way to tag a game from a phone at all.
//
// 860px is the existing dock/strip breakpoint (.claude/rules/responsive-hub-tabs.md),
// deliberately reused rather than a new number. `build(container, close)` is
// presentation-agnostic and may return a callback to run once the container is
// live — see openPopover in core.js.
const EDITOR_SHEET_BELOW = 860;
function usesEditorSheet() {
  return !window.matchMedia(`(min-width: ${EDITOR_SHEET_BELOW}px)`).matches;
}
function openEditor(anchor, variant, title, build) {
  if (!usesEditorSheet()) {
    return openPopover(anchor, (el, close) => {
      el.classList.add('popover--' + variant);
      return build(el, close);
    });
  }
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__head">
          <h2>${esc(title)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="editor editor--${esc(variant)}"></div>
      </div>
    </div>`);
  const body = backdrop.querySelector('.editor');
  // None of the three navigates on success — they PATCH and re-render in place —
  // so a plain closeSheet() is right; no closeSheet(next) deferral is needed
  // (.claude/rules/sheet-history-back-dismissal.md).
  const attached = build(body, () => closeSheet());
  document.body.appendChild(backdrop);
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  // Must go through openSheet for the focus trap (#145) and Back-dismissal
  // (#333) — never assign activeSheet directly.
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  backdrop.querySelector('.sheet__close').addEventListener('click', () => closeSheet());
  // After openSheet, not before: trapFocus captures document.activeElement as
  // the restore target, so focusing first would "restore" focus into the sheet
  // itself. iOS only raises the keyboard for a focus() inside the user gesture,
  // and this whole path is synchronous from the button's click handler.
  if (typeof attached === 'function') attached();
  return { el: body, close: () => closeSheet() };
}

// =================== Game detail ===================

// How old a stored fallback price is, phrased for the reader (#688).
//
// Two deliberate roundings, both in the same direction — the label may overstate
// the age, never understate it, because understating it is the § 5a UWG problem
// this line exists to avoid:
//
//  - anything under an hour reads as "1 hour". A fallback served minutes after a
//    restart is genuinely fresh, but "0 hours" invites the reader to treat it as
//    live, and the clock doing the arithmetic is the reader's own.
//  - past a day the unit changes and the remainder is dropped downward, so 47
//    hours is "1 day" rather than "2".
function priceAge(iso, now = Date.now()) {
  const hours = Math.floor((now - new Date(iso).getTime()) / 3600000);
  if (hours < 24) return tn(Math.max(1, hours), 'price.staleHour', 'price.staleHours');
  return tn(Math.floor(hours / 24), 'price.staleDay', 'price.staleDays');
}

// The price box for a wished-for game (#679), from GET …/games/:gid/prices.
//
// A top-level function rather than a closure inside showGameDetail so a spec can
// render it straight from a payload (.claude/rules/testing-views-under-jsdom.md);
// it needs nothing from the view but the answer.
//
// Three things here are legal requirements rather than presentation choices, and
// each is invisible if it silently stops happening:
//
//  - `shippingKnown: false` means the amount is the product price ALONE. It is
//    never labelled as a total — PAngV § 3/§ 6 wants the total including VAT and
//    the concrete shipping cost, so an offer that cannot state shipping says
//    "plus shipping" instead of pretending.
//  - The retrieval time and the "may have changed" note are what keep an
//    hour-old price from reading as a live one. Nothing in CI can detect an
//    upstream that stopped updating; this line is the whole mitigation.
//  - The source line names where the data comes from AND that the aggregator
//    lists participating shops only. Withholding that about a price comparison
//    is a § 5a UWG omission (BGH I ZR 55/16) — it is not a footnote we may drop
//    to tidy the layout.
//  - A `stale: true` payload is a STORED price (#688) served while the source is
//    out, so its age leads instead of sitting in the footnote below.
//
// `refreshing` (#707) marks the transient stored render while the live lookup is
// still in flight: the age line stays (the legal half — the price on screen IS
// days old), but the staleWhy line would claim the service is unreachable, which
// is not yet known — so a "checking the current price" note stands in for it.
function renderPriceSection(p, { refreshing = false } = {}) {
  const sec = h(`<div class="section gd-price"><h2>${esc(t('price.title'))}</h2></div>`);
  const amount = h(`<div class="gd-price__amount">${esc(fmtMoney(p.amount, p.currency))}</div>`);
  sec.appendChild(amount);

  // A stored last-known price (#688). The age moves OUT of the footnote and
  // directly under the amount: the quiet „Abgerufen am …" line is right for an
  // hour-old price and wrong for a three-day-old one, and a stale price
  // presented as current is a misleading omission rather than a rough edge.
  // The footnote stays as well — it carries the exact timestamp this summarises.
  if (p.stale) {
    sec.appendChild(h(`<div class="gd-price__stale">${esc(priceAge(p.fetchedAt))}</div>`));
    if (refreshing) {
      sec.appendChild(h(`<div class="muted gd-price__checking">${esc(t('price.checking'))}</div>`));
    } else {
      sec.appendChild(h(`<div class="muted gd-price__stale-why">${esc(t('price.staleWhy'))}</div>`));
    }
  }

  const facts = [];
  facts.push(t(p.shippingKnown ? 'price.inclShipping' : 'price.plusShipping'));
  if (p.discountPercent > 0) {
    facts.push(t('price.discount', { regular: fmtMoney(p.regular, p.currency), percent: p.discountPercent }));
  }
  // Whose shop it is. `destination` is "ships to here", not "the shop is here",
  // so a DE query legitimately returns AT, CH and GR shops — naming the country
  // is what stops one of those reading as a local offer.
  if (p.country) facts.push(t('price.shopIn', { country: p.country }));
  if (p.edition && p.edition.title) {
    facts.push(t('price.edition', { title: p.edition.title, lang: p.edition.lang || '?' }));
  }
  if (typeof p.offerCount === 'number') {
    facts.push(t('price.offers', { inStock: p.inStockCount, total: p.offerCount }));
  }
  sec.appendChild(h(`<div class="muted gd-price__facts">${esc(facts.join(' · '))}</div>`));

  if (p.url) {
    const label = t('price.viewOffers');
    sec.appendChild(h(`<a class="link-out" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-external-link" aria-hidden="true"></i> ${esc(label)}</a>`));
  }

  const disclosure = t('price.sourceBgp');
  sec.appendChild(h(`<div class="muted gd-price__note">${esc(t('price.retrieved', { when: fmtDateTime(p.fetchedAt) }))} · ${esc(t('price.mayChange'))}<br>${esc(disclosure)}</div>`));
  return sec;
}

// A settled "no offers" answer (#707): the lookup succeeded and nobody stocks
// the game. Rendered as a transparent note rather than nothing — an empty slot
// after a stored price was on screen would read as the price feature breaking.
// The disclosure is still owed, because the statement derives from the
// aggregator. It took the game's own provider until #744 left one price source;
// the parameter is gone with the branch it fed.
function renderPriceNoOffers() {
  const sec = h(`<div class="section gd-price gd-price--none"><h2>${esc(t('price.title'))}</h2></div>`);
  sec.appendChild(h(`<div class="muted gd-price__none">${esc(t('price.noOffers'))}</div>`));
  const disclosure = t('price.sourceBgp');
  sec.appendChild(h(`<div class="muted gd-price__note">${esc(disclosure)}</div>`));
  return sec;
}

async function showGameDetail(rid, gameId) {
  currentView = () => showGameDetail(rid, gameId);
  syncUrl(gamePath(rid, gameId));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  const game = round.games.find((g) => g.id === gameId);
  if (!game) return showRound(rid);
  setContext(round.name);
  setDocTitle(game.title, round.name);

  const st = gameStats(round, gameId);
  const imgStyle = game.image ? `style="background-image:url('${coverUrl(game.image, COVER_HERO)}')"` : '';
  const fallback = coverPlaceholder(game);
  app.innerHTML = '';
  renderSubScreenTabs(round, 'game');
  // The fallback destination is derived from the GAME's state, not from an
  // origin argument (#663). Real history still wins — backRow feeds navBack —
  // so this is the deep-link case, and a page reached by URL has no origin to
  // pass: a game belongs to whichever screen lists it, whether it was opened
  // from a shared link, a session results row or the Pokale cards.
  app.appendChild(backRow(() => {
    if (game.retired) return showRetired(rid);
    if (game.completed) return showCompleted(rid);
    if (game.wish) return showWishlist(rid);
    return showRound(rid, 'regal');
  }));

  // Send a partial update, then re-render the page from fresh data.
  async function updateGame(updates) {
    const { imageBlob, removeImage, ...fields } = updates;
    let body;
    if (imageBlob || removeImage) {
      // Image involved → multipart. Scalar fields ride along as form fields.
      body = new FormData();
      Object.entries(fields).forEach(([k, v]) => body.append(k, v));
      if (imageBlob) {
        const ext = (imageBlob.type && imageBlob.type.split('/')[1]) || 'png';
        body.append('image', imageBlob, 'cover.' + ext);
      }
      if (removeImage) body.append('removeImage', 'true');
    } else {
      body = fields;
    }
    try {
      await api('PATCH', `/api/rounds/${rid}/games/${gameId}`, body);
      toast(t('detail.saved'));
      showGameDetail(rid, gameId);
    } catch (e) {
      toast(e.message);
    }
  }

  // A tag chip that opens an editor (#424). A real <button>, not a span with a
  // click handler: Tab reaches it, Enter *and* Space activate it, and closing
  // the editor restores focus to it — all from the platform, which is the
  // direction .claude/rules/in-app-nav-links.md took for links. Safe to do here
  // because a chip is already an atomic inline-block/inline-flex pill, so
  // becoming a button changes none of its layout. The single chokepoint for all
  // four chip variants (players/tags × filled/empty).
  function editableTag(cls, inner, onOpen) {
    const el = h(`<button type="button" class="tag tag--edit ${cls}" title="${esc(t('detail.editHint'))}">${inner}</button>`);
    el.addEventListener('click', () => onOpen(el));
    return el;
  }

  // Activate the title → inline input; Enter/blur saves, Escape cancels.
  function startTitleEdit(spanEl) {
    const input = h('<input class="input gd-title-input" />');
    input.value = game.title;
    spanEl.replaceWith(input);
    input.focus();
    input.select();
    let handled = false;
    const commit = () => {
      if (handled) return;
      handled = true;
      const val = input.value.trim();
      if (!val || val === game.title) {
        input.replaceWith(spanEl); // nothing changed
        return;
      }
      updateGame({ title: val });
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      // Escape puts the trigger back, so put focus back on it too — otherwise a
      // keyboard user who cancels is dropped to <body> and restarts from the top
      // of the document. Removing the focused input fires no blur, and `handled`
      // keeps commit() out of it either way.
      else if (e.key === 'Escape') { handled = true; input.replaceWith(spanEl); spanEl.focus(); }
    });
  }

  // Min–max player inputs, as a popover or a sheet (see openEditor).
  function openPlayersPopover(anchor) {
    openEditor(anchor, 'players', t('detail.onboard.players'), (el, close) => {
      const min = h('<input class="input" inputmode="numeric" />');
      const max = h('<input class="input" inputmode="numeric" />');
      if (Number.isInteger(game.minPlayers)) min.value = game.minPlayers;
      if (Number.isInteger(game.maxPlayers)) max.value = game.maxPlayers;
      [min, max].forEach((inp) => inp.addEventListener('input', () => {
        const digits = inp.value.replace(/\D/g, '');
        if (inp.value !== digits) inp.value = digits;
      }));
      const okBtn = h(`<button class="btn btn--primary">${esc(t('common.ok'))}</button>`);
      const save = () => {
        const mn = parseInt(min.value, 10);
        const mx = parseInt(max.value, 10);
        if (!Number.isInteger(mn) || mn < 1 || !Number.isInteger(mx) || mx < 1)
          return toast(t('addGame.toast.needPlayers'));
        if (mx < mn) return toast(t('addGame.toast.playersRange'));
        close();
        updateGame({ minPlayers: mn, maxPlayers: mx });
      };
      okBtn.addEventListener('click', save);
      [min, max].forEach((inp) => inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
      }));
      const row = h('<div class="pp-row"></div>');
      row.appendChild(min);
      row.appendChild(h('<span>–</span>'));
      row.appendChild(max);
      row.appendChild(okBtn);
      el.appendChild(row);
      return () => { min.focus(); min.select(); };
    });
  }

  // Edit the game's custom-tag assignment (#238): toggle the round's tags,
  // create a new one inline, then OK applies the whole selection at once (like
  // the players popover — one PATCH, one re-render).
  function openTagsPopover(anchor) {
    openEditor(anchor, 'tags', t('detail.onboard.tags'), (el, close) => {
      const selected = new Set(game.tagIds || []);
      const tags = (round.tags || []).slice(); // local copy; never mutate the cached round
      const chipsWrap = h('<div class="filter-chips"></div>');
      const renderChips = () => {
        chipsWrap.replaceChildren(...tags.map((tg) => {
          const chip = h(`<button type="button" class="chip${selected.has(tg.id) ? ' is-on' : ''}"><i class="ti ${tagIconClass(tg.icon)}" aria-hidden="true"></i>${esc(tg.name)}</button>`);
          chip.addEventListener('click', () => {
            if (selected.has(tg.id)) selected.delete(tg.id);
            else selected.add(tg.id);
            chip.classList.toggle('is-on', selected.has(tg.id));
          });
          return chip;
        }));
        chipsWrap.hidden = tags.length === 0;
      };
      renderChips();
      el.appendChild(chipsWrap);

      const input = h(`<input class="input" maxlength="30" placeholder="${esc(t('tags.addPlaceholder'))}" />`);
      const addBtn = h(`<button class="btn">${esc(t('tags.add'))}</button>`);
      // Icon picker for the inline "create new tag" (#255). The trigger joins
      // the input row and the grid opens below it (#293) — an always-open grid
      // used to push the chips and the input out of this popover entirely.
      const picker = tagIconPicker(null);
      // Returns false only when a real creation attempt failed, so the OK
      // handler below can keep the popover open instead of discarding the
      // typed name (an empty input is a no-op, not a failure).
      const create = async () => {
        const name = input.value.trim();
        if (!name) return true;
        try {
          const tag = await api('POST', `/api/rounds/${rid}/tags`, { name, icon: picker.get() });
          if (!tags.some((x) => x.id === tag.id)) tags.push(tag);
          selected.add(tag.id);
          input.value = '';
          renderChips();
          return true;
        } catch (e) {
          toast(e.message === 'quota_tags' ? t('tags.toast.quota') : e.message);
          return false;
        }
      };
      addBtn.addEventListener('click', create);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); create(); }
      });
      const okBtn = h(`<button class="btn btn--primary">${esc(t('common.ok'))}</button>`);
      // OK commits unsubmitted input first (#249): typing a name and hitting OK
      // without clicking Hinzufügen used to discard it silently.
      okBtn.addEventListener('click', async () => {
        if (!await create()) return; // creation failed — stay open, toast already shown
        close();
        updateGame({ tagIds: [...selected] });
      });
      const row = h('<div class="pp-row"></div>');
      row.appendChild(input);
      row.appendChild(picker.trigger);
      row.appendChild(addBtn);
      row.appendChild(okBtn);
      el.appendChild(row);
      el.appendChild(picker.grid);
      return () => input.focus();
    });
  }

  // Paste a new cover image, take it from the linked provider, or remove the
  // current one.
  function openImagePopover(anchor) {
    openEditor(anchor, 'image', t('detail.onboard.cover'), (el, close) => {
      const paste = h(`<button class="btn btn--primary">${esc(t('detail.pasteImage'))}</button>`);
      paste.addEventListener('click', async () => {
        const blob = await readClipboardImage();
        if (!blob) return; // toast already shown; keep popover open to retry
        close();
        updateGame({ imageBlob: blob });
      });
      el.appendChild(paste);

      // Re-fetch the cover from the provider this game is linked to (#518).
      // Offered whether or not there is a cover today, so it doubles as a repair
      // for a hotlink the provider has since moved. Hidden for a game linked to a
      // RETIRED provider (#744) — the route refuses it anyway (400), this just
      // doesn't offer what it would refuse, and the stored cover keeps rendering
      // either way.
      //
      // `LOOKUP_PROVIDERS` lives in views-round-lookup.js, which loads AFTER
      // this file. Safe because this runs on click, never at load time — keep it
      // that way (.claude/rules/frontend-script-load-order.md).
      if (game.source && LOOKUP_PROVIDERS.includes(game.source.provider)) {
        const prov = providerLabel(game.source.provider);
        const fetchBtn = h(`<button class="btn">${esc(t('detail.coverFromProvider', { provider: prov }))}</button>`);
        fetchBtn.addEventListener('click', async () => {
          close();
          try {
            await api('POST', `/api/rounds/${rid}/games/${gameId}/cover/provider?lang=${encodeURIComponent(getLocale())}`);
            toast(t('detail.toast.coverFetched', { provider: prov }));
            showGameDetail(rid, gameId);
          } catch (e) {
            // Each refusal says something the user can act on; anything else
            // falls through as-is, like the other sheets (bggImportError).
            const known = {
              no_cover: 'detail.toast.noProviderCover',
              no_source: 'detail.toast.coverNoSource',
              provider_unreachable: 'detail.toast.coverUnreachable',
            }[e.message];
            toast(known ? t(known, { provider: prov }) : e.message);
          }
        });
        el.appendChild(fetchBtn);
      }

      // Pick one of the game's BGG edition covers (#519) — the printing on this
      // group's table rather than whatever /thing serves as the item's default.
      // BGG only: the route answers 400 for a provider without the capability,
      // so offering it for one would only produce an error on expand.
      if (game.source && game.source.provider === 'bgg') {
        // Widens the floating card: three tiles of box art do not fit the
        // 300px `.popover` default. Compounded in CSS so it beats `.popover`
        // on specificity rather than on source order.
        el.classList.add('has-covers');
        el.appendChild(editionCoverPicker(rid, game.source.externalId, game.image || null, async (c) => {
          close();
          // The pick's edition rides along with its URL (#742) — the picker has
          // always handed back `{ edition, year, languages }` and every caller
          // used to keep only the image. It is what the detail page labels the
          // cover with, and what the wish-list price quotes an edition for.
          await updateGame({ imageUrl: c.imageUrl, ...editionFields(c) });
        }));
      }

      if (game.image) {
        const rm = h(`<button class="btn btn--ghost">${esc(t('addGame.removeImage'))}</button>`);
        rm.addEventListener('click', () => { close(); updateGame({ removeImage: true }); });
        el.appendChild(rm);
      }
      el.appendChild(h(`<div class="muted popover__hint">${esc(t('detail.imageHint'))}</div>`));
    });
  }

  // --- Expansions (#653) ---------------------------------------------------
  //
  // Owned expansions are a list on the game row, never an entity: they are not
  // voted on, drawn, rated or tagged. The one place they reach into the app is
  // the player range, through the shared `fitsPlayerCount` in draw-pool.js.
  const owned = game.expansions || [];

  // Send the whole list — the route replaces it wholesale, because "here is the
  // set we own" is what the tick-list expresses.
  async function saveExpansions(list) {
    try {
      await api('PUT', `/api/rounds/${rid}/games/${gameId}/expansions`, { expansions: list });
      toast(t('detail.toast.expansionsSaved'));
      showGameDetail(rid, gameId);
    } catch (e) {
      toast(e.message === 'quota_expansions' ? t('detail.toast.expansionQuota') : e.message);
    }
  }

  // Add: the provider's own list as a tick-list, plus a free-text field. The
  // candidates cost no extra upstream request — they ride on the /thing body the
  // detail hop already fetched (lib/routes/lookup.js).
  function openExpansionEditor(anchor) {
    openEditor(anchor, 'expansions', t('detail.expansionAdd'), (el, close) => {
      const keep = owned.map((e) => ({ id: e.id }));
      const picked = new Set();
      const canPick = game.source && typeof game.source.externalId === 'string'
        && game.source.provider === 'bgg';

      if (canPick) {
        const prov = providerLabel(game.source.provider);
        const list = h(`<div class="exp-pick"><div class="exp-pick__head muted">${esc(t('detail.expansionPickTitle', { provider: prov }))}</div><div class="exp-pick__body muted">…</div></div>`);
        el.appendChild(list);
        const body = list.querySelector('.exp-pick__body');
        api('GET', `/api/rounds/${rid}/lookup/expansions?provider=${encodeURIComponent(game.source.provider)}&id=${encodeURIComponent(game.source.externalId)}`)
          .then((res) => {
            const have = new Set(owned.map((e) => (e.source || {}).externalId).filter(Boolean));
            const fresh = (res.expansions || []).filter((c) => !have.has(c.providerId));
            body.innerHTML = '';
            if (!fresh.length) {
              body.className = 'exp-pick__body muted';
              body.textContent = t('detail.expansionPickEmpty', { provider: prov });
              return;
            }
            body.className = 'exp-pick__body';
            fresh.forEach((c) => {
              // A <label> row, so the whole line toggles its checkbox — and it
              // must NOT sit inside a `.field`, where `.field label` (0,1,1)
              // would flatten it (.claude/rules/label-rows-lose-to-field-label.md).
              const row = h(`<label class="ds-row exp-pick__row"><span class="ds-row__main">${esc(c.title)}</span><span class="ds-row__meta"><input type="checkbox" /></span></label>`);
              row.querySelector('input').addEventListener('change', (ev) => {
                if (ev.target.checked) picked.add(c.providerId);
                else picked.delete(c.providerId);
              });
              body.appendChild(row);
            });
          })
          .catch(() => {
            body.className = 'exp-pick__body muted';
            body.textContent = t('detail.expansionPickError', { provider: prov });
          })
          // The candidates arrive AFTER openPopover measured the card, so the
          // anchored variant is still placed for its loading height and would
          // hang off the fold — with no way back, since a page scroll closes a
          // popover. Placement is idempotent and this is a no-op for the sheet
          // and when no popover is open (.claude/rules/anchored-popover-is-placed-once.md).
          .finally(() => repositionPopover());
      }

      const own = h(`<div class="exp-own">
           <div class="exp-own__head muted">${esc(t('detail.expansionOwnTitle'))}</div>
           <input class="input exp-own__name" maxlength="${EXPANSION_TITLE_MAX}" placeholder="${esc(t('detail.expansionNamePlaceholder'))}" />
           <div class="pp-row exp-own__range"></div>
           <div class="muted popover__hint">${esc(t('detail.expansionRangeHint'))}</div>
         </div>`);
      const nameEl = own.querySelector('.exp-own__name');
      const min = h('<input class="input" inputmode="numeric" />');
      const max = h('<input class="input" inputmode="numeric" />');
      [min, max].forEach((inp) => inp.addEventListener('input', () => {
        const digits = inp.value.replace(/\D/g, '');
        if (inp.value !== digits) inp.value = digits;
      }));
      const range = own.querySelector('.exp-own__range');
      range.append(min, h('<span>–</span>'), max);
      el.appendChild(own);

      const okBtn = h(`<button class="btn btn--primary">${esc(t('common.ok'))}</button>`);
      okBtn.addEventListener('click', () => {
        const list = [...keep, ...[...picked].map((providerId) => ({ providerId }))];
        const title = nameEl.value.trim();
        if (title) {
          const mn = min.value.trim() === '' ? null : parseInt(min.value, 10);
          const mx = max.value.trim() === '' ? null : parseInt(max.value, 10);
          // Both bounds or neither: a lone bound states no interval, and an
          // expansion widens nothing at all unless it declares one in full.
          if ((mn === null) !== (mx === null)) return toast(t('detail.toast.expansionNeedsBoth'));
          if (mn !== null && (!Number.isInteger(mn) || !Number.isInteger(mx) || mn < 1 || mx < mn))
            return toast(t('detail.toast.expansionRange'));
          list.push({ title, minPlayers: mn, maxPlayers: mx });
        } else if (!picked.size) {
          return close(); // nothing to do
        }
        close();
        saveExpansions(list);
      });
      el.appendChild(okBtn);
      return () => { if (!canPick) { nameEl.focus(); } };
    });
  }

  // Related sessions (those that drew this game) – newest first. Computed up
  // here, not at its own section below, because `sparse` needs it.
  const related = round.sessions
    .filter((s) => s.gameIds.includes(gameId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  // A game nobody has touched yet: no cover, no rating, no session, no tags
  // (#256). Rendering the normal layout for it produced a page of near-empty
  // widgets — a dash in a grey ring, a dashed chip, one line of muted text —
  // which read as broken rather than new. Instead the page drops the empty
  // widgets entirely and leads with an invitation (see `onboard` below).
  const assignedTagIds = (game.tagIds || []).filter((x) => (round.tags || []).some((tg) => tg.id === x));
  const sparse =
    !game.image && st.avg === null && related.length === 0 && assignedTagIds.length === 0;

  // Header card: image + title + score ring ("Spielepass").
  const ratingsLine = t(st.count === 1 ? 'detail.ratingsLineOne' : 'detail.ratingsLine', { n: st.count, s: st.sessions });
  const RING_C = (2 * Math.PI * 34).toFixed(1);
  const scoreRing =
    st.avg !== null
      ? `<div class="gd-ring">
           <svg viewBox="0 0 80 80" aria-hidden="true">
             <circle cx="40" cy="40" r="34" fill="none" stroke="var(--sunken)" stroke-width="8"/>
             <circle cx="40" cy="40" r="34" fill="none" stroke="${avgColor(st.avg)}" stroke-width="8" stroke-linecap="round"
               stroke-dasharray="${(((st.avg - 1) / 4) * 2 * Math.PI * 34).toFixed(1)} ${RING_C}" transform="rotate(-90 40 40)"/>
           </svg>
           <span class="gd-ring__num" style="color:${avgColor(st.avg)}">${st.avg.toFixed(1)}</span>
         </div>
         <div class="score-label">${esc(ratingsLine)}</div>`
      : `<div class="gd-ring gd-ring--none"><span class="gd-ring__num">–</span></div>
         <div class="score-label">${esc(t('detail.noRating'))}</div>`;
  const sortLine = st.sortCount
    ? `<div class="sort-flag" style="margin-top:8px"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('detail.totalSort', { n: st.sortCount }))}</div>`
    : '';

  // The score ring is dropped for a sparse game — an empty ring next to an
  // empty everything-else is what made the page read as broken (#256) — and
  // for a wish (#699): the round does not own the game, so it cannot be rated
  // or aussortiert while on the list. Unconditional for a wish, even if the
  // data holds ratings (API-only edge); they reappear via „Ins Regal".
  const head = h(`<div class="gd-head${sparse ? ' gd-head--sparse' : ''}">
       <div class="gd-info">
         <h1></h1>
       </div>
       ${sparse || game.wish ? '' : `<div class="gd-stats">${scoreRing}${sortLine}</div>`}
     </div>`);

  // Editable cover image (activate to paste a new one or remove it). A <button>
  // for the same reason as the chips (#424); its fixed 240px box means the UA's
  // inline-block is no change, and the `.gd-img--edit:focus-visible` overlay
  // rule was already written for a focusable frame.
  const imgEl = h(`<button type="button" class="gd-img gd-img--edit" ${imgStyle} title="${esc(t('detail.changeImage'))}">${fallback}<span class="gd-img__edit">${esc(t('detail.changeImage'))}</span></button>`);
  imgEl.addEventListener('click', () => openImagePopover(imgEl));

  // Which printing this cover is (#742) — a quiet line under it, and only when
  // the game actually carries one. The wrapper is added ONLY in that case, so a
  // game with no stored edition (every game before this shipped, and every
  // pasted or uploaded cover after it) renders exactly the DOM it always did.
  // An edition that carries only languages has nothing to say here and correctly
  // renders nothing.
  const editionText = editionLabel(game.edition);
  if (editionText) {
    const col = h('<div class="gd-cover"></div>');
    col.append(imgEl, h(`<p class="gd-edition muted">${esc(t('detail.edition', { edition: editionText }))}</p>`));
    head.prepend(col);
  } else {
    head.prepend(imgEl);
  }

  // Title + editable tags.
  const h1 = head.querySelector('h1');
  const space = () => document.createTextNode(' ');

  // The one trigger that is NOT a button (#424): the title is inline text that
  // wraps mid-line — that is what `box-decoration-break: clone` on `.gd-title`
  // is for — and a <button> is an atomic inline-block, so a long title would
  // take the whole line and push the chips below it instead of sitting beside
  // its last line. `role="button"` is what tells a screen reader Enter does
  // something; a bare focusable span announces only its text.
  const titleEl = h(`<span class="gd-title" role="button" tabindex="0" title="${esc(t('detail.editName'))}">${esc(game.title)}</span>`);
  titleEl.addEventListener('click', () => startTitleEdit(titleEl));
  titleEl.addEventListener('keydown', (e) => {
    // preventDefault on Space, or the page scrolls under the editor.
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startTitleEdit(titleEl); }
  });
  h1.append(titleEl, space());

  // On a sparse page the dashed "set …" chips are suppressed: the onboarding
  // panel below already offers those exact actions, and two competing
  // affordances for one action is what made the old layout feel scattered.
  const hasPl = Number.isInteger(game.minPlayers) && Number.isInteger(game.maxPlayers);
  if (hasPl || !sparse) {
    // What the round can actually seat, once its expansions are counted (#653).
    // Only a FULLY declared expansion range widens anything — a lone bound
    // states no interval — which is why both bounds are required here as well.
    const widen = owned.filter((e) => Number.isInteger(e.minPlayers) && Number.isInteger(e.maxPlayers));
    const extra = [];
    if (hasPl && widen.length) {
      const up = Math.max(game.maxPlayers, ...widen.map((e) => e.maxPlayers));
      const down = Math.min(game.minPlayers, ...widen.map((e) => e.minPlayers));
      if (up > game.maxPlayers) extra.push(t('detail.expansionUpTo', { n: up }));
      if (down < game.minPlayers) extra.push(t('detail.expansionFrom', { n: down }));
    }
    const plText = hasPl
      ? playersText(game.minPlayers, game.maxPlayers) + (extra.length ? ` (${extra.join(', ')})` : '')
      : '';
    const plEl = hasPl
      ? editableTag('tag--players', iconText('ti-users', plText), openPlayersPopover)
      : editableTag('tag--players tag--empty', esc(t('detail.setPlayers')), openPlayersPopover);
    h1.append(plEl);
  }

  // Custom round tags (#238): assigned tags render as chips, each opening the
  // edit popover; with none assigned, an empty chip is the way in (and the
  // popover can create the round's very first tag inline).
  const roundTags = round.tags || [];
  if (assignedTagIds.length) {
    assignedTagIds.forEach((x) => {
      const tg = roundTags.find((q) => q.id === x);
      const tagEl = editableTag('tag--custom', `<i class="ti ${tagIconClass(tg.icon)}" aria-hidden="true"></i>${esc(tg.name)}`, openTagsPopover);
      h1.append(space(), tagEl);
    });
  } else if (!sparse) {
    const tagEl = editableTag('tag--custom tag--empty', esc(t('detail.setTags')), openTagsPopover);
    h1.append(space(), tagEl);
  }
  if (game.retired) h1.append(space(), h(`<span class="tag tag--retired">${iconText('ti-trash', t('result.retiredTag'))}</span>`));
  if (game.completed) h1.append(space(), h(`<span class="tag tag--completed">${iconText('ti-circle-check', t('result.completedTag'))}</span>`));
  // The third chip (#663). Its key is `wish.tag`, not a fourth `result.*` one:
  // the two above are shared with the session results rows, and a wish can never
  // appear on one — the round does not own the game, so it was never played.
  if (game.wish) h1.append(space(), h(`<span class="tag tag--wish">${iconText('ti-heart', t('wish.tag'))}</span>`));

  app.appendChild(head);

  // Off-shelf actions right from here. A game is Active, Retired, Completed
  // (#250) or Wished-for (#560), and the repo enforces that those four are
  // mutually exclusive — so the branches are too: a game that is off the shelf
  // offers only the way onto it, an active one both ways out.
  const actionWrap = h('<div class="toolbar" style="margin-top:18px"></div>');
  // Move the game onto the shelf, out of whichever state it is in. `opts` exists
  // for the wish list alone (see its branch below); the two archives take the
  // defaults.
  const restoreFrom = (kind, endpoint, body, opts = {}) => {
    const icon = opts.icon || 'ti-arrow-back-up';
    const label = opts.label || t('detail.restore');
    const restore = h(`<button class="btn"><i class="ti ${icon}" aria-hidden="true"></i> ${esc(label)}</button>`);
    restore.addEventListener('click', async () => {
      try {
        await api('POST', `/api/rounds/${rid}/games/${gameId}/${endpoint}`, body);
        toast(t(`${kind}.restored`, { title: game.title }));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message); }
    });
    actionWrap.appendChild(restore);
  };
  if (game.retired) {
    restoreFrom('retired', 'retire', { retired: false });
  } else if (game.completed) {
    restoreFrom('completed', 'complete', { completed: false });
  } else if (game.wish) {
    // „Ins Regal" with the Regal's own icon, never „Wiederherstellen": the game
    // is arriving on the shelf for the first time, so "restore" would claim it
    // is going back somewhere it has never been. Same reasoning — and the same
    // two values — as ARCHIVES.wish.restoreIcon in views-archive.js.
    //
    // This branch is what keeps the active `else` below off a wished-for game.
    // Without it a wish was offered „Direkt spielen", which the server refuses
    // with a 400 `Game is on the wishlist` (the shared isActiveGame predicate,
    // active-games-filter-sites.md) — so the user got a seat picker, a start
    // button and an English server error.
    restoreFrom('wish', 'wish', { wish: false }, { icon: 'ti-cards', label: t('wish.restore') });
  } else {
    // Direct launch: skip the vote and play this game right away.
    const play = h(`<button class="btn btn--primary"><i class="ti ti-player-play" aria-hidden="true"></i> ${esc(t('directPlay.button'))}</button>`);
    play.addEventListener('click', () => startDirectSession(round, game));
    actionWrap.appendChild(play);
    const retire = h(`<button class="btn" style="color:var(--warn)"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('detail.retire'))}</button>`);
    retire.addEventListener('click', async () => {
      if (!confirm(t('detail.retireConfirm', { title: game.title }))) return;
      try {
        await api('POST', `/api/rounds/${rid}/games/${gameId}/retire`, { retired: true });
        toast(t('games.retired', { title: game.title }));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message); }
    });
    actionWrap.appendChild(retire);
    const complete = h(`<button class="btn" style="color:var(--good)"><i class="ti ti-circle-check" aria-hidden="true"></i> ${esc(t('detail.complete'))}</button>`);
    complete.addEventListener('click', async () => {
      if (!confirm(t('detail.completeConfirm', { title: game.title }))) return;
      try {
        await api('POST', `/api/rounds/${rid}/games/${gameId}/complete`, { completed: true });
        toast(t('games.completed', { title: game.title }));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message); }
    });
    actionWrap.appendChild(complete);
  }
  app.appendChild(actionWrap);

  // What it costs right now (#679) — the one question that turns a wish into a
  // purchase, so it sits directly under "Ins Regal" rather than at the foot of
  // the page.
  //
  // Only a wish, and only one carrying a provider link: the round already owns
  // everything on the shelf, and a hand-typed wish has no id to ask about (a
  // title search would quote a price for the wrong edition, which is worse than
  // no price at all).
  //
  // An empty anchor holds the slot rather than a heading with a spinner in it:
  // the whole feature is off by default, so on most instances this resolves to
  // "nothing", and a heading that appears and then vanishes is worse than one
  // that never appeared. Every failure — the route 404ing because PRICES_ENABLED
  // is unset, the aggregator being down, nobody stocking the game — lands in the
  // same place: the anchor is dropped and the page is exactly what it was.
  if (game.wish && game.source && game.source.externalId) {
    const priceAnchor = h('<div></div>');
    app.appendChild(priceAnchor);
    // Stale-while-revalidate (#707): two requests race. `stored=1` answers from
    // the last-known-price store instantly; the full request may block on the
    // upstream for seconds (every in-memory cache miss — hourly, and after each
    // deploy). The stored answer is rendered only while the live one is still in
    // flight, and the live answer always wins — on a cache hit it settles just
    // as fast, so the transient stored render naturally never appears.
    const q = `lang=${encodeURIComponent(getLocale())}`;
    let node = priceAnchor;
    const swap = (next) => { node.replaceWith(next); node = next; };
    let liveSettled = false;
    let stored = null;
    api('GET', `/api/rounds/${rid}/games/${gameId}/prices?${q}&stored=1`)
      .then((p) => {
        if (liveSettled || !p || !p.available) return;
        stored = p;
        swap(renderPriceSection(p, { refreshing: true }));
      })
      .catch(() => {}); // the fast path failing must cost nothing
    api('GET', `/api/rounds/${rid}/games/${gameId}/prices?${q}`)
      .then((p) => {
        liveSettled = true;
        if (p && p.available) return swap(renderPriceSection(p));
        // A settled "nobody stocks this" is stated, not blanked — also when no
        // stored price was on screen first (operator decision on #707). Any
        // other unavailable answer has nothing honest to show.
        if (p && p.reason === 'no_offers') return swap(renderPriceNoOffers());
        node.remove();
      })
      .catch(() => {
        liveSettled = true;
        // Our own server became unreachable mid-view. A stored price already on
        // screen stays — re-rendered without the "checking…" note, which would
        // otherwise claim a check that is no longer running.
        if (stored) swap(renderPriceSection(stored));
        else node.remove();
      });
  }

  // The provider metadata (#717/#724), between the actions and the provider
  // block. Nothing renders when the game carries none of it. The
  // anchor also carries the detail-open backfill trigger: a BGG-linked game
  // missing a field asks the server, which fills the store best-effort and
  // answers whatever it holds (the TTL gate is server-side, so a game BGG has
  // no data for costs one cheap local request per open, never an upstream one).
  {
    const infoAnchor = h('<div></div>');
    app.appendChild(infoAnchor);
    let infoNode = infoAnchor;
    const renderInfo = () => {
      // { rating: true } on BOTH calls — this is the one surface that renders
      // the community score (#724), so the gate has to count it or a game whose
      // only provider fact is a rating would hide a section that has content.
      if (!hasGameInfo(game, { rating: true })) return;
      const sec = renderGameInfoSection(game);
      infoNode.replaceWith(sec);
      infoNode = sec;
    };
    renderInfo();
    if (wantsGameInfo(game)) {
      api('GET', `/api/rounds/${rid}/games/${gameId}/provider-info`)
        .then((info) => {
          mergeGameInfo(game, info);
          renderInfo();
        })
        .catch(() => {}); // best-effort enrichment; the page stands without it
    }
  }

  // Sparse game (#256): one inviting panel that says why the page is bare and
  // offers the steps that fill it, instead of scattering half-empty widgets.
  // The actions reuse the very same popovers the chips/cover would have opened,
  // so this is a different presentation of existing affordances, not new API.
  if (sparse) {
    const onboard = h(`<div class="gd-onboard">
         <div class="gd-onboard__head">
           <i class="ti ti-sparkles gd-onboard__icon" aria-hidden="true"></i>
           <div>
             <h2>${esc(t('detail.onboard.title'))}</h2>
             <p class="muted">${esc(t(game.wish ? 'detail.onboard.wishText' : 'detail.onboard.text'))}</p>
           </div>
         </div>
         <div class="gd-onboard__acts"></div>
       </div>`);
    const acts = onboard.querySelector('.gd-onboard__acts');
    [
      // The cover popover anchors on the hero itself (that's what it edits);
      // the other two anchor on their own button, which is where the eye is.
      // Cover and tags are always missing here (that's part of `sparse`), but
      // players can already be set — don't offer to fill in what's filled in.
      ['ti-photo', t('detail.onboard.cover'), () => openImagePopover(imgEl)],
      ['ti-tags', t('detail.onboard.tags'), (b) => openTagsPopover(b)],
      ...(hasPl ? [] : [['ti-users', t('detail.onboard.players'), (b) => openPlayersPopover(b)]]),
    ].forEach(([icon, label, onClick]) => {
      const b = h(`<button class="btn gd-onboard__act"><i class="ti ${icon}" aria-hidden="true"></i> ${esc(label)}</button>`);
      b.addEventListener('click', () => onClick(b));
      acts.appendChild(b);
    });
    app.appendChild(onboard);
  }

  // Link back to the provider page when the game was added from an external
  // source. A game with no source instead offers to link one after the fact
  // (issue #74). Provider names are proper nouns, not translated.
  if (game.source) {
    const provider = providerLabel(game.source.provider);
    const src = h('<div class="section gd-source"></div>');
    // A link built before the provider exposed a URL has none — it stays
    // unlinkable rather than rendering nothing at all.
    if (game.source.url) {
      src.appendChild(h(`<a class="link-out" href="${esc(game.source.url)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-external-link" aria-hidden="true"></i> ${esc(t('detail.viewSource', { provider }))}</a>`));
    }
    const un = h(`<button class="link-out link-out--btn link-out--muted"><i class="ti ti-unlink" aria-hidden="true"></i> ${esc(t('detail.unlinkProvider'))}</button>`);
    un.addEventListener('click', async () => {
      // Only a hotlinked provider cover is dropped with the link; the member's
      // own upload is kept, so the two wordings must not be swapped.
      const ownUpload = typeof game.image === 'string' && game.image.startsWith('/uploads/');
      const key = game.image && !ownUpload ? 'detail.unlinkConfirmCover' : 'detail.unlinkConfirm';
      if (!confirm(t(key, { provider }))) return;
      try {
        await api('PATCH', `/api/rounds/${rid}/games/${gameId}`, { removeSource: true });
        toast(t('detail.toast.unlinked'));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message); }
    });
    src.appendChild(un);
    app.appendChild(src);
  } else {
    const link = h(`<div class="section"><button class="link-out link-out--btn"><i class="ti ti-link" aria-hidden="true"></i> ${esc(t('detail.linkProvider'))}</button></div>`);
    link.querySelector('button').addEventListener('click', () => showLinkProvider(round, game));
    app.appendChild(link);
  }

  // What the round owns for this game (#653). Rendered on a sparse page too:
  // it is one of the few things you CAN record about a game nobody has played,
  // and it is the answer to "do we still have Seefahrer?". Never on a
  // wishlist-imported EXPANSION (#698): an expansion holds no expansions of its
  // own, and anything recorded here would be silently lost on acquire — the
  // wish row (and this list with it) is deleted in the same transaction that
  // carries only title/link/range onto the base game. Presence check, not
  // truthiness: the key is absent on ordinary games and legitimately [] on an
  // orphan expansion (.claude/rules/expansions-widen-by-union.md).
  if (!Array.isArray(game.expansionOf)) {
    const expSec = h(`<div class="section gd-expansions"><h2>${esc(t('detail.expansionsTitle'))}</h2></div>`);
    if (!owned.length) {
      expSec.appendChild(h(`<div class="muted">${esc(t('detail.expansionsEmpty'))}</div>`));
    } else {
      const list = h('<div class="ds-list"></div>');
      owned.forEach((e) => {
        const range = Number.isInteger(e.minPlayers) && Number.isInteger(e.maxPlayers)
          ? playersText(e.minPlayers, e.maxPlayers)
          : t('detail.expansionNoRange');
        // A plain <div> row, so it must carry `ds-row--static` — `.ds-row`
        // declares cursor:pointer and a hover lift, i.e. it promises a click
        // target (.claude/rules/ds-row-is-a-click-target.md). The remove button
        // inside it is the only thing here that is clickable.
        const row = h(`<div class="ds-row ds-row--static">
             <div class="ds-row__main">
               <div class="ds-row__title">${esc(e.title)}</div>
               <div class="muted">${esc(range)}</div>
             </div>
             <div class="ds-row__meta">
               <button class="link-btn exp-row__remove">${iconText('ti-trash', t('detail.expansionRemove'))}</button>
             </div>
           </div>`);
        row.querySelector('.exp-row__remove').addEventListener('click', () => {
          if (!confirm(t('detail.expansionRemoveConfirm', { title: e.title }))) return;
          saveExpansions(owned.filter((x) => x.id !== e.id).map((x) => ({ id: x.id })));
        });
        list.appendChild(row);
      });
      expSec.appendChild(list);
    }
    const addExp = h(`<button class="link-out link-out--btn"><i class="ti ti-plus" aria-hidden="true"></i> ${esc(t('detail.expansionAdd'))}</button>`);
    addExp.addEventListener('click', () => openExpansionEditor(addExp));
    expSec.appendChild(addExp);
    app.appendChild(expSec);
  }

  // Related sessions (`related` is computed near the top — `sparse` needs it).
  // On a sparse page the section is omitted entirely: the onboarding panel
  // already explains that ratings and sessions appear once the game is played,
  // so a heading over one line of muted text only adds to the emptiness.
  // A wish omits it too (#699), same reasoning as the score ring above.
  const sec = h(`<div class="section"><h2>${esc(t('detail.relatedTitle'))}</h2></div>`);
  if (related.length === 0) {
    sec.appendChild(h(`<div class="muted">${esc(t('detail.relatedEmpty'))}</div>`));
  } else {
    const list = h('<div class="ds-list"></div>');
    related.slice(0, 15).forEach((s) => {
      const sst = gameStatsForSession(round, s, gameId);
      const when = fmtDateTime(s.createdAt);
      const picked = s.chosenGameId === gameId;
      let status;
      if (picked) {
        // Session people, not round members, so a guest winner still resolves
        // (marked as a guest) rather than vanishing from the line (#458).
        const sPeople = sessionPeople(round, s);
        const names = (s.winnerIds || [])
          .map((wid) => personLabel(sPeople.find((p) => p.id === wid)))
          .filter(Boolean);
        status = s.finished
          ? `${esc(t('detail.played'))}${names.length ? ' · <i class="ti ti-trophy" aria-hidden="true"></i> ' + names.map(esc).join(', ') : ''}`
          : esc(t('detail.chosen'));
      } else if (s.cancelled) {
        status = `<span class="muted">${esc(t('detail.sessionCancelled'))}</span>`;
      } else {
        status = `<span class="muted">${esc(t('detail.notChosen'))}</span>`;
      }
      const scoreCell =
        sst.avg !== null
          ? `<span class="score-pill" style="background:${avgColor(sst.avg)}">Ø ${sst.avg.toFixed(1)}</span>`
          : '<span class="score-pill score-pill--none">–</span>';
      const sortCell = sst.sortCount
        ? `<span class="sort-flag"><i class="ti ti-trash" aria-hidden="true"></i> ${sst.sortCount}×</span>`
        : '';
      const row = h(`<a class="ds-row${picked ? ' ds-row--picked' : ''}">
           <div class="ds-row__main">
             <div class="ds-row__date">${when}</div>
             <div class="ds-row__status">${status}</div>
           </div>
           <div class="ds-row__meta">${sortCell}${scoreCell}</div>
         </a>`);
      navLink(row, resultsPath(round.id, s.id), () => showResults(round, s));
      list.appendChild(row);
    });
    sec.appendChild(list);
  }
  if (!sparse && !game.wish) app.appendChild(sec);
}

// =================== Add game (bottom sheet) ===================

// The active sheet (backdrop element), so navigation/reopen can close it.
let activeSheet = null;

// Sheet history integration (#333). A sheet is not a routable view, but Back
// should dismiss it — as it does on Android and increasingly on the web —
// instead of tearing down the whole screen behind it. So opening a sheet pushes
// ONE URL-less history marker; Back pops it and we close the sheet, swallowing
// the navigation. State-only, not `?sheet=…`: every sheet (add game, link
// provider, move games, feedback, support) holds transient, unsaved input a
// reload would lose anyway, so deep-linking one buys nothing.
//   `sheetHistory`      — a marker is currently on top of the stack.
//   `pendingAfterClose` — a success handler that navigates AFTER the sheet
//     closes ("add game" → Regal) passes its navigation to closeSheet(next); it
//     must run only once the marker has popped, because history.back() fires
//     popstate asynchronously and a synchronous push would interleave with it
//     and corrupt the stack. handleSheetPop() runs it after the pop.
let sheetHistory = false;
let pendingAfterClose = null;

// Register a just-appended sheet as the active one and contain the keyboard in
// it (#145). Every sheet is aria-modal, which only constrains a screen reader —
// without trapFocus, Tab walked out of the dialog into the page behind the
// backdrop. Call this instead of assigning `activeSheet` directly, so no sheet
// can be added later that silently misses the trap OR the Back-dismissal.
function openSheet(backdrop, onKey) {
  // Replacing an already-open sheet (a showX opened while one is up) reuses its
  // marker — tear the old one down here, synchronously, rather than via a
  // leading closeSheet() whose async history.back() would arrive AFTER the new
  // sheet is open and wrongly dismiss it. `keepLock` because the page is staying
  // covered throughout: unlocking would restore the scroll offset and the
  // re-lock below would freeze it again, a visible jump on every replace.
  if (activeSheet) teardownSheet({ keepLock: true });
  // Freeze the page behind the backdrop (#622), and stop a swipe across the
  // exposed backdrop area from arriving as a dismissing tap now that it no
  // longer scrolls anything.
  lockPage();
  guardDragDismiss(backdrop);
  const release = trapFocus(backdrop);
  activeSheet = { el: backdrop, onKey, release };
  if (!sheetHistory) {
    history.pushState(Object.assign({}, history.state, { sheet: true }), '');
    sheetHistory = true;
  }
}

// Remove the sheet DOM and release the focus trap. Ordering is load-bearing
// (#145): release AFTER removing the sheet, because the trap restores focus to
// the opener and focusing an element inside a still-attached, about-to-vanish
// dialog would be undone a moment later.
function teardownSheet(opts) {
  if (!activeSheet) return;
  document.removeEventListener('keydown', activeSheet.onKey, true);
  activeSheet.el.remove();
  if (activeSheet.release) activeSheet.release();
  activeSheet = null;
  // Every path OUT of the sheet layer comes through here — the × button, Escape,
  // a backdrop tap, a successful submit, and Back via handleSheetPop — so this is
  // the one place the page lock has to be released. `keepLock` is passed by the
  // openSheet replace path above, and by nothing else.
  if (!(opts && opts.keepLock)) unlockPage();
}

// Programmatic close (Escape, backdrop, the × button, a successful submit).
// `next`, if given, is a navigation to run once the pushed marker has been
// consumed — pass it to closeSheet instead of navigating on the next line, so
// the pop and the navigation don't race (see pendingAfterClose above).
function closeSheet(next) {
  if (!activeSheet) { if (typeof next === 'function') next(); return; }
  teardownSheet();
  if (sheetHistory) {
    pendingAfterClose = (typeof next === 'function') ? next : null;
    history.back();            // → popstate → handleSheetPop() consumes the marker, then runs next
  } else if (typeof next === 'function') {
    next();
  }
}

// Called first by router.js's popstate handler (#333). Returns true when this
// pop belongs to the sheet layer, so the router swallows it instead of routing:
//   • a sheet is open  → Back is dismissing it: tear it down, stay on the screen.
//   • the marker is ours → it is being consumed after a programmatic close: run
//     any deferred navigation now that the stack is back on the underlying entry.
function handleSheetPop() {
  if (activeSheet) {
    teardownSheet();
    sheetHistory = false;
    return true;
  }
  if (sheetHistory) {
    sheetHistory = false;
    const next = pendingAfterClose;
    pendingAfterClose = null;
    if (next) next();
    return true;
  }
  return false;
}

