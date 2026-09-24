'use strict';

/* Der Tisch lets the SESSIONS carry the Chronik (#1271, T13.1/T13.5).
 *
 * Under Der Tisch each session is a strip — [date | cover | title + meta |
 * faces | score pill] — a run of shelf changes folds behind one disclosure, the
 * page names its session count, and the period recap gets a one-line entry that
 * opens it in place on a phone. Under Klassisch none of that exists: the first
 * test pins the Klassisch structure so a Tisch branch that leaks is red.
 *
 * Rendered through the jsdom harness (`.claude/rules/testing-views-under-jsdom.md`).
 * jsdom applies no stylesheet, so which WIDTH shows what (the entry hidden from
 * 521px, the faces hidden below it) is tisch.css's business and was checked in
 * a browser; this spec pins the markup both widths share.
 *
 * Dates are mid-month at noon UTC so no timezone moves a session across a
 * month boundary.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const MEMBERS = ['Anna', 'Ben', 'Cem', 'Dana', 'Emil', 'Fritz'].map((name, i) => ({ id: `m${i + 1}`, name }));
const GAMES = [
  { id: 'g1', title: 'Catan', tagIds: [] },
  { id: 'g2', title: 'Azul', tagIds: [] },
];
const vote = (r1, r2) => ({ g1: { rating: r1 }, g2: { rating: r2 } });

const played = (id, at, { chosen = 'g1', members = ['m1', 'm2', 'm3'], winners = ['m1'], votes } = {}) => ({
  id,
  createdAt: at,
  gameIds: ['g1', 'g2'],
  memberIds: members,
  votes: votes || Object.fromEntries(members.map((m) => [m, vote(4, 2)])),
  finished: true,
  cancelled: false,
  done: true,
  winnerIds: winners,
  chosenGameId: chosen,
  events: [],
});

const ROUND = {
  id: 'r1',
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: MEMBERS,
  games: GAMES,
  sessions: [
    played('s1', '2026-08-20T12:00:00.000Z', { members: MEMBERS.map((m) => m.id) }),
    played('s2', '2026-08-10T12:00:00.000Z', { chosen: 'g2', winners: ['m2'] }),
    played('s3', '2026-07-15T12:00:00.000Z'),
  ],
};

/* Newest first: two August changes between s1 and s2 (a run), one lone July
   change after s3's month header — the two shapes the fold distinguishes. */
const ACTIVITIES = [
  { id: 'a1', type: 'game_added', at: '2026-08-15T12:00:00.000Z', gameId: 'g1', title: 'Catan' },
  { id: 'a2', type: 'member_added', at: '2026-08-14T12:00:00.000Z', name: 'Fritz' },
  { id: 'a3', type: 'game_completed', at: '2026-07-10T12:00:00.000Z', gameId: 'g2', title: 'Azul' },
];

function render(t, design, filter) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run(`applyDesign(${JSON.stringify(design)})`);
  if (filter) dom.run(`chronikFilter = ${JSON.stringify(filter)}; chronikFilterRid = 'r1'`);
  dom.call('renderChronikTab', ROUND, ACTIVITIES);
  return dom;
}

const timeline = (dom) => dom.app.querySelector('.timeline');
// The timeline's shape as a list: what each direct child is.
const shape = (dom) => [...timeline(dom).children].map((c) =>
  c.classList.contains('tl-month') ? 'month'
    : c.classList.contains('tl-run') ? 'run'
      : c.querySelector('.session-card') ? 'session' : 'change');

test('Klassisch: the timeline, its cards and the recap are exactly what they were', (t) => {
  const dom = render(t, 'klassisch');
  assert.deepEqual(shape(dom), ['month', 'session', 'change', 'change', 'session', 'month', 'session', 'change'],
    'every change is its own row between the sessions, nothing folded');
  assert.equal(dom.app.querySelectorAll('.tl-run, .session-card--strip, .session-card__date, .session-card__faces, .chronik__count').length, 0,
    'none of the Tisch structure may render under Klassisch');

  const card = timeline(dom).querySelector('.session-card');
  assert.deepEqual([...card.children].map((c) => c.className), ['session-card__img', 'session-card__body']);
  assert.ok(card.querySelector('.session-card__title > .score-pill'), 'the pill still rides in the title');
  const meta = card.querySelector('.session-card__meta').textContent;
  assert.match(meta, /2026/, 'the date still leads the meta line');
  assert.doesNotMatch(meta, /dabei/, 'no seat count in the Klassisch meta');
  assert.equal(dom.app.querySelectorAll('.timeline .tl-dot').length, 6, 'every entry keeps its rail dot');

  const recap = dom.app.querySelector('.precap');
  assert.ok(recap, 'the fixture has a period to recap');
  assert.equal(recap.querySelector('.precap__entry, .precap__panel'), null);
  assert.ok(recap.firstElementChild.classList.contains('section-head'), 'the heading is still the section\'s first child');
});

test('Tisch: each session is a strip — date column first, faces, the pill last', (t) => {
  const dom = render(t, 'tisch');
  const strips = [...timeline(dom).querySelectorAll(':scope > .tl-item > .session-card')];
  assert.equal(strips.length, 3);
  for (const s of strips) {
    assert.ok(s.classList.contains('session-card--strip'));
    assert.deepEqual([...s.children].map((c) => c.classList[0]),
      ['session-card__date', 'session-card__img', 'session-card__body', 'avatar-stack', 'score-pill'],
      'DOM order is the picture\'s order: date, cover, words, faces, pill');
    const date = s.querySelector('.session-card__date');
    assert.equal(date.tagName, 'TIME');
    assert.ok(date.querySelector('.session-card__day').textContent.trim());
    assert.ok(date.querySelector('.session-card__mon').textContent.trim());
    assert.equal(s.querySelector('.session-card__faces').getAttribute('aria-hidden'), 'true',
      'the faces are decoration; the meta says how many were there');
    assert.equal(s.querySelector('.session-card__title .score-pill'), null, 'the pill left the title');
    assert.doesNotMatch(s.querySelector('.session-card__meta').textContent, /2026/, 'the date column carries the date');
    // Its own span, so the phone can drop it (T13.5) while the desktop keeps it.
    assert.match(s.querySelector('.session-card__meta .session-card__rated').textContent, /^ · 2 Spiele bewertet$/);
  }

  const [six, three] = strips;
  assert.equal(six.querySelector('.session-card__day').textContent, '20');
  assert.match(six.querySelector('.session-card__meta').textContent, /6 dabei/);
  // Four faces and a "+2" — a big table must not push the pill off the strip.
  const faces = six.querySelectorAll('.session-card__faces > .avatar');
  assert.equal(faces.length, 5);
  assert.equal(faces[4].textContent, '+2');
  assert.equal(three.querySelectorAll('.session-card__faces > .avatar').length, 3);
  assert.match(three.querySelector('.session-card__meta').textContent, /3 dabei/);

  // The page says what it is: the sessions, and since when.
  assert.match(dom.app.querySelector('.section-head .chronik__count').textContent, /^3 Sessions seit Juli 2026$/);
});

test('Tisch: a run of shelf changes folds behind one disclosure; a lone change stays in place', (t) => {
  const dom = render(t, 'tisch');
  assert.deepEqual(shape(dom), ['month', 'session', 'run', 'session', 'month', 'session', 'change']);

  const run = timeline(dom).querySelector('.tl-run');
  const toggle = run.querySelector('.tl-run__toggle');
  const list = run.querySelector('.tl-run__list');
  assert.equal(toggle.tagName, 'BUTTON');
  assert.match(toggle.textContent, /2 Regal-Änderungen/);
  assert.equal(toggle.getAttribute('aria-controls'), list.id);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(list.hidden, true, 'folded until asked');
  assert.equal(list.querySelectorAll('.tl-act').length, 2, 'both changes are there to unfold');

  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(list.hidden, false);
  // Unfolded, the rows are the ordinary ones — they still open their target.
  assert.ok(list.querySelector('.tl-act__text[href]'), 'the game change still links to the game');
  toggle.click();
  assert.equal(list.hidden, true, 'and folds again');
});

test('Tisch: with „Regal-Änderungen" chosen nothing folds — the changes are the page', (t) => {
  const dom = render(t, 'tisch', 'changes');
  assert.equal(dom.app.querySelectorAll('.tl-run').length, 0);
  assert.equal(timeline(dom).querySelectorAll('.tl-act').length, 3);
});

test('Tisch: the recap has a one-line entry that opens the SAME section in place', (t) => {
  const dom = render(t, 'tisch');
  const recap = dom.app.querySelector('.precap');
  assert.ok(recap.classList.contains('precap--entry'));
  const [entry, panel] = recap.children;
  assert.ok(entry.classList.contains('precap__entry') && entry.tagName === 'BUTTON', 'the entry comes first');
  assert.ok(panel.classList.contains('precap__panel'), 'and the panel right after it');
  assert.equal(recap.children.length, 2);
  assert.equal(entry.getAttribute('aria-controls'), panel.id);
  assert.ok(panel.querySelector('h2') && panel.querySelector('.precap__picker'), 'the whole section lives in the panel');
  assert.equal(dom.app.querySelectorAll('.precap__picker').length, 1, 'not a second copy of it');

  const label = entry.querySelector('.precap__entry-label');
  assert.equal(label.textContent, 'Rückblick August 2026');
  // The label follows the picker, so the closed line names what opens.
  const picker = panel.querySelector('.precap__picker');
  picker.value = [...picker.options].find((o) => o.textContent === 'Juli 2026').value;
  picker.dispatchEvent(new dom.window.Event('change'));
  assert.equal(label.textContent, 'Rückblick Juli 2026');

  assert.equal(entry.getAttribute('aria-expanded'), 'false');
  entry.click();
  assert.equal(entry.getAttribute('aria-expanded'), 'true');
  assert.ok(recap.classList.contains('is-open'));
  entry.click();
  assert.equal(entry.getAttribute('aria-expanded'), 'false');
  assert.ok(!recap.classList.contains('is-open'));
});

test('Tisch: the page count agrees with the rail — a cancelled session is listed but not counted', (t) => {
  // The rail's „N Sessions" counts FINISHED sessions (round-rail.js); the
  // Chronik's heading sat beside it and counted every strip, so a round with
  // one cancelled night read „7" beside „6" on the same screen.
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.run('applyDesign("tisch")');
  const cancelled = { ...played('s0', '2026-06-15T12:00:00.000Z'), finished: false, cancelled: true, done: true, winnerIds: [], chosenGameId: null };
  dom.call('renderChronikTab', { ...ROUND, sessions: [...ROUND.sessions, cancelled] }, ACTIVITIES);
  assert.equal(timeline(dom).querySelectorAll('.session-card').length, 4, 'the cancelled night is still in the list');
  assert.match(dom.app.querySelector('.section-head .chronik__count').textContent, /^3 Sessions seit Juli 2026$/,
    'counted as the rail counts: finished sessions, and since the first of those');
});
