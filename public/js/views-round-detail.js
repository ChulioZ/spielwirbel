/* Spielwirbel – views: a round's game detail screen, plus the wish-list price
   block it renders. Loaded after views-round.js; shares one global script scope.

   #956 took the three things here that were not game detail: the design picker
   and the tag manager (two routed screens) joined views-round-settings.js, which
   already links to both, and the sheet/editor overlay layer became sheet.js —
   it was called from eleven other files while living in this one. */

// =================== The wish-list price block ===================

// How old a stored fallback price is, phrased for the reader (#688).
//
// Two deliberate roundings, both in the same direction — the label may overstate
// the age, never understate it, because understating it is the § 5a UWG problem
// this line exists to avoid:
//
//  - anything under an hour reads as "1 hour". A fallback served minutes after a
//    restart is genuinely fresh, but "0 hours" invites the reader to treat it as
//    live, and the clock doing the arithmetic is the reader's own.
//  - past a day the unit changes and the remainder is dropped downward, so 47
//    hours is "1 day" rather than "2".
function priceAge(iso, now = Date.now()) {
  const hours = Math.floor((now - new Date(iso).getTime()) / 3600000);
  if (hours < 24) return tn(Math.max(1, hours), 'price.staleHour', 'price.staleHours');
  return tn(Math.floor(hours / 24), 'price.staleDay', 'price.staleDays');
}

// The price box for a wished-for game (#679), from GET …/games/:gid/prices.
//
// A top-level function rather than a closure inside showGameDetail so a spec can
// render it straight from a payload (.claude/rules/testing-views-under-jsdom.md);
// it needs nothing from the view but the answer.
//
// Three things here are legal requirements rather than presentation choices, and
// each is invisible if it silently stops happening:
//
//  - `shippingKnown: false` means the amount is the product price ALONE. It is
//    never labelled as a total — PAngV § 3/§ 6 wants the total including VAT and
//    the concrete shipping cost, so an offer that cannot state shipping says
//    "plus shipping" instead of pretending.
//  - The retrieval time and the "may have changed" note are what keep an
//    hour-old price from reading as a live one. Nothing in CI can detect an
//    upstream that stopped updating; this line is the whole mitigation.
//  - The source line names where the data comes from AND that the aggregator
//    lists participating shops only. Withholding that about a price comparison
//    is a § 5a UWG omission (BGH I ZR 55/16) — it is not a footnote we may drop
//    to tidy the layout.
//  - A `stale: true` payload is a STORED price (#688) served while the source is
//    out, so its age leads instead of sitting in the footnote below.
//
// `refreshing` (#707) marks the transient stored render while the live lookup is
// still in flight: the age line stays (the legal half — the price on screen IS
// days old), but the staleWhy line would claim the service is unreachable, which
// is not yet known — so a "checking the current price" note stands in for it.
function renderPriceSection(p, { refreshing = false } = {}) {
  const sec = h(`<div class="section gd-price"><h2>${esc(t('price.title'))}</h2></div>`);
  const amount = h(`<div class="gd-price__amount">${esc(fmtMoney(p.amount, p.currency))}</div>`);
  sec.appendChild(amount);

  // A stored last-known price (#688). The age moves OUT of the footnote and
  // directly under the amount: the quiet „Abgerufen am …" line is right for an
  // hour-old price and wrong for a three-day-old one, and a stale price
  // presented as current is a misleading omission rather than a rough edge.
  // The footnote stays as well — it carries the exact timestamp this summarises.
  if (p.stale) {
    sec.appendChild(h(`<div class="gd-price__stale">${esc(priceAge(p.fetchedAt))}</div>`));
    if (refreshing) {
      sec.appendChild(h(`<div class="muted gd-price__checking">${esc(t('price.checking'))}</div>`));
    } else {
      sec.appendChild(h(`<div class="muted gd-price__stale-why">${esc(t('price.staleWhy'))}</div>`));
    }
  }

  const facts = [];
  facts.push(t(p.shippingKnown ? 'price.inclShipping' : 'price.plusShipping'));
  if (p.discountPercent > 0) {
    facts.push(t('price.discount', { regular: fmtMoney(p.regular, p.currency), percent: p.discountPercent }));
  }
  // Whose shop it is. `destination` is "ships to here", not "the shop is here",
  // so a DE query legitimately returns AT, CH and GR shops — naming the country
  // is what stops one of those reading as a local offer.
  if (p.country) facts.push(t('price.shopIn', { country: p.country }));
  if (p.edition && p.edition.title) {
    facts.push(t('price.edition', { title: p.edition.title, lang: p.edition.lang || '?' }));
  }
  if (typeof p.offerCount === 'number') {
    facts.push(t('price.offers', { inStock: p.inStockCount, total: p.offerCount }));
  }
  sec.appendChild(h(`<div class="muted gd-price__facts">${esc(facts.join(' · '))}</div>`));

  if (p.url) {
    const label = t('price.viewOffers');
    sec.appendChild(h(`<a class="link-out" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-external-link" aria-hidden="true"></i> ${esc(label)}</a>`));
  }

  const disclosure = t('price.sourceBgp');
  sec.appendChild(h(`<div class="muted gd-price__note">${esc(t('price.retrieved', { when: fmtDateTime(p.fetchedAt) }))} · ${esc(t('price.mayChange'))}<br>${esc(disclosure)}</div>`));
  return sec;
}

// A settled "no offers" answer (#707): the lookup succeeded and nobody stocks
// the game. Rendered as a transparent note rather than nothing — an empty slot
// after a stored price was on screen would read as the price feature breaking.
// The disclosure is still owed, because the statement derives from the
// aggregator. It took the game's own provider until #744 left one price source;
// the parameter is gone with the branch it fed.
function renderPriceNoOffers() {
  const sec = h(`<div class="section gd-price gd-price--none"><h2>${esc(t('price.title'))}</h2></div>`);
  sec.appendChild(h(`<div class="muted gd-price__none">${esc(t('price.noOffers'))}</div>`));
  const disclosure = t('price.sourceBgp');
  sec.appendChild(h(`<div class="muted gd-price__note">${esc(disclosure)}</div>`));
  return sec;
}

// The three lists that hold a game the round is not playing off its shelf, in
// the order a game's own flags are read. ONE table, because two affordances on
// the game-detail screen answer the same question from it: the rail marks the
// list the game belongs to (#794) and the back control falls back to it (#663).
// They answered it separately until #794, and the rail's answer — a hard-coded
// Regal — was wrong in all three states, so the two navigation controls on one
// screen pointed at different lists.
//
// The order is not a tie-break: the repo clears the other two flags on every
// one of these transitions (`.claude/rules/active-games-filter-sites.md`), so a
// game is never in two of the lists at once.
//
// `show` is an arrow rather than a bare reference because these are defined in
// views-archive.js: a top-level table capturing them by value would be reading
// a later file's names at load time (`.claude/rules/frontend-script-load-order.md`).
const OFF_SHELF_LISTS = [
  { id: 'retired', holds: (g) => !!g.retired, show: (rid) => showRetired(rid) },
  { id: 'completed', holds: (g) => !!g.completed, show: (rid) => showCompleted(rid) },
  { id: 'wishlist', holds: (g) => !!g.wish, show: (rid) => showWishlist(rid) },
];

// The off-shelf list a game sits in, or null while it is on the shelf.
const offShelfListOf = (game) => OFF_SHELF_LISTS.find((l) => l.holds(game)) || null;

// =================== Der Tisch's Spielepass pieces (#1274) ===================
//
// Two small builders the view calls only under Der Tisch, top-level so a spec
// can reach them and so showGameDetail's flow stays one read.

// The score as a NUMERAL beside the title (T3.4, T6.3) — „4,8" over
// „Spielwirbel-Score · 5 Bewertungen" and the ⓘ. Where Klassisch keeps #1039's
// cover pill, this design states the number on the title's own line, which is
// also what keeps it off the cover (review finding A6: no text on a raw cover).
// The count is the sheet's „aus 5 Wertungen"; a played-but-unrated game says
// so instead, and an unscored one prints the Regal's „neu".
function tischScoreNumeral(st, shown) {
  const scored = st.score !== null;
  let evidence = '';
  if (st.count > 0) evidence = tn(st.count, 'score.evidenceOne', 'score.evidence');
  else if (st.plays > 0) evidence = tn(st.plays, 'score.evidencePlaysOne', 'score.evidencePlays');
  return h(`<div class="gd-bignum">
       <span class="gd-bignum__n${scored ? '' : ' gd-bignum__n--none'}">${esc(scored ? fmtAvg(shown) : t('games.scoreNew'))}</span>
       <span class="gd-bignum__cap">${esc(t('score.name'))} ${infoButton('score')}</span>
       ${evidence ? `<span class="gd-bignum__ev">${esc(evidence)}</span>` : ''}
     </div>`);
}

// One row of „Verwandte Sessions" as Der Tisch lists it: the winner's counter,
// the date, who won — or, for a session that did not end in a win for this game,
// the same status line the stamp prints — and the evening's score pill. The
// avatar is the FIRST winner's (initials, for the reason the raters band gives);
// every winner is named in the text beside it.
function tischPlayRow(round, s, { picked, status, winners, scoreCell }) {
  const first = winners[0];
  const who = first
    ? `<span class="avatar${first.guest ? ' avatar--guest' : ''}" style="background:${personColor(round, first)}" aria-hidden="true">${avatarFace(initials(first.name), {})}</span>`
    : '<span class="gd-play__dot" aria-hidden="true"></span>';
  const names = winners.map(personLabel).filter(Boolean);
  const what = names.length
    ? esc(tn(names.length, 'detail.playWonOne', 'detail.playWonMany', { names: names.join(', ') }))
    : status;
  return h(`<li class="gd-play${picked ? '' : ' gd-play--muted'}"><a class="gd-play__link">${who}<span class="gd-play__date">${esc(fmtDate(s.createdAt))}</span><span class="gd-play__what">${what}</span>${scoreCell}</a></li>`);
}

// =================== Game detail ===================

async function showGameDetail(rid, gameId) {
  currentView = () => showGameDetail(rid, gameId);
  // Called for its effect — the scroll reset (#623). It also answers whether this
  // was an arrival or one of the screen's own re-renders; nothing reads that any
  // more since #1122 removed the entry animation it gated.
  syncUrl(gamePath(rid, gameId));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyMarker(round);
  const game = round.games.find((g) => g.id === gameId);
  if (!game) return showRound(rid);
  setContext(round.name);
  setDocTitle(game.title, round.name);

  const st = gameStats(round, gameId);
  // Der Tisch composes this screen as T3.4/T6.3 draw it (#1274): the score as a
  // numeral beside the title, „Verwandte Sessions" as a dated list, the „…"
  // items as an Aktionen panel. Every branch below reads this one flag.
  const tisch = designIs('tisch');
  // Ocean (#1212, O3.4/O6.3) takes Der Tisch's dated session list, its raters-
  // first order and its Aktionen panel (`listy`), and lays the page out in
  // THREE columns instead of the spread: the cover over the facts, the story
  // (title, score, the one action, how the round rated it, the sessions), and
  // the actions. `story` is that middle column; it exists only under Ocean.
  const ocean = designIs('ocean');
  const listy = tisch || ocean;
  const coverCss = game.image ? `url('${coverUrl(game.image, COVER_HERO)}')` : '';
  const imgStyle = coverCss ? `style="background-image:${coverCss}"` : '';
  const fallback = coverPlaceholder(game);
  app.innerHTML = '';
  // Where this game lives, which both navigation controls below need. The rail
  // marks that list instead of the Regal, which for an off-shelf game is the one
  // section that by definition cannot contain it (#794).
  const offShelf = offShelfListOf(game);
  renderSubScreenTabs(round, 'game', offShelf && offShelf.id);
  // The fallback destination is derived from the GAME's state, not from an
  // origin argument (#663). Real history still wins — backRow feeds navBack —
  // so this is the deep-link case, and a page reached by URL has no origin to
  // pass: a game belongs to whichever screen lists it, whether it was opened
  // from a shared link, a session results row or the Pokale cards.
  // Held rather than appended-and-forgotten: the „…" page menu (#1039) joins
  // this row at its right end, and its handlers are closures defined below.
  const back = backRow(() => (offShelf ? offShelf.show(rid) : showRound(rid, 'regal')));
  app.appendChild(back);

  // Send a partial update, then re-render the page from fresh data.
  async function updateGame(updates) {
    const { imageBlob, removeImage, ...fields } = updates;
    let body;
    if (imageBlob || removeImage) {
      // Image involved → multipart. Scalar fields ride along as form fields.
      body = new FormData();
      Object.entries(fields).forEach(([k, v]) => body.append(k, v));
      if (imageBlob) {
        // Pre-flight against the shared cap, as the add-game paste zone does
        // (#867) — refused here rather than 413'd after the upload.
        if (imageBlob.size > COVER_MAX_BYTES) return toast(t('cover.tooLarge', { mb: COVER_MAX_MB }));
        const ext = (imageBlob.type && imageBlob.type.split('/')[1]) || 'png';
        body.append('image', imageBlob, 'cover.' + ext);
      }
      if (removeImage) body.append('removeImage', 'true');
    } else {
      body = fields;
    }
    try {
      await api('PATCH', `/api/rounds/${rid}/games/${gameId}`, body);
      toast(t('detail.saved'));
      showGameDetail(rid, gameId);
    } catch (e) {
      // The server's answer when the pre-flight above was bypassed; every other
      // code still surfaces as-is.
      if (e.message === 'cover_too_large') return toast(t('cover.tooLarge', { mb: COVER_MAX_MB }), { tone: 'error' });
      toast(e.message, { tone: 'error' });
    }
  }

  /* The five field editors live in public/js/game-editors.js since #968. They
     take an explicit context instead of closing over this function's scope —
     the SAME context for all five, so a reader learns the shape once — and it is
     bound here into the one-argument callbacks `editableTag` and the „…" menu
     already expect.

     `refresh` rather than letting them call `showGameDetail`: that keeps the
     dependency one-way, so the editors file needs nothing from this one. */
  // The game's owned expansions (#653), used by the chip below and derived
  // again inside the expansions editor — one line each, rather than a value in
  // the context that is a pure function of another value already in it.
  const owned = game.expansions || [];

  const editorCtx = {
    rid, round, game, updateGame, refresh: () => showGameDetail(rid, gameId),
  };
  const editPlayers = (anchor) => openPlayersPopover(editorCtx, anchor);
  const editOwners = (anchor) => openOwnersPopover(editorCtx, anchor);
  const editTags = (anchor) => openTagsPopover(editorCtx, anchor);
  const editImage = (anchor) => openImagePopover(editorCtx, anchor);
  const editExpansions = (anchor) => openExpansionEditor(editorCtx, anchor);

  // A tag chip that opens an editor (#424). A real <button>, not a span with a
  // click handler: Tab reaches it, Enter *and* Space activate it, and closing
  // the editor restores focus to it — all from the platform, which is the
  // direction .claude/rules/in-app-nav-links.md took for links. Safe to do here
  // because a chip is already an atomic inline-block/inline-flex pill, so
  // becoming a button changes none of its layout. The single chokepoint for all
  // four chip variants (players/tags × filled/empty).
  function editableTag(cls, inner, onOpen) {
    const el = h(`<button type="button" class="tag tag--edit ${cls}" title="${esc(t('detail.editHint'))}">${inner}</button>`);
    el.addEventListener('click', () => onOpen(el));
    return el;
  }

  // Activate the title → inline input; Enter/blur saves, Escape cancels.
  function startTitleEdit(spanEl) {
    const input = h('<input class="input gd-title-input" />');
    input.value = game.title;
    spanEl.replaceWith(input);
    input.focus();
    input.select();
    let handled = false;
    const commit = () => {
      if (handled) return;
      handled = true;
      const val = input.value.trim();
      if (!val || val === game.title) {
        input.replaceWith(spanEl); // nothing changed
        return;
      }
      updateGame({ title: val });
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      // Escape puts the trigger back, so put focus back on it too — otherwise a
      // keyboard user who cancels is dropped to <body> and restarts from the top
      // of the document. Removing the focused input fires no blur, and `handled`
      // keeps commit() out of it either way.
      else if (e.key === 'Escape') { handled = true; input.replaceWith(spanEl); spanEl.focus(); }
    });
  }

  // Min–max player inputs, as a popover or a sheet (see openEditor).

  // Related sessions (those that drew this game) – newest first. Computed up
  // here, not at its own section below, because `sparse` needs it.
  const related = round.sessions
    .filter((s) => s.gameIds.includes(gameId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  // A game nobody has touched yet: no cover, no rating, no session, no tags
  // (#256). Rendering the normal layout for it produced a page of near-empty
  // widgets — a dash in a grey ring, a dashed chip, one line of muted text —
  // which read as broken rather than new. Instead the page drops the empty
  // widgets entirely and leads with an invitation (see `onboard` below).
  const assignedTagIds = (game.tagIds || []).filter((x) => (round.tags || []).some((tg) => tg.id === x));
  const sparse =
    !game.image && st.score === null && related.length === 0 && assignedTagIds.length === 0;

  // =================== The spread (#1039) ===================
  //
  // The screen asks two questions on every visit — *what is this game* and *how
  // did it go for us* — and offers one action. Before this it answered both in
  // one 900px column of stacked sections, so from 1280px up 45% of the pane was
  // gutter while „Verwandte Sessions" sat below the fold and the score ring
  // printed the mean of sessions listed 800px further down.
  //
  // Now the two questions are the two pages of a spread: the game on the left,
  // our table on the right, with the one action pinned at the right page's foot.
  // Single column below 860px — the app's existing strip/dock/editor breakpoint
  // (.claude/rules/responsive-hub-tabs.md) — in the order card → history → bar.
  const pass = h('<div class="pass"></div>');
  const leftPage = h('<div class="pass__game"></div>');
  const rightPage = h('<div class="pass__table"></div>');
  pass.append(leftPage, rightPage);
  const story = ocean ? h('<div class="pass__story"></div>') : null;
  if (story) leftPage.after(story);
  // What each later block is appended to: the right page, or Ocean's story.
  const tale = story || rightPage;

  // --- Left page: the game's own card --------------------------------------
  //
  // Keeps #868's framed treatment and its 0.16 cover wash (the opacity is
  // contrast-capped — test/game-detail-hero.test.js), and #901's fixed cover
  // basis. What changed is the row: cover + title only, so the 701–939px gap
  // that used to sit where the ring's column was closes by itself.
  const card = h(`<div class="gd-head${sparse ? ' gd-head--sparse' : ''}"${
    coverCss ? ` style="--gd-cover:${coverCss}"` : ''
  }>
       <div class="gd-cover"></div>
       <div class="gd-info">
         <h1></h1>
         <div class="gd-chips"></div>
       </div>
     </div>`);
  const coverCol = card.querySelector('.gd-cover');
  const chips = card.querySelector('.gd-chips');
  const info = card.querySelector('.gd-info');

  // Editable cover image (activate to paste a new one or remove it). A <button>
  // for the same reason as the chips (#424); its fixed box means the UA's
  // inline-block is no change, and the `.gd-img--edit:focus-visible` overlay
  // rule was already written for a focusable frame.
  const imgEl = h(`<button type="button" class="gd-img gd-img--edit" ${imgStyle} title="${esc(t('detail.changeImage'))}">${fallback}<span class="gd-img__edit">${esc(t('detail.changeImage'))}</span></button>`);
  imgEl.addEventListener('click', () => editImage(imgEl));
  coverCol.appendChild(imgEl);

  // The score, on the cover's top-right corner — exactly where every Regal card
  // already puts it (#1039). It replaces the 88px ring and the „Spielwirbel-Score"
  // caption under it: the ring spent the page's best real estate on a number the
  // shelf states in a pill, and the caption is what the ⓘ beside it says.
  //
  // The pill carries an aria-label because the visible label went with the ring:
  // a bare „3,5" over box art announces a number with no subject. It CONTAINS the
  // visible text, so nothing here trades away WCAG 2.2 SC 2.5.3 (and the pill is
  // static text rather than a control, where that criterion would bind).
  //
  // Rendered only for a scored, non-wish, non-sparse game — the same three gates
  // the ring had (#256/#699): the round does not own a wish, so it cannot rate it,
  // and an empty badge on an empty page is what made this screen read as broken.
  //
  // An unscored game gets the Regal's own „neu" variant rather than nothing: the
  // issue's acceptance criterion names the two states that show NO pill (a wish
  // and a sparse game), and dropping it for a third — a game with a cover but no
  // plays yet — would leave that page with no score affordance at all, where
  // the same game's shelf card still says „neu".
  const shown = st.score === null ? null : displayScore(st.score);
  let scoreBig = null;
  if (!sparse && !game.wish && tisch) {
    scoreBig = tischScoreNumeral(st, shown);
    wireInfoButtons(scoreBig);
  } else if (!sparse && !game.wish) {
    const pill = st.score !== null
      ? `<span class="score-pill score-pill--lg" style="--sc:${scoreColor(st.score)}" data-stop="${scoreStop(st.score)}"
               aria-label="${esc(`${t('score.name')}: ${fmtAvg(shown)}`)}">${fmtAvg(shown)}</span>`
      : `<span class="score-pill score-pill--lg score-pill--none">${esc(t('games.scoreNew'))}</span>`;
    const badge = h(`<div class="gd-score">${pill}${infoButton('score')}</div>`);
    // Ocean puts no text on a cover (O3.4): the pill stands beside the title,
    // through the same title line Der Tisch's numeral uses.
    if (ocean) scoreBig = badge;
    else coverCol.appendChild(badge);
    wireInfoButtons(badge);
  }

  // Which printing this cover is (#742) — a quiet line under it, and only when
  // the game actually carries one. An edition that carries only languages has
  // nothing to say here and correctly renders nothing.
  const editionText = editionLabel(game.edition);
  if (editionText) {
    coverCol.appendChild(h(`<p class="gd-edition muted">${esc(t('detail.edition', { edition: editionText }))}</p>`));
  }

  // Title.
  const h1 = card.querySelector('h1');

  // The one trigger that is NOT a button (#424): the title is inline text that
  // wraps mid-line — that is what `box-decoration-break: clone` on `.gd-title`
  // is for — and a <button> is an atomic inline-block, so a long title would
  // take the whole line. `role="button"` is what tells a screen reader Enter
  // does something; a bare focusable span announces only its text.
  const titleEl = h(`<span class="gd-title" role="button" tabindex="0" title="${esc(t('detail.editName'))}">${esc(game.title)}</span>`);
  titleEl.addEventListener('click', () => startTitleEdit(titleEl));
  titleEl.addEventListener('keydown', (e) => {
    // preventDefault on Space, or the page scrolls under the editor.
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startTitleEdit(titleEl); }
  });
  h1.append(titleEl);
  // Der Tisch: the numeral stands BESIDE the title (T3.4, T6.3), on one opaque
  // line — the band that keeps the title's contrast independent of the cover
  // on the phone's half-height header. Title first in the DOM, as it reads.
  if (scoreBig) {
    const line = h('<div class="gd-titleline"></div>');
    h1.replaceWith(line);
    line.append(h1, scoreBig);
  }

  // The chips move OUT of the <h1> (#1039). They were appended into the heading
  // so they could sit beside the title's last line; the row is now its own flex
  // line, which also takes four interactive controls out of a heading's
  // accessible name.
  //
  // On a sparse page the dashed "set …" chips are suppressed: the onboarding
  // panel below already offers those exact actions, and two competing
  // affordances for one action is what made the old layout feel scattered.
  const hasPl = Number.isInteger(game.minPlayers) && Number.isInteger(game.maxPlayers);
  if (hasPl || !sparse) {
    // What the round can actually seat, once its expansions are counted (#653).
    // Only a FULLY declared expansion range widens anything — a lone bound
    // states no interval — which is why both bounds are required here as well.
    const widen = owned.filter((e) => Number.isInteger(e.minPlayers) && Number.isInteger(e.maxPlayers));
    const extra = [];
    if (hasPl && widen.length) {
      const up = Math.max(game.maxPlayers, ...widen.map((e) => e.maxPlayers));
      const down = Math.min(game.minPlayers, ...widen.map((e) => e.minPlayers));
      if (up > game.maxPlayers) extra.push(t('detail.expansionUpTo', { n: up }));
      if (down < game.minPlayers) extra.push(t('detail.expansionFrom', { n: down }));
    }
    const plText = hasPl
      ? playersText(game.minPlayers, game.maxPlayers) + (extra.length ? ` (${extra.join(', ')})` : '')
      : '';
    const plEl = hasPl
      ? editableTag('tag--players', iconText('ti-users', plText), editPlayers)
      : editableTag('tag--players tag--empty', esc(t('detail.setPlayers')), editPlayers);
    chips.append(plEl);
  }

  // Custom round tags (#238): assigned tags render as chips, each opening the
  // edit popover; with none assigned, an empty chip is the way in (and the
  // popover can create the round's very first tag inline).
  const roundTags = round.tags || [];
  if (assignedTagIds.length) {
    assignedTagIds.forEach((x) => {
      const tg = roundTags.find((q) => q.id === x);
      chips.append(editableTag('tag--custom', `<i class="ti ${tagIconClass(tg.icon)}" aria-hidden="true"></i>${esc(tg.name)}`, editTags));
    });
  } else if (!sparse) {
    chips.append(editableTag('tag--custom tag--empty', esc(t('detail.setTags')), editTags));
  }

  // Owners (#971): named when recorded, an empty chip as the way in otherwise.
  // Never on a WISH — the round does not own the game, so there is no owner to
  // record and the route refuses one.
  if (!game.wish) {
    const owners = ownerNames(round, game.ownerIds);
    if (owners.length) {
      chips.append(editableTag('tag--custom',
        iconText('ti-user', t('detail.owners', { names: owners.join(', ') })), editOwners));
    } else if (!sparse) {
      chips.append(editableTag('tag--custom tag--empty',
        esc(t('detail.setOwners')), editOwners));
    }
  }

  // What the round owns for this game (#653), as a chip instead of the 110px
  // section it used to cost on every visit (#1039). The editor it opens now
  // lists the owned expansions with their remove control, so nothing that was
  // reachable from the section is lost.
  //
  // Rendered on a sparse page EVEN WHEN EMPTY, unlike the three chips above:
  // it is one of the few things you can record about a game nobody has played,
  // and it is the answer to "do we still have Seefahrer?". Never on a
  // wishlist-imported EXPANSION (#698): an expansion holds no expansions of its
  // own, and anything recorded here would be silently lost on acquire. Presence
  // check, not truthiness — the key is absent on ordinary games and legitimately
  // [] on an orphan expansion (.claude/rules/expansions-widen-by-union.md).
  if (!Array.isArray(game.expansionOf)) {
    chips.append(owned.length
      ? editableTag('tag--custom tag--expansions',
        `<i class="ti ti-cards" aria-hidden="true"></i>${esc(tn(owned.length, 'detail.expansionsBadgeOne', 'detail.expansionsBadge'))}`,
        editExpansions)
      : editableTag('tag--custom tag--empty tag--expansions', esc(t('detail.addExpansionChip')), editExpansions));
  }

  // State chips — read-only, so plain spans rather than `editableTag`.
  if (game.retired) chips.append(h(`<span class="tag tag--retired">${iconText('ti-archive', t('result.retiredTag'))}</span>`));
  if (game.completed) chips.append(h(`<span class="tag tag--completed">${iconText('ti-circle-check', t('result.completedTag'))}</span>`));
  // The third chip (#663). Its key is `wish.tag`, not a fourth `result.*` one:
  // the two above are shared with the session results rows, and a wish can never
  // appear on one — the round does not own the game, so it was never played.
  if (game.wish) chips.append(h(`<span class="tag tag--wish">${iconText('ti-heart', t('wish.tag'))}</span>`));

  // The glance facts (#717/#724), promoted out of the „Über das Spiel" section
  // and onto the card as pills (#1039): weight, playing time, minimum age are
  // what a group asks before playing, while CATAN's 15 mechanics made that
  // section 517px tall on a phone. Both anchors are re-rendered together by
  // `renderInfo` below, because the provider backfill can fill either.
  const factsAnchor = h('<div></div>');
  // Ocean's facts are a column of their own under the cover (O3.4), so both
  // anchors below — the glance facts and „Mehr zum Spiel" — go there instead.
  const factsHost = ocean ? h('<div class="gd-factcol"></div>') : info;
  factsHost.appendChild(factsAnchor);

  // „Mehr zum Spiel" — the reference half, collapsed by default: the category
  // and mechanic lists, the community rating (detail only, #724), the BGG credit,
  // and the provider link. A native <details>, so the platform owns the
  // disclosure state, the keyboard and the accessible name.
  const moreBody = h('<div class="gd-more__body"></div>');
  const more = h(`<details class="gd-more"><summary>${esc(t('detail.more'))}<i class="ti ti-chevron-down" aria-hidden="true"></i></summary></details>`);
  more.appendChild(moreBody);

  // The provider link, which is the one thing in the disclosure every game has
  // something to say about. „Verknüpfung lösen" is NOT here — it moved to the
  // page menu with the other two rare state changes.
  if (game.source) {
    // A link built before the provider exposed a URL has none — it stays
    // unlinkable rather than rendering nothing at all.
    if (game.source.url) {
      // Short label, and deliberately NO aria-label over it (#817): a spelled-out
      // name above a visible „Auf BGG ansehen" would fail WCAG 2.2 SC 2.5.3,
      // which requires the accessible name to contain the visible text.
      moreBody.appendChild(h(`<a class="link-out" href="${esc(game.source.url)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-external-link" aria-hidden="true"></i> ${esc(t('detail.viewSource', { provider: providerLabelShort(game.source.provider) }))}</a>`));
    }
  } else {
    const link = h(`<button class="link-out link-out--btn"><i class="ti ti-link" aria-hidden="true"></i> ${esc(t('detail.linkProvider'))}</button>`);
    link.addEventListener('click', () => showLinkProvider(round, game));
    moreBody.appendChild(link);
  }

  // The provider metadata's two anchors, filled now and again after the
  // detail-open backfill answers: a BGG-linked game missing a field asks the
  // server, which fills the store best-effort and answers whatever it holds (the
  // TTL gate is server-side, so a game BGG has no data for costs one cheap local
  // request per open, never an upstream one).
  {
    // The reference rows sit ABOVE the provider link inside the disclosure, so
    // the re-render must not append past it — hence a held anchor rather than
    // `moreBody.appendChild`.
    const restAnchor = h('<div></div>');
    moreBody.prepend(restAnchor);
    let restNode = restAnchor;
    let factsNode = factsAnchor;
    const swap = (holder, next) => {
      if (!next) return holder;
      holder.replaceWith(next);
      return next;
    };
    // The disclosure is attached only once it has something in it. A game linked
    // to a provider that exposes no URL and carrying no metadata would otherwise
    // show an empty „Mehr zum Spiel" that opens onto nothing — and the check has
    // to run again after the backfill answers, because for a freshly imported
    // game the metadata IS what fills it. Idempotent: `isConnected` is what keeps
    // a second answer from re-appending it below the facts.
    //
    // `.gd-more__body` always holds the rest-anchor placeholder, so counting its
    // children would be vacuously true; the query asks for real content instead.
    const ensureMore = () => {
      if (more.isConnected) return;
      if (moreBody.querySelector('.link-out, .game-info__body')) factsHost.appendChild(more);
    };
    const renderInfo = () => {
      factsNode = swap(factsNode, gameGlanceFacts(game));
      restNode = swap(restNode, gameInfoRest(game));
      ensureMore();
    };
    renderInfo();
    if (wantsGameInfo(game)) {
      api('GET', `/api/rounds/${rid}/games/${gameId}/provider-info`)
        .then((info) => {
          mergeGameInfo(game, info);
          renderInfo();
        })
        .catch(() => {}); // best-effort enrichment; the page stands without it
    }
  }


  if (ocean) {
    leftPage.append(coverCol, factsHost);
    story.appendChild(card);
  } else {
    leftPage.appendChild(card);
  }

  // Sparse game (#256): one inviting panel that says why the page is bare and
  // offers the steps that fill it, instead of scattering half-empty widgets.
  // The actions reuse the very same popovers the chips/cover would have opened,
  // so this is a different presentation of existing affordances, not new API.
  if (sparse) {
    const onboard = h(`<div class="gd-onboard">
         <div class="gd-onboard__head">
           <i class="ti ti-sparkles gd-onboard__icon" aria-hidden="true"></i>
           <div>
             <h2>${esc(t('detail.onboard.title'))}</h2>
             <p class="muted">${esc(t(game.wish ? 'detail.onboard.wishText' : 'detail.onboard.text'))}</p>
           </div>
         </div>
         <div class="gd-onboard__acts"></div>
       </div>`);
    const acts = onboard.querySelector('.gd-onboard__acts');
    [
      // The cover popover anchors on the hero itself (that's what it edits);
      // the other two anchor on their own button, which is where the eye is.
      // Cover and tags are always missing here (that's part of `sparse`), but
      // players can already be set — don't offer to fill in what's filled in.
      ['ti-photo', t('detail.onboard.cover'), () => editImage(imgEl)],
      ['ti-tags', t('detail.onboard.tags'), editTags],
      ...(hasPl ? [] : [['ti-users', t('detail.onboard.players'), editPlayers]]),
    ].forEach(([icon, label, onClick]) => {
      const b = h(`<button class="btn gd-onboard__act"><i class="ti ${icon}" aria-hidden="true"></i> ${esc(label)}</button>`);
      b.addEventListener('click', () => onClick(b));
      acts.appendChild(b);
    });
    (story || leftPage).appendChild(onboard);
  }

  // --- Right page: what it cost, how it went, and the one action -----------

  // What it costs right now (#679) — the one question that turns a wish into a
  // purchase, so it leads the right page rather than sitting at the foot of it.
  //
  // Only a wish, and only one carrying a provider link: the round already owns
  // everything on the shelf, and a hand-typed wish has no id to ask about (a
  // title search would quote a price for the wrong edition, which is worse than
  // no price at all).
  //
  // An empty anchor holds the slot rather than a heading with a spinner in it:
  // the whole feature is off by default, so on most instances this resolves to
  // "nothing", and a heading that appears and then vanishes is worse than one
  // that never appeared. Every failure — the route 404ing because PRICES_ENABLED
  // is unset, the aggregator being down, nobody stocking the game — lands in the
  // same place: the anchor is dropped and the page is exactly what it was.
  if (game.wish && game.source && game.source.externalId) {
    const priceAnchor = h('<div></div>');
    tale.appendChild(priceAnchor);
    // Stale-while-revalidate (#707): two requests race. `stored=1` answers from
    // the last-known-price store instantly; the full request may block on the
    // upstream for seconds (every in-memory cache miss — hourly, and after each
    // deploy). The stored answer is rendered only while the live one is still in
    // flight, and the live answer always wins — on a cache hit it settles just
    // as fast, so the transient stored render naturally never appears.
    const q = `lang=${encodeURIComponent(getLocale())}`;
    let node = priceAnchor;
    const swap = (next) => { node.replaceWith(next); node = next; };
    let liveSettled = false;
    let stored = null;
    api('GET', `/api/rounds/${rid}/games/${gameId}/prices?${q}&stored=1`)
      .then((p) => {
        if (liveSettled || !p || !p.available) return;
        stored = p;
        swap(renderPriceSection(p, { refreshing: true }));
      })
      .catch(() => {}); // the fast path failing must cost nothing
    api('GET', `/api/rounds/${rid}/games/${gameId}/prices?${q}`)
      .then((p) => {
        liveSettled = true;
        if (p && p.available) return swap(renderPriceSection(p));
        // A settled "nobody stocks this" is stated, not blanked — also when no
        // stored price was on screen first (operator decision on #707). Any
        // other unavailable answer has nothing honest to show.
        if (p && p.reason === 'no_offers') return swap(renderPriceNoOffers());
        node.remove();
      })
      .catch(() => {
        liveSettled = true;
        // Our own server became unreachable mid-view. A stored price already on
        // screen stays — re-rendered without the "checking…" note, which would
        // otherwise claim a check that is no longer running.
        if (stored) swap(renderPriceSection(stored));
        else node.remove();
      });
  }

  // Related sessions (`related` is computed near the top — `sparse` needs it).
  // On a sparse page the section is omitted entirely: the onboarding panel
  // already explains that ratings and sessions appear once the game is played,
  // so a heading over one line of muted text only adds to the emptiness.
  // A wish omits it too (#699), same reasoning as the score badge above.
  const sec = h(`<div class="section gd-history"><h2>${esc(t('detail.relatedTitle'))}</h2></div>`);
  if (related.length === 0) {
    sec.appendChild(h(`<div class="muted">${esc(t('detail.relatedEmpty'))}</div>`));
  } else {
    // A Stempelkarte, not a list (#1040). The exception to
    // `.claude/rules/tiles-vs-lists.md` is written up there: the rule's argument
    // for keeping this a list was ordering, and a row-major strip keeps it.
    //
    // `fmtDate`, not `fmtDateTime` as the row used: at 22px display type
    // "1. Juni 2026, 19:00" is ~230px against a 150px stamp, and the minute an
    // evening started is not what a stamp records. The full timestamp is on the
    // results screen the stamp links to.
    // Der Tisch draws it as a dated LIST (T3.4, T6.3) — one row per session,
    // the winner's counter, the date, who won — so it is a real <ul>. Same
    // rows, same order, same links as the stamps; only the presentation forks.
    const list = h(listy ? '<ul class="gd-plays"></ul>' : '<div class="stamps"></div>');
    related.slice(0, 15).forEach((s) => {
      const sst = gameStatsForSession(round, s, gameId);
      const picked = s.chosenGameId === gameId;
      let status;
      let winner = '';
      let winners = [];
      if (picked) {
        // Session people, not round members, so a guest winner still resolves
        // (marked as a guest) rather than vanishing from the line (#458).
        const sPeople = sessionPeople(round, s);
        winners = (s.winnerIds || []).map((wid) => sPeople.find((p) => p.id === wid)).filter(Boolean);
        const names = winners.map(personLabel).filter(Boolean);
        status = s.finished
          ? (endingText(s) || `<i class="ti ti-circle-check" aria-hidden="true"></i> ${esc(t('detail.played'))}`)
          : esc(t('detail.chosen'));
        if (s.finished && names.length) {
          winner = `<div class="stamp__win"><i class="ti ti-trophy" aria-hidden="true"></i> ${names.map(esc).join(', ')}</div>`;
        }
      } else if (sessionOutcome(s) === 'cancelled') {
        status = esc(t('detail.sessionCancelled'));
      } else if (sessionOutcome(s) === 'split') {
        // A split parent never chose a game (#796), so the plain "not chosen"
        // below would be true and useless: this game was voted on and the
        // evening moved to its tables, which each have their own stamp here.
        status = esc(t('detail.sessionSplit'));
      } else {
        status = esc(t('detail.notChosen'));
      }
      // No rating, no pill — not the empty „–" variant the Regal card and the
      // game's own badge use. Those two answer „what does this game score?",
      // where „nothing yet" is the answer; a stamp asks what happened on ONE
      // evening, and an evening nobody rated simply has no number to print. The
      // absent pill says that more quietly than a dash does, and at 150px the
      // quiet version is the one that fits (operator decision, 2026-09-12,
      // overriding this issue's own acceptance criterion).
      const scoreCell =
        sst.avg !== null
          ? `<span class="score-pill" style="--sc:${scoreColor(sst.score)}" data-stop="${scoreStop(sst.score)}">${fmtAvg(displayScore(sst.score))}</span>`
          : '';
      // The ink is how the evening went for this game. Usually that is the
      // score it earned there — but a game the round CHOSE and played without
      // rating is not a blank: being put on the table is revealed preference,
      // which is why `vote-score.js` lifts a game's shelf score by its plays at
      // all. So it is stamped in the ink of a strong evening.
      //
      // NOT the top of the ramp, and it prints no pill: a game can win the draw
      // for fitting the player count, so „chosen" is weaker than „everyone gave
      // it a 5". Read off avgColor() rather than written as a hex, so a retune
      // of the ramp carries this with it (.claude/rules/theme-derived-colors.md).
      const PLAYED_UNRATED = 4.5;
      if (listy) {
        const row = tischPlayRow(round, s, { picked, status, winners: s.finished ? winners : [], scoreCell });
        navLink(row.querySelector('a'), resultsPath(round.id, s.id), () => showResults(round, s));
        list.appendChild(row);
        return;
      }
      // An evening this game was NOT taken to has nothing to say about it and
      // borrows no colour: `--sc` falls through to the stylesheet's `--ink-soft`.
      const ink = picked
        ? `--sc:${scoreColor(sst.avg !== null ? sst.score : PLAYED_UNRATED)};`
        : '';
      // The pill rides the LAST text line, not the date's. A date is one
      // unbreakable token — „01.06.2026" measures 125px at 22px display type,
      // against a 130px content box at the 150px grid minimum — so a pill lane
      // beside it does not fit in any locale, and the token cannot wrap out of
      // the way. Measured in WebKit at both breakpoints; see the CSS.
      const row = h(`<a class="stamp${picked ? '' : ' stamp--muted'}"${ink ? ` style="${ink}"` : ''}>
           <div class="stamp__date">${esc(fmtDate(s.createdAt))}</div>
           <div class="stamp__foot">
             <div class="stamp__lines">
               <div class="stamp__status">${status}</div>
               ${winner}
             </div>
             ${scoreCell}
           </div>
         </a>`);
      navLink(row, resultsPath(round.id, s.id), () => showResults(round, s));
      list.appendChild(row);
    });
    sec.appendChild(list);
  }
  // Under Der Tisch the band of raters leads and the history follows (T3.4,
  // T6.3), so it is appended after the raters block below instead of here.
  if (!sparse && !game.wish && !listy) rightPage.appendChild(sec);
  /* „Wer wie gewertet hat" (#1190, T3.4/T6.3) — who is behind the number the
     left page prints, as one tile per person: their avatar, the mood their
     average rounds to, and that average.

     It is built from `gameRaters`, which walks exactly the votes the game's own
     score walks, so the row and the figure above it cannot tell different
     stories — the „warum steht da 3,9" problem #894 put evidence on the shelf
     card for, answered here in full.

     The FACES ARE THE APP'S FIVE, through `ratingFace` (rating-faces.js), not a
     set of this design's own: a mood is an app concept, and a second list would
     be the third copy that file's header warns about. Same reason the tile shows
     `fmtAvg` rather than a hand-rolled decimal.

     Gated exactly like „Gespielt in" below it — not on a sparse page and not on
     a wish (the round cannot have rated a game it does not own) — plus the
     obvious one: with nobody having rated it, a heading over an empty strip is
     the emptiness this screen was rebuilt to avoid. That is not the same
     condition as `related.length`, which is why it is asked separately: a
     session can draw a game that nobody then rated. */
  const raters = !sparse && !game.wish ? gameRaters(round, gameId) : [];
  if (raters.length) {
    const votesSec = h(`<div class="section gd-raters"><h2>${esc(t('detail.ratersTitle'))}</h2></div>`);
    const strip = h('<div class="raters"></div>');
    raters.forEach(({ person, avg, n, face }) => {
      // `personColor`, never `memberColor`: a guest has no member row, and the
      // unguarded call silently paints them in member #0's colour
      // (.claude/rules/session-guests-are-not-members.md §1).
      const who = personLabel(person);
      // The count rides the tile's `title` rather than taking a line of its own:
      // it is the footnote to the average, and most people will have rated a
      // game once, where "aus 1 Wertung" is noise on every tile.
      const evidence = tn(n, 'score.evidenceOne', 'score.evidence', { n });
      // `avatarFace` with no opts, i.e. initials rather than a profile picture:
      // sessionPeople() carries no `userId`, and the avatar cache answers only
      // for ids that were primed — so passing one here would need primeAvatars()
      // for this screen as well, which is a request per page load for a 34px
      // disc. The session voter strip shows initials for the same reason.
      // The disc is aria-hidden because `.rater__who` states the name in text.
      const tile = h(`<div class="rater" title="${esc(`${who} · ${evidence}`)}">
           <span class="avatar${person.guest ? ' avatar--guest' : ''}" style="background:${personColor(round, person)}" aria-hidden="true">${avatarFace(initials(person.name), {})}</span>
           <i class="ti ${ratingFace(face)} rater__face" aria-hidden="true"></i>
           <span class="rater__n" data-stop="${rampStop(avg)}">${esc(fmtAvg(avg))}</span>
           <span class="rater__who">${esc(who)}</span>
         </div>`);
      strip.appendChild(tile);
    });
    votesSec.appendChild(strip);
    tale.appendChild(votesSec);
  }
  if (!sparse && !game.wish && listy) tale.appendChild(sec);


  // The one action, alone in a bar at the foot of the right page (#1039). It
  // used to be the first of three equally-weighted full-width buttons — 167px of
  // phone viewport for „Jetzt spielen", „Aussortieren" and „Durchgespielt", of
  // which one is what anybody came for.
  //
  // A game is Active, Retired, Completed (#250) or Wished-for (#560), and the
  // repo enforces that those four are mutually exclusive — so the branches are
  // too: a game that is off the shelf offers only the way onto it.
  const bar = h('<div class="gd-bar"></div>');
  // Move the game onto the shelf, out of whichever state it is in. `opts` exists
  // for the wish list alone (see its branch below); the two archives take the
  // defaults.
  const restoreFrom = (kind, endpoint, body, opts = {}) => {
    const icon = opts.icon || 'ti-arrow-back-up';
    const label = opts.label || t('detail.restore');
    const restore = h(`<button class="btn btn--lg"><i class="ti ${icon}" aria-hidden="true"></i> ${esc(label)}</button>`);
    restore.addEventListener('click', async () => {
      try {
        await api('POST', `/api/rounds/${rid}/games/${gameId}/${endpoint}`, body);
        toast(t(`${kind}.restored`, { title: game.title }));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
    bar.appendChild(restore);
  };
  if (game.retired) {
    restoreFrom('retired', 'retire', { retired: false });
  } else if (game.completed) {
    restoreFrom('completed', 'complete', { completed: false });
  } else if (game.wish) {
    // „Ins Regal" with the Regal's own icon, never „Wiederherstellen": the game
    // is arriving on the shelf for the first time, so "restore" would claim it
    // is going back somewhere it has never been. Same reasoning — and the same
    // two values — as ARCHIVES.wish.restoreIcon in views-archive.js.
    //
    // This branch is what keeps the active `else` below off a wished-for game.
    // Without it a wish was offered „Direkt spielen", which the server refuses
    // with a 400 `Game is on the wishlist` (the shared isActiveGame predicate,
    // active-games-filter-sites.md) — so the user got a seat picker, a start
    // button and an English server error.
    restoreFrom('wish', 'wish', { wish: false }, { icon: 'ti-cards', label: t('wish.restore') });
  } else {
    // Direct launch: skip the vote and play this game right away.
    const play = h(`<button class="btn btn--primary btn--lg"><i class="ti ti-player-play" aria-hidden="true"></i> ${esc(t('directPlay.button'))}</button>`);
    play.addEventListener('click', () => startDirectSession(round, game));
    bar.appendChild(play);
  }
  // Ocean: the one action right under the title (O6.3), not at a page's foot.
  if (ocean) card.after(bar);
  else rightPage.appendChild(bar);

  app.appendChild(pass);

  // =================== The page menu (#1039) ===================
  //
  // The three rare things this screen can do, out of the action row and into a
  // „…" at the top right of the back row: two state flips that are the opposite
  // of playing, and one that undoes an import. They do not belong beside the
  // play button (operator decision), and each keeps its existing confirm sheet
  // verbatim.
  const menuItems = [];
  if (!game.retired && !game.completed && !game.wish) {
    menuItems.push({ icon: 'ti-circle-check', label: t('detail.complete'), cls: 'popover__opt--good', kind: 'undoable', run: async () => {
      if (!await confirmDialog({
        body: t('detail.completeConfirm', { title: game.title }),
        confirmLabel: t('detail.complete'), icon: 'ti-circle-check', danger: false,
      })) return;
      try {
        await api('POST', `/api/rounds/${rid}/games/${gameId}/complete`, { completed: true });
        toast(t('games.completed', { title: game.title }));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    } });
    // Reversible („jederzeit zurückholen"), so neither filed nor asked as a
    // deletion: no bin, no warn tone, `undoable`, a neutral confirm (#1360).
    // Pushed AFTER completion, which keeps the menu's order unchanged now that
    // both share a kind and sortMenuItems falls back to write order.
    menuItems.push({ icon: 'ti-archive', label: t('detail.retire'), kind: 'undoable', run: async () => {
      if (!await confirmDialog({
        body: t('detail.retireConfirm', { title: game.title }),
        confirmLabel: t('detail.retire'), icon: 'ti-archive', danger: false,
      })) return;
      try {
        await api('POST', `/api/rounds/${rid}/games/${gameId}/retire`, { retired: true });
        toast(t('games.retired', { title: game.title }), { tone: 'success' });
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    } });
  }
  if (game.source) {
    const provider = providerLabel(game.source.provider);
    menuItems.push({ icon: 'ti-unlink', label: t('detail.unlinkProvider'), cls: 'popover__opt--muted', kind: 'destructive', run: async () => {
      // Only a hotlinked provider cover is dropped with the link; the member's
      // own upload is kept, so the two wordings must not be swapped.
      const ownUpload = typeof game.image === 'string' && game.image.startsWith('/uploads/');
      const key = game.image && !ownUpload ? 'detail.unlinkConfirmCover' : 'detail.unlinkConfirm';
      if (!await confirmDialog({
        body: t(key, { provider }),
        confirmLabel: t('detail.unlinkProvider'), icon: 'ti-unlink',
      })) return;
      try {
        await api('PATCH', `/api/rounds/${rid}/games/${gameId}`, { removeSource: true });
        toast(t('detail.toast.unlinked'));
        showGameDetail(rid, gameId);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    } });
  }
  // Der Tisch shows the same list as an „Aktionen" panel above the bar (T3.4;
  // a 2×2 grid on the phone, T6.3) — and then drops „…": every item is already
  // a button on the screen, and T15b does not repeat those in the menu.
  if (menuItems.length && listy) {
    const panel = h(`<div class="section gd-actions"><h2>${esc(t('detail.actionsTitle'))}</h2><div class="gd-actions__grid"></div></div>`);
    panel.querySelector('.gd-actions__grid')
      .append(...menuItemButtons(menuItems, () => {}, { base: 'btn btn--sm gd-act', tone: false }));
    if (ocean) rightPage.appendChild(panel);
    else rightPage.insertBefore(panel, bar);
  } else if (menuItems.length) {
    back.classList.add('back-row--split');
    const menuBtn = h(`<button type="button" class="btn btn--sm gd-menu" aria-label="${esc(t('detail.moreActions'))}" aria-expanded="false"><i class="ti ti-dots" aria-hidden="true"></i></button>`);
    // Buttons only, so this is a popover at EVERY width — the account menu's
    // case, not the editors' (.claude/rules/popover-vs-sheet-editors.md §2b).
    // `aria-expanded` is synced through openPopover's onClose rather than by
    // wrapping `close`: the wrapped form misses four of the six exits (Escape,
    // a backdrop tap, Back, the page scroll that tears a popover down) and
    // leaves the trigger claiming a panel that is gone.
    menuBtn.addEventListener('click', () => {
      openPopover(menuBtn, (el, close) => fillMenu(el, menuItems, close),
        () => menuBtn.setAttribute('aria-expanded', 'false'));
      menuBtn.setAttribute('aria-expanded', 'true');
    });
    back.appendChild(menuBtn);
  }
}
