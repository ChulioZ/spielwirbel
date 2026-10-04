/* Spielwirbel – Forest's tier 2a (#1473; sheet Forest-F13-Tier2a): the markup
   Forest composes differently on the Chronik, the Pokale and the member page,
   kept out of the view files it plugs into because views-member.js and
   views-pokale.js sit at the 700-line budget
   (.claude/rules/token-friendly-source-files.md).

     - the Chronik as a PATH through the sessions (F13.1/F13.2): one row per
       session — the date and its number, the cover, the game with who won, the
       people's rings, the score — and on a phone the „Rückblick" entry at the
       head that takes you to the recap;
     - the Pokale as a GROVE (F13.3/F13.4, operator decision E7): one tree per
       person, its height following the wins, the person's ring on top; place 1
       in the gold tint with the crown, places 2 and 3 on the card with an ink
       edge — no silver or bronze;
     - the member page's Tischkarte (F13.5/F13.6): five figures, the fifth the
       favourite game's NAME (review U2), „Bearbeiten" in the card, and the
       boxes, „Zuletzt dabei" and the two game tiles in a column beside it.

   Every builder here is called only under designIs('forest'), so Klassisch's
   DOM never sees any of it (test/forest-tier2a.test.js pins that with a golden
   snapshot). No module.exports — every function builds DOM, so requiring it
   from Node would enter the coverage report unreachable
   (.claude/rules/frontend-helper-modules-and-coverage.md).

   Part of the frontend; all files share one global script scope. Loaded after
   views-member.js and programmheft-tier2a.js; every caller calls in at render
   time, never at load time (.claude/rules/frontend-script-load-order.md). */

'use strict';

// --- the Chronik --------------------------------------------------------------

/* „Session Nr. 23": a session's place among the round's FINISHED sessions,
   oldest first — the same set the head's „23 Sessions seit …" and the
   Wegweiser count, so the newest number IS that count. A cancelled night was
   never played and gets no number. Derived, never stored. */
function forestSessionNumbers(round) {
  const done = round.sessions.filter((s) => s.finished)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return new Map(done.map((s, i) => [s.id, i + 1]));
}

/* How many rings a row draws before „+N" (F13.1 draws four): one row, so a big
   table must not push the score off it. */
const FOREST_PATH_FACES = 4;

/* One step on the path (F13.1 desktop / F13.2 phone). Same link, target and
   words as the Klassisch card. The date leads the row because it leads the
   picture; on a phone the column folds away and the date moves to the head of
   the second line instead — that copy is aria-hidden, the column is the one
   read at every width (clipped, not removed), so the link's name says it once
   and DOM order stays reading order. The rings are aria-hidden and „4 dabei"
   is said in text beside them. */
function forestPathRow(round, s, { when, chosen, sPeople, thumbIcon, title, pill, outcome }, no, loadCover) {
  const d = new Date(s.createdAt);
  const tag = localeTag(locale);
  const winners = (s.winnerIds || []).map((wid) => sPeople.find((p) => p.id === wid)).filter(Boolean);
  let who = '';
  if (outcome === 'split') who = iconText('ti-layout-grid', t('sessions.split'));
  else if (winners.length) who = `<i class="ti ti-crown" aria-hidden="true"></i><span class="session-card__won">${esc(tn(winners.length, 'chronik.wonOne', 'chronik.won', { names: winners.map(personLabel).join(', ') }))}</span>`;
  else if (s.finished) who = endingText(s) || iconText('ti-check', t('sessions.played'));
  else if (outcome === 'cancelled') who = `<span class="session-card__cancelled">${iconText('ti-x', t('sessions.cancelled'))}</span>`;
  // A night with no game has the date as its TITLE already, so neither copy of
  // it is printed a second time.
  const dated = Boolean(chosen);
  const day = d.toLocaleString(tag, { day: 'numeric', month: 'short' });
  const seats = sPeople.slice(0, FOREST_PATH_FACES);
  const rest = sPeople.length - seats.length;
  const faces = seats.length
    ? `<span class="avatar-stack session-card__faces" aria-hidden="true">${seats
      .map((p) => `<span class="avatar${p.guest ? ' avatar--guest' : ''}" style="background:${personColor(round, p)}">${avatarFace(initials(p.name), {})}</span>`)
      .join('')}${rest > 0 ? `<span class="avatar avatar-stack__more">+${rest}</span>` : ''}</span><span class="sr-only">${esc(tn(sPeople.length, 'chronik.seatedOne', 'chronik.seated'))}</span>`
    : '';
  const card = h(`<a class="session-card session-card--path">
       <span class="session-card__when">${dated ? `<time class="session-card__date" datetime="${esc(s.createdAt)}" title="${esc(when)}">${esc(d.toLocaleString(tag, { day: 'numeric', month: 'short', year: 'numeric' }))}</time>` : ''}${no ? `<span class="session-card__no">${esc(t('chronik.sessionNo', { n: no }))}</span>` : ''}</span>
       <div class="session-card__img">${thumbIcon}</div>
       <div class="session-card__body">
         <div class="session-card__title">${title}</div>
         <div class="session-card__who">${dated ? `<span class="session-card__day" aria-hidden="true">${esc(day)} · </span>` : ''}${who}</div>
       </div>
       ${faces}${pill}
     </a>`);
  if (chosen && chosen.image) loadCover(card.querySelector('.session-card__img'), coverUrl(chosen.image, COVER_THUMB));
  navLink(card, resultsPath(round.id, s.id), () => showResults(round, s));
  return card;
}

/* The phone's „Rückblick" entry (F13.2): the dusk card at the head of the
   Chronik, naming the period the recap is showing and its session count. It is
   an ENTRY, not a second recap: the recap itself stands after the path (in the
   column beside it from 1100px, where forest.css hides this entry), and the
   button scrolls to it and moves focus there. Its words are read off the recap
   the page already rendered, so the entry and the panel cannot disagree. */
function forestRecapEntry(periodSec) {
  if (!periodSec) return null;
  periodSec.id = 'forest-recap';
  periodSec.tabIndex = -1;
  const entry = h(`<button type="button" class="forest-recap-entry" aria-controls="forest-recap">
       <span class="forest-recap-entry__text">
         <span class="forest-recap-entry__kicker">${esc(t('recap.title'))}</span>
         <span class="forest-recap-entry__period"></span>
         <span class="forest-recap-entry__sub"></span>
       </span>
       <i class="ti ti-chevron-right" aria-hidden="true"></i>
     </button>`);
  // Re-read after every pick: the recap's own listeners re-render its body
  // first (they sit on the target), this one hears the event as it bubbles.
  const sync = () => {
    const picker = periodSec.querySelector('.precap__picker');
    const opt = picker && picker.options[picker.selectedIndex];
    const n = periodSec.querySelector('.recap__totals .stat-chip__n');
    const sessions = n ? Number(n.textContent) : 0;
    entry.querySelector('.forest-recap-entry__period').textContent = opt ? opt.textContent : '';
    entry.querySelector('.forest-recap-entry__sub').textContent = tn(sessions, 'home.chip.sessionsOne', 'home.chip.sessions');
  };
  sync();
  periodSec.addEventListener('change', sync);
  periodSec.addEventListener('click', (e) => { if (e.target.closest('.precap__kind')) sync(); });
  entry.addEventListener('click', () => {
    periodSec.scrollIntoView({ block: 'start' });
    periodSec.focus({ preventScroll: true });
  });
  return entry;
}

// --- the Pokale ---------------------------------------------------------------

/* The grove (F13.3/F13.4, E7). Every active member is a tree, in standings
   order (`roundStandings`, so a shared place is shared here too), and the whole
   tree is the link to that member's page, as a podium entry is. The tree's
   size is the member's wins against the leader's, handed to forest.css as the
   unitless `--g` (0…1); the shapes are pure picture.

   The plate under each tree reads „1 · 9 Siege" — the shared place and the win
   count. A member with no win has no place (a dash), as in the table beside
   it. The name is in the DOM for a screen reader; the ring says it here. */
function forestGrove(round, ranked, rankOf, wins) {
  const top = Math.max(1, ...ranked.map((m) => wins[m.id]));
  const grove = h(`<div class="forest-grove">
       <h2 class="forest-grove__title">${esc(t('pokale.title'))}</h2>
       <ol class="forest-grove__trees"></ol>
     </div>`);
  const list = grove.querySelector('.forest-grove__trees');
  ranked.forEach((m) => {
    const n = wins[m.id];
    const place = n > 0 && rankOf[m.id] ? rankOf[m.id] : null;
    // Only the first place is marked in colour — the gold tint and the crown.
    // Places 2 and 3 take an ink edge on the card; everybody else a hairline.
    const tier = place === 1 ? 'lead' : place && place <= 3 ? 'placed' : 'rest';
    const li = h(`<li class="forest-grove__item is-${tier}"><a class="forest-grove__tree" style="--g:${(n / top).toFixed(3)}">
         <span class="forest-grove__ring"><span class="avatar" style="background:${memberColor(round, m.id)}">${avatarFace(initials(m.name), { userId: m.userId })}</span>${tier === 'lead' ? '<i class="ti ti-crown" aria-hidden="true"></i>' : ''}</span>
         <span class="forest-grove__crown" aria-hidden="true"></span>
         <span class="forest-grove__trunk" aria-hidden="true"></span>
         <span class="forest-grove__plate"><span class="sr-only">${esc(m.name)}: </span>${place || '–'} · ${esc(tn(n, 'pokale.winsOne', 'pokale.wins'))}</span>
       </a></li>`);
    makeMemberLink(li.querySelector('a'), round.id, m.id);
    list.appendChild(li);
  });
  return grove;
}

// --- the member page ----------------------------------------------------------

/* The member page under Forest (F13.5/F13.6). views-member.js builds the
   Tischkarte as every panelled design does; this recomposes it:

     - the five figures in the sheet's order — Sessions, Siege, Siegquote,
       Bewertet meist, Lieblingsspiel. The four figures are the SAME nodes
       views-member.js built (moved, so the DOM order is the visual order); the
       fifth is the favourite game's name, from the `memberStats` value the
       „Lieblingsspiel" tile prints, set to wrap (review U2) — never an ellipsis;
     - „Bearbeiten" (member.edit) at the card's foot, opening the same inline
       rename the name itself does;
     - a column beside the card: „Gehört …", „Zuletzt dabei" and the two game
       tiles („Stärkstes Spiel" is shown nowhere else, so it stays).

   Returns the page element the caller appends in place of the bare card. */
function forestMemberPage(card, round, member, st, nameEl) {
  const figures = card.querySelector('.member-card__figures');
  const [wins, rate, sessions, avg] = [...figures.querySelectorAll(':scope > .member-figure')];
  if (wins && rate && sessions && avg) [sessions, wins, rate, avg].forEach((el) => figures.appendChild(el));
  const fav = st.favorite.length ? joinNames(st.favorite.map((g) => g.title)) : '–';
  figures.appendChild(h(`<div class="member-figure member-figure--game">
       <span class="member-figure__value">${esc(fav)}</span>
       <span class="member-figure__label">${esc(t('member.favorite'))}</span>
     </div>`));

  const edit = h(`<button type="button" class="btn btn--sm forest-member-edit">${iconText('ti-pencil', t('member.edit'))}</button>`);
  edit.addEventListener('click', () => { if (nameEl.isConnected) nameEl.click(); });
  const foot = card.querySelector('.member-card__table');
  card.insertBefore(edit, foot);

  const aside = h('<div class="forest-member__aside"></div>');
  const lower = card.querySelector('.member-card__lower');
  const tiles = card.querySelector('.member-card__games');
  const owned = lower && lower.querySelector('.member-owned');
  if (owned) aside.appendChild(owned);
  const recent = forestRecentSessions(round, member.id);
  if (recent) aside.appendChild(recent);
  if (tiles) aside.appendChild(tiles);
  if (lower) lower.remove();

  const page = h('<div class="forest-member"></div>');
  page.appendChild(card);
  page.appendChild(aside);
  return page;
}

/* „Zuletzt dabei" (F13.5/F13.6): the member's latest FINISHED sessions, newest
   first — date, the game played, and whether they won it. Over the same
   predicate memberStats counts `joined` with (finished, and the member in
   `memberIds`; a legacy session without one counts everyone), so the list can
   never show an evening the „Sessions" figure does not count. Each row links to
   its session. Null when there is none: the figure already says „0". */
const FOREST_RECENT_SESSIONS = 4;

function forestRecentSessions(round, mid) {
  const rows = round.sessions
    .filter((s) => s.finished && (!Array.isArray(s.memberIds) || s.memberIds.includes(mid)))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, FOREST_RECENT_SESSIONS);
  if (!rows.length) return null;
  const panel = h(`<div class="forest-recent">
       <h2 class="forest-recent__title">${esc(t('member.recentTitle'))}</h2>
       <ul class="forest-recent__list"></ul>
     </div>`);
  const list = panel.querySelector('.forest-recent__list');
  rows.forEach((s) => {
    const game = s.chosenGameId && round.games.find((g) => g.id === s.chosenGameId);
    const won = (s.winnerIds || []).includes(mid);
    const li = h(`<li><a class="forest-recent__row${won ? ' is-won' : ''}">
         <time class="forest-recent__date" datetime="${esc(s.createdAt)}">${esc(new Date(s.createdAt).toLocaleString(localeTag(locale), { day: 'numeric', month: 'short', year: 'numeric' }))}</time>
         <span class="forest-recent__game">${esc(game ? game.title : t('sessions.played'))}</span>
         <span class="forest-recent__state">${esc(t(won ? 'member.recentWon' : 'member.recentJoined'))}</span>
       </a></li>`);
    navLink(li.querySelector('a'), resultsPath(round.id, s.id), () => showResults(round, s));
    list.appendChild(li);
  });
  return panel;
}
