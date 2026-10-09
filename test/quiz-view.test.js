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
