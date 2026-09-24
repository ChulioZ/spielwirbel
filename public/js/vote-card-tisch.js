/* Spielwirbel – the vote card as Der Tisch composes it (#1268: T2.4, T4.2 and
   T12.5 of docs/design/tisch/). Part of the frontend; all files share one
   global script scope (load order: see index.html).

   Two callers, one composition: the hot-seat card (`startVoting`,
   views-session.js) and the shared-link card (`renderVoteLinkCards`,
   views-vote-link.js). Those two files already promise each other identical
   markup (see views-vote-link.js's header), so the Tisch form of it lives here
   once rather than as a second pair of copies.

   What the design composes differently, and why it is markup and not paint:
   - A HEADER ON THE FELT, outside the paper card — who rates, „Spiel 2 von 3 ·
     Person 1 von 4", one dot per game, and the secrecy pill. Klassisch's
     `.vote__who` line and per-person progress bar are inside the card.
   - The card holds the cover BESIDE the title and a meta line (players ·
     playtime · owner), then the question and the faces.
   - Every face carries its WORD („gar nicht … unbedingt"), so the separate
     two-ended scale row goes.
   - A HAND-OFF LINE under the card on a shared device: who is next, or on the
     last person, that the result comes next.

   Klassisch never reaches a builder below except `voteMoodButton`, whose
   Klassisch branch is the markup both cards rendered before this file existed.
   No module.exports: everything here builds DOM, and a required file would
   enter the coverage report mostly unreachable
   (.claude/rules/frontend-helper-modules-and-coverage.md). The specs reach it
   through the jsdom harness (test/tisch-vote-card.test.js). */

'use strict';

// The word under each face, lowest rung first. The two ends are the keys the
// Klassisch scale row has always printed, so the words never disagree with it.
const VOTE_WORD_KEYS = ['vote.scaleLow', 'vote.scale2', 'vote.scale3', 'vote.scale4', 'vote.scaleHigh'];

const voteWord = (n) => t(VOTE_WORD_KEYS[n - RATING_MIN]);

/* One face on the 1–5 scale — the one builder both cards use, so the hot-seat
   and link surfaces cannot drift apart on the app's central control.

   Under Klassisch this is byte-for-byte the markup the two loops wrote inline
   before #1268. Under Der Tisch the word joins the tile, and joins its
   accessible NAME too: a reader hears „4 von 5 – gern", which is the part of
   the tile that means something. */
function voteMoodButton(n, selected) {
  const tisch = designIs('tisch');
  const label = tisch
    ? t('vote.ratingLabelWord', { n, max: RATING_MAX, word: voteWord(n) })
    : t('vote.ratingLabel', { n, max: RATING_MAX });
  const word = tisch ? `<span class="mood__word">${esc(voteWord(n))}</span>` : '';
  // aria-pressed carries the choice (#145): the selected face is otherwise
  // marked only by its fill, so nothing announced which rating was picked.
  // The odd indentation is deliberate: the whitespace text nodes it produces
  // are the ones the two inline loops produced, so Klassisch is byte-identical.
  const b = h(`<button class="mood${selected ? ' is-selected' : ''}"
           aria-pressed="${selected}" aria-label="${esc(label)}">
           <i class="ti ${ratingFace(n)}" aria-hidden="true"></i>${word}<span class="mood__n">${n}</span>
         </button>`);
  if (selected) {
    /* --sc, not an inline `background`: an inline background is precisely
       what a design CANNOT override, and Der Tisch paints the chosen face
       as its brass plate rather than in the ramp's colour (#1191, T2.4).
       The continuous colour stays the default in CSS, so nothing moves
       under Klassisch. */
    b.style.setProperty('--sc', avgColor(n));
  }
  return b;
}

/* Where this person stands in the evening, and who takes the device next.

   Since #655 the lobby hands the wizard ONE person, so neither answer is in
   `order` — both are read off the session the lobby is showing, with the
   lobby's own rules, so the line under the card names the person the lobby
   will then lead with (views-session-live.js, `nextUp`/`iLead`):
   - your own unused seat leads, when this device has one and it is not you;
   - otherwise the first person still open, in seat order.
   `next: null` means nobody else is open: this is the last card run, and the
   line says the result comes next instead.

   A multi-person `order` (the pre-#655 hot-seat run, still supported by
   startVoting's signature) answers from the order itself. */
function voteTurn(round, session, order, person) {
  if (order.length > 1) {
    const at = order.findIndex((p) => p.id === person.id);
    return { n: at + 1, total: order.length, next: order[at + 1] || null };
  }
  const all = sessionPeople(round, session);
  const voted = new Set(session.votedIds || []);
  const others = all.filter((p) => p.id !== person.id);
  const mine = mySeatIn(round, session);
  const open = others.filter((p) => !voted.has(p.id));
  const mineOpen = mine && open.find((p) => p.id === mine.id);
  return {
    n: others.filter((p) => voted.has(p.id)).length + 1,
    total: all.length,
    next: mineOpen || open[0] || null,
  };
}

/* The line under the card. On a SHARED device only: „pass the device on" is
   advice about a phone going round the table, and someone alone with their own
   (skipIntro) has nobody to hand it to — unless they are the last, when "the
   result comes next" is true wherever they sit. */
function voteHandoffLine(turn, sharedDevice) {
  if (!turn.next) return t('vote.handoffLast');
  return sharedDevice ? t('vote.handoffNext', { name: personLabel(turn.next) }) : '';
}

// „2–5 Personen · 45 Min. · Gehört Jonas", from whatever the game carries. The
// owner part needs the round's members, which the link ballot does not have —
// so the link card simply prints the first two.
function voteMetaLine(game, round) {
  const parts = [playersText(game.minPlayers, game.maxPlayers), playtimeText(game)];
  const owners = round ? ownerNames(round, game.ownerIds) : [];
  if (owners.length) parts.push(t('result.ownedBy', { names: joinNames(owners) }));
  return parts.filter(Boolean).join(' · ');
}

/* The card itself. Returns the `.vote` root with an empty `.rating` group for
   the caller to fill with voteMoodButton()s — the caller owns every handler,
   because the two cards advance, undo and submit differently.

   `.vote vote--split` stay on the root on purpose: `.app:has(> .vote--split)`
   centres the card on a wide screen (styles.css), and the beat's
   `.vote--advancing` lock is applied to whatever `app.querySelector('.vote')`
   returns. tisch.css turns the split grid off for `.vote--tisch`.

   DOM order is reading order at every width: header (back, who, count, dots,
   pill), then the card (cover, title, meta, question, faces), then the line. */
function tischVoteCard({ person, count, roundName, gameN, gameTotal, secret, game, meta, handoff }) {
  const dots = [];
  for (let i = 1; i <= gameTotal; i++) {
    const state = i < gameN ? ' is-done' : i === gameN ? ' is-current' : '';
    dots.push(`<span class="vote-felt__dot${state}"></span>`);
  }
  const imgStyle = game.image ? `style="background-image:url('${coverUrl(game.image, COVER_HERO)}')"` : '';
  return h(`<div class="vote vote--split vote--tisch">
      <div class="vote-felt">
        <button class="vote__undo" id="backBtn" type="button" aria-label="${esc(t('vote.back'))}" title="${esc(t('vote.back'))}"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
        <div class="vote-felt__who">
          <p class="vote-felt__name">${esc(t('vote.rates', { name: personLabel(person) }))}</p>
          <p class="vote-felt__count">${esc(count)}${roundName ? `<span class="vote-felt__round"> · ${esc(roundName)}</span>` : ''}</p>
        </div>
        <span class="vote-felt__dots" aria-hidden="true">${dots.join('')}</span>
        ${secret ? `<div class="vote__secret"><i class="ti ti-eye-off" aria-hidden="true"></i> ${esc(t('vote.handoverSub'))}</div>` : ''}
      </div>
      <div class="vote__card">
        <div class="vote__img" ${imgStyle}>${coverPlaceholder(game)}</div>
        <h1 class="vote__title" tabindex="-1">${esc(game.title)}</h1>
        ${meta ? `<p class="vote__meta">${esc(meta)}</p>` : ''}
        <div class="vote__q" id="voteQ">${esc(t('vote.question'))}</div>
        <div class="rating" role="group" aria-labelledby="voteQ"></div>
      </div>
      ${handoff ? `<p class="vote__handoff">${esc(handoff)}</p>` : ''}
    </div>`);
}

/* T12.5's opening on the link: the wordmark on its brass plate, whose round
   this is, and what the link can and cannot see. It replaces the claim step's
   page head under Der Tisch; the h1 stays an h1.

   The promise is deliberately narrower than the sheet's („… und niemand sieht,
   wie du gewertet hast"): after the reveal a round DOES see who rated what (the
   Spielepass's „Wer wie gewertet hat"), so that sentence would be untrue. What
   is true is the lobby's own panel note — the link shows the drawn games and
   nothing else of the round. */
function tischVoteLinkIntro(ballot) {
  return h(`<header class="vote-link-intro">
      <span class="vote-link-intro__mark">${esc(t('app.title'))}</span>
      <h1 class="vote-link-intro__title">${esc(t('voteLink.introFor', { round: ballot.roundName }))}</h1>
      <p class="vote-link-intro__note">${esc(tn(ballot.games.length, 'voteLink.introNoteOne', 'voteLink.introNote', { n: ballot.games.length }))}</p>
    </header>`);
}
