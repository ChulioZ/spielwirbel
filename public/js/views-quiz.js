/* Spielwirbel – the weekly community quiz (#743). Part of the frontend; all
   files share one global script scope (load order: see index.html).

   Five questions a week about board games, built on the server from the BGG
   corpus. Each answer is sent on its own and is FINAL: the reply says right or
   wrong and names the correct choice, and the browser never holds the answer
   key of a question it has not answered (lib/quiz.js presentRound). This file
   holds /quiz (a main page, from the account menu), the home tile, the inbox
   row for a new round, and the playable sample on the logged-out landing page.

   BGG values are shown VERBATIM — a category, mechanic or designer name is in
   English in every language. That is the licence (the data may not be
   modified), not a missing translation. */

'use strict';

// Whether this instance runs the quiz — and there is an account to play with.
// Synchronous off the cached /api/config: the account menu is built
// synchronously on every open (account-chrome.js).
function quizAvailable() {
  return accountsActive() && isLoggedIn() && !!(accountCfg && accountCfg.quiz);
}

// The same answer for a cold load of /quiz, which can run before /api/config
// has answered (the priceWatchesReady shape).
function quizReady() {
  if (!(accountsActive() && isLoggedIn())) return Promise.resolve(false);
  if (accountCfg) return Promise.resolve(quizAvailable());
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    withAppConfig(() => { clearTimeout(timer); resolve(quizAvailable()); });
  });
}

// The sentence is ours (an i18n template); the game name is BGG's.
function quizQuestionText(q) {
  return q.type === 'duel' ? t('quiz.q.duel') : t(`quiz.q.${q.type}`, { game: (q.subject && q.subject.name) || '' });
}

// One choice as text. Bands and ranges are formatted here; list values are BGG's
// own strings, untranslated on purpose (see the file header).
function quizChoiceLabel(type, c) {
  switch (type) {
    case 'weight': return t('quiz.choice.weight', { min: c.min, max: c.max });
    case 'playtime':
      if (c.min == null) return t('quiz.choice.timeUpTo', { max: c.max });
      if (c.max == null) return t('quiz.choice.timeOver', { min: c.min - 1 });
      return t('quiz.choice.time', { min: c.min, max: c.max });
    case 'players': return c.min === c.max
      ? t('quiz.choice.playersOne', { n: c.min })
      : t('quiz.choice.players', { min: c.min, max: c.max });
    case 'duel': return c.name || '';
    default: return String(c);
  }
}

const quizCover = (url, cls) => (url
  ? `<img class="${cls}" src="${esc(coverUrl(url, COVER_THUMB))}" alt="" loading="lazy" decoding="async">`
  : '');

/* One question as a card. `onPick(choiceIndex)` returns a promise of the
   result ({ correct, answer }) or null when the pick did not go through; the
   card locks itself while it waits and shows the outcome in words AND an icon —
   never by colour alone. `result` paints an already-answered question. */
function renderQuizCard(q, { index, total, result, onPick }) {
  const card = h(`<article class="card quiz-q" data-type="${esc(q.type)}">
      <div class="quiz-q__head">
        ${q.subject ? quizCover(q.subject.imageUrl, 'quiz-q__cover') : ''}
        <div class="quiz-q__ask">
          ${total ? `<span class="quiz-q__n muted">${esc(t('quiz.questionOf', { n: index + 1, total }))}</span>` : ''}
          <h2 class="quiz-q__text">${esc(quizQuestionText(q))}</h2>
        </div>
      </div>
      <div class="quiz-q__choices"></div>
      <p class="quiz-q__result" aria-live="polite"></p>
    </article>`);
  const box = card.querySelector('.quiz-q__choices');
  const buttons = q.choices.map((c, i) => {
    const b = h(`<button type="button" class="quiz-choice${q.type === 'duel' ? ' quiz-choice--game' : ''}">
        ${q.type === 'duel' ? quizCover(c.imageUrl, 'quiz-choice__cover') : ''}
        <span class="quiz-choice__label">${esc(quizChoiceLabel(q.type, c))}</span>
      </button>`);
    // No "busy" flag beside `disabled`: a disabled button fires no click, so the
    // lock IS the guard against a second answer (measured — a flag here was
    // unreachable, .claude/rules/redundant-guards-make-each-other-untestable.md).
    b.addEventListener('click', async () => {
      lock(true);
      const r = await onPick(i);
      if (r) reveal(i, r); else lock(false);
    });
    box.appendChild(b);
    return b;
  });
  function lock(on) {
    buttons.forEach((b) => { b.disabled = on; });
  }
  function reveal(choice, r) {
    lock(true);
    buttons.forEach((b, i) => {
      const right = i === r.answer;
      const chosen = i === choice;
      b.classList.toggle('quiz-choice--right', right);
      b.classList.toggle('quiz-choice--wrong', chosen && !right);
      b.setAttribute('aria-pressed', chosen ? 'true' : 'false');
      if (right || chosen) {
        b.prepend(h(`<i class="ti ${right ? 'ti-check' : 'ti-x'} quiz-choice__mark" aria-hidden="true"></i>`));
      }
    });
    card.classList.add(r.correct ? 'quiz-q--right' : 'quiz-q--wrong');
    card.querySelector('.quiz-q__result').textContent = r.correct
      ? t('quiz.right')
      : t('quiz.wrong', { answer: quizChoiceLabel(q.type, q.choices[r.answer]) });
  }
  if (result) reveal(result.choice, result);
  return card;
}

/* /quiz — this week's round and the friends' standings. A MAIN page (reached
   from the account menu), so no back control
   (.claude/rules/persistent-chrome-defines-the-main-pages.md). */
async function showQuiz() {
  const view = () => showQuiz();
  currentView = view;
  if (!(await quizReady())) return showHome();
  if (currentView !== view) return undefined;
  syncUrl('/quiz');
  setContext(t('quiz.title'));
  setDocTitle(t('quiz.title'));
  applyMarker(null);
  app.innerHTML = '';
  if (designIs('bruecke')) app.appendChild(brueckeUpLink());
  // The intro sits OUTSIDE the head, as on /preisalarme: Der Tisch's felt head
  // lays out a heading alone, and a paragraph inside it ran over the title.
  const head = h(`<div class="lobby-head${designIs('tisch') ? ' lobby-head--felt' : ''}"><h1>${esc(t('quiz.title'))}</h1></div>`);
  app.appendChild(head);
  app.appendChild(h(`<p class="muted quiz__intro">${esc(t('quiz.intro'))}</p>`));

  let round;
  try {
    round = await api('GET', '/api/quiz/current');
  } catch (e) {
    if (!head.isConnected) return undefined;
    app.appendChild(h(`<p class="muted quiz__empty">${esc(t(e.message === 'no_round' ? 'quiz.none' : 'quiz.err.generic'))}</p>`));
    return undefined;
  }
  // A newer screen took over while the round loaded.
  if (!head.isConnected) return undefined;
  if (!round || !Array.isArray(round.questions) || !round.questions.length) {
    app.appendChild(h(`<p class="muted quiz__empty">${esc(t('quiz.none'))}</p>`));
    return undefined;
  }

  const score = h('<p class="quiz__score" aria-live="polite"></p>');
  const paintScore = () => {
    score.textContent = round.answered
      ? t('quiz.score', { score: round.score, answered: round.answered, total: round.total })
      : t('quiz.scoreNone', { total: round.total });
  };
  paintScore();
  app.appendChild(score);

  const list = h('<div class="quiz__questions"></div>');
  round.questions.forEach((q, index) => {
    list.appendChild(renderQuizCard(q, {
      index,
      total: round.total,
      result: q.result,
      onPick: async (choice) => {
        let r;
        try {
          r = await api('POST', '/api/quiz/current/answers', { week: round.week, index, choice });
        } catch (e) {
          // A new week began, or this question was answered in another tab:
          // the screen is stale, so draw it again from the server's state.
          if (e.message === 'round_closed' || e.message === 'already_answered') {
            toast(t(e.message === 'round_closed' ? 'quiz.err.closed' : 'quiz.err.answered'), { tone: 'error' });
            showQuiz();
          } else {
            toast(t('quiz.err.generic'), { tone: 'error' });
          }
          return null;
        }
        round.score = r.score;
        round.answered = r.answered;
        paintScore();
        // The reader's own row appears (and moves) with every answer.
        loadQuizBoard(board);
        return r;
      },
    }));
  });
  app.appendChild(list);

  const notes = [t('quiz.source')];
  if (round.dumpDate && round.questions.some((q) => q.type === 'duel')) notes.push(t('quiz.rankAsOf', { date: fmtDate(round.dumpDate) }));
  app.appendChild(h(`<p class="muted quiz__source">${esc(notes.join(' · '))}</p>`));

  const board = h(`<section class="quiz-board">
      <h2 class="section-title">${esc(t('quiz.board.title'))}</h2>
      <div class="quiz-board__list"></div>
    </section>`);
  app.appendChild(board);
  loadQuizBoard(board);
  return undefined;
}

// The week's standings among the account and its friends. Fetched on its own,
// so a slow leaderboard never holds up the questions.
async function loadQuizBoard(board) {
  const listEl = board.querySelector('.quiz-board__list');
  let data;
  try {
    data = await api('GET', '/api/quiz/leaderboard');
  } catch {
    listEl.replaceChildren(h(`<p class="muted">${esc(t('quiz.err.generic'))}</p>`));
    return;
  }
  if (!board.isConnected) return;
  const entries = data.entries || [];
  if (!entries.some((e) => !e.me)) {
    const empty = h(`<p class="muted quiz-board__empty">${esc(t('quiz.board.empty'))} <a class="quiz-board__friends"></a></p>`);
    const link = empty.querySelector('.quiz-board__friends');
    link.textContent = t('quiz.board.invite');
    navLink(link, '/freunde', () => showFriends());
    listEl.replaceChildren(empty);
    if (!entries.length) return;
  } else {
    listEl.replaceChildren();
  }
  const ol = h('<ol class="ds-list quiz-board__rows"></ol>');
  entries.forEach((e, i) => {
    ol.appendChild(h(`<li class="ds-row ds-row--static quiz-board__row${e.me ? ' quiz-board__row--me' : ''}">
        <div class="ds-row__main"><span class="quiz-board__rank">${i + 1}.</span> <strong>${esc(e.username)}</strong>${e.me ? ` <span class="muted">${esc(t('quiz.board.you'))}</span>` : ''}</div>
        <div class="ds-row__meta">${esc(t('quiz.board.points', { score: e.score, answered: e.answered }))}</div>
      </li>`));
  });
  listEl.appendChild(ol);
}

/* The home tile: this week's state in one line, linking to /quiz. A
   placeholder the caller wrapped in a .card-slot; the SLOT goes when there is
   nothing to show (views-home.js renderHomeDash). */
async function mountHomeQuiz(tile) {
  const drop = () => { const slot = tile.closest('.card-slot'); (slot || tile).remove(); };
  if (!quizAvailable()) return drop();
  let round;
  try {
    round = await api('GET', '/api/quiz/current');
  } catch {
    return drop();
  }
  if (!tile.isConnected) return undefined;
  const line = round.answered === round.total
    ? t('quiz.home.done', { score: round.score, total: round.total })
    : round.answered ? t('quiz.home.progress', { answered: round.answered, total: round.total })
      : t('quiz.home.open', { total: round.total });
  const a = h(`<a class="home-quiz__link">
      <span class="home-quiz__label"><i class="ti ti-bulb" aria-hidden="true"></i>${esc(t('quiz.title'))}</span>
      <span class="home-quiz__line">${esc(line)}</span>
    </a>`);
  navLink(a, '/quiz', () => showQuiz());
  tile.replaceChildren(a);
  return undefined;
}

/* A new round in the inbox: in-app only (lib/notify.js never mails it), a link
   to /quiz and a dismiss — nothing to accept or decline. */
function renderQuizRoundItem(item) {
  const p = item.payload || {};
  const row = h(`<div class="ds-row${item.read ? ' ds-row--static' : ''} inbox-row inbox-row--quiz${item.read ? '' : ' inbox-row--unread'}">
      <div class="ds-row__main">
        <div class="ds-row__date">${unreadDot(item)}${esc(t('quiz.inbox.title'))}</div>
        <div class="ds-row__status muted">${esc(t('quiz.inbox.body', { total: p.questions || 5 }))}</div>
        <a class="inbox-row__quiz">${esc(t('quiz.inbox.open'))}</a>
      </div>
      <div class="ds-row__meta">
        <button class="link-btn inbox-row__del" type="button" aria-label="${esc(t('inbox.dismiss'))}"><i class="ti ti-trash" aria-hidden="true"></i></button>
      </div>
    </div>`);
  const markRead = async () => {
    if (item.read) return;
    try {
      await accountApi('POST', `/inbox/${item.id}/read`);
      item.read = true;
      row.classList.remove('inbox-row--unread');
      row.classList.add('ds-row--static');
      const d = row.querySelector('.inbox-row__dot');
      if (d) d.remove();
      refreshInboxBadge();
    } catch {}
  };
  navLink(row.querySelector('.inbox-row__quiz'), '/quiz', () => { markRead(); showQuiz(); });
  if (!item.read) {
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return; // each control has its own handler
      markRead();
    });
  }
  row.querySelector('.inbox-row__del').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      await accountApi('DELETE', `/inbox/${item.id}`);
      row.remove();
      afterRemove();
    } catch {}
  });
  return row;
}

/* The landing page's sample (#743): ONE question a visitor can answer before
   being asked for anything. It is never scored — the endpoint serves it with
   its answer, built from games this week's scored questions do not use — so it
   is checked right here. The placeholder is removed outright when the quiz is
   off or has no round: no heading, no container, no gap. */
async function mountLandingQuiz(placeholder) {
  let q = null;
  try {
    const r = await fetch('/api/quiz/sample');
    if (r.ok) q = (await r.json()).question;
  } catch {}
  if (!placeholder.isConnected) return;
  if (!q || !Array.isArray(q.choices)) {
    placeholder.remove();
    return;
  }
  placeholder.appendChild(h(`<h2 class="landing-section__title">${esc(t('quiz.landing.title'))}</h2>`));
  const cta = h(`<div class="landing-quiz__cta" hidden>
      <p class="muted">${esc(t('quiz.landing.more'))}</p>
      <button class="btn btn--primary landing-quiz__register" type="button">${esc(t('quiz.landing.register'))}</button>
    </div>`);
  cta.querySelector('.landing-quiz__register').addEventListener('click', () => showRegister());
  placeholder.appendChild(renderQuizCard(q, {
    index: 0,
    total: 0,
    onPick: async (choice) => {
      cta.hidden = false;
      return { correct: choice === q.answer, answer: q.answer };
    },
  }));
  placeholder.appendChild(cta);
}
