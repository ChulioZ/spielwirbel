/* Spielwirbel – views: the Chronik tab, one month-grouped timeline of finished
   sessions and shelf changes. Rendered by showRound() (views-round.js).
   Part of the frontend; all files share one global script scope. */

// --- Chronik tab: one timeline of sessions and shelf changes. The activity
// feed arrives as its own argument (fetched per visit by showRound, #197) —
// it is no longer part of the round payload.
// The timeline's visual tiers (#633). Keyed on the event TYPE, never on the icon
// class the row happens to render: `ti-trash` is `game_retired` AND
// `game_deleted`, so an icon-based match would wash a deletion as a milestone.
// Everything not listed here keeps the neutral middle tier — a move, an import,
// a new seat and a rename are bookkeeping, not moments in the round's history.
const CHRONIK_MILESTONES = ['game_retired', 'game_completed', 'game_restored', 'game_uncompleted'];
const chronikTier = (type) =>
  CHRONIK_MILESTONES.includes(type) ? 'milestone' : type === 'game_added' ? 'add' : '';

const CHRONIK_FILTERS = ['all', 'sessions', 'changes'];

function renderChronikTab(round, activities) {
  const rid = round.id;
  const loadCover = createCoverLoader(); // lazy session thumbs (#198)

  // The chip choice persists for the session but is scoped to one round — the
  // same guard renderRegalTab opens with. An unknown value (a filter dropped in
  // a later redesign, still sitting in the module-level slot) falls back to
  // 'all', so the timeline can never render with no chip lit.
  if (chronikFilterRid !== round.id) {
    chronikFilter = 'all';
    chronikFilterRid = round.id;
  }
  if (!CHRONIK_FILTERS.includes(chronikFilter)) chronikFilter = 'all';

  // Collect all entries: done sessions as cards, game activities as quiet rows.
  //
  // A multi-table split's children (#796) are NOT top-level entries: they are the
  // tables of one evening, so they nest under their parent's card instead of
  // scattering three near-identical rows through the timeline at the same
  // minute. The parent is resolved rather than trusted — a deleted parent leaves
  // its children as ordinary sessions, which is what they are once nothing ties
  // them together.
  const entries = [];
  const doneSessions = round.sessions.filter((s) => s.done);
  const parentIds = new Set(doneSessions.filter(isSplitParent).map((s) => s.id));
  const childrenOf = new Map();
  doneSessions.forEach((s) => {
    if (!s.parentSessionId || !parentIds.has(s.parentSessionId)) return;
    const list = childrenOf.get(s.parentSessionId) || [];
    list.push(s);
    childrenOf.set(s.parentSessionId, list);
  });
  doneSessions
    .filter((s) => !(s.parentSessionId && parentIds.has(s.parentSessionId)))
    .forEach((s) => entries.push({ kind: 'session', at: s.createdAt, session: s }));
  (activities || []).forEach((a) => {
    const meta = {
      game_added: { icon: 'ti-plus', text: t('activity.gameAdded', { title: a.title }) },
      game_retired: { icon: 'ti-trash', text: t('activity.gameRetired', { title: a.title }) },
      game_restored: { icon: 'ti-arrow-back-up', text: t('activity.gameRestored', { title: a.title }) },
      game_completed: { icon: 'ti-circle-check', text: t('activity.gameCompleted', { title: a.title }) },
      game_uncompleted: { icon: 'ti-arrow-back-up', text: t('activity.gameUncompleted', { title: a.title }) },
      game_deleted: { icon: 'ti-trash', text: t('activity.gameDeleted', { title: a.title }) },
      // One bulk entry per side of a whole-shelf move (#253) — these carry a
      // count and the other round's name, not a game title.
      games_moved_out: { icon: 'ti-arrow-right', text: tn(a.count, 'activity.gamesMovedOutOne', 'activity.gamesMovedOut', { round: a.roundName }) },
      games_moved_in: { icon: 'ti-arrow-left', text: tn(a.count, 'activity.gamesMovedInOne', 'activity.gamesMovedIn', { round: a.roundName }) },
      // One bulk entry per collection import (#481) — a count, not a title, for
      // the same reason as the two moves above: an import is routinely 100+
      // games and a row each would bury every other event on the round.
      games_imported: { icon: 'ti-download', text: tn(a.count, 'activity.gamesImportedOne', 'activity.gamesImported') },
      // A new seat (#563) — carries the member's NAME, not a game title. Written
      // for both an added seat and an accepted invitation (#207), since either way
      // a new person is in the round.
      member_added: { icon: 'ti-user-plus', text: t('activity.memberAdded', { name: a.name }) },
      // A rename (#562) — the round's NEW name. Renaming is open to a grantee
      // (it is acting within the round, not destroying it), so this entry is how
      // an owner sees that their shared round changed name, and who did it. The
      // previous name is deliberately not stored: it would outlive a moderation
      // redaction of the round's name.
      round_renamed: { icon: 'ti-pencil', text: t('activity.roundRenamed', { name: a.name }) },
      // Owned expansions (#653) — a count plus the GAME's title, for the same
      // reason the three bulk entries above carry counts: one save can tick ten
      // boxes. A quiet row, deliberately not a CHRONIK_MILESTONES entry: adding
      // an expansion is not on the level of retiring a game.
      game_expansion_added: { icon: 'ti-puzzle', text: tn(a.count, 'activity.expansionAddedOne', 'activity.expansionAdded', { title: a.title }) },
    }[a.type];
    if (!meta) return;
    // Who did it (#207): resolve the actor's member seat to a name (like
    // winnerNames). Absent on single-actor rounds, so nothing is shown there.
    const by = a.actorMemberId && (round.members.find((m) => m.id === a.actorMemberId) || {}).name;
    entries.push({ kind: 'activity', at: a.at, id: a.id, gameId: a.gameId, type: a.type, by, ...meta });
  });
  entries.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const sec = h('<div class="section"></div>');
  sec.appendChild(h(`<div class="section-head"><h1>${esc(t('chronik.title'))}</h1></div>`));

  // Filter chips: everything / sessions only / shelf changes only. `is-on` is
  // driven by the remembered choice rather than hard-coded onto "all", or the
  // marked chip and the timeline would disagree on every return to the tab.
  const on = (f) => (f === chronikFilter ? ' is-on' : '');
  const chips = h(`<div class="filter-chips">
      <button class="chip${on('all')}" data-f="all">${esc(t('chronik.filter.all'))}</button>
      <button class="chip${on('sessions')}" data-f="sessions"><i class="ti ti-confetti" aria-hidden="true"></i>${esc(t('chronik.filter.sessions'))}</button>
      <button class="chip${on('changes')}" data-f="changes"><i class="ti ti-cards" aria-hidden="true"></i>${esc(t('chronik.filter.changes'))}</button>
    </div>`);
  chips.querySelectorAll('[data-f]').forEach((chip) => {
    chip.addEventListener('click', () => {
      chronikFilter = chip.dataset.f;
      chips.querySelectorAll('[data-f]').forEach((c) => c.classList.toggle('is-on', c === chip));
      renderTimeline();
    });
  });
  sec.appendChild(chips);

  const tl = h('<div class="timeline"></div>');
  sec.appendChild(tl);
  app.appendChild(sec);

  function buildSessionCard(s) {
    const when = fmtDateTime(s.createdAt);
    const chosen = s.chosenGameId && round.games.find((g) => g.id === s.chosenGameId);
    // Against the session's own people, so a guest winner is listed with its
    // marker rather than silently dropped (#458).
    const sPeople = sessionPeople(round, s);
    const winnerNames = (s.winnerIds || [])
      .map((wid) => personLabel(sPeople.find((p) => p.id === wid)))
      .filter(Boolean);

    // Thumbnail: the chosen game's cover, or an icon for the session's state.
    // Keyed on `sessionOutcome` (#796) rather than on `s.cancelled`, or a split
    // parent — which has no chosen game and is not cancelled — would render with
    // the played icon and read as a night that happened at one table.
    const outcome = sessionOutcome(s);
    const stateIcon = outcome === 'cancelled' ? 'ti-x' : outcome === 'split' ? 'ti-layout-grid' : 'ti-cards';
    const thumbIcon = chosen
      ? coverPlaceholder(chosen)
      : `<i class="ti ${stateIcon}" aria-hidden="true"></i>`;

    // Headline is the chosen game (with a rating pill); the date leads only
    // when no game was played. The meta line carries the rest.
    const title = chosen ? esc(chosen.title) : esc(when);
    let pill = '';
    if (chosen) {
      const sst = gameStatsForSession(round, s, chosen.id);
      if (sst.avg !== null) pill = `<span class="score-pill" style="background:${avgColor(sst.avg)}">Ø ${sst.avg.toFixed(1)}</span>`;
    }

    const parts = [];
    if (chosen) parts.push(esc(when));
    if (outcome === 'split') parts.push(iconText('ti-layout-grid', t('sessions.split')));
    else if (s.finished) parts.push(winnerNames.length ? '<i class="ti ti-trophy" aria-hidden="true"></i> ' + winnerNames.map(esc).join(', ') : iconText('ti-check', t('sessions.played')));
    else if (outcome === 'cancelled') parts.push(`<span style="color:var(--danger)">${iconText('ti-x', t('sessions.cancelled'))}</span>`);
    parts.push(esc(t('sessions.rated', { n: s.gameIds.length })));

    const card = h(`<a class="session-card">
         <div class="session-card__img">${thumbIcon}</div>
         <div class="session-card__body">
           <div class="session-card__title">${title}${pill}</div>
           <div class="session-card__meta">${parts.join(' · ')}</div>
         </div>
       </a>`);
    if (chosen && chosen.image) loadCover(card.querySelector('.session-card__img'), coverUrl(chosen.image, COVER_THUMB));
    navLink(card, resultsPath(round.id, s.id), () => showResults(round, s));
    return card;
  }

  function buildActivityRow(e) {
    // #137: an entry is part of the round's shared history, so removing one is
    // co-owner and up. Below that the button is not rendered at all — the row
    // still opens its target, and the route refuses the delete regardless.
    const canDelete = roundCan(round, 'activity.delete');
    // Navigate to the game (if it still exists) or to the archive.
    const gameExists = e.gameId && round.games.some((g) => g.id === e.gameId);
    const target =
      e.type === 'game_retired'
        ? { path: roundPath(rid, 'retired'), nav: () => showRetired(rid) }
        : e.type === 'game_completed'
          ? { path: roundPath(rid, 'completed'), nav: () => showCompleted(rid) }
          : gameExists
            ? { path: gamePath(rid, e.gameId), nav: () => showGameDetail(rid, e.gameId) }
            : null;
    // Only the TEXT becomes an <a> (#330): the row also holds the delete button,
    // and a <button> inside an <a> is invalid markup. So the text carries the
    // href — new tab, copy address, link semantics — while the row keeps the
    // generous click target it always had around it.
    const by = e.by ? `<span class="tl-act__by">${esc(t('activity.by', { name: e.by }))}</span>` : '';
    const tier = chronikTier(e.type);
    const row = h(`<div class="tl-act${target ? ' tl-act--link' : ''}${tier ? ` tl-act--${tier}` : ''}">
         <span class="tl-act__icon"><i class="ti ${e.icon}" aria-hidden="true"></i></span>
         ${target ? `<a class="tl-act__text">${esc(e.text)}</a>` : `<span class="tl-act__text">${esc(e.text)}</span>`}
         ${by}
         <span class="tl-act__time">${fmtDateTime(e.at)}</span>
         ${canDelete ? `<button class="tl-act__del" title="${esc(t('activity.delete'))}" aria-label="${esc(t('activity.delete'))}"><i class="ti ti-x" aria-hidden="true"></i></button>` : ''}
       </div>`);
    if (target) {
      navLink(row.querySelector('.tl-act__text'), target.path, target.nav);
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('.tl-act__del')) return; // delete is not "open"
        // The anchor owns its own clicks — including a Cmd/middle-click, which
        // it lets through to the browser. Navigating here too would open the
        // new tab AND move this one.
        if (ev.target.closest('.tl-act__text')) return;
        target.nav();
      });
    }
    if (canDelete) row.querySelector('.tl-act__del').addEventListener('click', async () => {
      if (!confirm(t('activity.deleteConfirm'))) return;
      try {
        await api('DELETE', `/api/rounds/${rid}/activities/${e.id}`);
        toast(t('activity.deleted'));
        showRound(rid, 'chronik');
      } catch (err) { toast(err.message); }
    });
    return row;
  }

  // Month-grouped timeline, newest first.
  function renderTimeline() {
    tl.innerHTML = '';
    const visible = entries.filter((e) =>
      chronikFilter === 'all' ? true : chronikFilter === 'sessions' ? e.kind === 'session' : e.kind === 'activity'
    );
    if (visible.length === 0) {
      tl.appendChild(h(`<div class="muted">${esc(t('chronik.empty'))}</div>`));
      return;
    }
    let lastMonth = '';
    visible.forEach((e) => {
      const month = fmtMonth(e.at);
      if (month !== lastMonth) {
        lastMonth = month;
        tl.appendChild(h(`<div class="tl-month">${esc(month)}</div>`));
      }
      const dot = e.kind === 'session' ? ' tl-dot--session'
        : chronikTier(e.type) === 'milestone' ? ' tl-dot--milestone' : '';
      const item = h(`<div class="tl-item"><span class="tl-dot${dot}"></span></div>`);
      item.appendChild(e.kind === 'session' ? buildSessionCard(e.session) : buildActivityRow(e));
      // The tables of a split evening, indented under the parent they came from
      // (#796). Newest-first everywhere else in this timeline, but a split's
      // tables are siblings of one moment, so they keep their creation order.
      const kids = e.kind === 'session' ? childrenOf.get(e.session.id) : null;
      if (kids && kids.length) {
        const nest = h('<div class="tl-nest"></div>');
        kids.forEach((child) => nest.appendChild(buildSessionCard(child)));
        item.appendChild(nest);
      }
      tl.appendChild(item);
    });
  }
  renderTimeline();
  // Deleting (or leaving) the round used to end this timeline, and it was the one
  // round action with no good home at any width: unlike the Regal's footer this
  // one was not `rail-owned`, so it stayed below the whole history on desktop too,
  // while the rail carried no entry for it. It is the danger zone of the round's
  // Einstellungen screen now (#561) — deleting a round is not a history concern.
}
