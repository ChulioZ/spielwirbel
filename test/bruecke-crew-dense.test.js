'use strict';

/* Die Brücke's crew from nine people (#1420 — B16.1, the rule B16's head
 * states for every „Platz"): the places break onto a grid and lose their win
 * count, which then stands on the member page. So the seat itself is the way
 * to the count — a real link to that member's page, never a dead square.
 *
 * Runs the real hub under Die Brücke (jsdom) for the markup, and pins the grid
 * as CSS text, since jsdom applies no stylesheet
 * (.claude/rules/testing-views-under-jsdom.md). Klassisch runs on the same
 * twelve-person round to prove it is untouched.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf, mediaBlocks, topLevel } = require('./support/css');

const BRUECKE_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'bruecke.css'), 'utf8');

const NAMES = ['Marco', 'Jonas', 'Aylin', 'Nils', 'Mia', 'Ben', 'Hilde', 'Paul', 'Chris', 'Sofia', 'Tim', 'Lea'];

/* `count` members; Marco has won twice and Jonas once, so a count WOULD print
   on a small crew — the dense crew must drop it, not merely have none. */
const crewRound = (count) => {
  const members = NAMES.slice(0, count).map((name, i) => ({ id: 'm' + (i + 1), name }));
  const play = (id, winner) => ({
    id, createdAt: '2026-09-0' + id + 'T19:00:00.000Z', done: true, finished: true,
    gameIds: [10], chosenGameId: 10, winnerIds: [winner], memberIds: members.map((m) => m.id),
    votes: { m1: { 10: { rating: 5 } } },
  });
  return {
    id: 'r1', name: 'Spieleclub Nordstadt', background: null, marker: 1, tags: [], members,
    games: [{ id: 10, title: 'Nordlichter', minPlayers: 2, maxPlayers: 12, createdAt: '2026-01-01T10:00:00.000Z' }],
    sessions: [play(1, 'm1'), play(2, 'm1'), play(3, 'm2')],
  };
};

async function hub(t, design, round) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async (method, url) => {
    if (/recommendations/.test(url)) return { recommendations: [] };
    if (/activities/.test(url)) return [];
    return round;
  });
  await dom.call('showRound', round.id, 'start');
  return dom;
}

const seatsOf = (dom) => [...dom.app.querySelectorAll('.hero__members > a.avatar:not(.avatar--retired)')];

test('Die Brücke, nine people: the places drop the win count and each links to its member page', async (t) => {
  const round = crewRound(9);
  const dom = await hub(t, 'bruecke', round);
  const row = dom.app.querySelector('.hero__members');
  assert.ok(row.classList.contains('bruecke-crew--dense'), 'nine places did not switch to the dense crew');
  const seats = seatsOf(dom);
  assert.equal(seats.length, 9);
  assert.equal(row.querySelectorAll('.seat__wins, .seat__n').length, 0, 'a dense place still prints a win count');
  seats.forEach((s, i) => {
    assert.equal(s.querySelector('.seat__name').textContent, NAMES[i], 'the place lost its name');
    assert.equal(s.getAttribute('href'), `/round/r1/member/m${i + 1}`, 'the place is not a link to its member page');
    assert.ok(s.classList.contains('member-link'));
  });
  // The rest of the crew is as before: the title counts nine, „Platz dazu" stays.
  assert.equal(dom.app.querySelector('.bruecke-crew__title').textContent, 'Mitglieder · 9');
  assert.equal(dom.app.querySelector('.avatar--add .seat__name').textContent, 'Platz dazu');
});

test('Die Brücke, eight people: the row stays a row, and the counts stay on it', async (t) => {
  const dom = await hub(t, 'bruecke', crewRound(8));
  const row = dom.app.querySelector('.hero__members');
  assert.ok(!row.classList.contains('bruecke-crew--dense'), 'eight places already went dense');
  const seats = seatsOf(dom);
  assert.equal(seats[0].querySelector('.seat__wins').textContent, '2 Siege');
  assert.equal(seats[0].querySelector('.seat__n').textContent, '2');
  assert.equal(seats[1].querySelector('.seat__wins').textContent, '1 Sieg');
});

test('Die Brücke: retired members do not count towards the nine', async (t) => {
  const round = crewRound(10);
  round.members[8].retired = true;
  round.members[9].retired = true;
  const dom = await hub(t, 'bruecke', round);
  assert.ok(!dom.app.querySelector('.hero__members').classList.contains('bruecke-crew--dense'),
    'eight active members and two retired went dense');
});

test('Klassisch with twelve people: no dense crew, no captions', async (t) => {
  const dom = await hub(t, null, crewRound(12));
  const row = dom.app.querySelector('.hero__members');
  assert.ok(!row.classList.contains('bruecke-crew--dense'));
  assert.equal(row.querySelectorAll('.seat__text, .seat__face').length, 0);
});

/* The #1420 section, comments stripped (css-text-assertions-strip-comments.md). */
const section = () => {
  const at = BRUECKE_CSS.indexOf('/* ===== #1420 — ');
  assert.ok(at > 0, 'the #1420 section header is missing');
  const end = BRUECKE_CSS.indexOf('/* ===== ', at + 10);
  return BRUECKE_CSS.slice(at, end).replace(/\/\*[\s\S]*?\*\//g, '');
};

test('bruecke.css: the dense crew is a grid on a phone and two columns from 1280', () => {
  const own = section();
  const base = rulesOf(topLevel(own));
  const phone = base.find(([sel]) => /\.hero__members\.bruecke-crew--dense$/.test(sel));
  assert.ok(phone, 'no base rule for the dense crew');
  assert.match(phone[1], /display: grid/);
  assert.match(phone[1], /grid-template-columns: repeat\(auto-fill, minmax\(var\(--target-key\), 1fr\)\)/);
  const wide = mediaBlocks(own).find(([q]) => /min-width: 1280px/.test(q));
  assert.ok(wide, 'no 1280 block');
  const desk = rulesOf(wide[1]).find(([sel]) => /\.hero__members\.bruecke-crew--dense$/.test(sel));
  assert.ok(desk, 'no 1280 rule for the dense crew');
  assert.match(desk[1], /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('bruecke.css: a crew place is a square with a square focus ring', () => {
  const own = section();
  const ring = rulesOf(own).find(([sel]) => /a\.avatar\.member-link:focus-visible/.test(sel));
  assert.ok(ring, 'no focus ring rule for the crew place');
  assert.match(ring[1], /border-radius: 0/);
  // Every rule in the section is Brücke's own (split on top-level commas only,
  // so an :is(…) group stays one part).
  for (const [sel] of rulesOf(own)) {
    for (const part of sel.split(/,(?![^(]*\))/)) assert.match(part.trim(), /^:root\[data-design="bruecke"\]/, part);
  }
});
