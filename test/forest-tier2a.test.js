'use strict';

/* Forest's tier 2a (#1473, sheet Forest-F13-Tier2a): the Chronik as a path
 * through the sessions with the recap beside it, the Pokale as a grove, the
 * member page's Tischkarte with five figures, the off-shelf lists and the
 * recommendations.
 *
 * Operator ruling „A design owns its layout": the views branch on
 * designIs('forest') only, and Klassisch's DOM must not move. That half is a
 * GOLDEN SNAPSHOT of the seven screens, generated from the views BEFORE #1473
 * touched them, and seen red against a build whose Forest branches were made
 * unconditional. Regenerate only for a change that deliberately alters
 * Klassisch:
 *   SPIELWIRBEL_UPDATE_GOLDEN=1 node --test test/forest-tier2a.test.js
 *
 * The pixels were judged in headless Chromium at 390 and 1440; what is pinned
 * here is what regresses silently —
 *   - a path row that loses its game, its read date or its number, or names a
 *     winnerless night as won;
 *   - the recap moving back above the path, or the phone's entry naming a
 *     different period than the recap shows;
 *   - the grove disagreeing with the standings, or crowning anyone but the
 *     leader, or a silver/bronze colour or an „Auszeichnungen" heading;
 *   - the member page's figures leaving the sheet's order, the favourite game
 *     becoming a number, or „Zuletzt dabei" listing an evening the
 *     „Sessions" figure does not count;
 *   - a rule of the #1473 section reading the gated colour block ungated, or
 *     spelling a colour instead of a token.
 */

process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');

const GOLDEN = path.join(__dirname, 'fixtures', 'forest-tier2a-klassisch-golden.json');
const RID = 'r1';
const MEMBERS = [
  { id: 'm1', name: 'Anna' },
  { id: 'm2', name: 'Ben' },
  { id: 'm3', name: 'Cem' },
  { id: 'm4', name: 'Dora' },
];
// g5 is the ONE active game never played, so „Staubfänger" has no tie to break
// at random and the snapshot is deterministic. g3's title is 30 characters —
// the favourite a member card must wrap (review U2).
const LONG = 'Kartographen des Nordens Delux';
const GAMES = [
  { id: 'g1', title: 'Catan', tagIds: [], ownerIds: ['m1'] },
  { id: 'g2', title: 'Azul', tagIds: [], ownerIds: ['m1'] },
  { id: 'g3', title: LONG, tagIds: [] },
  { id: 'g5', title: 'Kupferzeit', tagIds: [] },
  { id: 'g4', title: 'Monopoly', tagIds: [], retired: true, retiredAt: '2026-06-01T00:00:00.000Z' },
  { id: 'g6', title: 'Heat', tagIds: [], wish: true, wishAt: '2026-06-02T00:00:00.000Z' },
  { id: 'g7', title: 'Brass', tagIds: [], completed: true, completedAt: '2026-06-03T00:00:00.000Z' },
];

const vote = (r) => ({ rating: r });
const played = (id, gid, at, winnerIds, extra = {}) => ({
  id,
  createdAt: at,
  gameIds: [gid],
  memberIds: ['m1', 'm2', 'm3', 'm4'],
  votes: {},
  votedIds: [],
  finished: true,
  cancelled: false,
  done: true,
  winnerIds,
  chosenGameId: gid,
  events: [],
  ...extra,
});

/* Anna 3, Ben 1, Cem 1, Dora 0 — a shared second place and a member who never
   won. s4 is voted (a score, and Anna's favourite), s6 is played with no
   winner, s7 was cancelled, and Dora sat out s5. */
const SESSIONS = [
  played('s1', 'g1', '2026-07-03T20:00:00.000Z', ['m1']),
  played('s2', 'g2', '2026-07-10T20:00:00.000Z', ['m2']),
  played('s3', 'g1', '2026-08-02T20:00:00.000Z', ['m1']),
  played('s4', 'g3', '2026-08-09T20:00:00.000Z', ['m3'], {
    gameIds: ['g3', 'g1'],
    votes: { m1: { g3: vote(5), g1: vote(2) }, m2: { g3: vote(5) }, m3: { g3: vote(4) }, m4: { g3: vote(1) } },
    votedIds: ['m1', 'm2', 'm3', 'm4'],
  }),
  played('s5', 'g1', '2026-08-16T20:00:00.000Z', ['m1'], { memberIds: ['m1', 'm2', 'm3'] }),
  played('s6', 'g2', '2026-08-20T20:00:00.000Z', []),
  played('s7', 'g2', '2026-08-22T20:00:00.000Z', [], { finished: false, cancelled: true, chosenGameId: null }),
];

const ACTIVITIES = [
  { id: 'a1', type: 'game_added', title: 'Kupferzeit', gameId: 'g5', at: '2026-08-12T10:00:00.000Z' },
  { id: 'a2', type: 'game_retired', title: 'Monopoly', gameId: 'g4', at: '2026-06-01T00:00:00.000Z' },
];

const RECS = {
  corpusRows: 100,
  profileGames: 3,
  recommendations: [
    {
      externalId: '1', title: 'Kaskadia', year: 2021, rating: 7.9, weight: 1.8, minPlayers: 1, maxPlayers: 4,
      minPlaytime: 30, maxPlaytime: 45, image: null,
      reasons: [{ term: 'mechanics', games: ['Catan'] }, { term: 'players', players: 4 }],
    },
    {
      externalId: '2', title: 'Die Crew', year: 2019, rating: 7.8, minPlayers: 2, maxPlayers: 5,
      maxPlaytime: 20, image: null, reasons: [{ term: 'quality', rating: 7.8 }],
    },
  ],
  spotlights: [],
  dismissed: [],
};

const roundWith = (sessions) => ({
  id: RID,
  name: 'Freitagsrunde',
  background: null,
  tags: [],
  providers: [],
  members: MEMBERS,
  games: GAMES,
  sessions,
});

function boot(t, design, round = roundWith(SESSIONS)) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return ACTIVITIES.map((a) => ({ ...a }));
    if (/\/recommendations$/.test(url)) return JSON.parse(JSON.stringify(RECS));
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.set('toast', () => {});
  return dom;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const flush = () => new Promise((r) => setImmediate(r));

// --- Klassisch: the golden ---------------------------------------------------

function snapshot(root) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll('.rail, .dock').forEach((n) => n.remove());
  return clone.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').replace(/tl-run-\d+/g, 'tl-run-N').trim();
}

const SCREENS = [
  ['chronik', (dom) => dom.call('showRound', RID, 'chronik')],
  ['pokale', (dom) => dom.call('showRound', RID, 'pokale')],
  ['member', (dom) => dom.call('showMember', RID, 'm1')],
  ['retired', (dom) => dom.call('showRetired', RID)],
  ['completed', (dom) => dom.call('showCompleted', RID)],
  ['wishlist', (dom) => dom.call('showWishlist', RID)],
  ['recommendations', (dom) => dom.call('showRecommendations', RID)],
];

async function renderAll(t, design) {
  const out = {};
  for (const [name, show] of SCREENS) {
    const dom = boot(t, design);
    await show(dom);
    await flush();
    out[name] = snapshot(dom.app);
  }
  return out;
}

test('Klassisch: Chronik, Pokale, member page, off-shelf lists and recommendations render exactly as before #1473', async (t) => {
  const now = await renderAll(t, 'klassisch');
  if (process.env.SPIELWIRBEL_UPDATE_GOLDEN === '1') {
    fs.writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(Object.keys(now), Object.keys(golden));
  for (const k of Object.keys(golden)) {
    assert.ok(golden[k].length > 200, `the golden for ${k} is implausibly small — the render did not happen`);
    assert.equal(now[k], golden[k], `Klassisch ${k} changed`);
  }
});

test('the snapshot can see Forest: those screens under it are NOT the golden', async (t) => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const forest = await renderAll(t, 'forest');
  for (const k of ['chronik', 'pokale', 'member', 'retired', 'recommendations']) {
    assert.notEqual(forest[k], golden[k], `Forest's ${k} is identical to Klassisch's`);
  }
});

// --- the Chronik -------------------------------------------------------------

test('Forest sets each session as a step on the path: date and number, cover, game, who won, rings, score', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showRound', RID, 'chronik');
  const rows = [...dom.app.querySelectorAll('.timeline .session-card--path')];
  assert.equal(rows.length, SESSIONS.length, 'one step per done session, the cancelled one included');
  const at = (sid) => rows.find((r) => r.getAttribute('href') === `/round/${RID}/session/${sid}`);

  const won = at('s4');
  assert.equal(won.firstElementChild.className, 'session-card__when', 'the date column leads the row (DOM order = visual order)');
  const day = dom.run("new Date('2026-08-09T20:00:00.000Z').toLocaleString(localeTag(locale), { day: 'numeric', month: 'short', year: 'numeric' })");
  assert.equal(text(won.querySelector('time.session-card__date')), day);
  // s4 is the fourth finished session, oldest first.
  assert.equal(text(won.querySelector('.session-card__no')), dom.run("t('chronik.sessionNo', { n: 4 })"));
  assert.equal(text(won.querySelector('.session-card__title')), LONG);
  assert.equal(text(won.querySelector('.session-card__won')), dom.run("tn(1, 'chronik.wonOne', 'chronik.won', { names: 'Cem' })"));
  assert.ok(won.querySelector('.session-card__who .ti-crown'), 'the winner line wears the crown');
  assert.ok(won.querySelector('.session-card__img'), 'the cover slot is missing');
  assert.ok(won.querySelector('.score-pill[data-stop]'), 'the score is missing');
  // The rings are a picture; „4 dabei" is said in text.
  assert.equal(won.querySelector('.session-card__faces').getAttribute('aria-hidden'), 'true');
  assert.equal(won.querySelectorAll('.session-card__faces .avatar').length, 4);
  assert.equal(text(won.querySelector('.sr-only')), dom.run("tn(4, 'chronik.seatedOne', 'chronik.seated')"));
  // The phone's copy of the date is aria-hidden, so the link says it once.
  assert.equal(won.querySelector('.session-card__day').getAttribute('aria-hidden'), 'true');
  // The newest number IS the head's count of finished sessions.
  assert.equal(text(at('s6').querySelector('.session-card__no')), dom.run("t('chronik.sessionNo', { n: 6 })"));

  const plain = at('s6');
  assert.equal(plain.querySelector('.session-card__won'), null, 'a winnerless night is not „won"');
  assert.ok(text(plain.querySelector('.session-card__who')).includes(dom.run("t('sessions.played')")));
  const cancelled = at('s7');
  assert.equal(cancelled.querySelector('.session-card__no'), null, 'a cancelled night was never played and has no number');
  assert.equal(cancelled.querySelector('time'), null, 'a night without a game has its date as the title already');
  assert.ok(cancelled.querySelector('.session-card__cancelled'));
});

test('Forest puts the path before the recap, names the span, and the phone entry names the recap\'s own period', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showRound', RID, 'chronik');
  const log = dom.app.querySelector('.timeline').closest('.section');
  const recap = dom.app.querySelector('.precap');
  assert.ok(log.compareDocumentPosition(recap) & 4, 'the path must come before the recap');
  assert.ok(dom.app.querySelector('.section-head .chronik__count'));
  assert.ok(recap.querySelector('.stat-chip--tile .stat-chip__n'), 'the recap totals are not number tiles');
  assert.deepEqual([...recap.querySelectorAll('.precap__kinds .precap__kind')].map(text), ['Monat', 'Quartal', 'Jahr']);

  const entry = log.querySelector('.section-head + .forest-recap-entry');
  assert.ok(entry, 'no „Rückblick" entry under the head');
  assert.equal(text(entry.querySelector('.forest-recap-entry__kicker')), dom.run("t('recap.title')"));
  assert.equal(text(entry.querySelector('.forest-recap-entry__period')), text(recap.querySelector('.precap__picker option:checked')));
  const n = Number(text(recap.querySelector('.recap__totals .stat-chip__n')));
  assert.equal(text(entry.querySelector('.forest-recap-entry__sub')), dom.run(`tn(${n}, 'home.chip.sessionsOne', 'home.chip.sessions')`));
  assert.equal(entry.getAttribute('aria-controls'), recap.id);
  let scrolled = false;
  recap.scrollIntoView = () => { scrolled = true; };
  entry.click();
  assert.ok(scrolled, 'the entry does not take you to the recap');
  assert.equal(dom.document.activeElement, recap, 'focus did not follow');
});

test('the phone entry follows the recap when the kind or the period changes', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showRound', RID, 'chronik');
  const recap = dom.app.querySelector('.precap');
  const entry = dom.app.querySelector('.forest-recap-entry');
  const year = recap.querySelector('.precap__kind[data-kind="year"]');
  year.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const picked = () => { const p = recap.querySelector('.precap__picker'); return p.options[p.selectedIndex].textContent; };
  assert.equal(picked(), '2026', 'the switch did not move the picker — re-read this test');
  assert.equal(text(entry.querySelector('.forest-recap-entry__period')), '2026');
  const n = Number(text(recap.querySelector('.recap__totals .stat-chip__n')));
  assert.equal(text(entry.querySelector('.forest-recap-entry__sub')), dom.run(`tn(${n}, 'home.chip.sessionsOne', 'home.chip.sessions')`));
  recap.querySelector('.precap__kind[data-kind="month"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const picker = recap.querySelector('.precap__picker');
  picker.selectedIndex = picker.options.length - 1;
  picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(text(entry.querySelector('.forest-recap-entry__period')), picked());
});

test('Forest folds a run of shelf changes like the other designs, and keeps the month heads', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showRound', RID, 'chronik');
  assert.ok(dom.app.querySelectorAll('.timeline .tl-month').length >= 2);
});

// --- the Pokale --------------------------------------------------------------

test('Forest: „Pokale" titles the page, „Ruhmeshalle" heads the grove, the table beside it, the plaques under both', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showRound', RID, 'pokale');
  assert.equal(text(dom.app.querySelector('.section-head h1')), 'Pokale');
  assert.ok(dom.app.querySelector('.section-head .chronik__count'), 'no span beside the title');
  const split = dom.app.querySelector('.pokale-split');
  const stage = split.querySelector(':scope > .pokale-split__stage');
  const side = split.querySelector(':scope > .pokale-split__side');
  assert.equal(text(stage.querySelector('.forest-grove h2.forest-grove__title')), 'Ruhmeshalle');
  assert.ok(side.querySelector('.pokale-table'), 'the table is not in the side column');
  const cards = split.querySelector(':scope > .pokale-cards');
  assert.ok(cards, 'the plaques do not sit under both columns');
  assert.ok(side.compareDocumentPosition(cards) & 4);
  assert.equal(dom.app.querySelector('.podium, .podium__rest'), null, 'the grove replaces the podium and the summary line');
  // No rubric over the plaques (review U6).
  assert.ok(![...dom.app.querySelectorAll('h1, h2, h3')].some((el) => /Auszeichnungen/.test(text(el))));
});

test('the grove is one tree per person in standings order, the leader alone crowned and gold', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showRound', RID, 'pokale');
  const trees = [...dom.app.querySelectorAll('.forest-grove__item')];
  assert.deepEqual(trees.map((li) => text(li.querySelector('.forest-grove__plate'))), [
    'Anna: 1 · 3 Siege', 'Ben: 2 · 1 Sieg', 'Cem: 2 · 1 Sieg', 'Dora: – · 0 Siege',
  ]);
  assert.deepEqual(trees.map((li) => li.className.replace('forest-grove__item ', '')), ['is-lead', 'is-placed', 'is-placed', 'is-rest']);
  assert.equal(dom.app.querySelectorAll('.forest-grove .ti-crown').length, 1, 'only the leader wears the crown');
  assert.deepEqual(trees.map((li) => li.querySelector('a').style.getPropertyValue('--g')), ['1.000', '0.333', '0.333', '0.000']);
  assert.equal(trees[0].querySelector('a').getAttribute('href'), `/round/${RID}/member/m1`);
  // The table beside it agrees on every place.
  const places = [...dom.app.querySelectorAll('.pokale-table tbody tr')].map((r) => text(r.firstElementChild));
  assert.deepEqual(places, ['1', '2', '2', '–']);
});

test('a young Forest round keeps the sentence: no grove, no table', async (t) => {
  const dom = boot(t, 'forest', roundWith(SESSIONS.slice(0, 2)));
  await dom.call('showRound', RID, 'pokale');
  assert.ok(dom.app.querySelector('.pokale-young'));
  assert.equal(dom.app.querySelector('.forest-grove, .pokale-table, .podium'), null);
});

// --- the member page ---------------------------------------------------------

test('Forest\'s Tischkarte: five figures in the sheet\'s order, the fifth the favourite game by name', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showMember', RID, 'm1');
  const page = dom.app.querySelector('.forest-member');
  assert.ok(page, 'no Forest member page');
  const figs = [...page.querySelectorAll('.member-card .member-card__figures > .member-figure')];
  assert.deepEqual(figs.map((f) => text(f.querySelector('.member-figure__label'))),
    ['member.sessions', 'member.wins', 'member.winRate', 'member.avgGiven', 'member.favorite'].map((k) => dom.run(`t('${k}')`)));
  const st = dom.call('memberStats', roundWith(SESSIONS), 'm1');
  assert.deepEqual(figs.slice(0, 3).map((f) => text(f.querySelector('.member-figure__value'))),
    [String(st.joined), String(st.wins), Math.round(st.winRate * 100) + '%']);
  assert.equal(st.favorite[0].title, LONG, 'the fixture is meant to make the long title the favourite');
  assert.equal(text(figs[4].querySelector('.member-figure__value')), LONG);
  assert.ok(figs[4].classList.contains('member-figure--game'));
  // The Wegweiser comes with the round chrome (review U5).
  assert.ok(dom.app.querySelector('.rail, .dock'), 'the member page lost the round chrome');
});

test('Forest\'s „Bearbeiten" opens the rename, and the column beside the card holds the boxes, „Zuletzt dabei" and the tiles', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showMember', RID, 'm1');
  const card = dom.app.querySelector('.forest-member > .member-card');
  const aside = dom.app.querySelector('.forest-member > .forest-member__aside');
  assert.ok(card && aside);
  assert.ok(card.compareDocumentPosition(aside) & 4, 'the column comes after the card');
  assert.deepEqual([...aside.children].map((c) => c.className.split(' ')[0]), ['member-owned', 'forest-recent', 'pokale-cards']);
  assert.equal(card.querySelector('.member-card__lower'), null);
  const edit = card.querySelector('.forest-member-edit');
  assert.equal(text(edit), dom.run("t('member.edit')"));
  edit.click();
  assert.equal(card.querySelector('.gd-title-input').value, 'Anna');
});

test('„Zuletzt dabei" lists the member\'s latest finished sessions, won or joined, each linked', async (t) => {
  const dom = boot(t, 'forest');
  await dom.call('showMember', RID, 'm4');
  const rows = [...dom.app.querySelectorAll('.forest-recent__row')];
  // Dora sat out s5 and s7 was cancelled: s6, s4, s3, s2.
  assert.deepEqual(rows.map((r) => r.getAttribute('href')), ['s6', 's4', 's3', 's2'].map((s) => `/round/${RID}/session/${s}`));
  assert.ok(rows.every((r) => text(r.querySelector('.forest-recent__state')) === dom.run("t('member.recentJoined')")));
  const anna = boot(t, 'forest');
  await anna.call('showMember', RID, 'm1');
  const first = anna.app.querySelector('.forest-recent__row');
  assert.ok(first.classList.contains('is-won') === false, 's6 had no winner');
  const won = [...anna.app.querySelectorAll('.forest-recent__row.is-won')];
  assert.deepEqual(won.map((r) => text(r.querySelector('.forest-recent__state'))), [anna.run("t('member.recentWon')"), anna.run("t('member.recentWon')")]);
  assert.equal(text(anna.app.querySelector('.forest-recent__title')), anna.run("t('member.recentTitle')"));
});

test('a member with no finished session gets no „Zuletzt dabei"', async (t) => {
  const dom = boot(t, 'forest', roundWith([]));
  await dom.call('showMember', RID, 'm4');
  assert.equal(dom.app.querySelector('.forest-recent'), null);
  assert.equal(text(dom.app.querySelector('.member-figure--game .member-figure__value')), '–');
});

// --- the off-shelf lists and the recommendations ------------------------------

test('Forest footnotes the retired list and credits BGG beside the recommendations head', async (t) => {
  const retired = boot(t, 'forest');
  await retired.call('showRetired', RID);
  // F13.7's reading order: the title, the lists as tabs, the footnote, the rows.
  const note = retired.app.querySelector('.page-head + nav.offshelf-seg + .forest-footnote');
  assert.equal(text(note), retired.run("t('retired.footnote')"));
  assert.ok(note.compareDocumentPosition(retired.app.querySelector('.archive-list')) & 4, 'the rows must follow the footnote');
  assert.ok(retired.app.querySelector('nav.offshelf-seg a[aria-current="page"][data-sub="retired"]'), 'the three lists are not offered as tabs');
  assert.deepEqual([...retired.app.querySelectorAll('nav.offshelf-seg a')].map((a) => a.dataset.sub),
    ['regal', 'wishlist', 'retired', 'completed', 'recommendations'], 'a list became unreachable');
  const wish = boot(t, 'forest');
  await wish.call('showWishlist', RID);
  assert.equal(wish.app.querySelector('.forest-footnote'), null, 'the footnote is about retiring only');
  const recs = boot(t, 'forest');
  await recs.call('showRecommendations', RID);
  assert.equal(recs.app.querySelector('.page-head > img.forest-bgg').getAttribute('alt'), 'Powered by BGG');
  const why = [...recs.app.querySelectorAll('.rec-list .rec-card')[0].querySelectorAll('.rec-card__why li')].map(text);
  assert.deepEqual(why, [
    recs.run("t('suggest.reason.mechanics', { games: joinNames(['Catan']) })"),
    recs.run("tn(4, 'suggest.reason.playersOne', 'suggest.reason.players')"),
  ], 'the reasons are the recommender\'s own');
});

// --- the stylesheet ----------------------------------------------------------

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/forest.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1473')) return '/*#1473*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
const AFTER = SHEET.slice(SHEET.indexOf('/*#1473*/') + '/*#1473*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const ROOT = ':root[data-design="forest"]';
const GATE = ':root[data-design="forest"]:not([data-scheme="dark"])';
const COLOUR_PROPS = /(^|;)\s*(color|background(-color)?|border(-[a-z]+)?(-color)?|box-shadow|outline(-color)?|fill|stroke)\s*:/;

function topLevelParts(selector) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of selector) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

test('every rule of the #1473 section is Forest-scoped, and every rule that paints is gated on the light scheme', () => {
  assert.ok(SHEET.includes('/*#1473*/'), 'the section header moved — re-read this test');
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  assert.ok(flat.length > 50, `the scan found implausibly few rules (${flat.length})`);
  let painted = 0;
  for (const [selector, body] of flat) {
    const paints = COLOUR_PROPS.test(body.replace(/var\(--[a-z0-9-]+\)/g, ''));
    if (paints) painted++;
    for (const part of topLevelParts(selector)) {
      assert.ok(part.startsWith(ROOT), `${part} is not scoped to Forest`);
      if (paints) assert.ok(part.startsWith(GATE), `${part} paints without the light-scheme gate`);
    }
  }
  assert.ok(painted > 20, `implausibly few painting rules (${painted})`);
});

test('the #1473 section spells no colour, and introduces no silver or bronze', () => {
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  const literal = flat.filter(([, body]) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(body)).map(([sel]) => sel);
  assert.deepEqual(literal, []);
  assert.doesNotMatch(SECTION, /silver|bronze/i);
});

test('the favourite game wraps: no ellipsis and no nowrap on the fifth figure', () => {
  const flat = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
  const game = flat.filter(([sel]) => sel.includes('member-figure--game'));
  assert.ok(game.length, 'no rule for the fifth figure');
  for (const [, body] of game) {
    assert.doesNotMatch(body, /text-overflow|white-space:\s*nowrap/);
  }
  assert.ok(game.some(([, body]) => /overflow-wrap:\s*anywhere/.test(body)), 'the game name is not allowed to break');
});
