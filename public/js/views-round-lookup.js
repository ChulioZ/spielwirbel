/* Spielwirbel – views: the two lookup SHEETS — add a game, and link an existing
   game to a provider. Loaded after views-round.js; shares one global script
   scope.

   #956 took the three things here that were not those sheets: the lookup control
   itself became lookup.js, the BGG collection import bgg-import.js, and
   „Jetzt spielen" direct-session.js. */


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
            <input id="newTag" class="input" placeholder="${esc(t('tags.addPlaceholder'))}"
                   aria-label="${esc(t('tags.addPlaceholder'))}" style="flex:1" autocomplete="off" />
            <button type="button" id="addTagBtn" class="btn">${esc(t('tags.add'))}</button>
          </div>
        </div>
        ${wish ? '' : `<div class="field" id="ownerField">
          <label>${esc(t('addGame.ownersLabel'))}</label>
          <div class="filter-chips" id="ownerSeg"></div>
        </div>`}
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

  // Who owns the box (#971). Not offered for a WISH — the round does not own the
  // game yet, so the question has no answer; the route drops the field for a
  // wish anyway, so the two agree rather than one silently ignoring the other.
  const selectedOwnerIds = new Set(wish ? [] : ownerPresetFor(round, currentUserId()));
  const ownerSeg = form.querySelector('#ownerSeg');
  if (ownerSeg) {
    ownerSeg.replaceWith(renderOwnerChips(round, selectedOwnerIds));
    // A round with no members has nobody to pick, so the whole field goes rather
    // than leaving a labelled empty box — the same thing the tag field does with
    // no round tags.
    const ownerField = form.querySelector('#ownerField');
    if (!activeMembers(round).length) ownerField.remove();
  }

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
    selectedOwnerIds.forEach((x) => fd.append('ownerIds', x));
    // Only sent when true: the route coerces anything unrecognised to false, so
    // an omitted field and 'false' mean the same thing, and omitting keeps the
    // ordinary add-game request byte-identical to what it has always been.
    if (wish) fd.append('wish', 'true');
    if (pastedBlob) {
      // Pre-flight against the shared cap so an oversize screenshot is refused
      // here, with a message that states the limit, rather than after the whole
      // blob has gone up the wire to be 413'd (#867).
      if (pastedBlob.size > COVER_MAX_BYTES) return toast(t('cover.tooLarge', { mb: COVER_MAX_MB }));
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
    } catch (e) {
      // cover_too_large is the server's answer when the pre-flight above was
      // bypassed (a stale tab, a client that skipped it); same message either way.
      if (e.message === 'cover_too_large') return toast(t('cover.tooLarge', { mb: COVER_MAX_MB }));
      toast(e.message === 'quota_games' ? t('addGame.toast.quota') : e.message);
    }
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
        if (key === 'weight') return { from: notSet, to: t('gameInfo.weightValue', { n: fmtAvg(d.weight) }) };
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

