/* Spielwirbel – views: the played session's party list (#1846), and „Wie
   war's?" inside it (#1838).

   After a game the screen used to list the same people up to four times —
   „Wer dabei war", „Punkte", the band's winner seats and the verdict block —
   about 470px of names on a phone. So a played session lists each PARTY once
   (sessionParties, the unit the points and the winner picker already use): its
   faces, its name, a crown when any of its people won, its points with the
   „neuer Rekord" mark, and one „Wie war's?" seat per person in it. Ordered by
   points (best first) when any are recorded, else seat order with the
   viewer's own party first; the automa closes the list with its points only.

   „Wie war's?": the people who sat at the table may say how it was, on the
   same five faces and words the vote uses. Optional, no time limit, editable
   later. A verdict replaces its seat's share of the play's assumed value in the
   shelf score (vote-score.js `playValue`) and counts as a rating everywhere a
   figure describes how someone likes a game (session-ratings.js). The list
   shows WHO has answered, never WHAT — so the second player is not anchored by
   the first face (the same reason the vote hides finished votes). Tapping a
   seat opens the faces for that seat in the one shared `.verdict__ask` under
   the list, nothing preselected; choosing saves and closes. The viewer's own
   seat comes first within its party (`mySeatIn`, attribution, not access — the
   route lets anyone with round access write any seated verdict, like a vote).

   Filled by resultRenderBand on every phase change, in every design; a design
   restyles `.verdict` / `.result-party`, it must not fork this. Part of the
   frontend; all files share one global script scope. */

function resultRenderParties(rs, slot) {
  const { round, session, parties } = rs;
  slot.innerHTML = '';
  slot.hidden = true;
  if (!rs.finished || rs.cancelled || rs.pickerOpen || !rs.chosenId) return;
  if (!parties.length) return;
  const gid = rs.chosenId;
  const mine = mySeatIn(round, session);
  const mineId = mine ? mine.id : null;
  const lines = sessionPointLines(round, session);
  const lineOf = new Map(lines.map((l) => [l.party.id, l]));
  const scored = lines.map((l) => parties.find((p) => p.id === l.party.id)).filter(Boolean);
  const holds = (party) => party.people.some((p) => p.id === mineId);
  const ordered = scored.length
    ? [...scored, ...parties.filter((p) => !scored.includes(p))]
    : [...parties.filter(holds), ...parties.filter((p) => !holds(p))];
  const automa = parseAutoma(session.automa);

  const block = h(`<section class="verdict result-parties" aria-labelledby="verdictTitle">
      <h3 class="verdict__title" id="verdictTitle">${esc(t('result.verdict.title'))}</h3>
      <p class="verdict__sub">${esc(t('result.verdict.sub'))}</p>
      <ol class="result-parties__list"></ol>
      <div class="verdict__ask" hidden></div>
    </section>`);
  const listEl = block.querySelector('.result-parties__list');
  const askEl = block.querySelector('.verdict__ask');
  const answered = (pid) => verdictOf(session, pid, gid) !== null;
  const won = new Set(rs.winnerIds);
  let open = null;

  const paint = () => {
    listEl.innerHTML = '';
    ordered.forEach((party) => {
      const line = lineOf.get(party.id);
      const winner = party.people.some((p) => won.has(p.id));
      const solo = party.people.length === 1;
      const row = h(`<li class="result-party${winner ? ' is-winner' : ''}${solo ? ' result-party--solo' : ''}">
          <span class="result-party__name">${winner ? '<i class="ti ti-crown result-party__crown" aria-hidden="true"></i> ' : ''}${esc(party.name)}${winner ? ` <span class="sr-only">${esc(tn(party.people.length, 'result.wonSeatsOne', 'result.wonSeats'))}</span>` : ''}</span>
          ${line ? `<span class="result-party__points"><span class="result-points__value">${esc(fmtCount(line.points))}</span>${line.newRecord
            ? `<span class="result-points__record">${iconText('ti-medal', t('points.newRecord'))}</span>` : ''}</span>` : ''}
          <span class="verdict__seats result-party__seats"></span>
        </li>`);
      const seatsEl = row.querySelector('.verdict__seats');
      const people = mineId ? [...party.people.filter((p) => p.id === mineId), ...party.people.filter((p) => p.id !== mineId)] : party.people;
      people.forEach((p) => {
        const done = answered(p.id);
        const state = t(done ? 'result.verdict.answered' : 'result.verdict.open');
        const avatar = p.guest
          ? '<span class="avatar avatar--guest">'
          : `<span class="avatar" style="background:${memberColor(round, p.id)}">`;
        // The name stays in every seat — it is the button's accessible name —
        // and a one-person party hides it visually, its row already naming them.
        const b = h(`<button class="verdict__seat${done ? ' is-done' : ''}" aria-expanded="${open === p.id}" data-verdict-seat="${esc(p.id)}">
            ${avatar}${avatarFace(initials(p.name), { userId: p.userId })}</span>
            <span class="verdict__name">${esc(personLabel(p))}</span>
            <span class="verdict__state">${done ? '<i class="ti ti-check" aria-hidden="true"></i> ' : ''}${esc(state)}</span>
          </button>`);
        b.addEventListener('click', () => {
          open = open === p.id ? null : p.id;
          paint();
          if (open) { const first = askEl.querySelector('.mood'); if (first) first.focus(); }
        });
        seatsEl.appendChild(b);
      });
      listEl.appendChild(row);
    });
    if (automa) {
      listEl.appendChild(h(`<li class="result-party result-party--automa">
          <span class="result-party__name">${iconText('ti-robot', automa.name)}</span>${Number.isInteger(automa.points)
            ? `<span class="result-party__points"><span class="result-points__value">${esc(fmtCount(automa.points))}</span></span>` : ''}
        </li>`));
    }

    askEl.innerHTML = '';
    askEl.hidden = !open;
    if (!open) return;
    const person = parties.flatMap((p) => p.people).find((p) => p.id === open);
    askEl.appendChild(h(`<div class="verdict__prompt">${esc(t('result.verdict.ask', { name: personLabel(person) }))}</div>`));
    const faces = h(`<div class="rating verdict__faces" role="group" aria-label="${esc(t('result.verdict.ask', { name: personLabel(person) }))}"></div>`);
    for (let n = RATING_MIN; n <= RATING_MAX; n++) {
      // Nothing preselected, even for a seat that already answered: the list
      // states who, never what (#1838). Choosing again replaces the verdict.
      const face = voteMoodButton(n, false);
      face.addEventListener('click', async () => {
        try {
          await api('PUT', `/api/rounds/${round.id}/sessions/${session.id}/verdicts/${person.id}`, { gameId: gid, rating: n });
          // Kept in the round copy too, so the Regal reads the new value
          // without a reload — sessions are the source of truth (#1838).
          const all = session.verdicts && typeof session.verdicts === 'object' ? session.verdicts : {};
          session.verdicts = { ...all, [person.id]: { ...(all[person.id] || {}), [gid]: { rating: n } } };
          open = null;
          paint();
          // The seat buttons were rebuilt; give focus back to the one answered.
          const back = [...listEl.querySelectorAll('.verdict__seat')].find((x) => x.dataset.verdictSeat === person.id);
          if (back) back.focus();
          toast(t('result.verdict.saved', { name: personLabel(person) }));
        } catch (e) { toast(e.message, { tone: 'error' }); }
      });
      faces.appendChild(face);
    }
    askEl.appendChild(faces);
  };
  paint();
  slot.appendChild(block);
  slot.hidden = false;
}
