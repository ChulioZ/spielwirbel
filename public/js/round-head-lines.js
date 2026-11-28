/* Spielwirbel – the two round facts that moved to the head of the screen they
   describe (#1852): the Rundenpuls into the Chronik, the Regal-Steckbrief's
   sentence under the Regal heading. Both used to live only on the Start tab,
   which #1853 rebuilds without them.

   Neither derives anything of its own. The pulse IS hubPulseCard (hub-cards.js)
   — its body, moved into a folded <details> — and the profile line IS the Start
   card's sentence (shelfHeadlineText over shelfProfile). The Start tab's
   copies of both left in #1853.

   Both are `.hub-card`-framed or token-painted, so every design draws them in
   the material it already gives its cards (#1422: a design owns how a fact is
   laid out, never whether it is said). No design branch here.

   Part of the frontend; all files share one global script scope. Loaded after
   views-shelf-profile.js; views-chronik.js and views-regal.js call these at
   RENDER time only. */

/* The pulse as one folded line: „Rundenpuls · 2 Sessions in 12 Monaten · Vor 4
   Tagen gespielt", opening to the rest of the card — the bars or Der Tisch's
   tiles, the never-played link into the Regal and the series note. Null under
   „Einfacher Modus" and whenever the round played nothing in twelve months:
   the Chronik of a young round has nothing to summarise, so there is no locked
   or sentence variant (the Start tab's went with its pulse card in #1853). */
function chronikPulseLine(round) {
  const active = round.games.filter(isActiveGame);
  const pulse = roundPulse(round, active, { minSessions: 1 }, hubDeps());
  if (!pulse) return null;
  const card = hubPulseCard(round, active);
  if (!card) return null; // „Einfacher Modus" (#1646) — the card's own gate
  const body = card.querySelector('.hub-card__body');
  // The summary already states the fact sentence; the body's copy of it (one
  // line in Klassisch, three in Die Brücke) would say it twice. Der Tisch's
  // tiles and the series note are not that paragraph and stay.
  body.querySelectorAll('.hub-card__facts:not(.hub-card__threshold)').forEach((p) => p.remove());
  const facts = [tn(pulse.total, 'hub.pulse.sessionsOne', 'hub.pulse.sessions')];
  if (pulse.daysSinceLast !== null) {
    facts.push(pulse.daysSinceLast === 0
      ? t('hub.pulse.lastToday')
      : tn(pulse.daysSinceLast, 'hub.pulse.lastDaysOne', 'hub.pulse.lastDays'));
  }
  const box = h(`<details class="hub-card chronik-pulse">
       <summary class="chronik-pulse__summary">
         <i class="ti ti-activity" aria-hidden="true"></i>
         <span class="chronik-pulse__title">${esc(t('hub.pulse.title'))}</span>
         <span class="chronik-pulse__facts">${esc(facts.join(' · '))}</span>
         <i class="ti ti-chevron-down chronik-pulse__go" aria-hidden="true"></i>
       </summary>
     </details>`);
  box.appendChild(body);
  return box;
}

/* The Steckbrief's one sentence under the Regal heading, as a link to the full
   profile screen. Null below the profile's threshold of games with provider
   data, when there is no dominant range worth a sentence, and under „Einfacher
   Modus" — the Start card's three gates. */
function regalProfileLine(round, activeGames, statsByGame) {
  if (simpleHidden('stats')) return null; // „Einfacher Modus" (#1646)
  const sentence = shelfHeadlineText(shelfHeadline(shelfProfile(activeGames, shelfProfileDeps(statsByGame, roundDurations(round.sessions)))));
  if (!sentence) return null;
  const link = h(`<a class="regal-profile">
       <i class="ti ti-id" aria-hidden="true"></i>
       <span class="regal-profile__text"><span class="regal-profile__label">${esc(t('shelfProfile.title'))}</span> ${esc(sentence)}</span>
       <i class="ti ti-chevron-right regal-profile__go" aria-hidden="true"></i>
     </a>`);
  navLink(link, roundPath(round.id, 'shelf-profile'), () => showShelfProfile(round.id));
  return link;
}
