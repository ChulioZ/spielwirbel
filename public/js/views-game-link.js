/* Spielwirbel – views: the sheet that links an existing game to a provider
   (issue #74). Split out of views-round-lookup.js (#1681), which keeps the
   add-game sheet: the two share the lookup control (lookup.js) and nothing
   else. Shares one global script scope.

   Frontend shared-scope script; load order: see index.html. */

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
            <input id="linkTitle" class="input" placeholder="${esc(t('addGame.titlePlaceholder'))}" autocomplete="off" autocorrect="off" spellcheck="false" />
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
      toast(t('lookup.error'), { tone: 'error' });
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
    } catch (e) { toast(e.message, { tone: 'error' }); }
  }

  input.focus();
  input.select();
}

