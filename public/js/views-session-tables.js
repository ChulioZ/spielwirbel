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
  /* The round's marker, for the same reason `showResults` applies it and not
     the hub (#940): this is a routed screen reached cold — a shared link, a
     reload, the Chronik — and `showResults` hands over to us BEFORE its own
     `applyMarker` line, so a split evening used to render without the round's
     colour. Idempotent, so arriving from the hub pays nothing for it. */
  applyMarker(round);
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
  // The finished split's tables, resolved against the round (see
  // renderSplitSummary for why the stored ids are never trusted as-is).
  const children = done
    ? sessionChildIds(session).map((sid) => (round.sessions || []).find((s) => s.id === sid)).filter(Boolean)
    : [];
  // Der Tisch composes the finished split as ONE screen about the session
  // (#1270, T4.5/T6.6): „2 Tische, eine Session" over who was there and where
  // the results go, instead of Klassisch's heading plus a banner saying the
  // same thing twice. Klassisch keeps its head byte-for-byte.
  const tischSplit = done && children.length > 0 && designIs('tisch');
  const subline = tischSplit
    ? [
      tn(people.length, 'tables.peopleOne', 'tables.people'),
      when,
      t('tables.sameChronik'),
    ].join(' · ')
    : tn(games.length, 'result.subtitleOne', 'result.subtitle', { when });
  app.appendChild(
    h(`<div class="page-head${tischSplit ? ' page-head--tables' : ''}"><div>
         <h1>${esc(tischSplit ? tn(children.length, 'tables.headDoneOne', 'tables.headDone') : heading)}</h1>
         <div class="muted">${esc(subline)}</div>
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
      if (!await confirmDialog({
        body: t('sessions.deleteConfirm', { when }),
        confirmLabel: t('result.deleteSession'), icon: 'ti-trash',
      })) return;
      try {
        await api('DELETE', `/api/rounds/${round.id}/sessions/${session.id}`);
        toast(t('sessions.deleted'));
        showRound(round.id);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
    footer.appendChild(delBtn);
    app.appendChild(footer);
  }

  /* ---- The finished split: one card per child, resolved at render time ----
     Stored ids WILL eventually dangle — a child session can be deleted — so the
     list is built by resolving each id against the round and dropping what is
     gone, rather than trusting the stored array's length. */
  function renderSplitSummary() {
    if (tischSplit) {
      body.appendChild(renderTischSplit(round, session, games, children));
      return;
    }
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

    /* One SPOTLIGHT per table (#957) — the component the single-table results
       screen opens with (views-session.js), rather than a second visual language
       for the same fact: a finished evening, and what was played at it. The card
       itself is the link, so the winner inside it is a <span>, not the <a> the
       sibling uses for a game link — an anchor inside an anchor is invalid and
       the inner one would swallow the outer target.

       No `is-reveal` here, deliberately. This screen is only ever a REVISIT:
       confirming a split navigates to the hub, and every other way in is the
       Chronik, the hub's split group or a shared URL. A reveal would therefore
       replay on every single visit, which is what #940's note at
       views-session.js:837 guards against. */
    const list = h('<div class="split-tables"></div>');
    const STATE = {
      played: { key: 'sessions.played', icon: 'ti-crown' },
      cancelled: { key: 'sessions.cancelled', icon: 'ti-ban' },
      open: { key: 'tables.childOpen', icon: 'ti-hourglass' },
    };
    children.forEach((child, index) => {
      const game = round.games.find((g) => g.id === child.chosenGameId);
      const seated = sessionPeople(round, child);
      const outcome = sessionOutcome(child);
      // A child table that was PLAYED and that nobody won says how it ended
      // (#1038) — the STATE map above keys on `sessionOutcome` alone, so without
      // this a lost coop table reads „Gespielt" beside its siblings.
      const endMeta = ENDING_LABELS[sessionEnding(child)];
      const state = endMeta
        ? { key: endMeta.key, icon: endMeta.icon }
        : (STATE[outcome] || STATE.open);
      /* What the people at this table thought of the game they played, weighed
         through the SAME curve the builder scored the proposal with — so the
         card states the number this split was chosen on rather than a second
         opinion of it. The votes are the PARENT's: a child is a direct-pick
         session created with `votes: {}` and never collects any of its own
         (lib/session-split.js).

         Members keep their id across the split; guests do not, because
         buildChildSessions mints fresh guest ids. So a guest's vote is not
         attributable here and counts as NEUTRAL_RATING — precisely what
         seatRating already does for anybody who did not vote. */
      const fb = outcome === 'played'
        ? tableFeedback(
          { gameId: child.chosenGameId, personIds: seated.map((p) => p.id) },
          session.votes || {},
          tileValue
        )
        : null;
      const pill = fb && fb.avg !== null
        ? `<span class="score-pill spotlight__pill" style="--sc:${scoreColor(fb.avg)}" data-stop="${scoreStop(fb.avg)}">${esc(fmtAvg(displayScore(fb.avg)))}</span>`
        : '';
      const card = h(`<a class="spotlight spotlight--table${outcome === 'played' ? '' : ' is-off'}">
           <div class="spotlight__kicker">
             <i class="ti ${state.icon} spotlight__crown" aria-hidden="true"></i>
             ${esc(t('tables.tableLabel', { n: index + 1 }))}
           </div>
           <div class="spotlight__winners">
             <span class="spotlight__winner">
               <span class="spotlight__img"${tableCoverBg(game)}>${game ? coverPlaceholder(game) : '<i class="ti ti-cards" aria-hidden="true"></i>'}</span>
               <span class="spotlight__title">${esc(game ? game.title : t('tables.gameGone'))}</span>
               ${pill}
             </span>
           </div>
           <div class="spotlight__seats">${seated.map((p) => `<span class="spotlight__seat">
                  <span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${avatarFace(initials(p.name), { userId: p.userId })}</span>
                  <span class="spotlight__seat-name">${esc(personLabel(p))}</span>
                </span>`).join('')}</div>
           <div class="spotlight__state">${esc(t(state.key))}</div>
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
        const fb = tableFeedback({ gameId: table.gameId, personIds }, session.votes || {}, tileValue);
        const size = table.partyIds.length;
        const tooSmall = size < MIN_TABLE_PARTIES;
        const stale = !!game && !isActiveGame(game);
        const outOfRange = !game || !fitsPlayerCount(game, size);
        if (tooSmall || outOfRange || stale) blocked = true;
        fb.violations.forEach((pid) => flagged.push({ pid, gameId: table.gameId }));

        const card = h(`<div class="tables-card${tooSmall || outOfRange || stale ? ' is-invalid' : ''}">
             <div class="tables-card__head">
               <span class="tables-card__img"${tableCoverBg(game)}>${game ? coverPlaceholder(game) : ''}</span>
               <select class="input tables-card__select" aria-label="${esc(t('tables.gameLabel', { n: index + 1 }))}"></select>
             </div>
             <div class="tables-card__seats"></div>
             <div class="tables-card__meta">
               <span class="score-pill"${fb.avg === null ? '' : ` style="--sc:${scoreColor(fb.avg)}" data-stop="${scoreStop(fb.avg)}"`}>${fb.avg === null ? '–' : fmtAvg(displayScore(fb.avg))}</span>
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
      } catch (e) { toast(e.message, { tone: 'error' }); }
    }
  }
}

/* ---- Der Tisch: one result per table (#1270, T4.5 desktop / T6.6 phone) ----
   Each table is the result screen in miniature: its own felt head — the table's
   label, the people at it (a crown over whoever won) and the result screen's
   standard sentence — over a paper Tafel of that table's ranking. A footer
   carries „Alle Tische teilen" and the round's start action.

   THE TAFEL IS DERIVED, and it has to be. A split session holds ONE vote — the
   parent's — and each child is a direct-pick session created with `votes: {}`
   (lib/session-split.js). So a table's ranking is the parent's draw scored with
   only that table's seated people, through `tableFeedback`: the SAME function
   and the same curve the builder chose this split on, and the one the Klassisch
   card's pill already prints. A guest's child id is freshly minted, so their
   vote is not attributable and counts as NEUTRAL_RATING — exactly as the pill
   treats it. Nothing is stored; a different reading of the same votes would be
   a second opinion of the split, which is what the Klassisch card avoids too.

   Returns a fragment; the caller owns where it goes. */
function renderTischSplit(round, session, games, children) {
  const frag = document.createDocumentFragment();
  const voted = sessionHasVotes(session);
  const baseMarker = roundMarker(round);
  const list = h('<div class="split-tables split-tables--tisch"></div>');
  children.forEach((child, index) => {
    list.appendChild(renderTischTable(round, session, games, children, child, index, voted, baseMarker));
  });
  frag.appendChild(list);

  // The foot (T4.5, T6.6). Same share model as Klassisch's button — one message
  // covering every table, which IS „both" — and the round's own start action,
  // gated exactly as the hub gates it. Rendered only when there is something to
  // put in it, so the footer never stands empty.
  const foot = h('<div class="split-tables__foot"></div>');
  if (canShareResult()) {
    const shareBtn = h(`<button type="button" class="btn btn--ghost">${iconText('ti-share', t('tables.shareAll'))}</button>`);
    shareBtn.addEventListener('click', () => shareResult({
      roundName: round.name,
      when: fmtDateTime(session.createdAt),
      outcome: 'split',
      tables: children.map((child) => ({
        title: (round.games.find((g) => g.id === child.chosenGameId) || {}).title || t('tables.gameGone'),
        names: sessionPeople(round, child).map(personLabel).join(', '),
      })),
    }));
    foot.appendChild(shareBtn);
  }
  // „Noch eine Session", not the hub's „Session wirbeln": after a night that
  // just ended the sheet's words are „one more" (T4.5), and „Runde" is the
  // group here, so it reads Session (operator decision, 2026-09-24).
  const startBtn = h(`<button type="button" class="btn btn--primary">${iconText('ti-tornado', t('tables.oneMore'))}</button>`);
  startBtn.addEventListener('click', () => showStartSession(round));
  if (!round.games.some(isActiveGame)) {
    startBtn.disabled = true;
    startBtn.title = t('round.startSessionDisabled');
  }
  foot.appendChild(startBtn);
  frag.appendChild(foot);
  return frag;
}

function renderTischTable(round, session, games, children, child, index, voted, baseMarker) {
  const game = round.games.find((g) => g.id === child.chosenGameId);
  const gname = game ? game.title : t('tables.gameGone');
  const seated = sessionPeople(round, child);
  const outcome = sessionOutcome(child);
  const winners = new Set(child.winnerIds || []);

  // The standard sentence — the result screen's own keys (views-session.js
  // updateTitle), so a table says what that table's result screen says. The
  // winners' names are cut out of the escaped string and put back inside a span,
  // which is what lets the design set them apart without a second copy of the
  // sentence's grammar.
  const MARK = '\u0001';
  let sentence;
  const names = seated.filter((p) => winners.has(p.id)).map(personLabel);
  if (outcome === 'cancelled') sentence = esc(t('result.titleCancelled'));
  else if (outcome !== 'played') sentence = esc(t('tables.sentenceOpen', { game: gname }));
  else if (names.length) {
    sentence = esc(tn(names.length, 'result.titleWonOne', 'result.titleWonMany', { game: gname, names: MARK }))
      .replace(MARK, `<span class="split-table__winners">${esc(joinNames(names))}</span>`);
  } else {
    const meta = ENDING_LABELS[sessionEnding(child)];
    sentence = esc(meta ? t(meta.title, { game: gname }) : t('result.titlePlayed', { game: gname }));
  }

  // Each table on its own felt: the round's marker for the first, the design's
  // next felts for the rest, so two tables read as two tables. Every felt's
  // light and deep stop is swept against --felt-ink by test/a11y-contrast.test.js.
  const felt = markerOf(activeDesign().id, (baseMarker + index) % MARKER_COUNT);
  const feltStyle = felt ? ` style="--marker:${felt.color};--marker-deep:${felt.deep}"` : '';
  const pips = seated.map((p) => `<span class="split-table__person${winners.has(p.id) ? ' is-winner' : ''}" title="${esc(personLabel(p))}">
       ${winners.has(p.id) ? '<i class="ti ti-crown split-table__crown" aria-hidden="true"></i>' : ''}
       <span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${avatarFace(initials(p.name), { userId: p.userId })}</span>
     </span>`).join('');

  const table = h(`<article class="split-table${outcome === 'played' ? '' : ' is-off'}">
       <a class="split-table__head"${feltStyle}>
         <span class="split-table__top">
           <span class="split-table__label">${esc(t('tables.tableLabel', { n: index + 1 }))}</span>
           <span class="split-table__people" aria-hidden="true">${pips}</span>
         </span>
         <span class="split-table__sentence">${sentence}</span>
         <span class="sr-only">${esc(t('result.participants'))}: ${esc(seated.map(personLabel).join(', '))}</span>
       </a>
     </article>`);
  navLink(table.querySelector('.split-table__head'), resultsPath(round.id, child.id), () => showResults(round, child));

  // A cancelled table played nothing, so it has nothing to rank; nor does a
  // split nobody voted on — a table of neutral fallbacks is not a ranking.
  if (voted && outcome !== 'cancelled' && games.length) {
    table.appendChild(renderTischTableTafel(round, session, games, children, child, seated));
  }
  return table;
}

function renderTischTableTafel(round, session, games, children, child, seated) {
  const personIds = seated.map((p) => p.id);
  const rows = games.map((g) => {
    const fb = tableFeedback({ gameId: g.id, personIds }, session.votes || {}, tileValue);
    const score = fb.avg === null ? 0 : fb.avg;
    return { game: g, score, shown: displayScore(score), count: personIds.length };
  });
  rows.sort((a, b) => b.score - a.score);
  computePlaces(rows).forEach((place, i) => { rows[i].place = place; });
  // Three rows, as both sheets draw it — plus the game this table actually
  // played when the ranking put it lower, at its real place, so the Tafel never
  // hides the one row the head's sentence is about.
  const shown = rows.slice(0, 3);
  const played = rows.find((r) => r.game.id === child.chosenGameId);
  if (played && !shown.includes(played)) shown.push(played);

  const tafel = h(`<div class="split-table__tafel"></div>`);
  shown.forEach((r) => {
    const g = r.game;
    const here = g.id === child.chosenGameId;
    // A game the draw sent to ANOTHER table says which — otherwise a top row
    // that was not played here reads as a mistake.
    const elsewhere = here ? -1 : children.findIndex((c) => c !== child && c.chosenGameId === g.id);
    const tag = here
      ? t('sessions.played')
      : elsewhere >= 0 ? t('tables.tableLabel', { n: elsewhere + 1 }) : '';
    const bringers = boxBringers(round, child, g, shelfParty);
    const row = h(`<div class="split-row${here ? ' is-played' : ''}">
         <span class="split-row__rank">${r.place || ''}</span>
         <span class="split-row__img"${tableCoverBg(g)}>${coverPlaceholder(g)}</span>
         <span class="split-row__main">
           <a class="split-row__title">${esc(g.title)}</a>
           ${bringers.length ? `<span class="split-row__owners">${esc(t('result.ownedBy', { names: bringers.join(', ') }))}</span>` : ''}
         </span>
         <span class="score-pill split-row__pill" style="--sc:${scoreColor(r.score)}" data-stop="${scoreStop(r.score)}">${esc(fmtAvg(r.shown))}</span>
         <span class="split-row__tag">${esc(tag)}</span>
       </div>`);
    makeGameLink(row.querySelector('.split-row__title'), round.id, g.id);
    tafel.appendChild(row);
  });
  return tafel;
}

// Covers are painted straight onto the tile rather than lazily (#198): this
// screen holds one card per table — a dozen at most, all of them the thing the
// group is looking at — so there is nothing below the fold to defer.
function tableCoverBg(game) {
  return game && game.image ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
}
