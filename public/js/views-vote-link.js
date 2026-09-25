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

/* Whether this device has already been told what the app is (#1169).

   Device-wide, NOT per token — unlike the claim above. The note answers "what
   was this?", which is a question a person has exactly once however many links
   they are sent; keying it per token would show it again at every friend's
   table, which is the nagging this feature is deliberately not.

   Stored rather than derived because there is nothing to derive it from: this
   visitor has no account and no server-side row, so the device is the only
   place the fact can live. Listed in the § 25 TDDDG storage inventory in
   `lib/legal.js` (both languages), like INSTALL_DISMISSED_KEY. */
const VOTE_LINK_NOTE_KEY = 'spielwirbel.voteLinkNote';

function voteLinkNoteShown() {
  try { return localStorage.getItem(VOTE_LINK_NOTE_KEY) === '1'; } catch { return false; }
}

function markVoteLinkNoteShown() {
  // Storage unavailable (Safari private mode throws on access) means the note
  // may appear once more on a later link. That is the right way round to fail:
  // the alternative is suppressing it for someone who has never seen it.
  try { localStorage.setItem(VOTE_LINK_NOTE_KEY, '1'); } catch { /* shown again next time */ }
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

  /* The FACE design, never the viewer's (#1192, T12.5).
   *
   * This is the app's one public, account-free surface, so it has to wear the
   * app's public face — and until this line it wore whatever the *browser* was
   * carrying. `bootApp()` calls `applyAccountDesign()` before routing, so a link
   * opened by someone who happens to have an account rendered the invitation in
   * that person's own private design; measured on a seeded account wearing Der
   * Tisch while the instance's face was Klassisch. Nothing looked broken, which
   * is why it needed measuring rather than reading: a design applied is a design
   * that renders correctly.
   *
   * FACE_DESIGN rather than a read of `/api/config`: `lib/app.js` builds
   * `cfg.faceDesign` FROM this very constant (the nineteenth entry in
   * .claude/rules/shared-constants-inventory.md), so the two cannot disagree —
   * and the constant is synchronous, where the config round-trip would paint the
   * wrong design first and correct it a moment later, on the one screen with no
   * second chance to make an impression.
   *
   * It runs on every render because `currentView` re-enters here on a language
   * change, which is also the only way back onto this screen without a reload.
   * `rendering`: this IS the render, so the design change must not re-enter it. */
  applyDesign(FACE_DESIGN, { rendering: true });

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
  // Der Tisch opens the link on its felt intro (T12.5, #1268) — the wordmark,
  // whose round this is, and what the link can see — in the page head's place.
  if (designIs('tisch')) root.querySelector('.page-head').replaceWith(tischVoteLinkIntro(ballot));

  // Initials, never `avatarFace()`. The ballot carries no `userId` by design
  // (#1169 settled it as a boolean `linked` instead), and AVATAR_CACHE is filled
  // only by the auth-gated avatar route this page cannot call — so the lookup
  // could resolve nothing anyway. This used to pass `{ userId: person.userId }`
  // on a field that was always undefined, which read as if a linked member's
  // picture rendered here.
  const list = root.querySelector('#vlClaim');
  ballot.people.forEach((person) => {
    const btn = h(`<button class="btn live-vote__hotseat-btn">
        <span class="live-person__avatar live-person__avatar--sm" style="background:${voteLinkColor(person)}">${esc(initials(person.name))}</span>
        ${esc(personLabel(person))}
        ${person.hasVoted ? `<span class="live-person__state"><i class="ti ti-check" aria-hidden="true"></i> ${esc(t('lobby.voted'))}</span>` : ''}
      </button>`);
    btn.addEventListener('click', async () => {
      // Overwriting somebody's column is allowed — the server takes the same
      // authority the in-app per-device write has — but it is asked about first,
      // because on this screen the likeliest reason to tap a voted name is a
      // mis-tap, and the person whose ratings would be replaced is not holding
      // this phone. Your OWN remembered claim is not re-confirmed: revising your
      // own ratings until voting closes is the point.
      if (person.hasVoted && person.id !== remembered
        && !await confirmDialog({
          body: t('voteLink.overwriteConfirm', { name: personLabel(person) }),
          confirmLabel: t('common.overwrite'),
        })) return;
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
  // The same beat as the wizard's card, from the same file (#1168): a rating
  // tap advances after a short lock, so this surface costs one tap per game
  // too. Per run, not per card — the lock is what a card's handlers ask.
  const advance = createVoteAdvance();
  // One submission per run, for the same reason as the wizard's `finishing`:
  // the last rating tap now reaches submit() on its own, so a stray tap just
  // after the beat releases could POST a second time mid-await.
  let submitting = false;
  // Only a card a beat delivered takes focus; arriving through „Zurück" must
  // leave it where the user put it.
  let focusTitle = false;

  function klassischCard(game) {
    const imgStyle = game.image ? `style="background-image:url('${coverUrl(game.image, COVER_HERO)}')"` : '';
    return h(`<div class="vote vote--split">
        <div class="vote__who"><button class="vote__undo" id="backBtn" type="button" aria-label="${esc(t('vote.back'))}" title="${esc(t('vote.back'))}"><i class="ti ti-arrow-back-up" aria-hidden="true"></i></button>${esc(t('voteLink.youAre'))} <strong style="color:${personNameInk(voteLinkColor(person))}">${esc(personLabel(person))}</strong></div>
        <div class="vote__img" ${imgStyle}>${coverPlaceholder(game)}</div>
        <h1 class="vote__title" tabindex="-1">${esc(game.title)}</h1>
        <div class="vote__q" id="voteQ">${esc(t('vote.question'))}</div>
        <div class="rating" role="group" aria-labelledby="voteQ"></div>
        <div class="rating-scale"><span>${esc(t('vote.scaleLow'))}</span><span>${esc(t('vote.scaleHigh'))}</span></div>
      </div>`);
  }

  /* Der Tisch's card (#1268), the hot-seat composition minus the parts that
     only mean something on a shared device: no person count (the ballot's
     people are not a queue), no secrecy pill and no hand-off line — this is
     the voter's own phone. The owner is left out of the meta line because the
     ballot deliberately carries no members to resolve it against. */
  function tischCard(game) {
    return tischVoteCard({
      person,
      count: t('vote.gameOf', { n: idx + 1, total: games.length }),
      roundName: ballot.roundName,
      gameN: idx + 1,
      gameTotal: games.length,
      secret: false,
      game,
      meta: voteMetaLine(game, null),
      handoff: '',
    });
  }

  function render() {
    const game = games[idx];
    const current = votes[game.id] || { rating: null };
    app.innerHTML = '';
    const card = designIs('tisch') ? tischCard(game) : klassischCard(game);
    // The same tip as the wizard's card (#1200, T10.3) — `focusTitle` is this
    // surface's "the beat delivered this card", so the two cannot disagree.
    if (designIs('tisch') && focusTitle) card.classList.add('is-tipped');

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
      const b = voteMoodButton(n, current.rating === n);
      b.addEventListener('click', () => {
        // The JS half of the double-tap guard — identical to the wizard's, and
        // the reason both cards take their beat from one file (#1168).
        if (advance.locked) return;
        votes[game.id] = { rating: n };
        // Re-render first so the beat is spent showing the choice at its
        // traffic-light fill; that frame is the acknowledgement.
        render();
        advance.schedule(app.querySelector('.vote'), () => {
          // Nothing can move `idx` while a beat runs — this page has no history
          // of its own, and „Zurück" is locked for the duration — so there is no
          // second guard here either. See the wizard's note on why a redundant
          // one is actively harmful.
          if (idx === games.length - 1) return submit();
          idx += 1;
          focusTitle = true;
          render();
          announce(t('vote.advanced', { n: idx + 1, total: games.length, title: games[idx].title }));
        });
      });
      ratingEl.appendChild(b);
    }

    // On the first card "Zurück" means "I picked the wrong name", which is the
    // one correction this screen has to offer — there is no earlier step to
    // return to and no chrome to leave through.
    card.querySelector('#backBtn').addEventListener('click', () => {
      if (advance.locked) return;
      if (idx === 0) return renderVoteLinkClaim(token, ballot);
      idx -= 1;
      render();
    });

    app.appendChild(card);

    // After the append, never before: focus() on a detached node is a no-op.
    if (focusTitle) {
      focusTitle = false;
      card.querySelector('.vote__title').focus();
    }
  }

  async function submit() {
    if (submitting) return;
    submitting = true;
    try {
      await api('POST', `/api/vote/${encodeURIComponent(token)}/votes/${encodeURIComponent(person.id)}`, { votes });
    } catch {
      // The likeliest failure by far is that someone closed the voting while this
      // person was rating, which the server answers as an unusable link. Showing
      // the dead-link screen is the honest outcome: their ratings did not land and
      // there is nothing they can do about it from here.
      return renderVoteLinkDead();
    }
    // Past the POST there is no retry to protect: the ratings are on the
    // server, and every path from here lands on a screen with no vote card.
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

  appendVoteLinkAppNote(root, ballot, person);
  app.appendChild(root);
}

/* The one sentence naming the app, once per device (#1169).

   THIS IS THE ONLY SURFACE IT MAY APPEAR ON. A played evening puts the link on
   four to six phones belonging to people who never chose Spielwirbel, and this
   is the app's single point of contact with them — but it is also somebody
   else's session on somebody else's evening, so it is a sentence and not a card,
   not an install offer and not a button. A family voting together on one shared
   screen must never see it, which is what the `linked` gate below is for.

   Four conditions have to hold and each is a separate way of getting this wrong.
   Three are guards below; the fourth is the CALL SITE — this runs only from
   `renderVoteLinkDone`, i.e. only after this device has submitted its ratings.
   The `linked` gate is the load-bearing one. */
function appendVoteLinkAppNote(root, ballot, person) {
  // 1. The claimed seat is not an account's. Someone who already has the app is
  //    not the audience, and telling them what Spielwirbel is reads as spam.
  if (person.linked) return;
  // 2. Not on a demo tenant. A demo evaporates, so pitching off the back of one
  //    invites somebody to start from data that is about to be deleted.
  if (ballot.demo) return;
  // 3. Once per device, ever.
  if (voteLinkNoteShown()) return;
  markVoteLinkNoteShown();

  // A plain <a>, deliberately NOT navLink(): a full navigation is what this
  // wants. The visitor has no round, no account and no SPA state worth keeping,
  // and landing on `/` cold gives them the public landing page rather than a
  // route resolved out of a vote-link session. No tracking parameter on it.
  root.appendChild(h(`<p class="muted center vote-link__note">
      ${esc(t('voteLink.appNote'))}
      <a href="/">${esc(t('voteLink.appNoteCta'))}</a>
    </p>`));
}
