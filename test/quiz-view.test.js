'use strict';

/* The weekly quiz's screens (#743), rendered under jsdom: the account-menu row,
   /quiz with its per-question reveal, the inbox row, the home tile and the
   landing-page sample. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

const QUESTIONS = [
  { type: 'category', subject: { externalId: '1', name: 'Azul', imageUrl: null }, choices: ['Abstract Strategy', 'Animals', 'Economic', 'Fantasy'] },
  { type: 'players', subject: { externalId: '2', name: 'Catan', imageUrl: null }, choices: [{ min: 2, max: 4 }, { min: 3, max: 4 }, { min: 3, max: 5 }, { min: 4, max: 6 }] },
  { type: 'playtime', subject: { externalId: '3', name: 'Brass', imageUrl: null }, choices: [{ min: null, max: 30 }, { min: 31, max: 45 }, { min: 46, max: 60 }, { min: 61, max: 90 }] },
  { type: 'duel', subject: null, choices: [{ externalId: '4', name: 'Gloomhaven' }, { externalId: '5', name: 'Wingspan' }, { externalId: '6', name: 'Carcassonne' }, { externalId: '7', name: 'Ark Nova' }] },
  { type: 'year', subject: { externalId: '8', name: 'Root', imageUrl: null }, choices: [2014, 2016, 2018, 2021],
    result: { choice: 1, correct: false, answer: 2 } },
];
const ROUND = { week: '2026-W41', dumpDate: '2026-10-01', total: 5, answered: 1, score: 0, questions: QUESTIONS };

function app(t, { quiz = true, locale = 'de' } = {}) {
  const dom = loadApp({ locale });
  t.after(() => dom.close());
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('toast', () => {});
  dom.run(quiz ? 'accountCfg = { quiz: true }' : 'accountCfg = { quiz: false }');
  return dom;
}

const menuLabels = (dom) => {
  dom.call('setupAccountUi');
  dom.document.getElementById('accountBtn').click();
  return [...dom.document.querySelectorAll('.popover__opt')].map((el) => el.textContent.trim());
};

test('the account menu offers „Wochenquiz" only where the quiz runs', (t) => {
  assert.ok(menuLabels(app(t)).includes('Wochenquiz'));
  assert.ok(!menuLabels(app(t, { quiz: false })).includes('Wochenquiz'));
});

test('/quiz: the questions, the score, and an answered question revealed in words and icons', async (t) => {
  const dom = app(t);
  dom.set('api', async (method, url) => (url === '/api/quiz/current' ? JSON.parse(JSON.stringify(ROUND)) : { week: '2026-W41', entries: [] }));
  await dom.call('showQuiz');
  assert.equal(text(dom.app.querySelector('h1')), 'Wochenquiz');
  assert.equal(dom.app.querySelector('.back-row'), null, 'a main page: no back control');
  const cards = dom.app.querySelectorAll('.quiz-q');
  assert.equal(cards.length, 5);
  assert.match(text(dom.app.querySelector('.quiz__score')), /0 von 1 richtig · 1 von 5 beantwortet/);
  assert.match(text(cards[0]), /Welche BGG-Kategorie hat „Azul“\?/);
  assert.match(text(cards[1]), /2–4/);
  assert.match(text(cards[2]), /bis 30 Min\./);
  assert.match(text(cards[3]), /Gloomhaven/);

  const done = cards[4];
  assert.ok([...done.querySelectorAll('button')].every((b) => b.disabled), 'an answered question takes no second answer');
  assert.match(text(done.querySelector('.quiz-q__result')), /Leider falsch – richtig ist: 2018/);
  const [, chosen, right] = done.querySelectorAll('button');
  assert.ok(chosen.querySelector('.ti-x') && chosen.classList.contains('quiz-choice--wrong'), 'the wrong pick carries an icon, not only a colour');
  assert.ok(right.querySelector('.ti-check') && right.classList.contains('quiz-choice--right'));
  assert.match(text(dom.app.querySelector('.quiz__source')), /BGG-Rangliste vom/, 'a duel names the ranking date');
});

test('picking a choice sends ONE answer and reveals the server\'s verdict', async (t) => {
  const dom = app(t);
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push([method, url, body && { ...body }]);
    if (url === '/api/quiz/current') return JSON.parse(JSON.stringify(ROUND));
    if (method === 'POST') return { correct: true, answer: 2, score: 1, answered: 2, total: 5 };
    return { week: '2026-W41', entries: [] };
  });
  await dom.call('showQuiz');
  const card = dom.app.querySelectorAll('.quiz-q')[0];
  card.querySelectorAll('button')[2].click();
  await flush(); await flush();
  assert.deepEqual(calls.filter((c) => c[0] === 'POST'), [['POST', '/api/quiz/current/answers', { week: '2026-W41', index: 0, choice: 2 }]]);
  assert.equal(text(card.querySelector('.quiz-q__result')), 'Richtig!');
  assert.ok(card.querySelectorAll('button')[2].querySelector('.ti-check'));
  assert.match(text(dom.app.querySelector('.quiz__score')), /1 von 2 richtig/);
  card.querySelectorAll('button')[0].click();
  await flush();
  assert.equal(calls.filter((c) => c[0] === 'POST').length, 1, 'a revealed question took a second answer');
});

test('a failed answer unlocks the card again, and no week yet says so', async (t) => {
  const dom = app(t);
  dom.set('api', async (method, url) => {
    if (url === '/api/quiz/current') return JSON.parse(JSON.stringify(ROUND));
    if (method === 'POST') throw new Error('network');
    return { entries: [] };
  });
  await dom.call('showQuiz');
  const card = dom.app.querySelectorAll('.quiz-q')[0];
  card.querySelectorAll('button')[1].click();
  await flush(); await flush();
  assert.ok([...card.querySelectorAll('button')].every((b) => !b.disabled));

  const empty = app(t);
  empty.set('api', async () => { throw new Error('no_round'); });
  await empty.call('showQuiz');
  assert.match(text(empty.app), /Diese Woche gibt es noch kein Quiz/);
  assert.equal(empty.app.querySelector('.quiz-q'), null);
});

test('BGG values render verbatim — the same category in German and English', async (t) => {
  for (const locale of ['de', 'en']) {
    const dom = app(t, { locale });
    dom.set('api', async (method, url) => (url === '/api/quiz/current' ? JSON.parse(JSON.stringify(ROUND)) : { entries: [] }));
    await dom.call('showQuiz');
    const labels = [...dom.app.querySelectorAll('.quiz-q')[0].querySelectorAll('.quiz-choice__label')].map(text);
    assert.deepEqual(labels, ['Abstract Strategy', 'Animals', 'Economic', 'Fantasy'], locale);
  }
});

test('the leaderboard lists the friends, marks the reader, and points to the Freundeskreis when alone', async (t) => {
  const dom = app(t);
  dom.set('api', async (method, url) => (url === '/api/quiz/current' ? JSON.parse(JSON.stringify(ROUND))
    : { week: '2026-W41', entries: [{ username: 'ada', score: 4, answered: 5, me: false }, { username: 'me', score: 2, answered: 3, me: true }] }));
  await dom.call('showQuiz');
  await flush();
  const rows = [...dom.app.querySelectorAll('.quiz-board__row')].map(text);
  assert.deepEqual(rows, ['1. ada 4 von 5 richtig', '2. me (du) 2 von 3 richtig']);

  const alone = app(t);
  alone.set('api', async (method, url) => (url === '/api/quiz/current' ? JSON.parse(JSON.stringify(ROUND)) : { entries: [] }));
  await alone.call('showQuiz');
  await flush();
  assert.match(text(alone.app.querySelector('.quiz-board')), /noch niemand gespielt/);
  assert.equal(alone.app.querySelector('.quiz-board__friends').getAttribute('href'), '/freunde');

  // Only the reader has played: their own row, AND the pointer to friends.
  const onlyMe = app(t);
  onlyMe.set('api', async (method, url) => (url === '/api/quiz/current' ? JSON.parse(JSON.stringify(ROUND))
    : { entries: [{ username: 'me', score: 1, answered: 1, me: true }] }));
  await onlyMe.call('showQuiz');
  await flush();
  assert.match(text(onlyMe.app.querySelector('.quiz-board')), /noch niemand gespielt/);
  assert.equal(onlyMe.app.querySelectorAll('.quiz-board__row').length, 1);
});

test('a new round in the inbox: a link to /quiz, no accept or decline, dismissable', async (t) => {
  const dom = app(t);
  const calls = [];
  dom.set('accountApi', async (method, url) => { calls.push([method, url]); return url === '/inbox' ? { items: [] } : {}; });
  const row = dom.call('renderInboxItem', { id: 'i1', type: 'quiz_round', read: false, createdAt: '2026-10-05T00:00:00Z', payload: { week: '2026-W41', questions: 5 } });
  dom.app.appendChild(row);
  assert.match(text(row), /Neues Wochenquiz/);
  assert.equal(row.querySelector('.inbox-row__quiz').getAttribute('href'), '/quiz');
  assert.equal(row.querySelector('.inbox-invite__accept'), null);
  row.querySelector('.inbox-row__del').click();
  await flush();
  assert.deepEqual(calls[0], ['DELETE', '/inbox/i1']);
  assert.equal(row.isConnected, false);
});

test('the home tile states the week in one line, and takes its slot away when there is no round', async (t) => {
  const dom = app(t);
  dom.set('api', async () => ({ ...ROUND, answered: 5, score: 3 }));
  const slot = dom.document.createElement('div');
  slot.className = 'card-slot';
  const tile = dom.document.createElement('section');
  slot.appendChild(tile);
  dom.app.appendChild(slot);
  await dom.call('mountHomeQuiz', tile);
  assert.match(text(tile), /Diese Woche: 3 von 5 richtig/);
  assert.equal(tile.querySelector('a').getAttribute('href'), '/quiz');

  const none = app(t);
  none.set('api', async () => { throw new Error('no_round'); });
  const s2 = none.document.createElement('div');
  s2.className = 'card-slot';
  const t2 = none.document.createElement('section');
  s2.appendChild(t2);
  none.app.appendChild(s2);
  await none.call('mountHomeQuiz', t2);
  assert.equal(s2.isConnected, false, 'an empty tile left its slot behind');
});

const TEASER = { type: 'year', subject: { externalId: '9', name: 'Azul', imageUrl: null }, choices: [2015, 2017, 2019, 2021] };

test('the landing teaser shows a real question — and register or sign in where an answer would go', async (t) => {
  const dom = app(t);
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ question: TEASER }) });
  const went = [];
  dom.set('showRegister', () => went.push('register'));
  dom.set('showLogin', () => went.push('login'));
  const slot = dom.document.createElement('section');
  dom.app.appendChild(slot);
  await dom.call('mountLandingQuiz', slot);
  assert.match(text(slot), /Das Wochenquiz/);
  assert.match(text(slot), /In welchem Jahr erschien „Azul“\?/);
  assert.deepEqual([...slot.querySelectorAll('.quiz-choice')].map(text), ['2015', '2017', '2019', '2021']);
  assert.equal(slot.querySelectorAll('.quiz-q__choices button').length, 0, 'a teaser choice can be pressed');
  slot.querySelector('.quiz-teaser__register').click();
  slot.querySelector('.quiz-teaser__login').click();
  assert.deepEqual(went, ['register', 'login']);

  const off = app(t);
  off.window.fetch = async () => ({ ok: false, json: async () => ({}) });
  const s2 = off.document.createElement('section');
  off.app.appendChild(s2);
  await off.call('mountLandingQuiz', s2);
  assert.equal(s2.isConnected, false, 'no teaser, no block');
});

test('a guest demo gets the teaser on /quiz and on its home tile, and never the scored round', async (t) => {
  const dom = app(t);
  dom.set('isDemoAccount', () => true);
  const asked = [];
  dom.set('api', async (method, url) => { asked.push(url); return JSON.parse(JSON.stringify(ROUND)); });
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ question: TEASER }) });
  const went = [];
  dom.set('leaveDemoForRegister', () => went.push('register'));
  dom.set('leaveDemoForLogin', () => went.push('login'));
  await dom.call('showQuiz');
  assert.equal(asked.length, 0, 'a demo asked for the scored round');
  assert.ok(dom.app.querySelector('.quiz-q--teaser'));
  assert.equal(dom.app.querySelector('.quiz-board'), null);
  dom.app.querySelector('.quiz-teaser__register').click();
  dom.app.querySelector('.quiz-teaser__login').click();
  assert.deepEqual(went, ['register', 'login']);

  const tile = dom.document.createElement('section');
  dom.app.appendChild(tile);
  await dom.call('mountHomeQuiz', tile);
  assert.match(text(tile), /mit einem Konto spielst du mit/);
  assert.equal(asked.length, 0);
});

test('/quiz/archiv: percentages only — the running week with its trickiest question, a closed week with the answer marked in words', async (t) => {
  const dom = app(t);
  dom.set('isLoggedIn', () => false);
  const archive = {
    current: { week: '2026-W41', total: 3, opensNext: '2026-10-11T22:00:00.000Z', correctPct: 62, questions: [
      { type: 'year', subject: { externalId: '1', name: 'Azul' }, correctPct: 75 },
      { type: 'year', subject: { externalId: '3', name: 'Brass' }, correctPct: 20 },
      { type: 'year', subject: { externalId: '4', name: 'Catan' }, correctPct: null },
    ] },
    past: [{ week: '2026-W40', total: 5, correctPct: 50, questions: [{ type: 'year', subject: { externalId: '2', name: 'Root' }, choices: [2014, 2016, 2018, 2021], answer: 2, correctPct: 50, pickPcts: [0, 50, 50, 0] }] }],
  };
  dom.window.fetch = async () => ({ ok: true, json: async () => archive });
  await dom.call('showQuizArchive');
  assert.ok(dom.app.querySelector('.back-row'), 'not a main page: it has a back control');
  const cur = dom.app.querySelector('.quiz-archive__week--current');
  assert.match(text(cur), /KW 41\/2026/);
  assert.match(text(cur), /62 % der Antworten richtig/);
  // The date in the READER's zone, the way the app formats it — CI runs in UTC.
  assert.ok(text(cur).includes(`Neue Runde ab ${dom.call('fmtDate', archive.current.opensNext)}`));
  assert.match(text(cur), /noch keine Antworten/);
  const hardest = cur.querySelectorAll('.quiz-archive__q--hardest');
  assert.equal(hardest.length, 1);
  assert.match(text(hardest[0]), /Brass.*20 % richtig.*kniffligste Frage bisher/);
  assert.doesNotMatch(text(dom.app), /Mitgespielt|Mitspielende/, 'a player count is shown');

  // A tie at the bottom names nobody.
  const tie = app(t);
  tie.set('isLoggedIn', () => false);
  const tied = JSON.parse(JSON.stringify(archive));
  tied.current.questions[0].correctPct = 20;
  tie.window.fetch = async () => ({ ok: true, json: async () => tied });
  await tie.call('showQuizArchive');
  assert.equal(tie.app.querySelectorAll('.quiz-archive__q--hardest').length, 0);
  assert.equal(cur.querySelector('.quiz-archive__choices'), null, 'the running week shows choices');
  const past = dom.app.querySelector('details.quiz-archive__week');
  assert.match(text(past), /KW 40\/2026 50 % der Antworten richtig/);
  const right = past.querySelector('.quiz-archive__choice--right');
  assert.match(text(right), /2018 \(richtige Antwort\) 50 % gewählt/);
  assert.ok(right.querySelector('.ti-check'));

  const none = app(t);
  none.window.fetch = async () => ({ ok: false, json: async () => ({}) });
  await none.call('showQuizArchive');
  assert.match(text(none.app), /keine Quizwochen/);
});

test('the archive is linked from /quiz and from the teaser', async (t) => {
  const dom = app(t);
  dom.set('api', async (method, url) => (url === '/api/quiz/current' ? JSON.parse(JSON.stringify(ROUND)) : { entries: [] }));
  await dom.call('showQuiz');
  assert.equal(dom.app.querySelector('.quiz-archive-link a').getAttribute('href'), '/quiz/archiv');
  const card = dom.call('renderQuizTeaser', TEASER, { onRegister() {}, onLogin() {} });
  assert.equal(card.querySelector('.quiz-archive-link a').getAttribute('href'), '/quiz/archiv');
});

test('a logged-out visitor cold-loading /quiz/archiv gets the page — /quiz itself still asks to log in', async (t) => {
  // Found in a browser: every spec above calls showQuizArchive() directly, so
  // none went near bootApp, and the deep link landed on the login wall.
  for (const [path, want] of [['/quiz/archiv', '/quiz/archiv'], ['/quiz', '/login']]) {
    const dom = loadApp({ locale: 'de' });
    t.after(() => dom.close());
    dom.set('accountsActive', () => true);
    dom.set('isLoggedIn', () => false);
    dom.set('initAccounts', async () => 'ok');
    const routed = [];
    dom.set('routeTo', (p) => { routed.push(p); });
    dom.run(`history.replaceState({}, '', '${path}')`);
    await dom.call('bootApp');
    assert.deepEqual(routed, [want], path);
  }
});

test('a finished week on /quiz says when the next round starts; an unfinished one does not', async (t) => {
  for (const [answered, shown] of [[5, true], [1, false]]) {
    const dom = app(t);
    dom.set('api', async (method, url) => (url === '/api/quiz/current'
      ? { ...JSON.parse(JSON.stringify(ROUND)), answered, score: 2, opensNext: '2026-10-11T22:00:00.000Z' } : { entries: [] }));
    await dom.call('showQuiz');
    const next = dom.app.querySelector('.quiz__next');
    if (shown) assert.ok(text(next).includes(`nächste Runde startet am ${dom.call('fmtDate', '2026-10-11T22:00:00.000Z')}`), text(next));
    else assert.equal(text(next), '', 'an unfinished week announced the next one');
  }
});

test('on a cold load the home tile waits for the config — shown where the quiz runs, gone where it does not', async (t) => {
  for (const [quizOn, kept] of [[true, true], [false, false]]) {
    const dom = app(t);
    dom.run('accountCfg = null');
    dom.set('withAppConfig', (cb) => { dom.run(`accountCfg = { quiz: ${quizOn} }`); cb(dom.run('accountCfg')); });
    dom.set('api', async () => ({ ...ROUND, answered: 0, score: 0 }));
    const dash = dom.call('renderHomeDash');
    dom.app.appendChild(dash);
    const tile = dash.querySelector('#homeQuiz');
    assert.ok(tile, 'no slot was placed while the config was still out');
    await flush(); await flush();
    assert.equal(tile.isConnected, kept, quizOn ? 'the tile was dropped on an instance running the quiz' : 'the tile stayed where the quiz is off');
    if (kept) assert.match(text(tile), /5 neue Fragen/);
  }
});
