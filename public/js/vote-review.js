/* Spielwirbel – the review step after a voter's last card (#1434). Part of the
   frontend; all files share one global script scope (load order: see
   index.html).

   #1168 made the rating tap the advance, which removed the „Weiter" between the
   last rating and the submission — so the one moment someone might want a final
   adjustment, with every candidate now seen, had no pause at all. The last
   card's beat now delivers this step instead: every game with its rating, each
   row a real button back to its card, and one „Absenden". One tap per voter,
   not one per game; every other card still advances on the rating tap.

   One builder, both surfaces, every design. The hot-seat wizard (views-session.js,
   which the own-device lobby reuses) and the shared-link card (views-vote-link.js)
   already promise each other identical markup, so the review lives here once.
   The designs do not get a builder each: the caller says whether its card is
   COMPOSED (Der Tisch, Ocean, Die Brücke — vote-card-composed.js), and the
   review then wears that card's own frame — the header on the felt and the
   `.vote__card` panel — so each design's existing rules skin it and its
   stylesheet only has to lay out the list. Klassisch (and every design that
   still draws Klassisch's card) gets the `.vote` card with its person line.

   The builder owns no state and no guard. The caller's callbacks do, because
   the two surfaces submit and navigate differently — and because the #1168 tap
   lock must be asked by the SAME closure that owns the beat: a double-tap on
   the last face lands here while that lock is still held.

   No module.exports: it builds DOM, and a required file would enter the coverage
   report mostly unreachable (.claude/rules/frontend-helper-modules-and-coverage.md).
   The specs reach it through the jsdom harness (test/vote-review.test.js). */

'use strict';

/* One row: cover, title, the chosen face with its word — the same two things
   the face on the card carries, and never its digit (#1530, see
   vote-card-composed.js `voteMoodButton`). The accessible name leads with the
   game — the row's visible text — then the word, then what pressing it does. */
function voteReviewRow(game, rating) {
  const cover = game.image ? `style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
  const rated = Number.isInteger(rating);
  const spoken = rated ? voteSaidWord(rating) : t('vote.reviewUnrated');
  const b = h(`<button class="vote-review__row" type="button" aria-label="${esc(t('vote.reviewRow', { title: game.title, rating: spoken }))}">
      <span class="vote-review__cover" ${cover} aria-hidden="true">${game.image ? '' : coverPlaceholder(game)}</span>
      <span class="vote-review__game">${esc(game.title)}</span>
      <span class="vote-review__rating${rated ? '' : ' is-empty'}"${rated ? ` data-n="${rating}"` : ''} aria-hidden="true">${rated
    ? `<i class="ti ${ratingFace(rating)}"></i><span class="vote-review__word">${esc(spoken)}</span>`
    : '<span class="vote-review__word">–</span>'}</span>
      <i class="ti ti-pencil vote-review__go" aria-hidden="true"></i>
    </button>`);
  // The same traffic-light variable the selected face carries, so the chip in
  // the list is the colour the voter just saw on the card.
  if (rated) b.querySelector('.vote-review__rating').style.setProperty('--sc', avgColor(rating));
  return b;
}

/* The step. Returns the root; the caller appends it and moves focus.

   - `composed`   whether the caller's card is the composed one (see header)
   - `who`        Klassisch's person line: `{ label, color }` („Es bewertet: Anna")
   - `roundName`  printed on the felt after the count, where the card prints it
   - `handoff`    the composed card's hand-off line, or '' for none
   - `ratingOf`   game → its rating, or null
   - `onJump(i)`, `onSend()`, `onBack()`  the caller's handlers

   The `.vote` class stays on the root so every rule that places a vote screen
   (`.app:has(> .vote…)`, the full-screen chrome) treats it as one; `.vote--split`
   deliberately does NOT — that is the card's cover/content grid, and a review
   has no cover column. */
function voteReviewCard({ composed, person, who, roundName, handoff, games, ratingOf, onJump, onSend, onBack }) {
  const all = games.length;
  const done = games.filter((g) => Number.isInteger(ratingOf(g))).length;
  const count = done === all
    ? tn(all, 'vote.reviewCountOne', 'vote.reviewCount')
    : t('vote.gameOf', { n: done, total: all });
  const back = `<button class="vote__undo" id="backBtn" type="button" aria-label="${esc(t('vote.back'))}" title="${esc(t('vote.back'))}"><i class="ti ${composed ? 'ti-chevron-left' : 'ti-arrow-back-up'}" aria-hidden="true"></i></button>`;
  const body = `<h1 class="vote-review__title" tabindex="-1">${esc(t('vote.reviewTitle'))}</h1>
        <p class="vote-review__hint">${esc(t('vote.reviewHint'))}</p>
        <ol class="vote-review__list"></ol>
        <button class="btn btn--primary btn--lg vote-review__send" id="sendBtn" type="button"><i class="ti ti-check" aria-hidden="true"></i> ${esc(t('vote.reviewSend'))}</button>`;

  const root = composed
    ? h(`<div class="vote vote--composed vote-review">
        <div class="vote-felt">
          ${back}
          <div class="vote-felt__who">
            <p class="vote-felt__name">${esc(t('vote.rates', { name: personLabel(person) }))}</p>
            <p class="vote-felt__count">${esc(count)}${roundName ? `<span class="vote-felt__round"> · ${esc(roundName)}</span>` : ''}</p>
          </div>
        </div>
        <div class="vote__card">${body}</div>
        ${handoff ? `<p class="vote__handoff">${esc(handoff)}</p>` : ''}
      </div>`)
    : h(`<div class="vote vote-review">
        <div class="vote__who">${back}${esc(who.label)} <strong style="color:${personNameInk(who.color)}">${esc(personLabel(person))}</strong></div>
        <div class="vote-review__body">
          <p class="vote-review__count">${esc(count)}</p>
          ${body}
        </div>
      </div>`);
  // The design's own frame, the same classes its card carries (views-session.js).
  if (composed && oceanWorn()) root.classList.add('vote--ocean');
  if (composed && designIs('bruecke')) root.classList.add('vote--bruecke');

  const list = root.querySelector('.vote-review__list');
  games.forEach((game, i) => {
    const li = document.createElement('li');
    const row = voteReviewRow(game, ratingOf(game));
    row.addEventListener('click', () => onJump(i));
    li.appendChild(row);
    list.appendChild(li);
  });

  // Every game rated is the only state the flow can reach here — the rating tap
  // is the only way forward — but a row without one must not be sendable as if
  // it had one, so the button says so rather than trusting the path.
  const sendBtn = root.querySelector('.vote-review__send');
  sendBtn.disabled = done !== all;
  sendBtn.addEventListener('click', () => onSend());
  root.querySelector('#backBtn').addEventListener('click', () => onBack());
  return root;
}
