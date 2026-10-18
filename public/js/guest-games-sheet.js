/* Spielwirbel – a guest's sheet on the session setup ring (#1681): the games
   this guest brought to tonight's draw, „Spiel mitbringen", and „Gast
   entfernen" (which used to be the whole tap on a guest seat).

   A brought game is a GUEST GAME — a real round.games row off the shelf
   (`guestGame: true`), so results, ratings and the Chronik resolve it like any
   other game. Bringing one either reuses an earlier guest game of this round (a
   quick pick, or the server's own reuse when the same title is entered again)
   or creates one through the ordinary add-game form in its guest mode.

   Frontend shared-scope script; load order: see index.html. */

'use strict';

// The line a session's game list shows under a GUEST GAME (#1681): „Gastspiel"
// and, where the session knows the guest, „mitgebracht von Dana". Empty for any
// other game, so a caller can interpolate it unconditionally. A guest game moved
// onto the shelf afterwards stays attributed in the session that brought it —
// `session.guests[i].gameIds` is history, the flag on the row is the present.
function guestGameNote(session, game) {
  const by = broughtGames(session).get(game.id);
  if (by) return t('guestGames.broughtBy', { name: by.name });
  return game.guestGame === true ? t('guestGames.marker') : '';
}

// Move a guest game onto the shelf or the wish list (#1681) — the one request
// both the results offer and the game's detail page send. `done` re-renders
// whatever screen asked; the toast names where the game went.
async function releaseGuestGame(round, game, to, done) {
  try {
    await api('POST', `/api/rounds/${round.id}/games/${game.id}/guest-game`, { to });
    toast(t(to === 'wish' ? 'guestGames.toWish' : 'guestGames.toShelf', { title: game.title }), { tone: 'success' });
    if (done) done();
  } catch (e) {
    toast(e.message, { tone: 'error' });
  }
}

// The results screen's offer for the guest games a session drew (#1681): one
// line per game that is STILL a guest game, with „Ins Regal" and „Auf die
// Wunschliste". Null when there is none, so the screen grows nothing for an
// ordinary evening. Only once the session is over — while it runs, deciding the
// fate of a box nobody has played yet is the wrong question.
function guestGameOffers(round, session, games) {
  if (!session.finished && !session.cancelled) return null;
  const open = (games || []).filter((g) => g && g.guestGame === true);
  if (!open.length || !roundCan(round, 'round.write')) return null;
  const wrap = h(`<section class="guest-offer" aria-labelledby="guestOfferTitle">
      <h2 class="guest-offer__title" id="guestOfferTitle">${esc(tn(open.length, 'guestGames.offerTitleOne', 'guestGames.offerTitle'))}</h2>
    </section>`);
  open.forEach((g) => {
    const row = h(`<div class="guest-offer__row">
        <span class="guest-offer__game"><i class="ti ti-door" aria-hidden="true"></i> ${esc(g.title)}</span>
        <span class="guest-offer__acts">
          <button type="button" class="btn btn--sm" data-to="shelf"><i class="ti ti-cards" aria-hidden="true"></i> ${esc(t('guestGames.actShelf'))}</button>
          <button type="button" class="btn btn--sm btn--ghost" data-to="wish"><i class="ti ti-heart" aria-hidden="true"></i> ${esc(t('guestGames.actWish'))}</button>
        </span>
      </div>`);
    row.querySelectorAll('[data-to]').forEach((btn) => btn.addEventListener('click', () => {
      row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      releaseGuestGame(round, g, btn.dataset.to, () => {
        g.guestGame = false;
        row.remove();
        if (!wrap.querySelector('.guest-offer__row')) wrap.remove();
      });
    }));
    wrap.appendChild(row);
  });
  return wrap;
}

// `onChange` is the ring's own change callback, so the seat badge, the pool
// preview and the team picker all refresh from one path.
function openGuestSheet(round, guestList, key, onChange) {
  const name = guestList.nameOf(key);
  const title = t('guestGames.sheetTitle', { name });
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet guest-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__head">
          <h2>${esc(title)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <p class="muted guest-sheet__intro">${esc(t('guestGames.intro', { name }))}</p>
        <ul class="guest-sheet__games"></ul>
        <div class="guest-sheet__picks" hidden>
          <div class="muted guest-sheet__picks-label">${esc(t('guestGames.earlier'))}</div>
          <div class="filter-chips"></div>
        </div>
        <p class="muted guest-sheet__cap" hidden>${esc(t('guestGames.cap', { n: MAX_GUEST_GAMES }))}</p>
        <div class="toolbar sheet__actions">
          <button type="button" class="btn btn--primary" data-act="bring"><i class="ti ti-plus" aria-hidden="true"></i> ${esc(t('guestGames.bring'))}</button>
          <button type="button" class="btn btn--ghost" data-act="remove" style="color:var(--danger)"><i class="ti ti-user-minus" aria-hidden="true"></i> ${esc(t('guestGames.removeGuest'))}</button>
        </div>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  const list = sheet.querySelector('.guest-sheet__games');
  const picks = sheet.querySelector('.guest-sheet__picks');
  const pickChips = picks.querySelector('.filter-chips');
  const cap = sheet.querySelector('.guest-sheet__cap');
  const bringBtn = sheet.querySelector('[data-act="bring"]');
  document.body.appendChild(backdrop);

  const gameById = (gid) => (round.games || []).find((g) => g.id === gid);

  function render() {
    const mine = guestList.gamesOf(key);
    list.replaceChildren(...mine.map((gid) => {
      const g = gameById(gid);
      const gameTitle = g ? g.title : '?';
      const row = h(`<li class="guest-sheet__game">
          <i class="ti ti-door" aria-hidden="true"></i>
          <span class="guest-sheet__title">${esc(gameTitle)}</span>
          <button type="button" class="btn btn--ghost btn--sm" aria-label="${esc(t('guestGames.unbring', { title: gameTitle }))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </li>`);
      row.querySelector('button').addEventListener('click', () => {
        guestList.unbring(key, gid);
        onChange();
        render();
      });
      return row;
    }));
    list.hidden = mine.length === 0;
    const full = mine.length >= MAX_GUEST_GAMES;
    // Earlier guest games of this round, not yet brought by anyone tonight —
    // one tap, and the history of that game stays on one row.
    const taken = guestList.broughtIds();
    const earlier = (round.games || []).filter((g) => g.guestGame === true && !taken.has(g.id));
    pickChips.replaceChildren(...earlier.map((g) => {
      const chip = h(`<button type="button" class="chip"><i class="ti ti-plus" aria-hidden="true"></i>${esc(g.title)}</button>`);
      chip.addEventListener('click', () => {
        guestList.bring(key, g.id);
        onChange();
        render();
      });
      return chip;
    }));
    picks.hidden = full || earlier.length === 0;
    bringBtn.hidden = full;
    cap.hidden = !full;
  }
  render();

  const dismiss = () => closeSheet();
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  sheet.querySelector('.sheet__close').addEventListener('click', dismiss);

  // The add-game form REPLACES this sheet (openSheet reuses the history marker,
  // .claude/rules/sheet-history-back-dismissal.md §2), and on a save reopens it
  // the same way, so Back still dismisses exactly one sheet.
  bringBtn.addEventListener('click', () => {
    showAddGameForm(round, {
      guest: {
        name,
        onCreated(game) {
          if (!gameById(game.id)) round.games.push(game);
          guestList.bring(key, game.id);
          onChange();
          openGuestSheet(round, guestList, key, onChange);
        },
      },
    });
  });
  sheet.querySelector('[data-act="remove"]').addEventListener('click', () => {
    guestList.remove(key);
    closeSheet();
    onChange();
  });
}
