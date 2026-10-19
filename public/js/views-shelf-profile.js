/* Spielwirbel – views: the Regal-Steckbrief (#1173) — the Start tab's card, the
   detail screen it opens, and the share-as-image action.

   Everything shown is DERIVED on demand from the active shelf by shelfProfile()
   (shelf-profile.js); nothing is stored, nothing is fetched beyond the round the
   screen already loads. The card follows the Start grid's contract — it renders
   NOTHING below the builder's threshold of games with provider data — and lives
   here rather than in hub-cards.js so the feature's three surfaces (card,
   screen, share) share their label helpers in one file.

   The detail screen is a sub-screen of the REGAL (HUB_TAB_OF), as the issue
   placed it: it is a reading of the shelf, and the dock/rail mark it there.

   Design: Klassisch gets bars; Der Tisch gets its Start-card language — the seat
   bands as stat tiles (the Rundenpuls's `.pulse-tile`) on the card, the same bars
   in felt/paper on the screen.

   Part of the frontend; all files share one global script scope. Loaded after
   views-round-start.js, which calls hubShelfProfileCard at RENDER time. */

// The builder's dependencies, injected for the reason shelf-profile.js's header
// gives: the draw pool's own seat predicate, the (Uncredited) filter, and each
// game's SHELF score from the caller's roundScoreIndex — the number the Regal
// prints, so the ranked lists can never disagree with the shelf (#1556).
const shelfProfileDeps = (statsByGame) => ({
  fitsPlayerCount,
  fitsPlayerCountFrom,
  gamePlaytime,
  creditedDesigners,
  scoreOf: (g) => { const st = statsByGame[g.id]; return st ? st.score : null; },
});

// A listed name's score as the screen and the image print it: clamped for
// display, like every score (core.js displayScore). It was RANKED unclamped.
const shelfTopScore = (it) => fmtAvg(displayScore(it.score));

// Section titles per dimension. Playing time and weight reuse the filter panel's
// labels: the same fields, named the same way wherever the app shows them.
const SHELF_DIM_TITLES = { seats: 'shelfProfile.seats', time: 'metaFilter.playtime', weight: 'metaFilter.weight' };

const shelfSeatName = (key) => (key === '6' ? '6+' : key);

// A band's label as a bar shows it. Solo has its own word (#1666): „für 1"
// reads as a typo beside „für 2", and every locale has a plain one.
function shelfBandLabel(dim, key) {
  if (dim === 'seats' && key === '1') return t('shelfProfile.seatsSolo');
  if (dim === 'seats') return t('shelfProfile.seatsShort', { seats: shelfSeatName(key) });
  return t(`shelfProfile.${dim}.${key}`);
}

// One gap as a sentence: „Für 6+ Personen: nur 2 Spiele", „Über 120 Min.: kein Spiel".
function shelfGapText(gap) {
  const what = gap.dim === 'seats'
    ? t('shelfProfile.seatsLabel', { seats: shelfSeatName(gap.key) })
    : shelfBandLabel(gap.dim, gap.key);
  return gap.n === 0
    ? t('shelfProfile.gap.none', { what })
    : tn(gap.n, 'shelfProfile.gap.fewOne', 'shelfProfile.gap.few', { what });
}

// The dimensions that made it past the builder's own data floor, in order.
const shelfDims = (p) => ['seats', 'time', 'weight'].filter((dim) => p[dim]).map((dim) => [dim, p[dim]]);

/* One dimension as horizontal bars. Each fill is the band's share of the games
   that CARRY the value — so a bar reads "6 of the 9 games that say", and the
   „ohne Angabe" line under it says how many did not. A gap (shelfBandIsGap) is
   marked, and its count is real text, so the bar is never the only
   carrier of the number.

   With `open` (the screen, #1668) a non-zero count is the button that lists
   the band's games; the Start card passes none and stays a summary. */
function shelfBars(dim, d, open) {
  const list = h('<ul class="shelf-bars"></ul>');
  d.bands.forEach((b) => {
    const pct = d.known ? Math.round((b.n / d.known) * 100) : 0;
    const label = shelfBandLabel(dim, b.key);
    const row = h(`<li class="shelf-bar${shelfBandIsGap(dim, b) ? ' shelf-bar--gap' : ''}">
         <span class="shelf-bar__label">${esc(label)}</span>
         <span class="shelf-bar__track" aria-hidden="true"><span class="shelf-bar__fill" style="width:${pct}%"></span></span>
         <span class="shelf-bar__n">${b.n}</span>
       </li>`);
    if (open && b.n) {
      const btn = shelfCountButton(row.querySelector('.shelf-bar__n'), String(b.n));
      btn.setAttribute('aria-label', tn(b.n, 'shelfProfile.showGamesOne', 'shelfProfile.showGames', { what: label }));
      btn.addEventListener('click', () => open(btn, shelfListTitle(dim, b.key), b.games));
    }
    list.appendChild(row);
  });
  return list;
}

/* Swap a count's <span> for a <button> carrying the same classes and text, so
   every design's rule for the span (the gap accent, the tabular numerals) still
   applies. `.shelf-count` adds only the button reset and the affordance. */
function shelfCountButton(span, text) {
  const btn = h(`<button type="button" class="${esc(span.className)} shelf-count" aria-haspopup="dialog" aria-expanded="false">${esc(text)}</button>`);
  span.replaceWith(btn);
  return btn;
}

// A band's list title: the dimension and the band, „Personen · für 5".
const shelfListTitle = (dim, key) =>
  t('shelfProfile.listTitle', { label: t(SHELF_DIM_TITLES[dim]), name: shelfBandLabel(dim, key) });

/* The games behind one count (#1668), as #1562 lists the games behind a
   favourite name: openEditor, so an anchored popover from 860px and a sheet
   below it, with Escape, Back, the backdrop and focus restoration included
   (.claude/rules/popover-vs-sheet-editors.md). It wears the stats list's
   `stats-games` variant and classes on purpose — the same popup, so every
   design that paints that one paints this one, and the phone sheet docks the
   same way.

   Each title links to the game's own Spielepass IN THIS ROUND, not to BGG:
   these are the round's games. A sheet owns a history marker, so the link
   closes it first and navigates after (closeSheet(next)); a popover dies in
   syncUrl. `scoreOf` is given for a score-ranked list only, and puts the
   shelf's own pill on each row. */
function openShelfGames(btn, title, games, rid, scoreOf) {
  btn.setAttribute('aria-expanded', 'true');
  openEditor(btn, 'stats-games', title, (el) => {
    const bare = el.classList.contains('popover') && !el.querySelector('.popover__head');
    if (bare) {
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', title);
    }
    const body = h(`<div class="stats-games">
        ${bare ? `<h2 class="stats-games__title">${esc(title)}</h2>` : ''}
        <ol class="stats-games__list"></ol>
      </div>`);
    const list = body.querySelector('ol');
    games.forEach((g) => {
      const score = scoreOf ? scoreOf(g) : null;
      const row = h(`<li class="stats-games__row">
          ${g.image
    ? `<img class="stats-games__cover" src="${esc(coverUrl(g.image, COVER_THUMB))}" alt="" loading="lazy" />`
    : '<span class="stats-games__cover stats-games__cover--none" aria-hidden="true"></span>'}
          <span class="stats-games__body shelf-games__body">
            <a class="stats-games__name">${esc(g.title)}</a>
            ${typeof score === 'number' ? `<span class="score-pill" style="--sc:${scoreColor(score)}" data-stop="${scoreStop(score)}">${fmtAvg(displayScore(score))}</span>` : ''}
          </span>
        </li>`);
      navLink(row.querySelector('a'), gamePath(rid, g.id), () => closeSheet(() => showGameDetail(rid, g.id)));
      list.appendChild(row);
    });
    el.appendChild(body);
    const first = body.querySelector('a');
    // After the container is live — focus() on a detached node does nothing.
    return () => { if (first) first.focus(); };
  }, () => btn.setAttribute('aria-expanded', 'false'));
}

// The gaps as a list (the screen passes them all). With
// `open` (the screen) a gap that HAS games — „nur 2 Spiele" — is the button that
// lists them; „kein Spiel" stays text, there is nothing to open.
function shelfGapList(gaps, max, open) {
  const list = h('<ul class="shelf-gaps"></ul>');
  gaps.slice(0, max).forEach((gap) => {
    const row = h(`<li class="shelf-gap"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span>${esc(shelfGapText(gap))}</span></li>`);
    if (open && gap.n) {
      const btn = shelfCountButton(row.querySelector('span'), shelfGapText(gap));
      btn.addEventListener('click', () => open(btn, shelfListTitle(gap.dim, gap.key), gap.games));
    }
    list.appendChild(row);
  });
  return list;
}

/* The Start tab's card. Null below the threshold, like every Start card, and
   null when the shelf has no dominant range worth a sentence. */
function hubShelfProfileCard(round, activeGames, statsByGame) {
  if (simpleHidden('stats')) return null; // „Einfacher Modus" (#1646)
  const p = shelfProfile(activeGames, shelfProfileDeps(statsByGame));
  /* One sentence and the link, in every design (#1683). The tile used to draw
     the lead dimension's bars and the first gaps — a slice of the screen it
     links to rather than a summary of what the shelf IS. The bars, Der Tisch's
     seat tiles and the gap list all still live on the screen. */
  const sentence = shelfHeadlineText(shelfHeadline(p));
  if (!sentence) return null;
  const card = hubCard('ti-id', t('shelfProfile.title'));
  card.classList.add('hub-card--shelf', 'hub-card--link');
  const body = card.querySelector('.hub-card__body');
  body.appendChild(h(`<p class="shelf-card__headline">${esc(sentence)}</p>`));
  const link = h(`<a class="hub-row hub-row--quiet hub-card__go">
       <span class="hub-row__main"><span class="hub-row__sub">${esc(t('shelfProfile.more'))}</span></span>
       <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
     </a>`);
  navLink(link, roundPath(round.id, 'shelf-profile'), () => showShelfProfile(round.id));
  body.appendChild(link);
  return card;
}

/* shelfHeadline's clause descriptors (shelf-profile.js) as words. Each clause
   is a whole phrase from the language files, so no grammar is built here by
   concatenation; the clauses are joined with a fixed separator, and the lead
   word („Meist") wraps the result. '' when there is nothing to say. */
const SHELF_TIME_MAX = { upTo30: 30, to60: 60, to120: 120 };
const SHELF_TIME_ORDER = ['upTo30', 'to60', 'to120', 'over120'];
function shelfHeadlineClause({ dim, from, to }) {
  if (dim === 'seats') {
    if (from === '1' && to === '1') return t('shelfProfile.headline.solo');
    if (to === '6') return t('shelfProfile.headline.seatsFrom', { seats: from });
    if (from === to) return t('shelfProfile.headline.seatsOne', { seats: from });
    return t('shelfProfile.headline.seatsRange', { from, to });
  }
  if (dim === 'time') {
    const i = SHELF_TIME_ORDER.indexOf(from);
    const min = i > 0 ? SHELF_TIME_MAX[SHELF_TIME_ORDER[i - 1]] : 0;
    if (to === 'over120') return t('shelfProfile.headline.timeOver', { min });
    if (!min) return t('shelfProfile.headline.timeUpTo', { max: SHELF_TIME_MAX[to] });
    // „31–60", as the band labels read: the band above 30 starts at 31.
    return t('shelfProfile.headline.timeRange', { min: min + 1, max: SHELF_TIME_MAX[to] });
  }
  if (from === to) return t(`shelfProfile.headline.weight.${from}`);
  return t('shelfProfile.headline.weightRange', {
    from: t(`shelfProfile.headline.weight.${from}`),
    to: t(`shelfProfile.headline.weight.${to}`),
  });
}
function shelfHeadlineText(clauses) {
  if (!clauses.length) return '';
  return t('shelfProfile.headline', { clauses: clauses.map(shelfHeadlineClause).join(' · ') });
}

// A titled panel on the screen — the Start card's frame, so every design paints
// it with the material it already gives `.hub-card`.
function shelfPanel(title) {
  const panel = h(`<section class="hub-card shelf-panel">
       <h2 class="hub-card__title">${esc(title)}</h2>
       <div class="hub-card__body"></div>
     </section>`);
  return { panel, body: panel.querySelector('.hub-card__body') };
}

/* The mechanics, categories or designers the round rates best (#1556), each
   with its mean score as the shelf's own pill and the number of scored games
   behind it. The sub-line and the ⓘ say what orders the list — without them a
   ranked list of names reads as "most common", which it was until #1556.

   The names are BGG's own and stay untranslated — its terms allow choosing
   which of its names to show, never rewriting one. */
// `type` is the BGG link type the names are (#1638): each name becomes a link
// to its BGG page once POST /api/bgg-links answers, and stays plain text until
// then — or for good, when the instance has no id for it. The share image is
// built from the profile data, not from this panel, so it is unaffected.
// `open` (#1668) makes each row's „aus N Spielen" the button that lists the
// scored games behind the name, best score first — what the mean was taken over.
function shelfTopPanel(title, items, type, open) {
  const { panel, body } = shelfPanel(title);
  panel.querySelector('.hub-card__title').insertAdjacentHTML('beforeend', ` ${infoButton('score')}`);
  body.appendChild(h(`<div class="shelf-card__sub">${esc(t('shelfProfile.byScore'))}</div>`));
  const list = h('<ol class="shelf-top"></ol>');
  items.forEach((it) => {
    list.appendChild(h(`<li class="shelf-top__row">
         <span class="shelf-top__name">${esc(it.name)}</span>
         <span class="shelf-top__val">
           <span class="shelf-top__n">${esc(tn(it.n, 'shelfProfile.topGamesOne', 'shelfProfile.topGames'))}</span>
           <span class="score-pill" style="--sc:${scoreColor(it.score)}" data-stop="${scoreStop(it.score)}">${shelfTopScore(it)}</span>
         </span>
       </li>`));
  });
  if (open) {
    list.querySelectorAll('.shelf-top__n').forEach((span, i) => {
      const it = items[i];
      const btn = shelfCountButton(span, span.textContent);
      btn.addEventListener('click', () =>
        open(btn, t('shelfProfile.listTitle', { label: title, name: it.name }), it.games, true));
    });
  }
  body.appendChild(list);
  linkShelfTopNames(list, items, type);
  wireInfoButtons(panel);
  return panel;
}

// Upgrade each row's name to a BGG link in place. Returns the promise for the
// specs; the panel never waits on it.
function linkShelfTopNames(list, items, type, ask) {
  const names = items.map((it) => it.name);
  if (!type || !names.length) return Promise.resolve();
  return resolveBggLinks({ [type]: names }, ask).then((ids) => {
    const known = ids[type] || {};
    list.querySelectorAll('.shelf-top__name').forEach((el, i) => {
      const name = names[i];
      if (Object.prototype.hasOwnProperty.call(known, name)) el.replaceChildren(bggLinkedNames(type, [name], known));
    });
  });
}

// The share image's content, built at CLICK time in the active locale — the
// same moment the recap's share builds its model.
function shelfShareModel(round, p) {
  const lists = [
    { title: t('metaFilter.mechanics'), items: p.mechanics },
    { title: t('metaFilter.categories'), items: p.categories },
    { title: t('gameInfo.designers'), items: p.designers },
  ].filter((l) => l.items.length)
    .map((l) => ({ title: l.title, items: l.items.map((it) => `${it.name} · ${shelfTopScore(it)}`) }));
  return {
    roundName: round.name,
    title: t('shelfProfile.title'),
    basis: tn(p.linked, 'shelfProfile.basisOne', 'shelfProfile.basis'),
    dims: shelfDims(p).map(([dim, d]) => ({
      title: t(SHELF_DIM_TITLES[dim]),
      known: d.known,
      rows: d.bands.map((b) => ({ label: shelfBandLabel(dim, b.key), n: b.n, gap: shelfBandIsGap(dim, b) })),
    })),
    lists,
    gapsTitle: t('shelfProfile.gaps'),
    gaps: p.gaps.map(shelfGapText),
  };
}

/* Draw the image and hand it on. The catch touches no server, so it REPORTS
   before it toasts — otherwise it is the end of the story, which is exactly how
   the WebKit canvas taint went unseen for every world round
   (.claude/rules/caught-client-faults-are-invisible.md). The toast is the
   recap's own wording: the same failure, said the same way. */
async function shareShelfProfile(model) {
  let blob;
  try {
    blob = await shelfProfileCardBlob(model);
  } catch (err) {
    reportClientError('shelf_profile_export', err);
    toast(t('periodRecap.toast.failed'), { tone: 'error' });
    return;
  }
  await deliverShareImage(blob, 'spielwirbel-steckbrief.png');
}

// The screen: every dimension as bars, the gaps, the leading mechanics,
// categories and designers, and „Teilen".
async function showShelfProfile(rid) {
  currentView = () => showShelfProfile(rid);
  syncUrl(roundPath(rid, 'shelf-profile'));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyMarker(round);
  setContext(round.name);
  setDocTitle(t('shelfProfile.title'), round.name);

  const activeGames = round.games.filter(isActiveGame);
  const deps = shelfProfileDeps(roundScoreIndex(round, activeGames).byGame);
  const p = shelfProfile(activeGames, deps);
  // Every count on the screen opens the games behind it (#1668).
  const open = (btn, title, games, scored) => openShelfGames(btn, title, games, rid, scored ? deps.scoreOf : null);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'shelf-profile');
  // Back to the Start tab: the card there is the only way in.
  app.appendChild(backRow(() => showRound(rid, 'start')));
  const head = h(`<div class="page-head shelf-head"><div>
       <h1>${esc(t('shelfProfile.title'))}</h1>
       <div class="muted">${esc(round.name)}</div>
     </div></div>`);
  app.appendChild(head);

  // A direct link to a shelf that has since thinned out (games archived, a
  // stale bookmark): say what it takes rather than render empty panels.
  if (!p) {
    app.appendChild(emptyState({ icon: 'ti-id', text: t('shelfProfile.thin', { n: SHELF_PROFILE_MIN_GAMES }) }));
    return;
  }

  // Offered only where the browser can deliver the PNG at all — the recap's
  // own capability check, so the two share buttons appear on the same browsers.
  if (canShareRecapImage()) {
    const btn = h(`<button class="btn btn--ghost shelf-head__share">${iconText('ti-share', t('share.button'))}</button>`);
    btn.addEventListener('click', () => shareShelfProfile(shelfShareModel(round, p)));
    head.appendChild(btn);
  }

  app.appendChild(h(`<p class="muted shelf-basis">${esc(tn(p.linked, 'shelfProfile.basisOne', 'shelfProfile.basis'))}</p>`));
  const grid = h('<div class="shelf-profile"></div>');
  shelfDims(p).forEach(([dim, d]) => {
    const { panel, body } = shelfPanel(t(SHELF_DIM_TITLES[dim]));
    body.appendChild(shelfBars(dim, d, open));
    if (d.unknown) {
      body.appendChild(h(`<p class="muted hub-card__facts">${esc(tn(d.unknown, 'shelfProfile.unknownOne', 'shelfProfile.unknown'))}</p>`));
    }
    grid.appendChild(panel);
  });
  const gaps = shelfPanel(t('shelfProfile.gaps'));
  gaps.body.appendChild(p.gaps.length
    ? shelfGapList(p.gaps, p.gaps.length, open)
    : h(`<p class="hub-card__facts">${esc(t('shelfProfile.noGaps'))}</p>`));
  grid.appendChild(gaps.panel);
  if (p.mechanics.length) grid.appendChild(shelfTopPanel(t('metaFilter.mechanics'), p.mechanics, 'mechanic', open));
  if (p.categories.length) grid.appendChild(shelfTopPanel(t('metaFilter.categories'), p.categories, 'category', open));
  if (p.designers.length) grid.appendChild(shelfTopPanel(t('gameInfo.designers'), p.designers, 'designer', open));
  app.appendChild(grid);
}
