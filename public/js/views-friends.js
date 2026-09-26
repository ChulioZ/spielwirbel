/* Spielwirbel – Freundeskreis (issue #325): the dedicated friends view and the
   compact home-screen feed section, plus the inbox `friend_request` item.

   A friendship is a cross-account social layer that shares NO round data — only
   feed events ("‹friend› played ‹game›" / "‹friend› added ‹game›"), and only
   those created after the friendship was accepted. Requests are addressed by the
   unique username (#320) and delivered through the inbox (#207).

   The feed's two RENDERERS live in feed-view.js since #1132 — a component with
   three callers on three screens — while the two screens that host one (the
   Freundeskreis and the home dashboard) stay here. What remains shared from this
   file is the account vocabulary: accountColor, friendAvatar, friendName, the row
   main and the account report button.

   Account-mode only: a logged-out visitor (or legacy mode) is sent home. Part of
   the shared frontend scope — loads after account.js/core.js and uses their
   helpers (accountApi/isLoggedIn/accountsActive/refreshInboxBadge, h/esc/app/t/
   toast, syncUrl/setContext/applyMarker, coverUrl/fmtDateTime/initials). */

'use strict';

/* ------------------------------ dedicated view ----------------------------- */

/* Three full-width bands (#1136): what is waiting on you, your people, what is
   new. No split, at any width.

   #1092 put the roster beside a narrow feed column, and the dead column that
   produced was not a proportion to retune — it was a property of splitting at
   all. Two columns whose heights come from two unrelated counts mean one always
   runs out first, and shifting width between them only moves the hole. Measured
   over 9 friends / 3 requests / 26 events: 1601px of empty column at EVERY width
   from 1280 to 2560, and the same 3.4:1 height ratio at 3 friends, so it was
   structural rather than a property of that dataset. The roster grows 132px per
   three people and the feed ~87px per event; matching a full feed would have
   needed about 150 friends.

   What removes it is making the feed USE width. As tiles, 26 events measure
   463px instead of 2261 — at which point both bands want the whole width and
   there is no second column left to run dry. Below 1024 the old shape inverted
   the defect anyway: the phone scrolled 1737px of roster before the feed began.

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
  applyMarker(null);
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
  const head = h(`<div class="lobby-head"><h1>${esc(t('friends.title'))}</h1></div>`);
  screen.appendChild(head);
  /* Der Tisch composes the roster as T14.1 draws it (#1272): the add control is
     a button in the HEAD rather than the roster's last tile, and friends are
     pills. Klassisch never enters this branch — its DOM is the path below. */
  const tisch = designIs('tisch');
  if (tisch) addFriendSearchButton(head);

  /* ORDER IS THE FEATURE, and it survives the rebuild: a request is the one
     thing on this screen somebody is waiting on, so it leads whatever the
     friend count — which is the property the four stacked lists could not have.
     It is now a band rather than the first cells of a shared grid. */
  const pending = lists.incoming.map((r) => [r, 'incoming'])
    .concat(lists.outgoing.map((r) => [r, 'outgoing']));
  if (pending.length) {
    /* The heading names what the band HOLDS, so an account with nothing incoming
       is not told that somebody is waiting on it. The issue specified only
       „Warten auf dich"; the outgoing-only state has no incoming request to be
       waiting, and each card states its own status underneath either way (#1092,
       which is what let the per-state headings go). */
    const band = renderBand(t(lists.incoming.length ? 'friends.waitingTitle' : 'friends.sentTitle'),
      pending.length);
    const grid = h('<div class="k-grid"></div>');
    pending.forEach(([r, state]) => grid.appendChild(renderPersonCard(r, state)));
    band.appendChild(grid);
    screen.appendChild(band);
  }

  const roster = renderBand(t('friends.rosterTitle'), lists.friends.length);
  if (tisch) {
    roster.appendChild(renderPersonPills(lists.friends));
  } else {
    const tiles = h('<div class="k-tiles"></div>');
    lists.friends.forEach((f) => tiles.appendChild(renderPersonTile(f, feed.events)));
    tiles.appendChild(renderAddTile());
    roster.appendChild(tiles);
  }
  screen.appendChild(roster);

  const news = renderBand(t('friends.newsTitle'));
  if (feed.events.length) {
    // Der Tisch lists the feed as T14.1's rows — author, sentence, cover on the
    // right — where Klassisch tiles it (#1136). Same events, same collapse.
    // Ocean takes the rows too (#1219, O14.2 „Was gerade läuft": a card per
    // event, the author's ring first); its stylesheet makes each one a card.
    const rows = tisch || designIs('ocean');
    // Later pages (#1357) append to this list as its end scrolls into view.
    const more = {
      nextCursor: feed.nextCursor,
      load: (cursor) => accountApi('GET', `/friends/feed?before=${encodeURIComponent(cursor)}`),
    };
    const tiled = renderFeedTiles(feed.events, rows ? { rows: true, more } : { more });
    // „Alle anzeigen" from the home tile promises every event; below 1024 the
    // grid collapses to eight, so the link has to open it already expanded.
    if (o.feed === 'all') tiled.classList.add('is-open');
    news.appendChild(tiled);
  } else {
    news.appendChild(h(`<p class="muted empty-note">${esc(t('friends.feedEmpty'))}</p>`));
  }
  screen.appendChild(news);

  app.appendChild(screen);
}

/* A band: a full-width section with one heading, and the count of what is in it
   INSIDE that heading rather than beside it.

   Inside, because a bare number next to an <h2> is announced as a stray digit
   with nothing to attach it to — where „Deine Freunde 9" reads as the sentence
   it is. It replaces #1093's avatar band, which rendered the same faces 20px
   above a grid that now shows them all. */
function renderBand(title, count) {
  const n = count == null ? '' : ` <span class="k-band__count">${count}</span>`;
  return h(`<section class="k-band"><h2 class="k-band__h">${esc(title)}${n}</h2></section>`);
}

/* One person, as a tile (#1136). It replaces the 121px card for FRIENDS only —
   requests keep the card, because they carry buttons.

   The tile carries NO action, and that is a removal rather than a loss: its only
   one was `Entfernen`, which the profile screen has offered since #558 — so the
   whole tile becomes the link to that profile, where `Entfernen` and the report
   entry point both already live. A card with one button and a link inside it is
   what made the card 121px tall.

   It is a real <a> rather than a div that re-earns the click in JS
   (.claude/rules/ds-row-is-a-click-target.md). An account with no resolvable
   username (edge: mid-erasure) has no profile to point at and stays a <div> —
   an <a> with no usable href is not a link at all, not focusable and with no
   affordance. */
function renderPersonTile(p, events) {
  const name = p.username || '';
  const shown = friendName(p.username);
  const line = personTileLine(p, events);
  const inner = `${friendAvatar(p.username, p.avatar)}
      <span class="k-tile__body">
        <span class="k-tile__name">${shown}</span>
        ${line ? `<span class="k-tile__line muted">${line}</span>` : ''}
      </span>`;
  const tile = name
    ? h(`<a class="k-tile" href="${esc(profilePath(name))}">${inner}</a>`)
    : h(`<div class="k-tile k-tile--dead">${inner}</div>`);

  /* The cover wash (#1094): that friend's most recently played cover, bled into
     the tile's right side so every tile carries a colour taken from what the
     person actually plays. The art is already in the `/friends/feed` payload the
     line above is derived from, so it costs no request — and it is the LINE's
     game, never a second lookup, so the two can never name different games.

     A friend with no recent activity stays plain: that is a difference the grid
     should show, not hide. Requested at thumb size — the grid can hold 28 of
     these (.claude/rules/provider-cover-sizing.md). */
  const last = lastEventOf(p, events);
  if (last && last.coverUrl) {
    tile.insertBefore(
      h(`<span class="k-tile__art" style="background-image:url('${coverUrl(last.coverUrl, COVER_THUMB)}')"></span>`),
      tile.firstChild);
  }
  if (name) navLink(tile, profilePath(name), () => showProfile(name));
  return tile;
}

/* The tile's second line: what this person last did, else how long you have been
   friends. Both come from payloads the view already holds — `since` is the
   acceptedAt the friends list has always returned and nothing rendered.

   The date is RELATIVE within the last month — „gestern", „vor 3 Tagen" — and
   absolute past it. A relative count has to be over LOCAL CALENDAR days or it
   says „gestern" for something 14 hours old; `fmtRelativeDays` returns null past
   the cutoff and this falls back, so the threshold lives in one place. A
   friendship two years old reads „seit September 2024", never „vor 743 Tagen". */
function personTileLine(p, events) {
  const last = lastEventOf(p, events);
  if (last) {
    const rel = fmtRelativeDays(dayIndexOf(Date.now()) - dayIndexOf(last.at));
    return `${esc(last.title || '')} · ${esc(rel || fmtDate(last.at))}`;
  }
  return p.since ? esc(t('friends.card.since', { when: fmtMonth(p.since) })) : '';
}

/* The „＋" tile, last in the roster. The add form was a full-width row at the TOP
   of the page for a control used once per friend; as a tile it costs one cell and
   sits where you look after scanning the people you already have.

   It becomes the field IN PLACE rather than opening an editor: there is nothing
   to dismiss, and the enclosing <form> is what keeps Enter-to-submit and the
   submit button's semantics. The form spans the whole row, because a username
   field plus a submit button does not fit a 156-172px track. */
function renderAddTile() {
  const tile = h(`<button type="button" class="k-tile k-tile--add">
       <span class="k-tile__plus" aria-hidden="true">＋</span>
       <span class="k-tile__body">
         <span class="k-tile__name">${esc(t('friends.addTile'))}</span>
         <span class="k-tile__line muted">${esc(t('friends.addTileSub'))}</span>
       </span>
     </button>`);
  tile.addEventListener('click', () => {
    const form = buildFriendAddForm('k-tile k-tile--adding friends-add');
    tile.replaceWith(form);
    form.querySelector('#friendHandle').focus();
  });
  return tile;
}

/* The add form itself, shared by Klassisch's „＋" tile and Der Tisch's head
   button (#1272) so there is ONE field and ONE submit path — the id, the
   password-manager opt-outs and the error mapping below are all load-bearing,
   and a second copy is where one of them would quietly go missing. */
function buildFriendAddForm(cls) {
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
  const form = h(`<form class="${cls}">
       <input class="input" id="friendHandle" type="text" autocomplete="off" spellcheck="false"
              autocapitalize="none" maxlength="30" aria-label="${esc(t('friends.addLabel'))}"
              data-1p-ignore data-lpignore="true" data-bwignore
              placeholder="${esc(t('friends.addPlaceholder'))}" />
       <button class="btn btn--primary btn--sm" type="submit">${esc(t('friends.addSubmit'))}</button>
     </form>`);
  const input = form.querySelector('#friendHandle');
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
      toast(friendSendError(err.message), { tone: 'error' });
      btn.disabled = false;
    }
  });
  return form;
}

/* ------------------------------ Der Tisch (#1272) --------------------------- */

/* T14.1's „Freund suchen" in the screen's head. It opens the SAME add form the
   Klassisch tile opens, as a row right under the head — the head has no room
   for a field and a submit button beside the title. A second press only
   re-focuses the open field rather than stacking a second form (the `#friendHandle`
   id must stay unique). The label is the tile's own „Freund*in hinzufügen":
   the field adds by exact username, and „suchen" would promise a search this
   app deliberately does not offer (usernames are not enumerable). */
function addFriendSearchButton(head) {
  head.classList.add('friends-head');
  const btn = h(`<button type="button" class="btn btn--sm friends-search" aria-expanded="false">
      <i class="ti ti-user-plus" aria-hidden="true"></i><span>${esc(t('friends.addTile'))}</span>
    </button>`);
  btn.addEventListener('click', () => {
    let form = head.parentNode && head.parentNode.querySelector('.friends-search__form');
    if (!form) {
      form = buildFriendAddForm('friends-add friends-search__form');
      head.after(form);
      btn.setAttribute('aria-expanded', 'true');
    }
    form.querySelector('#friendHandle').focus();
  });
  head.appendChild(btn);
}

/* Friends as T14.1's pills: face in a gold rim, the name, and one short note.
   Each pill is still THE link to that profile, with the same accessible name
   shape as the tile (name, then its line) — the pill is the tile re-composed,
   not a new control.

   The note is `since`, which the friends payload has always carried. The sheet
   draws a round COUNT there, and a friendship shares no round data
   (lib/routes/profile.js, .claude/rules/account-profiles.md) — so the one
   figure that would match the picture is exactly the one that may not cross.
   No wash either: a 44px pill has no side for the cover to bleed into. */
function renderPersonPills(friends) {
  if (!friends.length) return h(`<p class="muted empty-note">${esc(t('friends.home.noneTitle'))}</p>`);
  const list = h('<div class="k-pills"></div>');
  friends.forEach((p) => {
    const name = p.username || '';
    const note = p.since ? `<span class="k-pill__note">${esc(t('friends.card.since', { when: fmtMonth(p.since) }))}</span>` : '';
    const inner = `${friendAvatar(p.username, p.avatar)}<span class="k-pill__name">${friendName(p.username)}</span>${note}`;
    const pill = name
      ? h(`<a class="k-pill" href="${esc(profilePath(name))}">${inner}</a>`)
      : h(`<div class="k-pill k-pill--dead">${inner}</div>`);
    if (name) navLink(pill, profilePath(name), () => showProfile(name));
    list.appendChild(pill);
  });
  return list;
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

/* The colour an account wears, derived from its username so it keeps the same
   one everywhere (there is no round context to borrow from).

   Its own helper since #1132: the Spielerkarte paints a whole card from this
   value while the avatar beside it is painted with the same one, and a second
   copy of the arithmetic is how the card and the face come to disagree
   (.claude/rules/shared-constants-across-the-stack.md, applied inside one
   file). */
function accountColor(username) {
  return MEMBER_COLORS[gameHue(username || '?') % MEMBER_COLORS.length];
}

// A small avatar for an account, coloured deterministically from the username so
// a friend keeps the same colour everywhere (no round context to borrow from).
function friendAvatar(username, avatar, extraClass) {
  const name = username || '?';
  const color = accountColor(name);
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

/* -------------------------------- request cards ---------------------------- */

/* ONE card for BOTH request states (#1092, narrowed by #1136). It was one card
   for three, and the third — a friend — is now `renderPersonTile`: a friend has
   no pending action, so everything that made this a 121px card with a button row
   was cost it did not need.

   What is left is genuinely a card. `.claude/rules/account-profiles.md` binds
   unchanged: only the avatar+name half is an <a>, because the card keeps its
   action buttons and a <button> inside an <a> is invalid HTML. The CARD is not a
   click target and must not promise one
   (.claude/rules/ds-row-is-a-click-target.md). An account with no resolvable
   username (edge: mid-erasure) stays a <span> — an <a> with no usable href is
   not a link at all.

   Requests keep their LIFTED treatment — a brand left edge and a tint — which
   now reads against the quiet tiles below rather than against neighbours in the
   same grid. They carry no cover wash: the lifted edge is the one loud thing on
   the screen and art would compete with it. */
function renderPersonCard(p, state) {
  const card = h(`<div class="k-card k-card--${state}">
      <div class="k-card__who"></div>
      <div class="k-card__meta"></div>
    </div>`);

  const who = card.querySelector('.k-card__who');
  who.innerHTML = friendRowMain(p.username, p.avatar);
  wireFriendRowMain(card, p.username);

  // The card states its own status, which is what let the per-state headings go
  // (#1092) — and still matters now that the band above can hold both kinds.
  const line = esc(t(state === 'incoming' ? 'friends.card.wants' : 'friends.card.sent'));
  who.appendChild(h(`<div class="k-card__line muted">${line}</div>`));

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
        toast(err.message === 'quota_friends' ? t('friends.err.quotaFriends') : t('friends.err.generic'), { tone: 'error' });
      }
    });
    meta.querySelector('.friend-req__decline').addEventListener('click', async () => {
      try { await accountApi('POST', `/friends/${p.friendshipId}/decline`); } catch {}
      refreshInboxBadge();
      showFriends();
    });
  } else {
    meta.appendChild(h(`<button class="link-btn friend-req__cancel" type="button">${esc(t('friends.cancel'))}</button>`));
    meta.querySelector('.friend-req__cancel').addEventListener('click', async () => {
      try { await accountApi('POST', `/friends/${p.friendshipId}/decline`); } catch {}
      showFriends();
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

/* That account's most recent feed event, or null. Shared by the tile's second
   line and its cover wash (#1094) so the two can never describe different
   games — the wash IS the line's game, rendered as colour. */
function lastEventOf(p, events) {
  return (events || []).find((ev) => ev.username && ev.username === p.username) || null;
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
      toast(e.message === 'quota_friends' ? t('friends.err.quotaFriends') : t('inbox.friend.failed'), { tone: 'error' });
    }
  });
  row.querySelector('.inbox-friend__decline').addEventListener('click', async () => {
    try { await accountApi('POST', `/friends/${p.friendshipId}/decline`); } catch {}
    row.remove();
    afterRemove();
  });
  return row;
}
