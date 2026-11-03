'use strict';

/* „Aus Myludo importieren" (#1758): a Myludo collection export (JSON) onto the
   Regal. Reached from the add-game sheet beside the BGG import, in every
   design, and — unlike the BGG import — without an account: the file is the
   user's own, so nothing hangs off a linked handle.

   One sheet, four states: file → matching → preview → done. The file is
   parsed here and never uploaded; each game is searched on BoardGameGeek
   through the ordinary lookup search, the matches' covers come from
   GET …/lookup/cards, and only the picked rows go to POST …/games/import. The
   pure half is myludo-import.js and is tested there; this file only renders.
   No `module.exports`: DOM. */

// Searches in flight at once. The lookup search is cached and BGG-friendly
// one at a time, but a few hundred titles in strict sequence would take
// minutes — two keeps a 200-game shelf to well under the global rate limit
// (1000 per 15 minutes) and BGG's own throttling.
const MYLUDO_SEARCH_CONCURRENCY = 2;

async function showMyludoImport(round) {
  const title = t('myludoImport.title');
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog sheet--list" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__head">
          <h2>${esc(title)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="bgg-import myludo-import"></div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  const body = backdrop.querySelector('.myludo-import');
  document.body.appendChild(backdrop);

  // Games written while the sheet was open only show once the Regal behind it
  // re-renders — through closeSheet, never on the line after it
  // (.claude/rules/sheet-history-back-dismissal.md). `closed` stops the search
  // loop from spending BGG's patience on a sheet nobody is looking at.
  let imported = false;
  let closed = false;
  const dismiss = () => {
    closed = true;
    closeSheet(imported ? () => showRound(round.id, 'regal') : undefined);
  };
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  sheet.querySelector('.sheet__close').addEventListener('click', dismiss);

  const msg = (text, hint, icon = 'ti-alert-triangle') => h(`<div class="bgg-import__msg">
      ${formSheetDesign() ? `<span class="sheet-disc" aria-hidden="true"><i class="ti ${icon}"></i></span>` : ''}<p>${esc(text)}</p>${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
    </div>`);

  // --- step 1: the file -------------------------------------------------------

  function renderFile(errorText) {
    body.replaceChildren();
    if (errorText) body.appendChild(msg(errorText, null, 'ti-file-alert'));
    body.appendChild(h(`<p class="muted">${esc(t('myludoImport.intro'))}</p>`));
    const file = h('<input type="file" accept=".json,application/json" hidden />');
    file.addEventListener('change', () => { if (file.files[0]) loadFile(file.files[0]); });
    const pick = h(`<button type="button" class="ds-row play-import__source">
        <span class="ds-row__main"><i class="ti ti-file-upload" aria-hidden="true"></i>
          <span><strong>${esc(t('myludoImport.choose'))}</strong><span class="muted">${esc(t('myludoImport.privacy'))}</span></span>
        </span>
      </button>`);
    pick.addEventListener('click', () => file.click());
    const opts = h('<div class="play-import__sources"></div>');
    opts.append(pick, file);
    body.appendChild(opts);
  }

  async function loadFile(f) {
    let rows;
    try {
      rows = parseMyludoShelf(await f.text());
    } catch (err) {
      // A wrong file is the user's to fix and says so; anything else is ours.
      const code = err && err.message;
      const wrongFile = code === 'not_myludo' || (err && err.name === 'SyntaxError');
      if (!wrongFile && code !== 'too_many') reportClientError('myludo_import_parse', err);
      renderFile(code === 'too_many' ? t('myludoImport.error.tooMany', { max: MYLUDO_IMPORT_MAX })
        : t(wrongFile ? 'myludoImport.error.notMyludo' : 'myludoImport.error.read'));
      return;
    }
    if (!rows.length) return renderFile(t('myludoImport.empty'));
    match(rows);
  }

  // --- step 2: match every game on BGG ----------------------------------------

  // Per row: the search hits (for the picker), the current choice and whether
  // it was a sure match. Expansion rows are not searched: they are stored on
  // their base game, where a title is all an owned expansion needs.
  const hitsOf = new Map();
  const choices = new Map();
  const unsure = new Set();
  const cardOf = new Map(); // BGG id -> { minPlayers, maxPlayers, imageUrl }

  async function match(rows) {
    const games = rows.filter((r) => !r.expansion);
    const progress = h('<p class="muted" role="status" aria-live="polite"></p>');
    body.replaceChildren(progress);
    let done = 0;
    let unreachable = false;
    const say = () => { progress.textContent = t('myludoImport.matching', { n: done, total: games.length }); };
    say();
    const queue = games.slice();
    const worker = async () => {
      while (queue.length && !closed) {
        const r = queue.shift();
        let hits = [];
        if (!unreachable) {
          try {
            hits = (await api('GET', `/api/rounds/${round.id}/lookup/search?provider=bgg&q=${encodeURIComponent(r.title)}`)).results || [];
          } catch {
            // One outage is every search's outage: stop asking, import the rest
            // unlinked. A search failure is the server's to log, not ours.
            unreachable = true;
          }
        }
        const m = myludoMatch(r, hits);
        hitsOf.set(r.key, hits);
        choices.set(r.key, m.hit ? { bggId: m.hit.providerId, title: m.hit.title, year: m.hit.year } : null);
        if (m.hit && !m.sure) unsure.add(r.key);
        done += 1;
        say();
      }
    };
    await Promise.all(Array.from({ length: MYLUDO_SEARCH_CONCURRENCY }, worker));
    if (closed) return;
    await fetchCards([...choices.values()].filter(Boolean).map((c) => c.bggId));
    if (closed) return;
    renderPreview(rows, unreachable);
  }

  // Covers and BGG ranges for the matches, 20 ids a request (BGG's /thing
  // limit). A failure costs the pictures, never the import.
  async function fetchCards(ids) {
    const want = [...new Set(ids.map(String))].filter((id) => !cardOf.has(id));
    for (let i = 0; i < want.length && !closed; i += 20) {
      const slice = want.slice(i, i + 20);
      try {
        const res = await api('GET', `/api/rounds/${round.id}/lookup/cards?provider=bgg&ids=${slice.join(',')}`);
        (res.cards || []).forEach((c) => cardOf.set(String(c.providerId), c));
      } catch {
        return;
      }
    }
  }

  // --- step 3: the preview ------------------------------------------------------

  function renderPreview(rows, unreachable) {
    const shelf = round.games || [];
    const rowByKey = new Map(rows.map((r) => [r.key, r]));
    const presentOf = (r) => (r.expansion ? null : myludoShelfMatch(choices.get(r.key), r, shelf));
    // An expansion whose base row is already on the shelf joins THAT game.
    const attach = attachMyludoExpansions(rows, shelf);
    const baseOf = (r) => {
      const ref = attach.get(r.key);
      if (!ref || ref.gameId) return ref;
      const there = presentOf(rowByKey.get(ref.rowKey));
      return there ? { gameId: there.id } : ref;
    };
    const baseTitle = (ref) => (ref.gameId ? (shelf.find((g) => g.id === ref.gameId) || {}).title : rowByKey.get(ref.rowKey).title);

    const fresh = [];
    const present = [];
    const skipped = [];
    for (const r of rows) {
      if (r.expansion) (baseOf(r) ? fresh : skipped).push(r);
      else (presentOf(r) ? present : fresh).push(r);
    }

    const details = (label, list) => {
      const sec = h(`<details class="bgg-import__present">
          <summary class="bgg-import__present-head">${esc(label)}</summary>
          <ul class="bgg-import__present-list"></ul>
        </details>`);
      const ul = sec.querySelector('ul');
      list.forEach((r) => ul.appendChild(h(`<li class="bgg-import__present-item" title="${esc(r.title)}">${esc(r.title)}</li>`)));
      return sec;
    };

    if (!fresh.length) {
      body.replaceChildren(msg(t('bggImport.allPresent'), null, 'ti-circle-check'));
      if (present.length) body.appendChild(details(t('bggImport.presentSection'), present));
      if (skipped.length) body.appendChild(details(t('myludoImport.skippedSection'), skipped));
      return;
    }

    body.replaceChildren(h(`<p class="muted">${esc(tn(rows.length, 'myludoImport.foundOne', 'myludoImport.found'))} ${esc(t(unreachable ? 'myludoImport.unreachable' : 'myludoImport.checkHint'))}</p>`));
    const picker = h(`<div class="bgg-import__picker">
        <div class="move-list__head">
          <span class="bgg-import__count muted" aria-live="polite"></span>
          <button class="link-btn bgg-import__toggle" type="button"></button>
        </div>
        <div class="ds-list bgg-import__list" role="group" aria-label="${esc(t('bggImport.games'))}"></div>
      </div>`);
    const list = picker.querySelector('.bgg-import__list');

    fresh.forEach((r) => {
      // NOT wrapped in a .field — `.field label` flattens a .ds-row
      // (.claude/rules/label-rows-lose-to-field-label.md) — and the match
      // picker is a SIBLING of the <label>, or choosing a hit would toggle the
      // row (the BGG import's edition picker, for the same reason).
      const item = h(`<div class="bgg-import__item">
          <div class="bgg-import__lead">
            <span class="bgg-import__thumb"></span>
            <label class="ds-row bgg-import__row">
              <div class="ds-row__main">
                <span class="bgg-import__name" title="${esc(r.title)}">${esc(r.title)}</span>
                <span class="muted bgg-import__state"></span>
              </div>
              <div class="ds-row__meta">
                <input type="checkbox" class="provider-row__box" value="${esc(r.key)}" checked />
              </div>
            </label>
          </div>
        </div>`);
      const thumb = item.querySelector('.bgg-import__thumb');
      const state = item.querySelector('.bgg-import__state');
      const paint = () => {
        const c = choices.get(r.key);
        const card = c && cardOf.get(String(c.bggId));
        const cover = card && card.imageUrl;
        thumb.innerHTML = coverPlaceholder({ image: cover || null, title: r.title });
        thumb.style.backgroundImage = cover ? `url('${coverUrl(cover, COVER_THUMB)}')` : '';
        thumb.classList.toggle('has-image', !!cover);
        const range = card && card.minPlayers ? { min: card.minPlayers, max: card.maxPlayers || card.minPlayers } : r.players;
        const parts = [range ? t('bggImport.players', range) : ''];
        if (r.expansion) parts.push(t('myludoImport.expansionOf', { title: baseTitle(baseOf(r)) }));
        else if (!c) parts.push(t('myludoImport.noMatch'));
        else if (unsure.has(r.key)) parts.push(t('myludoImport.unsure'));
        state.textContent = parts.filter(Boolean).join(' · ');
      };
      paint();

      const hits = hitsOf.get(r.key) || [];
      if (!r.expansion && hits.length) {
        const sel = h(`<select class="input myludo-import__match" aria-label="${esc(t('myludoImport.matchLabel', { title: r.title }))}"></select>`);
        const label = (x) => (x.year ? `${x.title} (${x.year})` : x.title);
        hits.forEach((x) => sel.appendChild(h(`<option value="${esc(x.providerId)}">${esc(label(x))}</option>`)));
        sel.appendChild(h(`<option value="">${esc(t('myludoImport.unlinked'))}</option>`));
        const c = choices.get(r.key);
        sel.value = c ? String(c.bggId) : '';
        sel.addEventListener('change', async () => {
          const hit = hits.find((x) => String(x.providerId) === sel.value);
          choices.set(r.key, hit ? { bggId: hit.providerId, title: hit.title, year: hit.year } : null);
          // A choice made by hand is the user's — no longer "please check".
          unsure.delete(r.key);
          paint();
          if (hit && !cardOf.has(String(hit.providerId))) {
            await fetchCards([hit.providerId]);
            paint();
          }
        });
        item.appendChild(sel);
      }
      list.appendChild(item);
    });

    const go = h(`<div class="toolbar sheet__actions">
        <button class="btn btn--primary btn--lg bgg-import__go"><i class="ti ti-download" aria-hidden="true"></i> ${esc(t('bggImport.submit'))}</button>
      </div>`);
    body.appendChild(picker);
    // Before the actions bar, which is sticky and opaque — anything after it
    // scrolls underneath.
    if (present.length) body.appendChild(details(t('bggImport.presentSection'), present));
    if (skipped.length) body.appendChild(details(t('myludoImport.skippedSection'), skipped));
    body.appendChild(go);

    const boxes = [...list.querySelectorAll('input[type="checkbox"]')];
    const countEl = picker.querySelector('.bgg-import__count');
    const toggle = picker.querySelector('.bgg-import__toggle');
    const submit = go.querySelector('.bgg-import__go');
    const picked = () => new Set(boxes.filter((b) => b.checked).map((b) => b.value));
    const sync = () => {
      const n = picked().size;
      countEl.textContent = tn(n, 'bggImport.selectedOne', 'bggImport.selected');
      toggle.textContent = n === boxes.length ? t('moveGames.selectNone') : t('moveGames.selectAll');
      submit.disabled = n === 0;
    };
    boxes.forEach((b) => b.addEventListener('change', sync));
    toggle.addEventListener('click', () => {
      const all = picked().size === boxes.length;
      boxes.forEach((b) => { b.checked = !all; });
      sync();
    });
    sync();

    submit.addEventListener('click', async () => {
      const attachNow = new Map(rows.filter((r) => r.expansion).map((r) => [r.key, baseOf(r)]));
      const { body: payload } = buildMyludoImport(rows, { choices, picked: picked(), attach: attachNow });
      // A linked row is stored with BGG's range and the cover the preview
      // showed; the route re-checks that cover against the host allowlist.
      payload.games.forEach((g) => {
        const card = g.bggId && cardOf.get(String(g.bggId));
        if (!card) return;
        if (card.imageUrl) g.image = card.imageUrl;
        if (card.minPlayers) { g.minPlayers = card.minPlayers; g.maxPlayers = card.maxPlayers || card.minPlayers; }
      });
      if (!payload.games.length && !payload.attach.length) return;
      submit.disabled = true;
      try {
        const res = await api('POST', `/api/rounds/${round.id}/games/import`, payload);
        imported = imported || res.imported > 0 || res.attached > 0;
        toast(res.imported || !res.attached
          ? tn(res.imported, 'myludoImport.toast.doneOne', 'myludoImport.toast.done')
          : tn(res.attached, 'myludoImport.toast.expansionsOne', 'myludoImport.toast.expansions'));
        dismiss();
      } catch (e) {
        submit.disabled = false;
        toast(bggImportError(e.message), { tone: 'error' });
      }
    });
  }

  renderFile(null);
}
