/* Spielwirbel – the friend feed, in its two presentations (#325, #1132).

   Its own file since #1132, which gave the feed a second shape. It is a
   COMPONENT rather than a screen: three callers on three screens read it — the
   Freundeskreis and the home dashboard (views-friends.js) and an account profile
   (views-profile.js) — so it belongs to none of them, and the two presentations
   stay together because they render the same events and must keep saying the
   same thing.

   Which shape goes where is `.claude/rules/tiles-vs-lists.md` applied twice:
   the ROW is right in a narrow section (the home tile's five-event preview),
   the TILE where the feed is the content and has a whole screen's width.

   Part of the frontend; all files share one global script scope (load order:
   see index.html — before views-friends.js, whose friendAvatar/friendName it
   calls at call time only, never at load time). */

'use strict';


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
   over the 12-month retention (#1357), and the row still carries the title
   they name. */
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

/* ------------------------------ the feed as tiles -------------------------- */

/* The same events as a WALL (#1132, and #1136 for the Freundeskreis): the
   Stempelkarte's grid shape rather than a column of rows.

   A feed row is 68px of page for one line of news, in a measure it does not use
   — 26 events measure 2261px as rows against 463px as tiles. Tiling is allowed
   here although `.claude/rules/tiles-vs-lists.md` reserves it for unordered
   content, because the grid stays ROW-MAJOR and newest first: a wrapped strip
   read left-to-right is still the sequence, which is the property that rules a
   ranking out of a grid.

   ONE renderer, consumed by both screens. The profile passes `noAuthor`, since
   every event there belongs to the account named in the <h1> above and the
   meta row would otherwise repeat that name once per tile. Building a second
   near-identical renderer is the change being wrong however green it is. */

// How many tiles the collapsed grid shows below 1024px. At the phone's two
// columns that is FOUR rows, ~187px each — measured on #1136, correcting this
// comment, which said two. Above 1024 nothing is capped at all: four rows of
// tiles across seven columns is not a screenful.
const FEED_TILES_COLLAPSED = 8;

/* The tile's verb. Deliberately shorter than feedText's sentence: the tile
   already names the game above it and (on the Freundeskreis) the author beside it,
   so
   the sentence would print both twice. Same three branches as feedText,
   including the plural — `games_imported` carries a COUNT, so t() is not
   enough (.claude/rules/source-scanning-guards-enumerate-shapes.md). */
function feedTileVerb(ev) {
  if (ev.type === 'session_played') return t('friends.tile.played');
  if (ev.type === 'games_imported' && Number.isInteger(ev.count) && ev.count > 1) {
    const n = ev.count - 1;
    return tn(n, 'friends.tile.importedOne', 'friends.tile.imported', { n });
  }
  return t('friends.tile.added');
}

function renderFeedTile(ev, opts) {
  const o = opts || {};
  const imgStyle = ev.coverUrl ? ` style="background-image:url('${coverUrl(ev.coverUrl, COVER_THUMB)}')"` : '';
  const fallback = ev.coverUrl ? '' : '<i class="ti ti-cards" aria-hidden="true"></i>';
  // The author rides the meta row rather than the cover's corner: a 172px tile
  // has a full-width line under the title, so the person needs no badge to
  // avoid taking a column from the news.
  const who = o.noAuthor ? ''
    : `<span class="e-tile__who">${friendAvatar(ev.username, ev.avatar)}<span class="e-tile__name">${friendName(ev.username)}</span></span>`;
  const tile = h(`<div class="e-tile">
      <span class="e-tile__img"${imgStyle}>${fallback}</span>
      <span class="e-tile__title">${esc(ev.title || '')}</span>
      <span class="e-tile__meta">
        ${who}
        <span class="e-tile__verb">${esc(feedTileVerb(ev))}</span>
        <span class="e-tile__date">${esc(fmtDate(ev.at))}</span>
      </span>
    </div>`);

  /* The DSA Art. 16(1) notice channel follows the content it is about (#559).
     The row form carries one and the tile replaces the row, so dropping it here
     would close the entry point by a layout change — which is why `noReport` is
     an explicit opt-out for the ONE case where it says nothing (your own
     profile: an operator receiving "user X reports user X" learns nothing). */
  if (o.noReport) return tile;
  const url = feedReportUrl({
    username: ev.username,
    subject: t('friends.feed.reportSubject', {
      user: ev.username || '',
      game: ev.title || '',
      date: fmtDateTime(ev.at),
    }),
  });
  if (url) {
    const btn = h(`<button class="e-tile__report" type="button"
        aria-label="${esc(t('friends.feed.report'))}" title="${esc(t('friends.feed.report'))}">
        <i class="ti ti-flag" aria-hidden="true"></i></button>`);
    // New tab (#390), matching the row's button, so the SPA stays loaded behind
    // the contact page; noopener prevents a window.opener leak.
    btn.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
    tile.appendChild(btn);
  }
  return tile;
}

/* Der Tisch's feed row (#1272, T14.1 „Was bei den anderen läuft"): the author's
   face first, the sentence and its time, and the game's cover standing at the
   right edge like a box on the table. It is the row form's content re-composed —
   the same `feedText` sentence and the same report entry point — with the
   person moved off the cover's corner into a column of their own, which the
   sheet draws and a Tisch row has the width for.

   The cover only when the event carries one. Every feed event names a game, but
   `coverUrl` is what the allowlisted payload holds for it (lib/feed-events.js),
   and nothing is added to reach a cover the event does not already carry — so a
   game with no art gets no box rather than an empty one. aria-hidden: the
   sentence beside it already names the game. */
function renderFeedRow(ev) {
  const cover = ev.coverUrl
    ? `<span class="feed-item__img feed-row__cover" aria-hidden="true" style="background-image:url('${coverUrl(ev.coverUrl, COVER_THUMB)}')"></span>`
    : '';
  const row = h(`<div class="feed-item feed-row">
      ${friendAvatar(ev.username, ev.avatar, 'feed-row__face')}
      <div class="feed-item__body">
        <div class="feed-item__text">${feedText(ev)}</div>
        <div class="feed-item__time muted">${esc(fmtDateTime(ev.at))}</div>
      </div>
      ${cover}
    </div>`);
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
    btn.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
    row.appendChild(btn);
  }
  return row;
}

/* The grid plus its expander. EVERY tile is rendered and the collapse is CSS,
   never a slice: a width read once at render time is wrong the moment the window
   changes, and these screens re-render only on an action.

   `opts.rows` lays the same events out as Der Tisch's rows (#1272), under the
   same expander and the same eight-then-more collapse, so „Alle anzeigen" from
   the home tile keeps its promise under either design.

   `opts.more` (#1357) pages the list: `{ nextCursor, load(cursor) }`, where
   `load` resolves to the next `{ events, nextCursor }`. See feedPager below. */
function renderFeedTiles(events, opts) {
  const o = opts || {};
  const wrap = h('<div class="e-feed"></div>');
  const rows = !!o.rows;
  const grid = h(rows ? '<div class="feed-list feed-list--rows"></div>' : '<div class="e-grid"></div>');
  const render = (ev) => (rows ? renderFeedRow(ev) : renderFeedTile(ev, opts));
  events.forEach((ev) => grid.appendChild(render(ev)));
  wrap.appendChild(grid);
  if (events.length > FEED_TILES_COLLAPSED) {
    const more = h(`<button type="button" class="link-btn e-feed__more">${esc(t('friends.feedMore', { count: events.length }))}</button>`);
    more.addEventListener('click', () => wrap.classList.add('is-open'));
    wrap.appendChild(more);
  } else if (o.more && o.more.nextCursor) {
    // Nothing is collapsed, so there is no expander to lift the collapse off a
    // later page — open the list now, or appended tiles would arrive hidden.
    wrap.classList.add('is-open');
  }
  if (o.more && o.more.nextCursor) feedPager(wrap, grid, render, o.more);
  return wrap;
}

/* Infinite scroll for a paged feed (#1357).

   The sentinel is a real BUTTON („Mehr laden"), not an empty div watched by an
   observer: a keyboard or screen-reader user gets a control that loads the next
   page, a browser without IntersectionObserver still works, and the observer
   does nothing but click it. One request in flight at a time, and the guard is
   `disabled` ALONE: a disabled button dispatches no click, whether a finger or
   the observer's `btn.click()` asks. A separate `busy` flag was written first
   and deliberately taken out — breaking it on purpose left every test green,
   because `disabled` had already absorbed the case
   (.claude/rules/redundant-guards-make-each-other-untestable.md), so it guarded
   nothing and would have hidden the real guard from the next cleanup.

   Pages APPEND to the same grid, never re-render it: a list the user has
   already expanded stays expanded, and while it is still collapsed below 1024px
   the CSS collapse hides `.e-feed__load` too, so the observer cannot load pages
   nobody can see (a hidden element never intersects). When `nextCursor` comes
   back null the observer is disconnected and the button STAYS, reading „Alles
   geladen" (#1357's merge interview): removing it dropped a keyboard user's
   focus to <body>. It is `aria-disabled`, never `disabled` — the browser's focus
   fixup moves focus off an element the moment it becomes disabled, which is the
   same jump — so the end state is guarded by the missing cursor instead.

   After each page the button is re-observed, because an IntersectionObserver
   reports CHANGES: a short page that leaves the button in view would otherwise
   never fire again. A failed load re-enables the button for a retry and does
   NOT re-observe, so an outage cannot turn into a request loop. */
function feedPager(wrap, grid, render, more) {
  let cursor = more.nextCursor;
  let io = null;
  const row = h(`<div class="e-feed__load"><button type="button" class="btn btn--sm">${esc(t('friends.feedLoadMore'))}</button></div>`);
  const btn = row.querySelector('button');
  wrap.appendChild(row);

  btn.addEventListener('click', async () => {
    if (!cursor) return;
    btn.disabled = true;
    btn.textContent = t('friends.feedLoading');
    let page = null;
    try {
      page = await more.load(cursor);
    } catch {
      // accountApi has already told the user; leave a working button behind.
    }
    btn.disabled = false;
    btn.textContent = t('friends.feedLoadMore');
    if (!page) return;
    (page.events || []).forEach((ev) => grid.appendChild(render(ev)));
    cursor = page.nextCursor || null;
    if (!cursor) {
      if (io) io.disconnect();
      btn.setAttribute('aria-disabled', 'true');
      btn.textContent = t('friends.feedAllLoaded');
      return;
    }
    if (io) { io.unobserve(btn); io.observe(btn); }
  });

  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) btn.click();
    }, { rootMargin: '400px 0px' });
    io.observe(btn);
  }
}

