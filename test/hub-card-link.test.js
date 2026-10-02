'use strict';

/* The six hub cards with exactly one destination are clickable anywhere on the
   card (#1506): the Regal, Pokale and Chronik previews, the recommendations
   teaser, the Regal-Steckbrief and „Heute vor einem Jahr".

   The shape is a STRETCHED LINK, not a wrapping <a>: each card keeps its one
   visible, named link, marked `.hub-card__go`, and the card carries
   `.hub-card--link` so one CSS rule spreads that link's hit area over it. So the
   things to pin are which cards carry the pair, that each has exactly one marked
   link and it is a real <a href>, that the multi-destination cards stay out, and
   the rule that does the stretching. Driven through the real `renderStartTab`
   (`.claude/rules/testing-views-under-jsdom.md`). */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');
const { bodyOf } = require('./support/css');

// A linked game (provider data, so the Steckbrief has something to say).
const game = (id, extra = {}) => ({
  id, title: 'Spiel ' + id, minPlayers: 2, maxPlayers: 4, maxPlaytime: 60, weight: 2.4,
  categories: ['Card Game'], mechanics: ['Hand Management'], image: 'c.jpg',
  createdAt: '2026-01-0' + (id % 9 + 1) + 'T10:00:00.000Z', ...extra,
});
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
// Today's date one year back, at noon so no timezone moves it off the day.
const aYearAgo = () => {
  const d = new Date();
  return new Date(d.getFullYear() - 1, d.getMonth(), d.getDate(), 12).toISOString();
};
const play = (id, gid, when, winnerIds = [1]) => ({
  id, createdAt: when, done: true, finished: true,
  gameIds: [gid], chosenGameId: gid, winnerIds, memberIds: [1, 2],
  votes: { 1: { [gid]: { rating: 5 } }, 2: { [gid]: { rating: 4 } } },
});

// Every single-destination card earns its place: nine linked games (more than
// the six-cover strip, past the Steckbrief floor), evenings with winners, and
// one exactly a year ago today.
const fullRound = () => ({
  id: 3,
  name: 'Freitagsrunde',
  members: [{ id: 1, name: 'Anna' }, { id: 2, name: 'Ben' }],
  games: Array.from({ length: 9 }, (_, i) => game(10 + i)),
  sessions: [
    play(900, 10, aYearAgo()),
    play(901, 11, daysAgo(200), [2]),
    play(902, 12, daysAgo(40)),
    play(903, 13, daysAgo(10)),
  ],
  tags: [],
});

async function hub(t, design) {
  const dom = loadApp(design ? { design } : {});
  t.after(() => dom.close());
  dom.set('api', async () => ({
    recommendations: [{ externalId: '1', title: 'Ark Nova', reasons: [{ term: 'quality', rating: 8.5 }] }],
  }));
  const r = fullRound();
  dom.call('renderStartTab', r, r.games);
  await new Promise((done) => setTimeout(done, 0)); // the teaser lands after paint
  return dom;
}

const EXPECTED = [
  '/round/3/regal',
  '/round/3/pokale',
  '/round/3/chronik',
  '/round/3/recommendations',
  '/round/3/shelf-profile',
  '/round/3/session/900',
];

for (const design of [null, 'tisch', 'ocean', 'bruecke', 'programmheft']) {
  test(`${design || 'klassisch'}: the six single-destination cards carry one stretched link each`, async (t) => {
    const dom = await hub(t, design);
    const cards = [...dom.app.querySelectorAll('.hub-card--link')];
    const hrefs = cards.map((card) => {
      const go = card.querySelectorAll('.hub-card__go');
      assert.equal(go.length, 1, `a linked card must hold exactly ONE marked link: ${card.textContent.trim().slice(0, 40)}`);
      assert.equal(go[0].tagName, 'A', 'the stretched link must stay a real <a> for ⌘/middle-click');
      // No second control may hide under the overlay.
      assert.equal(card.querySelectorAll('a, button, input, select, textarea').length, 1,
        'a linked card holds another control, which the overlay would swallow');
      return go[0].getAttribute('href');
    });
    assert.deepEqual([...hrefs].sort(), [...EXPECTED].sort());
  });
}

test('the cards with several destinations stay out of the pattern', async (t) => {
  const dom = await hub(t);
  // A marked link outside a linked card stretches over whatever is positioned
  // above it — never the card it sits in.
  for (const go of dom.app.querySelectorAll('.hub-card__go')) {
    assert.ok(go.closest('.hub-card--link'), `a stray .hub-card__go: ${go.textContent.trim().slice(0, 40)}`);
  }
  // „Wie wär's", Rundenpuls, Kümmerliste — none may be a single hit area.
  for (const card of dom.app.querySelectorAll('.hub-card')) {
    if (card.querySelectorAll('a').length > 1) {
      assert.ok(!card.classList.contains('hub-card--link'),
        `a card with several links was made one click target: ${card.textContent.trim().slice(0, 40)}`);
    }
  }
});

test('the marked link stretches over a positioned card, and its focus ring outlines the card', () => {
  assert.match(bodyOf('.hub-card--link') || '', /position:\s*relative/);
  const after = bodyOf('.hub-card--link .hub-card__go::after') || '';
  assert.match(after, /position:\s*absolute/);
  assert.match(after, /inset:\s*0/);
  assert.match(after, /content:/);
  assert.match(bodyOf('.hub-card--link:has(.hub-card__go:focus-visible)') || '', /outline:/);
});

test('no design puts a second ring on the stretched link — a blanket :focus-visible rule is outranked', () => {
  /* Das Programmheft rings every focused element from one (0,4,0) rule, which
     beat the shared (0,3,0) suppression and drew a ring round the card AND
     round its little foot link. Derived over every design sheet, so the next
     design with a blanket focus rule is covered without editing this. */
  const fs = require('node:fs');
  const path = require('node:path');
  const { rulesOf, outranks } = require('./support/css');
  const dir = path.join(__dirname, '..', 'public', 'css', 'designs');
  const sheets = fs.readdirSync(dir).filter((f) => f.endsWith('.css'));
  assert.ok(sheets.length >= 4, `only ${sheets.length} design sheets found`);
  let blanket = 0;
  for (const f of sheets) {
    const rules = rulesOf(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
    const sels = (pred) => rules.filter(([, b]) => pred(b)).flatMap(([s]) => s.split(',').map((x) => x.trim()));
    // A rule whose subject is any element at all: the last compound is a bare :focus-visible.
    const rings = sels((b) => /outline:\s*(?!none)/.test(b)).filter((s) => /(^|\s):focus-visible$/.test(s));
    const offs = sels((b) => /outline:\s*none/.test(b)).filter((s) => /\.hub-card__go:focus-visible$/.test(s));
    for (const ring of rings) {
      blanket++;
      assert.ok(offs.some((off) => outranks(off, ring)), `${f}: "${ring}" rings the stretched link and nothing outranks it`);
    }
  }
  assert.ok(blanket >= 1, 'no design declares a blanket focus ring any more — this guard is vacuous, delete it');
});
