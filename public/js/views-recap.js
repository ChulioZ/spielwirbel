/* Spielwirbel – the Rückblick (#484) at the foot of the Regal (#1855).

   What a round's accumulated ratings say about the group's taste: the
   worst-rated game, the biggest disagreement and each member's favourite. It
   sat at the end of the Pokale tab until #1855, which is about who is ahead,
   while this answers what the shelf says about the group — so it moved to the
   shelf, as one folded row. The totals chips it used to open with went with the
   move: the Chronik and Regal heads already state every one of them.

   Everything comes from `roundRecap` (recap.js), over the shelf index the Regal
   ranks by (#894: one ranking of one shelf); this file only renders. Painted
   through `.hub-card` and the existing `.pokale-card` / `.recap-fav` classes, so
   every design draws it in the material it already gives those (#1422).

   Part of the frontend; all files share one global script scope. Loaded after
   views-pokale.js, whose card builders it calls at RENDER time only. */

/* The folded row, or null under „Einfacher Modus" with the statistics hidden.
   Always a row otherwise: with thin data it opens to the "keep going" line, so
   a round two sessions in never reads as a missing section. */
function regalRecapRow(round) {
  if (simpleHidden('stats')) return null; // „Einfacher Modus" (#1646)
  const shelfIndex = roundScoreIndex(round);
  const recap = roundRecap(round, sessionPeople, (gid) => {
    const st = shelfIndex.byGame[gid];
    return st ? st.score : null;
  }, sessionRatings);

  const sec = h(`<div class="section recap">
       <details class="hub-card regal-recap">
         <summary class="regal-recap__summary">
           <i class="ti ti-history" aria-hidden="true"></i>
           <span class="regal-recap__title">${esc(t('recap.title'))}</span>
           <span class="regal-recap__lead">${esc(t('recap.lead'))}</span>
           <i class="ti ti-chevron-down regal-recap__go" aria-hidden="true"></i>
         </summary>
         <div class="regal-recap__body"></div>
       </details>
     </div>`);
  const body = sec.querySelector('.regal-recap__body');

  // One observer serves the whole Rückblick (#979).
  const loadCover = createCoverLoader();
  const cards = h('<div class="pokale-cards"></div>');

  if (recap.worst) {
    cards.appendChild(
      pokaleGameCard(round, 'ti-mood-empty', t('recap.worstRated'), recapGames(round, recap.worst.gameIds), fmtAvg(displayScore(recap.worst.score)), loadCover)
    );
  }

  // The disagreement card names two people and a game, so it is built here
  // rather than through pokaleStatCard, which carries at most one member link.
  if (recap.divisive) {
    const game = round.games.find((g) => g.id === recap.divisive.gameId);
    const nameOf = (mid) => (round.members.find((m) => m.id === mid) || {}).name || '';
    if (game) {
      const card = h(`<div class="pokale-card">
           ${gameCardHead('ti-arrows-split', t('recap.divisive'), game)}
           <a class="pokale-card__value">${esc(game.title)}</a>
           <span class="pokale-card__sub">${esc(nameOf(recap.divisive.high.memberId))} ${ratingMark(recap.divisive.high.avg)} · ${esc(nameOf(recap.divisive.low.memberId))} ${ratingMark(recap.divisive.low.avg)}</span>
         </div>`);
      wireGameCardHead(card, round.id, game, loadCover);
      makeGameLink(card.querySelector('.pokale-card__value'), round.id, game.id);
      cards.appendChild(card);
    }
  }

  if (cards.children.length) body.appendChild(cards);

  // Each member's own favourite, one card per person who has rated anything.
  let favCount = 0;
  if (recap.favourites.length) {
    const group = h(`<div class="recap__group">
         <h3 class="recap__sub">${esc(t('recap.favourites'))}</h3>
       </div>`);
    const favs = h('<div class="pokale-cards"></div>');
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
           <span class="pokale-card__sub">${ratingMark(fav.avg)}</span>
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
    favCount = favs.children.length;
    if (favCount) {
      group.appendChild(favs);
      body.appendChild(group);
    }
  }

  // Thin data reads as "keep going", never as an empty row.
  if (!cards.children.length && !favCount) {
    body.appendChild(h(`<p class="muted recap__thin">${esc(t('recap.thin'))}</p>`));
  }
  return sec;
}
