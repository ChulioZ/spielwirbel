/* Spielwirbel – view: the public account profile at /u/:username (#558).

   Its own file since #1089, which gave the screen real content (an account's
   play statistics and its own activity feed); rebuilt as die Spielerkarte in
   #1132. What it shares with Der Kreis — accountColor, friendAvatar, friendName,
   accountReportButton — stays in views-friends.js, and the feed's two renderers
   in feed-view.js, because each has another caller over there.

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
  const back = backRow(() => showFriends());
  app.appendChild(back);

  const reload = () => showProfile(username);

  /* ONE wrapper for everything below the back row, so the screen can leave the
     reading measure as a UNIT (.claude/rules/responsive-content-width.md). The
     card, the feed heading and the tile grid used to take three different
     widths from 1280px up — 900 / 1240 / 900 — because `.profile-stats`
     inherited the `.pokale-cards` exemption while its neighbours did not.
     The back row stays a SIBLING and is named beside this wrapper in the
     exemption itself: capped at 900 it would leave the „…" menu ~250px inside
     the page's right edge (the #543/#577 lesson). */
  const screen = h('<div class="profile-screen"></div>');
  screen.appendChild(renderProfileCard(p, reload));

  // On a FRIEND's profile, say what the record is and what it is not — the
  // aggregate names no round, no other member and no individual session, and
  // the reader cannot tell that from the numbers alone.
  if (p.stats && p.stats.sessions && !p.self) {
    screen.appendChild(h(`<p class="muted profile-note">${esc(t('profile.statsNote'))}</p>`));
  }

  /* The friend's own feed, between accepted friends only. The server applies
     the acceptedAt cutoff (lib/routes/profile.js), so nothing predating the
     friendship can arrive here. On your OWN profile the same list is your whole
     activity, with no cutoff — there is no friendship to date one from. */
  if (p.friendship === 'friends' || p.self) {
    screen.appendChild(h(`<h2 class="friends-section__h">${esc(t('profile.feedTitle'))}</h2>`));
    if (p.events && p.events.length) {
      /* The tile grid #1136 gives the Freundeskreis, through the SAME renderer
         — the same content in the same shape, so the two screens read alike.
         `noAuthor` because every event here belongs to the account in the <h1>
         above, which is also why the route omits `username` from the rows;
         `noReport` on your own profile, for the reason the account report
         button has always been hidden there. */
      screen.appendChild(renderFeedTiles(
        p.events.map((ev) => ({ ...ev, username: p.username, avatar: p.avatar })),
        { noAuthor: true, noReport: !!p.self },
      ));
    } else {
      // Two empty states: the friend one dates itself from the friendship, which
      // is a sentence your OWN profile cannot say — there is no friendship, and
      // the list there has no cutoff at all.
      screen.appendChild(h(`<p class="muted empty-note">${esc(t(p.self ? 'profile.feedEmptySelf' : 'profile.feedEmpty'))}</p>`));
    }
  }
  app.appendChild(screen);

  /* The rare actions in the back row's „…" menu (#1132) — the Spielepass's
     component (#1039) and the Tischkarte's placement (#1074), not a third menu
     shape. Built last because it needs `reload`, and appended to the back row
     that is already in the DOM. */
  const items = profileMenuItems(p, reload);
  if (items.length) {
    back.classList.add('back-row--split');
    const menuBtn = h(`<button type="button" class="btn btn--sm gd-menu" aria-label="${esc(t('detail.moreActions'))}" aria-expanded="false"><i class="ti ti-dots" aria-hidden="true"></i></button>`);
    // Buttons only, so this is a popover at EVERY width — the account menu's
    // case, not the editors' (.claude/rules/popover-vs-sheet-editors.md §2b).
    // `aria-expanded` is synced through openPopover's onClose rather than by
    // wrapping `close`: the wrapped form misses four of the six exits.
    menuBtn.addEventListener('click', () => {
      openPopover(menuBtn, (el, close) => {
        el.classList.add('popover--menu');
        items.forEach(([icon, label, cls, run]) => {
          const b = h(`<button class="popover__opt ${cls}"><i class="ti ${icon}" aria-hidden="true"></i> ${esc(label)}</button>`);
          b.addEventListener('click', () => { close(); run(); });
          el.appendChild(b);
        });
      }, () => menuBtn.setAttribute('aria-expanded', 'false'));
      menuBtn.setAttribute('aria-expanded', 'true');
    });
    back.appendChild(menuBtn);
  }
}

/* Die Spielerkarte (#1132): ONE card in the account's colour carrying the whole
   record — who this is, how they play, what they are strongest at. It is die
   Tischkarte's shape (#1074/#1075) for an account, built from that component's
   own block classes rather than from a parallel set, because it holds the same
   numbers computed by the same function (lib/user-stats.js runs `memberStats`
   per seat) and they must read the same.

   It replaced a head band, an action row, a „Bilanz" section and a report
   button — four treatments for one record, at three different widths from
   1280px up. Measured before: seven figures wrapping 3+3+1 on a phone with
   „Gespielte Spiele" alone on the last row, two game tiles 709–874px wide for a
   64px thumb and two words, and „Aktivitäten" at y = 870 on a 390×844 phone.

   `--m-tone` is set on the CARD rather than on the avatar, because four things
   read it — the wash, the ring, the figure strip's rules and the state chip —
   and a property set on a child cannot be read by its parent. It comes from
   `accountColor`, the same helper `friendAvatar` paints the face with, so the
   card and the face cannot be two definitions of the account's colour. */
function renderProfileCard(p, reload) {
  const name = p.username || t('friends.unknownUser');
  const tone = accountColor(p.username);
  const st = p.stats;
  const record = !!(st && st.sessions);

  /* The ring IS the Siegquote (#1075), so the one number saying how this account
     does is the shape of its own face. `winRate === null` — no contested session
     at all — gets the plain tone ring: a 0 % gauge would say "never wins" about
     somebody who has never been in a contest. */
  const pct = record && st.winRate !== null ? Math.round(st.winRate * 100) : null;
  const card = h(`<div class="profile-card" style="--m-tone:${tone}">
       <span class="member-card__mark" aria-hidden="true">${esc(initials(name))}</span>
       <div class="member-card__id">
         <span class="member-ring${pct === null ? ' member-ring--none' : ''}"${pct === null ? '' : ` style="--pct:${pct}"`}></span>
         <div class="member-card__who">
           <h1>${esc(name)}</h1>
           <p class="muted profile-card__meta"></p>
           <div class="member-card__state"></div>
         </div>
       </div>
     </div>`);

  /* The avatar. On your OWN profile it is a real <button> wearing the pencil
     badge and leading to Konto — the screen that actually holds the picture and
     the stats switch, which nothing on this page linked to before. On anyone
     else's it is the inert face `friendAvatar` renders everywhere, because
     there is nothing to edit. A focusable span would be neither a control nor
     announced as one (.claude/rules/native-button-vs-focusable-span.md). */
  const ring = card.querySelector('.member-ring');
  if (p.self) {
    const btn = h(`<button type="button" class="avatar member-avatar" style="background:${tone}" aria-label="${esc(t('profile.editPicture'))}">${avatarFace(initials(name), { src: p.avatar })}<span class="member-avatar__pen" aria-hidden="true"><i class="ti ti-pencil"></i></span></button>`);
    btn.addEventListener('click', () => showAccount());
    ring.appendChild(btn);
  } else {
    ring.appendChild(h(friendAvatar(p.username, p.avatar, 'member-avatar')));
  }

  /* The meta line: the two figures that describe BREADTH rather than
     performance. They left the strip in #1132 — with them it was seven figures,
     which wrapped 3+3+1 on a phone and left one standing alone; without them it
     is the Tischkarte's five, which the `flex: 1 1 88px` arithmetic wraps 3+2. */
  const meta = [];
  if (p.createdAt) meta.push(esc(t('profile.memberSince', { when: fmtMonth(p.createdAt) })));
  if (record) {
    const bold = (n) => `<strong>${n}</strong>`;
    meta.push(tn(st.rounds, 'profile.metaRoundsOne', 'profile.metaRounds', { n: bold(st.rounds) }));
    meta.push(tn(st.gamesPlayed, 'profile.metaGamesOne', 'profile.metaGames', { n: bold(st.gamesPlayed) }));
  }
  const metaEl = card.querySelector('.profile-card__meta');
  if (meta.length) metaEl.innerHTML = meta.join(' · ');
  else metaEl.remove();

  renderProfileState(card.querySelector('.member-card__state'), p, reload);

  /* An empty record is one muted line where the strip would be. Five zero tiles
     would read as a broken card rather than as an empty one — and „0 %" in
     particular claims something false about somebody who has never been in a
     contest. `stats` ABSENT (a stranger, a pending request, or a friend who
     switched the record off) is a different state again: it gets no line at
     all, because there is nothing to say about an account that has not chosen
     to say it. */
  if (st && !record) {
    card.appendChild(h(`<p class="muted empty-note">${esc(t(p.self ? 'profile.statsEmptySelf' : 'profile.statsEmpty'))}</p>`));
    return card;
  }
  if (!record) return card;

  /* Five figures in ONE strip, in the Tischkarte's order and treatment. There is
     no grid, so no track can be empty at any viewport. */
  const figures = h('<div class="member-card__figures"></div>');
  const figure = (label, value, extra) =>
    figures.appendChild(h(`<div class="member-figure">
         <span class="member-figure__value">${esc(value)}</span>
         ${extra || ''}
         <span class="member-figure__label">${esc(label)}</span>
       </div>`));
  /* Four figures, no bar — the same call the member page makes, and for the same
     reason: `.member-bar` was the Siegwertung's encoding and went with it on
     2026-09-22. See views-member.js. */
  figure(t('member.wins'), String(st.wins));
  figure(t('member.winRate'), st.winRate === null ? '–' : Math.round(st.winRate * 100) + '%');
  figure(t('member.sessions'), String(st.sessions));
  figure(t('member.avgGiven'), st.avgGiven === null ? '–' : 'Ø ' + fmtAvg(st.avgGiven));
  card.appendChild(figures);

  /* The two game tiles as the Tischkarte's ribboned boxes. What is NOT reused is
     the wiring: `wireGameCardHead` makes each tile a link into a round, and a
     profile has no round context — nor may it have one, since the payload
     deliberately carries no round id. So the thumb stays a <span> and the titles
     stay plain text (.claude/rules/in-app-nav-links.md). */
  const cards = h('<div class="pokale-cards member-card__games"></div>');
  const loadCover = createCoverLoader();
  const gameCard = (icon, label, games, sub, ribbon) => {
    const lead = games[0];
    const tile = h(`<div class="pokale-card">
         ${games.length ? `<span class="member-ribbon">${esc(ribbon)}</span>` : ''}
         ${lead
    ? `<span class="pokale-card__thumb">${coverPlaceholder(lead)}</span>
            <span class="pokale-card__label"><i class="ti ${icon}" aria-hidden="true"></i>${esc(label)}</span>`
    : `<span class="pokale-card__icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
            <span class="pokale-card__label">${esc(label)}</span>`}
         <span class="pokale-card__games"></span>
         <span class="pokale-card__sub">${esc(sub)}</span>
       </div>`);
    if (lead) {
      tile.classList.add('pokale-card--cover');
      if (lead.image) loadCover(tile.querySelector('.pokale-card__thumb'), coverUrl(lead.image, COVER_THUMB));
    }
    const list = tile.querySelector('.pokale-card__games');
    games.forEach((g) => list.appendChild(h(`<span class="pokale-game">${esc(g.title)}</span>`)));
    return tile;
  };
  /* Ties share the tile, as on the member page. `bestScore === null` is the only
     empty state — 0 is a real win RATE (a game played often and never won), and
     a game below BEST_GAME_MIN_PLAYS is unranked rather than zero. */
  cards.appendChild(gameCard('ti-sword', t('member.bestGame'), st.bestGames,
    st.bestScore === null ? t('member.bestGameNone') : bestGameSub(st), t('member.ribbonBest')));
  cards.appendChild(gameCard('ti-heart', t('member.favorite'), st.favorite,
    st.favAvg === null ? t('member.favoriteNone') : 'Ø ' + fmtAvg(st.favAvg), t('member.ribbonFav')));
  card.appendChild(cards);

  return card;
}

/* The state row: at most one chip, and at most the ONE action the viewer's
   relationship allows — as a real button in the card rather than as a link
   between the head and the record, which is where „Entfernen" used to sit.

   The chip is mutually exclusive by construction: a relationship has exactly one
   state. Everything rarer than "the obvious next step" is in the „…" menu
   below, which is what lets this row hold one control at most.

   A demo account (#427) is shown the explanation instead of a send button:
   demo.refuseDemoAccount guards POST /friends, so the button could only ever
   fail — the same reasoning showAccount() uses for the password form. */
function renderProfileState(row, p, reload) {
  const chip = (text, cls) =>
    row.appendChild(h(`<span class="member-card__chip${cls ? ' ' + cls : ''}">${esc(text)}</span>`));

  if (p.self) return chip(t('profile.chip.self'));

  if (p.friendship === 'friends') {
    /* „Befreundet seit" was a second muted line under the name; as the chip it
       states the relationship AND its date in the account's own colour, and the
       one action it implies („Freundschaft beenden") is in the menu.

       No `since` means no chip, rather than a date-less one. The route sets it
       from `acceptedAt` on every accepted row, so this is unreachable today —
       and the menu still says you are friends by offering „Entfernen". The
       fallback that suggests itself, `friends.pending`, would print
       „Ausstehend" over an accepted friendship. */
    if (p.since) chip(t('profile.chip.friends', { when: fmtMonth(p.since) }));
    return row;
  }

  if (p.friendship === 'incoming') {
    chip(t('profile.chip.incoming'));
    const accept = h(`<button class="btn btn--sm btn--primary" type="button">${esc(t('friends.accept'))}</button>`);
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
    row.appendChild(accept);
    row.appendChild(decline);
    return row;
  }

  // Sent, and waiting: a fact about something you already did, so the chip takes
  // the quiet variant and the only action („Zurückziehen") is in the menu.
  if (p.friendship === 'outgoing') return chip(t('profile.chip.outgoing'), 'member-card__chip--retired');

  // No relationship yet — the one state whose action a newcomer is looking for.
  if (isDemoAccount()) return row.appendChild(h(`<p class="muted">${esc(t('profile.demoNote'))}</p>`));
  const send = h(`<button class="btn btn--sm btn--primary" type="button">${esc(t('friends.addSubmit'))}</button>`);
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
  return row.appendChild(send);
}

/* The „…" menu's items, as the Tischkarte builds them: `[icon, label, class,
   run]`. Each is an action done at most once per account, which is exactly what
   the menu is for — they were a link in the middle of the page („Entfernen") and
   a lone flag button under the head („Melden").

   „Melden" is offered in every state but your own, which is the gate the report
   button already had: an operator receiving "user X reports user X" learns
   nothing. Keeping it on the pending states matters — it is the DSA Art. 16(1)
   entry point for an account (#841), and a layout change must not close it.
   `accountReportButton` returns null when the contact channel is unconfigured,
   and that gate is report-link.js's own; don't second-guess it here. */
function profileMenuItems(p, reload) {
  const items = [];
  if (p.self) return items;

  if (p.friendship === 'friends') {
    items.push(['ti-user-minus', t('friends.unfriend'), 'popover__opt--warn', async () => {
      if (!await confirmDialog({
        body: t('friends.unfriendConfirm', { name: p.username || t('friends.unknownUser') }),
        confirmLabel: t('friends.unfriend'),
      })) return;
      try {
        await accountApi('DELETE', `/friends/${p.friendshipId}`);
        toast(t('friends.toast.removed'));
        reload();
      } catch { toast(t('friends.err.generic')); }
    }]);
  } else if (p.friendship === 'outgoing') {
    items.push(['ti-user-x', t('friends.cancel'), 'popover__opt--muted', async () => {
      try { await accountApi('POST', `/friends/${p.friendshipId}/decline`); } catch {}
      reload();
    }]);
  }

  const report = accountReportButton(p.username);
  if (report) items.push(['ti-flag', t('friends.reportAccount'), '', () => report.click()]);
  return items;
}
