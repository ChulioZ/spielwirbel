/* Spielwirbel – voting by shared link (#652). Part of the frontend; all files
   share one global script scope (load order: see index.html).

   The one screen in the app that runs for a visitor with NO account. Someone gets
   `/vote/<token>` in the group chat, opens it, taps their own name and rates the
   drawn games from their own phone. That is the account-free half of per-device
   voting (#209/#612): the in-app lobby needs every voter to have registered and
   claimed a seat, which real groups largely will not do.

   ## It reuses the wizard's CARD, not the wizard

   The rating markup below is deliberately the same `.vote` / `.rating` / `.mood`
   structure `startVoting` builds, so the two surfaces look identical and share
   every stylesheet rule. It does NOT call `startVoting`, and that is a decision
   rather than an oversight: that function is built around a `round` and a
   `session` object, a multi-person hot-seat handover, a registered history flow
   and a leave guard — none of which exist here, and all of which would have to be
   faked from a payload that deliberately carries neither round nor session.

   ## No history entries per step

   The wizard pushes one per step (#329) because it has several entry points and a
   platform Back must not discard votes. This screen has exactly one entry point —
   the link — and stays at that URL throughout, so Back leaves the page, which is
   the honest behaviour for a page someone opened from a chat. Navigation between
   the claim list and the cards is by explicit in-page buttons instead. That also
   keeps it clear of `beginFlow`/`confirmLeave`, which the SPA's own flows own.

   ## And no back control

   `.claude/rules/persistent-chrome-defines-the-main-pages.md` gives every
   non-main screen one `backRow`. This screen is the exception the rule's own
   reasoning produces: its visitor has no app to go back TO — there is no round,
   no home, and usually no account — so the control would either leave the app or
   land on a landing page they did not ask for. The in-flow "Zurück" returns to
   the claim list, which is the only meaningful "up" that exists here. */

'use strict';

// Which name this device claimed, per token. Kept so someone can reopen the link
// and revise their ratings until voting closes, rather than being asked who they
// are again — and so a second tap on the link does not read as a fresh voter.
//
// Per token, never global: one device may legitimately hold links to two
// different sessions (two rounds, the same evening). Wrapped because Safari's
// private mode throws on access rather than returning null.
const VOTE_LINK_CLAIM_KEY = 'spielwirbel.voteClaim.';

function voteLinkClaim(token) {
  try { return localStorage.getItem(VOTE_LINK_CLAIM_KEY + token); } catch { return null; }
}

function setVoteLinkClaim(token, personId) {
  try {
    if (personId) localStorage.setItem(VOTE_LINK_CLAIM_KEY + token, personId);
    else localStorage.removeItem(VOTE_LINK_CLAIM_KEY + token);
  } catch { /* storage unavailable: the claim simply is not remembered */ }
}

// The avatar tone. A guest is not a round member, so they have no palette
// position and the server sends `color: null` — they get the same neutral ink
// `personColor()` gives them in the app (#458), which also reads as "not one of
// us" and reinforces the (Gast) label.
const voteLinkColor = (person) => person.color || 'var(--ink-soft)';

// Naming is `personLabel()` from session-people.js — the app's one resolver, so a
// guest keeps the same „(Gast)" marker here as on every other screen. The ballot's
// people already arrive in its `{ name, guest }` shape, which is why this screen
// needs no resolver of its own.

/* The screen. `token` is the path segment; everything else comes from the ballot.

   Deliberately self-contained: it never touches `fetchRound`, the SWR cache, the
   account helpers or `currentView`'s round context, because none of those mean
   anything without a session. */
async function showVoteLink(token) {
  currentView = () => showVoteLink(token);
  syncUrl(votePath(token));
  // No round name in the tab title — the tab is visible to anyone glancing at the
  // phone, and the round name is the group's own. The app's default pitch title
  // is what a public page should carry anyway.
  applyTabTitle();
  setContext('');

  app.innerHTML = '';
  app.appendChild(h(`<div class="page-head"><p class="muted">${esc(t('voteLink.loading'))}</p></div>`));

  let ballot;
  try {
    ballot = await api('GET', `/api/vote/${encodeURIComponent(token)}`);
  } catch {
    // Every refusal is the same 404 by design (lib/routes/vote-link.js), so there
    // is exactly one message to show — and it must not guess at a cause. "Expired"
    // would be wrong for a mistyped link and "wrong link" wrong for a closed
    // session, and the server deliberately does not say which it was.
    return renderVoteLinkDead();
  }

  renderVoteLinkClaim(token, ballot);
}

// The link is unusable. One honest screen, no diagnosis.
function renderVoteLinkDead() {
  app.innerHTML = '';
  app.appendChild(h(`<div class="page-head">
      <h1>${esc(t('voteLink.deadTitle'))}</h1>
      <p class="muted">${esc(t('voteLink.deadBody'))}</p>
    </div>`));
}

/* Step 1: who are you?

   The claim model is what keeps the participant list fixed. The draw already
   filtered the game pool by the number of players, so letting a link holder ADD
   themselves would silently invalidate that filter — everyone picks from names the
   organizer set, or from nobody. */
function renderVoteLinkClaim(token, ballot) {
  const remembered = voteLinkClaim(token);
  const done = ballot.people.filter((p) => p.hasVoted).length;

  app.innerHTML = '';
  const root = h(`<div class="live-vote">
      <div class="page-head">
        <h1>${esc(t('voteLink.title'))}</h1>
        <p class="muted">${esc(t('voteLink.sub', { round: ballot.roundName }))}</p>
      </div>
      <p class="muted center">${esc(tn(done, 'voteLink.progressOne', 'voteLink.progress', { n: done, total: ballot.people.length }))}</p>
      <div class="live-vote__hotseat" id="vlClaim">
        <div class="field__label">${esc(t('voteLink.pick'))}</div>
      </div>
    </div>`);

  const list = root.querySelector('#vlClaim');
  ballot.people.forEach((person) => {
    const btn = h(`<button class="btn live-vote__hotseat-btn">
        <span class="live-person__avatar live-person__avatar--sm" style="background:${voteLinkColor(person)}">${avatarFace(initials(person.name), { userId: person.userId })}</span>
        ${esc(personLabel(person))}
        ${person.hasVoted ? `<span class="live-person__state"><i class="ti ti-check" aria-hidden="true"></i> ${esc(t('lobby.voted'))}</span>` : ''}
      </button>`);
    btn.addEventListener('click', () => {
      // Overwriting somebody's column is allowed — the server takes the same
      // authority the in-app per-device write has — but it is asked about first,
      // because on this screen the likeliest reason to tap a voted name is a
      // mis-tap, and the person whose ratings would be replaced is not holding
      // this phone. Your OWN remembered claim is not re-confirmed: revising your
      // own ratings until voting closes is the point.
      if (person.hasVoted && person.id !== remembered
        && !confirm(t('voteLink.overwriteConfirm', { name: personLabel(person) }))) return;
      setVoteLinkClaim(token, person.id);
      renderVoteLinkCards(token, ballot, person);
    });
    list.appendChild(btn);
  });

  app.appendChild(root);
}

/* Step 2: the cards.

   One card per drawn game, the wizard's own layout minus the parts that only make
   sense with several people on one device (the progress bar over N voters, the
   handover screen between them). */
function renderVoteLinkCards(token, ballot, person) {
  const games = ballot.games;
  const votes = {};
  let idx = 0;

  function render() {
    const game = games[idx];
    const current = votes[game.id] || { rating: null };
    const color = voteLinkColor(person);
    const imgStyle = game.image ? `style="background-image:url('${coverUrl(game.image, COVER_HERO)}')"` : '';

    app.innerHTML = '';
    const card = h(`<div class="vote vote--split">
        <div class="vote__who">${esc(t('voteLink.youAre'))} <strong style="color:${color}">${esc(personLabel(person))}</strong></div>
        <div class="vote__img" ${imgStyle}>${coverPlaceholder(game)}</div>
        <h1 class="vote__title">${esc(game.title)}</h1>
        <div class="vote__q" id="voteQ">${esc(t('vote.question'))}</div>
        <div class="rating" role="group" aria-labelledby="voteQ"></div>
        <div class="rating-scale"><span>${esc(t('vote.scaleLow'))}</span><span>${esc(t('vote.scaleHigh'))}</span></div>
        <div class="vote__nav">
          <button class="btn" id="backBtn"><i class="ti ti-chevron-left" aria-hidden="true"></i> ${esc(t('vote.back'))}</button>
          <button class="btn btn--primary" id="nextBtn">${idx === games.length - 1 ? esc(t('vote.finish')) + ' <i class="ti ti-chevron-right" aria-hidden="true"></i>' : esc(t('vote.next'))}</button>
        </div>
      </div>`);

    // Same info affordance as the wizard's card (#717) — the ballot projection
    // carries weight and #724's metadata, so a link voter gets the same facts. It deliberately carries NO `rating`, so there is nothing to
    // render here even if a future edit passed `{ rating: true }`; the omission
    // is enforced server-side in lib/routes/vote-link.js.
    //
    // Note this surface never calls wantsGameInfo(): the provider-info route is
    // auth-gated and a link voter has no account, so the ballot is the only
    // source. That is why widening the field set costs nothing here.
    const infoBtn = gameInfoButton(game);
    if (infoBtn) card.querySelector('.vote__title').append(' ', infoBtn);

    // Identical to the wizard's scale, down to the aria-pressed state and the
    // traffic-light fill on the selected face (#145). The only thing missing
    // here is focus restoration: this card re-renders on the same tap the
    // wizard's does, but it has no `refocus` machinery (#667) because it never
    // had one.
    const ratingEl = card.querySelector('.rating');
    for (let n = RATING_MIN; n <= RATING_MAX; n++) {
      const sel = current.rating === n;
      const b = h(`<button class="mood${sel ? ' is-selected' : ''}"
           aria-pressed="${sel}" aria-label="${esc(t('vote.ratingLabel', { n, max: RATING_MAX }))}">
           <i class="ti ${ratingFace(n)}" aria-hidden="true"></i><span class="mood__n">${n}</span>
         </button>`);
      if (sel) {
        b.style.background = avgColor(n);
        b.style.borderColor = avgColor(n);
      }
      b.addEventListener('click', () => {
        votes[game.id] = { rating: n };
        render();
      });
      ratingEl.appendChild(b);
    }

    // On the first card "Zurück" means "I picked the wrong name", which is the
    // one correction this screen has to offer — there is no earlier step to
    // return to and no chrome to leave through.
    card.querySelector('#backBtn').addEventListener('click', () => {
      if (idx === 0) return renderVoteLinkClaim(token, ballot);
      idx -= 1;
      render();
    });

    card.querySelector('#nextBtn').addEventListener('click', () => {
      // Same guard as the wizard: is the game anywhere on the scale?
      if (!Number.isFinite((votes[game.id] || {}).rating)) {
        return toast(t('vote.toast.needRating'));
      }
      if (idx === games.length - 1) return submit();
      idx += 1;
      render();
    });

    app.appendChild(card);
  }

  async function submit() {
    try {
      await api('POST', `/api/vote/${encodeURIComponent(token)}/votes/${encodeURIComponent(person.id)}`, { votes });
    } catch {
      // The likeliest failure by far is that someone closed the voting while this
      // person was rating, which the server answers as an unusable link. Showing
      // the dead-link screen is the honest outcome: their ratings did not land and
      // there is nothing they can do about it from here.
      return renderVoteLinkDead();
    }
    // Re-read rather than patching the local copy: other people have been voting
    // on their own devices, so the count on the confirmation should be the
    // server's. A failure here is not worth stranding them — they voted.
    let fresh = ballot;
    try { fresh = await api('GET', `/api/vote/${encodeURIComponent(token)}`); } catch { /* keep the stale count */ }
    renderVoteLinkDone(token, fresh, person);
  }

  render();
}

/* Step 3: done.

   Deliberately NOT the results. The reveal belongs to the group at the table, and
   handing it to a link holder would let anyone with the URL watch the evening's
   outcome from elsewhere. A count of who has voted is all this screen may say —
   it is the same thing the lobby shows, and it says nothing about any rating. */
function renderVoteLinkDone(token, ballot, person) {
  const done = ballot.people.filter((p) => p.hasVoted).length;
  const total = ballot.people.length;

  app.innerHTML = '';
  const root = h(`<div class="live-vote">
      <div class="page-head">
        <h1>${esc(t('voteLink.doneTitle'))}</h1>
        <p class="muted">${esc(t('voteLink.doneSub', { name: personLabel(person) }))}</p>
      </div>
      <p class="muted center">${esc(tn(done, 'voteLink.doneProgressOne', 'voteLink.doneProgress', { total }))}</p>
      <div class="live-vote__actions">
        <button class="btn" id="vlAgain"><i class="ti ti-refresh" aria-hidden="true"></i> ${esc(t('voteLink.revise'))}</button>
      </div>
    </div>`);

  // Revising re-runs the whole screen rather than reopening the cards from here:
  // the voting may have closed in the meantime, and `showVoteLink` is the one
  // place that re-asks the server whether the link still works.
  root.querySelector('#vlAgain').addEventListener('click', () => showVoteLink(token));
  app.appendChild(root);
}
