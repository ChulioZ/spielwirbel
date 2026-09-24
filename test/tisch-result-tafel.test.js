'use strict';

/* Der Tisch's session result, composed as T2.5 (390) and T4.4 (1440) draw it
 * (#1275): a column-header row over compact rows ending in a score pill, the
 * distribution behind a per-row disclosure, „Wer dabei war" as crowned pieces
 * on the felt head, and a foot of „Noch eine Session" · „Teilen" · „Mehr".
 *
 * Two halves, and the first is the one the issue's acceptance hangs on:
 * KLASSISCH IS UNCHANGED. Its structure is pinned as a signature of the screen's
 * blocks and of one row's cells — the parts this change branches — so a Tisch
 * branch that leaks into the default path goes red by name. Seen red by forcing
 * the branch on for Klassisch (the PR says how).
 *
 * Driven through the jsdom harness (.claude/rules/testing-views-under-jsdom.md);
 * the layout itself — the subgrid that keeps the header over its columns — is
 * CSS, which jsdom cannot see, and is pinned as text at the end.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, flush } = require('./support/dom');

const ME = 'user-me';

function fixture(over = {}, roundOver = {}) {
  const session = {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    finishedAt: '2026-08-02T22:10:00.000Z',
    gameIds: ['g1', 'g2', 'g3'],
    memberIds: ['m1', 'm2'],
    guests: [{ id: 'x1', name: 'Dana' }],
    votes: {
      m1: { g1: { rating: 5 }, g2: { rating: 3 } },
      m2: { g1: { rating: 4 }, g2: { rating: 2 } },
      x1: { g1: { rating: 4 }, g2: { rating: 1 } },
    },
    votedIds: ['m1', 'm2', 'x1'],
    done: true,
    cancelled: false,
    finished: true,
    winnerIds: ['m1'],
    chosenGameId: 'g1',
    events: [],
    ...over,
  };
  const round = {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    members: [
      { id: 'm1', name: 'Anna', userId: ME },
      { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Clara' },
    ],
    games: [
      { id: 'g1', title: 'Catan', tagIds: [], minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', tagIds: [], minPlayers: 1, maxPlayers: 8 },
      // Added after the vote: in a voted session, but nobody rated it.
      { id: 'g3', title: 'Codenames', tagIds: [], minPlayers: 1, maxPlayers: 8 },
    ],
    ...roundOver,
  };
  round.sessions = [session];
  return { round, session };
}

async function show(t, design, over = {}, roundOver = {}, opts = {}) {
  const { round, session } = fixture(over, roundOver);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sent = [];
  dom.set('api', async (method, p, body) => {
    sent.push({ method, path: p, body: body && JSON.parse(JSON.stringify(body)) });
    if (method === 'POST' && /\/finish$/.test(p)) {
      return { ...session, finished: body.finished !== false, winnerIds: body.winnerIds || [] };
    }
    return {};
  });
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  dom.set('canShareResult', () => true);
  dom.set('roundCan', () => opts.canDelete !== false);
  dom.run(`applyDesign('${design}')`);
  await dom.call('showResults', round, session);
  return { dom, sent, round, session };
}

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const screen = (dom) => dom.app.querySelector('.result-screen');
const rowByTitle = (dom, title) => [...dom.app.querySelectorAll('.trow')]
  .find((r) => text(r.querySelector('.trow__title')).startsWith(title));
const kids = (el) => [...el.children].map((c) => c.className);

/* ------------------------------ Klassisch, unchanged ------------------------------ */

test('Klassisch keeps its blocks, its row cells and its footer exactly as before', async (t) => {
  const { dom } = await show(t, 'klassisch');
  // The screen's blocks, in order. Der Tisch moves the people into the head and
  // replaces the footer; none of that may reach this path.
  assert.deepEqual(kids(screen(dom)), [
    'page-head page-head--result', 'result-people', 'tisch-slot', 'tafel', 'tisch-bar',
    'section result-footer',
  ]);
  // The head keeps „Teilen" as its second child, as it has since #526.
  const head = screen(dom).querySelector('.page-head--result');
  assert.equal(head.children.length, 2);
  assert.match(text(head.children[1]), /Teilen/);
  // One row's cells, in DOM order — the distribution BETWEEN the title and the
  // score, and the score a number over its name.
  const catan = rowByTitle(dom, 'Catan');
  assert.deepEqual(kids(catan), [
    'trow__rank trow__rank--1', 'trow__img game-link nav-link', 'trow__main', 'trow__bars', 'trow__score', 'trow__action',
  ]);
  assert.equal(text(catan.querySelector('.trow__rank')), '1');
  assert.ok(catan.querySelector('.score-big'), 'the score is a number');
  assert.ok(catan.querySelector('.score-label .score-info'), 'with the ⓘ on the first scored row');
  assert.equal(catan.querySelector('.trow__bars').hidden, false, 'the distribution is always shown');
  // Nothing of Der Tisch's structure leaks into the default path.
  assert.equal(dom.app.querySelector(
    '.tafel__cols, .trow__votes, .trow__pill, .result-foot, .result-people__crown, [data-pid]'), null);
  // The people carry no crown and no piece id.
  assert.equal(dom.app.querySelectorAll('.result-people__person').length, 3);
});

/* ----------------------------------- Der Tisch ----------------------------------- */

test('Der Tisch heads the Tafel with an aria-hidden row naming the four columns', async (t) => {
  const { dom } = await show(t, 'tisch');
  const cols = dom.app.querySelector('.tafel > .tafel__cols');
  assert.ok(cols, 'the header row is a direct child of the Tafel, so it can share its tracks');
  assert.equal(cols.getAttribute('aria-hidden'), 'true');
  assert.deepEqual([...cols.children].map(text), ['Platz', 'Spiel', 'Wertungen', 'Score']);
  // …above the first row, the gold group's included.
  const first = dom.app.querySelector('.tafel-top, .tafel > .trow');
  assert.ok(cols.compareDocumentPosition(first) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  // The score's ⓘ rides the heading now, since „Score" replaces the row label.
  assert.ok(dom.app.querySelector('.tafel__kick .score-info'));
  assert.equal(dom.app.querySelector('.score-label'), null);
});

test('each row is one compact line: rank, cover, title, votes, pill, action — distribution last', async (t) => {
  const { dom } = await show(t, 'tisch');
  const catan = rowByTitle(dom, 'Catan');
  assert.deepEqual(kids(catan), [
    'trow__rank trow__rank--1', 'trow__img game-link nav-link', 'trow__main', 'trow__votes', 'score-pill trow__pill',
    'trow__action', 'trow__bars',
  ]);
  // The row says what its cells are, since the header is hidden from AT.
  assert.equal(text(catan.querySelector('.trow__rank')), 'Platz 1');
  const pill = catan.querySelector('.trow__pill');
  assert.equal(text(pill), 'Spielwirbel-Score 4,3');
  assert.ok(pill.dataset.stop, 'the pill carries its rung, which the design paints');
  assert.match(pill.getAttribute('style'), /^--sc:/, 'and its colour as a token, never inline');
  assert.equal(catan.querySelector('.score-big'), null);
});

test('the distribution is one press away, behind the votes count', async (t) => {
  const { dom } = await show(t, 'tisch');
  const catan = rowByTitle(dom, 'Catan');
  const toggle = catan.querySelector('button.trow__votes');
  const bars = catan.querySelector('.trow__bars');
  assert.equal(text(toggle), '3');
  assert.equal(toggle.getAttribute('aria-label'), 'Verteilung der 3 Wertungen');
  assert.equal(toggle.getAttribute('aria-controls'), bars.id);
  assert.equal(bars.hidden, true, 'receded by default');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(bars.querySelectorAll('.bar-col').length, 5, 'the whole distribution is still there');

  toggle.click();
  assert.equal(bars.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  toggle.click();
  assert.equal(bars.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('a row nobody rated says so in both columns and has nothing to disclose', async (t) => {
  const { dom } = await show(t, 'tisch');
  const cn = rowByTitle(dom, 'Codenames');
  assert.equal(cn.querySelector('button.trow__votes'), null);
  assert.equal(text(cn.querySelector('.trow__votes--none')), '–');
  assert.ok(cn.querySelector('.trow__pill.score-pill--none'));
  assert.equal(cn.querySelector('.trow__bars'), null);
});

test('a session nobody voted in gets no header and no votes or score cells', async (t) => {
  const { dom } = await show(t, 'tisch', { votes: {}, votedIds: [], finished: false, winnerIds: [], chosenGameId: null });
  assert.equal(dom.app.querySelector('.tafel__cols'), null);
  assert.equal(dom.app.querySelector('.trow__votes, .trow__pill, .trow__bars, .score-info'), null);
  assert.equal(dom.app.querySelectorAll('.trow').length, 3, 'the candidates are still listed');
});

test('„Wer dabei war" sits on the felt head, with a crown on every winner', async (t) => {
  const { dom } = await show(t, 'tisch');
  const head = screen(dom).querySelector('.page-head--result');
  const people = head.querySelector('.result-people');
  assert.ok(people, 'the people are inside the head');
  assert.ok(!kids(screen(dom)).includes('result-people'), 'and no longer a block of their own');
  const winners = [...people.querySelectorAll('.result-people__person.is-winner .result-people__name')].map(text);
  assert.deepEqual(winners, ['Anna']);
  assert.equal(people.querySelectorAll('.result-people__crown').length, 3, 'every piece can wear one');
  assert.equal(people.querySelector('.result-people__crown').getAttribute('aria-hidden'), 'true');
  // Members still open their page; the guest is still a span.
  assert.equal(people.querySelectorAll('a.result-people__person').length, 2);
});

test('the crowns follow the record: reset takes them off, a new winner puts one on', async (t) => {
  const { dom } = await show(t, 'tisch');
  const crowned = () => [...dom.app.querySelectorAll('.is-winner .result-people__name')].map(text);
  const press = (rx) => [...dom.app.querySelectorAll('.tisch button')].find((b) => rx.test(b.textContent)).click();
  assert.deepEqual(crowned(), ['Anna'], 'the stored winner, before anything moves');
  press(/Zurücksetzen/);
  await flush();
  assert.deepEqual(crowned(), [], 'an unfinished evening crowns nobody');
  press(/Als gespielt markieren/);
  await flush();
  [...dom.app.querySelectorAll('.winner-chip')].find((c) => /Ben/.test(c.textContent)).click();
  await flush();
  assert.deepEqual(crowned(), ['Ben'], 'the winner just recorded, without a re-render of the screen');
});

test('a settled session ends on „Noch eine Session" · „Teilen" · „Mehr"', async (t) => {
  const { dom } = await show(t, 'tisch');
  const foot = screen(dom).lastElementChild;
  assert.equal(foot.className, 'result-foot', 'the foot is the last block on the screen');
  assert.equal(foot.hidden, false);
  assert.deepEqual([...foot.children].map(text), ['Noch eine Session', 'Teilen', 'Mehr']);
  assert.equal(screen(dom).querySelector('.result-footer'), null, 'Klassisch’s footer row is replaced');
  assert.equal(screen(dom).querySelector('.page-head--result').children.length, 1, '„Teilen" left the head');
});

test('„Noch eine Session" opens the setup for this round with tonight’s members', async (t) => {
  const { dom, round } = await show(t, 'tisch');
  const calls = [];
  dom.set('showStartSession', (r, prefill) => calls.push({ id: r.id, prefill }));
  screen(dom).querySelector('.result-foot__again').click();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ id: round.id, prefill: { memberIds: ['m1', 'm2'] } }],
    'the members who played — the guest was named for this session only');
});

test('„Noch eine Session" is disabled exactly as the hub disables the start', async (t) => {
  const { dom } = await show(t, 'tisch', {}, {
    games: [{ id: 'g1', title: 'Catan', tagIds: [], retired: true }, { id: 'g2', title: 'Azul', tagIds: [], completed: true },
      { id: 'g3', title: 'Codenames', tagIds: [], wish: true }],
  });
  const again = screen(dom).querySelector('.result-foot__again');
  assert.equal(again.disabled, true);
  assert.ok(again.title);
});

test('while the evening runs there is no next one yet — and „Mehr" holds the cancel', async (t) => {
  const { dom } = await show(t, 'tisch', { finished: false, winnerIds: [], chosenGameId: null });
  const foot = screen(dom).querySelector('.result-foot');
  assert.deepEqual([...foot.children].map(text), ['Teilen', 'Mehr']);
  foot.querySelector('.result-foot__more').click();
  const menu = dom.document.querySelector('.popover');
  assert.deepEqual([...menu.querySelectorAll('.popover__opt')].map(text), ['Session abbrechen', 'Session löschen']);
});

test('„Mehr" runs the same delete Klassisch’s footer does', async (t) => {
  const { dom, sent } = await show(t, 'tisch');
  dom.set('confirmDialog', async () => true);
  dom.set('showRound', () => {});
  const more = screen(dom).querySelector('.result-foot__more');
  more.click();
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  const del = [...dom.document.querySelectorAll('.popover__opt')].find((b) => /löschen/.test(b.textContent));
  assert.equal(del.dataset.kind, 'destructive');
  del.click();
  await flush();
  assert.ok(sent.some((c) => c.method === 'DELETE' && /\/sessions\/s1$/.test(c.path)));
  assert.equal(more.getAttribute('aria-expanded'), 'false', 'closing the menu syncs the trigger');
});

test('with nothing to offer, the foot shows no „Mehr" rather than an empty menu', async (t) => {
  const { dom } = await show(t, 'tisch', {}, {}, { canDelete: false });
  const foot = screen(dom).querySelector('.result-foot');
  assert.deepEqual([...foot.children].map(text), ['Noch eine Session', 'Teilen']);
});

/* ------------------------- the setup's `memberIds` prefill ------------------------- */

async function setup(t, prefill, members) {
  const { round } = fixture({}, members ? { members } : {});
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('isLoggedIn', () => false);
  await dom.call('showStartSession', round, prefill);
  return [...dom.app.querySelectorAll('.nr-seat[aria-pressed]')]
    .filter((s) => !s.classList.contains('nr-seat--guest'))
    .map((s) => [s.getAttribute('title'), s.getAttribute('aria-pressed')]);
}

test('without the prefill the setup seats every member, as it always has', async (t) => {
  assert.deepEqual(await setup(t, undefined), [['Anna', 'true'], ['Ben', 'true'], ['Clara', 'true']]);
});

test('`memberIds` seats exactly those members', async (t) => {
  assert.deepEqual(await setup(t, { memberIds: ['m1', 'm2'] }), [['Anna', 'true'], ['Ben', 'true'], ['Clara', 'false']]);
});

test('`memberIds` naming nobody still seated falls back to everyone, never an empty table', async (t) => {
  assert.deepEqual(await setup(t, { memberIds: ['gone'] }), [['Anna', 'true'], ['Ben', 'true'], ['Clara', 'true']]);
});

/* ------------------------------------ the CSS ------------------------------------ */

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const HOOK = ':root[data-design="tisch"][data-scheme="dark"]';
const body = (sel) => {
  const i = CSS.indexOf(`${HOOK} ${sel} {`);
  return i < 0 ? null : CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i));
};

test('the header and every row share the Tafel’s tracks, so a label cannot leave its column', () => {
  assert.match(body('.result-screen .tafel'), /display:\s*grid/);
  const sub = CSS.indexOf(`${HOOK} .result-screen .tafel__cols {`);
  const group = CSS.slice(CSS.lastIndexOf('}', sub) + 1, CSS.indexOf('}', sub));
  assert.match(group, /\.result-screen \.tafel-top,[\s\S]*\.result-screen \.tafel \.trow,[\s\S]*\.result-screen \.tafel__cols/);
  assert.match(group, /grid-template-columns:\s*subgrid/);
});

test('the grid is scoped to the result screen, and gives back the attributes it outranks', () => {
  // The landing page prints a `.tafel` in the app's own row markup.
  assert.equal(body('.tafel') && /display:\s*grid/.test(body('.tafel')), false);
  assert.match(body('.result-screen .tafel[hidden]'), /display:\s*none/);
  assert.match(body('.result-screen .tafel .trow .trow__bars[hidden]'), /display:\s*none/);
  assert.match(body('.result-foot[hidden]'), /display:\s*none/);
});

// Found in the merge interview (2026-09-24), present on main before this PR: the
// row's „…" is a `.btn`, so under Tisch it took the walnut button fill with the
// paper's ink on it — a dark glyph on a dark tile, ~1.3:1, under the 3:1 a
// control needs. On the paper Tafel it is drawn the way `.trow__votes` is.
test('the row menu on the paper Tafel has no fill and inherits the row’s ink', () => {
  const b = body('.result-screen .tafel .trow .trow__menu');
  assert.ok(b, 'no Tisch rule for the row menu on the result Tafel');
  assert.match(b, /background:\s*transparent/);
  // No ink of its own: it would outrank the gold row's single-ink sweep
  // (test/tisch-session.test.js), putting paper ink on the gold row.
  assert.doesNotMatch(b, /(^|;)\s*color:/);
  assert.match(b, /border:\s*1px solid var\(--line\)/);
});

// The chosen row's ring was an INSET box-shadow, which paints with the row's
// background — so the score fill (`.trow::before`) covered it and only the
// stretch past --pct showed, as a stray bracket on the right. An outline paints
// above the row's content, so the ring is whole at every --pct.
test('the chosen row is ringed by an outline, which the score fill cannot cover', () => {
  const b = body('.result-screen .tafel .trow.is-chosen');
  assert.ok(b, 'no Tisch rule for the chosen row');
  assert.match(b, /box-shadow:\s*none/);
  assert.match(b, /outline:\s*2px solid var\(--gold-edge\)/);
  assert.match(b, /outline-offset:\s*-2px/);
});
