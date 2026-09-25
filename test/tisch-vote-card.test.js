'use strict';

/* Der Tisch's vote card (#1268 — T2.4, T4.2, T12.5).
 *
 * Under Der Tisch both vote cards — the hot-seat one (startVoting) and the
 * link one (renderVoteLinkCards) — are composed by public/js/vote-card-tisch.js:
 * a header on the felt, the card with cover and meta, five worded faces, and on
 * a shared device a hand-off line. The link opens on a felt intro.
 *
 * Klassisch must not move at all, so the first two tests pin its DOM exactly as
 * it was before this issue: the card's children in order, the faces' markup and
 * names, the claim screen's head. Seen red by pointing the Klassisch branch at
 * the Tisch builder on purpose.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');
const { setMotion, beat } = require('./support/vote-card');

const ME = 'user-me';

const roundFixture = () => ({
  id: 'r1',
  name: 'Donnerstagsrunde',
  background: null,
  members: [
    { id: 'm1', name: 'Anna' },
    { id: 'm2', name: 'Ben', userId: ME },
    { id: 'm3', name: 'Cleo' },
    { id: 'm4', name: 'Dana' },
  ],
  games: [],
  sessions: [],
  tags: [],
});

const GAMES = [
  { id: 'g1', title: 'Kartographen', minPlayers: 2, maxPlayers: 5, minPlaytime: 45, ownerIds: ['m3'] },
  { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
];

const sessionFixture = (over = {}) => ({
  id: 's1',
  createdAt: '2026-09-24T18:00:00.000Z',
  gameIds: ['g1', 'g2'],
  memberIds: ['m1', 'm2', 'm3', 'm4'],
  guests: [],
  votes: {},
  votedIds: [],
  done: false,
  cancelled: false,
  finished: false,
  winnerIds: [],
  chosenGameId: null,
  ...over,
});

const ANNA = { id: 'm1', name: 'Anna', guest: false };

async function wizard(t, { design = null, session = sessionFixture(), skipIntro = true, me = null } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async () => roundFixture());
  dom.set('currentUserId', () => me);
  await dom.call('startVoting', roundFixture(), session, GAMES, [ANNA], {
    skipIntro,
    saveVotes: async () => {},
    onSaved: async () => {},
  });
  // skipIntro:false opens on the handover screen; step past it to the card.
  if (!skipIntro) dom.app.querySelector('#goBtn').click();
  return dom;
}

const BALLOT = {
  roundName: 'Donnerstagsrunde',
  demo: false,
  games: [
    { id: 'g1', title: 'Kartographen', minPlayers: 2, maxPlayers: 5, minPlaytime: 45 },
    { id: 'g2', title: 'Azul', minPlayers: 2, maxPlayers: 4 },
  ],
  people: [{ id: 'm1', name: 'Anna', color: null, hasVoted: false, linked: false }],
};

function linkPage(t, design) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  setMotion(dom, true);
  // The link page forces FACE_DESIGN in showVoteLink, so the renderers are
  // called directly with the design under test — Der Tisch is the face since
  // the flip (#1202), and Klassisch is what an older build drew.
  if (design) dom.run(`applyDesign(${JSON.stringify(design)})`);
  return dom;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const classesOf = (el) => [...el.children].map((c) => c.className.split(' ')[0]);
const moodShape = (b) => [...b.children].map((c) => c.tagName.toLowerCase() + '.' + c.className).join(' ');

/* 1 — KLASSISCH: THE HOT-SEAT CARD IS THE CARD IT WAS. */
test('Klassisch: the hot-seat card keeps its children, faces and names exactly', async (t) => {
  const dom = await wizard(t);
  const card = dom.app.querySelector('.vote');
  assert.equal(card.className, 'vote vote--split');
  assert.deepEqual(classesOf(card),
    ['vote-progress', 'vote__who', 'vote__img', 'vote__title', 'vote__secret', 'vote__q', 'rating', 'rating-scale']);
  assert.equal(text(card.querySelector('.vote__who')), 'Es bewertet: Anna');
  assert.ok(card.querySelector('.vote__who #backBtn.vote__undo .ti-arrow-back-up'), 'the corner undo is unchanged');
  const faces = [...card.querySelectorAll('.mood')];
  assert.equal(faces.length, 5);
  faces.forEach((b, i) => {
    assert.equal(moodShape(b), `i.ti ${dom.run(`ratingFace(${i + 1})`)} span.mood__n`, 'face then number, no word');
    assert.equal(b.getAttribute('aria-label'), `${i + 1} von 5`);
  });
  assert.deepEqual([...card.querySelectorAll('.rating-scale span')].map(text), ['gar nicht', 'unbedingt']);
  assert.equal(dom.app.querySelector('.vote-felt, .vote__card, .vote__handoff, .mood__word'), null);
});

/* 2 — KLASSISCH: THE LINK'S CLAIM SCREEN AND CARD ARE WHAT THEY WERE. */
test('Klassisch: the link claim screen and card keep their head, children and faces', (t) => {
  const dom = linkPage(t, null);
  dom.call('renderVoteLinkClaim', 'tok', BALLOT);
  assert.equal(text(dom.app.querySelector('.live-vote > .page-head h1')), 'Mitstimmen');
  assert.equal(dom.app.querySelector('.vote-link-intro'), null);

  dom.call('renderVoteLinkCards', 'tok', BALLOT, BALLOT.people[0]);
  const card = dom.app.querySelector('.vote');
  assert.equal(card.className, 'vote vote--split');
  assert.deepEqual(classesOf(card), ['vote__who', 'vote__img', 'vote__title', 'vote__q', 'rating', 'rating-scale']);
  assert.equal(text(card.querySelector('.vote__who')), 'Du stimmst ab als Anna');
  const faces = [...card.querySelectorAll('.mood')];
  assert.equal(faces.length, 5);
  faces.forEach((b, i) => assert.equal(b.getAttribute('aria-label'), `${i + 1} von 5`));
  assert.equal(card.querySelector('.mood__word'), null);
});

/* 3 — DER TISCH: HEADER ON THE FELT, THEN THE CARD, THEN THE LINE. */
test('Der Tisch: the hot-seat card is header, card and hand-off line, in that order', async (t) => {
  const dom = await wizard(t, { design: 'tisch', session: sessionFixture({ votedIds: ['m4'] }), skipIntro: false });
  const card = dom.app.querySelector('.vote');
  assert.ok(card.classList.contains('vote--tisch'));
  assert.deepEqual(classesOf(card), ['vote-felt', 'vote__card', 'vote__handoff']);

  const head = card.querySelector('.vote-felt');
  assert.deepEqual(classesOf(head), ['vote__undo', 'vote-felt__who', 'vote-felt__dots', 'vote__secret']);
  assert.equal(text(head.querySelector('.vote-felt__name')), 'Anna wertet');
  // Dana has voted, so Anna is the second of four.
  assert.equal(text(head.querySelector('.vote-felt__count')), 'Spiel 1 von 2 · Person 2 von 4 · Donnerstagsrunde');
  const dots = [...head.querySelectorAll('.vote-felt__dot')];
  assert.deepEqual(dots.map((d) => d.className), ['vote-felt__dot is-current', 'vote-felt__dot']);
  assert.equal(head.querySelector('.vote-felt__dots').getAttribute('aria-hidden'), 'true');

  const paper = card.querySelector('.vote__card');
  assert.deepEqual(classesOf(paper), ['vote__img', 'vote__title', 'vote__meta', 'vote__q', 'rating']);
  assert.equal(text(paper.querySelector('.vote__meta')), '2–5 Personen · 45 Min. · Gehört Cleo');

  const faces = [...paper.querySelectorAll('.mood')];
  assert.deepEqual(faces.map((b) => text(b.querySelector('.mood__word'))),
    ['gar nicht', 'eher nicht', 'wäre okay', 'gern', 'unbedingt']);
  assert.deepEqual(faces.map((b) => b.getAttribute('aria-label')),
    ['1 von 5 – gar nicht', '2 von 5 – eher nicht', '3 von 5 – wäre okay', '4 von 5 – gern', '5 von 5 – unbedingt']);
  assert.equal(card.querySelector('.rating-scale'), null, 'the words replace the two-ended scale');

  // Nobody at this device has a seat, so the next open person in seat order.
  assert.equal(text(card.querySelector('.vote__handoff')),
    'Danach das Gerät weitergeben — Ben ist als Nächstes dran.');
});

/* 4 — THE HAND-OFF LINE NAMES WHOM THE LOBBY WILL LEAD WITH. */
test('the hand-off line follows the lobby: your own seat first, the result last, nothing on your own phone', async (t) => {
  // This device is Ben's, and Ben has not voted: the lobby will lead with him.
  const mine = await wizard(t, { design: 'tisch', skipIntro: false, me: ME,
    session: sessionFixture({ votedIds: [] }) });
  assert.equal(text(mine.app.querySelector('.vote__handoff')),
    'Danach das Gerät weitergeben — Ben ist als Nächstes dran.');

  const cleo = await wizard(t, { design: 'tisch', skipIntro: false, me: ME,
    session: sessionFixture({ votedIds: ['m2'] }) });
  assert.equal(text(cleo.app.querySelector('.vote__handoff')),
    'Danach das Gerät weitergeben — Cleo ist als Nächstes dran.', 'Ben voted, so the first open seat');

  const last = await wizard(t, { design: 'tisch', skipIntro: false,
    session: sessionFixture({ votedIds: ['m2', 'm3', 'm4'] }) });
  assert.equal(text(last.app.querySelector('.vote__handoff')), 'Danach sind alle durch — dann kommt das Ergebnis.');
  assert.match(text(last.app.querySelector('.vote-felt__count')), /Person 4 von 4/);

  // Your own phone: nobody to hand it to, so no line — unless you are last.
  const own = await wizard(t, { design: 'tisch', skipIntro: true });
  assert.equal(own.app.querySelector('.vote__handoff'), null);
  const ownLast = await wizard(t, { design: 'tisch', skipIntro: true,
    session: sessionFixture({ votedIds: ['m2', 'm3', 'm4'] }) });
  assert.equal(text(ownLast.app.querySelector('.vote__handoff')), 'Danach sind alle durch — dann kommt das Ergebnis.');
});

/* 5 — THE COMPOSED CARD STILL RUNS THE WIZARD: a tap advances, the dots move. */
test('Der Tisch: a face tap still advances to the next game', async (t) => {
  const dom = await wizard(t, { design: 'tisch' });
  dom.app.querySelectorAll('.mood')[3].click();
  assert.equal(dom.app.querySelector('.mood.is-selected').getAttribute('aria-pressed'), 'true');
  await beat(dom);
  assert.equal(text(dom.app.querySelector('.vote__title')), 'Azul');
  assert.deepEqual([...dom.app.querySelectorAll('.vote-felt__dot')].map((d) => d.className),
    ['vote-felt__dot is-done', 'vote-felt__dot is-current']);
  assert.equal(dom.app.querySelector('#backBtn').disabled, false, 'the back control is live on the second card');
});

/* 6 — THE LINK UNDER DER TISCH: the felt intro, then the composed card. */
test('Der Tisch: the vote link opens on the felt intro and rates on the composed card', (t) => {
  const dom = linkPage(t, 'tisch');
  dom.call('renderVoteLinkClaim', 'tok', BALLOT);
  const intro = dom.app.querySelector('.live-vote > .vote-link-intro');
  assert.ok(intro, 'the intro takes the page head\'s place');
  assert.equal(dom.app.querySelector('.live-vote > .page-head'), null);
  assert.equal(text(intro.querySelector('.vote-link-intro__mark')), 'Spielwirbel');
  assert.equal(intro.querySelector('h1').className, 'vote-link-intro__title', 'the heading stays an h1');
  assert.equal(text(intro.querySelector('h1')), 'Du wertest für „Donnerstagsrunde“.');
  // The sheet's privacy promise („nobody sees how you rated") is false once
  // the vote resolves, so the operator dropped the promise outright (merge
  // interview, 2026-09-24): the note says only that no account is needed.
  assert.equal(text(intro.querySelector('.vote-link-intro__note')), 'Kein Konto nötig.');
  assert.ok(dom.app.querySelector('#vlClaim .live-vote__hotseat-btn'), 'the claim list is still there');

  dom.call('renderVoteLinkCards', 'tok', BALLOT, BALLOT.people[0]);
  const card = dom.app.querySelector('.vote');
  assert.deepEqual(classesOf(card), ['vote-felt', 'vote__card'], 'no hand-off line on the voter\'s own phone');
  assert.equal(card.querySelector('.vote__secret'), null, 'nor the pill');
  assert.equal(text(card.querySelector('.vote-felt__count')), 'Spiel 1 von 2 · Donnerstagsrunde');
  assert.equal(text(card.querySelector('.vote__meta')), '2–5 Personen · 45 Min.');
  assert.equal(card.querySelectorAll('.mood__word').length, 5);
});

/* 7 — ONE WORD PER RUNG, derived from the scale rather than restated. */
test('there is exactly one word key per rung, and every locale gives five distinct words', (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  assert.equal(dom.run('VOTE_WORD_KEYS.length'), dom.run('RATING_MAX'));
  for (const loc of dom.run('LOCALES.map((l) => l.code)')) {
    dom.run(`setLocale(${JSON.stringify(loc)})`);
    const words = dom.run('VOTE_WORD_KEYS.map((k) => t(k))');
    assert.equal(new Set(words).size, 5, `${loc}: ${words.join(' / ')}`);
    assert.ok(words.every((w) => !w.startsWith('vote.')), `${loc}: a word key is missing`);
  }
});

/* 8 — NOTHING ON THE FELT IS SET IN AN UNMEASURED INK.
 *
 * The felt behind the card is the ROUND'S MARKER. test/a11y-contrast.test.js
 * holds this design's markerInk (= --felt-ink) at 4.5:1 on all eight markers,
 * but measures --felt-ink-soft and gold only on the default felt. So every
 * `color` the new felt rules set must be --felt-ink.
 */
test('the felt header, the hand-off line and the intro set text only in --felt-ink', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  const felt = /\.vote-felt|\.vote--tisch \.vote__(?:undo|secret)|\.vote__handoff|\.vote-link-intro(?!__mark)|\.vote\.vote--tisch/;
  const hits = rulesOf(css).filter(([sel]) => felt.test(sel));
  assert.ok(hits.length >= 8, `only ${hits.length} felt rules found — did the selectors move?`);
  const colours = hits.flatMap(([sel, body]) =>
    [...body.matchAll(/(?:^|[;\s])color:\s*([^;]+)/g)].map((m) => [sel, m[1].trim()]));
  assert.ok(colours.length >= 4, 'no text colour was found on the felt rules');
  const bad = colours.filter(([, v]) => v !== 'var(--felt-ink)');
  assert.deepEqual(bad, [], 'text on the marker felt must be --felt-ink');
});

/* 9 — THE BACK CONTROL KEEPS ITS 44px TARGET IN THE HEADER.
 *
 * styles.css sizes `.vote__undo` from --undo-size, which only `.vote__who`
 * declares. The Tisch header is not inside one, so without its own size the
 * control collapsed to 22px (measured in a browser) — under WCAG 2.5.5's 44px
 * floor on the only way back out of a card.
 */
test('the header\'s back control states its own 44px size', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const hit = rulesOf(css).find(([sel]) => sel.trim().endsWith('.vote--tisch .vote__undo'));
  assert.ok(hit, 'the Tisch undo rule is missing');
  assert.match(hit[1], /(^|[;\s])width:\s*44px/);
  assert.match(hit[1], /(^|[;\s])height:\s*44px/);
});
