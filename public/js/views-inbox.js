/* Spielwirbel – inbox view (issue #207). The generic per-user notification
   inbox: it lists actionable items that later account features deliver — round
   invitations (#207) and friend requests (#325) — and lets the user mark one
   read or dismiss it. Those producers arrive in later slices, so this foundation
   ships the surface with nothing writing to it yet; items are generic here and
   each producing feature will render its own type (with accept/decline actions).

   Account-mode only: a logged-out visitor (or legacy mode) is sent home rather
   than shown an empty shell. Part of the shared frontend scope — loads after
   account.js/core.js and uses their helpers (accountApi/isLoggedIn/setInboxDot,
   h/esc/app/t/toast, syncUrl/setContext). */

'use strict';

async function showInbox() {
  // The inbox is a per-account surface; without an account there is nothing to
  // show, so fall back Home instead of rendering an empty screen.
  if (!(accountsActive() && isLoggedIn())) return showHome();
  currentView = () => showInbox();
  syncUrl('/inbox');
  setContext(t('inbox.title'));
  applyBackground(null);
  app.innerHTML = '<p class="muted">…</p>';

  let res;
  try {
    res = await accountApi('GET', '/inbox');
  } catch { return; } // accountApi already handled a dead session (→ login)
  const items = res.items;

  setInboxDot(items.some((i) => !i.read));

  app.innerHTML = '';
  app.appendChild(h(`<div class="lobby-head"><h1>${esc(t('inbox.title'))}</h1></div>`));

  if (!items.length) {
    app.appendChild(h(`<p class="muted empty-note">${esc(t('inbox.empty'))}</p>`));
    return;
  }

  const list = h('<div class="ds-list"></div>');
  for (const item of items) list.appendChild(renderInboxItem(item));
  app.appendChild(list);
}

// The unread dot: an element (present/absent) with an aria-label, so unread state
// is never signalled by colour alone (the title also goes bolder).
const unreadDot = (item) => (item.read
  ? ''
  : `<span class="inbox-row__dot" role="img" aria-label="${esc(t('inbox.unread'))}"></span>`);

// After a row is removed, fall back to the empty state if nothing is left.
function afterRemove() {
  refreshInboxBadge();
  if (!app.querySelector('.inbox-row')) showInbox();
}

// Dispatch on the item type. Round invitations (#207) are the first typed item,
// with accept/decline actions; anything else renders as a generic notification.
function renderInboxItem(item) {
  if (item.type === 'round_invitation') return renderInvitationItem(item);
  return renderGenericItem(item);
}

// A round-sharing invitation (#207): accept routes into the now-shared round;
// decline resolves it silently. Both clear the item server-side (the route
// dismisses its inbox entry), so the row is removed either way.
function renderInvitationItem(item) {
  const p = item.payload || {};
  const seat = p.memberName ? t('inbox.invite.asMember', { name: p.memberName }) : t('inbox.invite.asNew');
  const row = h(`<div class="ds-row inbox-row${item.read ? '' : ' inbox-row--unread'}">
      <div class="ds-row__main">
        <div class="ds-row__date">${unreadDot(item)}${esc(t('inbox.invite.title', { round: p.roundName || '' }))}</div>
        <div class="ds-row__status muted">${esc(t('inbox.invite.from', { user: p.inviterUsername || '?' }))} · ${esc(seat)}</div>
      </div>
      <div class="ds-row__meta inbox-invite__actions">
        <button class="btn btn--primary inbox-invite__accept" type="button">${esc(t('inbox.invite.accept'))}</button>
        <button class="link-btn inbox-invite__decline" type="button">${esc(t('inbox.invite.decline'))}</button>
      </div>
    </div>`);

  row.querySelector('.inbox-invite__accept').addEventListener('click', async () => {
    try {
      const { roundId } = await accountApi('POST', `/invitations/${p.invitationId}/accept`);
      // Navigate straight into the now-shared round. Deliberately NOT afterRemove()
      // here — its empty-state re-render (showInbox) is async and would land back
      // on the inbox, overwriting this navigation. Just refresh the unread badge.
      row.remove();
      refreshInboxBadge();
      showRound(roundId, 'start');
    } catch (e) {
      // Any accept failure means the invite is no longer actionable (seat taken,
      // round gone, already resolved) — the server has cleared it, so drop the row
      // and stay on the inbox (afterRemove re-renders the empty state if needed).
      row.remove();
      afterRemove();
      toast(e.message === 'seat_unavailable' ? t('inbox.invite.seatGone') : t('inbox.invite.failed'));
    }
  });

  row.querySelector('.inbox-invite__decline').addEventListener('click', async () => {
    try { await accountApi('POST', `/invitations/${p.invitationId}/decline`); } catch {}
    row.remove();
    afterRemove();
  });

  return row;
}

// A generic notification: a title, its timestamp, a read/unread mark, and a
// dismiss button. Clicking an unread row marks it read.
function renderGenericItem(item) {
  const row = h(`<div class="ds-row inbox-row${item.read ? '' : ' inbox-row--unread'}">
      <div class="ds-row__main">
        <div class="ds-row__date">${unreadDot(item)}${esc(t('inbox.item'))}</div>
        <div class="ds-row__status muted">${esc(fmtDateTime(item.createdAt))}</div>
      </div>
      <div class="ds-row__meta">
        <button class="link-btn inbox-row__del" type="button" aria-label="${esc(t('inbox.dismiss'))}"><i class="ti ti-trash" aria-hidden="true"></i></button>
      </div>
    </div>`);

  if (!item.read) {
    row.addEventListener('click', async (ev) => {
      if (ev.target.closest('.inbox-row__del')) return; // the dismiss button has its own handler
      try {
        await accountApi('POST', `/inbox/${item.id}/read`);
        item.read = true;
        row.classList.remove('inbox-row--unread');
        const d = row.querySelector('.inbox-row__dot');
        if (d) d.remove();
        refreshInboxBadge();
      } catch {}
    });
  }

  row.querySelector('.inbox-row__del').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      await accountApi('DELETE', `/inbox/${item.id}`);
      row.remove();
      afterRemove();
    } catch {}
  });

  return row;
}
