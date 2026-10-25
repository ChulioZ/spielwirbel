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
  const storedAutoma = parseAutoma(session.automa);
  const inputs = [];
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
    parties.forEach((party, i) => {
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
      [...inputs, ...(automa ? [automa] : [])].forEach(({ input }) => {
        const bad = parsePointsInput(input.value) === undefined;
        input.setAttribute('aria-invalid', bad ? 'true' : 'false');
        if (bad) ok = false;
      });
      if (automa) {
        const bad = !automa.name.value.trim();
        automa.name.setAttribute('aria-invalid', bad ? 'true' : 'false');
        if (bad) ok = false;
      }
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
    let bot = null;
    if (automa) {
      const n = parsePointsInput(automa.input.value);
      bot = { name: automa.name.value.trim(), ...(Number.isInteger(n) ? { points: n } : {}) };
    }
    try {
      await api('PUT', `/api/rounds/${round.id}/sessions/${session.id}/scores`, { scores, automa: bot });
      toast(t(Object.keys(scores).length || bot ? 'points.toast.saved' : 'points.toast.cleared'));
      const fresh = await fetchRoundFresh(round.id);
      const sess = fresh.sessions.find((s) => s.id === session.id) || session;
      onSaved(fresh, sess);
    } catch (e) { toast(e.message, { tone: 'error' }); }
  });
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
