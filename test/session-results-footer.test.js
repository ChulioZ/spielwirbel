'use strict';

/* Klassisch's result foot (#1575): „Noch eine Session" · „Teilen" · „Mehr",
   under the table band and ahead of the ranking, with cancelling, deleting and
   the other corrections behind „Mehr" — the composed designs' foot (#1275),
   which replaced the link row #614 had put under the session log. That row
   offered no next evening at all on a reopened result.

   What is guarded is PLACEMENT and MENU CONTENT, so the screen is rendered for
   real through the jsdom harness (.claude/rules/testing-views-under-jsdom.md).
   The design-specific foot tests for Der Tisch live in tisch-result-tafel.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');
const { mediaBlocks, rulesOf } = require('./support/css');

const ME = 'user-me';

function roundFixture(over = {}) {
  return {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    members: [
      { id: 'm1', name: 'Anna', userId: ME },
      { id: 'm2', name: 'Ben' },
    ],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [],
    ...over,
  };
}

// Two games with votes, nothing chosen and nothing finished — the only state in
// which the cancel control is offered at all. `events` is not incidental: the
// foot has to land before the session log, and with no events
// `renderSessionLog` returns null and that half of the assertion goes vacuous.
function sessionFixture(over = {}) {
  return {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2'],
    events: [
      { at: '2026-08-02T18:00:00.000Z', type: 'started', actor: 'm1' },
      { at: '2026-08-02T18:05:00.000Z', type: 'voted', actor: 'm1', personId: 'm1' },
    ],
    votes: {
      m1: { g1: { rating: 5 }, g2: { rating: 3 } },
      m2: { g1: { rating: 4 }, g2: { rating: 2 } },
    },
    votedIds: ['m1', 'm2'],
    done: true,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: null,
    ...over,
  };
}

async function results(t, over = {}) {
  const round = roundFixture();
  const session = sessionFixture(over);
  round.sessions = [session];
  const dom = loadApp();
  t.after(() => dom.close());
  const sent = [];
  dom.set('api', async (method, path) => { sent.push({ method, path }); return round; });
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('canShareResult', () => true);
  await dom.call('showResults', round, session);
  return { dom, sent };
}

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const screen = (dom) => dom.app.querySelector('.result-screen');
const foot = (dom) => screen(dom).querySelector('.result-foot');
const flush = () => new Promise((r) => setImmediate(r));

/** Open „Mehr" and return its options' labels and the nodes. */
function moreMenu(dom) {
  foot(dom).querySelector('.result-foot__more').click();
  const opts = [...dom.document.querySelectorAll('.popover .popover__opt')];
  return { opts, labels: opts.map(text) };
}

/** Does `a` come before `b` in document order? */
function precedes(dom, a, b) {
  return !!(a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
}

test('a reopened Klassisch result ends on „Noch eine Session" · „Teilen" · „Mehr"', async (t) => {
  const { dom } = await results(t, { finished: true, chosenGameId: 'g1' });
  const f = foot(dom);
  assert.ok(f, 'Klassisch renders the foot');
  assert.equal(f.hidden, false);
  assert.deepEqual([...f.children].map(text), ['Noch eine Session', 'Teilen', 'Mehr']);
  assert.equal(screen(dom).querySelector('.page-head--result').children.length, 1,
    '„Teilen" left the head for the foot');
  assert.equal(screen(dom).querySelector('.result-footer'), null, 'the old link row is gone');
});

test('the foot follows the table band and comes before the ranking and the log', async (t) => {
  const { dom } = await results(t, { chosenGameId: 'g1' });
  const f = foot(dom);
  const tisch = screen(dom).querySelector('.tisch');
  assert.ok(tisch && !tisch.hidden, 'a chosen game renders the table band');
  assert.equal(precedes(dom, tisch, f), true, 'the foot comes after the band');
  assert.equal(precedes(dom, f, screen(dom).querySelector('.trow')), true, 'and before the first row');
  assert.equal(precedes(dom, f, screen(dom).querySelector('.session-log')), true, 'and before the log');
});

test('Klassisch composes two columns: head, people, band and foot beside the ranking', async (t) => {
  const { dom } = await results(t, { finished: true, chosenGameId: 'g1' });
  const s = screen(dom);
  assert.ok(s.classList.contains('result-screen--klassisch'));
  assert.deepEqual([...s.children].map((c) => c.className),
    ['klassisch-result__side', 'klassisch-result__tafel']);
  const [side, list] = s.children;
  assert.deepEqual([...side.children].map((c) => c.className.split(' ')[0]),
    ['page-head', 'result-people', 'badge-moment', 'tisch-slot', 'result-foot']);
  assert.ok(list.querySelector(':scope > .tafel'), 'the ranking is in the second column');
});

test('while nothing is chosen there is no next evening yet, and „Mehr" offers cancel before delete', async (t) => {
  const { dom } = await results(t);
  assert.equal(foot(dom).querySelector('.result-foot__again'), null);
  const { opts, labels } = moreMenu(dom);
  const cancel = labels.indexOf('Session abbrechen');
  const del = labels.indexOf('Session löschen');
  assert.ok(cancel >= 0 && del > cancel, `cancel then delete, got ${JSON.stringify(labels)}`);
  assert.equal(opts[cancel].dataset.kind, 'destructive');
});

/* #1360: the confirm's two buttons used to read „Abbrechen" and „Session
   abbrechen" side by side — opposite answers in nearly the same word. */
test('the cancel confirm offers „Weiterspielen" as the way back', async (t) => {
  const { dom } = await results(t);
  const asked = [];
  dom.set('confirmDialog', async (o) => { asked.push(o); return false; });
  moreMenu(dom).opts.find((o) => /Session abbrechen/.test(o.textContent)).click();
  await flush();
  assert.equal(asked.length, 1, 'the cancel item raised no confirm');
  assert.equal(asked[0].cancelLabel, 'Weiterspielen');
  assert.equal(asked[0].confirmLabel, 'Session abbrechen');
});

test('a cancelled session offers the next evening and the undo in place of cancel', async (t) => {
  const { dom } = await results(t, { cancelled: true });
  assert.ok(foot(dom).querySelector('.result-foot__again'), 'cancelled is settled too');
  const { labels } = moreMenu(dom);
  assert.ok(labels.some((l) => /rückgängig/i.test(l)), `undo expected, got ${JSON.stringify(labels)}`);
  assert.ok(!labels.includes('Session abbrechen'));
});

for (const [label, over] of [
  ['a game is chosen', { chosenGameId: 'g1' }],
  ['the session is finished', { finished: true, chosenGameId: 'g1' }],
]) {
  test(`no cancel once ${label}, and delete stays behind „Mehr"`, async (t) => {
    const { dom } = await results(t, over);
    const { labels } = moreMenu(dom);
    assert.ok(!labels.includes('Session abbrechen'), 'the cancel item must be gone');
    assert.ok(labels.includes('Session löschen'), 'delete stays');
  });
}

test('„Session löschen" behind „Mehr" deletes the session as before', async (t) => {
  const { dom, sent } = await results(t, { finished: true, chosenGameId: 'g1' });
  dom.set('confirmDialog', async () => true);
  dom.set('showRound', () => {});
  moreMenu(dom).opts.find((o) => /Session löschen/.test(o.textContent)).click();
  await flush();
  assert.ok(sent.some((c) => c.method === 'DELETE' && /\/sessions\/s1$/.test(c.path)));
});

/* jsdom applies no external stylesheet, so the two-column arrangement is a CSS
   fact: asserted over the real rule, inside the 1280px block and nowhere else
   (.claude/rules/css-text-assertions-strip-comments.md). */
test('the two columns open at 1280px, and below it the screen stays one column', () => {
  const wide = mediaBlocks().filter(([q]) => /min-width:\s*1280px/.test(q) && !/height/.test(q))
    .flatMap(([, css]) => rulesOf(css))
    .find(([sel]) => sel.trim() === '.result-screen--klassisch');
  assert.ok(wide, 'expected a .result-screen--klassisch rule inside a 1280px block');
  assert.match(wide[1], /display:\s*grid/);
  assert.match(wide[1], /grid-template-columns/);
});
