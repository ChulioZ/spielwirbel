'use strict';

/* The game detail screen's „Verwandte Sessions" as rubber stamps (#1040).
 *
 * The spread (#1039) put the history on the right page; as `.ds-row`s it was
 * also the tallest thing on that page. A stamp is 150px wide, so six of them
 * fit where six rows scrolled — and the screen is a Spielepass, which is what
 * buys the shape (`.claude/rules/tiles-vs-lists.md` carries the exception).
 *
 * What these assertions are actually for: the stamp collapses a row that used
 * to carry ONE status string into three separately-styled lines plus a corner
 * pill, and each line is conditional on a different `sessionOutcome()` branch.
 * Nothing throws when one of them renders in the wrong branch — a split parent
 * drawn as „gespielt" is a screen that still looks finished, which is the whole
 * reason `session-outcome.js` is a shared file at all.
 *
 * The ink is asserted as a PRESENCE of the `--sc` custom property rather than
 * as a colour: the value comes from `scoreColor()`, whose ramp
 * `test/a11y-contrast.test.js` already owns end to end (including this
 * component's own fill, added there by #1040). Restating an hsl() triple here
 * would pin the ramp in a second place and go red on every retune of it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, translator } = require('./support/dom');
const { bodyOf } = require('./support/css');

const RID = 'r1';
const t = translator('de');

/* One game in six sessions, one per branch the stamp renders differently.
 * Ordered oldest-first in the fixture on purpose — the view sorts newest-first,
 * and a fixture already in the rendered order cannot see a lost sort. */
function roundFixture() {
  return {
    id: RID,
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [{ id: 'g1', title: 'Catan', image: '/uploads/catan.jpg', minPlayers: 3, maxPlayers: 4, tagIds: [] }],
    sessions: [
      // played, rated, with a winner
      {
        id: 's1', createdAt: '2026-06-01T19:00:00.000Z', finished: true,
        gameIds: ['g1'], chosenGameId: 'g1', winnerIds: ['m1'],
        votes: { m1: { g1: { rating: 5 } }, m2: { g1: { rating: 4 } } },
      },
      // played, but nobody rated it — the pill's empty variant
      {
        id: 's2', createdAt: '2026-06-02T19:00:00.000Z', finished: true,
        gameIds: ['g1'], chosenGameId: 'g1', winnerIds: ['m2'], votes: {},
      },
      // chosen but the evening is still running
      {
        id: 's3', createdAt: '2026-06-03T19:00:00.000Z',
        gameIds: ['g1'], chosenGameId: 'g1', votes: { m1: { g1: { rating: 3 } } },
      },
      // in the draw, another game won
      {
        id: 's4', createdAt: '2026-06-04T19:00:00.000Z', finished: true,
        gameIds: ['g1', 'g9'], chosenGameId: 'g9', votes: { m1: { g1: { rating: 2 } } },
      },
      { id: 's5', createdAt: '2026-06-05T19:00:00.000Z', cancelled: true, gameIds: ['g1'], votes: {} },
      { id: 's6', createdAt: '2026-06-06T19:00:00.000Z', gameIds: ['g1'], childSessionIds: ['s7'], votes: {} },
    ],
  };
}

function bootApp(t_) {
  const dom = loadApp();
  t_.after(() => dom.close());
  const round = roundFixture();
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', () => {});
  return dom;
}

const stampsOf = (dom) => [...dom.app.querySelectorAll('.pass__table .stamps .stamp')];

test('every related session renders as a stamp, newest first', async (t_) => {
  const dom = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const stamps = stampsOf(dom);
  assert.equal(stamps.length, 6, 'one stamp per related session');
  assert.equal(stamps[0].getAttribute('href'), `/round/${RID}/session/s6`, 'newest session first');
  assert.equal(stamps[5].getAttribute('href'), `/round/${RID}/session/s1`, 'oldest session last');
  // The row is gone, not merely hidden behind a new class.
  assert.equal(dom.app.querySelector('.pass__table .ds-list'), null,
    'the history is no longer a .ds-list');
});

test('a played stamp names its outcome and its winner on separate lines', async (t_) => {
  const dom = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const played = stampsOf(dom).find((s) => s.getAttribute('href').endsWith('/s1'));
  assert.equal(played.querySelector('.stamp__status').textContent.trim(), t('detail.played'));
  assert.equal(played.querySelector('.stamp__win').textContent.trim(), 'Anna');
  assert.ok(played.querySelector('.stamp__status .ti-circle-check'), 'the outcome carries its icon');
  assert.ok(played.querySelector('.stamp__win .ti-trophy'), 'the winner line carries the trophy');
  assert.ok(!played.classList.contains('stamp--muted'), 'a played stamp is not muted');
});

/* The three branches that are NOT this game's evening. Each was a separate
 * `sessionOutcome()` arm in the row and each has to stay one here: a split
 * parent rendered as „nicht gewählt" would be true-and-useless, and rendered as
 * „gespielt" would be false — neither throws. */
test('not-chosen, cancelled and split sessions are muted stamps with no winner line', async (t_) => {
  const dom = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const by = (id) => stampsOf(dom).find((s) => s.getAttribute('href').endsWith(`/${id}`));
  for (const [id, key] of [['s4', 'detail.notChosen'], ['s5', 'detail.sessionCancelled'], ['s6', 'detail.sessionSplit']]) {
    const el = by(id);
    assert.ok(el.classList.contains('stamp--muted'), `${id} is muted`);
    assert.equal(el.querySelector('.stamp__status').textContent.trim(), t(key), `${id} states its outcome`);
    assert.equal(el.querySelector('.stamp__win'), null, `${id} has no winner line`);
    assert.equal(el.style.getPropertyValue('--sc'), '', `${id} takes no score ink`);
  }
});

/* A session still running took the game but has no result — it is the group's
 * current evening, so it keeps the ink rather than joining the muted three. */
test('a chosen-but-unfinished session keeps the score ink and states no winner', async (t_) => {
  const dom = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const open = stampsOf(dom).find((s) => s.getAttribute('href').endsWith('/s3'));
  assert.ok(!open.classList.contains('stamp--muted'));
  assert.equal(open.querySelector('.stamp__status').textContent.trim(), t('detail.chosen'));
  assert.equal(open.querySelector('.stamp__win'), null, 'no winner on an unfinished session');
  assert.ok(open.style.getPropertyValue('--sc').startsWith('hsl('), 'it is inked from scoreColor()');
});

/* A pill means a number was actually given. The Regal card and the game's own
 * badge print „neu" when a game has no score, because the question they answer
 * („what does this game score?") HAS that answer — a stamp asks what happened on
 * one evening, and an evening nobody rated has no number at all. So no pill,
 * not the empty variant (operator decision, overriding the issue's own
 * acceptance criterion). Checked on a muted stamp too: the reasoning is about
 * the rating being absent, not about which branch rendered it. */
test('a pill appears only where a rating was actually given', async (t_) => {
  const dom = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const by = (id) => stampsOf(dom).find((s) => s.getAttribute('href').endsWith(`/${id}`));
  const rated = by('s1').querySelector('.score-pill');
  assert.ok(rated, 'a rated session shows its own score');
  assert.ok(!rated.classList.contains('score-pill--none'), 'and it is a real pill, not the empty variant');
  assert.equal(by('s2').querySelector('.score-pill'), null, 'a played-but-unrated session prints no pill');
  assert.equal(by('s5').querySelector('.score-pill'), null, 'nor does an unrated cancelled one');
  assert.ok(by('s4').querySelector('.score-pill'), 'a session that rated the game keeps its pill even unchosen');
});

/* The state the issue did not name, and the one with the most room to go wrong:
 * the round CHOSE this game and played it, and then nobody rated it. That is not
 * a blank — putting a game on the table is revealed preference, which is why
 * `vote-score.js` lifts a game's shelf score by its plays — so the stamp takes
 * the ink of a strong evening rather than the muted grey of an evening this game
 * sat out. Its honesty rests on the pill being absent: with a „–" beside it, a
 * green stamp would be claiming a rating the same component says nobody gave. */
test('a played-but-unrated session is inked as a strong evening, not muted', async (t_) => {
  const dom = bootApp(t_);
  await dom.call('showGameDetail', RID, 'g1');
  const el = stampsOf(dom).find((s) => s.getAttribute('href').endsWith('/s2'));
  assert.ok(!el.classList.contains('stamp--muted'), 'it was our evening, so it is not muted');
  assert.equal(el.querySelector('.score-pill'), null, 'and it claims no number');
  const ink = el.style.getPropertyValue('--sc');
  assert.ok(ink.startsWith('hsl('), `expected score-ramp ink, got ${ink}`);
  // Off the ramp's green end but below its top: "chosen" is weaker than "everyone
  // gave it a 5" — a game can win the draw just by fitting the player count.
  const hue = Number(/hsl\((\d+(?:\.\d+)?)/.exec(ink)[1]);
  assert.ok(hue > 90 && hue < 120, `expected a strong-but-not-perfect hue, got ${hue}`);
  const muted = stampsOf(dom).find((s) => s.getAttribute('href').endsWith('/s5'));
  assert.notEqual(ink, muted.style.getPropertyValue('--sc'),
    'it must not read as the evenings this game sat out');
});

/* The acceptance criterion "the pill never overlaps the date at 150px" has no
 * symptom jsdom can see — it has no layout — so what is pinned here is the
 * MECHANISM that decides it. `.score-pill` is `position: absolute; top: 8px;
 * right: 8px` everywhere else (a badge on a cover), and putting it back to that
 * here is the one edit that reintroduces the overlap: a date is a single
 * unbreakable token, 125px at 22px display type against a 130px content box, so
 * it cannot wrap out of a reserved lane and runs under the pill instead.
 * Measured in both engines at both breakpoints before and after (PR #1040). */
test('the score pill stays in the flow, where a date cannot collide with it', () => {
  const { bodyOf } = require('./support/css');
  assert.match(bodyOf('.stamp__foot .score-pill'), /position:\s*static/,
    'an absolute pill lands on the date, which has no break opportunity to escape with');
  assert.match(bodyOf('.stamp__foot'), /align-items:\s*flex-end/,
    'the pill reads as a corner denomination by sitting on the last text line');
});

/* A mask clips to the border box, so an OUTER shadow on `.stamp::before` is
 * painted outside the mask and removed — measured in Chromium against an
 * unmasked control, which showed the shadow while the masked box showed none.
 * The natural place to put the hover lift is exactly that dead one, since the
 * fill and the border already live there, and nothing reports it: the rule
 * parses, computes, and paints nothing. */
test('no shadow is declared on the masked pseudo-element, where it cannot paint', () => {
  const { rulesOf, CSS } = require('./support/css');
  const dead = rulesOf(CSS)
    .filter(([sel, body]) => /\.stamp[^,]*::before/.test(sel) && /box-shadow\s*:(?!\s*none)/.test(body))
    .map(([sel]) => sel);
  assert.deepEqual(dead, [], 'a box-shadow here is clipped away by the worn-edge mask');
  assert.match(bodyOf('.stamp:hover'), /box-shadow/, 'the hover lift belongs on the link itself');
  assert.match(bodyOf('.stamp'), /border-radius/,
    'the link needs the radius too, or the shadow and the focus ring box the stamp');
});

/* The operator rejected tilt outright (2026-09-12): the character comes from
 * the ink, not from an angle. Asserted over the stylesheet because a rotation
 * would be added there, and it is the one acceptance criterion with no visible
 * symptom in the DOM.
 *
 * A PREFIX match, not `\b`. This guard asks „does any rule in this family
 * rotate?", which is the including direction — and `_` is a word character, so
 * the `\.stamps?\b` it shipped with saw `.stamp` and `.stamp--muted` but never
 * `.stamp__date`, i.e. not the line a tilt would most naturally be put on.
 * Measured (#1041): with `transform: rotate(2deg)` on `.stamp__date` the `\b`
 * form stayed GREEN. `.claude/rules/css-text-assertions-strip-comments.md`
 * names this exact inversion — `whole()` is for excluding a family. */
test('no stamp rule rotates anything', () => {
  const { rulesOf, CSS } = require('./support/css');
  const rotated = rulesOf(CSS)
    .filter(([sel, body]) => /(^|[\s,])\.stamps?[\w-]*/.test(sel) && /\brotate\s*\(/.test(body))
    .map(([sel]) => sel);
  assert.deepEqual(rotated, [], 'tilt was rejected for this component');
});
