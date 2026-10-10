/* Spielwirbel – views: the results screen's table band (#1057) and headline —
   the chosen game in its three states (am Tisch, the winner picker, the
   record), the save that finishes a session, and the h1 that states the
   outcome. Every design renders this band, Klassisch included. Split out of
   showResults (#1543).

   Every function here takes the results screen's one context object, `rs`,
   built once by showResults (views-session.js) — see its comment there for
   what it holds. Fixed inputs and DOM nodes are destructured at the top of
   each function; the evening's PHASE (`rs.chosenId`, `rs.finished`,
   `rs.cancelled`, `rs.winnerIds`, `rs.ending`, `rs.pickerOpen`, …) is always
   read and written through `rs`, because the screen's controls change it after
   render and every function must see the change. Nothing here names
   showResults: a re-render goes through `rs.reopen`, so the dependency runs one
   way (#1543, the #968 shape). Part of the frontend; all files share one global
   script scope. */

function resultUpdateTitle(rs) {
  const { forestLook, brueckeLook, phLook, forestFacts, titleEl, round, session, people, games } = rs;
  if (forestLook) {
    paintForestFacts(forestFacts, {
      round, session, finished: rs.finished && !rs.cancelled, winnerIds: rs.winnerIds, people,
      game: rs.chosenId ? games.find((x) => x.id === rs.chosenId) : null,
    });
  }
  if (rs.cancelled) {
    titleEl.textContent = t('result.titleCancelled');
  } else if (rs.finished && rs.chosenId) {
    const g = games.find((x) => x.id === rs.chosenId);
    const gname = g ? g.title : '';
    const names = rs.winnerIds
      .map((wid) => personLabel(people.find((p) => p.id === wid)))
      .filter(Boolean);
    if (names.length === 0) {
      // „wurde gespielt." was the only sentence a winnerless night could get,
      // and it reads as unfinished business for the three nights that are
      // finished (#1038). `ending` is the session's own copy, kept in step by
      // resultSaveWinners below.
      const meta = ENDING_LABELS[rs.ending];
      titleEl.textContent = meta
        ? t(meta.title, { game: gname })
        : t('result.titlePlayed', { game: gname });
    } else {
      titleEl.textContent = tn(names.length, 'result.titleWonOne', 'result.titleWonMany', {
        game: gname,
        names: joinNames(names),
      });
      // Who won, in the accent (B2.5, B4.3; a tie names both, B16.3).
      if (brueckeLook || phLook) splitResultTitle(titleEl, gname);
    }
  } else {
    titleEl.textContent = t('result.title');
  }
}

/* Der Tisch (#1057). One builder for all three states of the chosen game, so
   the evening and the record cannot drift apart:

     am Tisch   — box, title, who brings it, the expansion note, „Als gespielt
                  markieren" and „Anderes Spiel wählen".
     frisch fertig — the stamp on the box and the picker OPEN, because the one
                  question left is who won.
     im Archiv  — the stamp and the winners as SEATS, with the picker behind
                  „Ändern". The record needs the outcome once, as a picture.

   `resultUpdateChosen()` calls this on every phase change, so nothing here holds
   state of its own beyond `pickerOpen`. */
function resultRenderBand(rs) {
  const { round, session, games, rows, parties, people, tischLook, peopleEl, rowRefs, badgeMoment, tisch, tischSlot, tischBar } = rs;
  resultUpdateTitle(rs);
  fillBadgeMoment(badgeMoment, round, session);
  // Consumed at the top so every exit, including the early return below,
  // clears it — a stale intent must not fire on a later, unrelated render.
  const wantedChip = rs.pickerRefocus;
  rs.pickerRefocus = null;
  // Der Tisch's crowns and foot follow every phase change, and this is the
  // one function all of them reach — including the early return below.
  if (tischLook) {
    paintComposedCrowns(peopleEl, rs.winnerIds);
    resultRenderFoot(rs);
  }
  rowRefs.forEach(({ gameId, ownersEl }) => {
    // The table band states the same fact with more context, so the chosen
    // row's own line stands down rather than saying it twice on one screen.
    if (ownersEl) ownersEl.hidden = gameId === rs.chosenId;
  });
  tisch.innerHTML = '';
  tischBar.innerHTML = '';
  // Cleared on every pass and re-set below only for the one render that earned
  // it: an attribute left behind would re-run the animation on the next write.
  tischSlot.removeAttribute('data-unroll');
  tischSlot.removeAttribute('data-stamped');
  tisch.hidden = !rs.chosenId;
  tischBar.hidden = true;
  if (!rs.chosenId) { rs.freshChoice = false; rs.freshStamp = false; return; }
  if (rs.freshChoice) { tischSlot.setAttribute('data-unroll', ''); rs.freshChoice = false; }
  if (rs.freshStamp) {
    if (tischLook && rs.finished) tischSlot.setAttribute('data-stamped', '');
    rs.freshStamp = false;
  }
  const game = games.find((g) => g.id === rs.chosenId);
  /* Three states, matching the three render branches below exactly — the
     picker is a sub-state of `done`, not a fourth one: the finish is already
     recorded when it opens. `picking` is what lets the phone rule narrow the
     band while the question is on screen (#1139) without touching the width
     the record is read at. */
  tisch.dataset.state = !rs.finished ? 'table' : (rs.pickerOpen ? 'picking' : 'done');

  const imgStyle = game && game.image
    ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"`
    : '';
  const box = h(`<a class="tisch__box"${imgStyle}>${game ? coverPlaceholder(game) : ''}</a>`);
  if (game) makeGameLink(box, round.id, game.id, { redundant: true });
  if (rs.finished) {
    /* The same stamp the game page shows (#1040) — the class, not a
       look-alike — so the two surfaces can never drift. `--sc` is the score,
       which is what makes a well-liked evening's stamp read differently from
       a lukewarm one. `--table` only re-sizes it onto the box. */
    const r = rows.find((x) => x.game && x.game.id === rs.chosenId);
    const sc = r && r.count ? ` style="--sc:${scoreColor(r.score)}"` : '';
    // `finishedAt` only if it actually parses: a session finished before #254
    // recorded one has none, and a garbage value would print „Invalid Date"
    // onto the record rather than falling back to the evening it happened.
    const at = [session.finishedAt, session.createdAt]
      .find((d) => d && !Number.isNaN(Date.parse(d)));
    box.appendChild(h(`<span class="stamp stamp--table"${sc}>
         <span class="stamp__status">${esc(t('result.stamp'))}</span>
         ${at ? `<span class="stamp__date">${esc(fmtDate(at))}</span>` : ''}
       </span>`));
  }

  const main = h('<div class="tisch__main"></div>');
  main.appendChild(h(`<div class="tisch__kick">${esc(t('result.tableTitle'))}</div>`));
  /* The archived badge rides INSIDE the title anchor, exactly as the ranking
     row builds it — same helper, same classes, same placement. Once the Tafel
     is gated away on a solo direct-play session the band is the only surface
     left that can say a game was retired or completed after the fact (#1107),
     and a badge sitting in a different place would be a second implementation
     waiting to drift. It joins the link's accessible name, which is the
     behaviour the row has shipped since #250. */
  const title = h(`<a class="tisch__title">${esc(game ? game.title : '')}${game ? resultArchivedBadge(game) : ''}</a>`);
  if (game) makeGameLink(title, round.id, game.id);
  main.appendChild(title);

  // Say so when the base box does NOT seat this table and an owned expansion
  // is what made the game drawable at all (#653) — otherwise the group
  // carries the wrong box to the table. Derived from the same predicate the
  // draw used, so the warning can never name a different set.
  const needed = game ? requiredExpansions(game, parties.length) : [];
  if (needed.length) {
    main.appendChild(h(`<div class="tisch__note tisch__note--warn">${iconText('ti-alert-triangle', t('result.needsExpansion', { names: needed.map((e) => e.title).join(', ') }))}</div>`));
  }
  // „Gehört Anna" (#971) — who has to bring the box, via the shared rule in
  // owner-picker.js so this band and the ranking rows can never list one
  // game's owners differently (#1008).
  const bringers = boxBringers(round, session, game, shelfParty);
  if (bringers.length) {
    main.appendChild(h(`<div class="tisch__note">${iconText('ti-user', t('result.ownedBy', { names: bringers.join(', ') }))}</div>`));
  }

  const actions = h('<div class="tisch__actions"></div>');
  let restoreChip = null;

  if (!rs.finished) {
    // Finishing comes first and needs no winners; the picker only appears
    // afterwards, so it can never read as a prerequisite (#254).
    const cta = h(`<button class="btn btn--primary tisch__cta">${iconText('ti-check', t('result.markPlayed'))}</button>`);
    cta.addEventListener('click', () => { rs.pickerOpen = true; resultSaveWinners(rs, []); });
    actions.appendChild(cta);
    // Today's toggle-off path, spelled out: tapping „Spielen" again on the
    // chosen row used to be the only way back, which is invisible. Suppressed
    // for a solo direct-play session, where there is no other game (#1107).
    const other = resultIsSoloDirectPlay(rs) ? null
      : h(`<button class="link-btn">${esc(t('result.otherGame'))}</button>`);
    if (other) {
      other.addEventListener('click', async () => {
        try {
          await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/choice`, { gameId: null });
          rs.chosenId = null;
          session.chosenGameId = null;
          resultUpdateChosen(rs);
          toast(t('result.toast.choiceCleared'));
        } catch (e) { toast(e.message, { tone: 'error' }); }
      });
      actions.appendChild(other);
    }
    main.appendChild(actions);
    // The phone's copy of the one CTA. A second button rather than a moved
    // one: both must be live at once, because the band's own CTA is what a
    // tablet and a desktop press.
    const barBtn = h(`<button class="btn btn--primary">${iconText('ti-check', t('result.markPlayed'))}</button>`);
    barBtn.addEventListener('click', () => { rs.pickerOpen = true; resultSaveWinners(rs, []); });
    tischBar.appendChild(barBtn);
    tischBar.hidden = false;
  } else if (rs.pickerOpen) {
    main.appendChild(h(`<div class="tisch__prompt">${esc(t('result.whoWon'))}</div>`));

    /* ONE picker for every design (#1327). Klassisch, Der Tisch, Ocean and any
       design added later all render these rows from here, and its open/close
       behaviour — party taps keep it open, an ending or „Fertig" closes it,
       focus follows the tapped chip — lives here and nowhere else. A design
       RESTYLES the picker (`.winner-chip` in its stylesheet); it must not fork
       it, or the old collapse-on-every-tap comes back on that design alone.

       Guests can win too (#458) — they played the game. They just never enter
       the round-level standings; see the Pokale tab.

       One chip per PARTY (#575), so a team is recorded in a single tap. What
       is stored stays a flat list of person ids: a team win is a win for each
       of its people, which is what lets the Pokale standings, the Chronik and
       the recap keep reading `winnerIds` with no idea teams exist. */
    const chips = h('<div class="winner-chips"></div>');
    parties.forEach((party, pi) => {
      const ids = party.people.map((pp) => pp.id);
      // A team counts as selected only when ALL of its people are in — a
      // partially-set list reads as not selected, so one tap completes it
      // rather than clearing it.
      const sel = ids.every((id) => rs.winnerIds.includes(id));
      const chip = h(`<button class="winner-chip ${sel ? 'is-selected' : ''}" aria-pressed="${sel}">${sel ? '<i class="ti ti-trophy" aria-hidden="true"></i> ' : ''}${party.team ? '<i class="ti ti-users" aria-hidden="true"></i> ' : ''}${esc(party.name)}</button>`);
      // Each toggle persists right away — no separate save button in this
      // state — and leaves the picker OPEN (#1327), so a shared win is two
      // or three taps rather than a tap and „Ändern" per winner. „Fertig"
      // below is what closes it. Keyed by position: `parties` is rebuilt
      // from the same session on every render, so index i is the same party.
      chip.addEventListener('click', () => {
        rs.pickerRefocus = pi;
        resultSaveWinners(rs, sel
          ? rs.winnerIds.filter((x) => !ids.includes(x))
          : [...rs.winnerIds, ...ids.filter((id) => !rs.winnerIds.includes(id))]);
      });
      chips.appendChild(chip);
      if (wantedChip === pi) restoreChip = chip;
    });
    main.appendChild(chips);

    /* The second row: how it ended when nobody won (#1038). Same chip
       component as the parties above, because it answers the same question —
       the two rows are mutually exclusive by construction, so selecting one
       deselects the other with no extra state to keep in step: the server
       clears whichever the request did not carry, and this re-renders from
       what it returned. */
    const endChips = h('<div class="winner-chips"></div>');
    ENDINGS.forEach((id) => {
      const meta = ENDING_LABELS[id];
      const sel = rs.ending === id;
      const chip = h(`<button class="winner-chip ${sel ? 'is-selected' : ''}" aria-pressed="${sel}">${iconText(meta.icon, t(meta.key))}</button>`);
      // Tapping the selected one again returns to "nothing recorded", which is
      // the same toggle the party chips give and the only way back without Reset.
      chip.addEventListener('click', () => { rs.pickerOpen = false; resultSaveWinners(rs, [], sel ? null : id); });
      endChips.appendChild(chip);
    });
    main.appendChild(endChips);

    const done = h(`<button class="btn btn--ghost">${esc(t('result.done'))}</button>`);
    done.addEventListener('click', () => { rs.pickerOpen = false; resultRenderBand(rs); });
    actions.appendChild(done);
  } else {
    /* The record, as a picture. One seat per winner — a team win is already a
       flat list of its people, so nothing here knows teams exist — and an
       ENDING renders its own line instead, because the two are exclusive. */
    const winners = rs.winnerIds.map((wid) => people.find((pp) => pp.id === wid)).filter(Boolean);
    if (winners.length) {
      const seats = h('<div class="tisch__seats"></div>');
      winners.forEach((pp) => {
        seats.appendChild(h(`<span class="seat">
             <span class="avatar${pp.guest ? ' avatar--guest' : ''}"${pp.guest ? '' : ` style="background:${memberColor(round, pp.id)}"`}>${avatarFace(initials(pp.name), { userId: pp.userId })}</span>
             <span class="seat__name">${esc(personLabel(pp))}</span>
           </span>`));
      });
      seats.appendChild(h(`<span class="tisch__won">${esc(tn(winners.length, 'result.wonSeatsOne', 'result.wonSeats'))}</span>`));
      main.appendChild(seats);
    } else {
      const meta = ENDING_LABELS[rs.ending];
      main.appendChild(h(`<div class="tisch__outcome">${meta
        ? iconText(meta.icon, t(meta.line))
        : iconText('ti-check', t('result.playedNoWinner'))}</div>`));
    }
    /* „Falls etwas anders lief" (T4.4): the three controls that CORRECT a
       settled record — change the winner, say another game was played, reset
       — are a labelled group rather than three loose buttons. Only in this
       state: while the evening is still running the same element holds „Als
       gespielt markieren", which is not a correction, and while the winner
       picker is open it holds „Fertig".

       Rendered on every design and hidden by styles.css, the same "render it,
       let CSS decide" shape the pool and the dock use. The alternative — a
       `::before` carrying the words — cannot be translated into the shipped
       locales at all. */
    actions.appendChild(h(`<span class="tisch__actions-label">${esc(t('result.corrections'))}</span>`));
    const change = h(`<button class="btn btn--ghost btn--sm">${esc(t('result.change'))}</button>`);
    change.addEventListener('click', () => { rs.pickerOpen = true; resultRenderBand(rs); });
    actions.appendChild(change);
  }

  if (rs.finished) {
    const resetBtn = h(`<button class="link-btn">${esc(t('result.reset'))}</button>`);
    resetBtn.addEventListener('click', async () => {
      try {
        await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/finish`, {
          finished: false,
          winnerIds: [],
        });
        rs.finished = false;
        rs.winnerIds = [];
        rs.ending = null;
        rs.pickerOpen = false;
        session.finished = false;
        session.winnerIds = [];
        delete session.ending;
        session.finishedAt = null; // the server clears it too; keep the copy honest
        toast(t('result.toast.reset'));
        resultUpdateChosen(rs);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
    actions.appendChild(resetBtn);

    /* „An BG Stats übergeben" (#485): the whole play as one tappable link.

       Rendered only for an account that opted in (Konto → BG Stats), because a
       website cannot detect whether the app is installed and the vendor's own
       guidance is to let the user enable the button rather than dead-end
       everyone else. Built here rather than at click time because resultRenderBand()
       re-runs after every winner toggle, so the href is never stale — and a
       real anchor is long-pressable and copyable, which a JS click is not.

       `noreferrer` as well as `noopener`: the referrer would otherwise carry
       this round's and session's ids to a third party that has no use for them
       (.claude/rules/secrets-in-paths-reach-the-logs.md, same reasoning one hop
       further out). */
    const pushUrl = bgStatsEnabled()
      ? bgStatsPlayUrl({ session, game, people, parties, winnerIds: rs.winnerIds, scores: session.scores })
      : null;
    if (pushUrl) {
      actions.appendChild(h(`<a class="link-btn" target="_blank" rel="noopener noreferrer" href="${esc(pushUrl)}">${iconText('ti-external-link', t('result.bgStats'))}</a>`));
    }
    main.appendChild(actions);
  }

  tisch.appendChild(box);
  tisch.appendChild(main);
  // After both are attached: focus() on a detached node does nothing.
  if (restoreChip) restoreChip.focus();
}

// Marks the session finished with the given winners (possibly none) and
// re-renders; only committed to local state once the server accepted it.
async function resultSaveWinners(rs, ids, nextEnding) {
  const { round, session } = rs;
  try {
    const saved = await api('POST', `/api/rounds/${round.id}/sessions/${session.id}/finish`, {
      finished: true,
      winnerIds: ids,
      // Omitted rather than sent as null when there is none: the route CLEARS
      // a stored ending on every finish that does not carry one, so a winner
      // tap needs no second field to replace it (#1038).
      ...(nextEnding ? { ending: nextEnding } : {}),
    });
    if (!rs.finished) rs.freshStamp = true;
    rs.finished = true;
    rs.winnerIds = saved.winnerIds.slice(); // filtered server-side
    // Read back from the server, never from the argument: it is the side that
    // decides the exclusivity, so this is what keeps the two chip rows honest.
    rs.ending = saved.ending || null;
    session.finished = true;
    session.winnerIds = rs.winnerIds.slice();
    if (rs.ending) session.ending = rs.ending; else delete session.ending;
    // The server stamps this, and the BG Stats push (#485) sends it as the
    // play's date — without the sync it would fall back to createdAt, i.e.
    // report the evening as having happened when the draw started, until the
    // next reload.
    session.finishedAt = saved.finishedAt || session.finishedAt;
    toast(t('result.toast.saved'));
    resultRenderBand(rs);
  } catch (e) {
    // Nothing was re-rendered, so the tapped chip still holds focus; a
    // leftover intent would otherwise fire on some later, unrelated render.
    rs.pickerRefocus = null;
    toast(e.message, { tone: 'error' });
  }
}
