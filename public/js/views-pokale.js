/* Spielwirbel – views: the Pokale tab (member podium + fun stats) and the
   Rückblick section appended under it (#484), plus the two stat-card builders
   the two of them share. Rendered by showRound() (views-round.js).
   Part of the frontend; all files share one global script scope. */

// --- The two stat-card builders, shared by the Pokale tab and the Rückblick
// section below it. They were closures inside renderPokaleTab until #484 gave
// them a second caller; `round` is the only thing they lost by moving out.
// Since #851 the period recap calls both from views-chronik.js. That is a
// cross-file call in one shared global scope, and it is safe because it happens
// at RENDER time, not load time (.claude/rules/frontend-script-load-order.md) —
// views-chronik.js loads first, which only constrains top-level statements.

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
function renderPokaleTab(round) {
  const finished = round.sessions.filter((s) => s.finished);

  const sec = h('<div class="section"></div>');
  // The ⓘ explains the Siegwertung (#895) — the standings rank on a number the
  // group has not seen before, so it owes an explanation somewhere. One per
  // screen, beside the heading the standings sit under.
  const head = h(`<div class="section-head"><h1>${esc(t('pokale.title'))} ${infoButton('win')}</h1></div>`);
  wireInfoButtons(head);
  sec.appendChild(head);

  if (finished.length === 0) {
    sec.appendChild(emptyState({ icon: 'ti-trophy', title: t('pokale.emptyTitle'), text: t('pokale.empty') }));
    app.appendChild(sec);
    return;
  }

  // The group's accumulated taste, derived on demand from the session votes
  // (#484). Read here for the best-rated card and again by the Rückblick
  // section appended at the end of this tab.
  const recap = roundRecap(round, sessionPeople, effectiveRating, scoreRatings);

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
  // THE RANKING IS THE SIEGWERTUNG, NOT THE COUNT ABOVE (#895). Counting wins
  // ranked attendance — someone simply present more often accumulates more —
  // and a solo evening is representable, so a member logging their solo plays
  // built a total nobody playing in a group could answer. The raw count stays
  // because it is what the group recognises; both are shown, which is what
  // explains why 12 Siege can sit below 5.
  const scores = memberWinScores(round, sessionPartyGroups);
  const ranked = [...round.members].sort((a, b) => scores[b.id] - scores[a.id]);

  // Only members ABOVE CHANCE stand on the podium, which is also what keeps a
  // negative number off this tab entirely. Compared at the PRINTED precision,
  // like the tie key below: a member at +0,04 would otherwise stand on a step
  // showing „0,0".
  const winners = ranked.filter((m) => Number(scores[m.id].toFixed(1)) > 0);

  // Competition ranking (1224) through `computePlaces` (ranking.js) rather than
  // the hand-rolled comparison this carried. That one was exact equality, safe
  // only while the measure IS an integer win count. A sum of `1 − w/p` terms is
  // a float, and two members at a mathematically equal total routinely differ
  // in the last bits — test/win-score.test.js pins a five-night fixture that
  // really does drift. Left exact, two members showing the same number would
  // land on different steps: the tie inversion #836/#891 exist to remove,
  // reintroduced on the other podium.
  const places = computePlaces(winners.map((m) => ({ shown: scores[m.id], count: 1 })));
  const rankOf = {};
  winners.forEach((m, i) => (rankOf[m.id] = places[i]));

  // Podium columns by rank: left = 2, center = 1, right = 3. A COLUMN IS A
  // RANK, NOT A MEMBER (#836) — tied members share one step rather than
  // widening the stage into a wrapping row of pedestals.
  //
  // They stand SIDEWAYS on that step (#897). Entries used to stack upward from
  // the pedestal, so a tie grew the very dimension the pedestal uses to say
  // "this place is higher", and a three-way tie for 3rd overtopped the crowned
  // winner. Lying down is what keeps the silhouette honest; see
  // `.claude/rules/rank-encodings-must-not-be-growable-by-ties.md`.
  const podiumItems = winners.map((m) => ({ place: rankOf[m.id], member: m }));
  const { single, cols } = podiumColumns(podiumItems);
  if (winners.length) {
    // Both numbers belong to the MEMBER, not to the step: the count used to be
    // the pedestal's label, read off `shown[0]` — sound only while the ranking
    // IS the win count, which #895 ends. Step-mates now share a Siegwertung and
    // differ in the raw count.
    //
    // THE MARKUP CARRIES BOTH AND CSS DECIDES WHICH FITS. An upright entry — a
    // member alone on a step — has a whole line and reads „+3,0 · 5 Siege". On a
    // SHARED step the entries lie sideways as chips (#897), where the fixed part
    // is what crushes the name: a member on a 108px phone step has ~22px left
    // once „3 Siege" has taken its 48, and „+2,0 · 12 Siege" would take twice
    // that. So `.podium__col--multi` hides the count and the score alone stands.
    // That is not merely the affordable half — the count exists to explain why
    // 12 Siege ranks below 5, a question that only arises ACROSS steps, and
    // step-mates are by definition tied. The full phrase stays one hover away.
    const entryHtml = (it) => {
      const n = wins[it.member.id];
      const full = esc(tn(n, 'pokale.winsOne', 'pokale.wins'));
      return `<a class="podium__entry podium__entry--member" data-mid="${esc(it.member.id)}">
         <span class="avatar podium__avatar" style="background:${memberColor(round, it.member.id)}">${avatarFace(initials(it.member.name), { userId: it.member.userId })}</span>
         <span class="podium__who">
           <span class="podium__name">${esc(it.member.name)}</span>
           <span class="podium__wins" title="${full}"><span class="podium__score">${esc(fmtSigned(scores[it.member.id]))}</span><span class="podium__winsraw"> · ${full}</span></span>
         </span>
       </a>`;
    };
    const stage = cols.map((col) => podiumColHtml(col, entryHtml, esc(t('podium.shared')))).join('');
    const podium = h(`<div class="podium${single ? ' podium--single' : ''}">${stage}</div>`);
    // Each podium entry opens that member's detail page.
    podium.querySelectorAll('.podium__entry[data-mid]').forEach((el) => {
      makeMemberLink(el, round.id, el.dataset.mid);
    });
    sec.appendChild(podium);
  }
  // Anyone ranked below the third step drops to the summary line, in standings
  // order. Nothing else lands here: the steps are uncapped, so a crowded place
  // can no longer push a member off the stage into a „+N weitere" count.
  //
  // IT SHOWS PLAIN WIN COUNTS, never the Siegwertung (#895). This is exactly the
  // set of people whose score may be negative, and „−1,3" printed under a
  // Ruhmeshalle heading is a punishment the feature should not hand out.
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
      pokaleGameCard(round, 'ti-star', t('pokale.bestRated'), recapGames(round, recap.best.gameIds), fmtAvg(displayScore(recap.best.score)))
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
  // A solo evening is skipped for the SAME reason (#895), and the argument was
  // already here unimplemented: an evening that was not a contest can neither
  // break nor extend a streak. A one-person session is single-winner by
  // definition, so twenty logged solo plays read as a twenty-night streak.
  const isSolo = (s) => sessionPartyCount(round, s) === 1;
  const chrono = [...finished]
    .filter((s) => !wonByGuest(s) && !isSolo(s))
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
      pokaleGameCard(round, 'ti-mood-empty', t('recap.worstRated'), recapGames(round, recap.worst.gameIds), fmtAvg(displayScore(recap.worst.score)))
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
             highAvg: fmtAvg(recap.divisive.high.avg),
             low: nameOf(recap.divisive.low.memberId),
             lowAvg: fmtAvg(recap.divisive.low.avg),
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
             <a class="avatar" style="background:${memberColor(round, member.id)}">${avatarFace(initials(member.name), { userId: member.userId })}</a>
             <span class="recap-fav__name">${esc(member.name)}</span>
           </span>
           <a class="pokale-card__value">${esc(game.title)}</a>
           <span class="pokale-card__sub">${esc(t('recap.favSub', { avg: fmtAvg(fav.avg) }))}</span>
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
