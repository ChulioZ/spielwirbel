/* Spielwirbel – instance-wide public statistics (issue #564).

   ONE renderer, three surfaces: the logged-out landing page, the standalone
   /entdecken screen, and the home hub's dashboard panel. They share this file
   rather than each building their own markup, because they publish the same
   payload and a drift between them would be a different claim about the
   instance on each screen.

   #842 made that sharing real for the third one. It used to be a teaser strip
   — icon, title, one subline, chevron — which said nothing about the instance
   and so had nothing to drift FROM; it now draws podium cards through the same
   statsCard() the other two use, a different SELECTION of one markup rather
   than a second copy of it.

   Everything here is driven by GET /api/stats/public, which answers 404 when the
   feature is off — so the DEFAULT on every surface is to render NOTHING AT ALL:
   no heading, no empty container, no skeleton. Nothing is inserted into the DOM
   until there is something to put in it, which is why none of this uses the
   landing page's `hidden`/reveal pattern (and needs no paired
   `[hidden] { display: none }` rule — .claude/rules/hidden-attribute-vs-display-rule.md).

   Every title and cover in the payload came from the PROVIDER, never from a
   user-typed game title (see lib/public-stats.js) — so nothing rendered here is
   user-authored text. It is still escaped like everything else: `esc` is not the
   guarantee, it is the habit.

   Part of the frontend's shared global scope. Loads after core.js (h/esc/t/app/
   coverUrl) and account.js, before router.js — see index.html. Cross-file names
   are referenced inside handlers or at call time, per
   .claude/rules/frontend-script-load-order.md. */

'use strict';

// The six podiums, in render order, each with the icon and the i18n key that
// phrases its value. Data rather than six near-identical branches, so adding a
// metric is a row here and a key pair in every lang file. `bar` names the
// count a design may draw the card's list as bars of (#1424, Das Programmheft's
// „Meistgespielt") — the four play cards, whose entries are comparable counts.
//
// Icons are declared in the bundled tabler subset — an UNDECLARED class renders
// nothing at all, silently (.claude/rules/tabler-icon-codepoints.md). All six
// are already used elsewhere in the app.
const STATS_PODIUMS = [
  { key: 'mostOwned', icon: 'ti-cards', line: (e) => tn(e.shelves, 'stats.shelves.one', 'stats.shelves.many') },
  { key: 'playedWeek', icon: 'ti-flame', bar: 'plays', line: (e) => tn(e.plays, 'stats.plays.one', 'stats.plays.many') },
  /* The month and the year NAME their period (#964), from `entry.period` rather
     than from the reader's clock. The counts are calendar-bounded on the
     server's Europe/Berlin calendar and cached for everyone, so a label built
     here from `new Date()` would drift from the window it describes the moment
     a reader is in another zone or the payload is a few minutes past midnight
     on the 1st — which is the whole class of bug this replaced. The week names
     none: nobody reads ISO week numbers. */
  { key: 'playedMonth', icon: 'ti-calendar', bar: 'plays', label: (e) => t('stats.playedMonth', { month: fmtMonthKey(e.period) }), line: (e) => tn(e.plays, 'stats.plays.one', 'stats.plays.many') },
  { key: 'playedYear', icon: 'ti-history', bar: 'plays', label: (e) => t('stats.playedYear', { year: e.period }), line: (e) => tn(e.plays, 'stats.plays.one', 'stats.plays.many') },
  /* All-time (#1035), after the three calendar cards so the ladder reads
     week → month → year → ever. It names no period and takes the static
     `t('stats.' + key)` path, like `mostOwned` and `playedWeek` — and its label
     deliberately names the PHENOMENON („Spielwirbels Dauerbrenner") rather than
     the measurement the other three state, because there is no window to name.
     The value line reuses the same plural pair unchanged. */
  { key: 'playedAll', icon: 'ti-crown', bar: 'plays', line: (e) => tn(e.plays, 'stats.plays.one', 'stats.plays.many') },
  /* The value is the SPIELWIRBEL-SCORE, not a raw mean (#914) — so the copy must
     not call it an average, and the card carries the ⓘ that explains it. This is
     the only surface where a LOGGED-OUT visitor meets the score, which is why
     the explainer matters more here than on a screen inside a round.

     `info` is a separate field rather than something `line` could return: the
     card escapes `line`'s output as text, and the button is markup.

     IT RIDES THE LABEL, NOT THE VALUE. Beside the number it looks more direct,
     and measured at 1100px it costs the whole grid 28px of card height: the
     value line is 186px of a 217px box, so the 28px button does not fit beside
     it and wraps — by ONE pixel in German, and further in Spanish, so the
     wrapping is locale-dependent rather than reliably absent. On the label
     („Am besten bewertet", 149px) there is 40px of headroom and the cards grow
     by 7px, which is just the control's own height. The label is also what the
     ⓘ is explaining, so it reads correctly there.

     The number goes through the locale formatter, not straight into the string:
     a raw JS number interpolates as "4.6", and German writes "4,6".

     THE PLAYS RIDE ALONG (#1329): they lift the score and count as evidence for
     this podium, so „1 Bewertung" alone would read as too thin to qualify. Two
     counts, two plurals — the rating line inflects on its own and is handed in
     whole as {rated}, the outer pair on the plays. No plays, no suffix: a game
     that qualified on ratings alone reads as it always did. */
  {
    key: 'bestRated',
    icon: 'ti-star',
    info: 'score',
    line: (e) => {
      const rated = tn(e.ratings, 'stats.ratedOne', 'stats.rated', { score: fmtAvg(e.score) });
      return e.plays > 0 ? tn(e.plays, 'stats.ratedPlaysOne', 'stats.ratedPlays', { rated }) : rated;
    },
  },
];

/* The three favourites (#1557): a NAME rather than a game, so they live under
   the payload's own `names` key and are drawn after the six game podiums. The
   entry is `{ name, score, games, list? }` — handed to statsCard as its title
   with no cover and no link, which is what the no-cover placeholder is for.
   `list` (#1560) is every game the average was computed from; when present,
   the count line becomes the button that opens it (openStatsGames).

   Ranked on the Spielwirbel-Score, so they carry the same ⓘ as `bestRated`.
   The names are BGG's own (in English, like the shelf profile shows them), so
   nothing here is translated or user-authored. */
const STATS_FAVOURITES = [
  { key: 'favDesigner', icon: 'ti-pencil' },
  { key: 'favCategory', icon: 'ti-tags' },
  { key: 'favMechanic', icon: 'ti-puzzle' },
].map((f) => ({
  ...f,
  info: 'score',
  games: true,
  line: (e) => tn(e.games, 'stats.favGamesOne', 'stats.favGames', { score: fmtAvg(e.score) }),
}));

/* A card's ranked entries (#1424). An ARRAY since #1424 — a single entry
   object before it — and both are read: the service worker can serve a client
   from before the deploy against the new payload or the reverse for a load, so
   neither side may assume the other's shape. */
const statsList = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

// Every card the payload can carry, in render order, each paired with the
// ranked entries it draws: game podiums first, then the favourites. One list,
// so the full block and the home panel's first few cannot order them
// differently.
function statsEntries(stats) {
  const games = stats.games || {};
  const names = stats.names || {};
  const asTitle = (n) => ({ title: n.name, image: null, url: null, ...n });
  return [
    ...STATS_PODIUMS.map((p) => [p, statsList(games[p.key])]),
    ...STATS_FAVOURITES.map((f) => [f, statsList(names[f.key]).map(asTitle)]),
  ].filter(([, list]) => list.length);
}

/* A list of cards with ONE ⓘ per topic: the favourites carry the score topic
   too, and four identical buttons on one grid would be noise — the first card
   that has it explains the number for every card after it. */
function statsCardsHtml(entries) {
  const explained = new Set();
  return entries.map(([p, list]) => {
    const withInfo = !!p.info && !explained.has(p.info);
    if (withInfo) explained.add(p.info);
    return statsCard(p, list, withInfo);
  }).join('');
}

// The scale counters, in render order: rounds first, then the people in them.
const STATS_COUNTERS = ['rounds', 'players', 'games', 'sessions'];

// One in-flight fetch for the whole page load, shared by every surface: the home
// hub can mount the teaser while /entdecken is a click away, and a logged-out
// visitor's landing page must not pay for the same payload twice. Null means
// "not asked yet"; the promise resolves to the payload or to null.
let publicStatsPromise = null;

function loadPublicStats() {
  if (!publicStatsPromise) {
    // Deliberately NOT api(): this endpoint is public, must work for a
    // logged-out visitor, and a 404 (feature off) is an ordinary answer here
    // rather than an error worth surfacing.
    publicStatsPromise = fetch('/api/stats/public')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return publicStatsPromise;
}

// Whether a payload has anything worth rendering. Both blocks are omitted
// entirely when every metric is below its threshold, so this is what keeps a
// switched-on-but-still-quiet instance from showing an empty section.
function publicStatsHasContent(stats) {
  return !!stats && (!!stats.counters || !!stats.games || !!stats.names);
}

// An entry's name: an outbound provider link when the payload carries one,
// plain text otherwise (a favourite's name, an unlinked game).
function statsTitle(entry, cls) {
  return entry.url
    ? `<a class="${cls}" href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer">${esc(entry.title)}</a>`
    : `<span class="${cls}">${esc(entry.title)}</span>`;
}

/* An entry's value line. For a favourite whose payload lists its games
   (#1560), the line is the button that opens them — the count is the obvious
   handle, and the list explains the average. It names the card and the rank
   rather than carrying the list, so the click handler reads the games from the
   payload it was rendered from (wireStatsGames). Without a list it stays the
   plain text it always was, which is also every podium's markup, unchanged. */
function statsValue(podium, e, cls, rank) {
  const text = esc(podium.line(e));
  if (!podium.games || !Array.isArray(e.list) || !e.list.length) {
    return `<span class="${cls} muted">${text}</span>`;
  }
  return `<button type="button" class="${cls} stats-card__games muted" data-stats-fav="${esc(podium.key)}" data-stats-rank="${rank}" aria-haspopup="dialog" aria-expanded="false">${text}</button>`;
}

/* The games behind one favourite name (#1560). Through openEditor, so it is an
   anchored popover from 860px and a sheet below it, with Escape, Back, the
   backdrop and focus restoration included (.claude/rules/popover-vs-sheet-editors.md).
   Read-only, like the badge card. Covers are decorative (the title beside
   each is the name); titles link out to the provider like every stats title. */
function openStatsGames(btn, fav, entry) {
  const title = t('stats.favListTitle', { label: t('stats.' + fav.key), name: entry.name });
  btn.setAttribute('aria-expanded', 'true');
  openEditor(btn, 'stats-games', title, (el) => {
    // Klassisch's popover is a bare <div> with no head; the designs that draw
    // the form-sheet popover (and every sheet) already carry a titled one.
    const bare = el.classList.contains('popover') && !el.querySelector('.popover__head');
    if (bare) {
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', title);
    }
    const rows = entry.list.map((g) => `
      <li class="stats-games__row">
        ${g.image
    ? `<img class="stats-games__cover" src="${esc(coverUrl(g.image, COVER_THUMB))}" alt="" loading="lazy" />`
    : '<span class="stats-games__cover stats-games__cover--none" aria-hidden="true"></span>'}
        <span class="stats-games__body">
          ${statsTitle(g, 'stats-games__name')}
          <span class="stats-games__score muted">${esc(t('stats.favListScore', { score: fmtAvg(g.score) }))}</span>
        </span>
      </li>`).join('');
    const body = h(`<div class="stats-games">
        ${bare ? `<h2 class="stats-games__title">${esc(title)}</h2>` : ''}
        <ol class="stats-games__list">${rows}</ol>
      </div>`);
    el.appendChild(body);
    const first = body.querySelector('a, button');
    // After the container is live — focus() on a detached node does nothing.
    return () => { if (first) first.focus(); };
  }, () => btn.setAttribute('aria-expanded', 'false'));
}

/* One delegated listener per mounted block, closing over the payload the block
   was rendered from, so the list a click opens is the one whose count it shows. */
function wireStatsGames(root, stats) {
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-stats-fav]');
    if (!btn || !root.contains(btn)) return;
    const fav = STATS_FAVOURITES.find((f) => f.key === btn.dataset.statsFav);
    const entry = fav && statsList(stats.names && stats.names[fav.key])[Number(btn.dataset.statsRank)];
    if (entry && Array.isArray(entry.list) && entry.list.length) openStatsGames(btn, fav, entry);
  });
}

/* One card: a metric and its ranked entries (#1424). The LEADER keeps the
   markup the card had when it held one winner — cover, label, title, value —
   so every design's rules for it still apply, and places 2–3 follow as compact
   rows in an <ol> carrying a visible rank. The leader's own rank is implied by
   its place, as it was before the list existed.

   The cover is sized at render time — a provider master can be several
   thousand pixels wide (.claude/rules/provider-cover-sizing.md) — and is
   decorative here: the title beside it is the accessible name, so alt is empty
   rather than a duplicate. Places 2–3 draw no cover: three thumbnails per card
   would make the grid a wall of art. */
function statsCard(podium, list, withInfo = !!podium.info) {
  const [entry, ...rest] = list;
  const label = `<span class="stats-card__label"><i class="ti ${podium.icon}" aria-hidden="true"></i>${esc(podium.label ? podium.label(entry) : t('stats.' + podium.key))}${withInfo ? ` ${infoButton(podium.info)}` : ''}</span>`;
  // A design owns its layout: Das Programmheft draws its „Meistgespielt" cards
  // as a bar list (P14.5), every other design keeps the card.
  if (podium.bar && designIs('programmheft')) return statsBarCard(podium, list, label);
  const cover = entry.image
    ? `<img class="stats-card__cover" src="${esc(coverUrl(entry.image, COVER_THUMB))}" alt="" loading="lazy" />`
    : '<span class="stats-card__cover stats-card__cover--none" aria-hidden="true"></span>';
  const more = rest.length
    ? `<ol class="stats-card__more" start="2">${rest.map((e, i) => `
        <li class="stats-card__row">
          <span class="stats-card__rank">${i + 2}</span>
          <span class="stats-card__row-body">
            ${statsTitle(e, 'stats-card__row-title')}
            ${statsValue(podium, e, 'stats-card__row-value', i + 1)}
          </span>
        </li>`).join('')}</ol>`
    : '';
  return `
    <li class="stats-card">
      ${cover}
      <span class="stats-card__body">
        ${label}
        ${statsTitle(entry, 'stats-card__title')}
        ${statsValue(podium, entry, 'stats-card__value', 0)}
      </span>${more}
    </li>`;
}

/* Das Programmheft's „Meistgespielt" (P14.5, #1416 → #1424): every entry —
   the leader included — as one row of rank, title, an ink bar and the count.
   The bar's length is the entry's share of the LEADER's count, so the leader's
   bar is always full and a list reads as a comparison, not as absolute
   magnitudes. `--stats-share` is written inline and is data only: a design
   reads it and never sets it (.claude/rules/inline-custom-properties-cannot-be-overridden.md). */
function statsBarCard(podium, list, label) {
  const top = list[0][podium.bar] || 1;
  const rows = list.map((e, i) => {
    const share = Math.round((e[podium.bar] / top) * 1000) / 1000;
    return `
      <li class="stats-card__bar-row" style="--stats-share: ${share}">
        <span class="stats-card__rank">${i + 1}</span>
        ${statsTitle(e, i === 0 ? 'stats-card__title stats-card__row-title' : 'stats-card__row-title')}
        <span class="stats-card__bar" aria-hidden="true"></span>
        <span class="stats-card__row-value">${esc(podium.line(e))}</span>
      </li>`;
  }).join('');
  return `
    <li class="stats-card stats-card--bars">
      ${label}
      <ol class="stats-card__bars">${rows}</ol>
    </li>`;
}

/*
 * The full statistics block: the counter strip, then the podium grid. Returns
 * null when there is nothing to show, so every caller can simply skip appending.
 *
 * `headingLevel` differs per surface — on /entdecken the block IS the page, so
 * its title is the h1 already rendered by the screen and this returns h2
 * sub-headings; on the landing page it is one section among several.
 */
function renderPublicStats(stats) {
  if (!publicStatsHasContent(stats)) return null;

  const counters = stats.counters
    ? `<ul class="stats-counters">${STATS_COUNTERS
      .filter((key) => typeof stats.counters[key] === 'number')
      .map((key) => `
        <li class="stats-counter">
          <span class="stats-counter__num">${esc(fmtCount(stats.counters[key]))}</span>
          <span class="stats-counter__label muted">${esc(t('stats.counter.' + key))}</span>
        </li>`).join('')}</ul>`
    : '';

  const entries = statsEntries(stats);
  const cards = entries.length
    ? `<ul class="stats-cards">${statsCardsHtml(entries)}</ul>`
    : '';

  // The provenance note is not decoration: the podiums cover only
  // provider-linked games, so claiming they describe every shelf would be a
  // claim the data does not support (lib/public-stats.js).
  const note = cards ? `<p class="stats-note muted">${esc(t('stats.note'))}</p>` : '';

  const el = h(`<div class="stats-block">${counters}${cards}${note}</div>`);
  // Bound on the DETACHED element, which `wireInfoButtons` handles fine — every
  // caller appends it, and doing it here means no surface can mount the block
  // and forget the ⓘ (the landing page being the one that would hurt).
  wireInfoButtons(el);
  wireStatsGames(el, stats);
  return el;
}

/* ------------------------------- /entdecken -------------------------------- */

/*
 * The closing call-to-action for a LOGGED-OUT visitor on /entdecken (#786).
 *
 * This screen exists to be shared with people who have never seen the app, and
 * a logged-out visitor is on the auth-screen chrome — no home button, no
 * context, no feedback — on a screen that deliberately carries no back control
 * either. Without this section the one page built for that audience answered
 * them with a dead end: read the stats, then edit the URL.
 *
 * The offer itself comes from renderLandingOffer() (views-landing.js), which is
 * the third surface it renders on. It used to be a hand-copied duplicate of the
 * landing page's closing block, which is exactly how the two pitches drift into
 * two different-looking offers — #1090 made the offer one function for that
 * reason, addressed by class rather than by id so a page may render it twice.
 *
 * landingRevealOperatorClaims() is reused rather than a second /api/config
 * fetch: it already memoizes the config, reveals `[data-demo-only]` only when
 * the instance HAS a demo (a button that answers 404 is worse than no button),
 * steps the register button back to a link beside it, and relabels the demo for
 * a visitor who already holds one (#502).
 */
function renderEntdeckenCta() {
  const cta = h(`<section class="landing-close stats-cta">
      <h2 class="landing-section__title">${esc(t('stats.cta.title'))}</h2>
      ${renderLandingOffer({ trust: false })}
    </section>`);
  // renderLandingOffer/wireLandingOffer/landingRevealOperatorClaims all live in
  // views-landing.js, which loads before this file
  // (.claude/rules/frontend-script-load-order.md).
  wireLandingOffer(cta);
  landingRevealOperatorClaims(cta);
  return cta;
}

/*
 * The standalone screen. Renders in BOTH the logged-in and logged-out states —
 * unlike /inbox, /freunde and /konto, which bounce a logged-out visitor Home —
 * because the whole point of publishing this is that it is public, and the URL
 * has to be shareable to someone who has never seen the app.
 */
async function showEntdecken() {
  currentView = () => showEntdecken();
  syncUrl('/entdecken');
  setContext(t('stats.title'));
  setDocTitle(t('stats.title'));
  applyMarker(null);
  // ONE expression, read twice: the chrome a visitor gets and whether they are
  // offered a way in are the same question, and two copies could disagree.
  const loggedOut = accountsActive() && !isLoggedIn();
  // A logged-out visitor is on the auth-screen chrome; a logged-in one is not.
  authScreen(loggedOut);
  // …and a logged-out one gets „Anmelden" in the bar (#1090), which the call
  // above has just hidden. Written as the whole expression rather than as
  // `if (loggedOut)`: the two are equivalent today only because authScreen()
  // hides the link on EVERY call including `authScreen(false)`, and stating the
  // condition here does not depend on that.
  showLoginLink(loggedOut);

  app.innerHTML = '';
  // Signed in under Der Tisch, the head lies on felt and carries the BGG badge
  // (T14.4, #1281): the podiums are BGG-linked games only, so the attribution
  // belongs with the screen's own title. The logged-out screen is the face
  // (#1198) and keeps the plain head, as does Klassisch — byte-identical.
  const felt = !loggedOut && designIs('tisch');
  // Forest heads F14.6 with the same BGG mark at the title's far end (#1474) —
  // the podiums are BGG-linked games — but on the clearing, not on felt.
  const bgg = felt || (!loggedOut && designIs('forest'));
  // Die Brücke's way up off the account screens (#1246, bruecke-hub.js) — not
  // for a logged-out visitor, who has no rounds to go back to (and wears the
  // face design anyway).
  if (!loggedOut && designIs('bruecke')) app.appendChild(brueckeUpLink());
  app.appendChild(h(`<div class="lobby-head${felt ? ' lobby-head--felt' : ''}">
      <h1>${esc(t('stats.title'))}</h1>
      <div class="muted lobby-head__sub">${esc(t('stats.sub'))}</div>${bgg ? `
      <img class="lobby-head__bgg" src="/icons/powered-by-bgg.png" width="900" height="264" alt="Powered by BGG" />` : ''}
    </div>`));

  const stats = await loadPublicStats();
  const block = renderPublicStats(stats);
  if (block) {
    app.appendChild(block);
  } else {
    // The one surface that says something when there is nothing: arriving here
    // deliberately (a link, a menu entry) and finding a blank page reads as
    // broken, whereas the teaser and the landing block simply do not appear.
    app.appendChild(h(`<p class="muted empty-note">${esc(t('stats.empty'))}</p>`));
  }
  // Appended in BOTH branches on purpose: an instance with nothing to publish is
  // exactly where a visitor most needs somewhere to go.
  if (loggedOut) app.appendChild(renderEntdeckenCta());
  // The weekly quiz's public statistics (#743), where the quiz runs — read off
  // the cached config, so an instance without it renders exactly as before.
  if (accountCfg && accountCfg.quiz) app.appendChild(quizArchiveLink());
  // Deliberately NO back control: the account menu reaches this screen, exactly
  // like /freunde, /konto and /neu, which makes it a main page — and a main
  // page's way "up" is the persistent chrome
  // (.claude/rules/persistent-chrome-defines-the-main-pages.md).
}

/* ------------------------------ the mounts --------------------------------- */

// Fill a placeholder on the landing page, or remove it. Not awaited by the
// caller: the landing page must render at once and the block appears when the
// payload lands.
async function mountLandingStats(placeholder) {
  const stats = await loadPublicStats();
  const block = renderPublicStats(stats);
  if (!block) {
    placeholder.remove();
    return;
  }
  placeholder.appendChild(h(`<h2 class="landing-section__title">${esc(t('stats.landingTitle'))}</h2>`));
  placeholder.appendChild(block);
}

/* How many of the six podiums the home panel shows. The dashboard tile sits
   beside two others in one grid, so it takes the first few rather than the whole
   ladder — /entdecken remains the place that publishes all of them. */
const HOME_STATS_PODIUMS = 3;

/*
 * The home hub's dashboard panel (#564 teaser, rebuilt in #842): a heading, the
 * first few podium entries WITH their cover art, and a link into /entdecken.
 *
 * It replaced a single strip — icon, title, one subline, chevron — that was the
 * entire Entdecken presence on home while saying nothing about the instance.
 *
 * Two constraints carry over from /entdecken and are the reason this reuses
 * renderPublicStats's parts rather than inventing its own:
 *
 *  - Nothing is inserted when there is nothing: publicStatsHasContent() false
 *    removes the placeholder outright — no heading, no skeleton, no container.
 *  - The provenance note TRAVELS WITH THE CLAIM. The podiums cover only
 *    provider-linked games (lib/public-stats.js), so a screen that shows the
 *    cards must also be able to say so; without it the tile would be a claim
 *    about every shelf, which the data does not support. Rendered exactly where
 *    renderPublicStats renders it — with the cards, and only with the cards.
 */
async function mountHomeStatsPanel(placeholder) {
  const stats = await loadPublicStats();
  if (!publicStatsHasContent(stats)) {
    // The slot, not just the tile — it carries the column flow's spacing (#946).
    slotOf(placeholder).remove();
    return;
  }
  // The section may have been re-rendered while we awaited (locale switch,
  // SWR refresh) — the same guard renderHomeFriends carries.
  if (!placeholder.isConnected) return;

  const head = h(`<div class="dash-tile__head">
      <h2>${esc(t('stats.title'))}</h2>
      <a class="link-btn" href="/entdecken">${esc(t('friends.home.all'))}</a>
    </div>`);
  navLink(head.querySelector('a'), '/entdecken', () => showEntdecken());
  placeholder.appendChild(head);

  const podiums = statsEntries(stats).slice(0, HOME_STATS_PODIUMS);
  if (!podiums.length) {
    // Counters but no podiums (a young instance): the heading and the link are
    // still honest — there IS something behind them — and there is simply no
    // card to draw, so no note either.
    placeholder.appendChild(h(`<p class="muted empty-note">${esc(t('stats.teaser.sub'))}</p>`));
    return;
  }
  const list = h(
    `<ul class="stats-cards stats-cards--home">${statsCardsHtml(podiums)}</ul>`
  );
  wireInfoButtons(list);
  wireStatsGames(list, stats);
  placeholder.appendChild(list);
  placeholder.appendChild(h(`<p class="stats-note muted">${esc(t('stats.note'))}</p>`));
}
