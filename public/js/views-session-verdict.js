/* Spielwirbel – views: „Wie war's?" on a played session's result (#1838).

   After the game, the people who sat at the table may say how it was, on the
   same five faces and words the vote uses. Optional, no time limit, editable
   later on the same session. A verdict replaces its seat's share of the play's
   assumed value in the shelf score (vote-score.js `playValue`) and counts as a
   rating everywhere a figure describes how someone likes a game
   (session-ratings.js).

   The band shows WHO has answered, never WHAT — so the second player is not
   anchored by the first face (the same reason the vote hides finished votes).
   Tapping a seat opens the faces for that seat, nothing preselected; choosing
   one saves it and closes. On a shared device that is seat by seat; on one's
   own device the viewer's own seat comes first (`mySeatIn`, attribution, not
   access — the route lets anyone with round access write any seated verdict,
   exactly like a vote).

   Rendered by resultRenderBand in the settled-record state, so every design
   gets it; a design restyles `.verdict`, it must not fork it. Part of the
   frontend; all files share one global script scope. */

function resultRenderVerdicts(rs, into) {
  const { round, session } = rs;
  if (!rs.finished || rs.cancelled || rs.pickerOpen || !rs.chosenId) return;
  const gid = rs.chosenId;
  const seated = sessionPeople(round, session);
  if (!seated.length) return;
  const mine = mySeatIn(round, session);
  const people = mine ? [...seated.filter((p) => p.id === mine.id), ...seated.filter((p) => p.id !== mine.id)] : seated;

  const block = h(`<section class="verdict" aria-labelledby="verdictTitle">
      <h3 class="verdict__title" id="verdictTitle">${esc(t('result.verdict.title'))}</h3>
      <p class="verdict__sub">${esc(t('result.verdict.sub'))}</p>
      <div class="verdict__seats"></div>
      <div class="verdict__ask" hidden></div>
    </section>`);
  const seatsEl = block.querySelector('.verdict__seats');
  const askEl = block.querySelector('.verdict__ask');

  const answered = (pid) => verdictOf(session, pid, gid) !== null;
  let open = null;

  const paint = () => {
    seatsEl.innerHTML = '';
    people.forEach((p) => {
      const done = answered(p.id);
      const state = t(done ? 'result.verdict.answered' : 'result.verdict.open');
      const avatar = p.guest
        ? '<span class="avatar avatar--guest">'
        : `<span class="avatar" style="background:${memberColor(round, p.id)}">`;
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

    askEl.innerHTML = '';
    askEl.hidden = !open;
    if (!open) return;
    const person = people.find((p) => p.id === open);
    askEl.appendChild(h(`<div class="verdict__prompt">${esc(t('result.verdict.ask', { name: personLabel(person) }))}</div>`));
    const faces = h(`<div class="rating verdict__faces" role="group" aria-label="${esc(t('result.verdict.ask', { name: personLabel(person) }))}"></div>`);
    for (let n = RATING_MIN; n <= RATING_MAX; n++) {
      // Nothing preselected, even for a seat that already answered: the band
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
          const back = [...seatsEl.querySelectorAll('.verdict__seat')].find((x) => x.dataset.verdictSeat === person.id);
          if (back) back.focus();
          toast(t('result.verdict.saved', { name: personLabel(person) }));
        } catch (e) { toast(e.message, { tone: 'error' }); }
      });
      faces.appendChild(face);
    }
    askEl.appendChild(faces);
  };
  paint();
  into.appendChild(block);
}
