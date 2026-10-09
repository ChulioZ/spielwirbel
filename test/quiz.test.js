'use strict';

/*
 * The weekly quiz (issue #743): the routes, the round's lifecycle and the jobs.
 *
 * The generator's fairness is test/quiz-generate.test.js; this file pins what
 * the server does with a round — that the answer key of an unanswered question
 * never reaches the browser, that an answer is final, that a week is generated
 * once, that opening a round mails nobody, and that the leaderboard is friends
 * only. The corpus is seeded through the repo, the way an upload would.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, store } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');
const { runJob } = require('../lib/scheduler');
const quiz = require('../lib/quiz');
const corpusCache = require('../lib/corpus-cache');
const { weekKey } = require('../lib/calendar-periods');

const PASSWORD = 'correct horse battery';
const handle = (email) => email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '-');
const auth = (token) => ({ Authorization: `Bearer ${token}` });
let n = 0;
async function account(tag) {
  const email = `qz-${tag}-${(n += 1)}@example.com`;
  await request(app).post('/api/account/register').send({ email, username: handle(email), password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}
async function befriend(a, b) {
  const f = await repo.createFriendRequest({ requesterUserId: a.user.id, addresseeUserId: b.user.id });
  await repo.acceptFriendRequest(f.id, b.user.id);
}

const CATS = ['Abstract Strategy', 'Animals', 'Card Game', 'Economic', 'Fantasy', 'Medieval'];
async function seedCorpus(count = 60) {
  const entries = Array.from({ length: count }, (_, i) => ({
    externalId: String(5000 + i), name: `Spiel ${i}`, year: 1995 + (i % 25), rank: i + 1,
    rating: 7, bayesRating: 7, usersRated: 5000,
  }));
  await repo.replaceCorpus(entries, { dumpDate: '2026-10-01', uploadedAt: '2026-10-02T10:00:00Z' });
  await repo.updateCorpusEntries(entries.map((e, i) => ({
    externalId: e.externalId,
    enrichedAt: '2026-10-02T11:00:00Z',
    info: {
      imageUrl: null, weight: 1.3 + ((i * 0.41) % 3.4), numWeights: 400,
      minPlayers: 1 + (i % 3), maxPlayers: 3 + (i % 4), minPlaytime: 20, maxPlaytime: [25, 40, 60, 75, 100, 150][i % 6],
      categories: [CATS[i % 6], CATS[(i + 2) % 6]], mechanics: [`Mechanic ${i % 7}`], designers: [`Designer ${i % 9}`],
    },
  })));
  corpusCache.invalidate();
}

const clearQuiz = () => {
  store.data.quizRounds.length = 0;
  store.data.quizSubmissions.length = 0;
  store.data.inbox.length = 0;
};

beforeEach(() => {
  process.env.QUIZ_ENABLED = 'true';
  clearQuiz();
  quiz.resetSampleMemo();
});
afterEach(() => {
  delete process.env.QUIZ_ENABLED;
});

test('switched off: every surface 404s, the config says so, and the job reads nothing', async () => {
  delete process.env.QUIZ_ENABLED;
  await seedCorpus();
  const a = await account('off');
  assert.equal((await request(app).get('/api/quiz/sample')).status, 404);
  assert.equal((await request(app).get('/api/quiz/current').set(auth(a.token))).status, 404);
  assert.equal((await request(app).get('/api/config')).body.quiz, false);
  const read = repo.listCorpusEntries;
  let reads = 0;
  repo.listCorpusEntries = async () => { reads += 1; return read(); };
  corpusCache.invalidate();
  try {
    assert.equal(await runJob('openQuizRound'), null, 'the job is disabled');
  } finally {
    repo.listCorpusEntries = read;
  }
  assert.equal(reads, 0, 'the corpus was read for a quiz that is off');
  assert.equal(store.data.quizRounds.length, 0);
});

test('switched on with an empty corpus: no round, and nothing renders', async () => {
  await repo.replaceCorpus([], { dumpDate: null, uploadedAt: null });
  corpusCache.invalidate();
  const a = await account('empty');
  assert.equal((await request(app).get('/api/config')).body.quiz, true);
  assert.equal((await request(app).get('/api/quiz/sample')).status, 404);
  const cur = await request(app).get('/api/quiz/current').set(auth(a.token));
  assert.equal(cur.status, 404);
  assert.equal(cur.body.error, 'no_round');
  assert.deepEqual(await runJob('openQuizRound'), { week: null, notified: 0 });
  assert.equal(store.data.quizRounds.length, 0, 'a zero-question round was stored');
});

test('the round carries no answer key until a question is answered, and an answer is final', async () => {
  await seedCorpus();
  const a = await account('play');
  const cur = await request(app).get('/api/quiz/current').set(auth(a.token));
  assert.equal(cur.status, 200);
  assert.equal(cur.body.week, weekKey());
  assert.equal(cur.body.total, 5);
  assert.equal(cur.body.answered, 0);
  assert.ok(!JSON.stringify(cur.body).includes('"answer"'), 'an answer key reached the browser before any answer');

  const stored = store.data.quizRounds[0].questions;
  const right = await request(app).post('/api/quiz/current/answers').set(auth(a.token))
    .send({ week: cur.body.week, index: 0, choice: stored[0].answer });
  assert.equal(right.status, 200);
  assert.deepEqual(right.body, { correct: true, answer: stored[0].answer, score: 1, answered: 1, total: 5 });

  const wrongChoice = (stored[1].answer + 1) % stored[1].choices.length;
  const wrong = await request(app).post('/api/quiz/current/answers').set(auth(a.token))
    .send({ week: cur.body.week, index: 1, choice: wrongChoice });
  assert.equal(wrong.body.correct, false);
  assert.equal(wrong.body.answer, stored[1].answer);
  assert.equal(wrong.body.score, 1);

  // Changing a revealed answer is refused — the reply already showed the key.
  const again = await request(app).post('/api/quiz/current/answers').set(auth(a.token))
    .send({ week: cur.body.week, index: 1, choice: stored[1].answer });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_answered');

  const after = await request(app).get('/api/quiz/current').set(auth(a.token));
  assert.deepEqual(after.body.questions[0].result, { choice: stored[0].answer, correct: true, answer: stored[0].answer });
  assert.equal(after.body.questions[1].result.correct, false);
  for (const q of after.body.questions.slice(2)) assert.equal(q.result, undefined, 'an unanswered question carries its key');
  assert.equal(after.body.score, 1);
});

test('answers for another week, a missing question or an absent choice are refused', async () => {
  await seedCorpus();
  const a = await account('bad');
  const week = (await request(app).get('/api/quiz/current').set(auth(a.token))).body.week;
  const post = (body) => request(app).post('/api/quiz/current/answers').set(auth(a.token)).send(body);
  assert.equal((await post({ week: '2001-W01', index: 0, choice: 0 })).body.error, 'round_closed');
  assert.equal((await post({ week, index: 7, choice: 0 })).status, 400);
  assert.equal((await post({ week, index: 0, choice: 4 })).status, 400);
  assert.equal((await request(app).post('/api/quiz/current/answers').send({ week, index: 0, choice: 0 })).status, 401);
});

test('a week is generated once — twice in a row, or three times at once', async () => {
  await seedCorpus();
  const [x, y, z] = await Promise.all([quiz.ensureRound(), quiz.ensureRound(), quiz.ensureRound()]);
  assert.equal(store.data.quizRounds.length, 1);
  assert.deepEqual(x.questions, y.questions);
  assert.deepEqual(y.questions, z.questions);
  await runJob('openQuizRound');
  await runJob('openQuizRound');
  assert.equal(store.data.quizRounds.length, 1);
  assert.deepEqual(store.data.quizRounds[0].questions, x.questions);
});

test('the public sample is unscored, carries its answer, and is none of the scored questions', async () => {
  await seedCorpus();
  const res = await request(app).get('/api/quiz/sample');
  assert.equal(res.status, 200);
  const q = res.body.question;
  assert.equal(typeof q.answer, 'number');
  const round = store.data.quizRounds[0];
  const gamesOf = (x) => (x.type === 'duel' ? x.choices.map((c) => c.externalId) : [x.subject.externalId]);
  const scored = new Set(round.questions.flatMap(gamesOf));
  for (const id of gamesOf(q)) assert.ok(!scored.has(id), `the public sample uses scored game ${id}`);
});

test('opening a round tells past players — once, in the inbox, and never by mail', async () => {
  await seedCorpus();
  const player = await account('player');
  const newcomer = await account('newcomer');
  // Last week's round, played by one account.
  const lastWeek = new Date(Date.now() - 7 * 86400000);
  await quiz.ensureRound(lastWeek);
  await repo.recordQuizAnswer(player.user.id, weekKey(lastWeek.toISOString()), 0, 5, { choice: 0, correct: false });
  // A suspended past player is skipped: withTenant refuses it the quiz anyway.
  const suspended = await account('suspended');
  await repo.recordQuizAnswer(suspended.user.id, weekKey(lastWeek.toISOString()), 0, 5, { choice: 0, correct: false });
  store.data.users.find((u) => u.id === suspended.user.id).disabled = true;

  const mails = outbox.length;
  assert.deepEqual(await runJob('openQuizRound'), { week: weekKey(), notified: 1 });
  assert.deepEqual(await runJob('openQuizRound'), { week: weekKey(), notified: 0 }, 'the round was announced twice');
  assert.equal(outbox.length, mails, 'opening a round sent mail');

  const items = (uid) => store.data.inbox.filter((it) => it.userId === uid && it.type === 'quiz_round');
  assert.equal(items(player.user.id).length, 1, 'the past player got exactly one item');
  assert.equal(items(newcomer.user.id).length, 0, 'an account that never played got an item');
  assert.equal(items(suspended.user.id).length, 0, 'a suspended account got an item');
  assert.equal(items(player.user.id)[0].payload.week, weekKey());

  // Next week's round replaces the item rather than stacking a second one.
  const nextWeek = new Date(Date.now() + 7 * 86400000);
  await quiz.openQuizRound({ now: nextWeek });
  assert.equal(items(player.user.id).length, 1);
  assert.equal(items(player.user.id)[0].payload.week, weekKey(nextWeek.toISOString()));
});

test('the leaderboard is the caller and confirmed friends — nobody else, no demo account', async () => {
  await seedCorpus();
  const me = await account('me');
  const friend = await account('friend');
  const pending = await account('pending');
  const stranger = await account('stranger');
  await befriend(me, friend);
  await repo.createFriendRequest({ requesterUserId: me.user.id, addresseeUserId: pending.user.id });
  const demo = await repo.createUser({ email: 'demo@example.com', username: 'demo-quizzer', tenantId: 'demo-abc', emailVerified: true });
  const f = await repo.createFriendRequest({ requesterUserId: me.user.id, addresseeUserId: demo.id });
  await repo.acceptFriendRequest(f.id, demo.id);

  const round = await quiz.ensureRound();
  for (const [who, score] of [[friend.user.id, 3], [pending.user.id, 5], [stranger.user.id, 5], [demo.id, 5], [me.user.id, 2]]) {
    for (let i = 0; i < score; i += 1) {
      await repo.recordQuizAnswer(who, round.week, i, round.questions.length, { choice: round.questions[i].answer, correct: true });
    }
  }
  const res = await request(app).get('/api/quiz/leaderboard').set(auth(me.token));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.entries.map((e) => [e.username, e.score, e.me]), [
    [friend.user.username, 3, false],
    [me.user.username, 2, true],
  ]);
});

test('the retention sweep drops old weeks — with the quiz switched off', async () => {
  await seedCorpus();
  const old = new Date(Date.now() - 10 * 7 * 86400000);
  await quiz.ensureRound(old);
  await quiz.ensureRound();
  const a = await account('old');
  await repo.recordQuizAnswer(a.user.id, weekKey(old.toISOString()), 0, 5, { choice: 0, correct: true });
  delete process.env.QUIZ_ENABLED;
  const removed = await runJob('purgeQuiz');
  assert.deepEqual(removed, { rounds: 1, submissions: 1 });
  assert.deepEqual(store.data.quizRounds.map((r) => r.week), [weekKey()]);
});
