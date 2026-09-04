'use strict';

/* The Ruhmeshalle ranks PLAY, not attendance (#895) — asserted by rendering the
 * two screens rather than by matching their source
 * (`.claude/rules/testing-views-under-jsdom.md`).
 *
 * The fixture reproduces the actual defect: Dan logs five solo plays into the
 * round and wins one of four group nights, so his RAW count (6) is three times
 * Anna's (2) and he topped the podium — a total nobody playing in a group could
 * contest, because there is no denominator and no cap. Under the Siegwertung
 * his solo nights are worth exactly zero and he falls off the stage entirely.
 *
 * Every group night seats all four members, so p = 4 throughout:
 *
 *   Anna  2 wins, 2 losses ->  2·(3/4) − 2·(1/4) = +1,0   (the only one above chance)
 *   Ben   1 win,  3 losses ->  1·(3/4) − 3·(1/4) =  0,0
 *   Dan   1 win,  3 losses, + 5 solo ->            0,0
 *   Clara 0 wins, 4 losses ->            −4·(1/4) = −1,0
 *
 * Dan and Ben landing on exactly 0,0 is deliberate: it pins that the podium
 * filter is `> 0` and not `>= 0`, and that a member at chance is not celebrated.
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

test('the member with the MOST wins is off the podium when they are solo wins', async (t) => {
  const dom = await pokale(t, roundWith([...group, ...solos]));
  assert.deepEqual(onStage(dom), ['anna'], 'only Anna is above chance');
  // Dan holds six wins to Anna's two and is not on the stage at all.
  assert.deepEqual(inRest(dom).sort(), ['ben', 'clara', 'dan']);
});

test('a solo night moves nobody — the standings ignore the whole block', async (t) => {
  const withSolos = await pokale(t, roundWith([...group, ...solos]));
  const without = await pokale(t, roundWith(group));
  assert.deepEqual(onStage(withSolos), onStage(without));
  assert.deepEqual(inRest(withSolos).sort(), inRest(without).sort());
  assert.equal(
    withSolos.app.querySelector('.podium__score').textContent,
    without.app.querySelector('.podium__score').textContent
  );
});

// ---- what the stage prints --------------------------------------------------

test('an upright entry carries the score first and the raw count beside it', async (t) => {
  const dom = await pokale(t, roundWith([...group, ...solos]));
  const wins = dom.app.querySelector('.podium__entry .podium__wins');
  assert.equal(wins.querySelector('.podium__score').textContent, '+1,0');
  assert.match(wins.querySelector('.podium__winsraw').textContent, /2 Siege/);
  assert.match(wins.getAttribute('title'), /2 Siege/);
});

test('no negative number is rendered anywhere on the tab', async (t) => {
  // Clara sits at −1,0 and Dan's six wins are worth 0,0, so both the "below
  // chance" and the "at chance" cases are on screen here.
  const dom = await pokale(t, roundWith([...group, ...solos]));
  const text = dom.app.textContent;
  assert.doesNotMatch(text, /[−-]\d+,\d/, `a negative Siegwertung reached the tab: ${text.slice(0, 200)}`);
  // The rest line states plain win counts and no score at all.
  const rest = dom.app.querySelector('.podium__rest');
  assert.match(rest.textContent, /6 Siege/, "Dan's raw count is still stated");
  assert.equal(rest.querySelector('.podium__score'), null, 'the rest line carries no Siegwertung');
});

test('the standings explain themselves through the ⓘ', async (t) => {
  const dom = await pokale(t, roundWith(group));
  const info = dom.app.querySelector('.section-head [data-info-topic]');
  assert.ok(info, 'the Siegwertung needs an explanation somewhere on the screen');
  assert.equal(info.dataset.infoTopic, 'win');
  info.click();
  const sheet = dom.document.querySelector('.sheet[role="dialog"]');
  assert.ok(sheet, 'the ⓘ opens a sheet');
  assert.match(sheet.textContent, /Siegwertung/);
  assert.doesNotMatch(sheet.textContent, /Spielwirbel-Score/, 'it must not open the GAME score sheet');
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

test('the member page rates Dan on contested nights only, and shows his Siegwertung', async (t) => {
  const round = roundWith([...group, ...solos]);
  const dom = boot(t, round);
  await dom.call('showMember', RID, 'dan');
  const cards = [...dom.app.querySelectorAll('.member-stats__card')].map((c) => [
    c.querySelector('.pokale-card__label').textContent,
    c.querySelector('.pokale-card__value').textContent,
  ]);
  const valueOf = (key) => (cards.find(([l]) => l === dom.run(`t('${key}')`)) || [])[1];

  // Six wins over nine finished nights would read 67 %; over the four CONTESTED
  // nights it is one win in four. A rate that counts solo plays is the naive
  // fix and is worse than the count it replaces — it reads 100 % for a pure
  // solo logger.
  assert.equal(valueOf('member.winRate'), '25%');
  assert.equal(valueOf('member.wins'), '6', 'the raw count is a factual record and is unchanged');
  assert.equal(valueOf('member.winScore'), '0,0');
});
