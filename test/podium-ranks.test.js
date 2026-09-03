'use strict';

/* A podium column is a RANK, not an entry (#836).
 *
 * Both podiums are tie-aware, and ties are the NORM rather than an edge case:
 * `computePlaces` ties on the *displayed* one-decimal average, so a four-person
 * round hits them constantly. Emitting one column per entry therefore grew the
 * stage with every tie — a perfectly ordinary "one winner, three-way tie for
 * 2nd" produced four 140px columns, which a 375px phone (347px of content) fits
 * two of. The row wrapped, and wrapping cost the stage everything it is for:
 * the pedestals left one baseline, and because the arrangement is [2 | 1 | 3]
 * the crowned winner landed at the BOTTOM RIGHT.
 *
 * Three layers, because none of them can see the others' failure:
 *
 *  - the pure arrangement in public/js/podium.js, required into Node;
 *  - the CSS contract, parsed out of styles.css — jsdom applies no external
 *    stylesheet, so `flex-wrap` is only assertable as text
 *    (`.claude/rules/testing-views-under-jsdom.md`);
 *  - the two CALL SITES, run under jsdom. A spec over the helper alone stays
 *    green while views-session.js still emits a column per game, which is
 *    precisely the bug.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { PODIUM_MAX_PER_RANK, podiumColumns, podiumColHtml } = require('../public/js/podium');
const { loadApp } = require('./support/dom');
const { bodyOf, bodyOfIn, outranks, RULES } = require('./support/css');

const at = (place, n) => Array.from({ length: n }, (_, i) => ({ place, id: `${place}-${i}` }));

// ------------------------------------------------------- the arrangement

test('a tie shares ONE column instead of adding one each', () => {
  // The everyday case from the issue: one winner, a three-way tie for 2nd.
  const { cols } = podiumColumns([...at(1, 1), ...at(2, 3)]);
  const filled = cols.filter((c) => !c.spacer);
  assert.ok(cols.length <= 3, 'the stage never exceeds three columns');
  assert.equal(filled.length, 2, 'four games occupy two ranks, not four columns');
  assert.deepEqual(filled.map((c) => c.rank), [2, 1]);
  assert.equal(filled[0].shown.length, 3, 'all three tied games stand on rank 2');
  assert.equal(filled[1].shown.length, 1);
});

test('the crowned rank is CENTRAL — the columns run [2 | 1 | 3]', () => {
  const { cols } = podiumColumns([...at(1, 1), ...at(2, 1), ...at(3, 1)]);
  assert.deepEqual(cols.map((c) => c.rank), [2, 1, 3]);
  assert.equal(cols[1].rank, 1, 'rank 1 sits between the other two');
});

test('the crown stays central even when a rank beside it is unheld', () => {
  /* Packing the occupied ranks together would put the winner at one END —
     which is a milder version of the bug #836 fixed — so the empty slot is
     held open. {1,1,3} (two games tied for the win) is the common one. */
  const oneAndThree = podiumColumns([...at(1, 2), ...at(3, 1)]).cols;
  assert.deepEqual(oneAndThree.map((c) => c.rank), [2, 1, 3]);
  assert.equal(oneAndThree[0].spacer, true, 'rank 2 is held open, not dropped');
  assert.equal(oneAndThree[1].rank, 1, 'the crown is still the middle column');

  const oneAndTwo = podiumColumns([...at(1, 1), ...at(2, 3)]).cols;
  assert.deepEqual(oneAndTwo.map((c) => c.rank), [2, 1, 3]);
  assert.equal(oneAndTwo[2].spacer, true);
  assert.equal(oneAndTwo[1].rank, 1);
});

test('nothing is held open when there is no crown to centre', () => {
  // No rank 1, so no crown — the remaining ranks just pack.
  assert.deepEqual(podiumColumns([...at(2, 2), ...at(3, 1)]).cols.map((c) => c.rank), [2, 3]);
  // One rank is the shared top step, which has no centring problem at all.
  assert.equal(podiumColumns(at(1, 4)).cols.length, 1);
});

test('a spacer renders as an empty slot — no pedestal, no crown, nothing announced', () => {
  /* The callback must not even RUN for a spacer: Pokale labels its pedestal from
     `shown[0]`, which a spacer does not have. Passing an object literal here
     instead would have hidden that — the caller evaluates it eagerly. */
  const html = podiumColHtml({ rank: 3, shown: [], hidden: 0, spacer: true },
    () => { throw new Error('a spacer must not ask its caller for content'); });
  assert.match(html, /podium__col--spacer/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /podium__base|ti-crown|podium__entries/);
});

test('a crowded rank is bounded, and reports how many it is holding back', () => {
  const { cols } = podiumColumns(at(1, 5));
  assert.equal(cols[0].shown.length, PODIUM_MAX_PER_RANK);
  assert.equal(cols[0].hidden, 5 - PODIUM_MAX_PER_RANK);
  // An uncrowded one hides nothing — the count must not render as "+0".
  assert.equal(podiumColumns(at(1, 2)).cols[0].hidden, 0);
});

test('one distinct place occupied is flagged as the degenerate stage', () => {
  assert.equal(podiumColumns(at(1, 4)).single, true, 'everybody tied');
  assert.equal(podiumColumns(at(1, 1)).single, true, 'a single ranked entry');
  assert.equal(podiumColumns([...at(1, 1), ...at(2, 1)]).single, false);
});

test('the column skeleton crowns only rank 1 and marks a shared step', () => {
  const parts = () => ({ entries: '<i>e</i>', more: '+2 more', base: 'B' });
  const one = podiumColHtml({ rank: 1, shown: at(1, 1), hidden: 0 }, parts);
  assert.match(one, /ti-crown/);
  assert.doesNotMatch(one, /podium__col--multi/);
  assert.doesNotMatch(one, /podium__more/, 'nothing hidden must render no "+N" line');

  const two = podiumColHtml({ rank: 2, shown: at(2, 4), hidden: 2 }, parts);
  assert.doesNotMatch(two, /ti-crown/, 'only the winner is crowned');
  assert.match(two, /podium__col--multi/);
  assert.match(two, /<span class="podium__more">\+2 more<\/span>/);
});

// -------------------------------------------------------- the CSS contract

test('the stage never wraps, and its columns are fluid rather than fixed', () => {
  const stage = bodyOf('.podium');
  assert.ok(stage, '.podium rule is gone');
  assert.doesNotMatch(stage, /flex-wrap/,
    'wrapping IS the bug — a wrapped stage strands the crown bottom-right');
  assert.match(stage, /position:\s*relative/, 'the confetti overlay is anchored here');

  const col = bodyOf('.podium__col');
  assert.match(col, /flex:\s*1 1 0/, 'a column shares the row rather than claiming a fixed width');
  assert.match(col, /min-width:\s*0/, 'without this a long title refuses to shrink below its content');
  assert.doesNotMatch(col, /^\s*width:/m, 'a fixed column width is what overflowed a 375px phone');

});

test('an entry fills its column, so covers are uniform and titles can clip', () => {
  /* Found in the browser, not by any of the above: left shrink-to-fit, an entry
     sizes itself from its own TITLE, so the `%` cover width resolved against
     that — measured at 375px, one row held a 36px cover next to „Azul" and a
     52px one next to „Carcassonne" — and text-overflow never fired, because
     there was no definite width to overflow. */
  const entry = bodyOf('.podium__entry');
  assert.match(entry, /width:\s*100%/, 'a shrink-to-fit entry sizes itself from its title');
  assert.match(entry, /min-width:\s*0/);
  // The shared top step lays entries in a row, where 100% would put one per line.
  assert.match(bodyOf('.podium--single .podium__entry'), /width:\s*96px/);

  // Cover sizes are absolute for the same reason: a % here is a title measurement.
  const img = bodyOf('.result-podium__img');
  assert.match(img, /width:\s*74px/);
  assert.match(img, /max-width:\s*100%/, 'the only squeeze a narrow column needs');
  assert.match(bodyOf('.podium__col--multi .result-podium__img'), /width:\s*52px/);
});

test('the degenerate stage is a shared TOP STEP, not a full-width band', () => {
  /* Everyone tied is what a round looks like when it is YOUNGEST — one session
     played leaves every winner on one win — so the degenerate stage is the one
     a new group meets first, on the app's most celebratory screen. It used to
     be `flex: 1 1 100%` over a 44px base: measured 1108x149px at 1440px, a
     tinted horizon line where the stepped silhouette should be (#879). */
  const col = bodyOf('.podium--single .podium__col');
  assert.ok(col, '.podium--single .podium__col rule is gone');
  assert.doesNotMatch(col, /flex:\s*1 1 100%/,
    'claiming the whole stage is what made it a band rather than a step');
  assert.match(col, /width:\s*fit-content/,
    'the step is only as wide as the entries standing on it');

  /* Both numbers are read off the WINNER's own column, which is the whole idea:
     a tie SHARES the top step rather than getting a shape of its own. Compared
     rather than merely matched, so retuning one of them reddens here instead of
     silently drifting the two apart. */
  const px = (body, prop) => body.match(new RegExp(prop + ':\\s*(\\d+)px'))[1];
  assert.equal(px(col, 'min-width'), px(bodyOf('.podium__col'), 'max-width'),
    "a lone entry stands on the winner's column width, not on a 96px post");
  assert.equal(
    px(bodyOfIn('.podium--single .podium__col--1 .podium__base'), 'height'),
    px(bodyOf('.podium__col--1 .podium__base'), 'height'),
    'the shared step is the winner pedestal height — 44px full-width read as a divider'
  );
});

test('a lone step rises at once instead of waiting out the winner cue', () => {
  /* Across three columns the 0.9s on rank 1 is the climax of a staggered build.
     With one column it is 0.9s of blank stage before the only thing there
     appears. */
  const single = '.podium--single.is-reveal .podium__col--1';
  const staged = '.podium.is-reveal .podium__col--1';
  assert.match(bodyOf(single), /animation-delay:\s*0s/);
  assert.equal(outranks(single, staged), false,
    'three classes each — they TIE, so nothing but source order makes this win');
  // Not `at` — that name is this file's entries-at-a-place helper.
  const orderOf = (sel) => RULES.findIndex(([s]) => s === sel);
  assert.ok(orderOf(single) > orderOf(staged),
    'the lone-step delay must stay AFTER the staggered one or it silently loses');
});

test('the reveal keys off the shared component and still rises shortest-first', () => {
  assert.ok(bodyOf('.podium.is-reveal .podium__col'),
    'the rise animation still names the retired per-game selector');
  const delay = (rank) => {
    const body = bodyOf(`.podium.is-reveal .podium__col--${rank}`);
    assert.ok(body, `rank ${rank} has no reveal delay`);
    return parseFloat(body.match(/animation-delay:\s*([\d.]+)s/)[1]);
  };
  assert.ok(delay(3) < delay(2) && delay(2) < delay(1),
    'the stage must build upward: 3rd, then 2nd, then the winner');
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

// Four games, one clear winner and a three-way tie for 2nd — the issue's case.
const TIED_SESSION = session('s1', ['m1'], { g1: 5, g2: 3, g3: 3, g4: 3 });

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
const colsOf = (dom) => [...stageOf(dom).querySelectorAll('.podium__col')];

test('the results podium puts three tied games on ONE step, not three columns', async (t) => {
  const r = round();
  const dom = bootApp(t, r);
  await dom.call('showResults', r, TIED_SESSION, r.games, false);

  const cols = colsOf(dom);
  const filled = cols.filter((c) => !c.classList.contains('podium__col--spacer'));
  assert.ok(cols.length <= 3, `the stage must never exceed three columns, got ${cols.length}`);
  assert.equal(filled.length, 2, 'four placed games occupy two ranks');
  // The pre-#836 stage emitted one column per game and let the row wrap.
  assert.equal(dom.app.querySelectorAll('.result-podium__entry').length, 4,
    'every placed game is still on the stage');
  // Rank 3 is unheld here, so its slot is a spacer keeping the crown centred.
  // Both halves matter: packed to two columns, index 1 is STILL the crown, so
  // the position assertion alone passes against the very layout it guards.
  assert.equal(cols.length, 3, 'the unheld rank keeps its slot open');
  assert.ok(cols[1].classList.contains('podium__col--1'), 'the crown is the middle column');
  assert.ok(cols[2].classList.contains('podium__col--spacer'));
  const second = cols.find((c) => c.classList.contains('podium__col--2'));
  assert.equal(second.querySelectorAll('.result-podium__entry').length, 3);
  const first = cols.find((c) => c.classList.contains('podium__col--1'));
  assert.ok(first.querySelector('.ti-crown'), 'the winner is crowned');
  assert.equal(first.querySelectorAll('.result-podium__entry').length, 1);
});

test('each podium game is its own link — a column can hold several', async (t) => {
  const r = round();
  const dom = bootApp(t, r);
  await dom.call('showResults', r, TIED_SESSION, r.games, false);

  const entries = [...dom.app.querySelectorAll('.result-podium__entry')];
  assert.ok(entries.every((e) => e.classList.contains('game-link')),
    'an entry that is not a link cannot reach the game it names');
  assert.deepEqual(
    entries.map((e) => e.dataset.gid).sort(),
    ['g1', 'g2', 'g3', 'g4']
  );
});

test('everything tied renders ONE shared step, not a column each', async (t) => {
  const flat = session('s2', ['m1'], { g1: 4, g2: 4, g3: 4 });
  const r = round({ sessions: [flat] });
  const dom = bootApp(t, r);
  await dom.call('showResults', r, flat, r.games, false);

  assert.ok(stageOf(dom).classList.contains('podium--single'));
  assert.equal(colsOf(dom).length, 1);
});

test('the Pokale podium shares the component, and its cap spills into the rest line', async (t) => {
  // Five members on one win each: every one of them is rank 1.
  const members = ['m1', 'm2', 'm3', 'm4', 'm5'].map((id, i) => ({ id, name: `P${i + 1}` }));
  const sessions = members.map((m, i) => session(`s${i}`, [m.id], { g1: 4 }));
  const r = round({ members, sessions });
  const dom = bootApp(t, r);
  await dom.call('renderPokaleTab', r);

  const cols = colsOf(dom);
  assert.equal(cols.length, 1, 'one rank, one column');
  assert.ok(stageOf(dom).classList.contains('podium--single'));
  assert.equal(cols[0].querySelectorAll('.podium__entry').length, PODIUM_MAX_PER_RANK);
  assert.match(cols[0].querySelector('.podium__more').textContent, /\+2 weitere/);

  // The two the cap pushed off the step must still be reachable somewhere.
  const rest = dom.app.querySelector('.podium__rest');
  assert.ok(rest, 'the capped members vanished from the screen entirely');
  assert.equal(rest.querySelectorAll('.podium__rest-name').length, 2);
});

test('a Pokale member entry links to that member', async (t) => {
  const members = [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben' },
  ];
  const sessions = [session('s0', ['m1'], { g1: 4 }), session('s1', ['m1'], { g1: 4 }), session('s2', ['m2'], { g1: 4 })];
  const r = round({ members, sessions });
  const dom = bootApp(t, r);
  await dom.call('renderPokaleTab', r);

  const cols = colsOf(dom);
  assert.deepEqual(cols.map((c) => c.className.match(/podium__col--\d/)[0]),
    ['podium__col--2', 'podium__col--1', 'podium__col--3'],
    'Anna leads and Ben stands on 2; rank 3 is held open so the crown is central');
  assert.ok(cols[2].classList.contains('podium__col--spacer'));
  assert.ok(cols[1].querySelector('.ti-crown'), 'the crown is the middle column');
  const entries = [...dom.app.querySelectorAll('.podium__entry')];
  assert.ok(entries.every((e) => e.classList.contains('member-link')));
  assert.deepEqual(entries.map((e) => e.dataset.mid), ['m2', 'm1']);
});
