/* Spielwirbel – views: Pokale as the round's Ehrentafel (#1857).

   The pieces renderPokaleTab (views-pokale.js) places, each derived on every
   render from the sessions — nothing is stored, so deleting a session updates
   all of them:

     .pokale-news      „Neu seit <Spiel> · <Datum>": what the round's latest
                       finished session changed — its new Abzeichen, a record
                       it set, the challenge step it made. Absent when it
                       changed nothing.
     .pokale-plaque    the round as ONE plaque: name and span, the records,
                       the challenge row, the round's own Abzeichen row.
     .pokale-pins      a person's pins + „N unterwegs ›" as a button INSIDE a
                       bar or table row, where that row is the person's plaque.
     .badge-section    every other case's person plaques (renderBadgeSection,
                       at the foot of this file): one badgeHolderRow each.

   Part of the frontend; all files share one global script scope. Every caller
   reaches these at RENDER time, so the files loading after this one
   (views-badges.js, views-challenges.js) are fine
   (.claude/rules/frontend-script-load-order.md). */

'use strict';

// The round's latest finished session, by when it was played — the order
// badgeContext and fillBadgeMoment use, so the three agree on „latest".
function pokaleLatestSession(finished) {
  return [...finished]
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .pop() || null;
}

/* What the latest finished session changed, as { latest, items } — or null
   before the first one. Items, in this order:

     { kind: 'badge', key, holder, memberId, tier }   one per MARK, not per tier
     { kind: 'record', record: 'longest'|'mostPlayed', gameId }
     { kind: 'challenge', done }

   Marks come from `newSince`, the result moment's derivation. Two tiers of
   one mark crossed in one evening are one item at the higher tier, and a
   retired member's marks are left out — both exactly as the Start tab's
   „N neue Abzeichen" counts (hubBadgeLine's `isNew` over active members), so
   the band names as many marks as that line promises.

   A RECORD is new only when this session took it from someone: the longest
   session must be LONGER than every earlier one (equalling it is no record),
   and the game must hold Meistgespielt now and not have held it without this
   session. Compared against the current holders only — no stored state. */
function pokaleNewsItems(round, now = Date.now()) {
  const finished = round.sessions.filter((s) => s.finished);
  const latest = pokaleLatestSession(finished);
  if (!latest) return null;
  const items = [];

  const active = new Set(activeMembers(round).map((m) => m.id));
  const marks = new Map();
  newSince(round, latest.id).forEach((x) => {
    if (x.memberId && !active.has(x.memberId)) return;
    const id = `${x.memberId || 'round'}|${x.key}`;
    const prev = marks.get(id);
    if (!prev || (x.tier || 0) > (prev.tier || 0)) marks.set(id, x);
  });
  marks.forEach((x) => items.push({ kind: 'badge', key: x.key, holder: x.holder, memberId: x.memberId, tier: x.tier }));

  const earlier = finished.filter((s) => s.id !== latest.id);
  if (longestSession([latest], round.games)) {
    const prev = longestSession(earlier, round.games);
    if (!prev || latest.durationMinutes > prev.durationMinutes) {
      items.push({ kind: 'record', record: 'longest', gameId: latest.chosenGameId });
    }
  }
  const gid = latest.chosenGameId;
  if (gid && pokaleMostPlayed(round, finished).games.some((g) => g.id === gid)
    && !pokaleMostPlayed(round, earlier).games.some((g) => g.id === gid)) {
    items.push({ kind: 'record', record: 'mostPlayed', gameId: gid });
  }

  // fillChallengeMoment's test: the session is one of the challenge's steps.
  const cur = round.challenge ? currentChallenge(round, now) : null;
  if (cur && cur.steps.some((st) => st.sessionId === latest.id)) {
    items.push({ kind: 'challenge', done: !!(cur.completedAt && cur.completedAt.sessionId === latest.id) });
  }
  return { latest, items };
}

const POKALE_RECORD_NEWS = {
  longest: { icon: 'ti-clock', label: 'pokale.longest' },
  mostPlayed: { icon: 'ti-flame', label: 'pokale.mostPlayed' },
};

// The holder object openBadgeCollection and badgeHolderRow take.
function pokaleBadgeHolder(ctx, memberId) {
  const { round } = ctx;
  if (!memberId) return { mid: 'round', name: round.name, entries: ctx.all.round, round: true };
  const member = round.members.find((m) => m.id === memberId);
  return { mid: memberId, name: member ? member.name : '', entries: ctx.all.members[memberId] || [], member };
}

/* The band. Each item links where its subject lives: a mark opens its
   holder's collection, a record opens its game, the challenge step opens the
   challenge's sheet. A list, not a sentence: every item is its own target. */
function renderPokaleNews(round, ctx, now = Date.now()) {
  const news = pokaleNewsItems(round, now);
  // No `!news.items.length` early return: the check at the end covers it, and
  // also an item whose game or mark has since gone — two guards for one case
  // leave neither testable (.claude/rules/redundant-guards-make-each-other-untestable.md).
  if (!news) return null;
  const game = ctx.gameTitle(news.latest.id);
  const date = fmtDate(news.latest.createdAt);
  const title = game ? t('pokale.news.title', { game, date }) : t('pokale.news.titleBare', { date });
  const sec = h(`<section class="pokale-news" aria-labelledby="pokale-news-title">
       <h2 class="pokale-news__title" id="pokale-news-title">${esc(title)}</h2>
       <ul class="pokale-news__list"></ul>
     </section>`);
  const list = sec.querySelector('.pokale-news__list');
  const cur = news.items.some((x) => x.kind === 'challenge') ? currentChallenge(round, now) : null;
  news.items.forEach((x) => {
    let el = null;
    if (x.kind === 'badge') {
      const holder = pokaleBadgeHolder(ctx, x.memberId);
      const e = holder.entries.find((k) => k.key === x.key);
      if (!e) return;
      const who = ctx.holderName(x.holder, x.memberId);
      el = h(`<button type="button" class="pokale-news__item" data-kind="badge" aria-haspopup="dialog">
           ${badgeEmblem(e.glyph, 'pokale-news__pin', e.holder)}
           <span class="pokale-news__text">${esc(who)} · ${esc(badgeName(e, x.tier || undefined))}</span>
         </button>`);
      el.addEventListener('click', () => openBadgeCollection(el, ctx, holder));
    } else if (x.kind === 'record') {
      const g = round.games.find((k) => k.id === x.gameId);
      if (!g) return;
      const def = POKALE_RECORD_NEWS[x.record];
      el = h(`<a class="pokale-news__item" data-kind="record">
           <i class="ti ${def.icon} pokale-news__icon" aria-hidden="true"></i>
           <span class="pokale-news__text">${esc(t('pokale.news.record', { record: t(def.label), game: g.title }))}</span>
         </a>`);
      makeGameLink(el, round.id, g.id);
    } else if (cur) {
      const goal = challengeGoalText(cur);
      el = h(`<button type="button" class="pokale-news__item" data-kind="challenge" aria-haspopup="dialog">
           <i class="ti ${x.done ? 'ti-flag-check' : 'ti-flag'} pokale-news__icon" aria-hidden="true"></i>
           <span class="pokale-news__text">${esc(t(x.done ? 'challenge.moment.completed' : 'challenge.moment.advanced', { goal }))}</span>
         </button>`);
      el.addEventListener('click', () => openChallengeOverview(round, el, now));
    }
    if (!el) return;
    const li = h('<li class="pokale-news__entry"></li>');
    li.appendChild(el);
    list.appendChild(li);
  });
  return list.children.length ? sec : null;
}

/* The round's plaque: headed with its name and „N Sessions seit <Monat>" (the
   Chronik's own key, counted the same way), then the records, the challenge
   row and the round's Abzeichen row — which keeps `id="abzeichen-round"`, so
   the Chronik's and the result screen's deep links still open it. */
function renderPokaleRoundPlaque(round, finished, { records, challenge, ctx }) {
  const since = finished.reduce((a, s) => (s.createdAt < a ? s.createdAt : a), finished[0].createdAt);
  const el = h(`<section class="pokale-plaque" aria-labelledby="pokale-plaque-title">
       <div class="pokale-plaque__head">
         <h2 class="pokale-plaque__title" id="pokale-plaque-title">${esc(round.name)}</h2>
         <span class="pokale-plaque__since">${esc(tn(finished.length, 'chronik.countOne', 'chronik.count', { month: fmtMonth(since) }))}</span>
       </div>
     </section>`);
  if (records) el.appendChild(records);
  if (challenge) el.appendChild(challenge);
  el.appendChild(badgeHolderRow(ctx, { ...pokaleBadgeHolder(ctx, null), label: t('badges.title') }));
  return el;
}

/* A person's Abzeichen inside their bar or table row: the earned pins with
   „+N" (the badge rows' own cut-offs and classes, so every design's pin skin
   reaches them), „N unterwegs" and a chevron, opening their collection. It
   carries the holder-row id, so badgeRevealTarget lands on it. */
function pokaleMemberPins(ctx, m) {
  const holder = pokaleBadgeHolder(ctx, m.id);
  const earned = holder.entries.filter((e) => e.state === 'earned');
  const progress = holder.entries.filter((e) => e.state === 'progress').length;
  const counts = [tn(earned.length, 'badges.count.earnedOne', 'badges.count.earned')];
  if (progress) counts.push(tn(progress, 'badges.count.progressOne', 'badges.count.progress'));
  const more = [BADGE_ROW_PINS_NARROW, BADGE_ROW_PINS].filter((cut) => earned.length > cut)
    .map((cut) => `<span class="badge-member__more" data-cut="${cut}">+${earned.length - cut}</span>`).join('');
  // With nothing earned there are no pins to speak for the row, so the text
  // says the count instead of leaving a bare chevron.
  const text = progress ? counts[1] : (earned.length ? '' : counts[0]);
  const btn = h(`<button type="button" class="pokale-pins" id="abzeichen-${esc(m.id)}" data-mid="${esc(m.id)}" aria-haspopup="dialog">
       <span class="badge-member__pins pokale-pins__pins" aria-hidden="true">${earned.slice(0, BADGE_ROW_PINS).map((e) => badgeEmblem(e.glyph, 'badge-member__pin', e.holder)).join('')}${more}</span>
       ${text ? `<span class="pokale-pins__text">${esc(text)}</span>` : ''}
       <i class="ti ti-chevron-right pokale-pins__go" aria-hidden="true"></i>
     </button>`);
  btn.setAttribute('aria-label', `${t('badges.title')}: ${m.name}, ${counts.join(' · ')}`);
  btn.addEventListener('click', () => openBadgeCollection(btn, ctx, holder));
  return btn;
}

/* Pokale › Abzeichen — the PEOPLE's plaques since #1857 (moved here from
   views-badges.js with it): one row per active member in the standings order
   (`ranked`, roundStandings), so the two lists on one page cannot disagree
   about who comes first. A row leads with the place (only when `rankOf` is
   given, i.e. the stage ranks people) and the wins, and draws the holder's
   EARNED marks as pins, so it is one line at every width — no legend, no dense
   mode. The whole row is a <button> (badgeHolderRow) that opens the holder's
   collection. The round's own row is on the round's plaque. A round with no
   finished session gets one line and no rows — no wall of grey padlocks.

   Not rendered where the standings already are one row per person (bars,
   table): those rows carry `pokaleMemberPins` instead. */
function renderBadgeSection(round, ranked, opts = {}) {
  const sec = h(`<section class="section badge-section" id="abzeichen" tabindex="-1" aria-labelledby="abzeichen-title">
       <div class="section-head"><h2 id="abzeichen-title">${iconText('ti-medal', t('badges.title'))}</h2></div>
     </section>`);
  if (!round.sessions.some((s) => s.finished)) {
    sec.appendChild(h(`<p class="muted badge-section__empty">${esc(t('badges.empty'))}</p>`));
    return sec;
  }
  const ctx = opts.ctx || badgeContext(round);
  const members = ranked || activeMembers(round);
  /* The section is the people's plaques since #1857: the round's own row moved
     onto the round's plaque (renderPokaleRoundPlaque), and what is new since
     the last session is the band's to say — so the summary is the members'
     earned count alone. */
  const earned = members.reduce((n, m) => n + (ctx.all.members[m.id] || []).filter((e) => e.state === 'earned').length, 0);
  sec.querySelector('.section-head').appendChild(h(`<span class="badge-section__summary">${esc(tn(earned, 'badges.count.earnedOne', 'badges.count.earned'))}</span>`));

  /* An ordered list: standings order is meaning (.claude/rules/tiles-vs-lists.md).
     It may tile from 1280px only when every plaque prints its place — the
     numeral is what keeps rank 4 legible once it wraps under rank 1 (#1576). */
  const placed = !!opts.rankOf;
  const list = h(`<ol class="badge-members${placed ? ' badge-members--placed' : ''}"></ol>`);
  members.forEach((m) => {
    const li = h('<li class="badge-members__item"></li>');
    li.appendChild(badgeHolderRow(ctx, {
      mid: m.id, name: m.name, entries: ctx.all.members[m.id] || [], member: m,
      wins: opts.wins ? opts.wins[m.id] || 0 : null,
      place: placed ? opts.rankOf[m.id] || null : null,
    }));
    list.appendChild(li);
  });
  sec.appendChild(list);
  return sec;
}
