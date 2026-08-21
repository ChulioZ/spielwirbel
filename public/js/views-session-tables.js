/* Spielwirbel – views: the multi-table builder and the split summary (#796).

   `showResults` hands over to this file for a session drawn with „Mehrere
   Tische". It has two states and they are decided by the session, never by a
   local flag: a parent that already carries child ids is done and renders a
   read-only summary; anything else renders the builder.

   Its own file rather than a fifth screen in views-session.js, which is already
   the largest allowlisted view (.claude/rules/token-friendly-source-files.md) and
   is one cohesive flow — start, vote, finale, results — that this deliberately
   forks out of.

   Part of the frontend; all files share one global script scope. */

// Which proposal is showing, and the hand-edited arrangement on top of it. Held
// per view call, never persisted: a reload returns to the stored proposals, which
// is the whole point of computing them server-side.
function tableStateFrom(proposal, parties) {
  const byPerson = new Map();
  parties.forEach((party) => party.personIds.forEach((pid) => byPerson.set(pid, party.id)));
  return proposal.tables.map((tb) => {
    const partyIds = [];
    tb.personIds.forEach((pid) => {
      const id = byPerson.get(pid);
      // A person the session no longer has (a member removed from the round since
      // the draw) simply drops out — the same defensive shape teamsForPeople uses.
      if (id && !partyIds.includes(id)) partyIds.push(id);
    });
    return { gameId: tb.gameId, partyIds };
  });
}

// The people at one table, flattened back out of its parties — what the confirm
// sends and what the per-table numbers are computed over.
function tablePeopleIds(table, partyById) {
  return table.partyIds.flatMap((pid) => (partyById.get(pid) || { personIds: [] }).personIds);
}

async function showTableBuilder(round, session, gamesHint) {
  currentView = () => showTableBuilder(round, session, gamesHint);
  syncUrl(resultsPath(round.id, session.id));
  setContext(round.name);
  // Two states, two headings: once the split is confirmed there is nothing left
  // to build, and a screen still headed „Tische bilden" over a finished evening
  // reads as an action that failed.
  const done = isSplitParent(session);
  const heading = t(done ? 'tables.titleDone' : 'tables.title');
  setDocTitle(heading, round.name);

  const games = session.gameIds
    .map((gid) => round.games.find((g) => g.id === gid) || (gamesHint || []).find((g) => g.id === gid))
    .filter(Boolean);
  const people = sessionPeople(round, session);
  const parties = sessionParties(round, session);
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const gameById = new Map(games.map((g) => [g.id, g]));
  const when = fmtDateTime(session.createdAt);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'session');
  app.appendChild(backRow(() => showRound(round.id)));
  app.appendChild(
    h(`<div class="page-head"><div>
         <h1>${esc(heading)}</h1>
         <div class="muted">${esc(t('result.subtitle', { when, n: games.length }))}</div>
       </div></div>`)
  );

  const body = h('<div></div>');
  app.appendChild(body);

  if (done) renderSplitSummary();
  else await renderBuilder();

  const sessionLog = renderSessionLog(round, session);
  if (sessionLog) app.appendChild(sessionLog);

  // Deleting the parent is the only footer action here: there is nothing to
  // cancel (a split parent is already resolved) and nothing to finish (its
  // children carry the play). #137 — destroying a voted evening is co-owner+.
  if (roundCan(round, 'session.delete')) {
    const footer = h('<div class="section result-footer"></div>');
    const delBtn = h(`<button class="link-btn" style="color:var(--danger)">${esc(t('result.deleteSession'))}</button>`);
    delBtn.addEventListener('click', async () => {
      if (!confirm(t('sessions.deleteConfirm', { when }))) return;
      try {
        await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}`);
        toast(t('sessions.deleted'));
        showRound(round.id);
      } catch (e) { toast(e.message); }
    });
    footer.appendChild(delBtn);
    app.appendChild(footer);
  }

  /* ---- The finished split: one card per child, resolved at render time ----
     Stored ids WILL eventually dangle — a child session can be deleted — so the
     list is built by resolving each id against the round and dropping what is
     gone, rather than trusting the stored array's length. */
  function renderSplitSummary() {
    const children = sessionChildIds(session)
      .map((sid) => (round.sessions || []).find((s) => s.id === sid))
      .filter(Boolean);
    body.appendChild(
      h(`<div class="chosen-banner is-set">${iconText('ti-layout-grid', tn(children.length, 'tables.splitOne', 'tables.split'))}</div>`)
    );
    if (!children.length) {
      body.appendChild(h(`<div class="muted">${esc(t('tables.childrenGone'))}</div>`));
      return;
    }
    // „Teilen" (#526) for a split evening. Its model carries the outcome — so the
    // headline says the evening was split rather than falling through to a
    // message with no account of what happened — plus one line per table, which
    // is the thing this evening's message is actually about.
    if (canShareResult()) {
      const shareBtn = h(`<div class="toolbar"><button class="btn btn--ghost">${iconText('ti-share', t('share.button'))}</button></div>`);
      shareBtn.querySelector('button').addEventListener('click', () => shareResult({
        roundName: round.name,
        when,
        outcome: 'split',
        tables: children.map((child) => ({
          title: (round.games.find((g) => g.id === child.chosenGameId) || {}).title || t('tables.gameGone'),
          names: sessionPeople(round, child).map(personLabel).join(', '),
        })),
      }));
      body.appendChild(shareBtn);
    }

    const list = h('<div class="tables-grid"></div>');
    children.forEach((child) => {
      const game = round.games.find((g) => g.id === child.chosenGameId);
      const names = sessionPeople(round, child).map(personLabel);
      const card = h(`<a class="tables-card">
           <div class="tables-card__head">
             <span class="tables-card__img"${coverBg(game)}>${game ? coverPlaceholder(game) : '<i class="ti ti-cards" aria-hidden="true"></i>'}</span>
             <span class="tables-card__title">${esc(game ? game.title : t('tables.gameGone'))}</span>
           </div>
           <div class="tables-card__people">${names.map(esc).join(', ')}</div>
           <div class="tables-card__meta">${esc(child.finished ? t('sessions.played') : t('tables.childOpen'))}</div>
         </a>`);
      navLink(card, resultsPath(round.id, child.id), () => showResults(round, child));
      list.appendChild(card);
    });
    body.appendChild(list);
  }

  /* ---- The builder ---- */
  async function renderBuilder() {
    let proposals;
    try {
      const data = await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/tables`, {});
      proposals = data.proposals || [];
    } catch (e) {
      body.appendChild(h(`<div class="muted">${esc(e.message)}</div>`));
      return;
    }

    // No feasible split at all — too few people for two tables of three, or fewer
    // usable games than tables needed. Say which, and offer the ordinary results
    // screen rather than stranding the evening on a screen with no action.
    if (!proposals.length) {
      body.appendChild(
        h(`<div class="chosen-banner">${iconText('ti-alert-triangle', t('tables.infeasible', {
          people: people.length,
          games: games.length,
        }))}</div>`)
      );
      const fallback = h(`<div class="toolbar"><button class="btn btn--ghost">${esc(t('tables.showPlainResult'))}</button></div>`);
      fallback.querySelector('button').addEventListener('click', () => showResults(round, session, games, false, true));
      body.appendChild(fallback);
      return;
    }

    // The default is the FIRST proposal, i.e. the fewest tables the pool can seat
    // this group at — the fullest tables, and the arrangement a room with an
    // unknown number of tables is most likely to manage.
    let picked = 0;
    let tables = tableStateFrom(proposals[0], parties);
    let held = null; // the party waiting to be moved, or null

    const counts = h('<div class="filter-chips" role="group"></div>');
    if (proposals.length > 1) {
      counts.setAttribute('aria-label', t('tables.countLabel'));
      proposals.forEach((proposal, i) => {
        const chip = h(`<button type="button" class="chip">${esc(tn(proposal.tables.length, 'tables.countOne', 'tables.count'))}</button>`);
        chip.addEventListener('click', () => {
          picked = i;
          tables = tableStateFrom(proposals[i], parties);
          held = null;
          paint();
        });
        counts.appendChild(chip);
      });
      body.appendChild(counts);
    }

    const grid = h('<div class="tables-grid"></div>');
    body.appendChild(grid);
    const notice = h('<div class="tables-notice"></div>');
    body.appendChild(notice);
    const actions = h('<div class="toolbar"></div>');
    const confirmBtn = h(`<button class="btn btn--primary btn--lg">${iconText('ti-check', t('tables.confirm'))}</button>`);
    confirmBtn.addEventListener('click', confirmSplit);
    actions.appendChild(confirmBtn);
    body.appendChild(actions);

    paint();

    // Everything the screen shows is recomputed from `tables` on every paint, so
    // a hand-edited arrangement is scored by exactly the function that scored the
    // recommendation (.claude/rules/shared-constants-across-the-stack.md).
    function paint() {
      counts.querySelectorAll('.chip').forEach((chip, i) => {
        chip.classList.toggle('is-on', i === picked);
        chip.setAttribute('aria-pressed', String(i === picked));
      });
      grid.replaceChildren();
      const used = new Set(tables.map((tb) => tb.gameId));
      // A game the round archived (or moved to the Wunschliste) since the draw is
      // no longer splittable — the server refuses it, and the children it would
      // spawn are direct-pick sessions, which that same predicate guards. Offering
      // it here would leave the confirm dead with an untranslated marker for an
      // answer (.claude/rules/active-games-filter-sites.md).
      const selectable = games.filter(isActiveGame);
      let blocked = false;
      const flagged = [];

      tables.forEach((table, index) => {
        const game = gameById.get(table.gameId);
        const personIds = tablePeopleIds(table, partyById);
        const fb = tableFeedback({ gameId: table.gameId, personIds }, session.votes || {}, effectiveRating);
        const size = table.partyIds.length;
        const tooSmall = size < MIN_TABLE_PARTIES;
        const stale = !!game && !isActiveGame(game);
        const outOfRange = !game || !fitsPlayerCount(game, size);
        if (tooSmall || outOfRange || stale) blocked = true;
        fb.violations.forEach((pid) => flagged.push({ pid, gameId: table.gameId }));

        const card = h(`<div class="tables-card${tooSmall || outOfRange || stale ? ' is-invalid' : ''}">
             <div class="tables-card__head">
               <span class="tables-card__img"${coverBg(game)}>${game ? coverPlaceholder(game) : ''}</span>
               <select class="input tables-card__select" aria-label="${esc(t('tables.gameLabel', { n: index + 1 }))}"></select>
             </div>
             <div class="tables-card__seats"></div>
             <div class="tables-card__meta">
               <span class="score-pill"${fb.avg === null ? '' : ` style="background:${avgColor(fb.avg)}"`}>Ø ${fb.avg === null ? '–' : fb.avg.toFixed(1)}</span>
               <span class="tables-card__low">${esc(t('tables.lowest', { n: fb.lowest === null ? '–' : fb.lowest }))}</span>
               <span class="tables-card__size">${esc(tn(size, 'tables.partiesOne', 'tables.parties'))}</span>
             </div>
             <div class="tables-card__warn"></div>
           </div>`);
        // Swapping a table's game with one another table holds swaps the two,
        // rather than duplicating a box the group owns once.
        const select = card.querySelector('select');
        // The stale game stays listed while it is the one selected, or the control
        // would silently show a different title than the table actually holds.
        (stale ? [game, ...selectable] : selectable).forEach((g) => {
          const opt = h(`<option value="${esc(g.id)}">${esc(g.title)}</option>`);
          if (g.id === table.gameId) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener('change', () => {
          const next = select.value;
          if (next === table.gameId) return;
          if (used.has(next)) {
            const other = tables.find((tb) => tb.gameId === next);
            if (other) other.gameId = table.gameId;
          }
          table.gameId = next;
          paint();
        });

        const seats = card.querySelector('.tables-card__seats');
        table.partyIds.forEach((pid) => {
          const party = partyById.get(pid);
          if (!party) return;
          const isHeld = held && held.partyId === pid;
          const hurt = party.personIds.some(
            (personId) => fb.violations.includes(personId)
          );
          const chip = h(`<button type="button" class="tables-seat${isHeld ? ' is-held' : ''}${hurt ? ' is-hurt' : ''}" aria-pressed="${isHeld}">${party.team ? '<i class="ti ti-users" aria-hidden="true"></i> ' : ''}${esc(party.name)}</button>`);
          chip.addEventListener('click', () => {
            held = isHeld ? null : { partyId: pid, from: index };
            paint();
          });
          seats.appendChild(chip);
        });

        // The drop half of the move. A button rather than a drag target so it
        // works from the keyboard and on a phone, and it only exists while a
        // party is actually held — nothing on the screen offers an action that
        // would do nothing.
        if (held && held.from !== index) {
          const drop = h(`<button type="button" class="tables-card__drop">${iconText('ti-arrow-down', t('tables.moveHere'))}</button>`);
          drop.addEventListener('click', () => {
            const from = tables[held.from];
            from.partyIds = from.partyIds.filter((x) => x !== held.partyId);
            table.partyIds.push(held.partyId);
            held = null;
            paint();
          });
          card.querySelector('.tables-card__warn').appendChild(drop);
        } else if (tooSmall) {
          card.querySelector('.tables-card__warn').textContent = t('tables.tooSmall', { n: MIN_TABLE_PARTIES });
        } else if (stale) {
          card.querySelector('.tables-card__warn').textContent = t('tables.gameArchived', { title: game.title });
        } else if (outOfRange) {
          card.querySelector('.tables-card__warn').textContent = game
            ? t('tables.outOfRange', { title: game.title })
            : t('tables.gameGone');
        }
        grid.appendChild(card);
      });

      // Naming every unhappy seating is the honest disclosure the issue asks for,
      // and the thing that makes the manual edit obvious. NEVER a score: an
      // aggregate number invites arguing about the formula instead of about the
      // evening.
      notice.replaceChildren();
      flagged.forEach(({ pid, gameId }) => {
        const person = people.find((x) => x.id === pid);
        const game = gameById.get(gameId);
        if (!person || !game) return;
        notice.appendChild(
          h(`<div class="tables-notice__row">${iconText('ti-mood-sad', t('tables.unhappy', { name: personLabel(person), title: game.title }))}</div>`)
        );
      });
      confirmBtn.disabled = blocked;
      confirmBtn.title = blocked ? t('tables.blocked') : '';
    }

    async function confirmSplit() {
      const payload = tables.map((table) => ({
        gameId: table.gameId,
        personIds: tablePeopleIds(table, partyById),
      }));
      try {
        await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/split`, { tables: payload });
        toast(tn(payload.length, 'tables.toast.splitOne', 'tables.toast.split'));
        await fetchRoundFresh(round.id);
        showRound(round.id, 'start');
      } catch (e) { toast(e.message); }
    }
  }
}

// Covers are painted straight onto the tile rather than lazily (#198): this
// screen holds one card per table — a dozen at most, all of them the thing the
// group is looking at — so there is nothing below the fold to defer.
function coverBg(game) {
  return game && game.image ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
}
