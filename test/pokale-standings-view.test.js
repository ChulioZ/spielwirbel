'use strict';

/* The Ruhmeshalle ranks on the RAW WIN COUNT — asserted by rendering the two
 * screens rather than by matching their source
 * (`.claude/rules/testing-views-under-jsdom.md`).
 *
 * It ranked on the Siegwertung from #895 until 2026-09-22, when that measure was
 * withdrawn from the whole app (operator): fair, and disqualified by being both
 * hard to explain and — because it is zero-sum over each night — negative for
 * everyone but the leader in most rounds.
 *
 * THE FIXTURE IS THE ONE #895 WAS WRITTEN AGAINST, kept deliberately, because
 * the trade-off it measures is now the ACCEPTED behaviour rather than the bug.
 * Dan logs five solo plays and wins one of four group nights, so his count is 6
 * against Anna's 2 and he tops the stage having won one contest to her two.
 *
 *   Anna  2 wins      Ben 1 win      Dan 1 win + 5 solo = 6      Clara 0 wins
 *
 * That was offered as a choice — count only CONTESTED wins, which removes it
 * with no weighting and nothing to explain — and declined, because it makes
 * „Siege" two different numbers on two screens (operator, 2026-09-22). So the
 * case below asserts the distortion AS THE INTENDED ORDER; if it ever goes red,
 * somebody has quietly added a contest filter and that is a decision to make
 * out loud, not a fix.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const RID = 'r1';
const MEMBERS = ['dan', 'anna', 'ben', 'clara'];

let seq = 0;
const night = (winnerIds, memberIds, extra = {}) => ({
  id: `s${++seq}`,
  // Chronological, so the solo block below really is the LATEST run of nights —
  // which is what a streak walks backwards through.
  createdAt: `2026-07-${String(seq).padStart(2, '0')}T20:00:00.000Z`,
  gameIds: ['g1'],
  memberIds,
  guests: [],
  votes: {},
  votedIds: [],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds,
  chosenGameId: 'g1',
  events: [],
  ...extra,
});

// Group nights first, then Dan's solo block. The last group night is Dan's, so
// WITHOUT the solo filter the streak card would read six nights in a row; with
// it, the walk stops at one and no card is rendered.
const group = [
  night(['anna'], MEMBERS),
  night(['ben'], MEMBERS),
  night(['anna'], MEMBERS),
  night(['dan'], MEMBERS),
];
const solos = Array.from({ length: 5 }, () => night(['dan'], ['dan']));

const roundWith = (sessions, members = MEMBERS) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: members.map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) })),
  games: [{ id: 'g1', title: 'Catan', tagIds: [] }],
  sessions,
});

function boot(t, round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

const pokale = async (t, round) => {
  const dom = boot(t, round);
  await dom.call('renderPokaleTab', round);
  return dom;
};

const onStage = (dom) => [...dom.app.querySelectorAll('.podium__entry')].map((e) => e.dataset.mid);
const inRest = (dom) => [...dom.app.querySelectorAll('.podium__rest-name')].map((e) => e.dataset.mid);

// ---- the defect ------------------------------------------------------------

const rankOfOnStage = (dom, mid) => {
  const col = [...dom.app.querySelectorAll('.podium__col')].find((c) =>
    [...c.querySelectorAll('.podium__entry')].some((e) => e.dataset.mid === mid)
  );
  return col ? Number(col.className.match(/podium__col--(\d)/)[1]) : null;
};

test('the podium fills its three steps rather than leaving them empty', async (t) => {
  /* #913's invariant, restated for a win count: no step is ever left EMPTY by a
     rule the reader cannot see. It was reported from live family use — one
     member alone on rank 1 with ranks 2 and 3 empty, everyone else named below
     with no visible reason — and the cause was a threshold on a number nobody
     could see. Ranking on wins, the steps fill from the top with whoever has
     won, and the only reason to be under the stage is having won nothing or
     being fourth. Both explain themselves. */
  const three = ['anna', 'dan', 'clara'];
  const nights = [night(['anna'], three), night(['anna'], three), night(['dan'], three)];
  const dom = await pokale(t, roundWith(nights, three));

  const cols = [...dom.app.querySelectorAll('.podium__col')];
  assert.equal(cols.filter((c) => c.classList.contains('podium__col--spacer')).length, 0,
    'every step is claimed — no member may be kept off the stage by their score');
  assert.equal(rankOfOnStage(dom, 'anna'), 1);
  assert.equal(rankOfOnStage(dom, 'dan'), 2);
  assert.equal(rankOfOnStage(dom, 'clara'), 3, 'winless, and standing on „0 Siege"');
  assert.match(dom.app.textContent, /0 Siege/, 'her count is shown rather than her being hidden');
  assert.equal(dom.app.querySelector('.podium__rest'), null, 'nobody is left below a stage with room');
});

test('an empty step is only ever a TIE consuming the place, never a filter', async (t) => {
  /* The one case that leaves a step unclaimed, and it is honest: two members tie
     for 1st, so by competition ranking (1224) there IS no second place and the
     next member is third. That is #836/#889's painted riser saying „nobody
     stands below the shared step" — a true statement about the ranking rather
     than a hidden rule about a score. */
  const tie = [night(['anna'], MEMBERS), night(['anna'], MEMBERS),
    night(['ben'], MEMBERS), night(['ben'], MEMBERS), night(['dan'], MEMBERS)];
  const dom = await pokale(t, roundWith(tie));
  assert.equal(rankOfOnStage(dom, 'anna'), 1);
  assert.equal(rankOfOnStage(dom, 'ben'), 1);
  assert.ok(dom.app.querySelector('.podium__col--2.podium__col--spacer'), 'the tie consumed rank 2');
  assert.equal(rankOfOnStage(dom, 'dan'), 3, 'and the next member is genuinely third');
});

test('six wins DO outrank two when five of them were solo — the accepted trade-off', async (t) => {
  /* #895's defect, now the intended behaviour (operator, 2026-09-22). Dan holds
     six wins to Anna's two and tops the stage, having won ONE contest to her two.

     Asserted rather than deleted, and asserted in the direction that hurts,
     because this is the shape somebody will one day read as a bug and "fix"
     with a contest filter. It is a decision — see roundStandings' comment in
     views-pokale.js — so if this goes red the filter came back, and that needs
     saying out loud rather than merging. The alternative was offered and
     declined: counting only contested wins removes the distortion with no
     weighting and nothing to explain, at the cost of „Siege" meaning two
     different numbers on two screens. */
  const dom = await pokale(t, roundWith([...group, ...solos]));
  assert.equal(rankOfOnStage(dom, 'dan'), 1, 'six wins take the crown, five of them solo');
  assert.equal(rankOfOnStage(dom, 'anna'), 2, 'two contested wins in four do not');
});

test('a solo night DOES move the standings — the same trade-off from the other side', async (t) => {
  // The mirror of the case above: the solo block is what changes the order, so
  // removing it must change it back. Without the five solo nights Dan is second
  // on one win and Anna leads on two.
  const withSolos = await pokale(t, roundWith([...group, ...solos]));
  const without = await pokale(t, roundWith(group));
  assert.equal(rankOfOnStage(withSolos, 'dan'), 1);
  assert.equal(rankOfOnStage(without, 'anna'), 1, 'without them Anna leads again');
  assert.equal(rankOfOnStage(without, 'dan'), 2);
});

// ---- the balanced round keeps its stage -------------------------------------

test('an evenly matched round still has a podium — everyone shares the top step', async (t) => {
  /* A round whose wins are perfectly even puts every member on the same count,
     so they share one step. The two-person case is the one that matters: a
     couple who win half each must still see a podium, at any number of nights.
     Under the Siegwertung this was the case that emptied the stage outright,
     because every member sat at exactly 0,0 and the filter was „above chance". */
  const even = [night(['anna'], MEMBERS), night(['ben'], MEMBERS), night(['dan'], MEMBERS), night(['clara'], MEMBERS)];
  const dom = await pokale(t, roundWith(even));
  assert.deepEqual(onStage(dom).sort(), ['anna', 'ben', 'clara', 'dan'], 'all four hold one win and are tied');
  assert.ok(dom.app.querySelector('.podium--single'), 'one distinct place occupied is the shared top step (#879)');
  assert.match(dom.app.querySelector('.podium__wins').textContent, /1 Sieg\b/);
});

test('two evenly matched members still have a podium', async (t) => {
  // The sharpest case: a couple, six nights, three wins each.
  const pair = Array.from({ length: 6 }, (_, i) => night([i % 2 ? 'anna' : 'dan'], ['dan', 'anna']));
  const dom = await pokale(t, roundWith(pair, ['dan', 'anna']));
  assert.deepEqual(onStage(dom).sort(), ['anna', 'dan']);
});

test('a tie behind a lone leader never shares the crown', async (t) => {
  /* Ben and Clara tie on one win behind Anna's two, so they hold rank 2 together
     while she keeps rank 1 alone — the stage must not promote a tied pair onto
     the crowned step. */
  const nights = [night(['anna'], MEMBERS), night(['anna'], MEMBERS),
    night(['ben'], MEMBERS), night(['clara'], MEMBERS)];
  const dom = await pokale(t, roundWith(nights));
  assert.equal(dom.app.querySelector('.podium--single'), null, 'a lone leader is not the shared-step stage');
  assert.equal(rankOfOnStage(dom, 'ben'), 2);
  assert.equal(rankOfOnStage(dom, 'clara'), 2);
  const crown = [...dom.app.querySelectorAll('.podium__col')].find((c) => c.querySelector('.ti-crown'));
  assert.deepEqual([...crown.querySelectorAll('.podium__entry')].map((e) => e.dataset.mid), ['anna']);
});

test('a member who has never played does not stand at zero', async (t) => {
  /* The other half of the filter. Someone who took part in no decided night has
     won nothing and lost nothing; without the record guard they would stand at
     zero having never turned up, above everyone who played and lost. */
  const dom = await pokale(t, roundWith(group, [...MEMBERS, 'never']));
  assert.ok(!onStage(dom).includes('never'));
  assert.ok(inRest(dom).includes('never'));
});

// ---- what the stage prints --------------------------------------------------

test('an entry carries its own win count, and the same text upright or sideways', async (t) => {
  /* ONE number per entry since 2026-09-22. It carried the Siegwertung plus the
     raw count, with `.podium__col--multi` hiding the count on a shared step
     because two numbers do not fit a 108px phone pedestal — so the upright and
     sideways presentations said different things. With one number they cannot,
     and that is the property worth pinning: an entry on a shared step must read
     exactly as it would alone. */
  const dom = await pokale(t, roundWith([...group, ...solos]));
  const crown = [...dom.app.querySelectorAll('.podium__col')].find((c) => c.querySelector('.ti-crown'));
  const wins = crown.querySelector('.podium__entry .podium__wins');
  assert.match(wins.textContent, /6 Siege/, "Dan's count, the figure the step is ranked on");
  assert.match(wins.getAttribute('title'), /6 Siege/);
  assert.equal(wins.querySelector('.podium__score'), null, 'the Siegwertung span is gone');
  assert.equal(wins.querySelector('.podium__winsraw'), null, 'and so is the count it used to sit beside');

  // A SHARED step, where the entries lie sideways: same text, no second number
  // that CSS has to hide.
  // A third, winnerless night keeps the round at the podium threshold
  // (YOUNG_ROUND_PODIUM_FROM, every design since #1318) without breaking the tie.
  const tie = [night(['anna'], MEMBERS), night(['ben'], MEMBERS), night([], MEMBERS)];
  const two = await pokale(t, roundWith(tie));
  const top = [...two.app.querySelectorAll('.podium__col--1 .podium__entry .podium__wins')];
  assert.equal(top.length, 2, 'fixture does not produce a shared TOP step');
  for (const el of top) assert.match(el.textContent, /1 Sieg\b/);
});

test('the rest line states the count it is ordered by', async (t) => {
  const many = [...group, ...solos, night(['anna'], MEMBERS), night(['ben'], MEMBERS)];
  const dom = await pokale(t, roundWith(many, [...MEMBERS, 'ida']));
  const rest = dom.app.querySelector('.podium__rest');
  assert.ok(rest, 'a fifth member has to land below a three-step stage');
  assert.match(rest.textContent, /Siege|Sieg\b/, 'the rest line states the win count');
  assert.equal(rest.querySelector('.podium__score'), null, 'and no longer a Siegwertung beside it');
});

test('the standings need NO ⓘ — a win count explains itself', async (t) => {
  /* The ⓘ existed because the Siegwertung owed an explanation: it was a number
     the group had not seen before, and `win.infoBody` was a paragraph. A count
     of wins needs none, and the whole `win` topic went with the measure.

     Asserted as an absence so that reintroducing an explainer here is a
     deliberate act — if a future measure owes one, it owes a rule file too. */
  const dom = await pokale(t, roundWith(group));
  const info = dom.app.querySelector('.section-head [data-info-topic]');
  assert.equal(info, null, 'the standings grew an explainer for a plain win count');
});

// ---- the Siegesserie --------------------------------------------------------

test('a run of solo nights is not a winning streak', async (t) => {
  const dom = await pokale(t, roundWith([...group, ...solos]));
  const labels = [...dom.app.querySelectorAll('.pokale-card__label')].map((e) => e.textContent);
  assert.ok(!labels.includes(dom.run("t('pokale.streak')")), 'five solo nights are not a five-night streak');
});

test('the solo filter did not disturb the real streak, or the guest one', async (t) => {
  // Three genuine group nights in a row, won by Anna, with a solo block before
  // them — the streak must survive the filter rather than be swallowed by it.
  const sessions = [...solos, night(['anna'], MEMBERS), night(['anna'], MEMBERS), night(['anna'], MEMBERS)];
  const dom = await pokale(t, roundWith(sessions));
  const labels = [...dom.app.querySelectorAll('.pokale-card__label')].map((e) => e.textContent);
  assert.ok(labels.includes(dom.run("t('pokale.streak')")), 'three group wins in a row is a streak');

  // #458: a night a guest won still ends a member's streak rather than extending it.
  const g = { id: 'gu1', name: 'Vera' };
  const withGuest = await pokale(
    t,
    roundWith([...sessions, night([g.id], [...MEMBERS], { guests: [g] })])
  );
  const still = [...withGuest.app.querySelectorAll('.pokale-card__label')].map((e) => e.textContent);
  assert.ok(still.includes(withGuest.run("t('pokale.streak')")), 'a guest win is skipped, not counted');
});

test('a guest is never in the standings, however much they win', async (t) => {
  const g = { id: 'gu1', name: 'Vera' };
  const sessions = [...group, night([g.id], MEMBERS, { guests: [g] }), night([g.id], MEMBERS, { guests: [g] })];
  const dom = await pokale(t, roundWith(sessions));
  assert.ok(!onStage(dom).includes('gu1'));
  assert.ok(!inRest(dom).includes('gu1'));
});

// ---- the member page --------------------------------------------------------

test('the member page rates Dan on contested nights only', async (t) => {
  const round = roundWith([...group, ...solos]);
  const dom = boot(t, round);
  await dom.call('showMember', RID, 'dan');
  /* ONE shape since #1074: the figures were split across a hero band
     (#995's `.member-head__stat`) and `.pokale-card`s under a „Statistiken"
     heading, and die Tischkarte put them in one strip. The two-shape read this
     replaced existed because reading only the cards would have made the two
     relocated assertions VANISH rather than fail — which is the silence a
     relocation hides behind, and the reason the count assertion below is here. */
  const pairs = [...dom.app.querySelectorAll('.member-figure')].map((c) => [
    c.querySelector('.member-figure__label').textContent,
    c.querySelector('.member-figure__value').textContent,
  ]);
  assert.equal(pairs.length, 4, 'the figure strip lost a figure, so a valueOf() below reads undefined');
  const valueOf = (key) => (pairs.find(([l]) => l === dom.run(`t('${key}')`)) || [])[1];

  // Six wins over nine finished nights would read 67 %; over the four CONTESTED
  // nights it is one win in four. A rate that counts solo plays is the naive
  // fix and is worse than the count it replaces — it reads 100 % for a pure
  // solo logger.
  assert.equal(valueOf('member.winRate'), '25%');
  assert.equal(valueOf('member.wins'), '6', 'the raw count is a factual record and is unchanged');
  // The Siegwertung figure that stood here was withdrawn on 2026-09-22 with the
  // measure; the strip is wins / rate / sessions / average rating.
  assert.equal(valueOf('member.winScore'), undefined, 'the Siegwertung figure is gone');
  // …and each figure appears exactly ONCE. #995 relocated two of them and #1074
  // merged the shapes; both were relocations rather than copies, so a number
  // stated twice on one screen is the regression either would hide behind.
  ['member.wins', 'member.winRate'].forEach((key) => {
    const label = dom.run(`t('${key}')`);
    assert.equal(pairs.filter(([l]) => l === label).length, 1, `${key} is stated twice`);
  });
});

// ---- how a winnerless night ended (#1038) -----------------------------------

test('a „Kein Sieger" night between two wins does not break a streak; „Verloren" does', async (t) => {
  // Three nights Anna won, with one winnerless night in the middle. What that
  // night RECORDS decides whether the run survives: a game that is not about
  // winning was never a contest, so it is skipped like a solo night — while a
  // night the table played to win and lost breaks the run exactly as somebody
  // else's win does.
  const run = (middle) => [
    night(['anna'], MEMBERS),
    night([], MEMBERS, middle),
    night(['anna'], MEMBERS),
    night(['anna'], MEMBERS),
  ];
  // The LENGTH, not the card's presence: a broken run of two still renders a
  // card, so asserting `includes(streak)` would be green for every case here.
  const streakOf = async (middle) => {
    const dom = await pokale(t, roundWith(run(middle)));
    const card = [...dom.app.querySelectorAll('.pokale-card')].find(
      (c) => c.querySelector('.pokale-card__label').textContent === dom.run("t('pokale.streak')")
    );
    return card ? card.querySelector('.pokale-card__sub').textContent : null;
  };
  assert.equal(await streakOf({ ending: 'noWinner' }), '3 Siege in Folge', 'not a contest — skipped');
  assert.equal(await streakOf({ ending: 'ongoing' }), '3 Siege in Folge', 'nor is a campaign chapter');
  assert.equal(await streakOf({ ending: 'lost' }), '2 Siege in Folge', 'a loss is a contest Anna did not win');
  assert.equal(await streakOf({}), '2 Siege in Folge', 'and an UNRECORDED night still breaks one');
});

test('the win rate excludes a non-contest and is lowered by a loss (#1038)', async (t) => {
  const rateFor = async (extra) => {
    const round = roundWith([night(['dan'], MEMBERS), night([], MEMBERS, extra)]);
    const dom = boot(t, round);
    await dom.call('showMember', RID, 'dan');
    const stat = [...dom.app.querySelectorAll('.member-figure')].find(
      (c) => c.querySelector('.member-figure__label').textContent === dom.run("t('member.winRate')")
    );
    return stat.querySelector('.member-figure__value').textContent;
  };

  // One win out of one contested night.
  assert.equal(await rateFor({ ending: 'noWinner' }), '100%', 'the party night is not counted at all');
  assert.equal(await rateFor({ ending: 'ongoing' }), '100%');
  // One win out of two: the table played to win and did not.
  assert.equal(await rateFor({ ending: 'lost' }), '50%');
  assert.equal(await rateFor({}), '50%', 'an unrecorded night is contested, as before');
});
