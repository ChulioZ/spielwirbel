/* Spielwirbel – views: a finished session's per-player points (#1630) — the
   sheet that enters them, and the block that shows them on the result.

   The seats are the session's PARTIES (sessionParties): one per team, one per
   un-teamed person, exactly what `PUT …/sessions/:sid/scores` accepts. The
   bests and the „neuer Rekord" marks are derived in point-records.js, so the
   result and the game page read one derivation.

   Points never decide the winner — the winner is still tapped on the result
   screen, and the two are recorded independently.

   ## The automa is a line, not a seat (#1672)

   A solo or co-op game's bot opponent gets one optional row below the parties:
   a name (default „Automa", editable to „Automa (schwer)") and optional points.
   It is sent as `automa` beside the seat map, never as a key in it, so nothing
   that counts people — contests, win rate, badges, records — can see it
   (point-records.js says why). One per session; „Verloren" stays the user's
   call on the result screen, never inferred from the two numbers.

   ## No minus key on a phone

   iOS's numeric keypad has none, and `inputmode="decimal"` has none either, so
   each row carries a „±" button that flips the sign of what is typed. The input
   itself still accepts a typed "-" for a keyboard. That is why the input is
   `type="text"` + `inputmode="numeric"` rather than `type="number"`, which
   would also accept "1e3" and "1.5" and hand back "" for anything half-typed.

   ## Scoring categories (#1780)

   A game with categories gets a GRID instead of one field per seat: a row per
   category, a column per party, the way a paper score pad is laid out (rows
   are what grow — up to twelve — so they run down the page, and the columns
   scroll sideways on a phone). Each column's total is summed live and is what
   is stored as the seat's points; the breakdown rides beside it as `parts`.
   One „±" button flips the sign of the field last focused, rather than one per
   cell — a twelve-by-five grid of sign buttons would crowd out the numbers.

   A seat scored before the game had categories keeps its total: its column
   starts empty, the footer shows the old total, and an untouched column saves
   that total unchanged. Typing into it replaces the total with the sum.

   Part of the frontend; all files share one global script scope (load order:
   see index.html). */

// Parse one input: '' is "no points for this seat", undefined is invalid.
function parsePointsInput(raw) {
  const v = String(raw || '').trim().replace(/^[−–]/, '-');
  if (!v) return '';
  if (!/^-?\d+$/.test(v)) return undefined;
  const n = Number(v);
  return isValidPoints(n) ? n : undefined;
}

// Enter, change or clear the points. `onSaved(fresh, session)` re-renders the
// caller from the server's view, since the record marks depend on every
// session of the game.
// The rows the sheet's grid offers: the game's active categories, plus any
// removed one THIS session still holds values for — hiding it would make the
// column's sum disagree with its stored total.
function sheetScoreCategories(game, session, parties) {
  const active = activeScoreCategories(game);
  const shown = new Set(active.map((c) => c.id));
  const extra = scoreCategoryList(game).filter((c) => c.removed && !shown.has(c.id)
    && parties.some((p) => Number.isInteger((seatScoreParts(session, p.id) || {})[c.id])));
  return [...active, ...extra];
}

function showSessionPointsSheet(round, session, onSaved) {
  const parties = sessionParties(round, session);
  const stored = session.scores && typeof session.scores === 'object' ? session.scores : {};
  const game = round.games.find((g) => g.id === session.chosenGameId) || {};
  const lowWins = !!game.lowScoreWins;
  const categories = sheetScoreCategories(game, session, parties);
  const storedAutoma = parseAutoma(session.automa);
  const inputs = [];
  const grid = categories.length ? { cols: [] } : null; // { cols: [{ party, cells: [{ category, input }], legacy, out }] }
  let automa = null; // { row, name, input } while the automa row is shown
  openBulkPicker({
    title: t('points.title'),
    hint: t(lowWins ? 'points.hintLow' : 'points.hint'),
  }, (sheet, okBtn) => {
    const list = h('<div class="points-list"></div>');
    // „±" flips the sign of what is typed (no minus key on a phone, see above).
    const signFlip = (btn, input) => btn.addEventListener('click', () => {
      const v = input.value.trim();
      input.value = v.startsWith('-') ? v.slice(1) : `-${v}`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
    if (grid) list.appendChild(buildPointsGrid(parties, categories, session, stored, grid));
    else parties.forEach((party, i) => {
      const id = `pts-${i}`;
      const value = Number.isInteger(stored[party.id]) ? String(stored[party.id]) : '';
      const row = h(`<div class="points-row">
          <label class="points-row__name" for="${id}">${esc(party.name)}</label>
          <button type="button" class="btn btn--sm points-row__sign" aria-label="${esc(t('points.sign', { name: party.name }))}">±</button>
          <input id="${id}" class="input points-row__input" type="text" inputmode="numeric" autocomplete="off" maxlength="6" value="${esc(value)}">
        </div>`);
      const input = row.querySelector('input');
      signFlip(row.querySelector('.points-row__sign'), input);
      inputs.push({ party, input });
      list.appendChild(row);
    });
    const toggle = h(`<button type="button" class="link-btn points-automa__toggle"></button>`);
    const showAutoma = (a) => {
      const row = h(`<div class="points-row points-row--automa">
          <input class="input points-row__automa-name" type="text" autocomplete="off" autocorrect="off" spellcheck="false" maxlength="${AUTOMA_NAME_MAX}"
            aria-label="${esc(t('points.automa.name'))}" value="${esc(a ? a.name : t('points.automa.default'))}">
          <button type="button" class="btn btn--sm points-row__sign" aria-label="${esc(t('points.automa.sign'))}">±</button>
          <input class="input points-row__input" type="text" inputmode="numeric" autocomplete="off" maxlength="6"
            aria-label="${esc(t('points.automa.points'))}" value="${a && Number.isInteger(a.points) ? String(a.points) : ''}">
        </div>`);
      const input = row.querySelector('.points-row__input');
      signFlip(row.querySelector('.points-row__sign'), input);
      automa = { row, name: row.querySelector('.points-row__automa-name'), input };
      toggle.before(row);
    };
    const paintToggle = () => {
      toggle.innerHTML = automa ? iconText('ti-x', t('points.automa.remove')) : iconText('ti-robot', t('points.automa.add'));
    };
    toggle.addEventListener('click', () => {
      if (automa) { automa.row.remove(); automa = null; }
      else { showAutoma(null); automa.name.select(); }
      paintToggle();
      check();
    });
    list.appendChild(toggle);
    if (storedAutoma) showAutoma(storedAutoma);
    paintToggle();
    const check = () => {
      let ok = true;
      const cells = grid ? grid.cols.flatMap((col) => col.cells) : [];
      [...inputs, ...cells, ...(automa ? [automa] : [])].forEach(({ input }) => {
        const bad = parsePointsInput(input.value) === undefined;
        input.setAttribute('aria-invalid', bad ? 'true' : 'false');
        if (bad) ok = false;
      });
      if (automa) {
        const bad = !automa.name.value.trim();
        automa.name.setAttribute('aria-invalid', bad ? 'true' : 'false');
        if (bad) ok = false;
      }
      if (grid && !paintGridTotals(grid)) ok = false;
      okBtn.disabled = !ok;
    };
    list.addEventListener('input', check);
    sheet.querySelector('.sheet__actions').before(list);
    check();
    return list;
  }, async () => {
    const scores = {};
    const parts = grid ? {} : undefined;
    inputs.forEach(({ party, input }) => {
      const n = parsePointsInput(input.value);
      if (Number.isInteger(n)) scores[party.id] = n;
    });
    if (grid) grid.cols.forEach((col) => {
      const sum = gridColumnSum(col);
      if (sum.entered) {
        scores[col.party.id] = sum.total;
        parts[col.party.id] = sum.parts;
      } else if (Number.isInteger(col.legacy)) scores[col.party.id] = col.legacy;
    });
    let bot = null;
    if (automa) {
      const n = parsePointsInput(automa.input.value);
      bot = { name: automa.name.value.trim(), ...(Number.isInteger(n) ? { points: n } : {}) };
    }
    try {
      await api('PUT', `/api/rounds/${round.id}/sessions/${session.id}/scores`, { scores, automa: bot, ...(parts ? { parts } : {}) });
      toast(t(Object.keys(scores).length || bot ? 'points.toast.saved' : 'points.toast.cleared'));
      const fresh = await fetchRoundFresh(round.id);
      const sess = fresh.sessions.find((s) => s.id === session.id) || session;
      onSaved(fresh, sess);
    } catch (e) { toast(e.message, { tone: 'error' }); }
  });
}

/* The category grid (#1780): categories down, parties across, a live total in
   the footer. `grid.cols` is filled here and read by the sheet's check and save.
   `legacy` is a column's stored total when it has no breakdown — a seat scored
   before the game had categories. */
function buildPointsGrid(parties, categories, session, stored, grid) {
  const wrap = h(`<div class="points-grid">
      <div class="points-grid__scroll"><table class="points-grid__table">
        <thead><tr><th scope="col"><span class="sr-only">${esc(t('points.categories.column'))}</span></th>${parties.map((p) => `<th scope="col">${esc(p.name)}</th>`).join('')}</tr></thead>
        <tbody></tbody>
        <tfoot><tr><th scope="row">${esc(t('points.categories.total'))}</th>${parties.map(() => '<td><output class="points-grid__total"></output></td>').join('')}</tr></tfoot>
      </table></div>
      <button type="button" class="btn btn--sm points-grid__sign" aria-label="${esc(t('points.categories.sign'))}">± ${esc(t('points.categories.signShort'))}</button>
    </div>`);
  const body = wrap.querySelector('tbody');
  const outs = wrap.querySelectorAll('.points-grid__total');
  parties.forEach((party, pi) => {
    const own = seatScoreParts(session, party.id);
    grid.cols.push({ party, cells: [], out: outs[pi], legacy: !own && Number.isInteger(stored[party.id]) ? stored[party.id] : null });
  });
  categories.forEach((category) => {
    const tr = h(`<tr><th scope="row">${esc(category.name)}</th></tr>`);
    grid.cols.forEach((col) => {
      const own = seatScoreParts(session, col.party.id) || {};
      const value = Number.isInteger(own[category.id]) ? String(own[category.id]) : '';
      const td = h(`<td><input class="input points-row__input" type="text" inputmode="numeric" autocomplete="off" maxlength="6"
          aria-label="${esc(t('points.categories.cell', { category: category.name, name: col.party.name }))}" value="${esc(value)}"></td>`);
      const input = td.querySelector('input');
      col.cells.push({ category, input });
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  // „±" acts on the field last focused (no minus key on a phone, see above).
  let last = grid.cols.length && grid.cols[0].cells.length ? grid.cols[0].cells[0].input : null;
  wrap.addEventListener('focusin', (e) => { if (e.target.matches('.points-row__input')) last = e.target; });
  wrap.querySelector('.points-grid__sign').addEventListener('click', () => {
    if (!last) return;
    const v = last.value.trim();
    last.value = v.startsWith('-') ? v.slice(1) : `-${v}`;
    last.dispatchEvent(new Event('input', { bubbles: true }));
    last.focus();
  });
  return wrap;
}

// One column's sum: `entered` when any cell holds a number; `ok` false when a
// cell is invalid or the sum leaves the points bounds.
function gridColumnSum(col) {
  const parts = {};
  let total = 0;
  let entered = false;
  let ok = true;
  col.cells.forEach(({ category, input }) => {
    const n = parsePointsInput(input.value);
    if (n === undefined) { ok = false; return; }
    if (n === '') return;
    parts[category.id] = n;
    total += n;
    entered = true;
  });
  if (entered && !isValidPoints(total)) ok = false;
  return { parts, total, entered, ok };
}

// Paint every column's footer; false when any column cannot be saved.
function paintGridTotals(grid) {
  let ok = true;
  grid.cols.forEach((col) => {
    const sum = gridColumnSum(col);
    if (!sum.ok) ok = false;
    col.out.textContent = sum.entered ? fmtCount(sum.total) : Number.isInteger(col.legacy) ? fmtCount(col.legacy) : '–';
    col.out.classList.toggle('points-grid__total--legacy', !sum.entered && Number.isInteger(col.legacy));
    col.out.toggleAttribute('data-invalid', !sum.ok);
  });
  return ok;
}

/* The game's „Wertungskategorien" editor (#1780): an ordered list of names, up
   to SCORE_CATEGORY_MAX. Ids travel with the rows, so a rename keeps the
   category's history; a row left blank is dropped, and an empty list returns
   the sheet to one field per player. `onSave(list)` sends `[{ id?, name }]`. */
function showScoreCategoriesEditor(game, onSave) {
  const meta = new Map(); // li -> category id (absent for a new row)
  let list;
  openBulkPicker({ title: t('points.categories.title'), hint: t('points.categories.hint') }, (sheet, okBtn) => {
    const wrap = h('<div class="score-cats"><ol class="score-cats__list"></ol></div>');
    list = wrap.querySelector('ol');
    const addBtn = h(`<button type="button" class="link-btn score-cats__add">${iconText('ti-plus', t('points.categories.add'))}</button>`);
    const sync = () => {
      const items = [...list.children];
      const seen = new Map();
      let ok = true;
      items.forEach((li, i) => {
        li.querySelector('.score-cats__up').disabled = i === 0;
        li.querySelector('.score-cats__down').disabled = i === items.length - 1;
        const input = li.querySelector('input');
        input.setAttribute('aria-label', t('points.categories.name', { n: i + 1 }));
        const key = input.value.trim().toLocaleLowerCase();
        input.setAttribute('aria-invalid', 'false');
        if (!key) return;
        if (seen.has(key)) { input.setAttribute('aria-invalid', 'true'); seen.get(key).setAttribute('aria-invalid', 'true'); ok = false; }
        else seen.set(key, input);
      });
      addBtn.hidden = items.length >= SCORE_CATEGORY_MAX;
      okBtn.disabled = !ok;
    };
    const addRow = (category) => {
      const li = h(`<li class="score-cats__row">
          <input class="input score-cats__name" type="text" autocomplete="off" autocorrect="off" spellcheck="false" maxlength="${SCORE_CATEGORY_NAME_MAX}" value="${esc(category ? category.name : '')}">
          <button type="button" class="btn btn--sm score-cats__up" aria-label="${esc(t('points.categories.up'))}"><i class="ti ti-arrow-up" aria-hidden="true"></i></button>
          <button type="button" class="btn btn--sm score-cats__down" aria-label="${esc(t('points.categories.down'))}"><i class="ti ti-arrow-down" aria-hidden="true"></i></button>
          <button type="button" class="btn btn--sm score-cats__remove" aria-label="${esc(t('points.categories.remove'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </li>`);
      if (category) meta.set(li, category.id);
      li.querySelector('.score-cats__up').addEventListener('click', () => { if (li.previousElementSibling) li.previousElementSibling.before(li); sync(); li.querySelector('.score-cats__up').focus(); });
      li.querySelector('.score-cats__down').addEventListener('click', () => { if (li.nextElementSibling) li.nextElementSibling.after(li); sync(); li.querySelector('.score-cats__down').focus(); });
      li.querySelector('.score-cats__remove').addEventListener('click', () => {
        const next = li.nextElementSibling || li.previousElementSibling;
        li.remove();
        sync();
        (next ? next.querySelector('input') : addBtn).focus();
      });
      list.appendChild(li);
      return li;
    };
    activeScoreCategories(game).forEach(addRow);
    addBtn.addEventListener('click', () => { addRow(null).querySelector('input').focus(); sync(); });
    wrap.appendChild(addBtn);
    list.addEventListener('input', sync);
    sheet.querySelector('.sheet__actions').before(wrap);
    if (!list.children.length) addRow(null);
    sync();
    return wrap;
  }, () => onSave([...list.children]
    .map((li) => ({ id: meta.get(li), name: li.querySelector('input').value.trim() }))
    .filter((c) => c.name)
    .map((c) => (c.id ? c : { name: c.name }))));
}

// The action's label: „Punkte eintragen" before any, „Punkte bearbeiten" after.
function sessionPointsLabel(session) {
  const any = (session.scores && Object.keys(session.scores).length) || parseAutoma(session.automa);
  return t(any ? 'points.edit' : 'points.add');
}

// The result's points block, best first, or null when the session has none.
// Uses the result-people row so it sits in the same rhythm as „Wer dabei war"
// and „Als Team" above it.
// The automa (#1672) closes the list, after the people and outside their
// ranking: it is what they played against, not one of them.
function renderSessionPoints(round, session) {
  const lines = sessionPointLines(round, session);
  const automa = parseAutoma(session.automa);
  if (!lines.length && !automa) return null;
  const names = new Map(sessionParties(round, session).map((p) => [p.id, p.name]));
  const automaLine = automa ? `<li class="result-points__line result-points__line--automa">
          <span class="result-points__name">${iconText('ti-robot', automa.name)}</span>${Number.isInteger(automa.points)
            ? `
          <span class="result-points__value">${esc(fmtCount(automa.points))}</span>` : ''}
        </li>` : '';
  return h(`<div class="result-people result-points">
      <span class="result-people__label">${esc(t('points.label'))}</span>
      <ol class="result-points__list">${lines.map((l) => `<li class="result-points__line">
          <span class="result-points__name">${esc(names.get(l.party.id) || '')}</span>
          <span class="result-points__value">${esc(fmtCount(l.points))}</span>${l.newRecord
            ? `<span class="result-points__record">${iconText('ti-medal', t('points.newRecord'))}</span>`
            : ''}
        </li>`).join('')}${automaLine}</ol>
    </div>`);
}

// The points block as plain data, for the share (#1726): the same lines in the
// same order as renderSessionPoints, the automa last, each marked as a winner
// when anyone in its party won. [] when nothing was counted.
function sessionSharePoints(round, session, winnerIds) {
  const won = new Set(winnerIds || []);
  const parties = new Map(sessionParties(round, session).map((p) => [p.id, p]));
  const lines = sessionPointLines(round, session).map((l) => {
    const party = parties.get(l.party.id) || l.party;
    return {
      name: party.name || '',
      // Each person's own label, for a card that prints first names only
      // (Ocean, O8.3) and so cannot cut a team's joined name apart.
      members: (party.people || []).map(personLabel),
      text: fmtCount(l.points),
      winner: (party.people || []).some((p) => won.has(p.id)),
      automa: false,
    };
  });
  const automa = parseAutoma(session.automa);
  if (automa) {
    lines.push({ name: automa.name, text: Number.isInteger(automa.points) ? fmtCount(automa.points) : '', winner: false, automa: true });
  }
  return lines;
}

// The best line of one scored play, for the game page's play history —
// „Anna 42". The TOP score rather than the viewer's own: a stamp is the same
// for everyone who opens the page, and the viewer may hold no seat at all.
// Teams are named by their members (sessionParties). Empty for a play without
// points.
function playTopPointsText(round, play) {
  if (!play || !play.lines.length) return '';
  const top = play.lines[0];
  const party = sessionParties(round, play.session).find((p) => p.id === top.party.id);
  return t('points.top', { name: party ? party.name : '', points: fmtCount(top.points) });
}

// The game's group record (score, who, when) and its „lower score wins" switch,
// or null while no play of the game carries points. The switch lives HERE, where
// its effect is visible, rather than among the game's facts: a game nobody has
// scored has no direction to choose. `onToggle(next)` persists it.
// Per-category records (#1780) follow as a short list — „Vögel: 48 · Anna".
function renderGamePointRecord(round, game, records, onToggle) {
  if (!records.record) return null;
  const { points, session } = records.record;
  const partyName = (rec) => (sessionParties(round, rec.session).find((p) => p.id === rec.party.id) || {}).name || '';
  const name = partyName(records.record);
  const cats = gameCategoryRecords(round, game);
  const el = h(`<div class="gd-record">
      <p class="gd-record__line">${iconText('ti-medal', t('points.record', { points: fmtCount(points), name, date: fmtDate(session.createdAt) }))}</p>
      <label class="gd-record__dir"><input type="checkbox"${game.lowScoreWins ? ' checked' : ''}> ${esc(t('points.lowWins'))}</label>
      ${cats.length ? `<ul class="gd-record__cats">${cats.map(({ category, record }) => `<li>${esc(t('points.categoryRecord', {
        category: category.name, points: fmtCount(record.points), name: partyName(record) }))}</li>`).join('')}</ul>` : ''}
    </div>`);
  const box = el.querySelector('input');
  box.addEventListener('change', () => onToggle(box.checked));
  return el;
}
