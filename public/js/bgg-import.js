'use strict';

/* The one-shot BoardGameGeek collection import (#481): the account gate, the
   picker over the owned and wish shelves, and the error phrasing.

   Split out of views-round-lookup.js by #956 — a self-contained feature reached
   from the Regal, the archive and the recommendations screen, sharing nothing
   with the add-game sheet but the file it happened to sit in. Its traps (the
   status in the cache key, the two shelves, the bulk write) are
   `.claude/rules/bgg-collection-import.md`; its specs are test/bgg-import.test.js.
   No `module.exports`: DOM. */

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
    // Who owns the imported boxes (#971) — ONE selection for the whole batch,
    // like the wish/own status itself: nobody fills in a per-game owner picker
    // over 200 rows. Not offered on the WISHLIST import, whose rows the round
    // does not own; the route drops the field there too.
    const selectedOwnerIds = new Set(wish ? [] : ownerPresetFor(round, currentUserId()));
    if (!wish && (round.members || []).length) {
      const field = h(`<div class="field"><label>${esc(t('bggImport.ownersLabel'))}</label></div>`);
      field.appendChild(renderOwnerChips(round, selectedOwnerIds));
      body.appendChild(field);
    }
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
        const res = await api('POST', `/api/rounds/${round.id}/lookup/import?provider=bgg&status=${status}`, { externalIds: ids, covers, editions, ownerIds: [...selectedOwnerIds] });
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
