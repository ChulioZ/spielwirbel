/* Spielwirbel – views: the Pokale tab (member podium + fun stats) and the
   Rückblick section appended under it (#484), plus the two stat-card builders
   the two of them share. Rendered by showRound() (views-round.js).
   Part of the frontend; all files share one global script scope. */

// --- The two stat-card builders, shared by the Pokale tab and the Rückblick
// section below it. They were closures inside renderPokaleTab until #484 gave
// them a second caller; `round` is the only thing they lost by moving out.

// One stat card. `linkMid` turns the value into a link to that
// member's page (the streak card, the one stat here that names a person).
// Without it the value stays a plain <span> on purpose: an <a> carrying no href
// is neither focusable nor styled, so emitting one unconditionally would leave
// dead markup behind for every future stat that isn't a link.
function pokaleStatCard(round, icon, label, value, sub, linkMid) {
  const card = h(`<div class="pokale-card">
       <span class="pokale-card__icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
       <span class="pokale-card__label">${esc(label)}</span>
       ${linkMid ? `<a class="pokale-card__value">${esc(value)}</a>` : `<span class="pokale-card__value">${esc(value)}</span>`}
       <span class="pokale-card__sub">${esc(sub)}</span>
     </div>`);
  if (linkMid) makeMemberLink(card.querySelector('.pokale-card__value'), round.id, linkMid);
  return card;
}

// Like pokaleStatCard but the value is one or more games, each listed on its own
// row with a "Jetzt spielen" launcher (icon-only; omitted for an archived game —
// retired or completed, neither is in the active collection any more).
function pokaleGameCard(round, icon, label, games, sub) {
  const card = h(`<div class="pokale-card">
       <span class="pokale-card__icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
       <span class="pokale-card__label">${esc(label)}</span>
       <span class="pokale-card__games"></span>
       <span class="pokale-card__sub">${esc(sub)}</span>
     </div>`);
  const list = card.querySelector('.pokale-card__games');
  games.forEach((g) => {
    const row = h(`<span class="pokale-game">
         <a class="pokale-game__title">${esc(g.title)}</a>
       </span>`);
    // The game name opens its detail page (archived games too — the detail
    // view supports them; only the "Jetzt spielen" launcher is omitted).
    makeGameLink(row.querySelector('.pokale-game__title'), round.id, g.id);
    if (!g.retired && !g.completed && !g.wish) {
      const btn = h(`<button class="pokale-game__play" title="${esc(t('directPlay.button'))}" aria-label="${esc(t('directPlay.button'))}"><i class="ti ti-player-play" aria-hidden="true"></i></button>`);
      btn.addEventListener('click', () => startDirectSession(round, g));
      row.appendChild(btn);
    }
    list.appendChild(row);
  });
  return card;
}

// Resolve stat ids back to the games they name, dropping any that no longer
// exist (recap.js already ignores deleted ids; this keeps the view honest for
// anything it is handed).
const recapGames = (round, ids) => ids.map((id) => round.games.find((g) => g.id === id)).filter(Boolean);

// --- Pokale tab: hall of fame — member podium and fun stats, all computed
// on demand from sessions (single source of truth, like the rating averages).
// The Rückblick (#484) is appended as a second section at the end.
function renderPokaleTab(round, activities) {
  const finished = round.sessions.filter((s) => s.finished);

  const sec = h('<div class="section"></div>');
  sec.appendChild(h(`<div class="section-head"><h1>${esc(t('pokale.title'))}</h1></div>`));

  if (finished.length === 0) {
    sec.appendChild(h(`<div class="empty"><p>${esc(t('pokale.empty'))}</p></div>`));
    app.appendChild(sec);
    return;
  }

  // The group's accumulated taste, derived on demand from the session votes
  // (#484). Read here for the best-rated card and again by the Rückblick
  // section appended at the end of this tab.
  const recap = roundRecap(round, sessionPeople, effectiveRating);

  // Wins per member (a night can have several winners). Keyed by round member,
  // so a guest win is dropped by the `wid in wins` guard below — deliberately:
  // the standings are the permanent group's leaderboard, and a one-evening
  // visitor in it would be noise (#458).
  const wins = {};
  round.members.forEach((m) => (wins[m.id] = 0));
  finished.forEach((s) =>
    (s.winnerIds || []).forEach((wid) => {
      if (wid in wins) wins[wid]++;
    })
  );
  const ranked = [...round.members].sort((a, b) => wins[b.id] - wins[a.id]);

  // Competition ranking (1224): members tied on wins share a rank, so two
  // three-win members are both rank 1 and the next best jumps to rank 3. Only
  // members who have actually won something can stand on the podium.
  const winners = ranked.filter((m) => wins[m.id] > 0);
  const rankOf = {};
  winners.forEach((m) => {
    rankOf[m.id] = winners.filter((o) => wins[o.id] > wins[m.id]).length + 1;
  });

  // Podium slots by rank: left = 2, center = 1, right = 3. A COLUMN IS A RANK,
  // NOT A MEMBER — tied members share one step rather than widening the stage,
  // which is the same shared component the session results podium uses (#836).
  // Its three fixed 110px columns plus gaps came to 358px, wider than a 375px
  // phone's 347px content box, with no wrap set to catch it.
  const podiumItems = winners.map((m) => ({ place: rankOf[m.id], member: m }));
  const { single, cols } = podiumColumns(podiumItems);
  if (winners.length) {
    const entryHtml = (it) =>
      `<a class="podium__entry podium__entry--member" data-mid="${esc(it.member.id)}">
         <span class="avatar podium__avatar" style="background:${memberColor(round, it.member.id)}">${esc(initials(it.member.name))}</span>
         <span class="podium__name">${esc(it.member.name)}</span>
       </a>`;
    const stage = cols
      .map((col) =>
        podiumColHtml(col, () => ({
          entries: col.shown.map(entryHtml).join(''),
          more: esc(tn(col.hidden, 'podium.moreOne', 'podium.more')),
          // Everyone on a step has the same win count, so shown[0] speaks for it.
          base:
            `<span class="podium__rank">${col.rank}</span>` +
            esc(tn(wins[col.shown[0].member.id], 'pokale.winsOne', 'pokale.wins')),
        }))
      )
      .join('');
    const podium = h(`<div class="podium${single ? ' podium--single' : ''}">${stage}</div>`);
    // Each podium entry opens that member's detail page.
    podium.querySelectorAll('.podium__entry[data-mid]').forEach((el) => {
      makeMemberLink(el, round.id, el.dataset.mid);
    });
    sec.appendChild(podium);
  }
  // Anyone not actually standing on the podium drops to the summary line — both
  // those ranked below the three steps and anyone pushed off a crowded step by
  // the per-rank cap, so the cap never makes a member disappear entirely.
  const onPodium = new Set(cols.flatMap((c) => c.shown.map((it) => it.member.id)));
  const rest = ranked.filter((m) => !onPodium.has(m.id));
  if (rest.length) {
    const line = rest
      .map(
        (m) =>
          `<a class="podium__rest-name" data-mid="${esc(m.id)}">${esc(m.name)}</a> · ${esc(tn(wins[m.id], 'pokale.winsOne', 'pokale.wins'))}`
      )
      .join('&ensp;—&ensp;');
    const restEl = h(`<div class="muted podium__rest">${line}</div>`);
    restEl.querySelectorAll('.podium__rest-name[data-mid]').forEach((el) => {
      makeMemberLink(el, round.id, el.dataset.mid);
    });
    sec.appendChild(restEl);
  }

  const cards = h('<div class="pokale-cards"></div>');

  // Most played: chosen most often across finished nights (game must exist).
  //
  // ARCHIVED GAMES COUNT HERE, retired ones included — deliberately, and against
  // the reflex that #643 set up next door. This card is a factual record of
  // nights that happened, not a statement about the current shelf: retiring a
  // game does not unmake the evenings the group spent on it, so those sessions
  // keep counting and a retired game may still top the card (operator decision,
  // 2026-08-04). The cards that DO drop retired games — Größte Uneinigkeit and
  // Lieblingsspiele, via `retiredIds` in recap.js — are about taste, which is a
  // claim the group has withdrawn. Don't unify the two; see
  // `.claude/rules/active-games-filter-sites.md`.
  //
  // Nor with the RECOMMENDER's play counter (#778), which tallies the same
  // `chosenGameId` over the same sessions and deliberately drops retired games
  // — it asks "what should we play more of", where this card asks "what did we
  // play". `.claude/rules/recommendation-scoring.md` §12.
  const playCount = {};
  finished.forEach((s) => {
    if (s.chosenGameId && round.games.some((g) => g.id === s.chosenGameId))
      playCount[s.chosenGameId] = (playCount[s.chosenGameId] || 0) + 1;
  });
  let maxPlays = 0;
  Object.keys(playCount).forEach((gid) => {
    if (playCount[gid] > maxPlays) maxPlays = playCount[gid];
  });
  const mostGames = Object.keys(playCount)
    .filter((gid) => playCount[gid] === maxPlays)
    .map((gid) => round.games.find((x) => x.id === gid));
  if (mostGames.length) {
    cards.appendChild(
      pokaleGameCard(round, 'ti-flame', t('pokale.mostPlayed'), mostGames, tn(maxPlays, 'home.chip.sessionsOne', 'home.chip.sessions'))
    );
  }

  // Best rated: highest overall average with a bit of data behind it; ties
  // share the tile. Computed by recap.js (#484) rather than inline, so it and
  // the Rückblick's worst-rated card below cannot drift apart on the evidence
  // threshold or on how ties are handled — they are one aggregation read twice.
  if (recap.best) {
    cards.appendChild(
      pokaleGameCard(round, 'ti-star', t('pokale.bestRated'), recapGames(round, recap.best.gameIds), `Ø ${recap.best.avg.toFixed(1)}`)
    );
  }

  // Streak: how many of the latest nights in a row one member won alone.
  // Chronological by `createdAt` (when the night happened), like the Chronik —
  // `finishedAt` moves when an old session is re-finished.
  // A night any guest won is skipped entirely (#458): a session-only visitor
  // must neither break nor extend a member's streak, and treating their win as
  // an ordinary sole win would silently blank the card (there is no member row
  // behind the id) — which is breaking it by another name.
  const wonByGuest = (s) => {
    const gids = new Set((s.guests || []).map((g) => g.id));
    return gids.size > 0 && (s.winnerIds || []).some((wid) => gids.has(wid));
  };
  const chrono = [...finished]
    .filter((s) => !wonByGuest(s))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  let streakMember = null;
  let streak = 0;
  for (let i = chrono.length - 1; i >= 0; i--) {
    const ws = chrono[i].winnerIds || [];
    if (streakMember === null) {
      if (ws.length !== 1) break;
      streakMember = ws[0];
      streak = 1;
    } else if (ws.length === 1 && ws[0] === streakMember) {
      streak++;
    } else break;
  }
  const streakM = streakMember && round.members.find((m) => m.id === streakMember);
  if (streakM && streak >= 2) {
    // The member name links to their detail page, like the podium above.
    cards.appendChild(
      pokaleStatCard(round, 'ti-bolt', t('pokale.streak'), streakM.name, t('pokale.streakN', { n: streak }), streakMember)
    );
  }

  // Gathering dust: the active game whose last night is longest ago (or never).
  const lastAt = {};
  finished.forEach((s) => {
    if (!s.chosenGameId) return;
    const at = s.createdAt;
    if (!lastAt[s.chosenGameId] || at > lastAt[s.chosenGameId]) lastAt[s.chosenGameId] = at;
  });
  const active = round.games.filter((g) => !g.retired && !g.completed && !g.wish);
  // Find the earliest last-played timestamp ('' = never played sorts first),
  // then pick a random game among all that tie for it, so the same game isn't
  // always highlighted.
  let dustyAt = null;
  active.forEach((g) => {
    const at = lastAt[g.id] || '';
    if (dustyAt === null || at < dustyAt) dustyAt = at;
  });
  const dustyCandidates = active.filter((g) => (lastAt[g.id] || '') === dustyAt);
  const dusty = dustyCandidates.length
    ? { g: dustyCandidates[Math.floor(Math.random() * dustyCandidates.length)], at: dustyAt }
    : null;
  if (dusty && active.length > 1) {
    cards.appendChild(
      pokaleGameCard(
        round,
        'ti-sparkles',
        t('pokale.dusty'),
        [dusty.g],
        dusty.at ? t('pokale.dustyAt', { when: fmtMonth(dusty.at) }) : t('pokale.dustyNever')
      )
    );
  }

  if (cards.children.length) sec.appendChild(cards);
  app.appendChild(sec);
  app.appendChild(renderRecapSection(round, recap));
  // The per-period recap (#800) sits below the all-time one, newest slice
  // first. It renders nothing at all when the round has no period worth
  // offering — and it is deliberately below the `finished.length === 0` guard
  // above, so a round that has imported games but never played still reads as
  // "no trophies yet" rather than opening with a picker over empty months.
  const periodSec = renderPeriodRecapSection(round, activities);
  if (periodSec) app.appendChild(periodSec);
}

/*
 * The Rückblick (#484): what a round's accumulated ratings say about the group's
 * taste, as a second section under the standings rather than a screen of its own
 * — the record belongs beside the trophies it is made of, and a surface nobody
 * navigates to is not more legible than one nobody scrolls to.
 *
 * Everything here comes from `roundRecap` (recap.js); this function only renders.
 * It always returns a section: with thin data it shows the totals plus a
 * "keep going" line, because a round two sessions in has genuinely accumulated
 * something and must not read as a broken screen.
 */
function renderRecapSection(round, recap) {
  const sec = h('<div class="section recap"></div>');
  sec.appendChild(h(`<div class="section-head"><h2>${esc(t('recap.title'))}</h2></div>`));
  sec.appendChild(h(`<p class="muted recap__lead">${esc(t('recap.lead'))}</p>`));

  const chip = (icon, text) =>
    h(`<span class="stat-chip"><i class="ti ${icon}" aria-hidden="true"></i>${esc(text)}</span>`);
  const totals = h('<div class="recap__totals"></div>');
  totals.appendChild(chip('ti-confetti', tn(recap.totals.sessions, 'home.chip.sessionsOne', 'home.chip.sessions')));
  totals.appendChild(chip('ti-cards', tn(recap.totals.games, 'home.chip.gamesOne', 'home.chip.games')));
  totals.appendChild(chip('ti-star', tn(recap.totals.ratings, 'recap.ratingsOne', 'recap.ratings')));
  // Only when there is an archive — "0 aussortiert" is noise on a young round.
  if (recap.totals.archived) totals.appendChild(chip('ti-archive', t('recap.archived', { n: recap.totals.archived })));
  sec.appendChild(totals);

  const cards = h('<div class="pokale-cards"></div>');

  if (recap.worst) {
    cards.appendChild(
      pokaleGameCard(round, 'ti-mood-empty', t('recap.worstRated'), recapGames(round, recap.worst.gameIds), `Ø ${recap.worst.avg.toFixed(1)}`)
    );
  }

  // The disagreement card names two people and a game, so it is built here
  // rather than through pokaleStatCard, which carries at most one member link.
  if (recap.divisive) {
    const game = round.games.find((g) => g.id === recap.divisive.gameId);
    const nameOf = (mid) => (round.members.find((m) => m.id === mid) || {}).name || '';
    if (game) {
      const card = h(`<div class="pokale-card">
           <span class="pokale-card__icon"><i class="ti ti-arrows-split" aria-hidden="true"></i></span>
           <span class="pokale-card__label">${esc(t('recap.divisive'))}</span>
           <a class="pokale-card__value">${esc(game.title)}</a>
           <span class="pokale-card__sub">${esc(t('recap.divisiveSub', {
             high: nameOf(recap.divisive.high.memberId),
             highAvg: recap.divisive.high.avg.toFixed(1),
             low: nameOf(recap.divisive.low.memberId),
             lowAvg: recap.divisive.low.avg.toFixed(1),
           }))}</span>
         </div>`);
      makeGameLink(card.querySelector('.pokale-card__value'), round.id, game.id);
      cards.appendChild(card);
    }
  }

  if (cards.children.length) sec.appendChild(cards);

  // Each member's own favourite, one card per person who has rated anything.
  if (recap.favourites.length) {
    const group = h(`<div class="recap__group">
         <h3 class="recap__sub">${esc(t('recap.favourites'))}</h3>
       </div>`);
    const favs = h('<div class="pokale-cards"></div>');
    const loadCover = createCoverLoader(); // lazy taste-card covers, as on the Regal/archive (#198)
    recap.favourites.forEach((fav) => {
      const member = round.members.find((m) => m.id === fav.memberId);
      const game = round.games.find((g) => g.id === fav.gameId);
      if (!member || !game) return;
      const card = h(`<div class="pokale-card recap-fav">
           <a class="recap-fav__cover">${coverPlaceholder(game)}</a>
           <span class="recap-fav__who">
             <a class="avatar" style="background:${memberColor(round, member.id)}">${esc(initials(member.name))}</a>
             <span class="recap-fav__name">${esc(member.name)}</span>
           </span>
           <a class="pokale-card__value">${esc(game.title)}</a>
           <span class="pokale-card__sub">${esc(t('recap.favSub', { avg: fav.avg.toFixed(1) }))}</span>
         </div>`);
      if (game.image) loadCover(card.querySelector('.recap-fav__cover'), coverUrl(game.image, COVER_THUMB));
      makeMemberLink(card.querySelector('.recap-fav__who .avatar'), round.id, member.id);
      makeGameLink(card.querySelector('.pokale-card__value'), round.id, game.id);
      // Redundant by the archive rows' rule (#663): it targets the same game as
      // the title below it, so it stays mouse-clickable but leaves the tab order
      // and the accessibility tree rather than announcing as a nameless control.
      makeGameLink(card.querySelector('.recap-fav__cover'), round.id, game.id, { redundant: true });
      favs.appendChild(card);
    });
    if (favs.children.length) {
      group.appendChild(favs);
      sec.appendChild(group);
    }
  }

  // Thin data reads as "keep going", never as an empty screen: the totals above
  // already say something real, and this says what would make it say more.
  if (!cards.children.length && !recap.favourites.length) {
    sec.appendChild(h(`<p class="muted recap__thin">${esc(t('recap.thin'))}</p>`));
  }
  return sec;
}

/*
 * The per-period recap (#800): what one calendar month or year looked like, as
 * a third section under the all-time Rückblick — and the one thing on this
 * screen made to leave it, as a PNG the user hands to their group chat.
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
    ratedAvg: rec.topRated ? rec.topRated.avg.toFixed(1) : '',
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
    // The labels carry the period, and must: the all-time Meistgespielt and
    // Bestbewertet cards sit a few hundred pixels up the same screen, so a bare
    // „Bestbewertet" here would put two identically-labelled cards naming two
    // different games in front of the reader with nothing to tell them apart.
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
        `Ø ${rec.topRated.avg.toFixed(1)}`));
    }
    // The grid is appended even when EMPTY, unlike the sections above. At
    // >=1280px the wide-column exemption is `.app > *:has(…, .pokale-cards, …)`
    // (styles.css), so a body that drops the container would narrow the whole
    // section from the pane to the 900px reading measure — i.e. the section
    // would resize under the reader as they move the picker from a busy month
    // to a quiet one. An empty grid has no height; `:empty` drops its margin.
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  toast(t('periodRecap.toast.saved'));
}
