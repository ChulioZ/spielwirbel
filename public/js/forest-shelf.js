/* Spielwirbel – Forest's Regal and Spielepass pieces (#1467: F3.3, F3.4, F6.2,
   F6.3, F7.8). Loaded after bruecke-shelf.js and before views-regal.js; shares
   one global script scope. Every function here runs at render time, so reaching
   views-regal.js's `cardMeta` from inside one is safe.

   Why a file of its own: views-regal.js and views-round-detail.js are near (or
   past) their budget, and these are the design's own presentations — the shelf
   card with its cover in a light hollow, the Spielepass's score card, its three
   figures and the BGG card. The view files ask `designIs('forest')` and hand
   over, as they do for Die Brücke (bruecke-shelf.js).

   No module.exports: this is DOM code, and the specs reach it through the jsdom
   harness (test/support/dom.js) — see
   .claude/rules/frontend-helper-modules-and-coverage.md for why a DOM file is
   never required into Node. */

'use strict';

/* F1.6's „Kein Bild": the hatch, a leaf and the two words, filling the hollow.
   It replaces coverPlaceholder()'s glyph under Forest only. aria-hidden, like
   the placeholder it stands in for: the card's link is named by the title, and
   „Kein Bild Catan" would be a worse name, not a better one. */
function forestNoCover() {
  return `<span class="cover-ph forest-nocover" aria-hidden="true"><span class="forest-leaf"></span><span class="forest-nocover__label">${esc(t('games.noCover'))}</span></span>`;
}

/* A Regal card (F3.3/F6.2/F7.8): the cover stands in a light hollow and NOTHING
   is printed on it (review rule T3) — the title and the score share the line
   under it, then the meta and who owns the box. The score is the shelf's own
   figure and evidence, the same pill every other design prints, on its ramp
   rung; „neu" when the game has none yet. The bulk-select tick stays on the
   frame, where the selection ring is drawn. The title wraps (two lines at F7.8's
   density), never an ellipsis. */
function forestShelfCard(round, g, score, evidence, expBadge) {
  const scored = score !== null;
  const pill = scored
    ? `<span class="score-pill" style="--sc:${scoreColor(score)}" data-stop="${scoreStop(score)}" title="${esc(evidence)}">${fmtAvg(displayScore(score))}</span>`
    : `<span class="score-pill score-pill--none">${esc(t('games.scoreNew'))}</span>`;
  const owners = ownerNames(round, g.ownerIds);
  return h(`<a class="game-card game-card--clickable forest-card${g.image ? '' : ' forest-card--bare'}">
       <div class="forest-card__well">
         <div class="game-card__img">${g.image ? '' : forestNoCover()}
           <span class="game-card__pick" aria-hidden="true"><i class="ti ti-check"></i></span>
         </div>
       </div>
       <div class="game-card__body">
         <div class="forest-card__head"><div class="game-card__title">${esc(g.title)}</div>${pill}</div>
         ${cardMeta(g) || expBadge ? `<div class="forest-card__meta">${cardMeta(g)}${expBadge}</div>` : ''}
         ${owners.length ? `<div class="forest-card__owner">${esc(t('detail.owners', { names: owners.join(', ') }))}</div>` : ''}
       </div>
     </a>`);
}

/* The Spielepass's score card (F3.4/F6.3): the pill on its rung, the score's
   name with the app's ⓘ — the explanation is the app's own info entry
   (score.infoBody), never F3.4's paraphrase (review U11) — and what the number
   rests on. A played-but-unrated game says so; an unscored one prints „neu". */
function forestPassScore(st) {
  const scored = st.score !== null;
  let evidence = '';
  if (st.count > 0) evidence = tn(st.count, 'score.evidenceOne', 'score.evidence');
  else if (st.plays > 0) evidence = tn(st.plays, 'score.evidencePlaysOne', 'score.evidencePlays');
  const pill = scored
    ? `<span class="score-pill score-pill--lg" style="--sc:${scoreColor(st.score)}" data-stop="${scoreStop(st.score)}">${fmtAvg(displayScore(st.score))}</span>`
    : `<span class="score-pill score-pill--lg score-pill--none">${esc(t('games.scoreNew'))}</span>`;
  const el = h(`<div class="forest-score">
      ${pill}
      <div class="forest-score__text">
        <span class="forest-score__name">${esc(t('score.name'))} ${infoButton('score')}</span>
        ${evidence ? `<span class="forest-score__ev">${esc(evidence)}</span>` : ''}
      </div>
    </div>`);
  wireInfoButtons(el);
  return el;
}

// A date short enough for a 160px tile: „14. Sep." this year, „Sep. 2025"
// before it. The full date is on the session the Chronik row links to.
function forestShortDate(iso) {
  const d = new Date(iso);
  const opts = d.getFullYear() === new Date().getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { month: 'short', year: 'numeric' };
  return d.toLocaleDateString(localeTag(locale), opts);
}

/* The three figures under the score (F3.4/F6.3): how often the round put it on
   the table, when it last did, and who has won it most. All three read the
   sessions the game's own score reads — `plays` is gameStats' play count, so the
   tile and the score's „× gespielt" cannot disagree — and need no new data.
   A tie for most wins names everyone tied; nobody yet is a dash. Winners are
   resolved through sessionPeople, so a guest who won is named as a guest
   (.claude/rules/session-guests-are-not-members.md). */
function forestPassFacts(round, gameId, st) {
  const played = round.sessions
    .filter((s) => !s.cancelled && s.chosenGameId === gameId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const wins = new Map();
  played.forEach((s) => {
    if (!s.finished) return;
    const people = sessionPeople(round, s);
    (s.winnerIds || []).forEach((wid) => {
      const p = people.find((x) => x.id === wid);
      if (!p) return;
      const prev = wins.get(wid) || { person: p, n: 0 };
      prev.n += 1;
      wins.set(wid, prev);
    });
  });
  const top = Math.max(0, ...[...wins.values()].map((w) => w.n));
  const leaders = [...wins.values()].filter((w) => top > 0 && w.n === top);
  const most = leaders.length ? `${leaders.map((w) => personLabel(w.person)).join(', ')} · ${top}` : '–';
  const tile = (value, label, cls) =>
    `<div class="forest-fact ${cls}"><span class="forest-fact__v">${esc(value)}</span><span class="forest-fact__k">${esc(label)}</span></div>`;
  return h(`<div class="forest-facts">
      ${tile(String(st.plays), t('detail.statPlaysBruecke'), 'forest-fact--plays')}
      ${tile(played.length ? forestShortDate(played[0].createdAt) : '–', t('round.lastPlayedLabel'), 'forest-fact--last')}
      ${tile(most, t('detail.factMostWins'), 'forest-fact--wins')}
    </div>`);
}

/* „Powered by BGG", linked back to BoardGameGeek and never shrunk below the
   footer's legible size — the licence condition
   (.claude/rules/add-game-lookup-provider.md). Self-hosted, so it contacts
   nobody. The footer keeps its own copy; this one sits where the data is used. */
function forestBggBadge(cls) {
  return `<a class="forest-bgg-link ${cls}" href="https://boardgamegeek.com" target="_blank" rel="noopener noreferrer"><img src="/icons/powered-by-bgg.png" width="900" height="264" alt="Powered by BGG" /></a>`;
}
