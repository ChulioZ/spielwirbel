/* Spielwirbel – the game page's four field editors (#968).
 *
 * Split out of views-round-detail.js, which was 1015 lines with ~880 of them
 * inside `showGameDetail` alone: #967 had already moved everything that could be
 * moved BETWEEN files, and the remaining seam ran INSIDE that function.
 *
 * These four are the part of it that is genuinely independent — each is edited
 * on its own, each goes through the shared `openEditor`, and each closed over
 * the same handful of values. Everything else in `showGameDetail` (the hero, the
 * score ring, the action row, the related list) is one render flow and stays
 * where it is: that is the `views-session.js` shape, which the same audit looked
 * at and deliberately left alone.
 *
 * ONE CONTEXT OBJECT, THE SAME FOR ALL FOUR, and that uniformity is the point of
 * the refactor rather than a side effect: these used to be closures, so a reader
 * had to work out what each one reached for. `{ rid, round, game, updateGame,
 * refresh }` is learned once and reused — the consistency dimension in
 * `.claude/rules/token-friendly-source-files.md`.
 *
 * `refresh` rather than calling `showGameDetail` directly: that function lives in
 * the file this was split out of, and passing it in keeps the dependency one-way.
 * A behaviour change is out of scope here — all four do exactly what they did.
 *
 * Part of the frontend; all files share one global script scope (load order: see
 * index.html). */

function openPlayersPopover(ctx, anchor) {
  const { game, updateGame } = ctx;
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
function openOwnersPopover(ctx, anchor) {
  const { round, game, updateGame } = ctx;
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
function openTagsPopover(ctx, anchor) {
  const { rid, round, game, updateGame } = ctx;
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
function openImagePopover(ctx, anchor) {
  const { rid, game, updateGame, refresh } = ctx;
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
          await api('POST', `/api/rounds/${rid}/games/${game.id}/cover/provider?lang=${encodeURIComponent(getLocale())}`);
          toast(t('detail.toast.coverFetched', { provider: prov }));
          refresh();
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
//
// Derived per call from `ctx.game` rather than held at module scope: this used
// to be one `const` inside `showGameDetail`, shared by the editor AND by the
// chip the view still renders. Splitting the file split that scope, so each side
// derives it from the same `game` — one line, and the alternative (passing it
// through the context) would put a value in there that is a pure function of
// another value already in there.

// Send the whole list — the route replaces it wholesale, because "here is the
// set we own" is what the tick-list expresses.
async function saveExpansions(ctx, list) {
  const { rid, game, refresh } = ctx;
  try {
    await api('PUT', `/api/rounds/${rid}/games/${game.id}/expansions`, { expansions: list });
    toast(t('detail.toast.expansionsSaved'));
    refresh();
  } catch (e) {
    toast(e.message === 'quota_expansions' ? t('detail.toast.expansionQuota') : e.message);
  }
}

/* BGG names an expansion in full — „Carcassonne: Erweiterung 1 – Wirtshäuser
   und Kathedralen" — so every candidate row repeats the base title that is
   already the page's <h1> two elements above. On a 312px phone row that is a
   third of the line spent on a word the user is looking at: measured over 12
   real Carcassonne candidates, 903px of list -> 768px (−15 %). In the 640px
   dialog the editor presents as since #1143 the saving is smaller, because most
   names are one line there already — it is the phone the trim is for.

   DISPLAY ONLY. The PUT sends `{ providerId }` and the server resolves the
   title from the provider, so what gets stored is untouched — and a hand-typed
   entry never comes through here at all.

   The separator must be present: a candidate merely STARTING with the base word
   („Catan Das Duell") is a different game, not a suffix, and is left whole. */
function expansionLabel(baseTitle, title) {
  const base = (baseTitle || '').trim();
  if (!base || title.length <= base.length) return title;
  if (title.slice(0, base.length).toLowerCase() !== base.toLowerCase()) return title;
  // `\S` so a title that is nothing but the base plus punctuation keeps its
  // own text rather than rendering as an empty row.
  const rest = /^\s*[:\u2013\u2014-]\s*(\S.*)$/.exec(title.slice(base.length));
  return rest ? rest[1] : title;
}

// The per-game expansion ceiling, from GET /api/config at boot (core.js). Module
// state rather than a value threaded through the context: the dialog reads it at
// render time, which keeps it clear of the load-order trap
// (.claude/rules/frontend-script-load-order.md) — core.js loads first and calls
// this from inside its fetch callback.
//
// `null` is a real answer, not "not loaded yet": quotas are enforced only in
// accounts mode (lib/quota.js), so a self-hosted instance has no ceiling and the
// bar states a bare count instead of counting against a limit that does not
// exist. It stays null if the probe fails, which degrades the same way.
let expansionsCap = null;
function setExpansionsCap(n) {
  expansionsCap = Number.isInteger(n) && n > 0 ? n : null;
}

// Past this many rows the list stops being scannable and gets a filter field.
// Below it the field is pure chrome in a dialog whose whole point is height.
const EXPANSION_FILTER_FROM = 20;

/* Add: the provider's own list as a tick-list, plus a free-text field. The
   candidates cost no extra upstream request — they ride on the /thing body the
   detail hop already fetched (lib/routes/lookup.js).

   ONE LIST, ONE COMMIT (#1143). An expansion is in the cupboard or it is not, so
   owned entries and the provider's remaining candidates are the same row in two
   states — ticked and unticked — and „Übernehmen" sends the ticked set. That is
   the shape `PUT …/games/:gid/expansions` always had: it replaces the list
   wholesale, and the editor used to disagree with it, committing ticks on OK
   while firing a confirm dialog for every removal.

   Unticking therefore REPLACES removal, and the trade is deliberate: a removal
   is now silent until commit, where it used to raise a confirmation. The sticky
   count is what makes it visible, and dismissing the dialog is the undo — which
   is strictly better than a confirm the user had to answer before they could see
   what else they were about to change. */
function openExpansionEditor(ctx, anchor) {
  const { rid, game } = ctx;
  const owned = game.expansions || [];
  // Titled „Erweiterungen" rather than „Erweiterung hinzufügen" since #1039:
  // the editor absorbed the removed section's list, so it is no longer only an
  // add form — and that string is the dialog's accessible name.
  openEditor(anchor, 'expansions', t('detail.expansionsTitle'), (el, close) => {
    const canPick = game.source && typeof game.source.externalId === 'string'
      && game.source.provider === 'bgg';

    // One row per entry, in commit order: what is owned leads, the provider's
    // remaining candidates follow as they arrive. `picked` is keyed by the row's
    // own identity so an untick is reversible until commit.
    //   { key, label, meta, payload, picked }
    // `payload` is what the PUT carries for a ticked row — `{ id }` for
    // something already stored (the server keeps it verbatim), `{ providerId }`
    // for a candidate (the server resolves the title upstream, so the display
    // trim below never reaches the data).
    const rows = [];
    const listEl = h('<div class="exp-list"></div>');
    const noteEl = h('<div class="exp-note muted"></div>');
    let filterEl = null;
    let filterText = '';

    owned.forEach((e) => rows.push({
      key: 'id:' + e.id,
      label: e.title,
      meta: Number.isInteger(e.minPlayers) && Number.isInteger(e.maxPlayers)
        ? playersText(e.minPlayers, e.maxPlayers)
        : t('detail.expansionNoRange'),
      payload: { id: e.id },
      picked: true,
    }));

    const pickedCount = () => rows.filter((r) => r.picked).length
      + (nameEl.value.trim() ? 1 : 0);

    // The count and the ceiling, restated on every tick. This is the whole
    // reason the cap crosses to the client (#1143): it used to be reachable
    // only as `detail.toast.expansionQuota` AFTER a PUT the server refused.
    function paintBar() {
      const n = pickedCount();
      const over = expansionsCap !== null && n > expansionsCap;
      countEl.textContent = expansionsCap === null
        ? t('detail.expansionCount', { n })
        : t('detail.expansionCountMax', { n, max: expansionsCap });
      countEl.classList.toggle('exp-bar__count--over', over);
      // Refused before the request rather than after it — the bar has already
      // said why, so a toast would only repeat it.
      okBtn.disabled = over;
    }

    function paintList() {
      const q = filterText.trim().toLowerCase();
      const shown = q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;
      listEl.replaceChildren();
      if (!shown.length) {
        if (q) listEl.appendChild(h(`<div class="muted">${esc(t('detail.expansionFilterEmpty'))}</div>`));
        return;
      }
      shown.forEach((r) => {
        // A <label> row, so the whole line toggles its checkbox — and it must
        // NOT sit inside a `.field`, where `.field label` (0,1,1) would flatten
        // it (.claude/rules/label-rows-lose-to-field-label.md). `.ds-row--picked`
        // is the ticked state; it is the app's existing "this one is selected"
        // treatment, which is what lets one row carry both states without a
        // second component (.claude/rules/ds-row-is-a-click-target.md — a
        // <label> row is genuinely clickable and takes no `--static`).
        const row = h(`<label class="ds-row exp-row${r.picked ? ' ds-row--picked' : ''}">
             <span class="ds-row__main">
               <span class="ds-row__title">${esc(r.label)}</span>
               ${r.meta ? `<span class="muted">${esc(r.meta)}</span>` : ''}
             </span>
             <span class="ds-row__meta"><input type="checkbox"${r.picked ? ' checked' : ''} /></span>
           </label>`);
        row.querySelector('input').addEventListener('change', (ev) => {
          r.picked = ev.target.checked;
          row.classList.toggle('ds-row--picked', r.picked);
          paintBar();
        });
        listEl.appendChild(row);
      });
    }

    el.appendChild(listEl);
    el.appendChild(noteEl);

    if (canPick) {
      const prov = providerLabel(game.source.provider);
      noteEl.textContent = t('detail.expansionPickLoading', { provider: prov });
      api('GET', `/api/rounds/${rid}/lookup/expansions?provider=${encodeURIComponent(game.source.provider)}&id=${encodeURIComponent(game.source.externalId)}`)
        .then((res) => {
          const have = new Set(owned.map((e) => (e.source || {}).externalId).filter(Boolean));
          const fresh = (res.expansions || []).filter((c) => !have.has(c.providerId));
          if (!fresh.length) {
            noteEl.textContent = t('detail.expansionPickEmpty', { provider: prov });
            return;
          }
          noteEl.textContent = '';
          fresh.forEach((c) => rows.push({
            key: 'p:' + c.providerId,
            label: expansionLabel(game.title, c.title),
            meta: '',
            payload: { providerId: c.providerId },
            picked: false,
          }));
          // Only now is the merged length known, so the filter can only be
          // decided here — it is the candidates that make the list long.
          if (rows.length > EXPANSION_FILTER_FROM && !filterEl) {
            filterEl = h(`<input class="input exp-filter" type="search" autocomplete="off"
                 placeholder="${esc(t('detail.expansionFilterPlaceholder'))}"
                 aria-label="${esc(t('detail.expansionFilterPlaceholder'))}" />`);
            filterEl.addEventListener('input', () => { filterText = filterEl.value; paintList(); });
            el.insertBefore(filterEl, listEl);
          }
          paintList();
        })
        .catch(() => { noteEl.textContent = t('detail.expansionPickError', { provider: prov }); });
    }

    /* The rare question, behind a disclosure (#1143). It used to be a
       permanently open 157px form — a third of the card — for the one input
       most opens never touch.

       A native <details>: focusable, Enter/Space-activated and toggled by the
       platform, none of which a hand-rolled `aria-expanded` button gets for
       free (.claude/rules/native-button-vs-focusable-span.md, and the same call
       bgg-import.js's „already on the shelf" section makes). */
    const own = h(`<details class="exp-own">
         <summary class="exp-own__head">${esc(t('detail.expansionOwnTitle'))}</summary>
         <div class="exp-own__body">
           <input class="input exp-own__name" maxlength="${EXPANSION_TITLE_MAX}" placeholder="${esc(t('detail.expansionNamePlaceholder'))}" />
           <div class="pp-row exp-own__range" hidden></div>
           <div class="muted popover__hint">${esc(t('detail.expansionRangeHint'))}</div>
         </div>
       </details>`);
    // Nothing owned and no provider to ask: the free-text form is the only thing
    // on offer, so it opens with the dialog rather than hiding the one action
    // behind a disclosure over an empty list.
    if (!canPick && !owned.length) own.open = true;
    const nameEl = own.querySelector('.exp-own__name');
    const min = h('<input class="input" inputmode="numeric" />');
    const max = h('<input class="input" inputmode="numeric" />');
    [min, max].forEach((inp) => inp.addEventListener('input', () => {
      const digits = inp.value.replace(/\D/g, '');
      if (inp.value !== digits) inp.value = digits;
    }));
    const range = own.querySelector('.exp-own__range');
    range.append(min, h('<span>–</span>'), max);
    // The range only means anything once there is something to range over, so
    // the two fields appear with the name rather than before it. `hidden` alone
    // would lose to `.pp-row`'s own `display: flex`, hence the paired
    // `[hidden]` rule in the stylesheet
    // (.claude/rules/hidden-attribute-vs-display-rule.md).
    nameEl.addEventListener('input', () => {
      range.hidden = !nameEl.value.trim();
      paintBar();
    });
    el.appendChild(own);

    const countEl = h('<span class="exp-bar__count"></span>');
    const okBtn = h(`<button class="btn btn--primary">${esc(t('detail.expansionApply'))}</button>`);
    const bar = h('<div class="toolbar sheet__actions exp-bar"></div>');
    bar.append(countEl, okBtn);
    okBtn.addEventListener('click', () => {
      const list = rows.filter((r) => r.picked).map((r) => r.payload);
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
      } else if (rows.every((r) => r.picked === (r.payload.id !== undefined))) {
        // Every owned row still ticked and no candidate ticked: the set is what
        // it was when the dialog opened, so there is nothing to PUT.
        return close();
      }
      close();
      saveExpansions(ctx, list);
    });
    el.appendChild(bar);

    paintList();
    paintBar();
    // No autofocus: the list is the thing to read, and on a phone focusing the
    // free-text field inside a <details> nobody opened would raise the keyboard
    // over it.
    return null;
    // `{ list: true }` — a scanning list is a centred dialog at every width, not
    // an anchored card. See openEditor in sheet.js for the measurement.
  }, undefined, { list: true });
}
