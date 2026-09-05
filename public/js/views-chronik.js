/* Spielwirbel – views: the Chronik tab, one month-grouped timeline of finished
   sessions and shelf changes, with the per-period recap (#800) as its own
   section above it (#851). Rendered by showRound() (views-round.js).
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
      games_copied_out: { icon: 'ti-copy', text: tn(a.count, 'activity.gamesCopiedOutOne', 'activity.gamesCopiedOut', { round: a.roundName }) },
      games_copied_in: { icon: 'ti-copy', text: tn(a.count, 'activity.gamesCopiedInOne', 'activity.gamesCopiedIn', { round: a.roundName }) },
      // One bulk entry per collection import (#481) — a count, not a title, for
      // the same reason as the two moves above: an import is routinely 100+
      // games and a row each would bury every other event on the round.
      games_imported: { icon: 'ti-download', text: tn(a.count, 'activity.gamesImportedOne', 'activity.gamesImported') },
      // Bulk shelf tidying (#832) — counts for the same reason as the three
      // above, and the reason bites hardest here: undoing a 200-game import
      // would otherwise bury every other event the round has ever had.
      games_retired: { icon: 'ti-trash', text: tn(a.count, 'activity.gamesRetiredOne', 'activity.gamesRetired') },
      games_deleted: { icon: 'ti-trash', text: tn(a.count, 'activity.gamesDeletedOne', 'activity.gamesDeleted') },
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

  // The per-period recap (#800) is its own section ABOVE the timeline (#851):
  // the Chronik is the round's time axis, so the shareable card for a month
  // belongs beside the very stretch of history it summarises. It renders
  // nothing at all when the round has no period worth offering.
  const periodSec = renderPeriodRecapSection(round, activities);
  if (periodSec) app.appendChild(periodSec);

  // Exactly one <h1> on the screen, and it is this one — the recap above keeps
  // its <h2>. That does put an h2 before the h1 in document order; it is an
  // accepted trade-off of the placement, not a WCAG 1.3.1 failure (which is
  // about structure, not level sequencing), and the screen's name in the title
  // bar comes from setDocTitle (.claude/rules/per-view-document-title.md).
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
      if (sst.score !== null) pill = `<span class="score-pill" style="background:${scoreColor(sst.score)}">${fmtAvg(displayScore(sst.score))}</span>`;
    }

    const parts = [];
    if (chosen) parts.push(esc(when));
    if (outcome === 'split') parts.push(iconText('ti-layout-grid', t('sessions.split')));
    else if (s.finished) parts.push(winnerNames.length ? '<i class="ti ti-trophy" aria-hidden="true"></i> ' + winnerNames.map(esc).join(', ') : iconText('ti-check', t('sessions.played')));
    else if (outcome === 'cancelled') parts.push(`<span style="color:var(--danger)">${iconText('ti-x', t('sessions.cancelled'))}</span>`);
    // „N Spiele bewertet" counts the games IN the session, phrased as games
    // RATED — true for a voted session, and for a direct-play one (#532) it read
    // „1 Spiel bewertet" over zero votes (#915). Omitted entirely there rather
    // than reworded: the card then reads „3. September · ✓ Gespielt", which is
    // the whole truth about that evening.
    if (sessionHasVotes(s)) parts.push(esc(tn(s.gameIds.length, 'sessions.ratedOne', 'sessions.rated')));

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
      tl.appendChild(emptyState({ icon: 'ti-history', title: t('chronik.emptyTitle'), text: t('chronik.empty') }));
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

/*
 * The per-period recap (#800): what one calendar month or year looked like, as
 * its own section above the timeline (#851) — and the one thing on this screen
 * made to leave it, as a PNG the user hands to their group chat.
 *
 * The aggregation is period-recap.js; recap-card.js draws the image. This
 * function only picks the period and renders. Returns null (no section at all)
 * when the round has nothing to say about any period, so there is no empty
 * state to design — periodsOf() already refuses to offer a period with neither
 * a played session nor a shelf change.
 */
function renderPeriodRecapSection(round, activities) {
  const periods = periodsOf(round, activities);
  if (!periods.length) return null;

  // Months are formatted through the locale machinery (fmtMonth -> localeTag,
  // js/locales.js), never a month-name array of our own — a hardcoded one is
  // the thing that silently ships English months to a French reader.
  const labelOf = (p) => (p.kind === 'month' ? fmtMonth(p.at) : p.key);
  const idOf = (p) => `${p.kind}:${p.key}`;

  const sec = h('<div class="section precap"></div>');
  sec.appendChild(h(`<div class="section-head"><h2>${esc(t('periodRecap.title'))}</h2></div>`));
  sec.appendChild(h(`<p class="muted recap__lead">${esc(t('periodRecap.lead'))}</p>`));

  // Two groups rather than one flat list: a round three years in has 36 months,
  // and „2026" sitting between „März 2026" and „Februar 2026" reads as a month
  // whose name went missing. Months lead because the freshest slice is the one
  // the tab gets opened for; the default selection is simply the first option.
  const group = (list, label) =>
    list.length
      ? `<optgroup label="${esc(label)}">${list.map((p) => `<option value="${esc(idOf(p))}">${esc(labelOf(p))}</option>`).join('')}</optgroup>`
      : '';
  const head = h(`<div class="precap__head">
       <select class="select precap__picker" aria-label="${esc(t('periodRecap.pickerLabel'))}">
         ${group(periods.filter((p) => p.kind === 'month'), t('periodRecap.months'))}
         ${group(periods.filter((p) => p.kind === 'year'), t('periodRecap.years'))}
       </select>
     </div>`);
  const picker = head.querySelector('.precap__picker');
  sec.appendChild(head);

  const body = h('<div class="precap__body"></div>');
  sec.appendChild(body);

  const currentPeriod = () => periods.find((p) => idOf(p) === picker.value) || periods[0];

  // The four dependencies period-recap.js takes injected (see its header). Built
  // once: two literals is how the picker's card and the shared image would start
  // to disagree about how much evidence a crown costs, or about which games may
  // wear one.
  const deps = {
    peopleOf: sessionPeople,
    ratingOf: effectiveRating,
    scoreOf: scoreRatings,
    // The shelf half of the same rule (#894): the period card is shrunk exactly
    // as the all-time one is, so „Bestbewertet" means one thing on both.
    shelfOf: shelfScore,
    priorOf: roundPrior,
    playsOf: playCounts,
    minRatings: RECAP_MIN_RATINGS,
    isActive: isActiveGame,
  };

  // What the card would say, built from the SAME numbers the screen is showing
  // — the session share button's rule (#526): the image can never claim more
  // than the section above it, because there is nothing else here to read.
  const shareModel = (period, rec) => ({
    roundName: round.name,
    periodLabel: labelOf(period),
    sessions: rec.sessions,
    gamesPlayed: rec.gamesPlayed,
    played: rec.topPlayed ? recapGames(round, rec.topPlayed.gameIds).map((g) => g.title) : [],
    playedSub: rec.topPlayed ? tn(rec.topPlayed.count, 'home.chip.sessionsOne', 'home.chip.sessions') : '',
    rated: rec.topRated ? recapGames(round, rec.topRated.gameIds).map((g) => g.title) : [],
    ratedScore: rec.topRated ? fmtAvg(displayScore(rec.topRated.score)) : '',
    added: rec.added,
    retired: rec.retired,
    completed: rec.completed,
  });

  if (canShareRecapImage()) {
    const btn = h(`<button class="btn btn--ghost precap__share">${iconText('ti-share', t('share.button'))}</button>`);
    // Built at CLICK time, like the results screen's share button: the picker
    // moves under this closure, so a model captured at render would share the
    // month the user was looking at before.
    btn.addEventListener('click', () => {
      const period = currentPeriod();
      shareRecapCard(period, shareModel(period, periodRecap(round, activities, period, deps)));
    });
    head.appendChild(btn);
  }

  function renderBody() {
    const period = currentPeriod();
    const rec = periodRecap(round, activities, period, deps);
    body.innerHTML = '';

    const chip = (icon, text) =>
      h(`<span class="stat-chip"><i class="ti ${icon}" aria-hidden="true"></i>${esc(text)}</span>`);
    const totals = h('<div class="recap__totals"></div>');
    totals.appendChild(chip('ti-confetti', tn(rec.sessions, 'home.chip.sessionsOne', 'home.chip.sessions')));
    totals.appendChild(chip('ti-cards', tn(rec.gamesPlayed, 'periodRecap.playedOne', 'periodRecap.played')));
    // Only the non-zero shelf numbers, the call the Rückblick's archive chip
    // already makes: "0 aussortiert" is noise on a quiet month.
    if (rec.added) totals.appendChild(chip('ti-plus', tn(rec.added, 'periodRecap.addedOne', 'periodRecap.added')));
    if (rec.retired) totals.appendChild(chip('ti-trash', tn(rec.retired, 'periodRecap.retiredOne', 'periodRecap.retired')));
    if (rec.completed) totals.appendChild(chip('ti-circle-check', tn(rec.completed, 'periodRecap.completedOne', 'periodRecap.completed')));
    body.appendChild(totals);

    const cards = h('<div class="pokale-cards"></div>');
    // The labels carry the period. They no longer HAVE to — #851 moved this
    // section off the Pokale tab, so the all-time cards it used to collide with
    // are on another screen — but here the „· Juli 2026" is what ties a card to
    // the picker above it, so the scoped keys are kept deliberately.
    // (The shared PNG uses the short labels instead — there the period is the
    // headline, so repeating it in every row would be noise.)
    const scope = { period: labelOf(period) };
    if (rec.topPlayed) {
      cards.appendChild(pokaleGameCard(round, 'ti-flame', t('periodRecap.mostPlayed', scope), recapGames(round, rec.topPlayed.gameIds),
        tn(rec.topPlayed.count, 'home.chip.sessionsOne', 'home.chip.sessions')));
    }
    // Absent rather than crowned by a single vote: below RECAP_MIN_RATINGS
    // within the period there is no card at all (period-recap.js).
    if (rec.topRated) {
      cards.appendChild(pokaleGameCard(round, 'ti-star', t('periodRecap.bestRated', scope), recapGames(round, rec.topRated.gameIds),
        fmtAvg(displayScore(rec.topRated.score))));
    }
    // The grid is appended even when EMPTY. Its original reason is gone —
    // #851 took this section OUT of the >=1280px wide-column exemption, so a
    // dropped container can no longer resize it under the reader — but keeping
    // it costs nothing (an empty grid has no height, and `:empty` drops its
    // margin) and keeps one render path instead of two.
    body.appendChild(cards);
    if (!cards.children.length) body.appendChild(h(`<p class="muted precap__thin">${esc(t('periodRecap.thin'))}</p>`));
  }

  picker.addEventListener('change', renderBody);
  renderBody();
  return sec;
}

// Can this browser deliver the PNG at all? Two independent paths, and the share
// sheet is NOT implied by navigator.share: `canShare({ files })` is a separate
// capability that desktop Chrome does not have. The download fallback covers
// it; where neither exists the button is never rendered rather than shown and
// inert, exactly as canShareResult() decides for the session summary.
function canShareRecapImage() {
  const canFiles = !!(navigator.canShare && navigator.share && typeof File !== 'undefined');
  return canFiles || 'download' in document.createElement('a');
}

// Hand the card to the user's own picker, or save it. Nothing is ever sent
// anywhere by us — the same trust shape as the session share text (#526): the
// image is produced on the device and the USER chooses the recipient.
async function shareRecapCard(period, model) {
  let blob;
  try {
    blob = await recapCardBlob(model);
  } catch {
    toast(t('periodRecap.toast.failed'));
    return;
  }
  const name = `spielwirbel-${period.key}.png`;
  if (navigator.canShare && navigator.share && typeof File !== 'undefined') {
    const file = new File([blob], name, { type: 'image/png' });
    // canShare must be asked about THIS file: a browser can advertise
    // navigator.share and still refuse file payloads.
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        // Dismissing the sheet is a normal outcome, not a failure — toasting
        // would scold a user who simply changed their mind.
        if (e && e.name === 'AbortError') return;
        // Anything else falls through to the download rather than dead-ending.
      }
    }
  }
  // Two things here are load-bearing and both fail SILENTLY — no error, no
  // toast, simply no file. The anchor is appended before it is clicked, because
  // a detached one has historically been ignored; and the object URL is revoked
  // on a later task rather than on the next line, because revoking it while the
  // download the click just started is still reading it races that read.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
  toast(t('periodRecap.toast.saved'));
}
