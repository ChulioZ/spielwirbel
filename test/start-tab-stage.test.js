'use strict';

/* The Start tab's ONE STAGE (#1853), under every registered design.

   The stage is the seats, whatever session is running, the one action and one
   chip row; below it only what a group needs often. So this spec pins, design
   by design:

   - the absences: no Regal/Pokale/Chronik preview, no „Weitere Listen", no
     recommendations teaser, no pulse or Steckbrief card, no count chips, no
     discard link, no separate „Jetzt spielen" and no quick-actions row;
   - what is running comes BEFORE the action, in DOM order;
   - exactly one chip row follows the action, „Direkt wählen" first;
   - Einstellungen stays one link away;
   - „Zu tun · n" counts the Kümmerliste plus the retirement recommendations,
     starts folded, and keeps the recommendations' own actions working.

   Walked over DESIGN_REGISTRY, never a hand-copied list, so a design added
   tomorrow is covered the moment it registers. Rendered through the real
   showRound in the jsdom harness (.claude/rules/testing-views-under-jsdom.md);
   which widths show which copy is CSS, which jsdom cannot see, so the pane's
   copies are read with the rail and the dock left out. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { DESIGN_REGISTRY } = require('../public/js/designs');

const DESIGNS = DESIGN_REGISTRY.map((d) => d.id);
const RID = 'r1';
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const game = (id, extra = {}) => ({
  id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, image: 'c.jpg',
  minPlaytime: 30, maxPlaytime: id % 2 ? 45 : 120, createdAt: '2026-01-02T10:00:00.000Z', ...extra,
});
const play = (id, gid, days, extra = {}) => ({
  id, createdAt: daysAgo(days), done: true, finished: true,
  gameIds: [gid], chosenGameId: gid, winnerIds: ['m1'], memberIds: ['m1', 'm2'],
  votes: { m1: { [gid]: { rating: 5 } }, m2: { [gid]: { rating: 4 } } },
  ...extra,
});

/* A BUSY round: eight games (one without a cover — a Kümmerliste item), three
   played evenings, a vote still running, a session voted and not yet finished,
   and three evenings that rate game 17 at the bottom of the scale, which is
   what puts it on the retirement list (the fixture hub-start-cards.test.js
   measured for that). */
const busyRound = () => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
  games: Array.from({ length: 8 }, (_, i) => game(10 + i, i === 5 ? { image: null } : {})),
  sessions: [
    play('s1', 10, 200),
    play('s2', 11, 40),
    play('s3', 12, 10),
    ...[[1, 1], [2, 2], [3, 3]].map(([a, b], i) => play('b' + i, 10, 300 + i, {
      gameIds: [10, 17],
      votes: { m1: { 10: { rating: 5 }, 17: { rating: a } }, m2: { 10: { rating: 5 }, 17: { rating: b } } },
    })),
    { id: 'open', createdAt: daysAgo(0), gameIds: [10, 11, 12], done: false, cancelled: false, finished: false, memberIds: ['m1', 'm2'], votes: {} },
    { id: 'wip', createdAt: daysAgo(1), gameIds: [13], chosenGameId: 13, done: true, finished: false, cancelled: false, memberIds: ['m1', 'm2'], votes: { m1: { 13: { rating: 4 } } } },
  ],
  tags: [],
  activity: [],
});

async function hub(t, design, round = busyRound()) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design !== 'klassisch') dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async () => round);
  await dom.call('showRound', RID, 'start');
  return dom;
}

// The Start tab's own content: everything in #app but the rail and the dock.
const pane = (dom) => [...dom.app.querySelectorAll('*')].filter((el) => !el.closest('.rail, .dock'));
const inPane = (dom, sel) => pane(dom).filter((el) => el.matches(sel));
const FOLLOWS = (dom) => dom.window.Node.DOCUMENT_POSITION_FOLLOWING;

test('the registry is not empty, so the loops below cannot pass vacuously', () => {
  assert.ok(DESIGNS.length >= 6, `only ${DESIGNS.length} designs registered`);
});

for (const design of DESIGNS) {
  test(`${design}: the Start tab renders none of what #1853 removed`, async (t) => {
    const dom = await hub(t, design);
    const GONE = {
      '.hub-preview, .hub-previews': 'a sub-page preview',
      'nav.hub-demo': 'the condensed preview list',
      '.hub-offshelf, .offshelf-tile': '„Weitere Listen"',
      '.pulse-bars, .pulse-tiles, .forest-locked': 'the Rundenpuls',
      '.hub-card--shelf, .shelf-card__headline': 'the Regal-Steckbrief card',
      '.hero__chips, .stat-chip': 'the count chips',
      '.ticket__discard': 'the discard link',
      '.hub-play': 'the separate „Jetzt spielen"',
      '.hub-actions': 'the quick-actions row',
    };
    for (const [sel, what] of Object.entries(GONE)) {
      assert.deepEqual(inPane(dom, sel).map((el) => el.className), [], `${design}: ${what} is back`);
    }
    assert.ok(!dom.app.textContent.includes('Abstimmung verwerfen'), `${design}: the discard is still offered on Start`);
    // Anti-vacuous: the stage itself rendered, with both running tickets.
    assert.equal(inPane(dom, '.ticket--live').length, 2, `${design}: the running sessions are missing`);
  });

  test(`${design}: what is running comes before the one action, and one chip row follows it`, async (t) => {
    const dom = await hub(t, design);
    const cta = inPane(dom, '.hub-cta')[0];
    assert.ok(cta, `${design}: no CTA in the pane`);
    for (const ticket of inPane(dom, '.ticket--live')) {
      assert.ok(ticket.compareDocumentPosition(cta) & FOLLOWS(dom), `${design}: a running ticket sits below the CTA`);
    }
    const rows = inPane(dom, '.hub-presets');
    assert.equal(rows.length, 1, `${design}: not exactly one chip row`);
    assert.ok(cta.compareDocumentPosition(rows[0]) & FOLLOWS(dom), `${design}: the chip row is above the CTA`);
    const chips = [...rows[0].querySelectorAll('.hub-preset')];
    assert.ok(chips.length >= 2, `${design}: the fixture offers no preset to follow „Direkt wählen"`);
    assert.ok(chips[0].classList.contains('hub-preset--direct'), `${design}: „Direkt wählen" is not first`);
  });

  test(`${design}: Einstellungen is one link away on the Start tab`, async (t) => {
    const dom = await hub(t, design);
    const links = inPane(dom, `a[href="/round/${RID}/settings"]`);
    assert.equal(links.length, 1, `${design}: ${links.length} ways into Einstellungen in the pane`);
    const name = (links[0].getAttribute('aria-label') || links[0].textContent).trim();
    assert.equal(name, 'Einstellungen', `${design}: the settings link has no name`);
  });

  test(`${design}: „Zu tun" counts both lists, starts folded, and opens`, async (t) => {
    const dom = await hub(t, design);
    const r = busyRound();
    const active = r.games;
    // The two halves, asked of the functions the row reads — and each > 0, or
    // the sum would not show that both are counted.
    const care = dom.call('careList', r, active, dom.run('hubDeps()'));
    const careN = care.winnerlessTotal + care.loansTotal + care.noRangeTotal + care.coverlessTotal;
    const { byGame } = dom.call('roundScoreIndex', r, active);
    const recN = dom.call('retireRecommendations', active, byGame, r.members.length * 3).length;
    assert.ok(careN > 0 && recN > 0, `the fixture must trip both lists (care ${careN}, recs ${recN})`);

    const rows = inPane(dom, '.hub-todo');
    assert.equal(rows.length, 1, `${design}: not exactly one „Zu tun" row`);
    const row = rows[0];
    const bar = row.querySelector('.hub-todo__bar');
    assert.equal(bar.tagName, 'BUTTON');
    assert.equal(bar.textContent.trim(), dom.run(`t('hub.todo.label', { n: ${careN + recN} })`));
    const body = row.querySelector('.hub-todo__body');
    assert.equal(bar.getAttribute('aria-expanded'), 'false');
    assert.equal(bar.getAttribute('aria-controls'), body.id);
    assert.equal(body.hidden, true, 'the row must start folded');
    bar.click();
    assert.equal(bar.getAttribute('aria-expanded'), 'true');
    assert.equal(body.hidden, false);
    assert.ok(body.querySelector('a.hub-row'), 'no Kümmerliste link inside');
    assert.ok(body.querySelector('.recommend-item__btn'), 'no retire action inside');
  });
}

test('„Ausblenden" takes the recommendations out of „Zu tun" and leaves the Kümmerliste', async (t) => {
  const dom = await hub(t, 'klassisch');
  const row = dom.app.querySelector('.hub-todo');
  const before = row.querySelector('.hub-todo__label').textContent;
  row.querySelector('.hub-todo__dismiss').click();
  assert.equal(row.querySelector('.hub-todo__recs'), null, 'the recommendations stayed');
  assert.ok(row.isConnected, 'the row went although the Kümmerliste still has an item');
  assert.notEqual(row.querySelector('.hub-todo__label').textContent, before, 'the count did not follow');
  assert.equal(row.querySelector('.hub-todo__label').textContent, dom.run("t('hub.todo.label', { n: 1 })"));
});

test('„Direkt wählen" opens the direct-play picker', async (t) => {
  const dom = await hub(t, 'klassisch');
  const seen = [];
  dom.set('showDirectPlayPicker', (r) => seen.push(r.id));
  inPane(dom, '.hub-preset--direct')[0].click();
  assert.deepEqual([...seen], [RID]);
});

test('the challenge is one slim row in the side column, linking to its Pokale section', async (t) => {
  for (const design of DESIGNS) {
    const r = busyRound();
    r.challenge = { kind: 'sessions', n: 3, startedAt: daysAgo(5), deadline: new Date(Date.now() + 10 * 86400000).toISOString() };
    const dom = await hub(t, design, r);
    const rows = inPane(dom, '.hub-challenge');
    assert.equal(rows.length, 1, `${design}: not one challenge row`);
    assert.equal(rows[0].getAttribute('href'), `/round/${RID}/pokale#challenge`);
    assert.equal(rows[0].closest('.hub-card'), null, `${design}: the challenge is still a card`);
  }
});
