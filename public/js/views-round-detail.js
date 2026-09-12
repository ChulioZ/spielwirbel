/* Spielwirbel – views: a round's game detail screen, plus the wish-list price
   block it renders. Loaded after views-round.js; shares one global script scope.

   #956 took the three things here that were not game detail: the design picker
   and the tag manager (two routed screens) joined views-round-settings.js, which
   already links to both, and the sheet/editor overlay layer became sheet.js —
   it was called from eleven other files while living in this one. */

// =================== The wish-list price block ===================

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

// The three lists that hold a game the round is not playing off its shelf, in
// the order a game's own flags are read. ONE table, because two affordances on
// the game-detail screen answer the same question from it: the rail marks the
// list the game belongs to (#794) and the back control falls back to it (#663).
// They answered it separately until #794, and the rail's answer — a hard-coded
// Regal — was wrong in all three states, so the two navigation controls on one
// screen pointed at different lists.
//
// The order is not a tie-break: the repo clears the other two flags on every
// one of these transitions (`.claude/rules/active-games-filter-sites.md`), so a
// game is never in two of the lists at once.
//
// `show` is an arrow rather than a bare reference because these are defined in
// views-archive.js: a top-level table capturing them by value would be reading
// a later file's names at load time (`.claude/rules/frontend-script-load-order.md`).
const OFF_SHELF_LISTS = [
  { id: 'retired', holds: (g) => !!g.retired, show: (rid) => showRetired(rid) },
  { id: 'completed', holds: (g) => !!g.completed, show: (rid) => showCompleted(rid) },
  { id: 'wishlist', holds: (g) => !!g.wish, show: (rid) => showWishlist(rid) },
];

// The off-shelf list a game sits in, or null while it is on the shelf.
const offShelfListOf = (game) => OFF_SHELF_LISTS.find((l) => l.holds(game)) || null;

// =================== Game detail ===================

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
  const coverCss = game.image ? `url('${coverUrl(game.image, COVER_HERO)}')` : '';
  const imgStyle = coverCss ? `style="background-image:${coverCss}"` : '';
  const fallback = coverPlaceholder(game);
  app.innerHTML = '';
  // Where this game lives, which both navigation controls below need. The rail
  // marks that list instead of the Regal, which for an off-shelf game is the one
  // section that by definition cannot contain it (#794).
  const offShelf = offShelfListOf(game);
  renderSubScreenTabs(round, 'game', offShelf && offShelf.id);
  // The fallback destination is derived from the GAME's state, not from an
  // origin argument (#663). Real history still wins — backRow feeds navBack —
  // so this is the deep-link case, and a page reached by URL has no origin to
  // pass: a game belongs to whichever screen lists it, whether it was opened
  // from a shared link, a session results row or the Pokale cards.
  // Held rather than appended-and-forgotten: the „…" page menu (#1039) joins
  // this row at its right end, and its handlers are closures defined below.
  const back = backRow(() => (offShelf ? offShelf.show(rid) : showRound(rid, 'regal')));
  app.appendChild(back);

  // Send a partial update, then re-render the page from fresh data.
  async function updateGame(updates) {
    const { imageBlob, removeImage, ...fields } = updates;
    let body;
    if (imageBlob || removeImage) {
      // Image involved → multipart. Scalar fields ride along as form fields.
      body = new FormData();
      Object.entries(fields).forEach(([k, v]) => body.append(k, v));
      if (imageBlob) {
        // Pre-flight against the shared cap, as the add-game paste zone does
        // (#867) — refused here rather than 413'd after the upload.
        if (imageBlob.size > COVER_MAX_BYTES) return toast(t('cover.tooLarge', { mb: COVER_MAX_MB }));
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
      // The server's answer when the pre-flight above was bypassed; every other
      // code still surfaces as-is.
      if (e.message === 'cover_too_large') return toast(t('cover.tooLarge', { mb: COVER_MAX_MB }));
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

  // Who owns the box (#971). Built like the tags popover next to it — chips over
  // the round's members, OK commits — with nothing to create inline: a member is
  // a seat of the round, not something this screen may mint.
  //
  // A WISH shows no row at all (the caller decides that), so this is only ever
  // reached for a game the round actually owns.
  function openOwnersPopover(anchor) {
    openEditor(anchor, 'owners', t('detail.onboard.owners'), (el, close) => {
      const selected = new Set(game.ownerIds || []);
      el.appendChild(renderOwnerChips(round, selected));
      const okBtn = h(`<button class="btn btn--primary">${esc(t('common.ok'))}</button>`);
      okBtn.addEventListener('click', () => {
        close();
        updateGame({ ownerIds: [...selected] });
      });
      const row = h('<div class="pp-row"></div>');
      row.appendChild(okBtn);
      el.appendChild(row);
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

      // aria-label as well as placeholder: a placeholder is not a label (it is
      // not exposed as the accessible name and it disappears on input), so
      // without this the field is an unnamed text input to a screen reader.
      // The Tags screen's own copy of this control already carries it.
      const input = h(`<input class="input" maxlength="30" placeholder="${esc(t('tags.addPlaceholder'))}"
              aria-label="${esc(t('tags.addPlaceholder'))}" />`);
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
      // `LOOKUP_PROVIDERS` lives in lookup.js, which since #956 loads BEFORE
      // this file — so the load-order hazard this comment used to warn about is
      // gone. Still read it on click rather than at load time: the ordering is a
      // property of index.html, not of the code
      // (.claude/rules/frontend-script-load-order.md).
      if (game.source && LOOKUP_PROVIDERS.includes(game.source.provider)) {
        const prov = providerLabel(game.source.provider);
        // Short in the button, full in the toast (#817): this label's max-content
        // width sized the whole image-editor popover
        // (.claude/rules/popover-width-is-shrink-to-fit.md), while the toast has
        // room and reads better spelled out.
        const fetchBtn = h(`<button class="btn">${esc(t('detail.coverFromProvider', { provider: providerLabelShort(game.source.provider) }))}</button>`);
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
    // Titled „Erweiterungen" rather than „Erweiterung hinzufügen" since #1039:
    // the editor absorbed the removed section's list, so it is no longer only an
    // add form — and on a phone that string is the sheet's accessible name.
    openEditor(anchor, 'expansions', t('detail.expansionsTitle'), (el, close) => {
      const keep = owned.map((e) => ({ id: e.id }));
      const picked = new Set();
      const canPick = game.source && typeof game.source.externalId === 'string'
        && game.source.provider === 'bgg';

      // What the round already owns — the rows the `.gd-expansions` section used
      // to carry on the page (#1039). They lead the editor because it is now the
      // only way to this list: dropping them with the section would have made an
      // owned expansion unremovable, which no test could have seen (the route is
      // untouched and the chip still counts them).
      if (owned.length) {
        const have = h(`<div class="exp-have">
             <div class="exp-have__head muted">${esc(t('detail.expansionsTitle'))}</div>
             <div class="exp-have__body"></div>
           </div>`);
        const haveBody = have.querySelector('.exp-have__body');
        owned.forEach((e) => {
          const range = Number.isInteger(e.minPlayers) && Number.isInteger(e.maxPlayers)
            ? playersText(e.minPlayers, e.maxPlayers)
            : t('detail.expansionNoRange');
          // A plain <div> row, so it must carry `ds-row--static` — `.ds-row`
          // declares cursor:pointer and a hover lift, i.e. it promises a click
          // target (.claude/rules/ds-row-is-a-click-target.md). The remove button
          // inside it is the only thing here that is clickable.
          const row = h(`<div class="ds-row ds-row--static exp-have__row">
               <div class="ds-row__main">
                 <div class="ds-row__title">${esc(e.title)}</div>
                 <div class="muted">${esc(range)}</div>
               </div>
               <div class="ds-row__meta">
                 <button class="link-btn exp-row__remove" aria-label="${esc(t('detail.expansionRemove'))}">${iconText('ti-trash', t('detail.expansionRemove'))}</button>
               </div>
             </div>`);
          row.querySelector('.exp-row__remove').addEventListener('click', async () => {
            // The editor goes first: `confirmDialog` is a sheet on <body>, and a
            // mousedown on it is "outside" the popover, which would tear this one
            // down mid-await anyway. Same order as the image editor's actions.
            close();
            if (!await confirmDialog({
              body: t('detail.expansionRemoveConfirm', { title: e.title }),
              confirmLabel: t('detail.expansionRemove'), icon: 'ti-trash',
            })) return;
            saveExpansions(owned.filter((x) => x.id !== e.id).map((x) => ({ id: x.id })));
          });
          haveBody.appendChild(row);
        });
        el.appendChild(have);
      }

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
    !game.image && st.score === null && related.length === 0 && assignedTagIds.length === 0;

  // =================== The spread (#1039) ===================
  //
  // The screen asks two questions on every visit — *what is this game* and *how
  // did it go for us* — and offers one action. Before this it answered both in
  // one 900px column of stacked sections, so from 1280px up 45% of the pane was
  // gutter while „Verwandte Sessions" sat below the fold and the score ring
  // printed the mean of sessions listed 800px further down.
  //
  // Now the two questions are the two pages of a spread: the game on the left,
  // our table on the right, with the one action pinned at the right page's foot.
  // Single column below 860px — the app's existing strip/dock/editor breakpoint
  // (.claude/rules/responsive-hub-tabs.md) — in the order card → history → bar.
  const pass = h('<div class="pass"></div>');
  const leftPage = h('<div class="pass__game"></div>');
  const rightPage = h('<div class="pass__table"></div>');
  pass.append(leftPage, rightPage);

  // --- Left page: the game's own card --------------------------------------
  //
  // Keeps #868's framed treatment and its 0.16 cover wash (the opacity is
  // contrast-capped — test/game-detail-hero.test.js), and #901's fixed cover
  // basis. What changed is the row: cover + title only, so the 701–939px gap
  // that used to sit where the ring's column was closes by itself.
  const card = h(`<div class="gd-head${sparse ? ' gd-head--sparse' : ''}"${
    coverCss ? ` style="--gd-cover:${coverCss}"` : ''
  }>
       <div class="gd-cover"></div>
       <div class="gd-info">
         <h1></h1>
         <div class="gd-chips"></div>
       </div>
     </div>`);
  const coverCol = card.querySelector('.gd-cover');
  const chips = card.querySelector('.gd-chips');
  const info = card.querySelector('.gd-info');

  // Editable cover image (activate to paste a new one or remove it). A <button>
  // for the same reason as the chips (#424); its fixed box means the UA's
  // inline-block is no change, and the `.gd-img--edit:focus-visible` overlay
  // rule was already written for a focusable frame.
  const imgEl = h(`<button type="button" class="gd-img gd-img--edit" ${imgStyle} title="${esc(t('detail.changeImage'))}">${fallback}<span class="gd-img__edit">${esc(t('detail.changeImage'))}</span></button>`);
  imgEl.addEventListener('click', () => openImagePopover(imgEl));
  coverCol.appendChild(imgEl);

  // The score, on the cover's top-right corner — exactly where every Regal card
  // already puts it (#1039). It replaces the 88px ring and the „Spielwirbel-Score"
  // caption under it: the ring spent the page's best real estate on a number the
  // shelf states in a pill, and the caption is what the ⓘ beside it says.
  //
  // The pill carries an aria-label because the visible label went with the ring:
  // a bare „3,5" over box art announces a number with no subject. It CONTAINS the
  // visible text, so nothing here trades away WCAG 2.2 SC 2.5.3 (and the pill is
  // static text rather than a control, where that criterion would bind).
  //
  // Rendered only for a scored, non-wish, non-sparse game — the same three gates
  // the ring had (#256/#699): the round does not own a wish, so it cannot rate it,
  // and an empty badge on an empty page is what made this screen read as broken.
  //
  // An unscored game gets the Regal's own „neu" variant rather than nothing: the
  // issue's acceptance criterion names the two states that show NO pill (a wish
  // and a sparse game), and dropping it for a third — a game with a cover but no
  // plays yet — would leave that page with no score affordance at all, where
  // the same game's shelf card still says „neu".
  const shown = st.score === null ? null : displayScore(st.score);
  if (!sparse && !game.wish) {
    const pill = st.score !== null
      ? `<span class="score-pill score-pill--lg" style="background:${scoreColor(st.score)}"
               aria-label="${esc(`${t('score.name')}: ${fmtAvg(shown)}`)}">${fmtAvg(shown)}</span>`
      : `<span class="score-pill score-pill--lg score-pill--none">${esc(t('games.scoreNew'))}</span>`;
    const badge = h(`<div class="gd-score">${pill}${infoButton('score')}</div>`);
    coverCol.appendChild(badge);
    wireInfoButtons(badge);
  }

  // Which printing this cover is (#742) — a quiet line under it, and only when
  // the game actually carries one. An edition that carries only languages has
  // nothing to say here and correctly renders nothing.
  const editionText = editionLabel(game.edition);
  if (editionText) {
    coverCol.appendChild(h(`<p class="gd-edition muted">${esc(t('detail.edition', { edition: editionText }))}</p>`));
  }

  // Title.
  const h1 = card.querySelector('h1');

  // The one trigger that is NOT a button (#424): the title is inline text that
  // wraps mid-line — that is what `box-decoration-break: clone` on `.gd-title`
  // is for — and a <button> is an atomic inline-block, so a long title would
  // take the whole line. `role="button"` is what tells a screen reader Enter
  // does something; a bare focusable span announces only its text.
  const titleEl = h(`<span class="gd-title" role="button" tabindex="0" title="${esc(t('detail.editName'))}">${esc(game.title)}</span>`);
  titleEl.addEventListener('click', () => startTitleEdit(titleEl));
  titleEl.addEventListener('keydown', (e) => {
    // preventDefault on Space, or the page scrolls under the editor.
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startTitleEdit(titleEl); }
  });
  h1.append(titleEl);

  // The chips move OUT of the <h1> (#1039). They were appended into the heading
  // so they could sit beside the title's last line; the row is now its own flex
  // line, which also takes four interactive controls out of a heading's
  // accessible name.
  //
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
    chips.append(plEl);
  }

  // Custom round tags (#238): assigned tags render as chips, each opening the
  // edit popover; with none assigned, an empty chip is the way in (and the
  // popover can create the round's very first tag inline).
  const roundTags = round.tags || [];
  if (assignedTagIds.length) {
    assignedTagIds.forEach((x) => {
      const tg = roundTags.find((q) => q.id === x);
      chips.append(editableTag('tag--custom', `<i class="ti ${tagIconClass(tg.icon)}" aria-hidden="true"></i>${esc(tg.name)}`, openTagsPopover));
    });
  } else if (!sparse) {
    chips.append(editableTag('tag--custom tag--empty', esc(t('detail.setTags')), openTagsPopover));
  }

  // Owners (#971): named when recorded, an empty chip as the way in otherwise.
  // Never on a WISH — the round does not own the game, so there is no owner to
  // record and the route refuses one.
  if (!game.wish) {
    const owners = ownerNames(round, game.ownerIds);
    if (owners.length) {
      chips.append(editableTag('tag--custom',
        iconText('ti-user', t('detail.owners', { names: owners.join(', ') })), openOwnersPopover));
    } else if (!sparse) {
      chips.append(editableTag('tag--custom tag--empty',
        esc(t('detail.setOwners')), openOwnersPopover));
    }
  }

  // What the round owns for this game (#653), as a chip instead of the 110px
  // section it used to cost on every visit (#1039). The editor it opens now
  // lists the owned expansions with their remove control, so nothing that was
  // reachable from the section is lost.
  //
  // Rendered on a sparse page EVEN WHEN EMPTY, unlike the three chips above:
  // it is one of the few things you can record about a game nobody has played,
  // and it is the answer to "do we still have Seefahrer?". Never on a
  // wishlist-imported EXPANSION (#698): an expansion holds no expansions of its
  // own, and anything recorded here would be silently lost on acquire. Presence
  // check, not truthiness — the key is absent on ordinary games and legitimately
  // [] on an orphan expansion (.claude/rules/expansions-widen-by-union.md).
  if (!Array.isArray(game.expansionOf)) {
    chips.append(owned.length
      ? editableTag('tag--custom tag--expansions',
        `<i class="ti ti-cards" aria-hidden="true"></i>${esc(tn(owned.length, 'detail.expansionsBadgeOne', 'detail.expansionsBadge'))}`,
        openExpansionEditor)
      : editableTag('tag--custom tag--empty tag--expansions', esc(t('detail.addExpansionChip')), openExpansionEditor));
  }

  // State chips — read-only, so plain spans rather than `editableTag`.
  if (game.retired) chips.append(h(`<span class="tag tag--retired">${iconText('ti-trash', t('result.retiredTag'))}</span>`));
  if (game.completed) chips.append(h(`<span class="tag tag--completed">${iconText('ti-circle-check', t('result.completedTag'))}</span>`));
  // The third chip (#663). Its key is `wish.tag`, not a fourth `result.*` one:
  // the two above are shared with the session results rows, and a wish can never
  // appear on one — the round does not own the game, so it was never played.
  if (game.wish) chips.append(h(`<span class="tag tag--wish">${iconText('ti-heart', t('wish.tag'))}</span>`));

  // The glance facts (#717/#724), promoted out of the „Über das Spiel" section
  // and onto the card as pills (#1039): weight, playing time, minimum age are
  // what a group asks before playing, while CATAN's 15 mechanics made that
  // section 517px tall on a phone. Both anchors are re-rendered together by
  // `renderInfo` below, because the provider backfill can fill either.
  const factsAnchor = h('<div></div>');
  info.appendChild(factsAnchor);

  // „Mehr zum Spiel" — the reference half, collapsed by default: the category
  // and mechanic lists, the community rating (detail only, #724), the BGG credit,
  // and the provider link. A native <details>, so the platform owns the
  // disclosure state, the keyboard and the accessible name.
  const moreBody = h('<div class="gd-more__body"></div>');
  const more = h(`<details class="gd-more"><summary>${esc(t('detail.more'))}<i class="ti ti-chevron-down" aria-hidden="true"></i></summary></details>`);
  more.appendChild(moreBody);

  // The provider link, which is the one thing in the disclosure every game has
  // something to say about. „Verknüpfung lösen" is NOT here — it moved to the
  // page menu with the other two rare state changes.
  if (game.source) {
    // A link built before the provider exposed a URL has none — it stays
    // unlinkable rather than rendering nothing at all.
    if (game.source.url) {
      // Short label, and deliberately NO aria-label over it (#817): a spelled-out
      // name above a visible „Auf BGG ansehen" would fail WCAG 2.2 SC 2.5.3,
      // which requires the accessible name to contain the visible text.
      moreBody.appendChild(h(`<a class="link-out" href="${esc(game.source.url)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-external-link" aria-hidden="true"></i> ${esc(t('detail.viewSource', { provider: providerLabelShort(game.source.provider) }))}</a>`));
    }
  } else {
    const link = h(`<button class="link-out link-out--btn"><i class="ti ti-link" aria-hidden="true"></i> ${esc(t('detail.linkProvider'))}</button>`);
    link.addEventListener('click', () => showLinkProvider(round, game));
    moreBody.appendChild(link);
  }

  // The provider metadata's two anchors, filled now and again after the
  // detail-open backfill answers: a BGG-linked game missing a field asks the
  // server, which fills the store best-effort and answers whatever it holds (the
  // TTL gate is server-side, so a game BGG has no data for costs one cheap local
  // request per open, never an upstream one).
  {
    // The reference rows sit ABOVE the provider link inside the disclosure, so
    // the re-render must not append past it — hence a held anchor rather than
    // `moreBody.appendChild`.
    const restAnchor = h('<div></div>');
    moreBody.prepend(restAnchor);
    let restNode = restAnchor;
    let factsNode = factsAnchor;
    const swap = (holder, next) => {
      if (!next) return holder;
      holder.replaceWith(next);
      return next;
    };
    // The disclosure is attached only once it has something in it. A game linked
    // to a provider that exposes no URL and carrying no metadata would otherwise
    // show an empty „Mehr zum Spiel" that opens onto nothing — and the check has
    // to run again after the backfill answers, because for a freshly imported
    // game the metadata IS what fills it. Idempotent: `isConnected` is what keeps
    // a second answer from re-appending it below the facts.
    //
    // `.gd-more__body` always holds the rest-anchor placeholder, so counting its
    // children would be vacuously true; the query asks for real content instead.
    const ensureMore = () => {
      if (more.isConnected) return;
      if (moreBody.querySelector('.link-out, .game-info__body')) info.appendChild(more);
    };
    const renderInfo = () => {
      factsNode = swap(factsNode, gameGlanceFacts(game));
      restNode = swap(restNode, gameInfoRest(game));
      ensureMore();
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


  leftPage.appendChild(card);

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
    leftPage.appendChild(onboard);
  }

  // --- Right page: what it cost, how it went, and the one action -----------

  // What it costs right now (#679) — the one question that turns a wish into a
  // purchase, so it leads the right page rather than sitting at the foot of it.
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
    rightPage.appendChild(priceAnchor);
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

  // Related sessions (`related` is computed near the top — `sparse` needs it).
  // On a sparse page the section is omitted entirely: the onboarding panel
  // already explains that ratings and sessions appear once the game is played,
  // so a heading over one line of muted text only adds to the emptiness.
  // A wish omits it too (#699), same reasoning as the score badge above.
  const sec = h(`<div class="section gd-history"><h2>${esc(t('detail.relatedTitle'))}</h2></div>`);
  if (related.length === 0) {
    sec.appendChild(h(`<div class="muted">${esc(t('detail.relatedEmpty'))}</div>`));
  } else {
    // A Stempelkarte, not a list (#1040). The exception to
    // `.claude/rules/tiles-vs-lists.md` is written up there: the rule's argument
    // for keeping this a list was ordering, and a row-major strip keeps it.
    //
    // `fmtDate`, not `fmtDateTime` as the row used: at 22px display type
    // "1. Juni 2026, 19:00" is ~230px against a 150px stamp, and the minute an
    // evening started is not what a stamp records. The full timestamp is on the
    // results screen the stamp links to.
    // The stamps press in one after another on open (#1041). The stagger is a
    // ladder, not a queue: 15 stamps ship, so an uncapped 70ms step would still
    // be pressing at 1.55s — long after the reader has started reading. Past
    // this rung they land together, which is the point at which a stagger has
    // said what it has to say anyway. The CSS carries the step and the offset;
    // `test/game-detail-press.test.js` derives the budget from all three, so
    // retuning any one of them re-checks it.
    const STAGGER_LAST = 8;
    const list = h('<div class="stamps"></div>');
    // `i` is the press-in stagger (#1041), capped below — see STAGGER_LAST.
    related.slice(0, 15).forEach((s, i) => {
      const sst = gameStatsForSession(round, s, gameId);
      const picked = s.chosenGameId === gameId;
      let status;
      let winner = '';
      if (picked) {
        // Session people, not round members, so a guest winner still resolves
        // (marked as a guest) rather than vanishing from the line (#458).
        const sPeople = sessionPeople(round, s);
        const names = (s.winnerIds || [])
          .map((wid) => personLabel(sPeople.find((p) => p.id === wid)))
          .filter(Boolean);
        status = s.finished
          ? `<i class="ti ti-circle-check" aria-hidden="true"></i> ${esc(t('detail.played'))}`
          : esc(t('detail.chosen'));
        if (s.finished && names.length) {
          winner = `<div class="stamp__win"><i class="ti ti-trophy" aria-hidden="true"></i> ${names.map(esc).join(', ')}</div>`;
        }
      } else if (sessionOutcome(s) === 'cancelled') {
        status = esc(t('detail.sessionCancelled'));
      } else if (sessionOutcome(s) === 'split') {
        // A split parent never chose a game (#796), so the plain "not chosen"
        // below would be true and useless: this game was voted on and the
        // evening moved to its tables, which each have their own stamp here.
        status = esc(t('detail.sessionSplit'));
      } else {
        status = esc(t('detail.notChosen'));
      }
      // No rating, no pill — not the empty „–" variant the Regal card and the
      // game's own badge use. Those two answer „what does this game score?",
      // where „nothing yet" is the answer; a stamp asks what happened on ONE
      // evening, and an evening nobody rated simply has no number to print. The
      // absent pill says that more quietly than a dash does, and at 150px the
      // quiet version is the one that fits (operator decision, 2026-09-12,
      // overriding this issue's own acceptance criterion).
      const scoreCell =
        sst.avg !== null
          ? `<span class="score-pill" style="background:${scoreColor(sst.score)}">${fmtAvg(displayScore(sst.score))}</span>`
          : '';
      // The ink is how the evening went for this game. Usually that is the
      // score it earned there — but a game the round CHOSE and played without
      // rating is not a blank: being put on the table is revealed preference,
      // which is why `vote-score.js` lifts a game's shelf score by its plays at
      // all. So it is stamped in the ink of a strong evening.
      //
      // NOT the top of the ramp, and it prints no pill: a game can win the draw
      // for fitting the player count, so „chosen" is weaker than „everyone gave
      // it a 5". Read off avgColor() rather than written as a hex, so a retune
      // of the ramp carries this with it (.claude/rules/theme-derived-colors.md).
      const PLAYED_UNRATED = 4.5;
      // An evening this game was NOT taken to has nothing to say about it and
      // borrows no colour: `--sc` falls through to the stylesheet's `--ink-soft`.
      const ink = picked
        ? `--sc:${scoreColor(sst.avg !== null ? sst.score : PLAYED_UNRATED)};`
        : '';
      // The pill rides the LAST text line, not the date's. A date is one
      // unbreakable token — „01.06.2026" measures 125px at 22px display type,
      // against a 130px content box at the 150px grid minimum — so a pill lane
      // beside it does not fit in any locale, and the token cannot wrap out of
      // the way. Measured in WebKit at both breakpoints; see the CSS.
      const row = h(`<a class="stamp${picked ? '' : ' stamp--muted'}" style="${ink}--i:${Math.min(i, STAGGER_LAST)}">
           <div class="stamp__date">${esc(fmtDate(s.createdAt))}</div>
           <div class="stamp__foot">
             <div class="stamp__lines">
               <div class="stamp__status">${status}</div>
               ${winner}
             </div>
             ${scoreCell}
           </div>
         </a>`);
      navLink(row, resultsPath(round.id, s.id), () => showResults(round, s));
      list.appendChild(row);
    });
    sec.appendChild(list);
  }
  if (!sparse && !game.wish) rightPage.appendChild(sec);

  // The one action, alone in a bar at the foot of the right page (#1039). It
  // used to be the first of three equally-weighted full-width buttons — 167px of
  // phone viewport for „Jetzt spielen", „Aussortieren" and „Durchgespielt", of
  // which one is what anybody came for.
  //
  // A game is Active, Retired, Completed (#250) or Wished-for (#560), and the
  // repo enforces that those four are mutually exclusive — so the branches are
  // too: a game that is off the shelf offers only the way onto it.
  const bar = h('<div class="gd-bar"></div>');
  // Move the game onto the shelf, out of whichever state it is in. `opts` exists
  // for the wish list alone (see its branch below); the two archives take the
  // defaults.
  const restoreFrom = (kind, endpoint, body, opts = {}) => {
    const icon = opts.icon || 'ti-arrow-back-up';
    const label = opts.label || t('detail.restore');
    const restore = h(`<button class="btn btn--lg"><i class="ti ${icon}" aria-hidden="true"></i> ${esc(label)}</button>`);
    restore.addEventListener('click', async () => {
      try {
        await api('POST', `/api/rounds/${rid}/games/${gameId}/${endpoint}`, body);
        toast(t(`${kind}.restored`, { title: game.title }));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message); }
    });
    bar.appendChild(restore);
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
    const play = h(`<button class="btn btn--primary btn--lg"><i class="ti ti-player-play" aria-hidden="true"></i> ${esc(t('directPlay.button'))}</button>`);
    play.addEventListener('click', () => startDirectSession(round, game));
    bar.appendChild(play);
  }
  rightPage.appendChild(bar);

  app.appendChild(pass);

  // =================== The page menu (#1039) ===================
  //
  // The three rare things this screen can do, out of the action row and into a
  // „…" at the top right of the back row: two state flips that are the opposite
  // of playing, and one that undoes an import. They do not belong beside the
  // play button (operator decision), and each keeps its existing confirm sheet
  // verbatim.
  const menuItems = [];
  if (!game.retired && !game.completed && !game.wish) {
    menuItems.push(['ti-trash', t('detail.retire'), 'popover__opt--warn', async () => {
      if (!await confirmDialog({
        body: t('detail.retireConfirm', { title: game.title }),
        confirmLabel: t('detail.retire'), icon: 'ti-trash',
      })) return;
      try {
        await api('POST', `/api/rounds/${rid}/games/${gameId}/retire`, { retired: true });
        toast(t('games.retired', { title: game.title }));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message); }
    }]);
    menuItems.push(['ti-circle-check', t('detail.complete'), 'popover__opt--good', async () => {
      if (!await confirmDialog({
        body: t('detail.completeConfirm', { title: game.title }),
        confirmLabel: t('detail.complete'), icon: 'ti-circle-check', danger: false,
      })) return;
      try {
        await api('POST', `/api/rounds/${rid}/games/${gameId}/complete`, { completed: true });
        toast(t('games.completed', { title: game.title }));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message); }
    }]);
  }
  if (game.source) {
    const provider = providerLabel(game.source.provider);
    menuItems.push(['ti-unlink', t('detail.unlinkProvider'), 'popover__opt--muted', async () => {
      // Only a hotlinked provider cover is dropped with the link; the member's
      // own upload is kept, so the two wordings must not be swapped.
      const ownUpload = typeof game.image === 'string' && game.image.startsWith('/uploads/');
      const key = game.image && !ownUpload ? 'detail.unlinkConfirmCover' : 'detail.unlinkConfirm';
      if (!await confirmDialog({
        body: t(key, { provider }),
        confirmLabel: t('detail.unlinkProvider'), icon: 'ti-unlink',
      })) return;
      try {
        await api('PATCH', `/api/rounds/${rid}/games/${gameId}`, { removeSource: true });
        toast(t('detail.toast.unlinked'));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message); }
    }]);
  }
  if (menuItems.length) {
    back.classList.add('back-row--split');
    const menuBtn = h(`<button type="button" class="btn btn--sm gd-menu" aria-label="${esc(t('detail.moreActions'))}" aria-expanded="false"><i class="ti ti-dots" aria-hidden="true"></i></button>`);
    // Buttons only, so this is a popover at EVERY width — the account menu's
    // case, not the editors' (.claude/rules/popover-vs-sheet-editors.md §2b).
    // `aria-expanded` is synced through openPopover's onClose rather than by
    // wrapping `close`: the wrapped form misses four of the six exits (Escape,
    // a backdrop tap, Back, the page scroll that tears a popover down) and
    // leaves the trigger claiming a panel that is gone.
    menuBtn.addEventListener('click', () => {
      openPopover(menuBtn, (el, close) => {
        el.classList.add('popover--menu');
        menuItems.forEach(([icon, label, cls, run]) => {
          const b = h(`<button class="popover__opt ${cls}"><i class="ti ${icon}" aria-hidden="true"></i> ${esc(label)}</button>`);
          b.addEventListener('click', () => { close(); run(); });
          el.appendChild(b);
        });
      }, () => menuBtn.setAttribute('aria-expanded', 'false'));
      menuBtn.setAttribute('aria-expanded', 'true');
    });
    back.appendChild(menuBtn);
  }
}
