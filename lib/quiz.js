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
// How long rounds and answers are kept — docs/legal/retention.md. At most 8:
// the privacy policy promises deletion after eight weeks, and the published
// text is a ceiling (.claude/rules/keep-legal-docs-current.md), so the setting
// may shorten the period but never lengthen it.
const retentionWeeks = () => num('QUIZ_RETENTION_WEEKS', 8, 1, 8);
// How many past rounds' games a new round may not ask about again — capped at
// the retention, since the purge has already dropped any older round.
const cooldownWeeks = () => Math.min(num('QUIZ_GAME_COOLDOWN_WEEKS', 4, 0, 52), retentionWeeks());

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

// The retention sweep. Runs with the feature OFF too: rows written while it was
// on must still age out after it is switched off (the purgeStoredPrices reason).
async function purgeQuiz({ now = new Date() } = {}) {
  return repo.purgeQuizBefore(weekKey(now.toISOString(), retentionWeeks()));
}

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

/*
 * What a player sees of the round. THE ANSWER KEY OF AN UNANSWERED QUESTION
 * NEVER LEAVES THE SERVER: a question carries its answer only once this account
 * has locked a choice for it, which is what keeps the friends leaderboard
 * honest — the browser cannot read a key it was never sent.
 */
function presentRound(round, submission) {
  const answers = (submission && submission.answers) || [];
  return {
    week: round.week,
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
};
