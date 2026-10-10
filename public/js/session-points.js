/* Spielwirbel – views: a finished session's per-player points (#1630) — the
   sheet that enters them, and the block that shows them on the result.

   The seats are the session's PARTIES (sessionParties): one per team, one per
   un-teamed person, exactly what `PUT …/sessions/:sid/scores` accepts. The
   bests and the „neuer Rekord" marks are derived in point-records.js, so the
   result and the game page read one derivation.

   Points never decide the winner — the winner is still tapped on the result
   screen, and the two are recorded independently.

   ## No minus key on a phone

   iOS's numeric keypad has none, and `inputmode="decimal"` has none either, so
   each row carries a „±" button that flips the sign of what is typed. The input
   itself still accepts a typed "-" for a keyboard. That is why the input is
   `type="text"` + `inputmode="numeric"` rather than `type="number"`, which
   would also accept "1e3" and "1.5" and hand back "" for anything half-typed.

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
function showSessionPointsSheet(round, session, onSaved) {
  const parties = sessionParties(round, session);
  const stored = session.scores && typeof session.scores === 'object' ? session.scores : {};
  const lowWins = !!(round.games.find((g) => g.id === session.chosenGameId) || {}).lowScoreWins;
  const inputs = [];
  openBulkPicker({
    title: t('points.title'),
    hint: t(lowWins ? 'points.hintLow' : 'points.hint'),
  }, (sheet, okBtn) => {
    const list = h('<div class="points-list"></div>');
    parties.forEach((party, i) => {
      const id = `pts-${i}`;
      const value = Number.isInteger(stored[party.id]) ? String(stored[party.id]) : '';
      const row = h(`<div class="points-row">
          <label class="points-row__name" for="${id}">${esc(party.name)}</label>
          <button type="button" class="btn btn--sm points-row__sign" aria-label="${esc(t('points.sign', { name: party.name }))}">±</button>
          <input id="${id}" class="input points-row__input" type="text" inputmode="numeric" autocomplete="off" maxlength="6" value="${esc(value)}">
        </div>`);
      const input = row.querySelector('input');
      row.querySelector('.points-row__sign').addEventListener('click', () => {
        const v = input.value.trim();
        input.value = v.startsWith('-') ? v.slice(1) : `-${v}`;
        input.dispatchEvent(new Event('input'));
        input.focus();
      });
      inputs.push({ party, input });
      list.appendChild(row);
    });
    const check = () => {
      let ok = true;
      inputs.forEach(({ input }) => {
        const bad = parsePointsInput(input.value) === undefined;
        input.setAttribute('aria-invalid', bad ? 'true' : 'false');
        if (bad) ok = false;
      });
      okBtn.disabled = !ok;
    };
    list.addEventListener('input', check);
    sheet.querySelector('.sheet__actions').before(list);
    check();
    return list;
  }, async () => {
    const scores = {};
    inputs.forEach(({ party, input }) => {
      const n = parsePointsInput(input.value);
      if (Number.isInteger(n)) scores[party.id] = n;
    });
    try {
      await api('PUT', `/api/rounds/${round.id}/sessions/${session.id}/scores`, { scores });
      toast(t(Object.keys(scores).length ? 'points.toast.saved' : 'points.toast.cleared'));
      const fresh = await fetchRoundFresh(round.id);
      const sess = fresh.sessions.find((s) => s.id === session.id) || session;
      onSaved(fresh, sess);
    } catch (e) { toast(e.message, { tone: 'error' }); }
  });
}

// The action's label: „Punkte eintragen" before any, „Punkte bearbeiten" after.
function sessionPointsLabel(session) {
  return t(session.scores && Object.keys(session.scores).length ? 'points.edit' : 'points.add');
}

// The result's points block, best first, or null when the session has none.
// Uses the result-people row so it sits in the same rhythm as „Wer dabei war"
// and „Als Team" above it.
function renderSessionPoints(round, session) {
  const lines = sessionPointLines(round, session);
  if (!lines.length) return null;
  const names = new Map(sessionParties(round, session).map((p) => [p.id, p.name]));
  return h(`<div class="result-people result-points">
      <span class="result-people__label">${esc(t('points.label'))}</span>
      <ol class="result-points__list">${lines.map((l) => `<li class="result-points__line">
          <span class="result-points__name">${esc(names.get(l.party.id) || '')}</span>
          <span class="result-points__value">${esc(fmtCount(l.points))}</span>${l.newRecord
            ? `<span class="result-points__record">${iconText('ti-medal', t('points.newRecord'))}</span>`
            : ''}
        </li>`).join('')}</ol>
    </div>`);
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
function renderGamePointRecord(round, game, records, onToggle) {
  if (!records.record) return null;
  const { points, party, session } = records.record;
  const name = (sessionParties(round, session).find((p) => p.id === party.id) || {}).name || '';
  const el = h(`<div class="gd-record">
      <p class="gd-record__line">${iconText('ti-medal', t('points.record', { points: fmtCount(points), name, date: fmtDate(session.createdAt) }))}</p>
      <label class="gd-record__dir"><input type="checkbox"${game.lowScoreWins ? ' checked' : ''}> ${esc(t('points.lowWins'))}</label>
    </div>`);
  const box = el.querySelector('input');
  box.addEventListener('change', () => onToggle(box.checked));
  return el;
}
