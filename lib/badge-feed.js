'use strict';

/*
 * The account-tier Abzeichen in the friends' feed (#1389) — the ONE place an
 * earning leaves its round.
 *
 * Nothing is stored about who holds which tier: the four account entries are
 * derived from lib/user-stats.js's totals on every profile read. So "Mia just
 * reached Sessions 100" cannot be read off a field; it is DETECTED, by computing
 * the affected accounts' badges before and after the finish request mutates the
 * session and diffing the two — the same idempotent shape as `newSince`
 * (public/js/achievements.js), one level up.
 *
 * Four properties are load-bearing:
 *
 *  - Only the accounts the request can move are measured. On the finish
 *    TRANSITION that is every linked seat at the table plus the winners; on a
 *    winner-chip re-POST (the results screen has no save button, and every tap
 *    re-POSTs …/finish — .claude/rules/feed-events-fire-on-the-transition.md) it
 *    is only the seats whose winner status flipped. Siege crosses on exactly
 *    those taps, so gating the whole thing on the transition would mean Siege
 *    never posted at all.
 *
 *  - A tier is announced ONCE per account. The diff alone is not idempotent — a
 *    winner toggled off and on again crosses 10 twice — so before writing, the
 *    account's stored rows are checked for the same key + tier. That read only
 *    happens when a crossing was detected, which is a handful of times in an
 *    account's life, so it costs nothing on the ordinary request.
 *
 *  - The payload is the catalogue key and the tier, and nothing else: no round,
 *    no session, no other person (lib/feed-events.js validates it on write, in
 *    both backends).
 *
 *  - An account that switched its record off for friends (`statsVisible:
 *    false`) posts nothing — "Sessions 100" is a statement about the totals it
 *    chose to hide. A demo account posts nothing either: it can hold no
 *    friendship, and the profile shows it no tiles (lib/routes/profile.js).
 *
 * Jahre never posts: it crosses with the calendar, not with a finish, so a
 * before/after pair taken within one request never differs on it — and
 * announcing it from a timer would need exactly the stored "already announced"
 * state this module exists to avoid. Runden never posts from here either: a seat
 * is gained by joining a round, not by finishing a session.
 *
 * Best-effort throughout, like emitFeedEvent: a failure here must never fail the
 * finish it accompanies, so everything is wrapped and logged.
 */

const repo = require('./repo');
const demo = require('./demo');
const { logger } = require('./observability');
const { emitFeedEvent } = require('./feed');
const { accountStats } = require('./user-stats');
const { feedEventCeiling } = require('./feed-events');

const BADGE_FEED_TYPE = 'badge_earned';

// The linked accounts a finish request can move. `before` is the session as it
// was read before the mutation, `winnerIds` what the request stores.
function affectedAccounts(members, before, winnerIds) {
  const next = new Set(winnerIds || []);
  const moved = new Set();
  if (!before.finished) {
    // The transition: every seat at the table gains a session, and the winners
    // a win. Legacy sessions without `memberIds` count everyone as joined (the
    // memberStats convention).
    const joined = Array.isArray(before.memberIds) ? new Set(before.memberIds) : null;
    (members || []).forEach((m) => { if (!joined || joined.has(m.id) || next.has(m.id)) moved.add(m.id); });
  } else {
    // A re-save of a finished session: only a flipped winner status moves a total.
    const prev = new Set(before.winnerIds || []);
    prev.forEach((id) => { if (!next.has(id)) moved.add(id); });
    next.forEach((id) => { if (!prev.has(id)) moved.add(id); });
  }
  const uids = new Set();
  (members || []).forEach((m) => { if (m.userId && moved.has(m.id)) uids.add(m.userId); });
  return [...uids];
}

// Each account's badges, keyed by uid — skipping the accounts that never post.
async function badgeSnapshot(uids) {
  const out = new Map();
  for (const uid of uids) {
    try {
      const user = await repo.getUserById(uid);
      if (!user || demo.isDemoUser(user) || user.statsVisible === false) continue;
      const st = await accountStats(uid);
      if (st) out.set(uid, st.badges);
    } catch (err) {
      logger.warn({ event: 'badge_feed_snapshot_failed', message: err && err.message });
    }
  }
  return out;
}

// The tiers `after` holds and `before` did not, as { key, tier }. Tiered entries
// only (all four account entries are), and never Jahre — see the header.
function crossedTiers(before, after) {
  const had = new Set();
  (before || []).forEach((e) => (e.history || []).forEach((h) => had.add(`${e.key}:${h.tier}`)));
  const out = [];
  (after || []).forEach((e) => {
    if (e.holder !== 'account' || e.key === 'accountYears') return;
    (e.history || []).forEach((h) => {
      if (Number.isInteger(h.tier) && !had.has(`${e.key}:${h.tier}`)) out.push({ key: e.key, tier: h.tier });
    });
  });
  return out;
}

// Diff a snapshot taken before the mutation against a fresh one, and post each
// newly crossed tier that this account has not already announced.
async function announceBadgeCrossings(before) {
  if (!before || !before.size) return;
  const after = await badgeSnapshot([...before.keys()]);
  for (const [uid, badges] of after) {
    const crossed = crossedTiers(before.get(uid), badges);
    if (!crossed.length) continue;
    try {
      const stored = await repo.listFeedEvents([uid], feedEventCeiling());
      const posted = new Set(stored.filter((e) => e.type === BADGE_FEED_TYPE).map((e) => `${e.title}:${e.tier}`));
      for (const c of crossed) {
        if (posted.has(`${c.key}:${c.tier}`)) continue;
        await emitFeedEvent(uid, { type: BADGE_FEED_TYPE, title: c.key, tier: c.tier });
      }
    } catch (err) {
      logger.warn({ event: 'badge_feed_failed', message: err && err.message });
    }
  }
}

module.exports = { affectedAccounts, badgeSnapshot, crossedTiers, announceBadgeCrossings, BADGE_FEED_TYPE };
