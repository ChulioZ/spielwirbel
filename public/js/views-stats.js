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

// The four podiums, in render order, each with the icon and the i18n key that
// phrases its value. Data rather than four near-identical branches, so adding a
// metric is a row here and a key pair in both lang files.
//
// Icons are declared in the bundled tabler subset — an UNDECLARED class renders
// nothing at all, silently (.claude/rules/tabler-icon-codepoints.md). All four
// are already used elsewhere in the app.
const STATS_PODIUMS = [
  { key: 'mostOwned', icon: 'ti-cards', line: (e) => tn(e.shelves, 'stats.shelves.one', 'stats.shelves.many') },
  { key: 'playedWeek', icon: 'ti-flame', line: (e) => tn(e.plays, 'stats.plays.one', 'stats.plays.many') },
  { key: 'playedMonth', icon: 'ti-calendar', line: (e) => tn(e.plays, 'stats.plays.one', 'stats.plays.many') },
  { key: 'playedYear', icon: 'ti-history', line: (e) => tn(e.plays, 'stats.plays.one', 'stats.plays.many') },
  // The average goes through the locale formatter, not straight into the string:
  // a raw JS number interpolates as "4.6", and German writes "4,6".
  { key: 'bestRated', icon: 'ti-star', line: (e) => tn(e.ratings, 'stats.ratedOne', 'stats.rated', { avg: formatAverage(e.average) }) },
];

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

// A rating average, always to one decimal in the reader's own notation — "4,6"
// in German, "4.6" in English. Pinned to one digit so a whole number still reads
// as a rating ("4,0 von 5") rather than as a count.
function formatAverage(n) {
  try {
    return new Intl.NumberFormat(localeTag(getLocale()), {
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return String(n);
  }
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
 * The markup reuses the landing page's closing-CTA components rather than
 * declaring its own — `.landing-close`, `.landing-hero__demo` and
 * `.landing-hero__cta` are all unscoped rules, so they apply cleanly outside
 * `.landing`, and sharing them is what keeps the two pitches from drifting into
 * two different-looking offers. `.landing-hero__demo` in particular already
 * carries its paired `[hidden] { display: none }` rule, which the wrapper needs
 * because it ships hidden and the class sets `display: flex`
 * (.claude/rules/hidden-attribute-vs-display-rule.md).
 *
 * The two ids are not decoration: `#landingDemo` and `#landingRegister` are
 * landingRevealOperatorClaims()'s interface. It is reused here — rather than a
 * second /api/config fetch — because it already memoizes the config, reveals
 * `[data-demo-only]` only when the instance HAS a demo (a button that answers
 * 404 is worse than no button), promotes the demo over registering, and
 * relabels it for a visitor who already holds one (#502). Nothing renders two
 * screens at once, so the ids cannot collide with the landing page's own.
 */
function renderEntdeckenCta() {
  const cta = h(`<section class="landing-close stats-cta">
      <h2 class="landing-section__title">${esc(t('stats.cta.title'))}</h2>
      <!-- Ships hidden and is revealed only on an instance whose /api/config
           reports a demo, exactly as the landing hero does. The note rides the
           wrapper rather than sitting under the button row, so a promise of
           "no e-mail needed" can never end up beneath Anmelden (#503). (No
           backticks in here: this comment is inside a template literal.) -->
      <div class="landing-hero__demo" data-demo-only hidden>
        <button class="btn btn--lg" id="landingDemo">${esc(t('landing.hero.ctaDemo'))}</button>
        <p class="landing-hero__demo-note muted">${esc(t('landing.hero.demoNote'))}</p>
      </div>
      <div class="landing-hero__cta">
        <button class="btn btn--primary btn--lg" id="landingRegister">${esc(t('landing.hero.ctaPrimary'))}</button>
        <button class="btn btn--lg" id="landingLogin">${esc(t('landing.hero.ctaSecondary'))}</button>
      </div>
    </section>`);
  // startDemo/showRegister/showLogin live in account.js and
  // landingRevealOperatorClaims in views-landing.js — both load before this
  // file, and the first three are referenced inside handlers either way, so
  // they resolve at click time (.claude/rules/frontend-script-load-order.md).
  const demoBtn = cta.querySelector('#landingDemo');
  demoBtn.addEventListener('click', () => startDemo(demoBtn));
  cta.querySelector('#landingRegister').addEventListener('click', () => showRegister());
  cta.querySelector('#landingLogin').addEventListener('click', () => showLogin());
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
  applyBackground(null);
  // ONE expression, read twice: the chrome a visitor gets and whether they are
  // offered a way in are the same question, and two copies could disagree.
  const loggedOut = accountsActive() && !isLoggedIn();
  // A logged-out visitor is on the auth-screen chrome; a logged-in one is not.
  authScreen(loggedOut);

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
  // Appended in BOTH branches on purpose: an instance with nothing to publish is
  // exactly where a visitor most needs somewhere to go.
  if (loggedOut) app.appendChild(renderEntdeckenCta());
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

/* How many of the five podiums the home panel shows. The dashboard tile sits
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
    placeholder.remove();
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

  const podiums = stats.games
    ? STATS_PODIUMS.filter((p) => stats.games[p.key]).slice(0, HOME_STATS_PODIUMS)
    : [];
  if (!podiums.length) {
    // Counters but no podiums (a young instance): the heading and the link are
    // still honest — there IS something behind them — and there is simply no
    // card to draw, so no note either.
    placeholder.appendChild(h(`<p class="muted empty-note">${esc(t('stats.teaser.sub'))}</p>`));
    return;
  }
  placeholder.appendChild(h(
    `<ul class="stats-cards stats-cards--home">${podiums.map((p) => statsCard(p, stats.games[p.key])).join('')}</ul>`
  ));
  placeholder.appendChild(h(`<p class="stats-note muted">${esc(t('stats.note'))}</p>`));
}
