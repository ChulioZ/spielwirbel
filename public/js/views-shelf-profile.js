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
   in felt/paper on the screen. No per-world styling: the worlds go with the flip
   (#1202), so they inherit Klassisch's bars in their own --brand.

   Part of the frontend; all files share one global script scope. Loaded after
   views-round-start.js, which calls hubShelfProfileCard at RENDER time. */

// The builder's one dependency, the draw pool's own seat predicate — injected
// for the reason shelf-profile.js's header gives.
const shelfProfileDeps = () => ({ fitsPlayerCount });

// Section titles per dimension. Playing time and weight reuse the filter panel's
// labels: the same fields, named the same way wherever the app shows them.
const SHELF_DIM_TITLES = { seats: 'shelfProfile.seats', time: 'metaFilter.playtime', weight: 'metaFilter.weight' };

const shelfSeatName = (key) => (key === '6' ? '6+' : key);

// A band's label as a bar shows it.
function shelfBandLabel(dim, key) {
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
   „ohne Angabe" line under it says how many did not. A band under the gap
   threshold is marked, and its count is real text, so the bar is never the only
   carrier of the number. */
function shelfBars(dim, d) {
  const list = h('<ul class="shelf-bars"></ul>');
  d.bands.forEach((b) => {
    const pct = d.known ? Math.round((b.n / d.known) * 100) : 0;
    const row = h(`<li class="shelf-bar${b.n < SHELF_PROFILE_FEW ? ' shelf-bar--gap' : ''}">
         <span class="shelf-bar__label">${esc(shelfBandLabel(dim, b.key))}</span>
         <span class="shelf-bar__track" aria-hidden="true"><span class="shelf-bar__fill" style="width:${pct}%"></span></span>
         <span class="shelf-bar__n">${b.n}</span>
       </li>`);
    list.appendChild(row);
  });
  return list;
}

// The gaps as a list, capped for the card and complete on the screen.
function shelfGapList(gaps, max) {
  const list = h('<ul class="shelf-gaps"></ul>');
  gaps.slice(0, max).forEach((gap) => {
    list.appendChild(h(`<li class="shelf-gap"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span>${esc(shelfGapText(gap))}</span></li>`));
  });
  return list;
}

/* Der Tisch's card body (T2.2's stat-tile language, as the Rundenpuls speaks
   it): one tile per seat band, the count over „für 2". A band under the gap
   threshold is marked `.shelf-tile--gap`. */
function shelfSeatTiles(d) {
  const tiles = h('<div class="pulse-tiles shelf-tiles"></div>');
  d.bands.forEach((b) => {
    tiles.appendChild(h(`<div class="pulse-tile shelf-tile${b.n < SHELF_PROFILE_FEW ? ' shelf-tile--gap' : ''}">
         <span class="pulse-tile__n">${b.n}</span>
         <span class="pulse-tile__label">${esc(shelfBandLabel('seats', b.key))}</span>
       </div>`));
  });
  return tiles;
}

// How many gap lines the Start card shows. The screen one tap away has them all.
const SHELF_CARD_GAPS = 3;

/* The Start tab's card. Null below the threshold, like every Start card.

   It shows ONE dimension — the seats, since „can we play this at our table
   size" is the question a draw asks first — plus the strongest gaps, and links
   to the screen. Should a shelf lack seat data but carry the others, the first
   dimension that has enough data stands in. */
function hubShelfProfileCard(round, activeGames) {
  const p = shelfProfile(activeGames, shelfProfileDeps());
  if (!p) return null;
  const card = hubCard('ti-id', t('shelfProfile.title'));
  card.classList.add('hub-card--shelf');
  const body = card.querySelector('.hub-card__body');
  const [lead] = shelfDims(p);
  if (lead) {
    const [dim, d] = lead;
    body.appendChild(h(`<div class="shelf-card__sub">${esc(t(SHELF_DIM_TITLES[dim]))}</div>`));
    body.appendChild(designIs('tisch') && dim === 'seats' ? shelfSeatTiles(d) : shelfBars(dim, d));
  }
  if (p.gaps.length) body.appendChild(shelfGapList(p.gaps, SHELF_CARD_GAPS));
  const link = h(`<a class="hub-row hub-row--quiet">
       <span class="hub-row__main"><span class="hub-row__sub">${esc(t('shelfProfile.more'))}</span></span>
       <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
     </a>`);
  navLink(link, roundPath(round.id, 'shelf-profile'), () => showShelfProfile(round.id));
  body.appendChild(link);
  return card;
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

// The mechanics or categories as a ranked list with their counts. The names are
// BGG's own and stay untranslated — its terms allow choosing which of its names
// to show, never rewriting one.
function shelfTopPanel(title, items) {
  const { panel, body } = shelfPanel(title);
  const list = h('<ol class="shelf-top"></ol>');
  items.forEach((it) => {
    list.appendChild(h(`<li class="shelf-top__row"><span class="shelf-top__name">${esc(it.name)}</span><span class="shelf-top__n">${it.n}</span></li>`));
  });
  body.appendChild(list);
  return panel;
}

// The share image's content, built at CLICK time in the active locale — the
// same moment the recap's share builds its model.
function shelfShareModel(round, p) {
  const lists = [
    { title: t('metaFilter.mechanics'), items: p.mechanics },
    { title: t('metaFilter.categories'), items: p.categories },
  ].filter((l) => l.items.length)
    .map((l) => ({ title: l.title, items: l.items.map((it) => `${it.name} · ${it.n}`) }));
  return {
    roundName: round.name,
    title: t('shelfProfile.title'),
    basis: tn(p.linked, 'shelfProfile.basisOne', 'shelfProfile.basis'),
    dims: shelfDims(p).map(([dim, d]) => ({
      title: t(SHELF_DIM_TITLES[dim]),
      known: d.known,
      rows: d.bands.map((b) => ({ label: shelfBandLabel(dim, b.key), n: b.n, gap: b.n < SHELF_PROFILE_FEW })),
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

// The screen: every dimension as bars, the gaps, the leading mechanics and
// categories, and „Teilen".
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

  const p = shelfProfile(round.games.filter(isActiveGame), shelfProfileDeps());

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
    body.appendChild(shelfBars(dim, d));
    if (d.unknown) {
      body.appendChild(h(`<p class="muted hub-card__facts">${esc(tn(d.unknown, 'shelfProfile.unknownOne', 'shelfProfile.unknown'))}</p>`));
    }
    grid.appendChild(panel);
  });
  const gaps = shelfPanel(t('shelfProfile.gaps'));
  gaps.body.appendChild(p.gaps.length
    ? shelfGapList(p.gaps, p.gaps.length)
    : h(`<p class="hub-card__facts">${esc(t('shelfProfile.noGaps'))}</p>`));
  grid.appendChild(gaps.panel);
  if (p.mechanics.length) grid.appendChild(shelfTopPanel(t('metaFilter.mechanics'), p.mechanics));
  if (p.categories.length) grid.appendChild(shelfTopPanel(t('metaFilter.categories'), p.categories));
  app.appendChild(grid);
}
