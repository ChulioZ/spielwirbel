'use strict';

/* A podium TIER is a rank, and rank is encoded by POSITION, never by height
 * (#891).
 *
 * The stage used to be three side-by-side columns whose pedestal height carried
 * the rank. But a tie adds ENTRIES, and entries stack UPWARD from the pedestal,
 * so the more games shared a low place the taller that column's silhouette: one
 * winner plus a three-way tie for 3rd made the bronze column overtop the crowned
 * winner. The one claim a podium exists to make, contradicted by its own
 * geometry — and worse the further down the tie sat. #836, #879, #888 and #889
 * each fixed a sub-case inside that encoding without being able to reach the
 * inversion, because the inversion WAS the encoding.
 *
 * Ties are the norm rather than an edge case: `computePlaces` ties on the
 * *displayed* one-decimal average, so a four-person round hits them constantly.
 *
 * Three layers, because none of them can see the others' failure:
 *
 *  - the pure arrangement in public/js/podium.js, required into Node;
 *  - the CSS contract, parsed out of styles.css — jsdom applies no external
 *    stylesheet, so `flex-direction` is only assertable as text
 *    (`.claude/rules/testing-views-under-jsdom.md`);
 *  - the two CALL SITES, run under jsdom. A spec over the helper alone stays
 *    green while views-session.js still emits a column per game, which is
 *    precisely the bug.
 *
 * The rank numeral's contrast against its disc lives in test/a11y-contrast.test.js,
 * where the WCAG machinery already is — a palette tweak must redden there.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { podiumTiers, podiumTierHtml } = require('../public/js/podium');
const { loadApp } = require('./support/dom');
const { bodyOf, bodyOfIn, mediaBlocks, rulesOf, RULES } = require('./support/css');

// A px value out of a rule body, so a claim can be COMPARED with another rule's
// number rather than restated as a literal that silently drifts from it.
const px = (body, prop) => Number(body.match(new RegExp(prop + ':\\s*(\\d+)px'))[1]);

const at = (place, n) => Array.from({ length: n }, (_, i) => ({ place, id: `${place}-${i}` }));

// ------------------------------------------------------- the arrangement

test('the tiers run TOP-DOWN [1, 2, 3] — position is the ranking', () => {
  const tiers = podiumTiers([...at(1, 1), ...at(2, 1), ...at(3, 1)]);
  assert.deepEqual(tiers.map((t) => t.rank), [1, 2, 3]);
});

test('a tie shares ONE tier instead of adding one each', () => {
  // The issue's case: one winner, a three-way tie for 3rd.
  const tiers = podiumTiers([...at(1, 1), ...at(3, 3)]);
  assert.deepEqual(tiers.map((t) => t.rank), [1, 3]);
  assert.equal(tiers[1].shown.length, 3, 'all three tied games stand on rank 3');
});

test('an unheld rank is ABSENT — no spacer, no riser, no empty slot', () => {
  /* The column layout held the slot open to keep the crown central and to draw a
     stepped silhouette. Both reasons die with the columns: the winner is the top
     row, and the indent draws the staircase. A held-open slot now buys nothing
     and costs a blank tier. */
  assert.deepEqual(podiumTiers([...at(1, 2), ...at(3, 1)]).map((t) => t.rank), [1, 3]);
  assert.deepEqual(podiumTiers([...at(2, 2), ...at(3, 1)]).map((t) => t.rank), [2, 3]);
  assert.equal(podiumTiers(at(1, 4)).length, 1, 'everybody tied is ONE tier and nothing else');
});

test('nothing is capped — every tied entry stands on its tier', () => {
  /* The column cap existed because a column has no width to grow into. A row
     does, so an entry never has to be explained away into a „+N" count. */
  assert.equal(podiumTiers(at(1, 7))[0].shown.length, 7);
});

test('places outside the top three never reach the stage', () => {
  assert.deepEqual(podiumTiers([...at(1, 1), ...at(4, 2), ...at(9, 1)]).map((t) => t.rank), [1]);
});

test('the tier skeleton crowns only rank 1 and marks a shared place', () => {
  const parts = () => ({ entries: '<i>e</i>' });
  const one = podiumTierHtml({ rank: 1, shown: at(1, 1) }, parts, 'geteilt');
  assert.match(one, /podium__tier--1/);
  assert.match(one, /ti-crown/);
  assert.match(one, /<span class="podium__rank">1<\/span>/);
  assert.doesNotMatch(one, /podium__shared/, 'a place held alone is not shared');

  const three = podiumTierHtml({ rank: 3, shown: at(3, 3) }, parts, 'geteilt');
  assert.doesNotMatch(three, /ti-crown/, 'only the winner is crowned');
  assert.match(three, /<span class="podium__shared">geteilt<\/span>/,
    'the tie label is the whole semantic fix — the component owns it for both screens');
});

// -------------------------------------------------------- the CSS contract

test('the stage stacks DOWNWARD — height no longer encodes anything', () => {
  const stage = bodyOf('.podium');
  assert.ok(stage, '.podium rule is gone');
  assert.match(stage, /flex-direction:\s*column/, 'one tier per row, best on top');
  assert.doesNotMatch(stage, /align-items:\s*flex-end/,
    'a shared baseline is what made a taller tie outrank the winner');
  assert.match(stage, /position:\s*relative/, 'the confetti overlay is anchored here');
});

test('the staircase is drawn by INDENT, which a tie cannot grow', () => {
  /* The one property that must scale with rank. Read as numbers and compared,
     so flattening the steps — or inverting them — reddens here rather than
     quietly costing the stage the thing it now uses to say „lower place". */
  const indent = (rank) => px(bodyOf(`.podium__tier--${rank}`), 'margin-left');
  assert.ok(indent(2) > 0 && indent(3) > indent(2),
    'each tier must sit one step further right than the one above it');
});

test('the winner is the heaviest thing on the stage, by size not by height', () => {
  // Hero cover vs. the quieter tiers', compared rather than matched.
  const hero = px(bodyOf('.result-podium__img'), 'width');
  const quiet = px(bodyOfIn('.podium__tier--3 .result-podium__img'), 'width');
  assert.ok(hero > quiet, 'the top tier must carry the largest cover');
  assert.match(bodyOf('.podium__tier--1'), /var\(--gold-edge\)/, 'and the gold edge');
});

test('an entry is an ABSOLUTE box, so covers stay uniform and titles clip', () => {
  /* Entries now flow in a ROW, so each needs a width of its own. A `%` here
     would resolve against whichever child is widest — the title — which makes
     covers ragged and stops text-overflow ever firing
     (percent-sizes-under-a-shrink-to-fit-flex-item.md). */
  const entry = bodyOf('.podium__entry');
  assert.match(entry, /width:\s*\d+px/, 'a shrink-to-fit entry sizes itself from its title');
  assert.match(entry, /max-width:\s*100%/, 'the only squeeze a narrow stage needs');
  assert.doesNotMatch(entry, /(^|[;\s])width:\s*\d+%/m, 'a % width measures the title, not the box');

  const img = bodyOf('.result-podium__img');
  assert.match(img, /width:\s*74px/);
  assert.match(img, /max-width:\s*100%/);
});

test('the column apparatus is gone — not merely unused', () => {
  /* Left behind, these keep sizing a `.podium__col` no caller emits any more,
     and the next reader has to work out which layout is live. */
  for (const dead of [
    '.podium__col',
    '.podium__col--spacer',
    '.podium--single .podium__col',
    '.podium__more',
    '.podium__col--1 .podium__base',
  ]) {
    assert.equal(bodyOf(dead), null, `${dead} belongs to the retired column stage`);
  }
  assert.deepEqual(
    RULES.map(([sel]) => sel).filter((sel) => /podium__col|podium--single|podium__base/.test(sel)),
    []
  );
});

test('the reveal builds BOTTOM-UP by position, so the winner is still the climax', () => {
  /* Keyed off position rather than rank on purpose: a stage whose only tier is
     rank 1 would otherwise sit blank for the winner's 0.9s cue before revealing
     the one thing anyone is waiting for. `:last-child` is the bottom tier
     whatever its rank, which also retires the old `.podium--single` special
     case rather than reproducing it. */
  const delay = (sel) => {
    const body = bodyOf(sel);
    assert.ok(body, `${sel} has no reveal delay`);
    return parseFloat(body.match(/animation-delay:\s*([\d.]+)s/)[1]);
  };
  const bottom = delay('.podium.is-reveal .podium__tier:last-child');
  const middle = delay('.podium.is-reveal .podium__tier:nth-last-child(2)');
  const top = delay('.podium.is-reveal .podium__tier:nth-last-child(3)');
  assert.ok(bottom < middle && middle < top, 'the stage must build upward to the winner');

  // And none of it runs where motion is unwelcome.
  const guarded = mediaBlocks()
    .filter(([q]) => /prefers-reduced-motion:\s*no-preference/.test(q))
    .flatMap(([, css]) => rulesOf(css).map(([sel]) => sel));
  assert.ok(guarded.some((sel) => /\.podium\.is-reveal/.test(sel)),
    'the rise must stay inside a prefers-reduced-motion guard');
});

// --------------------------------------------------------- the call sites

const RID = 'r1';

const session = (id, winnerIds, ratings) => ({
  id,
  createdAt: '2026-07-01T20:00:00.000Z',
  gameIds: Object.keys(ratings),
  memberIds: ['m1'],
  votes: { m1: Object.fromEntries(Object.entries(ratings).map(([g, r]) => [g, { rating: r, retire: false }])) },
  votedIds: ['m1'],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds,
  chosenGameId: Object.keys(ratings)[0],
  events: [],
});

/* One clear winner, a second place, and a three-way tie for 3rd — the issue's
   case, and the one the column stage inverted worst: three entries stacked on
   the shortest pedestal overtopped the crowned winner. Competition ranking, so
   the ratings have to descend through a held 2nd to put the tie on rank 3. */
const TIED_SESSION = session('s1', ['m1'], { g1: 5, g2: 4, g3: 3, g4: 3, g5: 3 });

const round = (over = {}) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: [{ id: 'm1', name: 'Anna' }],
  games: [
    { id: 'g1', title: 'Catan', tagIds: [] },
    { id: 'g2', title: 'Azul', tagIds: [] },
    { id: 'g3', title: 'Splendor', tagIds: [] },
    { id: 'g4', title: 'Cascadia', tagIds: [] },
    { id: 'g5', title: 'Kingdomino', tagIds: [] },
  ],
  sessions: [TIED_SESSION],
  ...over,
});

function bootApp(t, r) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return r;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  return dom;
}

const stageOf = (dom) => dom.app.querySelector('.podium');
const tiersOf = (dom) => [...stageOf(dom).querySelectorAll('.podium__tier')];
const rankOrder = (dom) => tiersOf(dom).map((el) => el.className.match(/podium__tier--(\d)/)[1]);

test('the results podium puts three tied games on ONE tier, below the winner', async (t) => {
  const r = round();
  const dom = bootApp(t, r);
  await dom.call('showResults', r, TIED_SESSION, r.games, false);

  assert.deepEqual(rankOrder(dom), ['1', '2', '3'], 'the tiers descend, best on top');
  assert.equal(dom.app.querySelectorAll('.result-podium__entry').length, 5,
    'every placed game is still on the stage');

  const [winner, second, tied] = tiersOf(dom);
  assert.equal(winner.querySelectorAll('.result-podium__entry').length, 1);
  assert.ok(winner.querySelector('.ti-crown'), 'the winner is crowned');
  assert.equal(second.querySelector('.ti-crown'), null, 'only the winner is crowned');
  assert.equal(winner.querySelector('.podium__shared'), null, 'a place held alone is not shared');
  assert.equal(tied.querySelectorAll('.result-podium__entry').length, 3);
  assert.match(tied.querySelector('.podium__shared').textContent, /geteilt/);
});

test('an unheld rank renders NOTHING between the tiers that are held', async (t) => {
  /* Two games tied for the win and one third — the common {1, 1, 3}. The column
     stage held rank 2 open as a spacer to keep the crown central; a tier does
     not need it, and an empty tier would only say somebody is standing there. */
  const gap = session('s3', ['m1'], { g1: 5, g2: 5, g3: 3 });
  const r = round({ sessions: [gap] });
  const dom = bootApp(t, r);
  await dom.call('showResults', r, gap, r.games, false);

  assert.deepEqual(rankOrder(dom), ['1', '3']);
  assert.ok(tiersOf(dom)[0].querySelector('.podium__shared'), 'the shared win is marked');
});

test('each podium game is its own link — a tier can hold several', async (t) => {
  const r = round();
  const dom = bootApp(t, r);
  await dom.call('showResults', r, TIED_SESSION, r.games, false);

  const entries = [...dom.app.querySelectorAll('.result-podium__entry')];
  assert.ok(entries.every((e) => e.classList.contains('game-link')),
    'an entry that is not a link cannot reach the game it names');
  assert.deepEqual(entries.map((e) => e.dataset.gid).sort(), ['g1', 'g2', 'g3', 'g4', 'g5']);
});

test('everything tied renders ONE hero tier and nothing else', async (t) => {
  const flat = session('s2', ['m1'], { g1: 4, g2: 4, g3: 4 });
  const r = round({ sessions: [flat] });
  const dom = bootApp(t, r);
  await dom.call('showResults', r, flat, r.games, false);

  assert.deepEqual(rankOrder(dom), ['1'], 'no empty risers stand in for the unheld places');
  assert.equal(dom.app.querySelectorAll('.result-podium__entry').length, 3);
  assert.ok(tiersOf(dom)[0].querySelector('.podium__shared'));
});

test('the Pokale podium shares the component and caps nobody', async (t) => {
  // Five members on one win each: every one of them is rank 1.
  const members = ['m1', 'm2', 'm3', 'm4', 'm5'].map((id, i) => ({ id, name: `P${i + 1}` }));
  const sessions = members.map((m, i) => session(`s${i}`, [m.id], { g1: 4 }));
  const r = round({ members, sessions });
  const dom = bootApp(t, r);
  await dom.call('renderPokaleTab', r);

  assert.deepEqual(rankOrder(dom), ['1']);
  assert.equal(tiersOf(dom)[0].querySelectorAll('.podium__entry').length, 5,
    'the retired per-rank cap must not push a tied member off the stage');
  assert.equal(dom.app.querySelector('.podium__rest'), null, 'nobody is left over to list');
});

test('every podium member carries their OWN win count', async (t) => {
  /* It used to be the tier's pedestal label, read off `shown[0]` — sound only
     while the ranking IS the win count. #895 ranks on the Siegwertung and shows
     the raw count, and tier-mates then differ, so the number belongs to the
     member rather than to the step. */
  const members = [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
    { id: 'm3', name: 'Cem' },
    { id: 'm4', name: 'Dana' },
  ];
  const sessions = [
    session('s0', ['m1'], { g1: 4 }),
    session('s1', ['m1'], { g1: 4 }),
    session('s2', ['m2'], { g1: 4 }),
    session('s3', ['m3'], { g1: 4 }),
    session('s4', ['m4'], { g1: 4 }),
  ];
  const r = round({ members, sessions });
  const dom = bootApp(t, r);
  await dom.call('renderPokaleTab', r);

  assert.deepEqual(rankOrder(dom), ['1', '2'], 'Anna leads on 2; the other three tie on 1');
  const [lead, tied] = tiersOf(dom);
  assert.match(lead.querySelector('.podium__wins').textContent, /2 Siege/);
  assert.equal(tied.querySelectorAll('.podium__wins').length, 3,
    'a shared tier states the count once PER MEMBER, not once for the step');

  const entries = [...dom.app.querySelectorAll('.podium__entry')];
  assert.ok(entries.every((e) => e.classList.contains('member-link')));
  assert.deepEqual(entries.map((e) => e.dataset.mid), ['m1', 'm2', 'm3', 'm4']);
});

test('members ranked below the third place still appear in the rest line', async (t) => {
  const members = ['m1', 'm2', 'm3', 'm4'].map((id, i) => ({ id, name: `P${i + 1}` }));
  const sessions = [
    ...Array.from({ length: 4 }, (_, i) => session(`a${i}`, ['m1'], { g1: 4 })),
    ...Array.from({ length: 3 }, (_, i) => session(`b${i}`, ['m2'], { g1: 4 })),
    ...Array.from({ length: 2 }, (_, i) => session(`c${i}`, ['m3'], { g1: 4 })),
    session('d0', ['m4'], { g1: 4 }),
  ];
  const r = round({ members, sessions });
  const dom = bootApp(t, r);
  await dom.call('renderPokaleTab', r);

  assert.deepEqual(rankOrder(dom), ['1', '2', '3']);
  const rest = dom.app.querySelector('.podium__rest');
  assert.ok(rest, 'the fourth-placed member vanished from the screen entirely');
  assert.deepEqual([...rest.querySelectorAll('.podium__rest-name')].map((e) => e.dataset.mid), ['m4']);
});
