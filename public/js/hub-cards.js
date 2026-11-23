/* Spielwirbel – the round hub's Start tab: the CARD GRID (#1189, split out of
   views-round-start.js).

   Six renderers and one frame. Everything they say is DERIVED on demand from
   the round payload the tab already holds (public/js/hub-insights.js) — no new
   field, no new table, no extra request. (The recommendations teaser that
   fetched after first paint left in #1853, with the three previews: the Regal's
   scope strip reaches the recommendations at every width.)

   Split along the seam views-round-start.js's own banner had marked since #923:
   the LAUNCHPAD (identity, the one CTA, the tickets) and the CARDS are edited
   independently. The tab that composes all of them stays next door.

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
  newestFirst: newestSessionsFirst,
  longLoans,
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
   ein Satz, ab wann es Zahlen gibt". Die Brücke's Rundenpuls uses it too
   (B7.1); Klassisch never reaches this. */
function hubSentenceCard(icon, title, text) {
  const card = hubCard(icon, title);
  card.classList.add('hub-card--sentence');
  card.querySelector('.hub-card__body').appendChild(h(`<p class="hub-card__facts">${esc(text)}</p>`));
  return card;
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
  if (simpleHidden('suggestions')) return null; // „Einfacher Modus" (#1646)
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
    // Ocean says it too (#1216, O7.3 „Wie wär's mit"), in the pair beside the
    // shell — the same one truthful reason, the same copy. And Die Brücke, in
    // its own slot (#1243, B7.2 „sagt, wann es losgeht").
    // Forest too (#1471, F7.4), in the pair under the stump.
    if ((designIs('tisch') || designIs('ocean') || designIs('bruecke') || designIs('forest')) && roundIsYoung(round) && activeGames.length
      && activeGames.length < SUGGEST_MIN_SHELF) {
      return hubSentenceCard('ti-bulb', t('hub.suggest.title'),
        tn(SUGGEST_MIN_SHELF, 'hub.young.suggestOne', 'hub.young.suggest'));
    }
    return null;
  }
  const card = hubCard('ti-bulb', t('hub.suggest.title'));
  const body = card.querySelector('.hub-card__body');
  rows.forEach((row) => body.appendChild(hubSuggestRow(round, row)));
  /* The fill (#1683): the runner-ups, cycling through the reasons. The base
     rows above are exactly the no-limit answer, and gameSuggestions builds
     round by round, so the longer answer starts with them by construction
     (test/hub-insights.test.js pins the prefix). */
  const more = gameSuggestions(
    round, activeGames, { statsByGame, exclude, limit: rows.length + HUB_FILL_SUGGESTIONS }, hubDeps()
  ).slice(rows.length);
  const fill = hubFill(more.map((row) => hubSuggestRow(round, row)), 'hub-fill--rows');
  if (fill) body.appendChild(fill);
  return card;
}

// How many runner-ups the fill may offer; hub-fill.js shows the ones that fit.
const HUB_FILL_SUGGESTIONS = 9;

/* One suggestion row. The cover thumb is in every row, and styles.css keeps it
   `display: none`: only a design that stretches its tiles shows it (#1683), so
   the column-flow designs render as they did. aria-hidden, since the title
   beside it already names the game. */
function hubSuggestRow(round, { game, reason }) {
  const why =
    reason.kind === 'longAgo'
      ? tn(reason.months, 'hub.suggest.longAgoOne', 'hub.suggest.longAgo')
      : t('hub.suggest.' + reason.kind);
  const style = game.image ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
  const row = h(`<a class="hub-row">
       <span class="hub-row__cover" aria-hidden="true"${style}>${game.image ? '' : coverPlaceholder(game)}</span>
       <span class="hub-row__main">
         <span class="hub-row__title">${esc(game.title)}</span>
         <span class="hub-row__sub">${esc(why)}</span>
       </span>
       <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
     </a>`);
  navLink(row, gamePath(round.id, game.id), () => showGameDetail(round.id, game.id));
  return row;
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

   It never returns null since #1853: „Direkt wählen" leads the row at every
   shelf size, so the row is the one place the CTA's modifiers live.

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
  const row = h(`<div class="hub-presets" role="group" aria-label="${esc(t('hub.preset.label'))}"></div>`);
  /* „Direkt wählen" FIRST (#1853): it replaced the separate „Jetzt spielen"
     button that sat under the chips (#1682), so the one action has one row of
     modifiers rather than a row and a second button. Always present — the
     picker offers a game the group does not own, so even an empty shelf can
     play something. */
  const direct = h(`<button class="chip hub-preset hub-preset--direct">${iconText('ti-player-play', t('hub.preset.direct'))}</button>`);
  direct.addEventListener('click', () => showDirectPlayPicker(round));
  row.appendChild(direct);
  if (!activeGames.length) return row;
  const saved = Array.isArray(round.savedFilters) ? round.savedFilters : [];
  const chips = saved.length ? [] : quickPresets(activeGames, hubDeps());
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
  if (simpleHidden('stats')) return null; // „Einfacher Modus" (#1646)
  /* The FACTS come from the first played session in every design (#1586,
     standardised on Der Tisch's T7.5, #1280): the sessions of the last twelve
     months, the days since the last one and the games never played are real
     figures at one evening, and a design owns how they are laid out, never
     whether they are said (#1422). Only the SERIES wait for
     YOUNG_ROUND_SERIES_FROM (#1318 merge interview, 2026-09-25) — a chart off
     one or two evenings is the same noise the podium and the streak card
     already wait out, so all three share one threshold. In every design: the
     Programmheft drew its bars from the first session (P7.5, #1377) until the
     #1586 merge interview (2026-10-07) gated it too; it still says when series
     come in its lead story (phLead's `note`) rather than under the card. */
  const tisch = designIs('tisch');
  const ph = designIs('programmheft');
  const pulse = roundPulse(round, activeGames, { minSessions: 1 }, hubDeps());
  /* Nothing played in the last twelve months: no card. The young round's
     sentence variants (T7.4, B7.1) left with the card's Start-tab home in
     #1853 — the Chronik head it lives in now (round-head-lines.js) shows no
     pulse at all for a round that has nothing to summarise. */
  if (!pulse) return null;
  const card = hubCard('ti-activity', t('hub.pulse.title'));
  const body = card.querySelector('.hub-card__body');
  /* Until the third played session the card says WHEN series come (T7.5;
     the sheet's „und Trends" was dropped — the Tisch pulse has no trend
     line, #1280 review) — the same YOUNG_ROUND_SERIES_FROM that holds back the
     Pokale streak card, so the sentence cannot promise something already on
     screen. It closes the card, after the facts and the coverage link (#1586),
     in every design but the Programmheft, which says it once in its lead
     (above). Forest said it under the stump (F7.5) until the #1586 merge
     interview moved it here, beside the bars it explains. */
  const young = !ph && youngRoundPlayed(round, hubDeps()) < YOUNG_ROUND_SERIES_FROM;
  const threshold = () => h(`<p class="hub-card__facts hub-card__threshold">${esc(tn(YOUNG_ROUND_SERIES_FROM, 'hub.young.seriesOne', 'hub.young.series'))}</p>`);
  if (tisch) {
    hubPulseTiles(round, card, pulse);
    if (young) body.appendChild(threshold());
    return card;
  }
  /* The bars gate on the twelve-month TOTAL they would draw, the floor
     roundPulse() itself applied until #1586: a round with older evenings but
     fewer than three in the window states its facts without a two-bar chart,
     and without the series sentence either — it is not young. */
  if (pulse.total >= YOUNG_ROUND_SERIES_FROM) hubPulseBars(body, pulse);

  const facts = [tn(pulse.total, 'hub.pulse.sessionsOne', 'hub.pulse.sessions')];
  if (pulse.daysSinceLast !== null) {
    facts.push(
      pulse.daysSinceLast === 0
        ? t('hub.pulse.lastToday')
        : tn(pulse.daysSinceLast, 'hub.pulse.lastDaysOne', 'hub.pulse.lastDays')
    );
  }
  /* Die Brücke sets the Rundenpuls as three LINES (B2.2/B3.1, #1238): when it
     last met, how often, and — the coverage row below — how much of the shelf
     never reached the table. Same strings, one fact per line, recency first. */
  const lines = designIs('bruecke')
    ? facts.slice().reverse().map((f) => `<span class="hub-card__fact">${esc(f)}</span>`).join('')
    : esc(facts.join(' · '));
  body.appendChild(h(`<p class="muted hub-card__facts">${lines}</p>`));

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
  if (young) body.appendChild(threshold());
  return card;
}

/* The twelve monthly bars of a pulse that has a series to draw. */
function hubPulseBars(body, pulse) {
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

/* d) „Zu tun · n" (#1853) — ONE folded row for the two lists of things to fix:
   the Kümmerliste (gaps that quietly degrade other features, each row a link
   to the screen that fixes it) and the retirement recommendations. Collapsed by
   default, with the combined count on its bar: a to-do list is something you
   open when you have a minute, not the evening's headline.

   The Kümmerliste half is guarded on `game.edit` even though every grantee role
   clears that floor today: the routes behind these fixes decide on a
   capability, so the row that points at them asks the same question. The
   recommendations keep the banner's own two actions — „Aussortieren" per game
   and „Ausblenden" for the session (`minimizedRecs`). */
function hubTodoRow(round, activeGames, recs) {
  const care = !simpleHidden('todo') && roundCan(round, 'game.edit') // „Einfacher Modus" (#1646)
    ? careList(round, activeGames, hubDeps()) : null;
  const careN = care && !care.empty
    ? care.winnerlessTotal + care.loansTotal + care.noRangeTotal + care.coverlessTotal : 0;
  let recN = recs.length && !minimizedRecs.has(round.id) ? recs.length : 0;
  if (!careN && !recN) return null;
  const row = h(`<section class="hub-todo">
       <button type="button" class="hub-todo__bar" aria-expanded="false" aria-controls="hubTodoBody">
         <i class="ti ti-tool" aria-hidden="true"></i>
         <span class="hub-todo__label"></span>
         <i class="ti ti-chevron-down hub-todo__caret" aria-hidden="true"></i>
       </button>
       <div class="hub-todo__body" id="hubTodoBody" hidden></div>
     </section>`);
  const bar = row.querySelector('.hub-todo__bar');
  const body = row.querySelector('.hub-todo__body');
  const label = () => { row.querySelector('.hub-todo__label').textContent = t('hub.todo.label', { n: careN + recN }); };
  label();
  bar.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    row.classList.toggle('is-open', open);
    bar.setAttribute('aria-expanded', String(open));
  });

  const section = (total, one, many, rows, text, href, go) => {
    if (!total) return;
    body.appendChild(h(`<div class="hub-care__head">${esc(tn(total, one, many))}</div>`));
    rows.forEach((item) => {
      const link = h(`<a class="hub-row hub-row--quiet">
           <span class="hub-row__main"><span class="hub-row__sub">${esc(text(item))}</span></span>
           <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
         </a>`);
      navLink(link, href(item), () => go(item));
      body.appendChild(link);
    });
  };
  if (careN) {
    // The winnerless rows first: a played evening with no winner leaves the
    // standings, the win rate and the member records untouched, so it is the
    // gap that costs the most and the one nothing else on any screen mentions.
    section(
      care.winnerlessTotal, 'hub.care.winnerOne', 'hub.care.winner', care.winnerless,
      (s) => {
        const g = round.games.find((x) => x.id === s.chosenGameId);
        return g ? t('hub.care.winnerRow', { game: g.title, when: fmtDate(s.createdAt) }) : fmtDate(s.createdAt);
      },
      (s) => resultsPath(round.id, s.id),
      (s) => showResults(round, s)
    );
    // A box out for eight weeks (#1775) — before the shelf data gaps: it is a
    // real box in somebody else's house.
    section(
      care.loansTotal, 'hub.care.loanOne', 'hub.care.loan', care.loans,
      (g) => t('hub.care.loanRow', { title: g.title, name: loanBorrowerName(round, g.loan), date: fmtLoanDay(g.loan.since) }),
      (g) => gamePath(round.id, g.id), (g) => showGameDetail(round.id, g.id)
    );
    section(
      care.noRangeTotal, 'hub.care.rangeOne', 'hub.care.range', care.noRange,
      (g) => g.title, (g) => gamePath(round.id, g.id), (g) => showGameDetail(round.id, g.id)
    );
    section(
      care.coverlessTotal, 'hub.care.coverOne', 'hub.care.cover', care.coverless,
      (g) => g.title, (g) => gamePath(round.id, g.id), (g) => showGameDetail(round.id, g.id)
    );
  }
  if (recN) body.appendChild(hubTodoRecs(round, recs, (rec) => {
    // „Ausblenden": the recommendations leave the row for this session; the
    // row itself goes when nothing is left in it.
    rec.remove();
    recN = 0;
    if (!careN) row.remove();
    else label();
  }));
  return row;
}

/* The retirement half of „Zu tun": enough data = at least three times as many
   votes as members (the caller's threshold). At most five games, then a count. */
function hubTodoRecs(round, recs, dismiss) {
  const part = h(`<div class="hub-todo__recs">
       <div class="hub-care__head">${esc(t('rec.title', { n: recs.length }))}</div>
       <div class="muted hub-todo__sub">${esc(t('rec.sub'))}</div>
       <div class="recommend-list"></div>
       <button type="button" class="link-btn hub-todo__dismiss">${iconText('ti-x', t('rec.dismiss'))}</button>
     </div>`);
  const list = part.querySelector('.recommend-list');
  recs.slice(0, 5).forEach(({ game, reasons }) => {
    const item = h(`<div class="recommend-item">
         <div class="recommend-item__info">
           <a class="recommend-item__title">${esc(game.title)}</a>
           <span class="recommend-item__reason">${reasons.map(esc).join(' · ')}</span>
         </div>
         <button class="btn recommend-item__btn">${esc(t('rec.retire'))}</button>
       </div>`);
    navLink(item.querySelector('.recommend-item__title'), gamePath(round.id, game.id), () =>
      showGameDetail(round.id, game.id)
    );
    item.querySelector('.recommend-item__btn').addEventListener('click', async () => {
      if (!await confirmDialog({
        body: t('detail.retireConfirm', { title: game.title }),
        confirmLabel: t('detail.retire'), icon: 'ti-archive', danger: false,
      })) return;
      try {
        await api('POST', `/api/rounds/${round.id}/games/${game.id}/retire`, { retired: true });
        toast(t('games.retired', { title: game.title }), { tone: 'success' });
        showRound(round.id);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
    list.appendChild(item);
  });
  if (recs.length > 5) {
    list.appendChild(h(`<div class="muted recommend-more">${esc(tn(recs.length - 5, 'rec.moreOne', 'rec.more'))}</div>`));
  }
  part.querySelector('.hub-todo__dismiss').addEventListener('click', () => {
    minimizedRecs.add(round.id);
    dismiss(part);
  });
  return part;
}

/* e) „Heute vor einem Jahr" — rare by construction: on 364 days of the year
   this returns null and nothing is rendered at all. */
function hubAnniversaryCard(round) {
  if (simpleHidden('stats')) return null; // „Einfacher Modus" (#1646)
  const found = anniversary(round, {}, hubDeps());
  if (!found) return null;
  const { session, game, years } = found;
  const card = hubCard('ti-confetti', tn(years, 'hub.anniv.yearsOne', 'hub.anniv.years'));
  card.classList.add('hub-card--link');
  // Winners resolve against the session's OWN people, so a guest winner is named
  // and marked here exactly as on the ticket above (#458).
  const people = sessionPeople(round, session);
  const names = (session.winnerIds || [])
    .map((wid) => personLabel(people.find((p) => p.id === wid)))
    .filter(Boolean);
  const row = h(`<a class="hub-row hub-card__go">
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

/* The EMPTY TABLE (T7.3, #1269): a 0-game round's one next step — „Der Topf ist
   noch leer", a sentence, and the two ways to fill the pot. The same
   `emptyState` every other empty screen uses, plus its actions, so each design
   paints it with the material it already gives `.empty` (Der Tisch's felt
   medallion, #1194). Every design since the #1269 merge interview.

   „Von BGG übernehmen" only where the import exists (canImportBgg — accounts
   mode), and the sentence drops its BGG half with it: copy that points at a
   button which is not there is the kind of promise T7 exists to stop making.

   Moved here from views-round-start.js by #1466 for that file's token budget:
   it is a card renderer like its neighbours, called from the Start tab.

   `titleKey` lets Forest name its own vessel (F7.3, #1471: „Der Stumpf ist
   noch leer" — the stump, not the pot); the sentence and the actions stay. */
function hubEmptyTable(round, { titleKey = 'hub.young.emptyTitle' } = {}) {
  const bgg = canImportBgg();
  const table = emptyState({
    icon: 'ti-tornado',
    title: t(titleKey),
    text: t(bgg ? 'hub.young.emptyTextBgg' : 'hub.young.emptyText'),
  });
  table.classList.add('empty--table');
  const actions = h('<div class="empty__actions"></div>');
  const add = h(`<button class="btn btn--primary"><i class="ti ti-plus" aria-hidden="true"></i> ${esc(t('round.addGame'))}</button>`);
  add.addEventListener('click', () => showAddGame(round));
  actions.appendChild(add);
  if (bgg) {
    const imp = h(`<button class="btn"><i class="ti ti-download" aria-hidden="true"></i> ${esc(t('bggImport.tile'))}</button>`);
    imp.addEventListener('click', () => showBggImport(round));
    actions.appendChild(imp);
  }
  table.appendChild(actions);
  return table;
}
