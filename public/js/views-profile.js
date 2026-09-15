/* Spielwirbel – view: the public account profile at /u/:username (#558).

   Its own file since #1089, which gave the screen real content (an account's
   play statistics and its own activity feed) and pushed views-friends.js from
   701 to 895 lines. A real seam rather than a trim: this is a screen with its
   own route, edited when the profile changes, while its former host holds Der
   Kreis — the people grid and the friend feed. What they share (friendAvatar,
   friendName, renderFeedEvent, friendSendError, accountReportButton) stays over
   there, because Der Kreis is the other caller of each.

   Part of the frontend; all files share one global script scope (load order:
   see index.html — after views-friends.js, whose helpers this calls). */

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
    // Two refusals explain themselves rather than bouncing: an unknown (or
    // suspended) handle, and — since #877 — a guest demo account, which the
    // route declines outright. The demo branch is not cosmetic: without it the
    // screen keeps the loading ellipsis above forever, because anything other
    // than a recognised code falls through to the bare `return`.
    const note = err.message === 'user_not_found' ? 'profile.notFound'
      : err.message === 'demo_forbidden' ? 'profile.demoBlocked'
        : null;
    if (!note) return; // accountApi handled a dead session
    app.innerHTML = '';
    // The likeliest way to reach this screen is a typo'd URL, so it is the one
    // that most needs a way out — and it is the only branch a `backRow` added to
    // the happy path below would miss (#623).
    app.appendChild(backRow(() => showFriends()));
    app.appendChild(h(`<div class="lobby-head"><h1>${esc(t('profile.title'))}</h1></div>`));
    app.appendChild(h(`<p class="muted empty-note">${esc(t(note))}</p>`));
    return;
  }

  app.innerHTML = '';
  setContext(p.username || t('friends.unknownUser'));
  setDocTitle(p.username || t('friends.unknownUser'), t('profile.title'));

  // A profile is reached from the Freundeskreis, the feed and a shared link, and
  // no persistent chrome points at it — so it needs its own way back (#623). The
  // fallback is the Freundeskreis, the only screen that lists accounts.
  app.appendChild(backRow(() => showFriends()));

  const head = h(`<div class="profile-head">
      ${friendAvatar(p.username, p.avatar)}
      <div class="profile-head__text">
        <h1>${friendName(p.username)}</h1>
        ${p.createdAt ? `<p class="muted">${esc(t('profile.memberSince', { when: fmtMonth(p.createdAt) }))}</p>` : ''}
        ${p.friendship === 'friends' && p.since ? `<p class="muted">${esc(t('profile.friendsSince', { when: fmtMonth(p.since) }))}</p>` : ''}
      </div>
    </div>`);
  app.appendChild(head);

  app.appendChild(renderProfileCta(p, username));

  // Not on your own profile: the notice channel is for reporting someone else,
  // and an operator receiving "user X reports user X" learns nothing.
  if (!p.self) {
    const report = accountReportButton(p.username);
    if (report) {
      const wrap = h('<div class="profile-actions"></div>');
      wrap.appendChild(report);
      app.appendChild(wrap);
    }
  }

  // The account's play record (#1089), aggregated over every seat it holds in
  // its own and in shared rounds. Present on your own profile always, and on a
  // friend's unless they have switched it off — the server decides, and an
  // ABSENT key is the off state (never an empty object), so there is nothing to
  // re-derive here.
  if (p.stats) app.appendChild(renderProfileStats(p.stats, p.self));

  // The friend's own feed, between accepted friends only. The server applies
  // the acceptedAt cutoff (lib/routes/profile.js), so nothing predating the
  // friendship can arrive here. On your OWN profile the same list is your whole
  // activity, with no cutoff — there is no friendship to date one from.
  if (p.friendship === 'friends' || p.self) {
    app.appendChild(h(`<h2 class="friends-section__h">${esc(t('profile.feedTitle'))}</h2>`));
    if (p.events && p.events.length) {
      const list = h('<div class="feed-list"></div>');
      // The events all belong to this one account, so the route omits the
      // username and the line is rendered with the profile's own.
      p.events.forEach((ev) => list.appendChild(
        renderFeedEvent({ ...ev, username: p.username, avatar: p.avatar })));
      app.appendChild(list);
    } else {
      // Two empty states: the friend one dates itself from the friendship, which
      // is a sentence your OWN profile cannot say — there is no friendship, and
      // the list there has no cutoff at all.
      app.appendChild(h(`<p class="muted empty-note">${esc(t(p.self ? 'profile.feedEmptySelf' : 'profile.feedEmpty'))}</p>`));
    }
  }
}

/* The stats block. It reuses the member page's figure strip and game-tile
   classes rather than minting a parallel treatment — the same numbers, computed
   by the same function (lib/user-stats.js runs `memberStats` per seat), so they
   must read the same. What it does NOT reuse is the wiring: `wireGameCardHead`
   makes each tile a link into a round, and a profile has no round context — nor
   may it have one, since the payload deliberately carries no round id. So the
   tiles here are inert, and the thumb is a <span> rather than an <a> with no
   target (.claude/rules/in-app-nav-links.md). */
function renderProfileStats(st, self) {
  const wrap = h(`<section class="profile-stats">
      <h2 class="friends-section__h">${esc(t('profile.statsTitle'))}</h2>
    </section>`);

  // A fresh account — or one only ever granted a round it has no seat in — gets
  // one muted line. Nine zero tiles would read as a broken screen rather than as
  // an empty one, and „0 %" in particular claims something false about somebody
  // who has never been in a contest.
  if (!st.sessions) {
    wrap.appendChild(h(`<p class="muted empty-note">${esc(t(self ? 'profile.statsEmptySelf' : 'profile.statsEmpty'))}</p>`));
    return wrap;
  }

  const figures = h('<div class="profile-figures"></div>');
  const figure = (label, value) => figures.appendChild(h(`<div class="member-figure">
       <span class="member-figure__value">${esc(value)}</span>
       <span class="member-figure__label">${esc(label)}</span>
     </div>`));
  figure(t('member.sessions'), String(st.sessions));
  figure(t('member.wins'), String(st.wins));
  // A dash, never 0 %: `winRate === null` means no contested session at all, and
  // the member page makes the same distinction for the same reason (#1075).
  figure(t('member.winRate'), st.winRate === null ? '–' : Math.round(st.winRate * 100) + '%');
  figure(t('member.winScore'), fmtSigned(st.winScore));
  figure(t('member.avgGiven'), st.avgGiven === null ? '–' : 'Ø ' + fmtAvg(st.avgGiven));
  figure(t('profile.rounds'), String(st.rounds));
  figure(t('profile.gamesPlayed'), String(st.gamesPlayed));
  wrap.appendChild(figures);

  const cards = h('<div class="pokale-cards profile-stats__games"></div>');
  const loadCover = createCoverLoader();
  const gameCard = (icon, label, games, sub) => {
    const lead = games[0];
    const card = h(`<div class="pokale-card">
         ${lead
    ? `<span class="pokale-card__thumb">${coverPlaceholder(lead)}</span>
            <span class="pokale-card__label"><i class="ti ${icon}" aria-hidden="true"></i>${esc(label)}</span>`
    : `<span class="pokale-card__icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
            <span class="pokale-card__label">${esc(label)}</span>`}
         <span class="pokale-card__games"></span>
         <span class="pokale-card__sub">${esc(sub)}</span>
       </div>`);
    if (lead) {
      card.classList.add('pokale-card--cover');
      if (lead.image) loadCover(card.querySelector('.pokale-card__thumb'), coverUrl(lead.image, COVER_THUMB));
    }
    const list = card.querySelector('.pokale-card__games');
    games.forEach((g) => list.appendChild(h(`<span class="pokale-game">${esc(g.title)}</span>`)));
    return card;
  };
  // Ties share the tile, as on the member page. `bestScore === null` is the only
  // empty state for the strongest game: 0 is a real Siegwertung.
  cards.appendChild(gameCard('ti-sword', t('member.bestGame'), st.bestGames,
    st.bestScore === null ? t('member.bestGameNone') : fmtSigned(st.bestScore)));
  cards.appendChild(gameCard('ti-heart', t('member.favorite'), st.favorite,
    st.favAvg === null ? t('member.favoriteNone') : 'Ø ' + fmtAvg(st.favAvg)));
  wrap.appendChild(cards);

  // On a FRIEND's profile, say what this is and what it is not — the aggregate
  // names no round, no other member and no individual session, and the reader
  // cannot tell that from the numbers alone.
  if (!self) wrap.appendChild(h(`<p class="muted profile-stats__note">${esc(t('profile.statsNote'))}</p>`));
  return wrap;
}

// The one action the viewer's relationship with this account allows. A demo
// account (#427) is shown the explanation instead of a send button:
// demo.refuseDemoAccount guards POST /friends, so the button could only ever
// fail — the same reasoning showAccount() uses for the password form.
function renderProfileCta(p, username) {
  const wrap = h('<div class="profile-actions"></div>');
  const reload = () => showProfile(username);

  // Nothing to say on your own profile: the stats and the activity below ARE the
  // content since #1089, and „Das bist du." was the whole of it before that.
  if (p.self) return wrap;

  if (p.friendship === 'friends') {
    const btn = h(`<button class="link-btn" type="button">${esc(t('friends.unfriend'))}</button>`);
    btn.addEventListener('click', async () => {
      if (!await confirmDialog({
        body: t('friends.unfriendConfirm', { name: p.username || t('friends.unknownUser') }),
        confirmLabel: t('friends.unfriend'),
      })) return;
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
