/* Spielwirbel – the landing hero's stage (issue #1091): the app's own loop,
   played once from the app's own components.

   What it replaces: a static product screenshot. The #1090 deep-dive's finding
   was that the brand's verb appears on this page as a 26px glyph and nothing
   else — the whirl, the sealed vote and the score are what the app is about,
   and the front door showed none of them moving.

   ## Two rules this file exists to keep

   1. NOTHING HERE IS INVENTED. Every scene is the markup the real view renders,
      the classes are the app's classes, and the motion is the app's own
      keyframes reached through the app's own state hooks (`is-race`,
      `is-reveal`, `is-lift`, `data-unroll`). A change to the pot, the faces or
      the Tafel therefore changes this stage too, and the stage cannot promise a
      visitor anything the demo does not deliver one click later. The first
      version of this idea showed covers orbiting a table — a choreography no
      screen has — and was rejected for the reason #438 removed the abstract
      gradients from this very hero. See
      .claude/rules/landing-character-is-shipped-moments.md.

   2. NO GAME CARRIES A COVER. Every cover on the stage is the app's own
      coverPlaceholder() gradient, exactly like the committed screenshots: a
      provider's cover art on the most public page we have would be re-hosting
      someone else's artwork (.claude/rules/provider-cover-hotlinking.md).

   ## What #1122 took out of it, and why the stage is shorter than planned

   #1091 was written around THREE moments in motion, the first being the pot's
   turn on „Loswirbeln" and the last the „Gespielt" stamp pressing onto the box.
   #1122 then deleted both keyframes — `pot-whirl` and `press-in` — because as
   ENTRY animation on a screen the reader is waiting for, they read as a slow
   page. It left two stylesheet-wide guards behind them
   (test/session-pot.test.js, test/result-motion.test.js) which fail if either
   keyframe is declared anywhere at all, this file included.

   So those two beats are dropped rather than re-homed here (operator decision,
   2026-09-15): the pot is shown at rest with its „Loswirbeln" press, and the
   band arrives with the stamp already on the box. Everything the stage shows is
   something the app still does, which is rule 1. Do not reintroduce either
   keyframe to make the stage richer — the guards will say so, and they are
   right.

   Part of the frontend's shared global scope, loaded before views-landing.js.
   Every cross-file name it uses (h, esc, t, tn, fmtAvg, fmtDate,
   coverPlaceholder, avgColor, ratingFace, initials, avatarFace, MEMBER_COLORS,
   RATING_MIN/MAX) is read at CALL time inside renderLandingMoments(), never at
   load time — .claude/rules/frontend-script-load-order.md. */

'use strict';

/* The sample dataset. Six invented titles, three of them drawn and ranked.

   Deliberately NOT localized, and deliberately not the capture seed's German
   titles either. A board game's name is a proper noun: it stays put across
   languages, the way „Azul" or „Carcassonne" do, so a neutral invented word
   reads correctly under every shipped locale. Reusing the seed's per-locale titles
   would mean either shipping one language's words under the other eight — the
   half-translated impression #457 exists to remove — or one i18n key per title
   per shipped locale, for strings no reader is meant to look up. */
const LM_POT_TITLES = ['Korrino', 'Vespera', 'Nordlys', 'Kalyra', 'Solvara', 'Tessara'];

/* The three drawn games and the score each ends on. These are DISPLAYED scores,
   i.e. what the app calls `shown` — so `avgColor(score)` here is byte-for-byte
   what the row computes as `scoreColor(r.score)` (= avgColor(displayScore(…))),
   with no second opinion about the ramp. */
const LM_RANK = [
  { title: 'Korrino', score: 4.7 },
  { title: 'Vespera', score: 3.6 },
  { title: 'Nordlys', score: 2.4 },
];

const LM_SEATS = 4;                 // people at the table, for the pot's summary
const LM_VOTER = 'Lea';             // whose turn it is on the vote card
const LM_VOTE = 4;                  // the face she picks
const LM_WINNERS = ['Lea', 'Jonas'];

/* The timeline, in ms from the start of a play. One clock for the whole stage:
   the scene changes and the app's state hooks are driven by the SAME setTimeout
   chain, rather than the scenes being cross-faded by a second CSS timeline.
   Two clocks in two units (percentages of a keyframe against absolute ms here)
   is a retune that has to be made twice and drifts silently when it is not.

   The app's own durations are then layered on top and are NOT restated here:
   `trow-fill` runs for each row's `--dur`, `tafel-gold` for its 3.6s. LM_LIFT
   is placed after the gold lands (LM_RACE + 3600), so the sequence reads as
   "the ranking fills, the winner turns gold, somebody picks it up". If the
   stylesheet retunes `tafel-gold`, this is the one number to move with it. */
const LM_PRESS = 1300;   // „Loswirbeln" takes the press
const LM_RELEASE = 1600;
const LM_VOTE_AT = 1900; // cut to the vote card
const LM_RATE = 3000;    // Lea taps the 4
const LM_RESULT = 4200;  // cut to the result
const LM_RACE = 4500;    // the rows race and the group tints gold
const LM_LIFT = 8200;    // the chosen row hands its game over
const LM_UNROLL = 8300;  // the table band rolls open

/* Pending timers for the CURRENT play. Module-level rather than per-stage on
   purpose: a language switch re-runs showLanding() through currentView, which
   builds a NEW stage while the old chain is still armed, and a per-stage handle
   would leave the old one running against a detached tree. Clearing here at the
   top of every render covers the re-render, the replay and the unmount with one
   mechanism. */
let lmTimers = [];

/** Cancel the pending play, if any. Safe to call when nothing is armed. */
function stopLandingMoments() {
  lmTimers.forEach(clearTimeout);
  lmTimers = [];
}

/* True when the visitor has asked for less motion. Its own function so a spec
   can stub matchMedia and so the absent-matchMedia case (an old browser, a
   headless probe) reads as "animate", which is the app's posture everywhere
   else — every one of these keyframes is declared inside a
   `prefers-reduced-motion: no-preference` block, so the stylesheet is the real
   gate and this only decides whether to arm the timers. */
function lmReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch { return false; }
}

/* A game object shaped the way coverPlaceholder() wants it, with NO image — see
   rule 2 in the header. The hue is derived from the title by gameHue(), so the
   six gradients differ from one another exactly as they would in the app. */
const lmGame = (title) => ({ id: 'lm-' + title, title });

/* Scene 1 — the pot (#1017). `.setup-panel` + `.pool-tile` + `.setup-bar`, the
   markup updateHint() writes, minus the stepper: a control the visitor cannot
   use is noise on a stage.

   The panel is `display: none` below 860px in the app (CSS picks the phone's
   snap strip instead); the stage re-enables it at every width, an accepted
   liberty named in the issue — the phone strip shows 64px thumbs that say much
   less about what a pot is. */
function lmScenePot() {
  const tiles = LM_POT_TITLES.map((title) => `
        <span class="pool-tile">
          <span class="pool-tile__img">${coverPlaceholder(lmGame(title))}</span>
          <span class="pool-tile__name">${esc(title)}</span>
        </span>`).join('');
  const n = LM_POT_TITLES.length;
  // A <div> rather than the app's <h2>/<h1>: the stage is aria-hidden
  // decoration, and a heading that is present in the DOM while absent from the
  // accessibility tree is exactly what confuses an outline reader. The classes
  // carry the whole look, so the element name changes nothing visually.
  return `<div class="lm-scene lm-scene--pot">
      <div class="setup-panel">
        <div class="setup-panel__title">
          <span class="pool-count-group"><span class="pool-count">${n}</span>
            <span class="pool-count__label">${esc(tn(n, 'startSession.potLabelOne', 'startSession.potLabel'))}</span></span>
        </div>
        <div class="setup-panel__body">${tiles}</div>
      </div>
      <div class="setup-bar">
        <p class="setup-bar__summary">${esc(tn(LM_SEATS, 'startSession.tableCountOne', 'startSession.tableCount'))}
          · ${esc(tn(n, 'startSession.availableOne', 'startSession.available'))}</p>
        <button class="btn btn--primary btn--lg lm-draw" type="button" disabled tabindex="-1">
          <i class="ti ti-tornado" aria-hidden="true"></i> ${esc(t('startSession.draw'))}</button>
      </div>
    </div>`;
}

/* Scene 2 — the vote card (#890/#909), as startVoting() renders it: the person,
   the drawn cover, the question, the five mood faces and the scale. Since #1168
   the face tap itself advances, so the card's one remaining control is the undo
   in its top-left corner — and the picture has to keep matching the card it
   claims to be.

   Every control is inert (`disabled` + `tabindex="-1"`) — the stage is a
   picture, and a focusable dead button inside it would be a tab stop that does
   nothing. */
function lmSceneVote() {
  const game = lmGame(LM_RANK[0].title);
  const faces = [];
  for (let n = RATING_MIN; n <= RATING_MAX; n++) {
    faces.push(`<button class="mood" type="button" disabled tabindex="-1">
           <i class="ti ${ratingFace(n)}" aria-hidden="true"></i><span class="mood__n">${n}</span>
         </button>`);
  }
  return `<div class="lm-scene lm-scene--vote">
      <div class="vote">
        <div class="vote__who">
          <button class="vote__undo" type="button" disabled tabindex="-1"><i class="ti ti-arrow-back-up" aria-hidden="true"></i></button>
          ${esc(t('vote.who'))}
          <strong style="color:${MEMBER_COLORS[2]}">${esc(LM_VOTER)}</strong></div>
        <div class="vote__img">${coverPlaceholder(game)}</div>
        <div class="vote__title">${esc(game.title)}</div>
        <div class="vote__q">${esc(t('vote.question'))}</div>
        <div class="rating">${faces.join('')}</div>
        <div class="rating-scale"><span>${esc(t('vote.scaleLow'))}</span><span>${esc(t('vote.scaleHigh'))}</span></div>
      </div>
    </div>`;
}

/* One ranked row, exactly as the Tafel builds it: `--pct` is the score over the
   scale's top (so the row IS its own bar), `--sc` the raw accent CSS mixes the
   fill from, and `--dur` the per-row race duration — 0.5s + score × 0.32s, the
   app's own formula, which is what makes every fill start together and the
   winner's complete last.

   `.trow__img` and `.trow__title` are <span>s here where the app uses <a>s:
   there is no game page to open from the landing. The classes are unchanged. */
function lmRow(entry, place) {
  const pct = Math.round((entry.score / RATING_MAX) * 1000) / 10;
  const sc = avgColor(entry.score);
  const dur = (0.5 + entry.score * 0.32).toFixed(2);
  /* The numeral carries NO inline colour: the row already states this exact
     value as `--sc` and `.score-big` reads it (#1191). An inline `color` would
     make this the one score in the app a design could not repaint — and it is
     on the FACE design's own shop window, which is the worst place for it. */
  return `<div class="trow" style="--pct:${pct}%;--sc:${sc};--dur:${dur}s">
      <span class="trow__rank trow__rank--${place}">${place}</span>
      <span class="trow__img">${coverPlaceholder(lmGame(entry.title))}</span>
      <div class="trow__main"><span class="trow__title">${esc(entry.title)}</span></div>
      <div class="trow__score">
        <div class="score-big">${esc(fmtAvg(entry.score))}</div>
        <div class="score-label">${esc(t('score.name'))}</div>
      </div>
      <div class="trow__action"></div>
    </div>`;
}

/* Scene 3 — the Tafel and the table (#1056–#1058). The band ships `hidden`, as
   the real screen ships it before a game is chosen; the timeline reveals it and
   rolls it open. The stamp is the app's own `.stamp--table`, already on the box
   — #1122 removed the press that used to put it there. */
function lmSceneResult() {
  const winner = LM_RANK[0];
  const seats = LM_WINNERS.map((name) => `
        <span class="seat">
          <span class="avatar" style="background:${MEMBER_COLORS[2]}">${avatarFace(initials(name), {})}</span>
          <span class="seat__name">${esc(name)}</span>
        </span>`).join('');
  const rows = LM_RANK.map((entry, i) => lmRow(entry, i + 1));
  return `<div class="lm-scene lm-scene--result">
      <div class="tisch-slot">
        <section class="tisch" data-state="done" hidden>
          <span class="tisch__box">${coverPlaceholder(lmGame(winner.title))}
            <span class="stamp stamp--table" style="--sc:${avgColor(winner.score)}">
              <span class="stamp__status">${esc(t('result.stamp'))}</span>
              <span class="stamp__date">${esc(fmtDate(new Date().toISOString()))}</span>
            </span></span>
          <div class="tisch__main">
            <div class="tisch__kick">${esc(t('result.tableTitle'))}</div>
            <div class="tisch__title">${esc(winner.title)}</div>
            <div class="tisch__seats">${seats}
              <span class="tisch__won">${esc(tn(LM_WINNERS.length, 'result.wonSeatsOne', 'result.wonSeats'))}</span></div>
          </div>
        </section>
      </div>
      <div class="tafel">
        <div class="tafel-top">
          <div class="tafel-top__kicker">
            <i class="ti ti-crown tafel-top__crown" aria-hidden="true"></i>
            ${esc(t('result.voteWinner'))}
          </div>
          ${rows[0]}
        </div>
        ${rows.slice(1).join('')}
      </div>
    </div>`;
}

/**
 * Build the hero stage and start its one play.
 *
 * Returns the element; the caller appends it. Any play still running from an
 * earlier stage (a language switch, a replay) is cancelled first.
 */
function renderLandingMoments() {
  stopLandingMoments();

  /* `role="group"` is what makes the label do anything: an `aria-label` on a
     bare <div> has no role to name and is dropped. The group's one exposed
     child is the replay button, so the name is the context „Nochmal ansehen"
     would otherwise lack — the scenes themselves stay aria-hidden, because the
     walkthrough below already describes the loop and a reader does not need it
     twice. Nothing inside the hidden subtree is focusable (every control there
     is `disabled` AND `tabindex="-1"`), so there is no focus-in-aria-hidden
     trap either. */
  const stage = h(`<div class="landing-moments" data-scene="1"
      role="group" aria-label="${esc(t('landing.moments.label'))}">
      <div class="landing-moments__stage" aria-hidden="true">
        ${lmScenePot()}
        ${lmSceneVote()}
        ${lmSceneResult()}
      </div>
      <p class="landing-moments__caption" aria-hidden="true">
        <span data-for="1">${esc(t('landing.moments.pot'))}</span>
        <span data-for="2">${esc(t('landing.moments.vote'))}</span>
        <span data-for="3">${esc(t('landing.moments.result'))}</span>
      </p>
      <button type="button" class="btn btn--sm landing-moments__replay">
        <i class="ti ti-refresh" aria-hidden="true"></i> ${esc(t('landing.moments.replay'))}</button>
    </div>`);

  const draw = stage.querySelector('.lm-draw');
  const mood = stage.querySelectorAll('.mood')[LM_VOTE - 1];
  const rows = [...stage.querySelectorAll('.trow')];
  const top = stage.querySelector('.tafel-top');
  const slot = stage.querySelector('.tisch-slot');
  const tisch = stage.querySelector('.tisch');

  /* The one thing the click handler does that markup cannot: the selected face
     takes the rating's colour. As `--sc`, never as an inline `background` —
     this screen is the FACE design's shop window, so the one surface that must
     stay repaintable by a design is exactly this one (#1191). Same write as
     views-session.js's mood loop. */
  const selectFace = () => {
    mood.classList.add('is-selected');
    mood.style.setProperty('--sc', avgColor(LM_VOTE));
  };

  const rest = () => { tisch.hidden = false; };

  if (lmReducedMotion()) {
    /* No timers at all, and the finished picture immediately. Every keyframe
       above is declared inside a `prefers-reduced-motion: no-preference` block,
       so the state hooks would do nothing here anyway — omitting them keeps the
       two halves from disagreeing, and the rest state is the thing worth
       looking at regardless. */
    stage.dataset.scene = '3';
    selectFace();
    rest();
    wireLandingMomentsReplay(stage);
    return stage;
  }

  /* The chain. Each step bails if the stage has left the document — a visitor
     who presses „Ausprobieren" two seconds in leaves up to eight seconds of
     timers behind, and this is what stops them touching a detached tree. */
  const at = (ms, fn) => lmTimers.push(setTimeout(() => {
    if (!stage.isConnected) { stopLandingMoments(); return; }
    fn();
  }, ms));

  at(LM_PRESS, () => draw.classList.add('is-press'));
  at(LM_RELEASE, () => draw.classList.remove('is-press'));
  at(LM_VOTE_AT, () => { stage.dataset.scene = '2'; });
  at(LM_RATE, selectFace);
  at(LM_RESULT, () => { stage.dataset.scene = '3'; });
  at(LM_RACE, () => {
    rows.forEach((row) => row.classList.add('is-race'));
    top.classList.add('is-reveal');
  });
  at(LM_LIFT, () => rows[0].classList.add('is-lift'));
  at(LM_UNROLL, () => { rest(); slot.setAttribute('data-unroll', ''); });

  wireLandingMomentsReplay(stage);
  return stage;
}

/* „Nochmal ansehen". Replaces the stage with a fresh one rather than rewinding
   this one: a keyframe that has already run to `both` does not restart without
   a reflow dance, and a new element is one line and cannot half-reset. */
function wireLandingMomentsReplay(stage) {
  stage.querySelector('.landing-moments__replay').addEventListener('click', () => {
    const fresh = renderLandingMoments();
    stage.replaceWith(fresh);
    fresh.querySelector('.landing-moments__replay').focus();
  });
}
