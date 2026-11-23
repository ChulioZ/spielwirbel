/* Spielwirbel – the stage SAYS where the round stands (#1854).

   One sentence in the design's display face and, where the state has one, the
   one action that fits it — then what the state is about, lying on the table.
   The state itself is stageState (stage-state.js); this file only draws it, so
   every design shows the same sentence for the same round.

   | kind     | sentence                         | on the table              | primary            |
   |----------|----------------------------------|---------------------------|--------------------|
   | normal   | „Was spielen wir heute?"         | the „Zuletzt" ticket/lead | the hub's CTA      |
   | running  | „Abstimmung läuft." + sub-line   | one face-down card a game | „Weiter abstimmen" |
   | table    | „Auf dem Tisch: {game}"          | that game's cover         | „Ergebnis eintragen" |
   | young    | „{n} Spiele warten auf …"        | the first covers          | the hub's CTA      |
   | empty    | — the empty table, unchanged (hubEmptyTable)                             |

   In `normal` the table is NOT drawn here: the design's own „Zuletzt gespielt"
   element (hubLastTicket, phLead, forestLead) already lies under the action and
   is a real link, so the stage draws no second copy of it.

   THE DRAW STAYS SECRET. A running vote is drawn as backs only — no title, no
   cover, nothing an element could leak through `title` or `alt` — exactly as
   its ticket always kept it. The count of backs is capped at
   STAGE_BACKS_SHOWN, then „+n".

   STATIC. No animation and no transition on anything here: a flip or a deal the
   reader waits through reads as a page still loading (operator ruling, #1122).
   test/start-tab-say.test.js holds the stylesheet to that.

   The table is aria-hidden: the sentence and the sub-line carry everything it
   shows. Part of the frontend's shared global scope; loaded after hub-cards.js. */

// Face-down cards drawn for a running vote, before the rest becomes „+n".
const STAGE_BACKS_SHOWN = 3;
// Covers laid out for a young round.
const STAGE_YOUNG_COVERS = 5;

function stageOf(round, activeGames) {
  return stageState(round, activeGames, { sessionOutcome, newestSessionsFirst });
}

// The running vote's sub-line: how many games are in the pot, who has voted.
function stageVoterText(round, session) {
  const v = stageVoters(sessionPeople(round, session), session.votedIds);
  if (v.kind === 'count') return t('hub.stage.votedCount', { n: v.n, of: v.of });
  if (v.kind === 'none') return t('hub.stage.votedNone');
  return tn(v.voters.length, 'hub.stage.votedOne', 'hub.stage.voted', { names: joinNames(v.voters.map(personLabel)) });
}

function hubStageSay(round, st) {
  const say = h(`<section class="hub-say hub-say--${st.kind}"></section>`);
  const line = (cls, text) => say.appendChild(h(`<p class="${cls}">${esc(text)}</p>`));
  if (st.kind === 'running') line('hub-say__label', fmtSessionWhen(st.session));
  const title = st.kind === 'running' ? t('hub.stage.running')
    : st.kind === 'table' ? t('hub.stage.table', { game: st.game ? st.game.title : t('round.inProgressDeciding') })
      : st.kind === 'young' ? tn(st.counts.games, 'hub.stage.youngOne', 'hub.stage.young')
        : t('hub.stage.normal');
  say.appendChild(h(`<h2 class="hub-say__line">${esc(title)}</h2>`));
  // Only a running vote has a sub-line. The young round's old „why there are
  // no scores yet" sentence was left off on purpose: the covers say what is
  // waiting, and at 390px it alone cost ~70px of the height #1854 is about.
  if (st.kind === 'running') {
    line('hub-say__sub', `${tn(st.counts.games, 'hub.stage.potOne', 'hub.stage.pot')} · ${stageVoterText(round, st.session)}`);
  }

  const table = hubStageTable(st);
  if (table) say.appendChild(table);

  // The state's own primary. In `normal` and `young` the hub's CTA is it.
  if (st.kind === 'running') {
    const go = h(`<button class="btn btn--primary hub-say__go" type="button"><i class="ti ti-player-play" aria-hidden="true"></i>${esc(t('hub.stage.continueVote'))}</button>`);
    go.addEventListener('click', () => showSessionLobby(round, st.session));
    say.appendChild(go);
  } else if (st.kind === 'table') {
    const go = h(`<a class="btn btn--primary hub-say__go"><i class="ti ti-pencil" aria-hidden="true"></i>${esc(t('home.resume.result'))}</a>`);
    say.appendChild(navLink(go, resultsPath(round.id, st.session.id), () => showResults(round, st.session)));
  }
  return say;
}

function hubStageTable(st) {
  const cover = (game) => {
    const style = game.image ? ` style="background-image:url('${coverUrl(game.image, COVER_THUMB)}')"` : '';
    return `<span class="hub-say__card"${style}>${game.image ? '' : coverPlaceholder(game)}</span>`;
  };
  let cards = '';
  if (st.kind === 'running') {
    const n = st.counts.games;
    cards = '<span class="hub-say__card hub-say__card--back"></span>'.repeat(Math.min(n, STAGE_BACKS_SHOWN));
    if (n > STAGE_BACKS_SHOWN) cards += `<span class="hub-say__more">+${n - STAGE_BACKS_SHOWN}</span>`;
  } else if (st.kind === 'table' && st.game) {
    cards = cover(st.game);
  } else if (st.kind === 'young') {
    cards = (st.games || []).slice(0, STAGE_YOUNG_COVERS).map(cover).join('');
  }
  return cards ? h(`<div class="hub-say__table" aria-hidden="true">${cards}</div>`) : null;
}
