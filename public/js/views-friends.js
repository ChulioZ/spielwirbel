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
      <div class="ds-row__main friend-row__main">${friendAvatar(r.username)}<span class="friend-row__name">${friendName(r.username)}</span></div>
      <div class="ds-row__meta">
        <button class="btn btn--primary friend-req__accept" type="button">${esc(t('friends.accept'))}</button>
        <button class="link-btn friend-req__decline" type="button">${esc(t('friends.decline'))}</button>
      </div>
    </div>`);
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
      <div class="ds-row__main friend-row__main">${friendAvatar(r.username)}<span class="friend-row__name">${friendName(r.username)}</span></div>
      <div class="ds-row__meta">
        <span class="muted friend-req__pending">${esc(t('friends.pending'))}</span>
        <button class="link-btn friend-req__cancel" type="button">${esc(t('friends.cancel'))}</button>
      </div>
    </div>`);
  row.querySelector('.friend-req__cancel').addEventListener('click', async () => {
    try { await accountApi('POST', `/friends/${r.friendshipId}/decline`); } catch {}
    showFriends();
  });
  return row;
}

function renderFriendRow(f) {
  const row = h(`<div class="ds-row ds-row--static">
      <div class="ds-row__main friend-row__main">${friendAvatar(f.username)}<span class="friend-row__name">${friendName(f.username)}</span></div>
      <div class="ds-row__meta">
        <button class="link-btn friend-row__remove" type="button">${esc(t('friends.unfriend'))}</button>
      </div>
    </div>`);
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
