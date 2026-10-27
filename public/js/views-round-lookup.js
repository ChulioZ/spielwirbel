/* Spielwirbel – views: the add-game lookup SHEET. Loaded after views-round.js;
   shares one global script scope. The other lookup sheet, linking an existing
   game to a provider, is views-game-link.js since #1681.

   #956 took the three things here that were not those sheets: the lookup control
   itself became lookup.js, the BGG collection import bgg-import.js, and
   „Jetzt spielen" direct-session.js. */


// Opens as a bottom sheet over the current screen (usually the Regal).
//
// `wish` (#560) creates onto the Wunschliste instead of the shelf. It is the same
// sheet throughout — the lookup, the cover, the player range and the tags are
// exactly as useful for a game the group wants as for one they own — so only the
// wording, the POST field and where dismissing returns to differ.
//
// Der Tisch composes this step differently (#1264, T3.5/T6.4): it opens on a
// search with a result list, and this form is its „Selbst eintragen" branch.
// Every entry point calls showAddGame, so the design decides here and nowhere
// else; Klassisch goes straight to the form, exactly as before.
function showAddGame(round, opts = {}) {
  // Ocean draws the same search-first step (#1212, O3.5/O6.4), and so does Das
  // Programmheft (#1373, P3.5/P6.4 — programmheft.css styles it), and Die
  // Brücke (#1239, B6.4 — bruecke.css), and Forest (#1467, F3.5/F6.4 —
  // forest.css).
  // A guest's game (#1681) always takes the form: its lookup is the search, and
  // the search-first step's shelf/wish row states mean nothing for a visitor's box.
  if (opts.guest) return showAddGameForm(round, opts);
  if (['tisch', 'ocean', 'programmheft', 'bruecke', 'forest'].some(designIs)) return showAddGameSearch(round, opts);
  return showAddGameForm(round, opts);
}

// The form itself. `title` prefills the title field — the query Der Tisch's
// search step hands over when the person chooses to enter the game themselves;
// `hit` is a search result that step hands over instead, and the form fills
// itself from it exactly as picking that suggestion here would; `dirty` says
// that step already changed the shelf, so dismissing this form must re-render
// the screen behind it just as if the form had added a game itself.
//
// `guest` (#1681) is the session setup's guest-game mode: `{ name, onCreated }`.
// The game is created as a guest game (off the shelf, no owners, no tags — the
// draw never applies the tag filter to it), and a save hands the row to
// `onCreated` instead of navigating, because the screen behind this sheet is the
// half-filled setup, which a re-render would wipe. The server REUSES an earlier
// guest game of the same title, so `onCreated` may receive an existing row.
// With `name: null` it is the Start tab's „Ein Spiel, das ihr nicht habt"
// (#1682): a guest game nobody in particular brought, played straight away.
function showAddGameForm(round, { wish = false, title = '', hit = null, dirty = false, guest = null } = {}) {
  let sheetTitle = wish ? t('addGame.wishTitle') : t('addGame.title');
  if (guest) sheetTitle = guest.name ? t('guestGames.addTitle', { name: guest.name }) : t('directPlay.notOwned');
  const back = guest ? undefined : wish ? () => showWishlist(round.id) : () => showRound(round.id, 'regal');
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(sheetTitle)}">
        <div class="sheet__head">
          <h2>${esc(sheetTitle)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="field">
          <label for="title">${esc(t('addGame.titleLabel'))}</label>
          <div class="lookup" id="lookup">
            <input id="title" class="input" placeholder="${esc(t('addGame.titlePlaceholder'))}" autocomplete="off" aria-describedby="dupHint" autocorrect="off" spellcheck="false" />
            <div class="lookup__menu" id="lookupMenu" hidden></div>
          </div>
          <div class="muted field__hint">${esc(t('addGame.searchHint'))}</div>
          <div class="field__hint field__hint--dup" id="dupHint" role="status" aria-live="polite" aria-atomic="true"></div>
        </div>
        ${canImportBgg() && !guest ? `<div class="toolbar" style="margin:-8px 0 18px">
          <button type="button" id="bggImportFromAdd" class="link-btn"><i class="ti ti-download" aria-hidden="true"></i> ${esc(wish ? t('bggImport.wishLink') : t('bggImport.link'))}</button>
        </div>` : ''}
        <div class="field">
          <label>${esc(t('addGame.playersLabel'))}</label>
          <div class="stepper-row">
            <div class="stepper" data-for="minPlayers">
              <button type="button" class="stepper__btn" data-d="-1" aria-label="${esc(t('addGame.minPlayersDown'))}"><i class="ti ti-minus" aria-hidden="true"></i></button>
              <input id="minPlayers" class="stepper__val" inputmode="numeric" value="2" aria-label="${esc(t('addGame.minPlayersPlaceholder'))}" />
              <button type="button" class="stepper__btn" data-d="1" aria-label="${esc(t('addGame.minPlayersUp'))}"><i class="ti ti-plus" aria-hidden="true"></i></button>
            </div>
            <span class="muted">–</span>
            <div class="stepper" data-for="maxPlayers">
              <button type="button" class="stepper__btn" data-d="-1" aria-label="${esc(t('addGame.maxPlayersDown'))}"><i class="ti ti-minus" aria-hidden="true"></i></button>
              <input id="maxPlayers" class="stepper__val" inputmode="numeric" value="4" aria-label="${esc(t('addGame.maxPlayersPlaceholder'))}" />
              <button type="button" class="stepper__btn" data-d="1" aria-label="${esc(t('addGame.maxPlayersUp'))}"><i class="ti ti-plus" aria-hidden="true"></i></button>
            </div>
            <span class="muted">${esc(t('addGame.playersUnit'))}</span>
          </div>
        </div>
        <div class="field"${guest ? ' hidden' : ''}>
          <label>${esc(t('addGame.tagsLabel'))}</label>
          <div class="filter-chips" id="tagSeg" hidden></div>
          <div class="toolbar" style="margin-top:6px">
            <input id="newTag" class="input" maxlength="${TAG_NAME_MAX}" placeholder="${esc(t('tags.addPlaceholder'))}"
                   aria-label="${esc(t('tags.addPlaceholder'))}" style="flex:1" autocomplete="off" autocorrect="off" spellcheck="false" />
            <button type="button" id="addTagBtn" class="btn">${esc(t('tags.add'))}</button>
          </div>
        </div>
        ${wish || guest ? '' : `<div class="field" id="ownerField">
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
          ${guest ? '' : `<button id="saveMore" class="btn btn--lg">${esc(t('addGame.saveMore'))}</button>`}
        </div>
      </div>
    </div>`);
  const form = backdrop.querySelector('.sheet');
  document.body.appendChild(backdrop);

  // Games added via "Speichern & weiteres" keep the sheet open, so the Regal
  // behind it is only re-rendered when the sheet is finally dismissed. Track
  // whether any game was added while open and refresh on every close path.
  let addedWhileOpen = dirty;
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
  const selectedOwnerIds = new Set(wish || guest ? [] : ownerPresetFor(round, currentUserId()));
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
    } catch (e) { toast(e.message === 'quota_tags' ? t('tags.toast.quota') : e.message, { tone: 'error' }); }
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

  // Bumped by every change of the cover, so a FileReader still in flight for an
  // older paste cannot repaint over a clear, a newer paste or an edition pick.
  let previewSeq = 0;

  function setImage(blob) {
    const seq = ++previewSeq;
    chosenImageUrl = null; // a pasted/cleared image overrides a provider cover
    chosenEdition = null; // …and so is not any BGG printing (#742)
    if (coverPicker) coverPicker.setCurrent(null);
    pastedBlob = blob;
    if (blob) {
      // A data: URL, not URL.createObjectURL: the CSP's img-src (lib/app.js)
      // allows data: and deliberately not blob:, so a blob preview is refused
      // by the browser while the upload (which sends pastedBlob) works (#1612).
      const reader = new FileReader();
      reader.onload = () => { if (seq === previewSeq) preview.src = reader.result; };
      reader.readAsDataURL(blob);
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
    previewSeq++;
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
      toast(t('lookup.error'), { tone: 'error' });
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
    if (guest) fd.append('guestGame', 'true');
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
      if (guest) {
        // No toast for the nameless mode: the direct-play sheet opening on the
        // game is the confirmation.
        if (guest.name) toast(t('guestGames.toast.brought', { title: created.title, name: guest.name }), { tone: 'success' });
        guest.onCreated(created);
        return;
      }
      addedGames.push({ title: (created && created.title) || title });
      toast(wish ? t('addGame.toast.savedWish') : t('addGame.toast.saved'), { tone: 'success' });
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
      if (e.message === 'cover_too_large') return toast(t('cover.tooLarge', { mb: COVER_MAX_MB }), { tone: 'error' });
      toast(e.message === 'quota_games' ? t('addGame.toast.quota') : e.message, { tone: 'error' });
    }
  }
  form.querySelector('#save').addEventListener('click', () => save(false));
  const saveMore = form.querySelector('#saveMore');
  if (saveMore) saveMore.addEventListener('click', () => save(true));
  // A handed-over query is a starting point, not a lookup pick: no provider is
  // linked, so the dup hint is the only thing it should wake.
  if (title) {
    titleInput.value = title;
    refreshDupHint();
  }
  form.querySelector('#title').focus();
  if (hit) pickSuggestion(hit);
}
