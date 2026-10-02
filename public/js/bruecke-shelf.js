/* Spielwirbel – Die Brücke's Regal and Spielepass pieces (#1239: B2.6, B3.2,
   B6.3, B13.4, B16.4). Loaded after bruecke-hub.js and before views-regal.js;
   shares one global script scope. Every function here runs at render time, so
   reaching views-regal.js's `cardMeta` from inside one is safe.

   What lives here and why it is not in views-regal.js / views-round-detail.js:
   both are near their budget, and these are the design's own presentations —
   the card with its opaque band, and the Spielepass's stat tiles and rating
   distribution. (B16.2's letter jump and batched loading were dropped by
   operator decision, #1497: the whole shelf renders at once, as in every
   other design.) The view files ask `designIs('bruecke')` and hand over.

   No module.exports: this is DOM code, and the specs reach it through the jsdom
   harness (test/support/dom.js) — see
   .claude/rules/frontend-helper-modules-and-coverage.md for why a DOM file is
   never required into Node. */

'use strict';

/* B16.4: an uppercase title of 22 characters or more steps down one type level
   instead of wrapping — two lines of tracked capitals read as noise. Counted in
   code points, so an accented title is not penalised for its combining marks. */
const BRUECKE_LONG_TITLE = 22;

function brueckeTitleLong(title) {
  return [...String(title || '')].length >= BRUECKE_LONG_TITLE;
}

/* A Regal card (B3.2/B2.6): nothing on the cover but the bulk-select tick, and
   the title, the meta, the score and its bar on an opaque band below it — the
   „no text on a cover" rule from the Tisch review. The score is the shelf's own
   figure and evidence, the same number the pill prints in every other design;
   its tone comes from the data-stop rung, like the Brücke pill's band. The bar
   repeats the number as a length, so it is aria-hidden. */
function brueckeCard(g, fallback, score, evidence, expBadge) {
  const scored = score !== null;
  const shown = scored ? displayScore(score) : null;
  const pct = scored ? Math.max(0, Math.min(100, Math.round((shown / RATING_MAX) * 100))) : 0;
  const stop = scored ? ` data-stop="${scoreStop(score)}" title="${esc(evidence)}"` : '';
  return h(`<a class="game-card game-card--clickable bruecke-card">
       <div class="game-card__img">${fallback}
         <span class="game-card__pick" aria-hidden="true"><i class="ti ti-check"></i></span>
       </div>
       <div class="game-card__body">
         <div class="game-card__title${brueckeTitleLong(g.title) ? ' is-long' : ''}">${esc(g.title)}</div>
         <div class="bruecke-card__row">
           <span class="bruecke-card__meta">${cardMeta(g)}${expBadge}</span>
           <span class="bruecke-card__score${scored ? '' : ' is-new'}"${stop}>${esc(scored ? fmtAvg(shown) : t('games.scoreNew'))}</span>
         </div>
         <span class="bruecke-card__bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
       </div>
     </a>`);
}

/* The Spielepass's three figures (B13.4): the score, how often the round has
   played it, and how many „kein Schub" it has drawn. Desktop only — the phone
   (B6.3) states the score beside the title and has no row for the other two,
   so bruecke.css shows one or the other per width. */
function brueckePassStats(st) {
  const scored = st.score !== null;
  const stop = scored ? ` data-stop="${scoreStop(st.score)}"` : '';
  const tile = (value, label, extra = '') =>
    `<div class="bruecke-stat"><span class="bruecke-stat__n"${extra}>${esc(value)}</span><span class="bruecke-stat__label">${label}</span></div>`;
  const el = h(`<div class="bruecke-stats">
      ${tile(scored ? fmtAvg(displayScore(st.score)) : t('games.scoreNew'), `${esc(t('score.name'))} ${infoButton('score')}`, stop)}
      ${tile(String(st.plays), esc(t('detail.statPlaysBruecke')))}
      ${tile(String(st.vetoes), esc(t('detail.statVetoBruecke')))}
    </div>`);
  wireInfoButtons(el);
  return el;
}

/* „Wie die Runde wertet" (B6.3/B13.4): one column per rating, its height the
   share of votes, named by the app's own mood face and coloured from the
   design's thrust ramp. Built from `st.tiles`, the histogram the score itself
   is computed from, so the chart and the number cannot disagree. The count
   prints above each bar as text, so colour is never the only channel. */
function brueckePassDist(st) {
  const counts = st.tiles.slice(RATING_MIN);
  const max = Math.max(1, ...counts);
  const cols = counts.map((c, i) => {
    const r = i + RATING_MIN;
    const label = t('result.barTitle', { c, r });
    return `<div class="bruecke-dist__col" data-r="${r}" title="${esc(label)}">
        <span class="bruecke-dist__n" aria-hidden="true">${c}</span>
        <span class="bruecke-dist__track"><span class="bruecke-dist__bar" style="height:${Math.round((c / max) * 100)}%"></span></span>
        <i class="ti ${ratingFace(r)}" aria-hidden="true"></i>
        <span class="sr-only">${esc(label)}</span>
      </div>`;
  }).join('');
  return h(`<div class="section bruecke-dist">
      <h2>${esc(t('detail.distTitleBruecke'))}</h2>
      <div class="bruecke-dist__cols" role="group" aria-label="${esc(t('result.distLabel'))}">${cols}</div>
    </div>`);
}
