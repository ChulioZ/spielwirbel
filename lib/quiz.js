'use strict';

/*
 * The weekly community quiz (issue #743) — the round's lifecycle around the
 * pure generator in lib/quiz-generate.js.
 *
 * A WEEK is the ISO week in Berlin time (lib/calendar-periods.js `weekKey`), so a
 * new round opens at Monday 00:00 for the people the app is run for. The round
 * is built ONCE, the first time anything asks for it — the scheduler tick or a
 * visitor, whichever is first — and stored; every later reader gets the stored
 * row, never a regeneration, so a corpus upload mid-week cannot change the
 * questions under someone who has already answered half of them.
 *
 * THE INBOX ITEM NEVER BECOMES A MAIL. lib/notify.js mails only items a named
 * person directs at one specific account, and its daily budget's reserved tail
 * is signup verification — a weekly fan-out to every player is exactly the send
 * that would starve registration. So the item is written here, straight into
 * the inbox, and `quiz_round` is absent from NOTIFIABLE. It goes only to
 * accounts that played a previous round (discovery for everyone else is the
 * home tile and the landing page), and replaces the account's previous one.
 *
 * Nothing here reads tenant data: the questions are about public BGG facts, and
 * the only per-person data is the account's own answers.
 */

const repo = require('./repo');
const accounts = require('./accounts');
const corpusCache = require('./corpus-cache');
const { weekKey, periodBoundaries } = require('./calendar-periods');
const { buildRound, gamesOf } = require('./quiz-generate');
const { logger } = require('./observability');

// Read per call, like every ceiling here, so a live retune needs no restart.
const num = (name, fallback, min, max) => {
  const n = parseInt(process.env[name], 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
// The best-ranked rows the questions are drawn from: recognisability is the
// whole game, and a quiz about rank-4800 obscurities is unplayable.
const poolSize = () => num('QUIZ_POOL_SIZE', 500, 20, 100000);
const perRound = () => num('QUIZ_QUESTIONS_PER_ROUND', 5, 3, 8);
// How long ANSWERS are kept — docs/legal/retention.md. At most 8:
// the privacy policy promises deletion after eight weeks, and the published
// text is a ceiling (.claude/rules/keep-legal-docs-current.md), so the setting
// may shorten the period but never lengthen it.
const retentionWeeks = () => num('QUIZ_RETENTION_WEEKS', 8, 1, 8);
// How long a ROUND is kept, with its anonymous totals: the public archive's
// depth (operator decision on #743: one year). A round holds public BGG facts
// and counts, no personal data, so it may outlive the answers it was counted from.
const ARCHIVE_WEEKS = 52;
// How many past rounds' games a new round may not ask about again.
const cooldownWeeks = () => num('QUIZ_GAME_COOLDOWN_WEEKS', 4, 0, ARCHIVE_WEEKS);

// Opt-in, like PRICES_ENABLED: an instance without a corpus has nothing to ask.
const enabled = () => process.env.QUIZ_ENABLED === 'true';
// …and the quiz is an account feature: scores are kept per account.
const available = () => enabled() && accounts.accountsEnabled();

/*
 * This week's round, generated on first use. Null when the corpus cannot carry
 * a round (empty, or not enriched yet) — every surface then renders nothing.
 */
async function ensureRound(now = new Date()) {
  const week = weekKey(now.toISOString());
  const existing = await repo.getQuizRound(week);
  if (existing) return existing;

  const entries = await corpusCache.corpusEntries({ now: now.getTime() });
  // The games of the last few rounds sit this one out.
  const recent = new Set((await repo.listQuizRounds(cooldownWeeks()))
    .filter((r) => r.week < week)
    .flatMap((r) => (r.questions || []).flatMap(gamesOf)));
  const built = buildRound(entries, {
    // The year in BERLIN, like the week key (.claude/rules/server-computed-calendar-periods.md).
    week, currentYear: Number(periodBoundaries(now.toISOString()).yearKey), recentSubjects: recent, perRound: perRound(), poolSize: poolSize(),
  });
  if (!built) return null;
  const { dumpDate = null } = (await repo.corpusStats()) || {};
  const created = await repo.createQuizRound({
    week, generatedAt: now.toISOString(), dumpDate, questions: built.questions, sample: built.sample,
  });
  // Another process won the week: serve ITS round, which is the stored truth.
  if (created === 'exists') return repo.getQuizRound(week);
  logger.info({ event: 'quiz_round_generated', week, questions: built.questions.length });
  return created;
}

/*
 * The scheduler job: make sure this week's round exists, and — exactly once per
 * round, whichever process claims it — tell the people who have played before.
 */
async function openQuizRound({ now = new Date() } = {}) {
  // Last week's totals first, while its answers are certainly still there.
  await closeQuizRounds({ now });
  const round = await ensureRound(now);
  if (!round) return { week: null, notified: 0 };
  let notified = 0;
  if (await repo.claimQuizAnnouncement(round.week, now.toISOString())) {
    const players = await repo.listQuizPlayers(round.week);
    // A visitor can open the round before this tick announces it; whoever has
    // already answered this week needs no "new round" item for it.
    const started = new Set((await repo.listQuizSubmissions(round.week, players)).map((s) => s.userId));
    let failed = 0;
    for (const uid of players) {
      if (started.has(uid)) continue;
      // One recipient's failure must not cancel everyone after it: the claim
      // above is spent, so no later tick would retry this round's fan-out.
      try {
        const user = await repo.getUserById(uid);
        // A suspended account cannot open the quiz (withTenant refuses it).
        if (!user || user.disabled) continue;
        if (await repo.putQuizRoundItem(uid, { week: round.week, questions: round.questions.length })) notified += 1;
      } catch (err) {
        failed += 1;
        logger.warn({ event: 'quiz_announce_failed', week: round.week, code: err.code || err.name });
      }
    }
    logger.info({ event: 'quiz_round_announced', week: round.week, notified, failed });
  }
  return { week: round.week, notified };
}

// The retention sweep, two horizons: answers after `retentionWeeks()`, rounds
// (with their anonymous totals) after a year. Runs with the feature OFF too:
// rows written while it was on must still age out (the purgeStoredPrices reason).
async function purgeQuiz({ now = new Date() } = {}) {
  const iso = now.toISOString();
  return repo.purgeQuizBefore({ roundsBefore: weekKey(iso, ARCHIVE_WEEKS), submissionsBefore: weekKey(iso, retentionWeeks()) });
}

/*
 * A week's anonymous totals: how many played, the summed score, and per
 * question how many answered, how many were right and how many picked each
 * choice. Counted from the answers alone — the read carries no account ids
 * (repo.listQuizWeekAnswers), and nothing here names anyone.
 */
function tallyRound(round, answerLists) {
  const questions = round.questions.map((q) => ({ answered: 0, correct: 0, picks: q.choices.map(() => 0) }));
  let players = 0;
  let scoreSum = 0;
  for (const answers of answerLists) {
    const given = (answers || []).filter(Boolean);
    if (!given.length) continue;
    players += 1;
    (answers || []).forEach((a, i) => {
      if (!a || !questions[i]) return;
      questions[i].answered += 1;
      if (a.correct) { questions[i].correct += 1; scoreSum += 1; }
      if (Number.isInteger(a.choice) && a.choice >= 0 && a.choice < questions[i].picks.length) questions[i].picks[a.choice] += 1;
    });
  }
  return { players, scoreSum, questions };
}

// Store the totals of every CLOSED week that has none yet — run by the round
// job, so they are taken while the answers still exist (8 weeks) and kept with
// the round for the archive's year.
async function closeQuizRounds({ now = new Date() } = {}) {
  const current = weekKey(now.toISOString());
  let closed = 0;
  for (const r of await repo.listQuizRounds(ARCHIVE_WEEKS + 1)) {
    if (r.week >= current || r.stats) continue;
    if (await repo.setQuizRoundStats(r.week, tallyRound(r, await repo.listQuizWeekAnswers(r.week)))) closed += 1;
  }
  return closed;
}

/*
 * The public statistics and archive (operator decision on #743). PERCENTAGES
 * ONLY — never how many played, and no absolute count a player number could be
 * read off (answers per question, picks per choice): the stored totals are
 * counts, what leaves this function is shares of them. For the RUNNING week only
 * the share right overall and per question, plus when the next round opens —
 * never the choices, the answer or how the picks split, which would give the key
 * away while the round can still be played. For every closed week of the last
 * year, the questions with their answers and each choice's share of the picks.
 * No names anywhere. Memoised per process for a few minutes: the page is public.
 */
const ARCHIVE_TTL_MS = 5 * 60 * 1000;
const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : null);
const sumOf = (t, key) => t.questions.reduce((a, q) => a + q[key], 0);
let archiveMemo = null;
async function archive(now = new Date()) {
  const week = weekKey(now.toISOString());
  if (archiveMemo && archiveMemo.week === week && now.getTime() - archiveMemo.at < ARCHIVE_TTL_MS) return archiveMemo.value;
  const rounds = await repo.listQuizRounds(ARCHIVE_WEEKS + 1);
  const cur = rounds.find((r) => r.week === week);
  let current = null;
  if (cur) {
    const t = tallyRound(cur, await repo.listQuizWeekAnswers(week));
    current = {
      week,
      total: cur.questions.length,
      opensNext: nextRoundAt(now),
      correctPct: pct(sumOf(t, 'correct'), sumOf(t, 'answered')),
      questions: cur.questions.map((q, i) => ({
        type: q.type, subject: q.subject, correctPct: pct(t.questions[i].correct, t.questions[i].answered),
      })),
    };
  }
  const past = [];
  for (const r of rounds) {
    if (r.week >= week) continue;
    // A week the job has not closed yet is counted live — its answers exist.
    const t = r.stats || tallyRound(r, await repo.listQuizWeekAnswers(r.week));
    past.push({
      week: r.week,
      dumpDate: r.dumpDate || null,
      total: r.questions.length,
      correctPct: pct(sumOf(t, 'correct'), sumOf(t, 'answered')),
      questions: r.questions.map((q, i) => ({
        type: q.type,
        subject: q.subject,
        choices: q.choices,
        answer: q.answer,
        correctPct: pct(t.questions[i].correct, t.questions[i].answered),
        pickPcts: t.questions[i].picks.map((n) => pct(n, t.questions[i].answered)),
      })),
    });
  }
  const value = { current, past };
  archiveMemo = { week, at: now.getTime(), value };
  return value;
}
const resetArchiveMemo = () => { archiveMemo = null; };

/*
 * The teaser question for the logged-out landing page and a guest demo (shown
 * without a way to answer). Memoised per process for
 * the week once it exists (a round never changes), and briefly while there is
 * none, so an instance whose corpus arrives mid-week starts serving it soon.
 */
const EMPTY_TTL_MS = 10 * 60 * 1000;
let sampleMemo = null;
async function sampleQuestion(now = new Date()) {
  const week = weekKey(now.toISOString());
  if (sampleMemo && sampleMemo.week === week
    && (sampleMemo.question || now.getTime() - sampleMemo.at < EMPTY_TTL_MS)) return sampleMemo.question;
  const round = await ensureRound(now);
  const question = round && round.sample ? round.sample : null;
  sampleMemo = { week, at: now.getTime(), question };
  return question;
}
const resetSampleMemo = () => { sampleMemo = null; };

// When the next round opens: the coming Monday 00:00 in Berlin. Taken a week
// past this week's start and re-anchored on the calendar, so a DST switch in
// between cannot shift it by an hour.
function nextRoundAt(now = new Date()) {
  const start = new Date(periodBoundaries(now.toISOString()).week);
  return periodBoundaries(new Date(start.getTime() + 8 * 86400000).toISOString()).week;
}

/*
 * What a player sees of the round. THE ANSWER KEY OF AN UNANSWERED QUESTION
 * NEVER LEAVES THE SERVER: a question carries its answer only once this account
 * has locked a choice for it, which is what keeps the friends leaderboard
 * honest — the browser cannot read a key it was never sent.
 */
function presentRound(round, submission, now = new Date()) {
  const answers = (submission && submission.answers) || [];
  return {
    week: round.week,
    opensNext: nextRoundAt(now),
    dumpDate: round.dumpDate || null,
    total: round.questions.length,
    answered: answers.filter(Boolean).length,
    score: (submission && submission.score) || 0,
    questions: round.questions.map((q, i) => {
      const out = { type: q.type, subject: q.subject, choices: q.choices };
      const a = answers[i];
      if (a) out.result = { choice: a.choice, correct: a.correct, answer: q.answer };
      return out;
    }),
  };
}

module.exports = {
  enabled, available, ensureRound, openQuizRound, purgeQuiz, sampleQuestion, resetSampleMemo, presentRound,
  tallyRound, closeQuizRounds, archive, resetArchiveMemo, nextRoundAt, ARCHIVE_WEEKS,
};
