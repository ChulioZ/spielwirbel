/* Spielwirbel – direct messages between friends (#1783): the Freundeskreis
   screen's „Nachrichten" band (one row per conversation, with an unread dot)
   and the one-conversation screen at /freunde/nachrichten/<account id>.

   The thread itself is the round chat's machinery (mountChatThread,
   views-round-chat.js) pointed at /api/account/messages/<id> with no round:
   the same paging, polling, composer, edit/delete and report link, and the
   same rule that a message is user-authored text shown to another account —
   textContent and chatSegments only, never innerHTML. Whether the two may
   still write to each other is the server's answer (`canPost`), not derived
   here: an ended friendship leaves the history readable and the composer gone.

   Accounts mode only. Part of the shared frontend scope; loads after
   views-friends.js and views-round-chat.js, whose functions it calls at RENDER
   time only (.claude/rules/frontend-script-load-order.md). */

'use strict';

/* The band on the Freundeskreis screen. `conversations` is GET
   /api/account/messages: every friend, plus every ex-friend with history,
   newest conversation first. Returns null when there is nobody to write to,
   so a person without friends sees no empty band. Each row is a real link —
   it has nothing else in it, so the whole row may be the <a>
   (.claude/rules/ds-row-is-a-click-target.md). */
function renderMessagesBand(conversations) {
  if (!conversations || !conversations.length) return null;
  const band = renderBand(t('dm.bandTitle'));
  const list = h('<div class="ds-list dm-list"></div>');
  for (const c of conversations) {
    const row = h(`<a class="ds-row dm-row${c.unread ? ' dm-row--unread' : ''}">
        <div class="ds-row__main">
          ${friendAvatar(c.username, c.avatar, 'dm-row__avatar')}
          <span class="dm-row__name">${friendName(c.username)}</span>
          ${c.unread ? `<span class="inbox-row__dot dm-row__dot" role="img" aria-label="${esc(t('dm.unread'))}"></span>` : ''}
        </div>
        <div class="ds-row__meta muted">${esc(c.lastAt ? fmtDateTime(c.lastAt) : (c.friend ? t('dm.start') : ''))}${c.friend ? '' : ` · ${esc(t('dm.ended'))}`}</div>
      </a>`);
    navLink(row, directThreadPath(c.userId), () => showDirectThread(c.userId));
    list.appendChild(row);
  }
  band.appendChild(list);
  return band;
}

/* One conversation. A non-main screen, so it gets one back control at the
   top (.claude/rules/persistent-chrome-defines-the-main-pages.md) — including
   on the not-found branch, the likeliest way to arrive from a stale link. */
async function showDirectThread(uid) {
  if (!(accountsActive() && isLoggedIn())) return showHome();
  currentView = () => showDirectThread(uid);
  syncUrl(directThreadPath(uid));
  setContext(t('friends.title'));
  applyMarker(null);
  app.innerHTML = '<p class="muted">…</p>';

  const base = `/api/account/messages/${encodeURIComponent(uid)}`;
  let first;
  try {
    first = await api('GET', base);
  } catch {
    app.innerHTML = '';
    setDocTitle(t('dm.notFoundTitle'));
    app.appendChild(backRow(() => showFriends()));
    app.appendChild(h(`<p class="muted empty-note">${esc(t('dm.notFound'))}</p>`));
    return;
  }

  const name = first.partner.username || t('chat.deletedAccount');
  setDocTitle(t('dm.title', { name }));
  app.innerHTML = '';
  app.appendChild(backRow(() => showFriends()));
  const screen = h(`<section class="chat chat--direct" aria-labelledby="dmTitle">
      <div class="section-head dm-head">
        <h1 id="dmTitle"></h1>
      </div>
      <p class="muted chat__note">${esc(t('dm.note'))}</p>
    </section>`);
  // The partner's avatar and name link to their profile, as everywhere else a
  // person is named; a vanished username stays plain text.
  screen.querySelector('#dmTitle').innerHTML = friendRowMain(first.partner.username, first.partner.avatar);
  wireFriendRowMain(screen, first.partner.username);
  app.appendChild(screen);

  await mountChatThread(screen, null, {
    base,
    inputId: 'dmInput',
    placeholder: t('dm.placeholder', { name }),
    empty: t('dm.empty'),
    purge: false,
    readOnly: !first.canPost,
    readOnlyNote: t('dm.closed'),
    // Reading clears the inbox item server-side; bring the badge along.
    onRead: (all) => { if (all) refreshInboxBadge(); },
  });
}

