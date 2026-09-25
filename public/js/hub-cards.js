/* Spielwirbel – the round hub's Start tab: the CARD GRID (#1189, split out of
   views-round-start.js).

   Six renderers and one frame. Everything they say is DERIVED on demand from
   the round payload the tab already holds (public/js/hub-insights.js) — no new
   field, no new table, no extra request — except the recommendations teaser at
   the bottom, which fetches after first paint.

   Split along the seam views-round-start.js's own banner had marked since #923:
   the LAUNCHPAD (identity, the one CTA, the tickets) and the CARDS are edited
   independently, and the three sub-page previews had already left for
   hub-previews.js in #1185. The tab that composes all of them stays next door.

   THE LOAD-BEARING RULE FOR EVERY CARD: it renders NOTHING when it has nothing
   to say — no heading, no empty container, no skeleton. Each renderer below
   returns null for that case and the caller appends only what came back.
   Der Tisch's young round (#1269) is not an exception to it: „ab wann es Zahlen
   gibt" IS something to say, and it is said once per card rather than as an
   empty box — see hubSentenceCard.

   Part of the frontend; all files share one global script scope. Loaded before
   views-round-start.js, which calls every one of these at RENDER time, so the
   order between the two is not load-bearing
   (.claude/rules/frontend-script-load-order.md).

   `hubPresetChips` lives here rather than with the launchpad although it is the
   CTA's chip row and not a card: it is the only other consumer of hubDeps(),
   and round-rail.js calls it too, so it belongs with the thing it shares rather
   than with either caller. */

// =================== Start tab: the card grid (#923) ===================

/* The siblings hub-insights.js needs, gathered in one place so the six cards
   below cannot each assemble a slightly different set. Every entry is the app's
   own function, passed through rather than restated — the injection shape
   hub-insights.js's header explains. */
const hubDeps = () => ({
  outcomeOf: sessionOutcome,
  endingOf: sessionEnding,
  monthKeyOf: periodKeyOf,
  dayIndexOf,
  monthsBetween,
  neutralScore: PRIOR_DEFAULT,
  filterOptions: metadataFilterOptions,
  normalizeMetadata: normalizeMetadataFilters,
  fitsMetadata: fitsMetadataFilters,
});

// One card frame. The title is a real <h2> so the grid reads as a set of
// labelled regions to a screen reader rather than as a wall of links.
function hubCard(icon, title) {
  return h(`<section class="hub-card">
       <h2 class="hub-card__title">${iconText(icon, title)}</h2>
       <div class="hub-card__body"></div>
     </section>`);
}

/* A YOUNG round (#1269): nothing has been drawn yet, or everything that was got
   cancelled. Der Tisch's young states key off this one question, so the
   invitation, the CTA's label and the two sentence cards cannot disagree about
   whether the round has started. A draw still being voted on is NOT young — it
   has its own ticket, and „Erste Session wirbeln" beside it would be wrong. */
function roundIsYoung(round) {
  return !(round.sessions || []).some((s) => sessionOutcome(s) !== 'cancelled');
}

/* A card that says one sentence instead of a number (T7.4). Der Tisch only:
   T7's rule is „wo Zahlen fehlen, steht kein „0" und keine leere Achse, sondern
   ein Satz, ab wann es Zahlen gibt". Klassisch never reaches this. */
function hubSentenceCard(icon, title, text) {
  const card = hubCard(icon, title);
  card.classList.add('hub-card--sentence');
  card.querySelector('.hub-card__body').appendChild(h(`<p class="hub-card__facts">${esc(text)}</p>`));
  return card;
}

/* Der Tisch's invitation for a round with games and no session (T7.4, #1269):
   how many games are ready, a strip of their covers, and why there are no
   scores yet. The one next step is the CTA directly above it, which reads
   „Erste Session wirbeln" in the same state. */
function hubYoungCard(round, activeGames) {
  if (!designIs('tisch') || !activeGames.length || !roundIsYoung(round)) return null;
  const card = hubCard('ti-cards', tn(activeGames.length, 'hub.young.readyOne', 'hub.young.ready'));
  card.classList.add('hub-card--young');
  const body = card.querySelector('.hub-card__body');
  // aria-hidden for the reason hubRegalPreview's strip is: the title already
  // says what is here, and a cover is not something this card offers to open.
  const strip = h('<div class="hub-preview__covers" aria-hidden="true"></div>');
  activeGames.slice(0, HUB_PREVIEW_COVERS).forEach((game) => {
    const style = game.image ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
    strip.appendChild(h(`<span class="hub-preview__cover"${style}>${game.image ? '' : coverPlaceholder(game)}</span>`));
  });
  body.appendChild(strip);
  body.appendChild(h(`<p class="hub-card__facts">${esc(t('hub.young.readyText'))}</p>`));
  return card;
}

/* Der Tisch's DEMO summary (T7.6, #1280): the demo round's three sub-pages as
   one condensed list — what is behind each tab and how much of it there is —
   in the place the three preview tiles take on every other round. The same
   three destinations, so nothing becomes unreachable: each row is that
   preview's link, and the tab strip / dock still carry all three.

   The values are the previews' own figures (the shelf count, the played-
   evening count, roundStandings' leader), never a second derivation. The
   sheet's fourth row („Wie wär's mit") is left out: that card is on the same
   screen, directly below, so the row would link to where the reader already
   is. */
function hubDemoSummary(round, activeGames) {
  const list = h(`<nav class="hub-demo" aria-label="${esc(t('hub.demo.label'))}"></nav>`);
  const { winners, rankOf } = roundStandings(round);
  const leaders = winners.filter((m) => rankOf[m.id] === 1);
  // `s.finished`, like hubChronikPreview — the count the Chronik lists.
  const played = round.sessions.filter((s) => s.finished).length;
  const lead = leaders.length === 1 ? t('hub.preview.pokaleLead', { name: leaders[0].name })
    : leaders.length ? t('hub.preview.pokaleLeadTie', { n: leaders.length }) : '';
  [
    { tab: 'regal', icon: 'ti-layout-grid', value: tn(activeGames.length, 'home.chip.gamesOne', 'home.chip.games') },
    { tab: 'chronik', icon: 'ti-history', value: tn(played, 'home.chip.sessionsOne', 'home.chip.sessions') },
    { tab: 'pokale', icon: 'ti-trophy', value: lead },
  ].forEach(({ tab, icon, value }) => {
    const row = h(`<a class="hub-demo__row">
         <i class="ti ${icon}" aria-hidden="true"></i>
         <span class="hub-demo__main">
           <span class="hub-demo__label">${esc(t('hub.tab.' + tab))}</span>
           <span class="hub-demo__hint">${esc(t('hub.demo.hint.' + tab))}</span>
         </span>
         ${value ? `<span class="hub-demo__value">${esc(value)}</span>` : ''}
       </a>`);
    navLink(row, roundPath(round.id, tab), () => showRound(round.id, tab));
    list.appendChild(row);
  });
  return list;
}

/* „Gefällt dir das?" (T7.6, #1280): the demo's one invitation to make it real.
   The button is the banner's own exit (leaveDemoForRegister, demo-account.js)
   rather than a second copy of it — the demo's tokens must be dropped before
   the register screen opens, and a copy that forgot would hand a signed-in demo
   session to the sign-up form.

   The sheet's sentence („gehört niemandem und wird jede Nacht zurückgesetzt")
   is not what the demo does — every visitor gets a demo account of their own,
   deleted when it expires — so the copy states that instead. */
function hubDemoInvite() {
  const card = hubCard('ti-sparkles', t('hub.demo.inviteTitle'));
  card.classList.add('hub-card--demo-invite');
  const body = card.querySelector('.hub-card__body');
  body.appendChild(h(`<p class="hub-card__facts">${esc(t('hub.demo.inviteText'))}</p>`));
  const btn = h(`<button class="btn hub-demo__cta" type="button">${esc(t('hub.demo.inviteCta'))}</button>`);
  btn.addEventListener('click', () => leaveDemoForRegister());
  body.appendChild(btn);
  return card;
}

/* a) Spielvorschläge — the positive mirror of the retirement banner.

   `exclude` is the id set that banner is proposing in this same render, so the
   screen cannot recommend and nag the same game. */
function hubSuggestCard(round, activeGames, statsByGame, exclude) {
  const rows = gameSuggestions(
    round, activeGames, { statsByGame, exclude }, hubDeps()
  );
  if (!rows.length) {
    /* Der Tisch says WHEN instead of saying nothing (T7.4, #1269) — but only
       for the one reason it can state truthfully: a young round whose shelf is
       under the floor. The sheet's „Vorschläge brauchen Wertungen" is not that
       reason (the app suggests unrated games), so it is not the copy. Every
       other empty answer keeps returning null — #1280's thresholds are about
       series and the podium, and have nothing to say about suggestions. */
    if (designIs('tisch') && roundIsYoung(round) && activeGames.length
      && activeGames.length < SUGGEST_MIN_SHELF) {
      return hubSentenceCard('ti-bulb', t('hub.suggest.title'),
        tn(SUGGEST_MIN_SHELF, 'hub.young.suggestOne', 'hub.young.suggest'));
    }
    return null;
  }
  const card = hubCard('ti-bulb', t('hub.suggest.title'));
  const body = card.querySelector('.hub-card__body');
  rows.forEach(({ game, reason }) => {
    const why =
      reason.kind === 'longAgo'
        ? tn(reason.months, 'hub.suggest.longAgoOne', 'hub.suggest.longAgo')
        : t('hub.suggest.' + reason.kind);
    const row = h(`<a class="hub-row">
         <span class="hub-row__main">
           <span class="hub-row__title">${esc(game.title)}</span>
           <span class="hub-row__sub">${esc(why)}</span>
         </span>
         <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
       </a>`);
    navLink(row, gamePath(round.id, game.id), () => showGameDetail(round.id, game.id));
    body.appendChild(row);
  });
  return card;
}

/* b) Schnellstart-Presets — chips under the big CTA that open the session setup
   with the draw already narrowed.

   They sit at the CTA rather than in the grid because they are a modifier on
   the one action this screen exists for, not a module of their own.

   TWO SOURCES, never mixed (#1328). A round with saved filters shows EXACTLY
   those, in the order set in Einstellungen, labelled with their names; the
   automatic `quickPresets` guesses are only the fallback for a round that has
   saved none. Mixing them would put a group's own „Kinderrunde" beside a
   generic „Leichte Kost" as if the app's guess were as deliberate as theirs.

   ONE RENDERER FOR EVERY DESIGN. Klassisch's Start tab, its rail and Der
   Tisch's felt band all call this function, and a design only STYLES
   `.hub-presets` / `.chip.hub-preset` — it never builds its own row.
   test/hub-saved-filters.test.js walks every registered design to hold that.

   A saved chip is NOT gated like the built-ins (which drop a chip that would
   narrow nothing or empty the pool): the group chose it, so it shows even when
   it matches zero games today — and it is deliberately NOT muted either.
   Deciding "matches zero" here would mean re-running the whole draw predicate
   (tags, metadata, seats, box owners, multi-table) per chip on the hub, for an
   answer the setup screen already gives honestly the moment the chip is
   tapped: its pool count and its clear-filters control.

   NOTHING IS PERSISTED HERE. `lastSessionFilters` is written server-side by the
   draw itself (POST …/sessions), so an exploratory tap that never draws leaves
   the round's remembered preset exactly as it was — which is a property of
   where the write lives, not a guard this code has to remember. */
function hubPresetChips(round, activeGames) {
  const saved = Array.isArray(round.savedFilters) ? round.savedFilters : [];
  const chips = saved.length ? [] : quickPresets(activeGames, hubDeps());
  if (!saved.length && !chips.length) return null;
  const row = h(`<div class="hub-presets" role="group" aria-label="${esc(t('hub.preset.label'))}"></div>`);
  // The Start tab's copy is `rail-owned` (see the caller); the rail builds its
  // own from the same function, so the two can never offer different chips.
  saved.forEach((sf) => {
    // User text: escaped, and truncated by CSS only — the button's text stays
    // the full name, so its accessible name is never the clipped one, and the
    // `title` shows it to a pointer.
    const btn = h(`<button class="chip hub-preset hub-preset--saved" title="${esc(sf.name)}"><span class="hub-preset__name">${esc(sf.name)}</span></button>`);
    btn.addEventListener('click', () => showStartSession(round, savedFilterPrefill(sf)));
    row.appendChild(btn);
  });
  chips.forEach((chip) => {
    const btn = h(`<button class="chip hub-preset">${esc(t('hub.preset.' + chip.id))}</button>`);
    btn.addEventListener('click', () => showStartSession(round, { metadata: chip.metadata }));
    row.appendChild(btn);
  });
  return row;
}

/* c) Rundenpuls — how often the round meets, when it last did, and how much of
   the shelf has ever reached the table.

   The bars are CSS only. The app ships no chart library and must not gain one
   for twelve numbers (#923 scope): each bar is a <span> with a height
   percentage, which is also why the whole row degrades to readable text when
   styles fail to load. */
function hubPulseCard(round, activeGames) {
  /* Der Tisch draws its tiles from the FIRST played evening (T7.5, #1280):
     every tile is a real figure at one session. Klassisch's bar chart waits
     for YOUNG_ROUND_SERIES_FROM (#1318 merge interview, 2026-09-25) — a chart
     off one or two evenings is the same noise the podium and the streak card
     already wait out, so all three share one threshold. */
  const tisch = designIs('tisch');
  const floor = tisch ? 1 : YOUNG_ROUND_SERIES_FROM;
  const pulse = roundPulse(round, activeGames, { minSessions: floor }, hubDeps());
  if (!pulse) {
    // A young round gets the sentence, never a „0" (T7.4, #1269) — Der Tisch
    // from its empty table on, Klassisch once something has been played (its
    // empty hub keeps the card off, as it always did). The count is the
    // pulse's own floor, so the copy cannot promise numbers sooner than
    // roundPulse() will draw them.
    const say = tisch ? roundIsYoung(round) : youngRoundPlayed(round, hubDeps()) > 0
      && youngRoundPlayed(round, hubDeps()) < floor;
    if (say && activeGames.length) {
      return hubSentenceCard('ti-activity', t('hub.pulse.title'),
        tn(floor, 'hub.young.pulseOne', 'hub.young.pulse'));
    }
    return null;
  }
  const card = hubCard('ti-activity', t('hub.pulse.title'));
  const body = card.querySelector('.hub-card__body');
  /* Until the third played session the card says WHEN series come (T7.5;
     the sheet's „und Trends" was dropped — the Tisch pulse has no trend
     line, #1280 review) — the same YOUNG_ROUND_SERIES_FROM that holds back the
     Pokale streak card, so the sentence cannot promise something already on
     screen. Every design since #1318 (Klassisch's two-bar chart at two
     sessions is the same noise); in both it closes the card. */
  const young = youngRoundPlayed(round, hubDeps()) < YOUNG_ROUND_SERIES_FROM;
  const threshold = () => h(`<p class="hub-card__facts hub-card__threshold">${esc(tn(YOUNG_ROUND_SERIES_FROM, 'hub.young.seriesOne', 'hub.young.series'))}</p>`);
  if (tisch) {
    hubPulseTiles(round, card, pulse);
    if (young) body.appendChild(threshold());
    return card;
  }
  const peak = Math.max(...pulse.months.map((m) => m.count), 1);
  // `month: 'narrow'` gives one letter per bar, which is what makes twelve of
  // them fit a 280px card at every locale. The full month name rides along as
  // the accessible name, so the axis is never only a letter.
  const narrow = (at) => new Date(at).toLocaleString(localeTag(locale), { month: 'narrow' });
  const bars = pulse.months
    .map((m) => {
      const label = t('hub.pulse.barLabel', { month: fmtMonth(new Date(m.at).toISOString()), n: m.count });
      return `<span class="pulse-bar" title="${esc(label)}">
           <span class="pulse-bar__fill" style="height:${Math.round((m.count / peak) * 100)}%"></span>
           <span class="pulse-bar__tick" aria-hidden="true">${esc(narrow(m.at))}</span>
         </span>`;
    })
    .join('');
  body.appendChild(h(`<div class="pulse-bars" role="img" aria-label="${esc(tn(pulse.total, 'hub.pulse.sessionsOne', 'hub.pulse.sessions'))}">${bars}</div>`));

  const facts = [tn(pulse.total, 'hub.pulse.sessionsOne', 'hub.pulse.sessions')];
  if (pulse.daysSinceLast !== null) {
    facts.push(
      pulse.daysSinceLast === 0
        ? t('hub.pulse.lastToday')
        : tn(pulse.daysSinceLast, 'hub.pulse.lastDaysOne', 'hub.pulse.lastDays')
    );
  }
  body.appendChild(h(`<p class="muted hub-card__facts">${esc(facts.join(' · '))}</p>`));

  // Shelf coverage links into the Regal, because that is where the untouched
  // games are — the number is only useful if it is one tap from acting on it.
  if (pulse.neverPlayed > 0) {
    const link = h(`<a class="hub-row hub-row--quiet">
         <span class="hub-row__main"><span class="hub-row__sub">${esc(t('hub.pulse.coverage', { n: pulse.neverPlayed, total: pulse.shelfSize }))}</span></span>
         <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
       </a>`);
    navLink(link, roundPath(round.id, 'regal'), () => showRound(round.id, 'regal'));
    body.appendChild(link);
  }
  // No series sentence here: the bars only exist from YOUNG_ROUND_SERIES_FROM
  // on, so a drawn Klassisch pulse is never young. Left out deliberately —
  // a guard for a state this branch cannot enter would be untestable.
  return card;
}

/* Der Tisch's Rundenpuls (T2.2, T3.2; #1263): three stat tiles — a number over
   its label — instead of the bars and the fact sentence. A stat tile is number
   plus label, not a sentence, so this is its own markup rather than CSS faking
   tiles out of the paragraph above.

   The same three facts the Klassisch card states, from the same roundPulse():
   the sessions of the last twelve months, the days since the last one, and the
   games never played. The sheet's middle tile is „Schnitt" — a round-wide
   average nothing in the app computes; the days-since tile stands in for it
   until the operator says which average that is (see the PR). The bars go:
   the sheet draws none, and the count they sum to is the first tile.

   „ungespielt" is the link into the Regal whenever it is non-zero, exactly as
   the Klassisch coverage row is — the number is only useful one tap from
   acting on it. */
function hubPulseTiles(round, card, pulse) {
  const tiles = h('<div class="pulse-tiles"></div>');
  const tile = (n, label, tag = 'div') => h(
    `<${tag} class="pulse-tile"><span class="pulse-tile__n">${esc(String(n))}</span><span class="pulse-tile__label">${esc(label)}</span></${tag}>`
  );
  tiles.appendChild(tile(pulse.total, tn(pulse.total, 'hub.pulse.tile.sessionsOne', 'hub.pulse.tile.sessions')));
  if (pulse.daysSinceLast !== null) {
    tiles.appendChild(tile(pulse.daysSinceLast, tn(pulse.daysSinceLast, 'hub.pulse.tile.daysOne', 'hub.pulse.tile.days')));
  }
  const never = tile(pulse.neverPlayed, tn(pulse.neverPlayed, 'hub.pulse.tile.neverOne', 'hub.pulse.tile.never'),pulse.neverPlayed > 0 ? 'a' : 'div');
  if (pulse.neverPlayed > 0) {
    never.classList.add('pulse-tile--link');
    navLink(never, roundPath(round.id, 'regal'), () => showRound(round.id, 'regal'));
  }
  tiles.appendChild(never);
  card.querySelector('.hub-card__body').appendChild(tiles);
  return card;
}

/* d) Kümmerliste — gaps that quietly degrade other features, each row a link to
   the screen that fixes it.

   Guarded on `game.edit` even though every grantee role clears that floor today,
   for the reason the discard control above states: the routes behind these fixes
   decide on a capability, so the card that points at them asks the same
   question — a re-tightening tomorrow then removes the card instead of leaving
   a list of things the reader is not allowed to do. */
function hubCareCard(round, activeGames) {
  if (!roundCan(round, 'game.edit')) return null;
  const list = careList(round, activeGames, hubDeps());
  if (list.empty) return null;
  const card = hubCard('ti-tool', t('hub.care.title'));
  const body = card.querySelector('.hub-card__body');

  const section = (total, one, many, rows, label, href, go) => {
    if (!total) return;
    body.appendChild(h(`<div class="hub-care__head">${esc(tn(total, one, many))}</div>`));
    rows.forEach((item) => {
      const row = h(`<a class="hub-row hub-row--quiet">
           <span class="hub-row__main"><span class="hub-row__sub">${esc(label(item))}</span></span>
           <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
         </a>`);
      navLink(row, href(item), () => go(item));
      body.appendChild(row);
    });
  };

  // The winnerless rows first: a played evening with no winner leaves the
  // standings, the win rate and the member records untouched, so it is the gap
  // that costs the most and the one nothing else on any screen mentions.
  section(
    list.winnerlessTotal, 'hub.care.winnerOne', 'hub.care.winner', list.winnerless,
    (s) => {
      const g = round.games.find((x) => x.id === s.chosenGameId);
      return g ? t('hub.care.winnerRow', { game: g.title, when: fmtDate(s.createdAt) }) : fmtDate(s.createdAt);
    },
    (s) => resultsPath(round.id, s.id),
    (s) => showResults(round, s)
  );
  section(
    list.noRangeTotal, 'hub.care.rangeOne', 'hub.care.range', list.noRange,
    (g) => g.title, (g) => gamePath(round.id, g.id), (g) => showGameDetail(round.id, g.id)
  );
  section(
    list.coverlessTotal, 'hub.care.coverOne', 'hub.care.cover', list.coverless,
    (g) => g.title, (g) => gamePath(round.id, g.id), (g) => showGameDetail(round.id, g.id)
  );
  return card;
}

/* e) „Heute vor einem Jahr" — rare by construction: on 364 days of the year
   this returns null and nothing is rendered at all. */
function hubAnniversaryCard(round) {
  const found = anniversary(round, {}, hubDeps());
  if (!found) return null;
  const { session, game, years } = found;
  const card = hubCard('ti-confetti', tn(years, 'hub.anniv.yearsOne', 'hub.anniv.years'));
  // Winners resolve against the session's OWN people, so a guest winner is named
  // and marked here exactly as on the ticket above (#458).
  const people = sessionPeople(round, session);
  const names = (session.winnerIds || [])
    .map((wid) => personLabel(people.find((p) => p.id === wid)))
    .filter(Boolean);
  const row = h(`<a class="hub-row">
       <span class="hub-row__main">
         <span class="hub-row__title">${esc(game.title)}</span>
         <span class="hub-row__sub">${names.length ? esc(t('result.winners', { names: joinNames(names) })) : (endingText(session) || esc(fmtDate(session.createdAt)))}</span>
       </span>
       <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
     </a>`);
  navLink(row, resultsPath(round.id, session.id), () => showResults(round, session));
  card.querySelector('.hub-card__body').appendChild(row);
  return card;
}

/* f) Empfehlungs-Teaser — one or two rows from the recommendations screen
   (#682), which below 1280px is reachable only from the desktop rail and is
   therefore effectively invisible on a phone.

   FETCHED AFTER FIRST PAINT, never in showRound's Promise.all: the route does a
   full getRound plus the corpus join, so putting it on the critical path would
   double the round read for a card that is often empty.

   It answers 200 with an empty list — not 404 — for a round below the profile
   floor, an instance with no corpus, and an instance with no BGG_API_TOKEN. All
   three, and any error at all, degrade to rendering nothing; the reader loses a
   teaser they never knew was coming.

   The reason lines go through `recReasonText`, the recommendations screen's own
   phrasing of the server's terms. A second opinion here is precisely the drift
   .claude/rules/shared-constants-across-the-stack.md exists for. */
async function renderRecoTeaser(rid, grid) {
  let data;
  try { data = await api('GET', `/api/rounds/${rid}/recommendations`); }
  catch { return; }
  const recs = (data && data.recommendations) || [];
  if (!recs.length) return;
  // The tab may have been left while the fetch was in flight — a re-render, a
  // tab switch, a navigation. The grid is then detached and appending to it
  // would build a card nobody can ever see, on top of a round that may not even
  // be on screen any more.
  if (!grid.isConnected) return;
  const card = hubCard('ti-sparkles', t('suggest.title'));
  const body = card.querySelector('.hub-card__body');
  recs.slice(0, 2).forEach((rec) => {
    const why = (rec.reasons || []).map(recReasonText).filter(Boolean)[0] || '';
    const row = h(`<div class="hub-row hub-row--static">
         <span class="hub-row__main">
           <span class="hub-row__title">${esc(rec.title)}</span>
           ${why ? `<span class="hub-row__sub">${esc(why)}</span>` : ''}
         </span>
       </div>`);
    body.appendChild(row);
  });
  const more = h(`<a class="hub-row hub-row--quiet">
       <span class="hub-row__main"><span class="hub-row__sub">${esc(t('hub.reco.more'))}</span></span>
       <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
     </a>`);
  navLink(more, roundPath(rid, 'recommendations'), () => showRecommendations(rid));
  body.appendChild(more);
  grid.appendChild(cardSlot(card));
  // This card is content, so the #869 stand-in above is no longer standing in
  // for an empty pane. It was rendered before the fetch resolved — the only
  // ordering available for something deliberately kept off the critical path.
  const gap = grid.parentNode && grid.parentNode.querySelector('.empty--rail-gap');
  if (gap) gap.remove();
}
