/* Spielwirbel – joining a round through an invite link (#1515). Part of the
   frontend; all files share one global script scope (load order: see
   index.html).

   `/join/<token>`: the owner shared a link from the „Einladen" sheet, and this
   screen asks the person who opened it „Runde X beitreten?". An account is
   required (operator decision on #1515), so a logged-out visitor is told what
   the link is and sent to sign in — and back here afterwards, through the same
   `pendingPath` every deep link uses. Registering goes through a confirmation
   mail, which usually opens in another tab and so cannot carry the in-memory
   path along; the screen says so instead of pretending it will.

   The token reaches the server in a request BODY only (lib/routes/join.js); this
   page's own path is redacted from the request log by lib/observability.js and
   folded to its shape in client error reports (error-report.js). */

'use strict';

const joinPath = (token) => '/join/' + encodeURIComponent(token);

// A join link: `/join/<token>` with a non-empty token. Matched on shape only, like
// isVoteLinkRoute — the server decides whether the token is real.
const isJoinLinkRoute = (p) => /^\/join\/[^/]+\/*$/.test(p);

async function showJoinLink(token) {
  // Whether this call still owns the screen when the preview lands: every view
  // sets currentView on entry, so a second link, a language switch or a plain
  // navigation away all replace this one. A stale preview must not paint over
  // them — its button would join the round of a link no longer on screen.
  const view = () => showJoinLink(token);
  currentView = view;
  syncUrl(joinPath(token));
  // No round name in the tab title: the tab is visible to anyone glancing at
  // the phone, and the screen is reachable before the person has joined.
  applyTabTitle();
  setContext('');
  app.innerHTML = '';

  // Accounts off: there is no account to join with and the route 404s.
  if (!accountsActive()) return renderJoinMessage('join.deadTitle', 'join.deadBody');
  if (!isLoggedIn()) return renderJoinSignIn(token);

  app.appendChild(h(`<div class="page-head"><p class="muted">${esc(t('join.loading'))}</p></div>`));
  let preview;
  try {
    preview = await accountApi('POST', '/join/preview', { token });
  } catch (e) {
    if (currentView === view) renderJoinRefused(e.message);
    return;
  }
  if (currentView === view) renderJoinConfirm(token, preview);
}

// Logged out: what this is, and the way in. Both buttons park the link so a
// sign-in in this tab lands back here (enterApp).
function renderJoinSignIn(token) {
  app.innerHTML = '';
  const root = h(`<div class="join">
      <div class="page-head">
        <h1>${esc(t('join.signInTitle'))}</h1>
        <p class="muted">${esc(t('join.signInBody'))}</p>
      </div>
      <div class="toolbar join__actions">
        <button type="button" class="btn btn--primary" id="joinLogin"><i class="ti ti-user" aria-hidden="true"></i> ${esc(t('join.signIn'))}</button>
        <button type="button" class="btn" id="joinRegister"><i class="ti ti-user-plus" aria-hidden="true"></i> ${esc(t('join.register'))}</button>
      </div>
      <p class="muted join__note">${esc(t('join.registerNote'))}</p>
    </div>`);
  const park = (to) => () => { pendingPath = joinPath(token); routeTo(to); };
  root.querySelector('#joinLogin').addEventListener('click', park('/login'));
  root.querySelector('#joinRegister').addEventListener('click', park('/register'));
  app.appendChild(root);
}

function renderJoinConfirm(token, preview) {
  app.innerHTML = '';
  const seat = preview.seatName
    ? t('join.seatTakeOver', { name: preview.seatName })
    : t('join.seatFresh');
  const root = h(`<div class="join">
      <div class="page-head">
        <h1>${esc(t('join.title', { round: preview.roundName }))}</h1>
        <p class="muted">${esc(seat)}</p>
      </div>
      <p class="muted join__note">${esc(t('join.role', { role: t('share.role.editor') }))} ${esc(t('share.role.editor.hint'))}</p>
      <div class="toolbar join__actions">
        <button type="button" class="btn btn--primary" id="joinGo"><i class="ti ti-check" aria-hidden="true"></i> ${esc(t('join.go'))}</button>
        <button type="button" class="btn" id="joinNo">${esc(t('common.cancel'))}</button>
      </div>
    </div>`);
  const go = root.querySelector('#joinGo');
  go.addEventListener('click', async () => {
    go.disabled = true;
    let res;
    try {
      res = await accountApi('POST', '/join', { token });
    } catch (e) {
      return renderJoinRefused(e.message);
    }
    // The home list is cached (SWR); a round that just became ours must not be
    // missing from it on the way back.
    invalidateRoundCache();
    toast(t('join.toast.done', { round: preview.roundName }), { tone: 'success' });
    showRound(res.roundId, 'start');
  });
  root.querySelector('#joinNo').addEventListener('click', () => routeTo('/'));
  app.appendChild(root);
}

// Every way a join can be refused, worded for the person holding the link. The
// server's dead-link answer is one code for every cause (lib/routes/join.js),
// so the message does not guess which it was.
function renderJoinRefused(code) {
  const map = {
    invalid_link: ['join.deadTitle', 'join.deadBody'],
    own_round: ['join.ownTitle', 'join.ownBody'],
    already_member: ['join.memberTitle', 'join.memberBody'],
    quota_members: ['join.fullTitle', 'join.fullBody'],
    demo_forbidden: ['join.demoTitle', 'join.demoBody'],
    // A suspended account: retrying cannot help, so it must not be told to.
    account_disabled: ['join.disabledTitle', 'join.disabledBody'],
  };
  const [title, body] = map[code] || ['join.failedTitle', 'join.failedBody'];
  renderJoinMessage(title, body);
}

function renderJoinMessage(titleKey, bodyKey) {
  app.innerHTML = '';
  const root = h(`<div class="join">
      <div class="page-head">
        <h1>${esc(t(titleKey))}</h1>
        <p class="muted">${esc(t(bodyKey))}</p>
      </div>
      <div class="toolbar join__actions">
        <button type="button" class="btn" id="joinHome">${esc(t('join.home'))}</button>
      </div>
    </div>`);
  root.querySelector('#joinHome').addEventListener('click', () => routeTo('/'));
  app.appendChild(root);
}
