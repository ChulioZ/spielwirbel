/* Spielwirbel – views: Abzeichen in Klassisch (#1388, K17).

   The SHARED MARKUP every design skins (docs/design/pruefung-abzeichen-2026-09-26.md
   finding 5): the four X17 sheets name these classes identically, so a design
   slice restyles them and never forks the structure. Keep the names exactly:

     .badge (a <button>, data-state="earned|progress|locked|secret", data-new)
       .badge__mark (--pct for the progress ring) .badge__name .badge__line
         (the tier lives in the name alone — „Sessions 10", no corner pill)
     .badge-card                      the tap-open card (popover ≥ 860, sheet below)
     .badge-section                   Pokale › Abzeichen
       .badge-legend (earned · progress · locked, in the section head)
       .badge-band--round, .badge-member (a <details>, standings order)
         .badge-member__rank          „Platz N", the Tafel's place (#1386)
     .badge-moment                    the result screen, at most two marks
     .hub-row--badges                 one line in the hub's Pokale preview
     .chronik-row--badge              one row per earning under its session
     .member-card__badges             the Tischkarte, earned only
       .member-card__badges-go        its chevron link to Pokale (#1386)
     .profile-card__badges            the Spielerkarte's account tier (#1389)

   Everything is DERIVED on every render through achievements.js — nothing is
   stored, so a deleted session takes its marks (and their Chronik rows) with it.
   This file only renders; which mark is earned when is that module's business.

   Words: names and conditions are the catalogue's `badges.<key>.*` strings; the
   rest is `badges.*` in lang/*.js. Composition is limited to joining those with
   „ · ", a month (fmtMonth) and a game title — no sentence is built here.

   Part of the frontend; all files share one global script scope. Loaded after
   achievements.js; every caller (views-pokale.js, hub-previews.js,
   views-chronik.js, views-member.js, views-session.js, views-profile.js) reaches these at RENDER
   time, so the files loading before this one are fine
   (.claude/rules/frontend-script-load-order.md). */

'use strict';

// From this many members a member row shows only its earned marks and folds
// the rest behind „N offen" (X17.8 in all four sheets): 7 × 9 tiles is a wall.
const BADGE_DENSE_FROM = 7;
// The result moment shows at most this many; the rest fold into „+N weitere"
// (handover §3.4, the operator's decision table).
const BADGE_MOMENT_MAX = 2;
// The editor split's breakpoint (sheet.js) — the member rows start open above
// it, where the section is a grid rather than a column of disclosures.
const BADGE_WIDE_FROM = 860;
// The mark a secret entry shows until it is earned (all four sheets).
const BADGE_SECRET_GLYPH = 'ti-lock-question';

/* Where showBadges() wants the Pokale section to land, consumed by the next
   Pokale render of that round: { rid, mid } (mid null = the round's band). */
let badgeTarget = null;

const badgeDefOf = (key) => BADGE_CATALOGUE.find((d) => d.key === key);

/* One render's view of a round: the derived entries plus the three lookups
   every placement needs. */
function badgeContext(round) {
  const all = roundBadges(round);
  const byId = new Map((round.sessions || []).map((s) => [s.id, s]));
  const gameTitle = (sid) => {
    const s = sid && byId.get(sid);
    const g = s && s.chosenGameId && (round.games || []).find((x) => x.id === s.chosenGameId);
    return g ? g.title : null;
  };
  const latest = (round.sessions || [])
    .filter((s) => s.finished)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .pop() || null;
  return {
    round,
    all,
    gameTitle,
    latestGame: latest ? gameTitle(latest.id) : null,
    holderName: (holder, mid) => (holder === 'round'
      ? round.name
      : ((round.members || []).find((m) => m.id === mid) || {}).name || ''),
  };
}

// The name as the tile prints it: „Stammgast 10", or „Geheim" until earned.
function badgeName(e, tier) {
  if (e.state === 'secret') return t('badges.state.secret');
  const name = t(`badges.${e.key}.name`);
  const n = tier === undefined ? e.tier : tier;
  return n ? `${name} ${n}` : name;
}

/* The condition line. `n` is the threshold the line talks about: the next tier
   while one is left (the top one once all are reached), the single goal, or the
   fixed number of a yes/no entry. `allTiers` prints every tier („10 · 25 · 50 ·
   100", the card's form); `at` pins it to a given tier (the moment's). */
function badgeCondition(e, ctx, { allTiers, at } = {}) {
  if (e.state === 'secret') return t('badges.secretLine');
  const def = badgeDefOf(e.key);
  let n = def.goal || def.n || null;
  if (def.tiers) {
    const next = def.tiers.find((th) => !e.tier || th > e.tier);
    n = next === undefined ? def.tiers[def.tiers.length - 1] : next;
    if (at) n = at;
    if (allTiers) n = def.tiers.join(' · ');
  }
  // Dauerbrenner names its game in the condition (handover B10).
  const g = e.gameId && (ctx.round.games || []).find((x) => x.id === e.gameId);
  if (g) return t('badges.evergreen.lineGame', { game: g.title, n });
  // „1 Jahr" is the one condition whose number can be 1 (#1389 — the account
  // tier is the first placement to render Jahre at all).
  if (e.key === 'accountYears' && typeof n === 'number') {
    return tn(n, 'badges.accountYears.lineOne', 'badges.accountYears.line', { n });
  }
  return t(`badges.${e.key}.line`, { n });
}

// „Stufe 10 erreicht im Oktober 2025 · Kartographen" — the card's and the
// accessible name's form of an earning.
function badgeEarnedText(e, ctx) {
  const at = e.earnedAt;
  if (!at || !at.at) return '';
  const month = fmtMonth(at.at);
  const base = e.tier ? t('badges.tierReached', { tier: e.tier, month }) : t('badges.earnedIn', { month });
  const game = ctx.gameTitle(at.sessionId);
  return game ? `${base} · ${game}` : base;
}

const badgeProgress = (e) => (e.count !== null && e.of ? `${e.count} / ${e.of}` : '');
const badgePct = (e) => (e.count !== null && e.of ? Math.max(0, Math.min(100, Math.round((e.count / e.of) * 100))) : null);

// The tile's second line: the short date of an earning (plus the way to the
// next tier), the count and condition while under way, the condition while
// open, and nothing but the secret line for a secret.
function badgeLine(e, ctx) {
  if (e.state === 'earned') {
    const parts = [];
    if (e.earnedAt && e.earnedAt.at) parts.push(fmtMonth(e.earnedAt.at));
    const game = e.earnedAt && ctx.gameTitle(e.earnedAt.sessionId);
    if (game) parts.push(game);
    if (badgeProgress(e)) parts.push(badgeProgress(e));
    return parts.join(' · ');
  }
  if (e.state === 'progress') return `${badgeProgress(e)} · ${badgeCondition(e, ctx)}`;
  return badgeCondition(e, ctx);
}

/* The accessible name, in the sheets' shape: „Stammgast 10, verdient. Stufe 10
   erreicht im Oktober 2025 · Kartographen". The state is always a WORD, so it
   never rests on the colour or the outline alone. */
function badgeAria(e, ctx, holder) {
  const lower = (s) => s.toLocaleLowerCase(localeTag(locale));
  const state = lower(t(`badges.state.${e.state}`)) + (e.isNew ? `, ${lower(t('badges.newMark'))}` : '');
  const detail = e.state === 'earned'
    ? [badgeEarnedText(e, ctx), badgeProgress(e)].filter(Boolean).join(' · ')
    : badgeLine(e, ctx);
  return `${holder ? `${holder}, ` : ''}${badgeName(e)}, ${state}. ${detail}`;
}

/* One tile — a real <button>, so every mark is reachable and operable by
   keyboard. By default it opens the card; `onActivate` replaces that (the
   Tischkarte's tiles go to the Pokale section instead). `line` overrides the
   second line, and `false` drops it (the compact Tischkarte row). The holder
   joins the accessible name only where tiles of several holders sit together
   (`announceHolder`, the result moment) — in a member row the row says it. */
function badgeTile(e, ctx, opts = {}) {
  const pct = badgePct(e);
  const glyph = e.state === 'secret' ? BADGE_SECRET_GLYPH : e.glyph;
  const line = opts.line === undefined ? badgeLine(e, ctx) : opts.line;
  const btn = h(`<button type="button" class="badge" data-state="${esc(e.state)}" data-key="${esc(e.key)}">
       <span class="badge__mark"${pct === null ? '' : ` style="--pct:${pct}"`} aria-hidden="true"><i class="ti ${esc(glyph)}"></i></span>
       <span class="badge__name">${esc(badgeName(e))}</span>
       ${line === false ? '' : `<span class="badge__line">${esc(line)}</span>`}
       ${e.isNew ? `<span class="badge__new" aria-hidden="true">${esc(t('badges.newMark'))}</span>` : ''}
     </button>`);
  if (e.isNew) btn.setAttribute('data-new', '');
  btn.setAttribute('aria-label', badgeAria(e, ctx, opts.announceHolder ? opts.holder : null));
  btn.addEventListener('click', () => (opts.onActivate ? opts.onActivate() : openBadgeCard(btn, e, ctx, opts.holder)));
  return btn;
}

let badgeCardSeq = 0;

/* The tap-open card: name, holder, condition with every tier, the tiers, the
   way to the next one and the earning's date and game. Through openEditor, so
   it is an anchored popover from 860px and a sheet below it — Escape, Back, the
   backdrop and focus restoration come with it
   (.claude/rules/popover-vs-sheet-editors.md). Nothing here is a form, and
   nothing on the page waits for it. */
function openBadgeCard(anchor, e, ctx, holder) {
  const def = badgeDefOf(e.key);
  const id = `badge-card-${++badgeCardSeq}`;
  const glyph = e.state === 'secret' ? BADGE_SECRET_GLYPH : e.glyph;
  openEditor(anchor, 'badge', t('badges.title'), (el) => {
    // The popover is a bare <div>; name it as the dialog the sheet already is.
    if (el.classList.contains('popover')) {
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-labelledby', id);
    }
    const reached = new Set((e.history || []).map((x) => x.tier));
    const tiers = def.tiers && e.state !== 'secret'
      ? `<ol class="badge-card__tiers" aria-label="${esc(t('badges.card.tiers'))}">${def.tiers.map((th) => (reached.has(th)
        ? `<li class="badge-card__tier" data-reached><i class="ti ti-check" aria-hidden="true"></i> ${th}<span class="sr-only">, ${esc(t('badges.state.earned'))}</span></li>`
        : `<li class="badge-card__tier">${th}</li>`)).join('')}</ol>`
      : '';
    const pct = badgePct(e);
    const next = badgeProgress(e)
      ? `<div class="badge-card__next">${esc([def.tiers && e.state === 'earned' ? t('badges.card.next', { n: e.of }) : '', badgeProgress(e)].filter(Boolean).join(' · '))}<span class="badge-card__bar" aria-hidden="true" style="--pct:${pct}"></span></div>`
      : '';
    const earned = badgeEarnedText(e, ctx);
    const card = h(`<div class="badge-card" data-state="${esc(e.state)}">
         <div class="badge-card__head">
           <span class="badge__mark" aria-hidden="true"><i class="ti ${esc(glyph)}"></i></span>
           <div class="badge-card__title">
             <h3 class="badge-card__name" id="${id}" tabindex="-1">${esc(badgeName(e))}</h3>
             ${holder ? `<div class="badge-card__holder">${esc(holder)}</div>` : ''}
           </div>
         </div>
         <p class="badge-card__cond">${esc(badgeCondition(e, ctx, { allTiers: true }))}</p>
         ${tiers}${next}
         ${earned ? `<div class="badge-card__earned">${esc(earned)}</div>` : ''}
       </div>`);
    el.appendChild(card);
    // After the container is live — focus() on a detached node does nothing.
    return () => card.querySelector('.badge-card__name').focus();
  });
}

// Navigate to Pokale › Abzeichen, landing on one member's row (or the round's
// band). The target is consumed by the next Pokale render of that round.
function showBadges(rid, mid) {
  badgeTarget = { rid, mid: mid || null };
  return showRound(rid, 'pokale');
}

// A link to the section: a real href for ⌘-click, showBadges for a plain one.
function badgeLink(el, rid, mid) {
  navLink(el, roundPath(rid, 'pokale'), () => showBadges(rid, mid));
  return el;
}

/* Pokale › Abzeichen. The round's band first, then one row per member in the
   order the standings list them (`ranked`, roundStandings), each carrying its
   tie-aware place from the same call (`rankOf` — only members with a record
   have one, exactly as the Tafel ranks them). A round with no finished session
   gets one line and no tiles — no wall of grey padlocks. */
function renderBadgeSection(round, ranked, rankOf) {
  const sec = h(`<section class="section badge-section" id="abzeichen" tabindex="-1" aria-labelledby="abzeichen-title">
       <div class="section-head"><h2 id="abzeichen-title">${iconText('ti-medal', t('badges.title'))}</h2></div>
     </section>`);
  if (!round.sessions.some((s) => s.finished)) {
    sec.appendChild(h(`<p class="muted badge-section__empty">${esc(t('badges.empty'))}</p>`));
    return sec;
  }
  const ctx = badgeContext(round);
  const members = ranked || activeMembers(round);
  const every = ctx.all.round.concat(...members.map((m) => ctx.all.members[m.id] || []));
  const earned = every.filter((e) => e.state === 'earned').length;
  const fresh = every.filter((e) => e.isNew).length;
  const summary = [tn(earned, 'badges.count.earnedOne', 'badges.count.earned')];
  if (fresh) {
    summary.push(ctx.latestGame
      ? tn(fresh, 'badges.newSinceOne', 'badges.newSince', { game: ctx.latestGame })
      : tn(fresh, 'badges.newOne', 'badges.new'));
  }
  sec.querySelector('.section-head').appendChild(h(`<span class="badge-section__summary">${esc(summary.join(' · '))}</span>`));
  sec.querySelector('.section-head').appendChild(badgeLegend());

  const roundEarned = ctx.all.round.filter((e) => e.state === 'earned').length;
  const band = h(`<div class="badge-band badge-band--round" id="abzeichen-round" tabindex="-1">
       <div class="badge-band__head">
         <span class="badge-band__name">${esc(round.name)}</span>
         <span class="badge-band__count">${esc(t('badges.ofTotal', { n: roundEarned, total: ctx.all.round.length }))}</span>
       </div>
       <div class="badge-grid"></div>
     </div>`);
  const roundGrid = band.querySelector('.badge-grid');
  ctx.all.round.forEach((e) => roundGrid.appendChild(badgeTile(e, ctx, { holder: round.name })));
  sec.appendChild(band);

  const dense = members.length >= BADGE_DENSE_FROM;
  const wide = !!(window.matchMedia && window.matchMedia(`(min-width: ${BADGE_WIDE_FROM}px)`).matches);
  const wantMid = badgeTarget && badgeTarget.rid === round.id ? badgeTarget.mid : null;
  const list = h('<div class="badge-members"></div>');
  members.forEach((m, i) => list.appendChild(badgeMemberRow(round, ctx, m, {
    dense,
    rank: rankOf ? rankOf[m.id] : undefined,
    // Open on a desktop; on a phone the first row (T17.3), or the one a tap
    // on the Tischkarte or a Chronik row asked for.
    open: wide || (wantMid ? wantMid === m.id : i === 0),
  })));
  sec.appendChild(list);
  return sec;
}

/* The key to the drawing (T17.2, O17.2): one swatch per state a tile can show
   before it is opened. Secret is left out, as in every sheet — its padlock
   glyph says so on the tile. aria-hidden: each tile already names its state
   in words, so a screen reader would only hear the key twice. The words are
   the tiles' own state strings; each design draws the swatch as its mark. */
function badgeLegend() {
  return h(`<ul class="badge-legend" aria-hidden="true">${['earned', 'progress', 'locked'].map((st) =>
    `<li class="badge-legend__item" data-state="${st}"><span class="badge-legend__mark"></span>${esc(t(`badges.state.${st}`))}</li>`).join('')}</ul>`);
}

// One member's row: a <details> whose summary is the member, their counts and
// their place in the standings.
function badgeMemberRow(round, ctx, m, { dense, open, rank }) {
  const entries = ctx.all.members[m.id] || [];
  const earned = entries.filter((e) => e.state === 'earned');
  const progress = entries.filter((e) => e.state === 'progress').length;
  const counts = [tn(earned.length, 'badges.count.earnedOne', 'badges.count.earned')];
  if (progress) counts.push(tn(progress, 'badges.count.progressOne', 'badges.count.progress'));
  const row = h(`<details class="badge-member" id="abzeichen-${esc(m.id)}" data-mid="${esc(m.id)}">
       <summary class="badge-member__head">
         <span class="avatar badge-member__avatar" style="background:${memberColor(round, m.id)}">${avatarFace(initials(m.name), { userId: m.userId })}</span>
         <span class="badge-member__name">${esc(m.name)}</span>
         <span class="badge-member__summary">${esc(counts.join(' · '))}</span>
         ${rank ? `<span class="badge-member__rank">${esc(t('badges.rank', { n: rank }))}</span>` : ''}
       </summary>
       <div class="badge-grid"></div>
     </details>`);
  if (open) row.open = true;
  const grid = row.querySelector('.badge-grid');
  const tile = (e) => badgeTile(e, ctx, { holder: m.name });
  // A dense round (X17.8): earned marks in the row, the rest behind „N offen".
  const shown = dense ? earned : entries;
  shown.forEach((e) => grid.appendChild(tile(e)));
  const rest = dense ? entries.filter((e) => e.state !== 'earned') : [];
  if (rest.length) {
    const restId = `abzeichen-${m.id}-offen`;
    const more = h(`<button type="button" class="link-btn badge-member__more" aria-expanded="false" aria-controls="${esc(restId)}">${esc(tn(rest.length, 'badges.count.openOne', 'badges.count.open'))}</button>`);
    const restGrid = h(`<div class="badge-grid badge-grid--rest" id="${esc(restId)}" hidden></div>`);
    rest.forEach((e) => restGrid.appendChild(tile(e)));
    more.addEventListener('click', () => {
      const show = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(show));
      restGrid.hidden = !show;
    });
    row.appendChild(more);
    row.appendChild(restGrid);
  }
  return row;
}

/* After the Pokale page is in the document: land on the row showBadges() asked
   for. Consumed either way, so a later, unrelated visit never scrolls. */
function badgeRevealTarget(rid) {
  const want = badgeTarget;
  badgeTarget = null;
  if (!want || want.rid !== rid) return;
  const el = document.getElementById(want.mid ? `abzeichen-${want.mid}` : 'abzeichen-round')
    || document.getElementById('abzeichen');
  if (!el) return;
  // No `el.open = true` here: renderBadgeSection already opened this row from
  // the same target, and a second opener made each untestable (a deliberate
  // break of either stayed green — .claude/rules/redundant-guards-make-each-other-untestable.md).
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  const focusTo = el.tagName === 'DETAILS' ? el.querySelector('summary') : el;
  focusTo.focus({ preventScroll: true });
}

/* The hub's Pokale preview gets one more line: „2 neue Abzeichen seit
   Nordlichter", or with nothing new the newest mark, „Zuletzt: Teamgeist · Lea".
   Absent before the first finished session. A plain line, not a link — the
   preview card's one link is its „öffnen" (hub-previews.js). */
function hubBadgeLine(round) {
  if (!round.sessions.some((s) => s.finished)) return null;
  const ctx = badgeContext(round);
  const items = ctx.all.round.map((e) => ({ e, holder: round.name }))
    .concat(...activeMembers(round).map((m) => (ctx.all.members[m.id] || []).map((e) => ({ e, holder: m.name }))));
  const fresh = items.filter((x) => x.e.isNew).length;
  let text;
  if (fresh) {
    text = ctx.latestGame
      ? tn(fresh, 'badges.hub.newOne', 'badges.hub.new', { game: ctx.latestGame })
      : tn(fresh, 'badges.hub.newBareOne', 'badges.hub.newBare');
  } else {
    const dated = items.filter((x) => x.e.state === 'earned' && x.e.earnedAt && x.e.earnedAt.at)
      .sort((a, b) => String(b.e.earnedAt.at).localeCompare(String(a.e.earnedAt.at)));
    if (!dated.length) return null;
    text = t('badges.hub.latest', { name: badgeName(dated[0].e), holder: dated[0].holder });
  }
  return h(`<div class="hub-row hub-row--badges">${iconText('ti-medal', text)}</div>`);
}

/* The Chronik's rows: every earning, keyed by the session that produced it —
   members first (seat order), then the round, as newSince orders them. An
   earning no session produced (Regal, Durchgespielt) has no session to sit
   under and gets no row. */
function badgeChronikIndex(round) {
  if (!round.sessions.some((s) => s.finished)) return new Map();
  const all = roundBadges(round);
  const bySession = new Map();
  const collect = (entries, mid) => entries.forEach((e) => (e.history || []).forEach((x) => {
    if (!x.sessionId) return;
    const list = bySession.get(x.sessionId) || [];
    list.push({ key: e.key, glyph: e.glyph, tier: x.tier, holder: e.holder, mid });
    bySession.set(x.sessionId, list);
  }));
  (round.members || []).forEach((m) => collect(all.members[m.id] || [], m.id));
  collect(all.round, null);
  return bySession;
}

// One `.chronik-row--badge` per earning: „Lea · Erster Sieg", linking to that
// holder's place in Pokale › Abzeichen.
function chronikBadgeRows(round, marks) {
  return (marks || []).map((x) => {
    const holder = x.holder === 'round'
      ? round.name
      : ((round.members || []).find((m) => m.id === x.mid) || {}).name || '';
    const name = t(`badges.${x.key}.name`) + (x.tier ? ` ${x.tier}` : '');
    const row = h(`<div class="chronik-row chronik-row--badge">
         <span class="chronik-row__icon"><i class="ti ${esc(x.glyph)}" aria-hidden="true"></i></span>
         <span class="chronik-row__label">${esc(t('badges.title'))}</span>
         <a class="chronik-row__text">${esc(`${holder} · ${name}`)}</a>
       </div>`);
    badgeLink(row.querySelector('a'), round.id, x.mid);
    return row;
  });
}

/* The result moment (handover §3.4): after the winner headline, before the
   table, at most two marks this session produced — any holder — and the rest
   in „+N weitere", which opens Pokale › Abzeichen. `el` is the screen's one
   `.badge-moment`, refilled on every phase change (a winner toggle can earn or
   un-earn a mark) and hidden while it has nothing to say.

   Only for the round's LATEST finished session: this is the moment of earning,
   not an archive — an older session's marks are in the Chronik under it.
   Static by construction: no motion in Klassisch, no focus move, no modal, and
   every name and condition is in the DOM from the first paint.

   `data-fresh` on an item is the one motion hook, and it is design-neutral:
   Klassisch draws nothing from it. It marks a mark this `el` has NOT shown
   before, on any fill after the screen's first — so a cold load of a finished
   session (the first fill) arrives still, and a winner tap's refill replays
   nothing it already showed; only the marks that tap earned are fresh. A
   design that animates the moment keys off the attribute alone. */
const badgeMomentShown = new WeakMap();
function fillBadgeMoment(el, round, session) {
  const seen = badgeMomentShown.get(el); // undefined on the screen's first fill
  const shown = seen || new Set();
  badgeMomentShown.set(el, shown);
  el.replaceChildren();
  el.hidden = true;
  if (!session.finished) return;
  // The screen's own copy of the session is the current one: winner taps
  // mutate it in place, and the round's list may not hold that object.
  const known = round.sessions.some((s) => s.id === session.id);
  const sessions = known ? round.sessions.map((s) => (s.id === session.id ? session : s)) : round.sessions.concat(session);
  const r = { ...round, sessions };
  const latest = sessions.filter((s) => s.finished)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .pop();
  if (!latest || latest.id !== session.id) return;
  const earned = newSince(r, session.id);
  if (!earned.length) return;
  const ctx = badgeContext(r);
  el.hidden = false;
  el.appendChild(h(`<h2 class="badge-moment__title">${iconText('ti-medal', t('badges.moment.title'))}</h2>`));
  const list = h('<ul class="badge-moment__list"></ul>');
  earned.slice(0, BADGE_MOMENT_MAX).forEach((x) => {
    const entries = x.memberId ? ctx.all.members[x.memberId] || [] : ctx.all.round;
    const e = entries.find((k) => k.key === x.key);
    if (!e) return;
    const holder = ctx.holderName(x.holder, x.memberId);
    const item = h(`<li class="badge-moment__item"><span class="badge-moment__holder">${esc(holder)}</span></li>`);
    const id = `${x.memberId || ''}|${x.key}|${x.tier || ''}`;
    if (seen && !shown.has(id)) item.setAttribute('data-fresh', '');
    shown.add(id);
    item.appendChild(badgeTile(e, ctx, { holder, announceHolder: true, line: badgeCondition(e, ctx, { at: x.tier || undefined }) }));
    list.appendChild(item);
  });
  el.appendChild(list);
  const rest = earned.length - BADGE_MOMENT_MAX;
  if (rest > 0) {
    el.appendChild(badgeLink(h(`<a class="link-btn badge-moment__more">${esc(tn(rest, 'badges.moment.moreOne', 'badges.moment.more'))}</a>`), round.id, null));
  }
}

/* The Tischkarte's row (#1074): the member's EARNED marks under the figures —
   never open or secret ones, the card is about who they are. Each opens Pokale ›
   Abzeichen at this member's row, and so does the chevron that closes the row
   (T17.4, O17.4 — #1386): the sheets draw the whole row as that link, but the
   pins are buttons already and cannot nest in an <a>, so the chevron is its
   own named link. Null when there is nothing earned, so a member with no
   sessions gets no empty label. */
function memberCardBadges(round, member) {
  if (!round.sessions.some((s) => s.finished)) return null;
  const ctx = badgeContext(round);
  const earned = (ctx.all.members[member.id] || []).filter((e) => e.state === 'earned');
  if (!earned.length) return null;
  const row = h(`<div class="member-card__badges">
       <span class="member-card__badges-label">${esc(`${t('badges.title')} · ${earned.length}`)}</span>
       <div class="badge-grid badge-grid--compact"></div>
     </div>`);
  const grid = row.querySelector('.badge-grid');
  earned.forEach((e) => grid.appendChild(badgeTile(e, ctx, {
    line: false,
    onActivate: () => showBadges(round.id, member.id),
  })));
  const go = h(`<a class="member-card__badges-go" aria-label="${esc(t('badges.memberAll', { name: member.name }))}"><i class="ti ti-chevron-right" aria-hidden="true"></i></a>`);
  row.appendChild(badgeLink(go, round.id, member.id));
  return row;
}

/* The Spielerkarte's account tier (#1389, X17.7): Sessions · Siege · Runden ·
   Jahre, all four always — open ones included, since the tier ladder IS the
   point of a cross-round mark — under the figures. `badges` is the profile
   payload's `stats.badges` (lib/user-stats.js), which the server sends only to
   the subject and an accepted friend, and never for a demo account: absent
   means no row. The tiles and the card are the round tiles' own
   (badgeTile / openBadgeCard) over a context with no round, since a profile may
   carry none — nothing here can name one.

   The second line: the way to the next tier („41 / 100"), the condition while
   nothing is counted yet or the top tier is reached, and for Jahre the
   registration month, which is what that entry counts from. */
function profileCardBadges(badges, createdAt, holder) {
  if (!Array.isArray(badges) || !badges.length) return null;
  const ctx = { round: { games: [] }, gameTitle: () => null };
  const row = h(`<div class="profile-card__badges">
       <span class="member-card__badges-label">${esc(t('badges.title'))}</span>
       <div class="badge-grid badge-grid--account"></div>
     </div>`);
  const grid = row.querySelector('.badge-grid');
  badges.forEach((e) => {
    let line = (e.state !== 'locked' && badgeProgress(e)) || badgeCondition(e, ctx);
    if (e.key === 'accountYears' && createdAt) line = t('profile.memberSince', { when: fmtMonth(createdAt) });
    grid.appendChild(badgeTile(e, ctx, { holder, line }));
  });
  return row;
}
