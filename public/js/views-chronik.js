/* Spielwirbel – views: the Chronik tab, one month-grouped timeline of finished
   sessions and shelf changes, with the per-period recap (#800) as its own
   section above it (#851) — that section and its share delivery live in
   views-period-recap.js (#1345). Rendered by showRound() (views-round.js).
   Part of the frontend; all files share one global script scope. */

// --- Chronik tab: one timeline of sessions and shelf changes. The activity
// feed arrives as its own argument (fetched per visit by showRound, #197) —
// it is no longer part of the round payload.
// The timeline's visual tiers (#633). Keyed on the event TYPE, never on the icon
// class the row happens to render: an icon can be shared between types (`ti-trash`
// is every deletion), so an icon-based match would misfile rows between tiers.
// Everything not listed here keeps the neutral middle tier — a move, an import,
// a new seat and a rename are bookkeeping, not moments in the round's history.
const CHRONIK_MILESTONES = ['game_retired', 'game_completed', 'game_restored', 'game_uncompleted'];
const chronikTier = (type) =>
  CHRONIK_MILESTONES.includes(type) ? 'milestone' : type === 'game_added' ? 'add' : '';

const CHRONIK_FILTERS = ['all', 'sessions', 'changes'];

/* Der Tisch lays the Chronik out as the SESSIONS (#1271, T13.1/T13.5): each is
   a paper strip with a brass date column, the players' faces and the score
   pill, and the shelf changes between them recede. Everything below that
   branches on it goes through one flag, read once per render; Klassisch takes
   the untouched path.

   How many faces a strip shows before the "+N" count — T13.1 draws four, and
   a strip is one row, so a big table must not push the pill off it. */
const CHRONIK_STRIP_FACES = 4;

/* Ocean lays the Chronik out as ROWS (#1218, O13.1/O13.5): [cover | title +
   date | the winner's ring and crown | score bubble | chevron], under month
   headings that carry their own session count, with the recap in a column
   beside it from 1280px (ocean.css). The same link, target and words as the
   Klassisch card; what moves is where each fact sits.

   Die Brücke lays it out as a LOG (#1245, B3.3/B6.1): one line per session,
   [date | game | who won | games drawn | score], under a row of column heads
   from 700px — the result table's own grammar, so a session reads the same in
   the Chronik as on its result.

   Das Programmheft sets it as an ARCHIVE OF EDITIONS (#1379, P13.1/P13.2): one
   headline per session — [date | cover | game + who won · N dabei · N Spiele |
   the score as a display numeral] — under month heads that stand in their own
   left column from 700px, with the recap as the black box beside it.

   Forest walks it as a PATH (#1473, F13.1/F13.2): one step per session —
   [date + „Session Nr. 23" | cover | game + who won | the people's rings |
   score] — beside a line of leaves, with the recap as the card to its right
   from 1100px and, on a phone, a „Rückblick" entry at the head that takes you
   to it (forest-tier2a.js). */
// Unique ids for the collapsed shelf-change runs' aria-controls.
let chronikRunSeq = 0;

function renderChronikTab(round, activities) {
  const rid = round.id;
  const tisch = designIs('tisch');
  const ocean = designIs('ocean');
  const bruecke = designIs('bruecke');
  const programmheft = designIs('programmheft');
  const forest = designIs('forest');
  const loadCover = createCoverLoader(); // lazy session thumbs (#198)
  // The earnings each session produced (#1388), a row apiece under its card.
  const badgeRows = badgeChronikIndex(round);

  // The chip choice persists for the session but is scoped to one round — the
  // same guard renderRegalTab opens with. An unknown value (a filter dropped in
  // a later redesign, still sitting in the module-level slot) falls back to
  // 'all', so the timeline can never render with no chip lit.
  if (chronikFilterRid !== round.id) {
    chronikFilter = 'all';
    chronikFilterRid = round.id;
  }
  if (!CHRONIK_FILTERS.includes(chronikFilter)) chronikFilter = 'all';

  // Collect all entries: done sessions as cards, game activities as quiet rows.
  //
  // A multi-table split's children (#796) are NOT top-level entries: they are the
  // tables of one evening, so they nest under their parent's card instead of
  // scattering three near-identical rows through the timeline at the same
  // minute. The parent is resolved rather than trusted — a deleted parent leaves
  // its children as ordinary sessions, which is what they are once nothing ties
  // them together.
  const entries = [];
  const doneSessions = round.sessions.filter((s) => s.done);
  const parentIds = new Set(doneSessions.filter(isSplitParent).map((s) => s.id));
  const childrenOf = new Map();
  doneSessions.forEach((s) => {
    if (!s.parentSessionId || !parentIds.has(s.parentSessionId)) return;
    const list = childrenOf.get(s.parentSessionId) || [];
    list.push(s);
    childrenOf.set(s.parentSessionId, list);
  });
  doneSessions
    .filter((s) => !(s.parentSessionId && parentIds.has(s.parentSessionId)))
    .forEach((s) => entries.push({ kind: 'session', at: s.createdAt, session: s }));
  /* The other round's name and id are redacted on read for a grantee who holds
     no grant on that round (#1007, lib/routes/activities.js), so each of the four
     bulk move/copy events needs a generic wording for the nameless case. Both key
     pairs are passed as literals rather than derived from one name, so a source
     scan over i18n keys can still see them (`.claude/rules/source-scanning-guards-enumerate-shapes.md`). */
  const crossRound = (a, one, many, anonOne, anonMany) => (a.roundName
    ? tn(a.count, one, many, { round: a.roundName })
    : tn(a.count, anonOne, anonMany));
  (activities || []).forEach((a) => {
    const meta = {
      game_added: { icon: 'ti-plus', text: t('activity.gameAdded', { title: a.title }) },
      game_retired: { icon: 'ti-archive', text: t('activity.gameRetired', { title: a.title }) },
      game_restored: { icon: 'ti-arrow-back-up', text: t('activity.gameRestored', { title: a.title }) },
      game_completed: { icon: 'ti-circle-check', text: t('activity.gameCompleted', { title: a.title }) },
      game_uncompleted: { icon: 'ti-arrow-back-up', text: t('activity.gameUncompleted', { title: a.title }) },
      game_deleted: { icon: 'ti-trash', text: t('activity.gameDeleted', { title: a.title }) },
      // One bulk entry per side of a whole-shelf move (#253) — these carry a
      // count and the other round's name, not a game title.
      games_moved_out: { icon: 'ti-arrow-right', text: crossRound(a, 'activity.gamesMovedOutOne', 'activity.gamesMovedOut', 'activity.gamesMovedOutAnotherOne', 'activity.gamesMovedOutAnother') },
      games_moved_in: { icon: 'ti-arrow-left', text: crossRound(a, 'activity.gamesMovedInOne', 'activity.gamesMovedIn', 'activity.gamesMovedInAnotherOne', 'activity.gamesMovedInAnother') },
      games_copied_out: { icon: 'ti-copy', text: crossRound(a, 'activity.gamesCopiedOutOne', 'activity.gamesCopiedOut', 'activity.gamesCopiedOutAnotherOne', 'activity.gamesCopiedOutAnother') },
      games_copied_in: { icon: 'ti-copy', text: crossRound(a, 'activity.gamesCopiedInOne', 'activity.gamesCopiedIn', 'activity.gamesCopiedInAnotherOne', 'activity.gamesCopiedInAnother') },
      // One bulk entry per collection import (#481) — a count, not a title, for
      // the same reason as the two moves above: an import is routinely 100+
      // games and a row each would bury every other event on the round.
      games_imported: { icon: 'ti-download', text: tn(a.count, 'activity.gamesImportedOne', 'activity.gamesImported') },
      // Bulk shelf tidying (#832) — counts for the same reason as the three
      // above, and the reason bites hardest here: undoing a 200-game import
      // would otherwise bury every other event the round has ever had.
      games_retired: { icon: 'ti-archive', text: tn(a.count, 'activity.gamesRetiredOne', 'activity.gamesRetired') },
      games_deleted: { icon: 'ti-trash', text: tn(a.count, 'activity.gamesDeletedOne', 'activity.gamesDeleted') },
      // A new seat (#563) — carries the member's NAME, not a game title. Written
      // for both an added seat and an accepted invitation (#207), since either way
      // a new person is in the round.
      member_added: { icon: 'ti-user-plus', text: t('activity.memberAdded', { name: a.name }) },
      member_retired: { icon: 'ti-user-minus', text: t('activity.memberRetired', { name: a.name }) },
      member_restored: { icon: 'ti-arrow-back-up', text: t('activity.memberRestored', { name: a.name }) },
      member_deleted: { icon: 'ti-trash', text: t('activity.memberDeleted', { name: a.name }) },
      // A one-off operator clean-up (#981): the storefront links this round still
      // held were cleared, so a cover that vanished has a line saying why.
      storefront_cleared: { icon: 'ti-unlink', text: tn(a.n || 0, 'activity.storefrontClearedOne', 'activity.storefrontCleared', { n: a.n || 0 }) },
      // A rename (#562) — the round's NEW name. Renaming is open to a grantee
      // (it is acting within the round, not destroying it), so this entry is how
      // an owner sees that their shared round changed name, and who did it. The
      // previous name is deliberately not stored: it would outlive a moderation
      // redaction of the round's name.
      round_renamed: { icon: 'ti-pencil', text: t('activity.roundRenamed', { name: a.name }) },
      // Owned expansions (#653) — a count plus the GAME's title, for the same
      // reason the three bulk entries above carry counts: one save can tick ten
      // boxes. A quiet row, deliberately not a CHRONIK_MILESTONES entry: adding
      // an expansion is not on the level of retiring a game.
      game_expansion_added: { icon: 'ti-puzzle', text: tn(a.count, 'activity.expansionAddedOne', 'activity.expansionAdded', { title: a.title }) },
    }[a.type];
    if (!meta) return;
    // Who did it (#207): resolve the actor's member seat to a name (like
    // winnerNames). Absent on single-actor rounds, so nothing is shown there.
    const by = a.actorMemberId && (round.members.find((m) => m.id === a.actorMemberId) || {}).name;
    entries.push({ kind: 'activity', at: a.at, id: a.id, gameId: a.gameId, type: a.type, by, ...meta });
  });
  // Newest first, ties last-pushed first (#1622): sessions are pushed in the
  // repo's chronological order, so two logged for one day — both at 20:00 —
  // list the later-entered one on top, as two on different days would.
  const ordered = newestSessionsFirst(entries, (e) => e.at);
  entries.length = 0;
  entries.push(...ordered);

  // The per-period recap (#800) is its own section ABOVE the timeline (#851):
  // the Chronik is the round's time axis, so the shareable card for a month
  // belongs beside the very stretch of history it summarises. It renders
  // nothing at all when the round has no period worth offering.
  // Die Brücke is the exception (#1245, B6.1): its phone shows the log FIRST and
  // the recap after it, so the section is appended below the log instead. The
  // desktop grid places the recap in its own column either way (bruecke.css).
  // Das Programmheft does the same (#1379): P13.2 opens on the editions, and
  // P13.1 sets the recap as the black box in the column to their right.
  // Forest too (#1473): F13.2 opens on the path, F13.1 sets the recap beside it.
  const recapLast = bruecke || programmheft || forest;
  const periodSec = renderPeriodRecapSection(round, activities);
  if (periodSec && !recapLast) app.appendChild(periodSec);

  // Exactly one <h1> on the screen, and it is this one — the recap above keeps
  // its <h2>. That does put an h2 before the h1 in document order; it is an
  // accepted trade-off of the placement, not a WCAG 1.3.1 failure (which is
  // about structure, not level sequencing), and the screen's name in the title
  // bar comes from setDocTitle (.claude/rules/per-view-document-title.md).
  // `ph-page`: the hook programmheft.css prints the page head and the editions
  // from (#1379); nothing else reads it.
  const sec = h(`<div class="section${programmheft ? ' ph-page' : ''}"></div>`);
  const secHead = h(`<div class="section-head"><h1>${esc(t('chronik.title'))}</h1></div>`);
  // Der Tisch names what the page IS beside its title — „23 Sessions seit Mai
  // 2025" (T13.1). Counted exactly as the rail beside it counts (round-rail.js:
  // every FINISHED session), not over the strips: a cancelled night is listed
  // but was never played, and counting it put „7" here beside the rail's „6".
  if (tisch || ocean || bruecke || programmheft || forest) {
    const counted = round.sessions.filter((s) => s.finished);
    if (counted.length) {
      const since = counted.reduce((a, s) => (s.createdAt < a ? s.createdAt : a), counted[0].createdAt);
      secHead.appendChild(h(`<span class="chronik__count">${esc(tn(counted.length, 'chronik.countOne', 'chronik.count', { month: fmtMonth(since) }))}</span>`));
    }
  }
  sec.appendChild(secHead);

  // Filter chips: everything / sessions only / shelf changes only. `is-on` is
  // driven by the remembered choice rather than hard-coded onto "all", or the
  // marked chip and the timeline would disagree on every return to the tab.
  // The state is SAID as well as painted (audit 2026-10-04 A3): `aria-pressed`
  // on every chip, kept in step with `is-on` on each click, and a named group —
  // `.is-on` alone is colour (.claude/rules/accessibility-contrast-and-modals.md §3).
  const on = (f) => (f === chronikFilter ? ' is-on' : '');
  const pressed = (f) => `aria-pressed="${f === chronikFilter}"`;
  const chips = h(`<div class="filter-chips" role="group" aria-label="${esc(t('chronik.filter.label'))}">
      <button class="chip${on('all')}" ${pressed('all')} data-f="all">${esc(t('chronik.filter.all'))}</button>
      <button class="chip${on('sessions')}" ${pressed('sessions')} data-f="sessions"><i class="ti ti-confetti" aria-hidden="true"></i>${esc(t('chronik.filter.sessions'))}</button>
      <button class="chip${on('changes')}" ${pressed('changes')} data-f="changes"><i class="ti ti-cards" aria-hidden="true"></i>${esc(t('chronik.filter.changes'))}</button>
    </div>`);
  chips.querySelectorAll('[data-f]').forEach((chip) => {
    chip.addEventListener('click', () => {
      chronikFilter = chip.dataset.f;
      chips.querySelectorAll('[data-f]').forEach((c) => {
        c.classList.toggle('is-on', c === chip);
        c.setAttribute('aria-pressed', String(c === chip));
      });
      renderTimeline();
    });
  });
  sec.appendChild(chips);
  // „Session nachtragen" (#1616): an evening played before the group found the
  // app, or entered a day late. Here because the Chronik is the round's time
  // axis — the place a missing evening is noticed. One renderer serves every
  // design, so every design gets it. Offered only with something on the shelf
  // to log, since a logged session is a direct pick of one shelf game.
  if (round.games.some(isActiveGame)) {
    const logBtn = h(`<button type="button" class="btn btn--sm chronik-log">${iconText('ti-calendar-plus', t('chronik.log.cta'))}</button>`);
    logBtn.addEventListener('click', () => showLogSessionPicker(round));
    chips.after(logBtn);
  }
  // Forest's phone entry to the recap (#1473, F13.2), right under the head.
  const recapEntry = forest ? forestRecapEntry(periodSec) : null;
  if (recapEntry) secHead.after(recapEntry);

  // Das Programmheft's head actions (#1379): „Rückblick" opens the recap as a
  // sheet on a phone, „Teilen" shares the box's period on a desktop
  // (programmheft-tier2a.js). Each is shown at its own width by programmheft.css.
  if (programmheft) {
    const { recap, share } = programmheftChronikActions(round, activities, periodSec);
    if (recap) secHead.appendChild(recap);
    if (share) chips.after(share);
  }

  /* Die Brücke's column heads (B3.3 „Datum · Spiel · Sieger · Spiele gezogen ·
     Score"). aria-hidden: each row is one link whose name already carries every
     fact in reading order, so heads a screen reader cannot associate with a
     cell would only be read as five stray words. Shown from 700px (bruecke.css),
     where the row is a table line; the phone row has no columns to head. */
  if (bruecke) {
    sec.appendChild(h(`<div class="chronik-cols" aria-hidden="true">${['date', 'game', 'winner', 'games', 'score']
      .map((c) => `<span class="chronik-cols__${c}">${esc(t(`chronik.col.${c}`))}</span>`).join('')}</div>`));
  }
  const tl = h('<div class="timeline"></div>');
  sec.appendChild(tl);
  app.appendChild(sec);
  if (periodSec && recapLast) app.appendChild(periodSec);
  const sessionNo = forest ? forestSessionNumbers(round) : new Map();

  function buildSessionCard(s) {
    const when = fmtSessionWhen(s);
    const chosen = s.chosenGameId && round.games.find((g) => g.id === s.chosenGameId);
    // Against the session's own people, so a guest winner is listed with its
    // marker rather than silently dropped (#458).
    const sPeople = sessionPeople(round, s);
    const winnerNames = (s.winnerIds || [])
      .map((wid) => personLabel(sPeople.find((p) => p.id === wid)))
      .filter(Boolean);

    // Thumbnail: the chosen game's cover, or an icon for the session's state.
    // Keyed on `sessionOutcome` (#796) rather than on `s.cancelled`, or a split
    // parent — which has no chosen game and is not cancelled — would render with
    // the played icon and read as a night that happened at one table.
    const outcome = sessionOutcome(s);
    const stateIcon = outcome === 'cancelled' ? 'ti-x' : outcome === 'split' ? 'ti-layout-grid' : 'ti-cards';
    const thumbIcon = chosen
      ? coverPlaceholder(chosen)
      : `<i class="ti ${stateIcon}" aria-hidden="true"></i>`;

    // Headline is the chosen game (with a rating pill); the date leads only
    // when no game was played. The meta line carries the rest.
    const title = chosen ? esc(chosen.title) : esc(when);
    let pill = '';
    if (chosen) {
      const sst = gameStatsForSession(round, s, chosen.id);
      if (sst.score !== null) pill = `<span class="score-pill" style="--sc:${scoreColor(sst.score)}" data-stop="${scoreStop(sst.score)}">${fmtAvg(displayScore(sst.score))}</span>`;
    }

    const parts = [];
    // Under Der Tisch the date has its own column, so the meta line does not
    // repeat it.
    if (chosen && !tisch) parts.push(esc(when));
    if (outcome === 'split') parts.push(iconText('ti-layout-grid', t('sessions.split')));
    // A winnerless night says HOW it ended where it has one (#1038); an
    // unrecorded one still reads „Gespielt", which is all that is known about it.
    else if (s.finished) parts.push(winnerNames.length ? '<i class="ti ti-trophy" aria-hidden="true"></i> ' + winnerNames.map(esc).join(', ') : (endingText(s) || iconText('ti-check', t('sessions.played'))));
    else if (outcome === 'cancelled') parts.push(`<span style="color:var(--danger)">${iconText('ti-x', t('sessions.cancelled'))}</span>`);
    // „N Spiele bewertet" counts the games IN the session, phrased as games
    // RATED — true for a voted session, and for a direct-play one (#532) it read
    // „1 Spiel bewertet" over zero votes (#915). Omitted entirely there rather
    // than reworded: the card then reads „3. September · ✓ Gespielt", which is
    // the whole truth about that evening.
    // „4 dabei" (T13.1): the faces are aria-hidden, so the count is what a
    // screen reader hears for them — in the text, not only in the picture.
    if (tisch && sPeople.length) parts.push(esc(tn(sPeople.length, 'chronik.seatedOne', 'chronik.seated')));
    const rated = sessionHasVotes(s) ? esc(tn(s.gameIds.length, 'sessions.ratedOne', 'sessions.rated')) : '';
    if (bruecke) return buildSessionLog(s, { when, chosen, sPeople, title, pill, outcome });
    if (forest) return forestPathRow(round, s, { when, chosen, sPeople, thumbIcon, title, pill, outcome }, sessionNo.get(s.id), loadCover);
    if (programmheft) return buildSessionEdition(s, { when, chosen, sPeople, thumbIcon, title, pill, outcome });
    if (ocean) return buildSessionRow(s, { when, chosen, sPeople, thumbIcon, title, pill, outcome, rated });
    if (tisch) return buildSessionStrip(s, { when, chosen, sPeople, thumbIcon, title, pill, parts, rated });
    if (rated) parts.push(rated);

    const card = h(`<a class="session-card">
         <div class="session-card__img">${thumbIcon}</div>
         <div class="session-card__body">
           <div class="session-card__title">${title}${pill}</div>
           <div class="session-card__meta">${parts.join(' · ')}</div>
         </div>
       </a>`);
    if (chosen && chosen.image) loadCover(card.querySelector('.session-card__img'), coverUrl(chosen.image, COVER_THUMB));
    navLink(card, resultsPath(round.id, s.id), () => showResults(round, s));
    return card;
  }

  /* Der Tisch's session strip (#1271, T13.1/T13.5). Same link, same target and
     the same words as the Klassisch card; what changes is the composition:
     [date column | cover | title + meta | faces | score pill]. The date comes
     FIRST in the DOM because it is first in the picture — on a phone it sits
     inside the paper, on a desktop on the wood beside it (tisch.css), and
     either way it is read first. */
  function buildSessionStrip(s, { when, chosen, sPeople, thumbIcon, title, pill, parts, rated }) {
    const d = new Date(s.createdAt);
    const tag = localeTag(locale);
    const day = d.toLocaleString(tag, { day: '2-digit' });
    const mon = d.toLocaleString(tag, { month: 'short' });
    const seats = sPeople.slice(0, CHRONIK_STRIP_FACES);
    const rest = sPeople.length - seats.length;
    // aria-hidden: the meta line carries „N dabei" in text, and a link whose
    // name spells out every initial reads as noise.
    const faces = seats.length
      ? `<span class="avatar-stack session-card__faces" aria-hidden="true">${seats
        .map((p) => `<span class="avatar${p.guest ? ' avatar--guest' : ''}" style="background:${personColor(round, p)}">${avatarFace(initials(p.name), {})}</span>`)
        .join('')}${rest > 0 ? `<span class="avatar avatar-stack__more">+${rest}</span>` : ''}</span>`
      : '';
    const card = h(`<a class="session-card session-card--strip">
         <time class="session-card__date" datetime="${esc(s.createdAt)}" title="${esc(when)}"><span class="session-card__day">${esc(day)}</span><span class="session-card__mon">${esc(mon)}</span></time>
         <div class="session-card__img">${thumbIcon}</div>
         <div class="session-card__body">
           <div class="session-card__title">${title}</div>
           <div class="session-card__meta">${parts.join(' · ')}${rated ? `<span class="session-card__rated">${parts.length ? ' · ' : ''}${rated}</span>` : ''}</div>
         </div>
         ${faces}${pill}
       </a>`);
    if (chosen && chosen.image) loadCover(card.querySelector('.session-card__img'), coverUrl(chosen.image, COVER_THUMB));
    navLink(card, resultsPath(round.id, s.id), () => showResults(round, s));
    return card;
  }

  /* Ocean's session row (#1218, O13.1/O13.5). The WHO sits in its own slot:
     the first winner's ring with the crown over it, then „Jonas hat gewonnen".
     A night without a winner puts how it ended there instead — the same words
     the Klassisch meta line uses (split, ending, „Gespielt", cancelled), so no
     session loses a fact by moving. The meta line keeps the date, the head
     count and „N Spiele bewertet". On a phone the ring folds away and the
     winner line wraps under the date (ocean.css): O13.5's two-line row. */
  function buildSessionRow(s, { when, chosen, sPeople, thumbIcon, title, pill, outcome, rated }) {
    const winners = (s.winnerIds || []).map((wid) => sPeople.find((p) => p.id === wid)).filter(Boolean);
    let who;
    if (outcome === 'split') who = iconText('ti-layout-grid', t('sessions.split'));
    else if (winners.length) {
      const lead = winners[0];
      // aria-hidden: the sentence beside it names every winner in text.
      const face = `<span class="session-card__crowned" aria-hidden="true"><span class="avatar${lead.guest ? ' avatar--guest' : ''}" style="background:${personColor(round, lead)}">${avatarFace(initials(lead.name), {})}</span><i class="ti ti-crown"></i></span>`;
      who = `${face}<span class="session-card__won">${esc(tn(winners.length, 'chronik.wonOne', 'chronik.won', { names: winners.map(personLabel).join(', ') }))}</span>`;
    } else if (s.finished) who = endingText(s) || iconText('ti-check', t('sessions.played'));
    else if (outcome === 'cancelled') who = `<span class="session-card__cancelled">${iconText('ti-x', t('sessions.cancelled'))}</span>`;
    // The month heading above already carries the year, so the row names the
    // day only („14. Sep.", O13.1); the full date and time stay one hover away.
    // A night with no game has the date as its TITLE, so it is not repeated.
    const day = new Date(s.createdAt).toLocaleString(localeTag(locale), { day: 'numeric', month: 'short' });
    const meta = chosen ? [`<time datetime="${esc(s.createdAt)}" title="${esc(when)}">${esc(day)}</time>`] : [];
    if (sPeople.length) meta.push(esc(tn(sPeople.length, 'chronik.seatedOne', 'chronik.seated')));
    if (rated) meta.push(rated);
    const card = h(`<a class="session-card session-card--row">
         <div class="session-card__img">${thumbIcon}</div>
         <div class="session-card__body">
           <div class="session-card__title">${title}</div>
           <div class="session-card__meta">${meta.join(' · ')}</div>
         </div>
         <div class="session-card__who">${who || ''}</div>
         ${pill}
         <i class="ti ti-chevron-right session-card__chev" aria-hidden="true"></i>
       </a>`);
    if (chosen && chosen.image) loadCover(card.querySelector('.session-card__img'), coverUrl(chosen.image, COVER_THUMB));
    navLink(card, resultsPath(round.id, s.id), () => showResults(round, s));
    return card;
  }

  /* Die Brücke's log line (#1245, B3.3 desktop / B6.1 phone). Same link, target
     and words as the Klassisch card. The WHO slot says „Jonas hat gewonnen"
     (Ocean's key — one sentence for one fact) and, under it, how often the
     chosen game took the 1 in this session in Brücke's scale-end words, „1× kein
     Schub" (B3.3). A night without a winner says how it ended, exactly as the
     Klassisch meta line does.

     The date is rendered twice on purpose: „14.09.2026" for the desktop column
     and „14 / Sep" stacked for the phone (B6.1). The stacked pair is
     aria-hidden and the full date is the one read at every width — the CSS only
     swaps which of the two is SEEN (on a phone the full one stays in the
     accessibility tree, clipped). No cover: neither sheet draws one on a log
     line. */
  function buildSessionLog(s, { when, chosen, sPeople, title, pill, outcome }) {
    const d = new Date(s.createdAt);
    const tag = localeTag(locale);
    const full = d.toLocaleDateString(tag, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const winners = (s.winnerIds || []).map((wid) => sPeople.find((p) => p.id === wid)).filter(Boolean);
    let who;
    if (outcome === 'split') who = iconText('ti-layout-grid', t('sessions.split'));
    else if (winners.length) who = `<span class="session-card__won">${esc(tn(winners.length, 'chronik.wonOne', 'chronik.won', { names: winners.map(personLabel).join(', ') }))}</span>`;
    else if (s.finished) who = endingText(s) || iconText('ti-check', t('sessions.played'));
    else if (outcome === 'cancelled') who = `<span class="session-card__cancelled">${iconText('ti-x', t('sessions.cancelled'))}</span>`;
    const vetoes = chosen ? gameStatsForSession(round, s, chosen.id).vetoes : 0;
    const sub = vetoes ? `<span class="session-card__vetoes">${esc(tn(vetoes, 'chronik.noThrustOne', 'chronik.noThrust', { n: vetoes }))}</span>` : '';
    // „Spiele gezogen": how many games the pool drew. A direct play (one game,
    // no vote) has that as well, so this is not „bewertet", which #915 retired
    // for exactly that case.
    const drawn = s.gameIds && s.gameIds.length ? esc(tn(s.gameIds.length, 'home.chip.gamesOne', 'home.chip.games')) : '';
    const card = h(`<a class="session-card session-card--log">
         <time class="session-card__date" datetime="${esc(s.createdAt)}" title="${esc(when)}"><span class="session-card__day" aria-hidden="true">${esc(d.toLocaleString(tag, { day: 'numeric' }))}</span><span class="session-card__mon" aria-hidden="true">${esc(d.toLocaleString(tag, { month: 'short' }))}</span><span class="session-card__full">${esc(full)}</span></time>
         <div class="session-card__title">${title}</div>
         <div class="session-card__who">${who || ''}${sub}</div>
         <div class="session-card__drawn">${drawn}</div>
         ${pill}
       </a>`);
    navLink(card, resultsPath(round.id, s.id), () => showResults(round, s));
    return card;
  }

  /* Das Programmheft's edition line (#1379, P13.1 desktop / P13.2 phone). Same
     link, target and words as the Klassisch card. The headline is the game; the
     line under it says who won („Jonas hat gewonnen", Ocean's key) or how the
     night ended, then „4 dabei" and how many games the pool drew — the sheet's
     „4 dabei · 3 Spiele". The score is the ordinary pill, which programmheft.css
     prints as a bare display numeral in the ramp's colour.

     The date is rendered twice, Brücke's shape: „14. September" as the desktop's
     own column, and the same words again at the head of the phone's sub-line
     (P13.2 „14. September · 4 dabei · 3 Spiele"). The copy in the sub-line is
     aria-hidden, the column is the one read at every width — the stylesheet only
     swaps which of the two is SEEN, so DOM order stays reading order. */
  function buildSessionEdition(s, { when, chosen, sPeople, thumbIcon, title, pill, outcome }) {
    const day = new Date(s.createdAt).toLocaleString(localeTag(locale), { day: 'numeric', month: 'long' });
    const winners = (s.winnerIds || []).map((wid) => sPeople.find((p) => p.id === wid)).filter(Boolean);
    let who = '';
    if (outcome === 'split') who = iconText('ti-layout-grid', t('sessions.split'));
    else if (winners.length) who = `<span class="session-card__won">${esc(tn(winners.length, 'chronik.wonOne', 'chronik.won', { names: winners.map(personLabel).join(', ') }))}</span>`;
    else if (s.finished) who = endingText(s) || iconText('ti-check', t('sessions.played'));
    else if (outcome === 'cancelled') who = `<span class="session-card__cancelled">${iconText('ti-x', t('sessions.cancelled'))}</span>`;
    const meta = [];
    if (who) meta.push(who);
    if (sPeople.length) meta.push(esc(tn(sPeople.length, 'chronik.seatedOne', 'chronik.seated')));
    if (s.gameIds && s.gameIds.length) meta.push(esc(tn(s.gameIds.length, 'home.chip.gamesOne', 'home.chip.games')));
    // A night with no game has the date as its TITLE already, so neither copy of
    // it is printed a second time.
    const dated = Boolean(chosen);
    const card = h(`<a class="session-card session-card--edition">
         ${dated ? `<time class="session-card__date" datetime="${esc(s.createdAt)}" title="${esc(when)}">${esc(day)}</time>` : ''}
         <div class="session-card__img">${thumbIcon}</div>
         <div class="session-card__body">
           <div class="session-card__title">${title}</div>
           <div class="session-card__meta">${dated ? `<span class="session-card__when" aria-hidden="true">${esc(day)} · </span>` : ''}${meta.join(' · ')}</div>
         </div>
         ${pill}
       </a>`);
    if (chosen && chosen.image) loadCover(card.querySelector('.session-card__img'), coverUrl(chosen.image, COVER_THUMB));
    navLink(card, resultsPath(round.id, s.id), () => showResults(round, s));
    return card;
  }

  /* Shelf changes recede under Der Tisch (#1271): a run of two or more
     consecutive changes inside one month folds behind ONE quiet disclosure
     („5 Regal-Änderungen"), so the sessions carry the page. Nothing is hidden
     for good — the button expands the same rows, delete buttons and links the
     Klassisch timeline shows. A lone change stays in place as a light row:
     folding a single line behind a button would cost a tap to read one line. */
  function buildChangeRun(run) {
    const id = `tl-run-${++chronikRunSeq}`;
    const wrap = h(`<div class="tl-run">
         <button type="button" class="tl-run__toggle" aria-expanded="false" aria-controls="${id}">
           <i class="ti ti-cards" aria-hidden="true"></i>
           <span class="tl-run__label">${esc(tn(run.length, 'chronik.changesOne', 'chronik.changes'))}</span>
           <i class="ti ti-chevron-down tl-run__chev" aria-hidden="true"></i>
         </button>
         <div class="tl-run__list" id="${id}" hidden></div>
       </div>`);
    const toggle = wrap.querySelector('.tl-run__toggle');
    const list = wrap.querySelector('.tl-run__list');
    run.forEach((e) => list.appendChild(buildItem(e)));
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      list.hidden = !open;
    });
    return wrap;
  }

  function buildActivityRow(e) {
    // #137: an entry is part of the round's shared history, so removing one is
    // co-owner and up. Below that the button is not rendered at all — the row
    // still opens its target, and the route refuses the delete regardless.
    const canDelete = roundCan(round, 'activity.delete');
    // Navigate to the game (if it still exists) or to the archive.
    const gameExists = e.gameId && round.games.some((g) => g.id === e.gameId);
    const target =
      e.type === 'game_retired'
        ? { path: roundPath(rid, 'retired'), nav: () => showRetired(rid) }
        : e.type === 'game_completed'
          ? { path: roundPath(rid, 'completed'), nav: () => showCompleted(rid) }
          : gameExists
            ? { path: gamePath(rid, e.gameId), nav: () => showGameDetail(rid, e.gameId) }
            : null;
    // Only the TEXT becomes an <a> (#330): the row also holds the delete button,
    // and a <button> inside an <a> is invalid markup. So the text carries the
    // href — new tab, copy address, link semantics — while the row keeps the
    // generous click target it always had around it.
    const by = e.by ? `<span class="tl-act__by">${esc(t('activity.by', { name: e.by }))}</span>` : '';
    const tier = chronikTier(e.type);
    const row = h(`<div class="tl-act${target ? ' tl-act--link' : ''}${tier ? ` tl-act--${tier}` : ''}">
         <span class="tl-act__icon"><i class="ti ${e.icon}" aria-hidden="true"></i></span>
         ${target ? `<a class="tl-act__text">${esc(e.text)}</a>` : `<span class="tl-act__text">${esc(e.text)}</span>`}
         ${by}
         <span class="tl-act__time">${fmtDateTime(e.at)}</span>
         ${canDelete ? `<button class="tl-act__del" title="${esc(t('activity.delete'))}" aria-label="${esc(t('activity.delete'))}"><i class="ti ti-x" aria-hidden="true"></i></button>` : ''}
       </div>`);
    if (target) {
      navLink(row.querySelector('.tl-act__text'), target.path, target.nav);
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('.tl-act__del')) return; // delete is not "open"
        // The anchor owns its own clicks — including a Cmd/middle-click, which
        // it lets through to the browser. Navigating here too would open the
        // new tab AND move this one.
        if (ev.target.closest('.tl-act__text')) return;
        target.nav();
      });
    }
    if (canDelete) row.querySelector('.tl-act__del').addEventListener('click', async () => {
      if (!await confirmDialog({
        body: t('activity.deleteConfirm'), confirmLabel: t('activity.delete'), icon: 'ti-trash',
      })) return;
      try {
        await api('DELETE', `/api/rounds/${rid}/activities/${e.id}`);
        toast(t('activity.deleted'));
        showRound(rid, 'chronik');
      } catch (err) { toast(err.message, { tone: 'error' }); }
    });
    return row;
  }

  // Month-grouped timeline, newest first.
  function renderTimeline() {
    tl.innerHTML = '';
    const visible = entries.filter((e) =>
      chronikFilter === 'all' ? true : chronikFilter === 'sessions' ? e.kind === 'session' : e.kind === 'activity'
    );
    if (visible.length === 0) {
      const empty = tl.appendChild(emptyState({ icon: 'ti-history', title: t('chronik.emptyTitle'), text: t('chronik.empty') }));
      // Ocean's one next step (#1216, O7.1): the hub's own „Abtauchen", and only
      // where it can start something — no session yet AND a game to draw from.
      // Die Brücke's is its „Mission starten" with the ignition's rocket (#1243, B7.2).
      if ((ocean || bruecke) && !entries.some((e) => e.kind === 'session') && round.games.some(isActiveGame)) {
        emptyStateAction(empty, { icon: bruecke ? 'ti-rocket' : 'ti-tornado', label: t(bruecke ? 'round.startSessionBruecke' : 'round.startSessionOcean'), primary: true, onClick: () => showStartSession(round) });
      }
      return;
    }
    // Only the unfiltered view folds: with „Regal-Änderungen" chosen, the
    // changes ARE the page, and one disclosure per month would hide all of it.
    // Ocean folds the same way (#1218): O13.1 draws the sessions alone, and a
    // month of shelf bookkeeping between two rows would bury them.
    // Die Brücke too (#1245): B3.3 lists the sessions, one line each.
    // Das Programmheft too (#1379): P13.1 prints the editions, a lone change
    // between them stays a line of its own.
    // Forest too (#1473): F13.1 walks the sessions, a run of changes folds.
    const fold = (tisch || ocean || bruecke || programmheft || forest) && chronikFilter === 'all';
    let lastMonth = '';
    for (let i = 0; i < visible.length;) {
      const e = visible[i];
      const month = fmtMonth(e.at);
      if (month !== lastMonth) {
        lastMonth = month;
        // Ocean's month heading carries the month's session count after a
        // hairline (O13.1 „Monatsüberschrift mit Linie"). Counted over what the
        // filter shows, so „Regal-Änderungen" alone never claims sessions.
        const played = ocean ? visible.filter((v) => v.kind === 'session' && fmtMonth(v.at) === month).length : 0;
        tl.appendChild(h(`<div class="tl-month">${ocean ? `<span class="tl-month__name">${esc(month)}</span>${played ? `<span class="tl-month__count">${esc(tn(played, 'home.chip.sessionsOne', 'home.chip.sessions'))}</span>` : ''}` : esc(month)}</div>`));
      }
      if (fold && e.kind === 'activity') {
        let j = i + 1;
        while (j < visible.length && visible[j].kind === 'activity' && fmtMonth(visible[j].at) === month) j++;
        if (j - i > 1) {
          tl.appendChild(buildChangeRun(visible.slice(i, j)));
          i = j;
          continue;
        }
      }
      tl.appendChild(buildItem(e));
      i++;
    }
  }

  function buildItem(e) {
    const dot = e.kind === 'session' ? ' tl-dot--session'
      : chronikTier(e.type) === 'milestone' ? ' tl-dot--milestone' : '';
    const item = h(`<div class="tl-item"><span class="tl-dot${dot}"></span></div>`);
    item.appendChild(e.kind === 'session' ? buildSessionCard(e.session) : buildActivityRow(e));
    // The tables of a split evening, indented under the parent they came from
    // (#796). Newest-first everywhere else in this timeline, but a split's
    // tables are siblings of one moment, so they keep their creation order.
    const kids = e.kind === 'session' ? childrenOf.get(e.session.id) : null;
    if (kids && kids.length) {
      const nest = h('<div class="tl-nest"></div>');
      kids.forEach((child) => nest.appendChild(buildSessionCard(child)));
      item.appendChild(nest);
    }
    if (e.kind === 'session') chronikBadgeRows(round, badgeRows.get(e.session.id)).forEach((row) => item.appendChild(row));
    return item;
  }
  renderTimeline();
  // Deleting (or leaving) the round used to end this timeline, and it was the one
  // round action with no good home at any width: unlike the Regal's footer this
  // one was not `rail-owned`, so it stayed below the whole history on desktop too,
  // while the rail carried no entry for it. It is the danger zone of the round's
  // Einstellungen screen now (#561) — deleting a round is not a history concern.
}
