/* Spielwirbel – instance-wide public statistics (issue #564).

   ONE renderer, three surfaces: the logged-out landing page, the standalone
   /entdecken screen, and a compact teaser card on the home hub. They share this
   file rather than each building their own markup, because they publish the same
   payload and a drift between them would be a different claim about the instance
   on each screen.

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

// The four podiums, in render order, each with the icon and the i18n key that
// phrases its value. Data rather than four near-identical branches, so adding a
// metric is a row here and a key pair in both lang files.
//
// Icons are declared in the bundled tabler subset — an UNDECLARED class renders
// nothing at all, silently (.claude/rules/tabler-icon-codepoints.md). All four
// are already used elsewhere in the app.
const STATS_PODIUMS = [
  { key: 'mostOwned', icon: 'ti-cards', line: (e) => tn(e.owners, 'stats.owners.one', 'stats.owners.many') },
  { key: 'playedWeek', icon: 'ti-flame', line: (e) => tn(e.plays, 'stats.plays.one', 'stats.plays.many') },
  { key: 'playedMonth', icon: 'ti-calendar', line: (e) => tn(e.plays, 'stats.plays.one', 'stats.plays.many') },
  { key: 'playedYear', icon: 'ti-history', line: (e) => tn(e.plays, 'stats.plays.one', 'stats.plays.many') },
  { key: 'bestRated', icon: 'ti-star', line: (e) => t('stats.rated', { avg: e.average, n: e.ratings }) },
];

// The scale counters, in render order.
const STATS_COUNTERS = ['accounts', 'rounds', 'games', 'sessions'];

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
  return !!stats && (!!stats.counters || !!stats.games);
}

// One podium card. The cover is sized at render time — a provider master can be
// several thousand pixels wide (.claude/rules/provider-cover-sizing.md) — and is
// decorative here: the title beside it is the accessible name, so alt is empty
// rather than a duplicate.
function statsCard(podium, entry) {
  const cover = entry.image
    ? `<img class="stats-card__cover" src="${esc(coverUrl(entry.image, COVER_THUMB))}" alt="" loading="lazy" />`
    : '<span class="stats-card__cover stats-card__cover--none" aria-hidden="true"></span>';
  const title = entry.url
    ? `<a class="stats-card__title" href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer">${esc(entry.title)}</a>`
    : `<span class="stats-card__title">${esc(entry.title)}</span>`;
  return `
    <li class="stats-card">
      ${cover}
      <span class="stats-card__body">
        <span class="stats-card__label"><i class="ti ${podium.icon}" aria-hidden="true"></i>${esc(t('stats.' + podium.key))}</span>
        ${title}
        <span class="stats-card__value muted">${esc(podium.line(entry))}</span>
      </span>
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
          <span class="stats-counter__num">${esc(formatCount(stats.counters[key]))}</span>
          <span class="stats-counter__label muted">${esc(t('stats.counter.' + key))}</span>
        </li>`).join('')}</ul>`
    : '';

  const cards = stats.games
    ? `<ul class="stats-cards">${STATS_PODIUMS
      .filter((p) => stats.games[p.key])
      .map((p) => statsCard(p, stats.games[p.key])).join('')}</ul>`
    : '';

  // The provenance note is not decoration: the podiums cover only
  // provider-linked games, so claiming they describe every shelf would be a
  // claim the data does not support (lib/public-stats.js).
  const note = cards ? `<p class="stats-note muted">${esc(t('stats.note'))}</p>` : '';

  return h(`<div class="stats-block">${counters}${cards}${note}</div>`);
}

// Thousands separators for the active locale, so a counter reads as a number
// rather than a serial. Falls back to the raw digits where Intl is unavailable.
function formatCount(n) {
  try {
    return new Intl.NumberFormat(localeTag(getLocale())).format(n);
  } catch {
    return String(n);
  }
}

/* ------------------------------- /entdecken -------------------------------- */

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
  applyBackground(null);
  // A logged-out visitor is on the auth-screen chrome; a logged-in one is not.
  authScreen(accountsActive() && !isLoggedIn());

  app.innerHTML = '';
  app.appendChild(h(`<div class="lobby-head">
      <h1>${esc(t('stats.title'))}</h1>
      <div class="muted lobby-head__sub">${esc(t('stats.sub'))}</div>
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

/*
 * The home hub's compact teaser: a single card linking into /entdecken, shown
 * only when there is something behind it. A real <a href> via navLink, so
 * Cmd-click and "copy link address" work (.claude/rules/in-app-nav-links.md).
 */
async function mountHomeStatsTeaser(placeholder) {
  const stats = await loadPublicStats();
  if (!publicStatsHasContent(stats)) {
    placeholder.remove();
    return;
  }
  const card = h(`<a class="stats-teaser">
      <span class="stats-teaser__icon"><i class="ti ti-world-search" aria-hidden="true"></i></span>
      <span class="stats-teaser__body">
        <span class="stats-teaser__title">${esc(t('stats.teaser.title'))}</span>
        <span class="stats-teaser__sub muted">${esc(t('stats.teaser.sub'))}</span>
      </span>
      <i class="ti ti-chevron-right stats-teaser__chev" aria-hidden="true"></i>
    </a>`);
  navLink(card, '/entdecken', () => showEntdecken());
  placeholder.appendChild(card);
}
