'use strict';

/* The Pokale podium: ONE COLUMN IS ONE RANK, and a TIE MUST NOT GROW THE
 * PEDESTAL'S HEIGHT.
 *
 * Two constraints that pull against each other, each learned the hard way:
 *
 *  - #836: a column per MEMBER made an ordinary tie emit four fixed-width
 *    columns that wrapped on a phone — pedestals off one baseline, and since
 *    the arrangement is [2 | 1 | 3] the crowned winner at the bottom right.
 *  - #891/#897: entries STACKING upward from the pedestal made the tie grow the
 *    very dimension the pedestal uses to state the rank, so one winner plus a
 *    three-way tie for 3rd overtopped the crowned winner. Entries lie sideways
 *    on the step instead — the one direction that says nothing about rank.
 *
 * Ties are the norm rather than an edge case: members tie on whole win counts,
 * so a four-person round hits them constantly.
 *
 * Three layers, because none of them can see the others' failure:
 *
 *  - the pure arrangement in public/js/podium.js, required into Node;
 *  - the CSS contract, parsed out of styles.css — jsdom applies no external
 *    stylesheet, so `flex-direction` is only assertable as text
 *    (`.claude/rules/testing-views-under-jsdom.md`);
 *  - the CALL SITE, run under jsdom. A spec over the helper alone stays green
 *    while views-pokale.js emits something else entirely.
 *
 * What NO layer here can hold is the pixel heights — jsdom applies no
 * stylesheet, so nothing in the suite can see a wrapped step at 375px. The
 * crossover is a browser measurement, written down in
 * `.claude/rules/rank-encodings-must-not-be-growable-by-ties.md`.
 *
 * The session results screen used to be this component's second caller; it
 * opens with a winner spotlight since #897 and is covered by
 * test/result-spotlight.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { podiumColumns, podiumColHtml } = require('../public/js/podium');
const { loadApp } = require('./support/dom');
const { bodyOf, bodyOfIn, RULES } = require('./support/css');

// A px value out of a rule body, so a claim can be COMPARED with another rule's
// number rather than restated as a literal that silently drifts from it.
const px = (body, prop) => Number(body.match(new RegExp(prop + ':\\s*(\\d+)px'))[1]);

const at = (place, n) => Array.from({ length: n }, (_, i) => ({ place, id: `${place}-${i}` }));

// ------------------------------------------------------- the arrangement

test('the columns run [2 | 1 | 3] — the winner stands in the middle', () => {
  const { cols, single } = podiumColumns([...at(1, 1), ...at(2, 1), ...at(3, 1)]);
  assert.deepEqual(cols.map((c) => c.rank), [2, 1, 3]);
  assert.equal(single, false);
});

test('a tie shares ONE column instead of adding one each', () => {
  // The #836 case: one winner and a three-way tie for 2nd — four columns once.
  const { cols } = podiumColumns([...at(1, 1), ...at(2, 3)]);
  assert.deepEqual(cols.map((c) => c.rank), [2, 1, 3]);
  assert.equal(cols[0].shown.length, 3, 'all three tied members stand on rank 2');
  assert.equal(cols[2].spacer, true, 'rank 3 is unheld');
});

test('an unheld rank beside the crown is held OPEN, so the crown stays central', () => {
  /* Dropping it reads fine in the abstract and is wrong on screen: {1,2} would
     render as [1st | 2nd] and the common {1,1,3} as [1st | 3rd], putting the
     winner at one end — a milder version of the very thing #836 fixed. */
  assert.deepEqual(podiumColumns([...at(1, 2), ...at(3, 1)]).cols.map((c) => c.rank), [2, 1, 3]);
  assert.deepEqual(
    podiumColumns([...at(1, 2), ...at(3, 1)]).cols.map((c) => !!c.spacer),
    [true, false, false]
  );
});

test('nothing is held open where there is no crown to centre', () => {
  const { cols } = podiumColumns([...at(2, 2), ...at(3, 1)]);
  assert.deepEqual(cols.map((c) => c.rank), [2, 3]);
  assert.deepEqual(cols.map((c) => !!c.spacer), [false, false]);
});

test('one distinct place occupied is the SHARED TOP STEP, slots kept', () => {
  /* Everybody tied is the state a round is in when it is YOUNGEST, since
     everyone's first win leaves everyone on one. The empty risers are what give
     a lone pedestal a stepped silhouette at all (#879). */
  const { single, cols } = podiumColumns(at(1, 4));
  assert.equal(single, true);
  assert.deepEqual(cols.map((c) => c.rank), [2, 1, 3]);
  assert.equal(cols[1].shown.length, 4);
});

test('nothing is capped — every tied member stands on the step', () => {
  /* There was a per-rank cap of 3 with a „+N weitere" spill, because a column
     of STACKED entries had no width to grow into. Entries lying sideways grow
     into width, so nobody has to be explained away into a count. */
  assert.equal(podiumColumns(at(1, 7)).cols[1].shown.length, 7);
});

test('places outside the top three never reach the stage', () => {
  assert.deepEqual(podiumColumns([...at(1, 1), ...at(4, 2), ...at(9, 1)]).cols.map((c) => c.rank), [2, 1, 3]);
  assert.equal(podiumColumns([...at(1, 1), ...at(4, 2)]).cols[1].shown.length, 1);
});

test('the column skeleton crowns rank 1 and states the rank on the PEDESTAL', () => {
  const entry = () => '<i>e</i>';
  const one = podiumColHtml({ rank: 1, shown: at(1, 1) }, entry, 'geteilt');
  assert.match(one, /podium__col--1/);
  assert.match(one, /ti-crown/);
  assert.match(one, /<div class="podium__base"><span class="podium__rank">1<\/span><\/div>/,
    'the pedestal states the rank and, alone, nothing else');
  assert.doesNotMatch(one, /podium__col--multi/, 'one member is not a shared step');
  assert.doesNotMatch(one, /podium__shared/, 'a place held alone is not shared');

  const three = podiumColHtml({ rank: 3, shown: at(3, 3) }, entry, 'geteilt');
  assert.doesNotMatch(three, /ti-crown/, 'only the winner is crowned');
  assert.match(three, /podium__col--multi/, 'the hook the entries lie down on');
  assert.match(three, /<span class="podium__shared">geteilt<\/span>/);
});

test('a spacer column asks the caller for nothing and announces nothing', () => {
  /* Its `shown` is empty, so a callback reaching into it would throw — which is
     why entries are built through a callback rather than handed in. */
  const html = podiumColHtml({ rank: 2, shown: [], spacer: true }, () => {
    throw new Error('a spacer must never build content');
  }, 'geteilt');
  assert.match(html, /podium__col--spacer/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /podium__base/, 'an empty slot is a riser, not a pedestal');
});

// -------------------------------------------------------- the CSS contract

test('the stage is a row of at most three columns and NEVER wraps', () => {
  const stage = bodyOf('.podium');
  assert.ok(stage, '.podium rule is gone');
  assert.match(stage, /align-items:\s*flex-end/, 'the pedestals stand on one baseline');
  assert.doesNotMatch(stage, /flex-wrap/, 'a wrapped stage was the #836 bug');
});

test('the PEDESTAL height is the rank encoding, and it descends', () => {
  /* Read as numbers and compared, so flattening the steps — or inverting them —
     reddens here rather than quietly costing the stage the thing it uses to say
     „this place is higher". */
  const base = (rank) => px(bodyOf(`.podium__col--${rank} .podium__base`), 'height');
  assert.ok(base(1) > base(2) && base(2) > base(3), 'the winner must stand highest');
});

test('an unheld rank is PAINTED at exactly its own step height', () => {
  /* An unpainted slot spends its third of the stage on a hole. The heights
     restate the pedestal's rather than inheriting (a spacer holds no base at
     all), so they are compared here to keep the two from drifting. */
  for (const rank of [2, 3]) {
    assert.equal(
      px(bodyOf(`.podium__col--${rank}.podium__col--spacer`), 'height'),
      px(bodyOf(`.podium__col--${rank} .podium__base`), 'height'),
      `the rank ${rank} riser must be exactly as tall as the step it stands in for`
    );
  }
  assert.match(bodyOf('.podium__col--spacer'), /opacity:\s*0\.75/, 'faded, or it reads as occupied');
});

test('a SHARED step lays its members sideways — the tie may only grow WIDTH', () => {
  /* The whole structural fix. Entries flow in a row for every rank, and once a
     place is shared each one lies down into a chip, so a crowded place adds
     ~32px a member rather than ~90px. */
  assert.match(bodyOf('.podium__entries'), /flex-direction:\s*row/);
  assert.match(bodyOf('.podium__entries'), /flex-wrap:\s*wrap/);
  assert.match(bodyOf('.podium__col--multi .podium__entry'), /flex-direction:\s*row/,
    'a shared step must lie its members down, or a tie stacks upward again');
  const solo = px(bodyOf('.podium__avatar'), 'width');
  const shared = px(bodyOf('.podium__col--multi .podium__avatar'), 'width');
  assert.ok(shared < solo, `a shared step shrinks its avatars (${shared} vs ${solo})`);
});

test('an entry is a DEFINITE box, so covers stay uniform and names clip', () => {
  /* A `%` inside a shrink-to-fit column resolves against whichever child is
     widest — the name — which stops text-overflow ever firing
     (percent-sizes-under-a-shrink-to-fit-flex-item.md). The entry's `100%` is
     definite because `.podium__col` has a definite width of its own; the shared
     top step's is an absolute literal, because that column sizes to `fit-content`
     and a `%` there would be circular. */
  assert.match(bodyOf('.podium__entry'), /width:\s*100%/);
  assert.match(bodyOf('.podium__col'), /max-width:\s*\d+px/, 'the column is what makes 100% definite');
  assert.match(bodyOf('.podium--single .podium__col--multi .podium__entry'), /width:\s*\d+px/,
    'a fit-content step needs an absolute entry, or its width measures the longest name');
  assert.match(bodyOf('.podium--single .podium__col'), /width:\s*fit-content/);
});

test('the shared top step stands UPRIGHT and at the winner\'s height', () => {
  /* It is the only occupied column, so its height claims nothing about anybody
     — the chip rule has nothing to protect there, and a row of faces reads as a
     celebration where a row of chips reads as a list. */
  assert.match(bodyOf('.podium--single .podium__col--multi .podium__entry'), /flex-direction:\s*column/);
  const top = px(bodyOf('.podium__col--1 .podium__base'), 'height');
  for (const rank of [1, 2, 3]) {
    const sel = RULES.find(([s]) => s.includes(`.podium--single .podium__col--${rank} .podium__base`));
    assert.ok(sel, `the lone rank ${rank} step must take the winner's height`);
  }
  assert.equal(px(bodyOfIn('.podium--single .podium__col--1 .podium__base'), 'height'), top);
});

test('the tier apparatus is gone — not merely unused', () => {
  /* Left behind, these keep sizing a `.podium__tier` no caller emits any more,
     and the next reader has to work out which layout is live. */
  for (const dead of ['.podium__tier', '.podium__tier--1', '.podium__marker', '.podium.is-reveal .podium__tier']) {
    assert.equal(bodyOf(dead), null, `${dead} belongs to the retired tier stage`);
  }
  assert.deepEqual(RULES.map(([sel]) => sel).filter((sel) => /podium__tier|podium__marker/.test(sel)), []);
});

// --------------------------------------------------------- the call site

const RID = 'r1';

const session = (id, winnerIds) => ({
  id,
  createdAt: '2026-07-01T20:00:00.000Z',
  gameIds: ['g1'],
  memberIds: ['m1'],
  votes: { m1: { g1: { rating: 4, retire: false } } },
  votedIds: ['m1'],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds,
  chosenGameId: 'g1',
  events: [],
});

const round = (members, sessions) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members,
  games: [{ id: 'g1', title: 'Catan', tagIds: [] }],
  sessions,
});

const memberList = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, name: `P${i + 1}` }));

// `wins` maps a member id to how many nights they won; one session per win.
const winsToSessions = (wins) =>
  Object.entries(wins).flatMap(([mid, n]) => Array.from({ length: n }, (_, i) => session(`${mid}-${i}`, [mid])));

async function pokale(t, members, wins) {
  const r = round(members, winsToSessions(wins));
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
  await dom.call('renderPokaleTab', r);
  return dom;
}

const colOrder = (dom) =>
  [...dom.app.querySelectorAll('.podium__col')].map((el) => el.className.match(/podium__col--(\d)/)[1]);

test('the Pokale stage runs [2 | 1 | 3] with the crown in the middle', async (t) => {
  const dom = await pokale(t, memberList(3), { m1: 3, m2: 2, m3: 1 });
  assert.deepEqual(colOrder(dom), ['2', '1', '3']);
  const [second, first, third] = [...dom.app.querySelectorAll('.podium__col')];
  assert.ok(first.querySelector('.ti-crown'), 'the winner is crowned');
  assert.equal(second.querySelector('.ti-crown'), null);
  assert.equal(third.querySelector('.ti-crown'), null);
});

test('tied members share ONE step, sideways, and nobody is capped', async (t) => {
  // One clear winner and a FOUR-way tie for 2nd: the cap used to drop the fourth.
  const dom = await pokale(t, memberList(5), { m1: 5, m2: 2, m3: 2, m4: 2, m5: 2 });
  const cols = [...dom.app.querySelectorAll('.podium__col')];
  const tied = cols.find((el) => el.classList.contains('podium__col--2'));
  assert.equal(tied.querySelectorAll('.podium__entry').length, 4);
  assert.ok(tied.classList.contains('podium__col--multi'), 'the hook the entries lie down on');
  assert.match(tied.querySelector('.podium__shared').textContent, /geteilt/);
  assert.equal(dom.app.querySelector('.podium__more'), null, 'the „+N weitere" spill is retired');
  assert.equal(dom.app.querySelector('.podium__rest'), null, 'nobody was pushed off the stage');
});

test('every member carries their OWN win count; the step carries only the rank', async (t) => {
  /* The count used to be the pedestal's label, read off `shown[0]` — sound only
     while the ranking IS the win count, which #895 ends by ranking on the
     Siegwertung while still showing the raw count. */
  const dom = await pokale(t, memberList(4), { m1: 2, m2: 1, m3: 1, m4: 1 });
  const cols = [...dom.app.querySelectorAll('.podium__col')];
  const lead = cols.find((el) => el.classList.contains('podium__col--1'));
  const tied = cols.find((el) => el.classList.contains('podium__col--2'));

  const leadWins = lead.querySelector('.podium__wins');
  assert.equal(leadWins.textContent, '2\u00d7', 'the count is notation on the stage, like the Ø pills');
  assert.match(leadWins.getAttribute('title'), /2 Siege/, 'the phrase it stands for stays one hover away');
  assert.equal(tied.querySelectorAll('.podium__wins').length, 3,
    'a shared step states the count once PER MEMBER, not once for the step');
  for (const el of tied.querySelectorAll('.podium__base')) {
    assert.doesNotMatch(el.textContent, /Sieg/, 'a step must not claim a count its members may not share');
  }

  const entries = [...dom.app.querySelectorAll('.podium__entry')];
  assert.ok(entries.every((e) => e.classList.contains('member-link')));
  assert.deepEqual(entries.map((e) => e.dataset.mid).sort(), ['m1', 'm2', 'm3', 'm4']);
});

test('everyone on one win renders the SHARED TOP STEP, with its risers', async (t) => {
  /* The youngest state of a round, and the one #879 found rendered as a
     full-width tinted band where a stepped silhouette should be. */
  const dom = await pokale(t, memberList(4), { m1: 1, m2: 1, m3: 1, m4: 1 });
  const stage = dom.app.querySelector('.podium');
  assert.ok(stage.classList.contains('podium--single'));
  assert.deepEqual(colOrder(dom), ['2', '1', '3']);
  assert.equal(stage.querySelectorAll('.podium__col--spacer').length, 2, 'the empty risers draw the profile');
  assert.equal(stage.querySelector('.podium__col--1').querySelectorAll('.podium__entry').length, 4);
});

test('an unheld rank beside two held ones is a painted riser, not a hole', async (t) => {
  // {1, 1, 3}: two members tied for the win, one behind them.
  const dom = await pokale(t, memberList(3), { m1: 2, m2: 2, m3: 1 });
  assert.deepEqual(colOrder(dom), ['2', '1', '3']);
  const spacer = dom.app.querySelector('.podium__col--2');
  assert.ok(spacer.classList.contains('podium__col--spacer'));
  assert.equal(spacer.textContent.trim(), '', 'a riser announces nothing');
  assert.equal(spacer.getAttribute('aria-hidden'), 'true');
});

test('members ranked below the third step still appear in the rest line', async (t) => {
  const dom = await pokale(t, memberList(4), { m1: 4, m2: 3, m3: 2, m4: 1 });
  assert.deepEqual(colOrder(dom), ['2', '1', '3']);
  const rest = dom.app.querySelector('.podium__rest');
  assert.ok(rest, 'the fourth-placed member vanished from the screen entirely');
  assert.deepEqual([...rest.querySelectorAll('.podium__rest-name')].map((e) => e.dataset.mid), ['m4']);
});

test('a member who has never won stands off the stage, in the rest line', async (t) => {
  /* Only members with a win can hold a rank (`winners` in views-pokale.js), so
     a winless member is not on a step — but the rest line is the round's whole
     standings, so they are listed there on zero rather than dropped. */
  const dom = await pokale(t, memberList(3), { m1: 2, m2: 1 });
  assert.deepEqual([...dom.app.querySelectorAll('.podium__entry')].map((e) => e.dataset.mid), ['m2', 'm1']);
  const rest = dom.app.querySelector('.podium__rest');
  assert.deepEqual([...rest.querySelectorAll('.podium__rest-name')].map((e) => e.dataset.mid), ['m3']);
  assert.match(rest.textContent, /0 Siege/);
});
