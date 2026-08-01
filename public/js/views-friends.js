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

/* ------------------------------ dedicated view ----------------------------- */

async function showFriends() {
  // Per-account surface; without an account there is nothing to show.
  if (!(accountsActive() && isLoggedIn())) return showHome();
  currentView = () => showFriends();
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
  app.appendChild(h(`<div class="lobby-head"><h1>${esc(t('friends.title'))}</h1></div>`));

  // Add a friend by username.
  const addForm = h(`<form class="friends-add">
      <input class="input" id="friendUser" type="text" autocomplete="off" spellcheck="false"
             autocapitalize="none" maxlength="30" placeholder="${esc(t('friends.addPlaceholder'))}" />
      <button class="btn btn--primary" type="submit">${esc(t('friends.addSubmit'))}</button>
    </form>`);
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = addForm.querySelector('#friendUser');
    const username = input.value.trim();
    if (!username) return toast(t('friends.needUsername'));
    const btn = addForm.querySelector('button');
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
  app.appendChild(addForm);

  // Feed.
  app.appendChild(h(`<h2 class="friends-section__h">${esc(t('friends.feedTitle'))}</h2>`));
  if (feed.events.length) {
    const list = h('<div class="feed-list"></div>');
    feed.events.forEach((ev) => list.appendChild(renderFeedEvent(ev)));
    app.appendChild(list);
  } else {
    app.appendChild(h(`<p class="muted empty-note">${esc(t('friends.feedEmpty'))}</p>`));
  }

  // Incoming requests (actionable) and outgoing (pending, cancellable).
  if (lists.incoming.length) {
    app.appendChild(h(`<h2 class="friends-section__h">${esc(t('friends.incoming'))}</h2>`));
    const list = h('<div class="ds-list"></div>');
    lists.incoming.forEach((r) => list.appendChild(renderIncomingRequest(r)));
    app.appendChild(list);
  }
  if (lists.outgoing.length) {
    app.appendChild(h(`<h2 class="friends-section__h">${esc(t('friends.outgoing'))}</h2>`));
    const list = h('<div class="ds-list"></div>');
    lists.outgoing.forEach((r) => list.appendChild(renderOutgoingRequest(r)));
    app.appendChild(list);
  }

  // Friends list.
  app.appendChild(h(`<h2 class="friends-section__h">${esc(t('friends.listTitle'))}</h2>`));
  if (lists.friends.length) {
    const list = h('<div class="ds-list"></div>');
    lists.friends.forEach((f) => list.appendChild(renderFriendRow(f)));
    app.appendChild(list);
  } else {
    app.appendChild(h(`<p class="muted empty-note">${esc(t('friends.listEmpty'))}</p>`));
  }
}

/* ------------------------------ account profile ---------------------------- */

// The public account profile at /u/:username (#558). Deliberately thin: a
// friendship shares no round data, so everything a profile might "obviously"
// show (shelf, sessions, ratings) is across a tenant boundary and is out of
// scope — see lib/routes/profile.js. What is here is the username, the registration
// month, the viewer's own friendship state, and — only between accepted friends
// — that account's feed.
async function showProfile(username) {
  // A per-account surface; without an account there is nothing to show.
  if (!(accountsActive() && isLoggedIn())) return showHome();
  currentView = () => showProfile(username);
  syncUrl(profilePath(username));
  // Unlike a round screen, the subject is known synchronously (it is the path
  // segment), so the chrome is correct before the fetch — and re-applied from
  // the canonical spelling below, since the URL may differ in case.
  setContext(username);
  setDocTitle(username, t('profile.title'));
  applyBackground(null);
  app.innerHTML = '<p class="muted">…</p>';

  let p;
  try {
    p = await accountApi('GET', `/profile/${encodeURIComponent(username)}`);
  } catch (err) {
    // An unknown (or suspended) handle explains itself rather than bouncing —
    // a typo'd URL is the likeliest way to get here.
    if (err.message !== 'user_not_found') return; // accountApi handled a dead session
    app.innerHTML = '';
    app.appendChild(h(`<div class="lobby-head"><h1>${esc(t('profile.title'))}</h1></div>`));
    app.appendChild(h(`<p class="muted empty-note">${esc(t('profile.notFound'))}</p>`));
    return;
  }

  app.innerHTML = '';
  setContext(p.username || t('friends.unknownUser'));
  setDocTitle(p.username || t('friends.unknownUser'), t('profile.title'));

  const head = h(`<div class="profile-head">
      ${friendAvatar(p.username)}
      <div class="profile-head__text">
        <h1>${friendName(p.username)}</h1>
        ${p.createdAt ? `<p class="muted">${esc(t('profile.memberSince', { when: fmtMonth(p.createdAt) }))}</p>` : ''}
        ${p.friendship === 'friends' && p.since ? `<p class="muted">${esc(t('profile.friendsSince', { when: fmtMonth(p.since) }))}</p>` : ''}
      </div>
    </div>`);
  app.appendChild(head);

  app.appendChild(renderProfileCta(p, username));

  // The friend's own feed, between accepted friends only. The server applies
  // the acceptedAt cutoff (lib/routes/profile.js), so nothing predating the
  // friendship can arrive here.
  if (p.friendship === 'friends') {
    app.appendChild(h(`<h2 class="friends-section__h">${esc(t('profile.feedTitle'))}</h2>`));
    if (p.events && p.events.length) {
      const list = h('<div class="feed-list"></div>');
      // The events all belong to this one account, so the route omits the
      // username and the line is rendered with the profile's own.
      p.events.forEach((ev) => list.appendChild(renderFeedEvent({ ...ev, username: p.username })));
      app.appendChild(list);
    } else {
      app.appendChild(h(`<p class="muted empty-note">${esc(t('profile.feedEmpty'))}</p>`));
    }
  }
}

// The one action the viewer's relationship with this account allows. A demo
// account (#427) is shown the explanation instead of a send button:
// demo.refuseDemoAccount guards POST /friends, so the button could only ever
// fail — the same reasoning showAccount() uses for the password form.
function renderProfileCta(p, username) {
  const wrap = h('<div class="profile-actions"></div>');
  const reload = () => showProfile(username);

  if (p.self) {
    wrap.appendChild(h(`<p class="muted">${esc(t('profile.self'))}</p>`));
    return wrap;
  }

  if (p.friendship === 'friends') {
    const btn = h(`<button class="link-btn" type="button">${esc(t('friends.unfriend'))}</button>`);
    btn.addEventListener('click', async () => {
      if (!confirm(t('friends.unfriendConfirm', { name: p.username || t('friends.unknownUser') }))) return;
      try {
        await accountApi('DELETE', `/friends/${p.friendshipId}`);
        toast(t('friends.toast.removed'));
        reload();
      } catch { toast(t('friends.err.generic')); }
    });
    wrap.appendChild(btn);
    return wrap;
  }

  if (p.friendship === 'incoming') {
    wrap.appendChild(h(`<p class="muted">${esc(t('profile.incoming'))}</p>`));
    const accept = h(`<button class="btn btn--primary" type="button">${esc(t('friends.accept'))}</button>`);
    const decline = h(`<button class="link-btn" type="button">${esc(t('friends.decline'))}</button>`);
    accept.addEventListener('click', async () => {
      try {
        await accountApi('POST', `/friends/${p.friendshipId}/accept`);
        toast(t('friends.toast.accepted'));
        refreshInboxBadge();
        reload();
      } catch (err) {
        toast(err.message === 'quota_friends' ? t('friends.err.quotaFriends') : t('friends.err.generic'));
      }
    });
    decline.addEventListener('click', async () => {
      try { await accountApi('POST', `/friends/${p.friendshipId}/decline`); } catch {}
      refreshInboxBadge();
      reload();
    });
    wrap.appendChild(accept);
    wrap.appendChild(decline);
    return wrap;
  }

  if (p.friendship === 'outgoing') {
    wrap.appendChild(h(`<span class="muted">${esc(t('friends.pending'))}</span>`));
    const cancel = h(`<button class="link-btn" type="button">${esc(t('friends.cancel'))}</button>`);
    cancel.addEventListener('click', async () => {
      try { await accountApi('POST', `/friends/${p.friendshipId}/decline`); } catch {}
      reload();
    });
    wrap.appendChild(cancel);
    return wrap;
  }

  // No relationship yet.
  if (isDemoAccount()) {
    wrap.appendChild(h(`<p class="muted">${esc(t('profile.demoNote'))}</p>`));
    return wrap;
  }
  const send = h(`<button class="btn btn--primary" type="button">${esc(t('friends.addSubmit'))}</button>`);
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      await accountApi('POST', '/friends', { username: p.username });
      toast(t('friends.toast.sent', { user: p.username }));
      reload();
    } catch (err) {
      toast(friendSendError(err.message));
      send.disabled = false;
    }
  });
  wrap.appendChild(send);
  return wrap;
}

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
function friendAvatar(username) {
  const name = username || '?';
  const color = MEMBER_COLORS[gameHue(name) % MEMBER_COLORS.length];
  return `<span class="avatar" style="background:${color}" aria-hidden="true">${esc(initials(name))}</span>`;
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
function friendRowMain(username) {
  const inner = `${friendAvatar(username)}<span class="friend-row__name">${friendName(username)}</span>`;
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
function feedText(ev) {
  const key = ev.type === 'session_played' ? 'friends.feed.played' : 'friends.feed.added';
  return t(key, {
    user: `<strong>${friendName(ev.username)}</strong>`,
    game: `<strong>${esc(ev.title || '')}</strong>`,
  });
}

function renderFeedEvent(ev) {
  const imgStyle = ev.coverUrl ? ` style="background-image:url('${coverUrl(ev.coverUrl, COVER_THUMB)}')"` : '';
  const fallback = ev.coverUrl ? '' : '<i class="ti ti-cards" aria-hidden="true"></i>';
  return h(`<div class="feed-item">
      <span class="feed-item__img"${imgStyle}>${fallback}</span>
      <div class="feed-item__body">
        <div class="feed-item__text">${feedText(ev)}</div>
        <div class="feed-item__time muted">${esc(fmtDateTime(ev.at))}</div>
      </div>
    </div>`);
}

/* ----------------------------- request/friend rows ------------------------- */

function renderIncomingRequest(r) {
  const row = h(`<div class="ds-row ds-row--static">
      ${friendRowMain(r.username)}
      <div class="ds-row__meta">
        <button class="btn btn--primary friend-req__accept" type="button">${esc(t('friends.accept'))}</button>
        <button class="link-btn friend-req__decline" type="button">${esc(t('friends.decline'))}</button>
      </div>
    </div>`);
  wireFriendRowMain(row, r.username);
  row.querySelector('.friend-req__accept').addEventListener('click', async () => {
    try {
      await accountApi('POST', `/friends/${r.friendshipId}/accept`);
      toast(t('friends.toast.accepted'));
      refreshInboxBadge();
      showFriends();
    } catch (err) {
      toast(err.message === 'quota_friends' ? t('friends.err.quotaFriends') : t('friends.err.generic'));
    }
  });
  row.querySelector('.friend-req__decline').addEventListener('click', async () => {
    try { await accountApi('POST', `/friends/${r.friendshipId}/decline`); } catch {}
    refreshInboxBadge();
    showFriends();
  });
  return row;
}

function renderOutgoingRequest(r) {
  const row = h(`<div class="ds-row ds-row--static">
      ${friendRowMain(r.username)}
      <div class="ds-row__meta">
        <span class="muted friend-req__pending">${esc(t('friends.pending'))}</span>
        <button class="link-btn friend-req__cancel" type="button">${esc(t('friends.cancel'))}</button>
      </div>
    </div>`);
  wireFriendRowMain(row, r.username);
  row.querySelector('.friend-req__cancel').addEventListener('click', async () => {
    try { await accountApi('POST', `/friends/${r.friendshipId}/decline`); } catch {}
    showFriends();
  });
  return row;
}

function renderFriendRow(f) {
  const row = h(`<div class="ds-row ds-row--static">
      ${friendRowMain(f.username)}
      <div class="ds-row__meta">
        <button class="link-btn friend-row__remove" type="button">${esc(t('friends.unfriend'))}</button>
      </div>
    </div>`);
  wireFriendRowMain(row, f.username);
  row.querySelector('.friend-row__remove').addEventListener('click', async () => {
    if (!confirm(t('friends.unfriendConfirm', { name: f.username || t('friends.unknownUser') }))) return;
    try {
      await accountApi('DELETE', `/friends/${f.friendshipId}`);
      toast(t('friends.toast.removed'));
      showFriends();
    } catch { toast(t('friends.err.generic')); }
  });
  return row;
}

/* -------------------------- home-screen feed section ----------------------- */

// The compact feed on the home screen. Rendered only in accounts mode with >= 1
// friend (#325); otherwise the placeholder section is removed so home is
// unchanged for everyone else. Called (not awaited) by showHome.
async function renderHomeFriends(section) {
  if (!(accountsActive() && isLoggedIn())) { section.remove(); return; }
  let feed;
  try { feed = await accountApi('GET', '/friends/feed'); } catch { section.remove(); return; }
  // The section (and its host view) may have been re-rendered while we awaited.
  if (!section.isConnected) return;
  if (!feed.friendCount) { section.remove(); return; }

  section.innerHTML = '';
  const head = h(`<div class="home-friends__head">
      <h2>${esc(t('friends.home.title'))}</h2>
      <a class="link-btn" href="/freunde">${esc(t('friends.home.all'))}</a>
    </div>`);
  navLink(head.querySelector('a'), '/freunde', () => showFriends());
  section.appendChild(head);

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
