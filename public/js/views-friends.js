/* Spielwirbel – Freundeskreis (issue #325): the dedicated friends view and the
   compact home-screen feed section, plus the inbox `friend_request` item.

   A friendship is a cross-account social layer that shares NO round data — only
   feed events ("‹friend› played ‹game›" / "‹friend› added ‹game›"), and only
   those created after the friendship was accepted. Requests are addressed by the
   unique username (#320) and delivered through the inbox (#207).

   Account-mode only: a logged-out visitor (or legacy mode) is sent home. Part of
   the shared frontend scope — loads after account.js/core.js and uses their
   helpers (accountApi/isLoggedIn/accountsActive/refreshInboxBadge, h/esc/app/t/
   toast, syncUrl/setContext/applyBackground, coverUrl/fmtDateTime/initials). */

'use strict';

// How many feed events the collapsed column shows below 1024px, where it sits
// UNDER the grid rather than beside it. Six is what fits without the duplicate
// of the home dashboard's own tile costing a screenful (#1092).
const KREIS_FEED_COLLAPSED = 6;

/* ------------------------------ dedicated view ----------------------------- */

/* Der Kreis (#1092): one state-sorted grid of person cards beside a narrow feed
   column.

   It was four stacked lists, and the order was the inverse of both frequency and
   uniqueness. Measured over 9 friends / 2 incoming / 1 outgoing / 18 events: the
   add form — used once per friend — owned the top slot, the two DUPLICATES (the
   feed, which the home dashboard already shows, and the incoming requests, which
   the inbox already carries) filled the first 1700px, and the roster, the only
   content unique to this screen, started at y = 2119. The first request sat at
   y = 1762 at every viewport from 768 to 2560 — and at y = 4258 for an account
   with 28 friends, i.e. the account that most needs the screen scrolled furthest
   to reach the thing a person is waiting on.

   The diagnosis is that the screen holds two contents with opposite needs. The
   feed is a chronological text line wanting ~360px of measure and getting 766.
   The people are short, unordered entries you scan for ONE of — a grid, not
   rows with their action 511px away. One content per column, action first.

   `opts.feed === 'all'` pre-expands the feed, so the home tile's „Alle anzeigen"
   keeps its promise. */
async function showFriends(opts) {
  // Per-account surface; without an account there is nothing to show.
  if (!(accountsActive() && isLoggedIn())) return showHome();
  const o = opts || {};
  currentView = () => showFriends(o);
  syncUrl('/freunde');
  setContext(t('friends.title'));
  setDocTitle(t('friends.title'));
  applyBackground(null);
  app.innerHTML = '<p class="muted">…</p>';

  let lists;
  let feed;
  try {
    [lists, feed] = await Promise.all([accountApi('GET', '/friends'), accountApi('GET', '/friends/feed')]);
  } catch { return; } // accountApi already handled a dead session (→ login)

  app.innerHTML = '';
  /* One wrapper, so the screen can opt out of the reading measure as a UNIT.
     A screen that "cannot opt out" is usually a screen missing a wrapper
     (.claude/rules/responsive-content-width.md, the #1055 lesson) — and this one
     renders NO navigation at all, which is the licence: widening it moves no
     rail and no dock, the same argument the setup forms use. */
  const screen = h('<div class="friends-screen"></div>');
  screen.appendChild(h(`<div class="lobby-head"><h1>${esc(t('friends.title'))}</h1></div>`));

  const band = renderCircleBand(lists);
  if (band) screen.appendChild(band);

  const split = h('<div class="k-split"></div>');
  const grid = h('<div class="k-grid"></div>');

  /* ORDER IS THE FEATURE: incoming first, then outgoing, then friends. A request
     is the one thing on this screen somebody is waiting on, and it now lands at
     the top whatever the friend count — which is the property the stacked lists
     could not have, since the roster sat above them and grew. */
  lists.incoming.forEach((r) => grid.appendChild(renderPersonCard(r, 'incoming')));
  lists.outgoing.forEach((r) => grid.appendChild(renderPersonCard(r, 'outgoing')));
  lists.friends.forEach((f) => grid.appendChild(renderPersonCard(f, 'friend', feed.events)));
  grid.appendChild(renderAddTile());
  split.appendChild(grid);

  split.appendChild(renderKreisFeed(feed.events, o.feed === 'all'));
  screen.appendChild(split);
  app.appendChild(screen);
}

/* „Der Kreis" made visible (#1093): a row of overlapping avatars above the grid,
   doubling as a way into each profile, with the screen's whole state in one line
   beside it.

   Overlapping avatars are the app's OWN idiom — the home round cards render
   member stacks exactly this way — so this is the established shape one notch
   bolder rather than a new invention.

   ORDER MIRRORS THE GRID: accounts with a pending incoming request first, each
   wearing a brand ring, then friends. The one thing somebody is waiting on is
   the one thing that leads, on both halves of the screen.

   Nothing is rendered for an empty circle: a band with no faces is not a
   picture, and the grid's own empty state already speaks. */
const BAND_MAX = 12;

function renderCircleBand(lists) {
  const waiting = lists.incoming.filter((r) => r.username);
  const people = waiting.concat(lists.friends);
  if (!people.length) return null;

  const wrap = h('<div class="c-band"></div>');
  const ring = h('<div class="c-ring"></div>');
  people.slice(0, BAND_MAX).forEach((p, i) => ring.appendChild(bandAvatar(p, i < waiting.length)));
  const rest = people.length - Math.min(people.length, BAND_MAX);
  /* The overflow chip is DECORATION, not information: the count line beside it
     already states the whole number, so announcing „+16" as well would read the
     same fact twice in a less useful form. */
  if (rest) ring.appendChild(h(`<span class="c-more" aria-hidden="true">+${rest}</span>`));
  wrap.appendChild(ring);

  const bold = (n) => `<strong>${n}</strong>`;
  let text = tn(lists.friends.length, 'friends.band.countOne', 'friends.band.count',
    { n: bold(lists.friends.length) });
  if (lists.incoming.length) {
    text += ` · ${tn(lists.incoming.length, 'friends.band.waitingOne', 'friends.band.waiting',
      { n: bold(lists.incoming.length) })}`;
  }
  wrap.appendChild(h(`<p class="c-band__text">${text}</p>`));
  return wrap;
}

/* One band avatar. NOT `friendAvatar()`: that one is `aria-hidden="true"` on
   purpose, because everywhere it is used today the account's name sits beside it
   in text. Here there is no name beside it, so reusing it would produce a row of
   links with no accessible name at all — the one thing about this band that is
   easy to get wrong and invisible on screen.

   An account with no resolvable username (edge: mid-erasure) has no profile to
   point at and stays a <span>, exactly as `friendRowMain` decided: an <a> with
   no usable href is not a link — not focusable, no affordance. */
function bandAvatar(p, waiting) {
  const name = p.username || '';
  const shown = name || t('friends.unknownUser');
  const color = MEMBER_COLORS[gameHue(shown) % MEMBER_COLORS.length];
  const face = avatarFace(initials(shown), { src: p.avatar });
  const cls = `avatar c-ring__face${waiting ? ' avatar--wait' : ''}`;
  if (!name) {
    return h(`<span class="${cls}" style="background:${color}" aria-hidden="true">${face}</span>`);
  }
  const label = t(waiting ? 'friends.band.avatarWaiting' : 'friends.band.avatarLabel', { user: shown });
  const el = h(`<a class="${cls}" style="background:${color}" href="${esc(profilePath(name))}"
       aria-label="${esc(label)}">${face}</a>`);
  navLink(el, profilePath(name), () => showProfile(name));
  return el;
}

/* The „＋" tile, last in the grid. The add form was a full-width row at the TOP
   of the page for a control used once per friend; as a tile it costs one grid
   cell and sits where you look after scanning the people you already have.

   It becomes the field IN PLACE rather than opening an editor: there is nothing
   to dismiss, and the enclosing <form> is what keeps Enter-to-submit and the
   submit button's semantics. */
function renderAddTile() {
  const tile = h(`<button type="button" class="k-card k-card--add">
       <span class="k-card__plus" aria-hidden="true">＋</span>
       <span class="k-card__name">${esc(t('friends.addTile'))}</span>
       <span class="k-card__line muted">${esc(t('friends.addTileSub'))}</span>
     </button>`);
  tile.addEventListener('click', () => {
    // The placeholder is not the label (WCAG 2.2 SC 3.3.2/4.1.2): it disappears
    // on the first keystroke and screen readers announce an unnamed edit field.
    // There is no visible label to point a <label for> at, so the name goes on
    // the control itself and says what the field is FOR.
    //
    // `friendHandle`, not `friendUser`, and the three data-* opt-outs: this
    // field names ANOTHER account, so a saved login is never the right answer —
    // but Safari offered one anyway, because `autocomplete="off"` is ignored for
    // anything its heuristics read as a login form and an id containing "user"
    // is one of the things they read (#1077). The one-input-plus-submit shape
    // those heuristics also key on is unchanged by the tile, so the id and the
    // opt-outs are the whole mitigation here. See
    // .claude/rules/password-managers-ignore-autocomplete-off.md.
    const form = h(`<form class="k-card k-card--adding friends-add">
         <input class="input" id="friendHandle" type="text" autocomplete="off" spellcheck="false"
                autocapitalize="none" maxlength="30" aria-label="${esc(t('friends.addLabel'))}"
                data-1p-ignore data-lpignore="true" data-bwignore
                placeholder="${esc(t('friends.addPlaceholder'))}" />
         <button class="btn btn--primary btn--sm" type="submit">${esc(t('friends.addSubmit'))}</button>
       </form>`);
    tile.replaceWith(form);
    const input = form.querySelector('#friendHandle');
    input.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = input.value.trim();
      if (!username) return toast(t('friends.needUsername'));
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await accountApi('POST', '/friends', { username });
        toast(t('friends.toast.sent', { user: username }));
        showFriends();
      } catch (err) {
        toast(friendSendError(err.message));
        btn.disabled = false;
      }
    });
  });
  return tile;
}

/* The feed as the second column. It stays a LIST, not a grid: its chronological
   order carries meaning, which is exactly the half of
   .claude/rules/tiles-vs-lists.md that decides between the two shapes — the
   people beside it are unordered and short, so they tile.

   Below 1024px it collapses under the grid to six events plus an expander, so
   the duplicate of the home dashboard's own tile stops costing a screenful. */
function renderKreisFeed(events, expanded) {
  const col = h(`<section class="k-feed">
       <h2 class="friends-section__h">${esc(t('friends.newsTitle'))}</h2>
     </section>`);
  if (!events.length) {
    col.appendChild(h(`<p class="muted empty-note">${esc(t('friends.feedEmpty'))}</p>`));
    return col;
  }
  /* EVERY event is rendered; the collapse is CSS, not a slice. Above 1024px the
     feed is its own sticky column and shows the lot — that is what the column is
     for. Below it the feed sits UNDER the grid, where the same eighteen events
     are a screenful of something the home dashboard already shows, so all but
     the first six are hidden and the expander appears.

     Doing it in CSS rather than by slicing is what keeps it correct without a
     resize listener: a width read once at render time is wrong the moment the
     window changes, and this screen re-renders only on an action. */
  const list = h('<div class="feed-list"></div>');
  events.forEach((ev) => list.appendChild(renderFeedEvent(ev)));
  col.appendChild(list);
  if (expanded) col.classList.add('is-open');
  if (events.length > KREIS_FEED_COLLAPSED) {
    const more = h(`<button type="button" class="link-btn k-feed__more">${esc(t('friends.feedMore', { count: events.length }))}</button>`);
    more.addEventListener('click', () => col.classList.add('is-open'));
    col.appendChild(more);
  }
  return col;
}

/* ------------------------------ account profile ---------------------------- */

// Map a send error code to a localized toast.
function friendSendError(code) {
  const m = {
    user_not_found: 'friends.err.userNotFound',
    cannot_friend_self: 'friends.err.self',
    already_friends: 'friends.err.already',
    request_pending: 'friends.err.pending',
    quota_friends: 'friends.err.quotaFriends',
    quota_requests: 'friends.err.quotaRequests',
  };
  return t(m[code] || 'friends.err.generic');
}

// A small avatar for an account, coloured deterministically from the username so
// a friend keeps the same colour everywhere (no round context to borrow from).
function friendAvatar(username, avatar, extraClass) {
  const name = username || '?';
  const color = MEMBER_COLORS[gameHue(name) % MEMBER_COLORS.length];
  // The picture, when this account has one (#841). `avatar` is the path the
  // payload already carried (profile / friends list / feed), so these surfaces
  // never touch the batch endpoint. The colour stays as the fallback behind it:
  // a picture that 404s degrades to exactly the avatar this app always had.
  //
  // NOT aria-hidden any more on the wrapper alone — it still is, because the
  // name is rendered beside it and alt="" inside would otherwise be announced
  // twice; see avatarFace.
  return `<span class="avatar${extraClass ? ' ' + extraClass : ''}" style="background:${color}" aria-hidden="true">${avatarFace(initials(name), { src: avatar })}</span>`;
}

const friendName = (username) => esc(username || t('friends.unknownUser'));

/* The avatar+name half of a friend/request row, linking to that account's
   profile (#558).

   Only this half becomes an anchor: the row also holds action buttons, and a
   <button> inside an <a> is invalid HTML — the Chronik `.tl-act` case in
   `.claude/rules/in-app-nav-links.md` §3. The row itself deliberately stays an
   inert <div class="ds-row ds-row--static">: #557 removed the false affordance
   from these rows, and `.claude/rules/ds-row-is-a-click-target.md` says a row
   that becomes clickable should become a native element rather than a div that
   re-earns it in JS. So there is no row-level handler here, and therefore no
   modified-click double-navigation to guard against.

   An account with no resolvable username (edge: mid-erasure) has no profile to
   point at, so it stays a <span> — an <a> with no usable href is not a link at
   all (not focusable, no affordance). */
function friendRowMain(username, avatar) {
  const inner = `${friendAvatar(username, avatar)}<span class="friend-row__name">${friendName(username)}</span>`;
  return username
    ? `<a class="ds-row__main friend-row__main friend-row__link" href="${esc(profilePath(username))}">${inner}</a>`
    : `<div class="ds-row__main friend-row__main">${inner}</div>`;
}

// Wire the anchor built above to in-app routing. A no-op when the row had no
// username and therefore rendered a span.
function wireFriendRowMain(row, username) {
  const link = row.querySelector('.friend-row__link');
  if (link) navLink(link, profilePath(username), () => showProfile(username));
  return row;
}

/* --------------------------------- feed ------------------------------------ */

// The localized feed line, with the friend's name and the game title emphasised.
// The lang string is trusted; the two interpolated values are escaped first, so
// injecting the result as HTML is safe.
/* One branch per event type, which is how it has to be read now (#1079).

   It used to be "session_played, else added", the shape lib/feed-events.js's
   header warned would need revisiting — and `games_imported` is that case: it
   carries a COUNT and therefore a plural, so `t()` is not enough.

   `{n}` is `count - 1`, the "and N more" part, so a three-game import reads
   "…and 2 more games" and a two-game one takes the SINGULAR. The route never
   emits this type for one game, so `n` is never 0.

   A row with no count is rendered as a plain `game_added` rather than throwing:
   rows written before this change are still in production feeds and age out
   over MAX_FEED_EVENTS, and the row still carries the title they name. */
function feedText(ev) {
  const params = {
    user: `<strong>${friendName(ev.username)}</strong>`,
    game: `<strong>${esc(ev.title || '')}</strong>`,
  };
  if (ev.type === 'session_played') return t('friends.feed.played', params);
  if (ev.type === 'games_imported' && Number.isInteger(ev.count) && ev.count > 1) {
    const n = ev.count - 1;
    return tn(n, 'friends.feed.importedOne', 'friends.feed.imported', { ...params, n });
  }
  return t('friends.feed.added', params);
}

function renderFeedEvent(ev) {
  const imgStyle = ev.coverUrl ? ` style="background-image:url('${coverUrl(ev.coverUrl, COVER_THUMB)}')"` : '';
  const fallback = ev.coverUrl ? '' : '<i class="ti ti-cards" aria-hidden="true"></i>';
  // The AUTHOR, badged onto the corner of the GAME's cover (#841). The row's one
  // image slot belongs to the game, so the person rides on it rather than taking
  // a fourth column — which on a phone would push the line that carries the
  // actual news further right. It needs the wrapper because .feed-item__img is
  // `overflow: hidden` and would clip a badge placed inside it.
  //
  // aria-hidden: the author's name is already in the line beside it, in bold.
  const who = friendAvatar(ev.username, ev.avatar, 'feed-item__who');
  const item = h(`<div class="feed-item">
      <span class="feed-item__media">
        <span class="feed-item__img"${imgStyle}>${fallback}</span>
        ${who}
      </span>
      <div class="feed-item__body">
        <div class="feed-item__text">${feedText(ev)}</div>
        <div class="feed-item__time muted">${esc(fmtDateTime(ev.at))}</div>
      </div>
    </div>`);

  // Report this item to the operator (#559). The feed is the only screen where
  // one user sees another's free text, so the DSA Art. 16(1) notice channel gets
  // an entry point here rather than only in the footer. The URL is built at
  // render time and is null when the contact channel is unconfigured or the
  // event names no account — then no button is rendered at all.
  //
  // The subject goes in UNESCAPED, unlike feedText's interpolations: it is a
  // query-string value the reporter will see and may edit in a plain text
  // field, not markup.
  const url = feedReportUrl({
    username: ev.username,
    subject: t('friends.feed.reportSubject', {
      user: ev.username || '',
      game: ev.title || '',
      date: fmtDateTime(ev.at),
    }),
  });
  if (url) {
    const btn = h(`<button class="feed-item__report" type="button"
        aria-label="${esc(t('friends.feed.report'))}" title="${esc(t('friends.feed.report'))}">
        <i class="ti ti-flag" aria-hidden="true"></i></button>`);
    // New tab (#390), matching the feedback button, so the SPA stays loaded
    // behind the contact page; noopener prevents a window.opener leak.
    btn.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
    item.appendChild(btn);
  }
  return item;
}

/* Report an ACCOUNT to the operator (#841), the DSA Art. 16(1) entry point for a
   profile picture — the second thing on this app one user sees another user
   author, after the feed's game titles (#559).

   Reuses report-link.js's deep link into the public contact form: no new
   endpoint and no new notice shape, so it lands in the same Meldungen inbox with
   the same Art. 16(4) acknowledgement. Returns null — and therefore renders
   nothing — when the contact channel is unconfigured or the row names no
   account, which is report-link.js's own gate and must not be second-guessed
   here. */
function accountReportButton(username) {
  const url = feedReportUrl({
    username,
    subject: t('friends.reportAccountSubject', { user: username || '' }),
  });
  if (!url) return null;
  const btn = h(`<button class="link-btn friend-row__report" type="button"
      aria-label="${esc(t('friends.reportAccount'))}" title="${esc(t('friends.reportAccount'))}">
      <i class="ti ti-flag" aria-hidden="true"></i></button>`);
  // New tab (#390), matching the feed's report button and the feedback button,
  // so the SPA stays loaded behind the contact page; noopener prevents a
  // window.opener leak.
  btn.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
  return btn;
}

/* ----------------------------- request/friend rows ------------------------- */

/* ONE card for all three states (#1092), replacing renderIncomingRequest,
   renderOutgoingRequest and renderFriendRow. They were the same markup three
   times with a different `.ds-row__meta`, and the state was carried by which
   HEADING they sat under — so removing the headings is what forces the card to
   state its own status.

   `.claude/rules/account-profiles.md` binds unchanged: only the avatar+name half
   is an <a>, because the card keeps its action buttons and a <button> inside an
   <a> is invalid HTML. The CARD is not a click target and must not promise one
   (.claude/rules/ds-row-is-a-click-target.md). An account with no resolvable
   username (edge: mid-erasure) stays a <span> — an <a> with no usable href is
   not a link at all.

   Requests are the one LIFTED state: a brand left edge and a tint, so the
   actionable cards read as different without a heading above them. */
function renderPersonCard(p, state, events) {
  const card = h(`<div class="k-card k-card--${state}">
      <div class="k-card__who"></div>
      <div class="k-card__meta"></div>
    </div>`);
  /* The wash (#1094): that friend's most recently played cover, bled into the
     card's right side so every card carries a colour taken from what the person
     actually plays. The art is already in the `/friends/feed` payload the second
     line is derived from, so it costs no request.

     FRIENDS ONLY, and only with an event. A card with no recent activity stays
     plain — that is a difference the grid should show, not hide — and request
     cards keep their lifted brand edge from #1092 as the one loud thing in the
     grid, which art would compete with.

     Requested at thumb size: the grid can hold 28 of these
     (.claude/rules/provider-cover-sizing.md). */
  const last = state === 'friend' ? lastEventOf(p, events) : null;
  if (last && last.coverUrl) {
    card.insertBefore(
      h(`<div class="k-card__art" style="background-image:url('${coverUrl(last.coverUrl, COVER_THUMB)}')"></div>`),
      card.firstChild);
  }

  const who = card.querySelector('.k-card__who');
  who.innerHTML = friendRowMain(p.username, p.avatar);
  wireFriendRowMain(card, p.username);

  // The second line: what this person last did, else how long you have been
  // friends. Both come from payloads the view already holds — `since` is the
  // acceptedAt the friends list has always returned and nothing rendered.
  const line = personCardLine(p, state, events);
  if (line) who.appendChild(h(`<div class="k-card__line muted">${line}</div>`));

  const meta = card.querySelector('.k-card__meta');
  if (state === 'incoming') {
    meta.appendChild(h(`<button class="btn btn--primary btn--sm friend-req__accept" type="button">${esc(t('friends.accept'))}</button>`));
    meta.appendChild(h(`<button class="link-btn friend-req__decline" type="button">${esc(t('friends.decline'))}</button>`));
    meta.querySelector('.friend-req__accept').addEventListener('click', async () => {
      try {
        await accountApi('POST', `/friends/${p.friendshipId}/accept`);
        toast(t('friends.toast.accepted'));
        refreshInboxBadge();
        showFriends();
      } catch (err) {
        toast(err.message === 'quota_friends' ? t('friends.err.quotaFriends') : t('friends.err.generic'));
      }
    });
    meta.querySelector('.friend-req__decline').addEventListener('click', async () => {
      try { await accountApi('POST', `/friends/${p.friendshipId}/decline`); } catch {}
      refreshInboxBadge();
      showFriends();
    });
  } else if (state === 'outgoing') {
    meta.appendChild(h(`<button class="link-btn friend-req__cancel" type="button">${esc(t('friends.cancel'))}</button>`));
    meta.querySelector('.friend-req__cancel').addEventListener('click', async () => {
      try { await accountApi('POST', `/friends/${p.friendshipId}/decline`); } catch {}
      showFriends();
    });
  } else {
    meta.appendChild(h(`<button class="link-btn friend-row__remove" type="button">${esc(t('friends.unfriend'))}</button>`));
    meta.querySelector('.friend-row__remove').addEventListener('click', async () => {
      if (!await confirmDialog({
        body: t('friends.unfriendConfirm', { name: p.username || t('friends.unknownUser') }),
        confirmLabel: t('friends.unfriend'),
      })) return;
      try {
        await accountApi('DELETE', `/friends/${p.friendshipId}`);
        toast(t('friends.toast.removed'));
        showFriends();
      } catch { toast(t('friends.err.generic')); }
    });
  }
  // Outgoing carries no report button: you are the one who reached out, and the
  // account has not accepted, so there is nothing of theirs on screen to report.
  if (state !== 'outgoing') {
    const report = accountReportButton(p.username);
    if (report) meta.appendChild(report);
  }
  return card;
}

/* The card's second line. A request says what it is; a friend gets their most
   recent event out of the feed the view already fetched, and falls back to the
   friendship's own age.

   The date is RELATIVE within the last month — „gestern", „vor 3 Tagen",
   „letzte Woche" — and absolute past it. #1092 shipped it absolute because a
   relative one has to count LOCAL CALENDAR days or it says „gestern" for
   something 14 hours old, and the helper that does that correctly (`dayIndexOf`)
   landed with #1080; this is that follow-up.

   The cutoff is the point: a friendship two years old reads „seit September
   2024", never „vor 743 Tagen". `fmtRelativeDays` returns null past it and this
   falls back, so the threshold lives in one place. */
/* That account's most recent feed event, or null. Shared by the card's second
   line and its cover wash (#1094) so the two can never describe different
   games — the wash IS the line's game, rendered as colour. */
function lastEventOf(p, events) {
  return (events || []).find((ev) => ev.username && ev.username === p.username) || null;
}

function personCardLine(p, state, events) {
  if (state === 'incoming') return esc(t('friends.card.wants'));
  if (state === 'outgoing') return esc(t('friends.card.sent'));
  const last = lastEventOf(p, events);
  if (last) {
    const rel = fmtRelativeDays(dayIndexOf(Date.now()) - dayIndexOf(last.at));
    return `${esc(last.title || '')} · ${esc(rel || fmtDate(last.at))}`;
  }
  return p.since ? esc(t('friends.card.since', { when: fmtMonth(p.since) })) : '';
}

/* -------------------------- home-screen feed section ----------------------- */

// The compact feed on the home screen. Rendered only in accounts mode with >= 1
// friend (#325); otherwise the placeholder section is removed so home is
// unchanged for everyone else. Called (not awaited) by showHome.
async function renderHomeFriends(section) {
  // `slotOf` because the tile sits in a `.card-slot` carrying the flow's
  // spacing (#946) — removing only the section leaves an empty padded box.
  if (!(accountsActive() && isLoggedIn())) { slotOf(section).remove(); return; }
  let feed;
  try { feed = await accountApi('GET', '/friends/feed'); } catch { slotOf(section).remove(); return; }
  // The section (and its host view) may have been re-rendered while we awaited.
  if (!section.isConnected) return;

  section.innerHTML = '';
  const head = h(`<div class="dash-tile__head">
      <h2>${esc(t('friends.home.title'))}</h2>
      <a class="link-btn" href="/freunde">${esc(t('friends.home.all'))}</a>
    </div>`);
  // „Alle anzeigen" opens the feed EXPANDED (#1092): the screen collapses it to
  // six below 1024px, so a link promising all of them has to say so.
  navLink(head.querySelector('a'), '/freunde', () => showFriends({ feed: 'all' }));
  section.appendChild(head);

  /* No friends yet is an EMPTY STATE, not an absence (#842). This section used
     to remove itself here, so an account with no friends got the round grid and
     then a hole — and the section it would have needed in order to FIND anyone
     was the one that had disappeared. The three removals above stay: those are
     "this instance has no friends feature" / "we could not ask", which is a
     different answer from "you have nobody yet". */
  if (!feed.friendCount) {
    const invite = h(`<a class="friends-invite">
        <span class="friends-invite__icon"><i class="ti ti-user-plus" aria-hidden="true"></i></span>
        <span class="friends-invite__title">${esc(t('friends.home.noneTitle'))}</span>
        <span class="friends-invite__sub muted">${esc(t('friends.home.noneSub'))}</span>
        <span class="friends-invite__action">${esc(t('friends.home.noneAction'))}</span>
      </a>`);
    navLink(invite, '/freunde', () => showFriends());
    section.appendChild(invite);
    return;
  }

  if (!feed.events.length) {
    section.appendChild(h(`<p class="muted empty-note">${esc(t('friends.feedEmpty'))}</p>`));
    return;
  }
  const list = h('<div class="feed-list"></div>');
  feed.events.slice(0, 5).forEach((ev) => list.appendChild(renderFeedEvent(ev)));
  section.appendChild(list);
}

/* --------------------------- inbox: friend_request ------------------------- */

// A friend request in the inbox (#207 second consumer): accept creates the
// friendship; decline resolves it silently. Both clear the item server-side, so
// the row is removed either way. Dispatched from views-inbox.js renderInboxItem.
function renderFriendRequestItem(item) {
  const p = item.payload || {};
  const row = h(`<div class="ds-row ds-row--static inbox-row${item.read ? '' : ' inbox-row--unread'}">
      <div class="ds-row__main">
        <div class="ds-row__date">${unreadDot(item)}${esc(t('inbox.friend.title', { user: p.requesterUsername || '?' }))}</div>
      </div>
      <div class="ds-row__meta inbox-invite__actions">
        <button class="btn btn--primary inbox-friend__accept" type="button">${esc(t('friends.accept'))}</button>
        <button class="link-btn inbox-friend__decline" type="button">${esc(t('friends.decline'))}</button>
      </div>
    </div>`);

  row.querySelector('.inbox-friend__accept').addEventListener('click', async () => {
    try {
      await accountApi('POST', `/friends/${p.friendshipId}/accept`);
      toast(t('friends.toast.accepted'));
      row.remove();
      afterRemove();
    } catch (e) {
      row.remove();
      afterRemove();
      toast(e.message === 'quota_friends' ? t('friends.err.quotaFriends') : t('inbox.friend.failed'));
    }
  });
  row.querySelector('.inbox-friend__decline').addEventListener('click', async () => {
    try { await accountApi('POST', `/friends/${p.friendshipId}/decline`); } catch {}
    row.remove();
    afterRemove();
  });
  return row;
}
