/* Spielwirbel – the round hub's three PREVIEWS and its „Nicht im Regal" group
   (#1185).

   This is the structure every design skins (docs/design/handover-claude-design-2026-09-19.md
   §2): the Start tab is the launchpad PLUS a preview of each sub-page it owns —
   Regal, Pokale, Chronik — and the four off-shelf entry points under one
   heading. Built here in today's Klassisch look on purpose: structure first in
   the familiar look, skin later, so Der Tisch lands on a hub real use has
   already shaken out.

   Split out of views-round-start.js rather than added to it: that file is the
   LAUNCHPAD (identity, the one CTA, the tickets, the derived cards), and a
   preview of another screen is independently editable from all of it — the seam
   test in `.claude/rules/token-friendly-source-files.md`. It was also 685 lines
   against a 700 budget, so the split was due either way.

   EVERY PREVIEW RENDERS NOTHING WHEN IT HAS NOTHING TO SAY — the same
   load-bearing rule views-round-start.js's header states for the card grid. A
   brand-new round must meet the screen it met before, not three empty boxes.
   The off-shelf group is the deliberate exception: it is NAVIGATION, not
   content, so its four rows are offered at a count of zero exactly as at
   twelve. A screen you cannot reach because it happens to be empty is the #682
   failure one surface over.

   NOTHING HERE FETCHES. Every number is derived from the round payload the hub
   already holds, so the previews cost no request and cannot lag the page they
   preview.

   Part of the frontend; all files share one global script scope. Loaded between
   views-round.js and views-round-start.js. */

'use strict';

// At most this many covers in the Regal strip. Six fills the card's width at
// every width the hub is laid out at; more would wrap into a second row and
// turn a preview into a grid.
const HUB_PREVIEW_COVERS = 6;
// And at most this many standings rows — the podium's three steps, which is
// what the preview is a preview OF.
const HUB_PREVIEW_RANKS = 3;
// And at most this many sessions in Ocean's Chronik preview (O3.2's three).
const HUB_PREVIEW_SESSIONS = 3;

/* WHAT EARNS A PREVIEW IS PER SECTION, not one condition for all three.

   Pokale and Chronik have nothing to show before the round's first played
   session, and say so by returning null from their own renderers.

   The Regal is different and was briefly gated on the same condition, which was
   wrong in the case that matters most: a round that has just imported two
   hundred games from BGG and not yet played has the fullest shelf in the app and
   would have been shown no shelf preview at all (operator, 2026-09-22).

   So the Regal's own question is whether the strip TELLS the reader anything.
   The hero already states the count, so a card whose six tiles are the whole
   shelf restates what is two lines above it — a preview of everything is not a
   preview. Once the shelf outgrows the strip, "six of twenty-three" is real
   information, and the card earns its place.

   The threshold is therefore the strip's own size rather than a number somebody
   picked: change HUB_PREVIEW_COVERS and this moves with it, because it is the
   same fact. */
const hubShelfWorthPreviewing = (activeGames) => activeGames.length > HUB_PREVIEW_COVERS;

/* One preview card: a titled section whose only control is the „öffnen" link
   at its foot.

   ONE LINK PER CARD, deliberately. The natural shape is to wrap the whole card
   in an <a> and let the covers and rows inside it be links too, which nests
   interactive content — so a screen reader reads the card as one enormous link
   whose name is its entire contents, and a keyboard user tabs through a preview
   they cannot act on. The rows below are therefore plain spans. */
function hubPreviewCard(round, { icon, titleKey, sub, tab }) {
  const card = h(`<section class="hub-card hub-preview">
       <h2 class="hub-card__title">${iconText(icon, t(titleKey))}</h2>
       <div class="hub-card__body"></div>
       <a class="hub-preview__open">${esc(t('hub.preview.open'))}<i class="ti ti-chevron-right" aria-hidden="true"></i></a>
     </section>`);
  if (sub) {
    card.querySelector('.hub-card__body')
      .appendChild(h(`<div class="hub-preview__sub">${esc(sub)}</div>`));
  }
  // A real <a href> (#330) so ⌘/middle-click opens the sub-page in a new tab,
  // and an accessible name that says WHICH page — „öffnen" four times over is
  // the classic link-list failure.
  const open = card.querySelector('.hub-preview__open');
  open.setAttribute('aria-label', t('hub.preview.openNamed', { title: t(titleKey) }));
  navLink(open, roundPath(round.id, tab), () => showRound(round.id, tab));
  return card;
}

/* a) Regal — a handful of covers and the count.

   Covers come from the ACTIVE games only, which is what the Regal tab itself
   shows: previewing a shelf with a retired game's cover on it would be a
   preview of a different screen. Newest first, so adding a game visibly
   changes the card. */
function hubRegalPreview(round, activeGames) {
  if (!hubShelfWorthPreviewing(activeGames)) return null;
  const card = hubPreviewCard(round, {
    icon: 'ti-cards',
    titleKey: 'hub.tab.regal',
    sub: tn(activeGames.length, 'home.chip.gamesOne', 'home.chip.games'),
    tab: 'regal',
  });
  const strip = h('<div class="hub-preview__covers" aria-hidden="true"></div>');
  // aria-hidden: the covers are decoration for a card whose count already says
  // what is here, and each tile's only text would be a title the preview is not
  // offering to open.
  [...activeGames]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, HUB_PREVIEW_COVERS)
    .forEach((game) => {
      const style = game.image
        ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"`
        : '';
      strip.appendChild(h(`<span class="hub-preview__cover"${style}>${game.image ? '' : coverPlaceholder(game)}</span>`));
    });
  card.querySelector('.hub-card__body').appendChild(strip);
  return card;
}

/* b) Pokale — the top of the standings.

   Through roundStandings() (views-pokale.js), never a second derivation: the
   preview and the page it previews must agree about who is leading, and two
   independent rankings over the same sessions is the drift
   `.claude/rules/shared-constants-across-the-stack.md` is about. Nothing goes
   red when they disagree; the preview simply contradicts the page one tap away.

   `winners` is already sorted and already tie-aware, so the slice below is the
   top three ENTRIES rather than the top three PLACES — two members tied for
   first take two of them. That is what the podium shows too. */
function hubPokalePreview(round) {
  const { winners, rankOf, wins } = roundStandings(round);
  if (!winners.length) return null;
  /* Der Tisch's phone tile shows one line under the title (T2.2 „Jonas führt"),
     where the other two previews show their count. Derived from the same
     `rankOf`, so a shared first place says so instead of naming one of them. */
  let sub = null;
  /* Below YOUNG_ROUND_PODIUM_FROM (T7.5, #1280; every design since #1318) the
     preview names the leader and says when the podium comes, instead of
     ranking three places off one or two evenings — the Pokale tab's own gate,
     so preview and page agree. */
  const young = youngRoundPlayed(round, hubDeps()) < YOUNG_ROUND_PODIUM_FROM;
  if (designIs('tisch')) {
    const leaders = winners.filter((m) => rankOf[m.id] === 1);
    sub = leaders.length === 1
      ? t('hub.preview.pokaleLead', { name: leaders[0].name })
      : t('hub.preview.pokaleLeadTie', { n: leaders.length });
  }
  const card = hubPreviewCard(round, { icon: 'ti-trophy', titleKey: 'hub.tab.pokale', sub, tab: 'pokale' });
  const body = card.querySelector('.hub-card__body');
  /* Ocean draws each standing as a bar in the member's colour (O3.2): the
     person colour as a FILL, never as text (ocean.css's rule 2). Its length is
     data, so it rides in as `--share` — the bar is aria-hidden, the count
     beside it already says it. */
  const bars = designIs('ocean');
  const top = Math.max(1, ...winners.map((m) => wins[m.id] || 0));
  winners.filter((m) => !young || rankOf[m.id] === 1).slice(0, HUB_PREVIEW_RANKS).forEach((m) => {
    const bar = bars
      ? `<span class="hub-preview__bar" aria-hidden="true" style="--share:${Math.round(((wins[m.id] || 0) / top) * 100)}%;--tone:${memberColor(round, m.id)}"></span>`
      : '';
    body.appendChild(h(`<div class="hub-preview__rank">
         <span class="hub-preview__place">${rankOf[m.id]}</span>
         <span class="avatar hub-preview__avatar" style="background:${memberColor(round, m.id)}">${avatarFace(initials(m.name), { userId: m.userId })}</span>
         <span class="hub-preview__name">${esc(m.name)}</span>${bar}
         <span class="hub-preview__score">${esc(tn(wins[m.id], 'pokale.winsOne', 'pokale.wins'))}</span>
       </div>`));
  });
  // `hub-preview__last`'s type, so the phone tile shows it as its second line.
  if (young) {
    body.appendChild(h(`<div class="hub-preview__last hub-preview__threshold">${esc(tn(YOUNG_ROUND_PODIUM_FROM, 'pokale.young.podiumOne', 'pokale.young.podium'))}</div>`));
  }
  // Abzeichen (#1388): „2 neue Abzeichen seit Nordlichter" or the newest mark.
  const badges = hubBadgeLine(round);
  if (badges) body.appendChild(badges);
  return card;
}

/* c) Chronik — how many evenings, and when the last one was.

   Counted on FINISHED sessions and dated by `createdAt` — when the evening was
   played — for the reason views-round-start.js's last-played ticket states:
   `finishedAt` moves when an old session is re-finished, and the Chronik orders
   by the same field, so anything else makes the preview disagree with the list
   it previews. */
function hubChronikPreview(round) {
  const finished = round.sessions.filter((s) => s.finished);
  if (!finished.length) return null;
  const last = finished
    .map((s) => s.createdAt)
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0];
  const card = hubPreviewCard(round, {
    icon: 'ti-history',
    titleKey: 'hub.tab.chronik',
    sub: tn(finished.length, 'home.chip.sessionsOne', 'home.chip.sessions'),
    tab: 'chronik',
  });
  /* Ocean previews the Chronik with its last sessions (O3.2, #1211 — review
     round 1 found the bars here, under this title, which renamed the
     Rundenpuls). Plain spans, like every row inside a preview: the card's one
     link is its „öffnen" at the foot. Newest first by `createdAt`, the order
     the Chronik lists them in. */
  if (designIs('ocean')) {
    const body = card.querySelector('.hub-card__body');
    [...finished]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, HUB_PREVIEW_SESSIONS)
      .forEach((s) => {
        const game = round.games.find((g) => g.id === s.chosenGameId);
        const style = game && game.image ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
        body.appendChild(h(`<div class="hub-preview__session">
             <span class="hub-preview__cover" aria-hidden="true"${style}>${game && !game.image ? coverPlaceholder(game) : ''}</span>
             <span class="hub-preview__name">${esc(game ? game.title : t('sessions.played'))}</span>
             <span class="hub-preview__when">${esc(fmtDate(s.createdAt))}</span>
           </div>`));
      });
    return card;
  }
  if (last) {
    card.querySelector('.hub-card__body')
      .appendChild(h(`<div class="hub-preview__last">${esc(t('hub.preview.chronikLast', { date: fmtDate(last) }))}</div>`));
  }
  return card;
}

/* The off-shelf group: ONE heading over the four destinations.

   The V1 Tisch sheet (T3.2) showed the mistake to avoid — a fifth „Nicht im
   Regal" row carrying its own count, sitting inside the group of the same name.
   The heading is the group; the rows are the places.

   Rows come from off-shelf.js, so this group, the Regal's sheet and the rail
   offer the same four with the same counts by construction. */
function hubOffShelfGroup(round) {
  if (designIs('tisch')) return hubOffShelfTiles(round);
  // `rail-owned`, exactly like the hero, the CTA and the Einstellungen entry:
  // from 1280px up the rail carries these four rows, and a second copy in the
  // pane would offer the same navigation twice on one screen. Below that width
  // the rail does not exist and this IS the hub's off-shelf group.
  // Not under a lean rail (railIsLean, round-rail.js): Ocean's Reling carries
  // no off-shelf rows (#1211), so there this group is the hub's only way in.
  const group = h(`<section class="hub-offshelf${railIsLean() ? '' : ' rail-owned'}">
       <h2 class="hub-offshelf__title">${esc(t('rail.archive'))}</h2>
       <div class="ds-list hub-offshelf__list"></div>
     </section>`);
  const list = group.querySelector('.hub-offshelf__list');
  offShelfEntries(round).forEach(({ icon, label, sub, go }) => {
    // `class` FIRST, like every other .ds-row site — test/ds-row-affordance.test.js
    // matches on `<a\s+class="ds-row…"`, so an attribute in front of it makes the
    // row invisible to that guard rather than failing it.
    /* `off-shelf__row`, the SAME class the Regal's sheet uses, not a parallel
       `hub-offshelf__row`. These are one component in two hosts: the class
       carries the icon-beside-label flex rule (.ds-row__main is `display: block`
       by default, because the Chronik rows stack a date over a status), and a
       parallel class silently misses it — measured in a browser, where the icon
       sat flush against the label. jsdom applies no external stylesheet, so no
       spec here could have seen it. */
    const row = h(`<a class="ds-row off-shelf__row">
         <span class="ds-row__main"><i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span></span>
         <span class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></span>
       </a>`);
    navLink(row, roundPath(round.id, sub), go);
    list.appendChild(row);
  });
  return group;
}

/* Der Tisch's „Nicht im Regal" (T2.2, T3.2; #1262/#1263): the same four
   destinations as COUNT TILES — a 2×2 grid on a phone, one row of four at the
   foot of the desktop hub. Same rows, same counts, same order as every other
   presentation, because they come from the same offShelfEntries().

   NOT `rail-owned`, unlike the Klassisch group: Der Tisch's rail is identity
   plus the five links (#1262), so from 1280 up these tiles are the hub's only
   way into the four lists.

   The count is its own figure here, so the tile reads the count-free `name`
   and the accessible name is the Klassisch label („Aussortiert (2)") — one
   phrase to a screen reader rather than a word and a stray number.
   Recommendations carry no count, for the reason off-shelf.js states. */
function hubOffShelfTiles(round) {
  const group = h(`<section class="hub-offshelf hub-offshelf--tiles">
       <h2 class="hub-offshelf__title">${esc(t('rail.archive'))}</h2>
       <div class="hub-offshelf__tiles"></div>
     </section>`);
  const grid = group.querySelector('.hub-offshelf__tiles');
  offShelfEntries(round).forEach(({ icon, label, name, count, sub, go }) => {
    const tile = h(`<a class="offshelf-tile" aria-label="${esc(label)}">
         <i class="ti ${icon}" aria-hidden="true"></i>
         <span class="offshelf-tile__name">${esc(name)}</span>
         ${count === null ? '' : `<span class="offshelf-tile__n">${count}</span>`}
       </a>`);
    navLink(tile, roundPath(round.id, sub), go);
    grid.appendChild(tile);
  });
  return group;
}
