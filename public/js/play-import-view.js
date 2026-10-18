'use strict';

/* „Partien importieren" (#1665): bring a play history from BG Stats or BGG
   into the round as finished sessions. Reached from the Chronik, beside
   „Session nachtragen", in every design (one renderer serves them all).

   One sheet, five states: source → plays → people → games → done. Every
   decision is made in the browser and only the outcome is sent, in batches
   (`buildImportBatches`, play-import.js), to POST …/sessions/import. The pure
   half — parsing, suggestions, batching — is play-import.js and is tested
   there; this file only renders. No `module.exports`: DOM. */

async function showPlayImport(round) {
  const title = t('playImport.title');
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog sheet--list" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__head">
          <h2>${esc(title)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="bgg-import play-import"></div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  const body = backdrop.querySelector('.play-import');
  document.body.appendChild(backdrop);

  // Sessions written while the sheet was open only show once the Chronik behind
  // it re-renders — through closeSheet, never on the line after it
  // (.claude/rules/sheet-history-back-dismissal.md).
  let imported = false;
  const dismiss = () => closeSheet(imported ? () => showRound(round.id, 'chronik') : undefined);
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  sheet.querySelector('.sheet__close').addEventListener('click', dismiss);

  const msg = (text, hint, icon = 'ti-alert-triangle') => h(`<div class="bgg-import__msg">
      ${formSheetDesign() ? `<span class="sheet-disc" aria-hidden="true"><i class="ti ${icon}"></i></span>` : ''}<p>${esc(text)}</p>${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
    </div>`);
  const actions = (...buttons) => {
    const bar = h('<div class="toolbar sheet__actions"></div>');
    buttons.forEach((b) => bar.appendChild(b));
    return bar;
  };
  const button = (label, onClick, { primary = false, icon = '' } = {}) => {
    const b = h(`<button type="button" class="btn${primary ? ' btn--primary btn--lg' : ''}">${icon ? iconText(icon, label) : esc(label)}</button>`);
    b.addEventListener('click', onClick);
    return b;
  };

  // Everything the steps share. `people` and `games` are the suggestion lists
  // the user edits in place (their `choice` field); `checked` holds the source
  // ids of the plays selected in the preview.
  const state = { source: null, plays: [], locations: [], people: [], games: [], checked: new Set(), dup: new Map() };
  const filter = { from: '', to: '', location: '', matchedOnly: false };
  const peopleByKey = () => new Map(state.people.map((p) => [p.key, p.choice]));
  const gameIdOf = (play) => {
    const g = state.games.find((x) => x.key === play.game.key);
    return g && g.choice.gameId;
  };

  // --- step 0: the source ----------------------------------------------------

  function renderSource() {
    body.replaceChildren(h(`<p class="muted">${esc(t('playImport.intro'))}</p>`));
    const file = h('<input type="file" accept=".json,application/json" hidden />');
    file.addEventListener('change', () => { if (file.files[0]) loadFile(file.files[0]); });
    const opts = h('<div class="play-import__sources"></div>');
    const bgs = h(`<button type="button" class="ds-row play-import__source">
        <span class="ds-row__main"><i class="ti ti-file-upload" aria-hidden="true"></i>
          <span><strong>${esc(t('playImport.source.bgstats'))}</strong><span class="muted">${esc(t('playImport.source.bgstatsHint'))}</span></span>
        </span>
      </button>`);
    bgs.addEventListener('click', () => file.click());
    opts.append(bgs, file);
    // BGG plays hang off the ACCOUNT's linked handle, so accounts mode only;
    // the BG Stats file works in every mode.
    if (accountsActive()) {
      const bgg = h(`<button type="button" class="ds-row play-import__source">
          <span class="ds-row__main"><i class="ti ti-world-download" aria-hidden="true"></i>
            <span><strong>${esc(t('playImport.source.bgg'))}</strong><span class="muted">${esc(t('playImport.source.bggHint'))}</span></span>
          </span>
        </button>`);
      bgg.addEventListener('click', () => loadBgg());
      opts.appendChild(bgg);
    }
    body.appendChild(opts);
  }

  async function loadFile(f) {
    body.replaceChildren(h(`<p class="muted">${esc(t('playImport.loading'))}</p>`));
    let parsed;
    try {
      parsed = parseBgStatsExport(await f.text(), { minDay: PLAYED_ON_MIN });
    } catch (err) {
      // A wrong file is the user's to fix and says so; anything else is ours.
      const wrongFile = err && (err.message === 'not_bgstats' || err.name === 'SyntaxError');
      if (!wrongFile) reportClientError('play_import_parse', err);
      body.replaceChildren(msg(t(wrongFile ? 'playImport.error.notBgStats' : 'playImport.error.read'), null, 'ti-file-alert'));
      body.appendChild(actions(button(t('playImport.back'), renderSource)));
      return;
    }
    start('bgstats', parsed.plays, parsed.locations);
  }

  async function loadBgg() {
    const status = h(`<p class="muted" aria-live="polite">${esc(t('playImport.loading'))}</p>`);
    body.replaceChildren(status);
    const raw = [];
    for (let page = 1; page <= 200; page++) {
      let res;
      try {
        res = await api('GET', `/api/rounds/${round.id}/lookup/plays?provider=bgg&page=${page}`);
      } catch (e) {
        body.replaceChildren(msg(bggImportError(e.message)));
        body.appendChild(actions(button(t('playImport.back'), renderSource)));
        return;
      }
      if (res.state === 'no_username' || res.state === 'invalid_user') {
        body.replaceChildren(msg(t(res.state === 'no_username' ? 'playImport.error.noHandle' : 'bggImport.unknownUser'), null, 'ti-user-x'));
        body.appendChild(actions(
          button(t('playImport.back'), renderSource),
          button(t('playImport.toAccount'), () => closeSheet(() => showAccount()), { primary: true }),
        ));
        return;
      }
      if (res.state === 'queued') {
        body.replaceChildren(msg(t('bggImport.queued'), t('bggImport.queuedHint'), 'ti-hourglass'));
        body.appendChild(actions(button(t('bggImport.retry'), loadBgg, { primary: true })));
        return;
      }
      raw.push(...res.plays);
      status.textContent = t('playImport.loadingCount', { n: raw.length, total: res.total });
      if (!res.plays.length || raw.length >= res.total) break;
    }
    start('bgg', normaliseBggPlays(raw, { playedOnInstant, minDay: PLAYED_ON_MIN }), [...new Set(raw.map((p) => p.location).filter(Boolean))].sort());
  }

  // Suggestions are made once, on load, from the round as it stands.
  function start(source, plays, locations) {
    if (!plays.length) {
      body.replaceChildren(msg(t('playImport.empty'), null, 'ti-cards'));
      body.appendChild(actions(button(t('playImport.back'), renderSource)));
      return;
    }
    const me = currentUserId();
    const meSeat = me && round.members.find((m) => m.userId === me);
    Object.assign(state, {
      source,
      plays: [...plays].sort((a, b) => (a.playedOn < b.playedOn ? 1 : -1)),
      locations,
      people: suggestPeople(plays, round.members, { meMemberId: meSeat && meSeat.id }),
      games: suggestGames(plays, round.games),
    });
    const byKey = peopleByKey();
    state.dup = new Map(state.plays.map((p) => [p.sourceId,
      duplicateState(p, round.sessions || [], { gameId: gameIdOf(p), memberIds: playMemberIds(p, byKey) })]));
    // Pre-checked: complete, and not (probably) here already.
    state.checked = new Set(state.plays.filter((p) => !p.incomplete && !state.dup.get(p.sourceId)).map((p) => p.sourceId));
    renderPlays();
  }

  // --- step 1: plays ----------------------------------------------------------

  function renderPlays() {
    body.replaceChildren();
    const filters = h(`<div class="play-import__filters">
        <label>${esc(t('playImport.filter.from'))}<input type="date" class="input" data-k="from" value="${esc(filter.from)}" /></label>
        <label>${esc(t('playImport.filter.to'))}<input type="date" class="input" data-k="to" value="${esc(filter.to)}" /></label>
        ${state.locations.length ? `<label>${esc(t('playImport.filter.location'))}<select class="input" data-k="location">
          <option value="">${esc(t('playImport.filter.anyLocation'))}</option>
          ${state.locations.map((l) => `<option value="${esc(l)}"${l === filter.location ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select></label>` : ''}
        <label class="play-import__check"><input type="checkbox" data-k="matchedOnly"${filter.matchedOnly ? ' checked' : ''} /> ${esc(t('playImport.filter.matchedOnly'))}</label>
      </div>`);
    const picker = h(`<div class="bgg-import__picker">
        <div class="move-list__head">
          <span class="bgg-import__count muted" aria-live="polite"></span>
          <button class="link-btn bgg-import__toggle" type="button"></button>
        </div>
        <div class="ds-list bgg-import__list" role="group" aria-label="${esc(t('playImport.steps.plays'))}"></div>
      </div>`);
    const list = picker.querySelector('.bgg-import__list');
    const countEl = picker.querySelector('.bgg-import__count');
    const toggle = picker.querySelector('.bgg-import__toggle');
    const next = button(t('playImport.next'), () => renderPeople(), { primary: true });
    body.append(filters, picker, actions(button(t('playImport.back'), renderSource), next));

    let visible = [];
    const sync = () => {
      const n = visible.filter((p) => state.checked.has(p.sourceId)).length;
      countEl.textContent = tn(n, 'playImport.selectedOne', 'playImport.selected');
      toggle.textContent = n === visible.length ? t('moveGames.selectNone') : t('moveGames.selectAll');
      next.disabled = n === 0;
    };
    const paint = () => {
      const byKey = peopleByKey();
      visible = state.plays.filter((p) => playPassesFilter(p, filter, byKey));
      list.replaceChildren();
      visible.forEach((p) => {
        const dup = state.dup.get(p.sourceId);
        const note = dup === 'imported' ? t('playImport.dupImported')
          : dup === 'probable' ? t('playImport.dupProbable')
            : p.incomplete ? t('playImport.incomplete') : '';
        const names = p.players.map((x) => x.name).join(', ');
        const row = h(`<label class="ds-row bgg-import__row play-import__play">
            <div class="ds-row__main">
              <span class="bgg-import__name" title="${esc(p.game.title)}">${esc(p.game.title)}</span>
              <span class="muted bgg-import__state">${esc([fmtDate(p.playedOn), names, note].filter(Boolean).join(' · '))}</span>
            </div>
            <div class="ds-row__meta">
              <input type="checkbox" class="provider-row__box"${state.checked.has(p.sourceId) ? ' checked' : ''}${dup === 'imported' ? ' disabled' : ''} />
            </div>
          </label>`);
        const box = row.querySelector('input');
        box.addEventListener('change', () => {
          if (box.checked) state.checked.add(p.sourceId);
          else state.checked.delete(p.sourceId);
          sync();
        });
        list.appendChild(row);
      });
      sync();
    };
    filters.querySelectorAll('[data-k]').forEach((el) => {
      el.addEventListener('change', () => {
        filter[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
        paint();
      });
    });
    toggle.addEventListener('click', () => {
      const all = visible.every((p) => state.checked.has(p.sourceId));
      visible.forEach((p) => {
        if (state.dup.get(p.sourceId) === 'imported') return;
        if (all) state.checked.delete(p.sourceId);
        else state.checked.add(p.sourceId);
      });
      paint();
    });
    paint();
  }

  // The plays that will actually be sent: selected, passing the filter, and
  // still holding at least one member of the round under the people choices.
  const chosenPlays = () => {
    const byKey = peopleByKey();
    return state.plays.filter((p) => state.checked.has(p.sourceId) && playPassesFilter(p, filter, byKey));
  };
  const sendablePlays = () => {
    const byKey = peopleByKey();
    return chosenPlays().filter((p) => playMemberIds(p, byKey).length > 0);
  };

  // --- step 2: people ---------------------------------------------------------

  function renderPeople() {
    const keys = new Set(chosenPlays().flatMap((p) => p.players.map((x) => x.key)));
    const people = state.people.filter((p) => keys.has(p.key));
    const members = activeMembers(round);
    body.replaceChildren(h(`<p class="muted">${esc(t('playImport.people.intro'))}</p>`));
    const list = h(`<div class="ds-list play-import__map" role="group" aria-label="${esc(t('playImport.steps.people'))}"></div>`);
    const dropped = h('<p class="muted play-import__dropped" aria-live="polite"></p>');
    const syncDropped = () => {
      const n = chosenPlays().length - sendablePlays().length;
      dropped.textContent = n ? tn(n, 'playImport.people.droppedOne', 'playImport.people.dropped') : '';
    };
    people.forEach((p, i) => {
      const id = `pi-person-${i}`;
      const value = p.choice.memberId ? `m:${p.choice.memberId}` : p.choice.newMember ? 'new' : p.choice.guest ? 'guest' : 'ignore';
      const row = h(`<div class="ds-row ds-row--static play-import__map-row">
          <label class="ds-row__main" for="${id}">
            <span class="bgg-import__name">${esc(p.name)}</span>
            <span class="muted bgg-import__state">${esc(tn(p.plays, 'playImport.people.playsOne', 'playImport.people.plays'))}</span>
          </label>
          <div class="ds-row__meta">
            <select class="input" id="${id}">
              ${members.map((m) => `<option value="m:${esc(m.id)}"${value === `m:${m.id}` ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}
              <option value="new"${value === 'new' ? ' selected' : ''}>${esc(t('playImport.people.newMember'))}</option>
              <option value="guest"${value === 'guest' ? ' selected' : ''}>${esc(t('playImport.people.guest'))}</option>
              <option value="ignore"${value === 'ignore' ? ' selected' : ''}>${esc(t('playImport.people.ignore'))}</option>
            </select>
          </div>
        </div>`);
      row.querySelector('select').addEventListener('change', (e) => {
        const v = e.target.value;
        p.choice = v.startsWith('m:') ? { memberId: v.slice(2) }
          : v === 'new' ? { newMember: p.name }
            : v === 'guest' ? { guest: p.name } : null;
        syncDropped();
      });
      list.appendChild(row);
    });
    syncDropped();
    const next = () => (newGames().length ? renderGames() : renderConfirm());
    body.append(list, dropped, actions(button(t('playImport.back'), renderPlays), button(t('playImport.next'), next, { primary: true })));
  }

  // --- step 3: games ----------------------------------------------------------

  const newGames = () => {
    const keys = new Set(sendablePlays().map((p) => p.game.key));
    return state.games.filter((g) => keys.has(g.key) && g.choice.create);
  };

  function renderGames() {
    body.replaceChildren(h(`<p class="muted">${esc(t('playImport.games.intro'))}</p>`));
    const list = h(`<div class="ds-list play-import__map" role="group" aria-label="${esc(t('playImport.steps.games'))}"></div>`);
    newGames().forEach((g, i) => {
      const id = `pi-game-${i}`;
      const row = h(`<div class="ds-row ds-row--static play-import__map-row">
          <label class="ds-row__main" for="${id}">
            <span class="bgg-import__name" title="${esc(g.title)}">${esc(g.title)}</span>
            <span class="muted bgg-import__state">${esc(tn(g.plays, 'playImport.people.playsOne', 'playImport.people.plays'))}</span>
          </label>
          <div class="ds-row__meta">
            <select class="input" id="${id}">
              <option value="retired"${g.choice.create.shelf ? '' : ' selected'}>${esc(t('playImport.games.retired'))}</option>
              <option value="shelf"${g.choice.create.shelf ? ' selected' : ''}>${esc(t('playImport.games.shelf'))}</option>
            </select>
          </div>
        </div>`);
      row.querySelector('select').addEventListener('change', (e) => { g.choice = { create: { shelf: e.target.value === 'shelf' } }; });
      list.appendChild(row);
    });
    body.append(list, actions(button(t('playImport.back'), renderPeople), confirmButton()));
  }

  function renderConfirm() {
    body.replaceChildren(msg(tn(sendablePlays().length, 'playImport.confirmOne', 'playImport.confirm'), null, 'ti-history'));
    body.appendChild(actions(button(t('playImport.back'), renderPeople), confirmButton()));
  }

  const confirmButton = () => {
    const n = sendablePlays().length;
    const b = button(tn(n, 'playImport.submitOne', 'playImport.submit', { n }), () => run(), { primary: true, icon: 'ti-download' });
    b.disabled = n === 0;
    return b;
  };

  // --- step 4: write ----------------------------------------------------------

  async function run() {
    const plays = sendablePlays();
    let plan = buildImportBatches(state.source, plays, state.people, state.games);
    const progress = h(`<p class="muted" aria-live="polite"></p>`);
    body.replaceChildren(progress);
    const totals = { imported: 0, skipped: 0, members: 0, games: 0 };
    let sent = 0;
    for (const batch of plan.batches) {
      progress.textContent = t('playImport.progress', { done: sent, total: plays.length });
      let res;
      try {
        res = await api('POST', `/api/rounds/${round.id}/sessions/import`, {
          source: plan.source, people: plan.people, games: plan.games, plays: batch,
        });
      } catch (e) {
        const key = { quota_members: 'playImport.toast.quotaMembers', quota_games: 'playImport.toast.quotaGames' }[e.message];
        body.replaceChildren(msg(key ? t(key) : t('playImport.toast.failed'),
          totals.imported ? tn(totals.imported, 'playImport.done.importedOne', 'playImport.done.imported') : null));
        body.appendChild(actions(button(t('common.close'), dismiss, { primary: true })));
        return;
      }
      sent += batch.length;
      totals.imported += res.imported;
      totals.skipped += res.skipped + res.empty;
      totals.members += Object.keys(res.people || {}).length;
      totals.games += new Set(Object.values(res.games || {})).size;
      imported = imported || res.imported > 0;
      plan = resolveCreated(plan, res);
    }
    const lines = [
      tn(totals.imported, 'playImport.done.importedOne', 'playImport.done.imported'),
      totals.skipped ? tn(totals.skipped, 'playImport.done.skippedOne', 'playImport.done.skipped') : '',
      totals.members ? tn(totals.members, 'playImport.done.membersOne', 'playImport.done.members') : '',
      totals.games ? tn(totals.games, 'playImport.done.gamesOne', 'playImport.done.games') : '',
    ].filter(Boolean);
    body.replaceChildren(msg(t('playImport.done.title'), lines.join(' '), 'ti-circle-check'));
    body.appendChild(actions(button(t('playImport.done.toChronik'), dismiss, { primary: true })));
  }

  renderSource();
}
