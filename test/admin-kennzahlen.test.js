'use strict';

/* The operator panel's two Kennzahlen cards, rendered (#941, split by #1124).
 *
 * `public/js/pages/admin.js` is a standalone IIFE loaded by its own document, so
 * nothing in the suite drove it before this: the route specs prove what the
 * server SENDS, and nothing proved what the panel DOES with it. That gap is
 * exactly where the panel's own additions live — which card a tile lands on, the
 * per-account design tile, the breakdown lines, the shares and their
 * zero-denominator guard, and the storage card. The server has an opinion about
 * none of it (`.claude/rules/admin-kennzahlen-card.md`: the server reports facts,
 * the row builders hold the opinions).
 *
 * The real public/admin.html is loaded into jsdom with its real scripts, and
 * `fetch` is stubbed — so the page's own wiring, ids and load order are under
 * test rather than a paraphrase of them.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

// Per ACCOUNT since #1201, keyed by the offered designs in registry order. Since
// #1362 only accounts that ANSWERED the chooser are counted, so the lines sum to
// 30 — deliberately neither `adoption.accountsTotal` (40) nor `accounts.total`
// (42), so a line that divided by either could not pass.
const DESIGNS = { klassisch: 21, tisch: 9 };

const STATUS = (over = {}) => ({
  metrics: {
    accounts: { total: 42, verified: 30, disabled: 3, withAvatar: 8 },
    rounds: { total: 11 },
    content: { games: 90, activeGames: 70, members: 25, sessions: 33, sessionsFinished: 20 },
    adoption: {
      roundsWithRetired: 3, roundsWithCompleted: 1, roundsWithWish: 5, roundsWithAnyShelf: 7,
      roundsWithTags: 6, roundsWithSavedFilters: 4,
      gamesLinked: 55, gamesWithOwnCover: 12, gamesWithProviderCover: 40,
      gamesWithOwners: 9, gamesWithExpansions: 4,
      sessionsWithGuests: 8, sessionsWithTeams: 2, sessionsWithVoteLink: 5,
      accountsWithPasskey: 11, accountsWithBggUsername: 6,
      /* The card's own denominators (#1174), DELIBERATELY DIFFERENT from the
         instance-wide twins above — `accounts.total` is 42 against 40 here,
         `rounds.total` 11 against 10, `content.games` 90 against 80 and
         `content.sessions` 33 against 30. A renderer that reached for the
         instance-wide figure would still produce a plausible „n / total", so
         only a fixture where the two disagree can tell them apart. */
      accountsTotal: 40, roundsTotal: 10, gamesTotal: 80, sessionsTotal: 30,
      accountsWithAvatar: 7, accountsWithoutRound: 13, accountsWithBgStats: 4, accountsPlayedQuiz: 6,
      // The Konten twins (#1480), below their instance-wide 30 / 3 on purpose.
      accountsVerified: 28, accountsDisabled: 2,
      funnel: {
        started: 28, rated: 18, closed: 22, chosen: 20, played: 12, result: 9, cancelled: 3,
      },
      // Sums to roundsTotal, which the tile's own test asserts.
      roundsByFinished: { none: 5, one: 3, many: 2 },
    },
    designAdoption: { byDesign: { ...DESIGNS } },
    social: { sharedRounds: 2, invitationsOpen: 1, friendships: 5 },
    demo: { live: 1, max: 5 },
    mail: { sent: 2, limit: 200 },
    peaks: { roundsPerTenant: 3, gamesPerRound: 12, tagsPerRound: 4 },
    ...over,
  },
  quotas: { enforced: true, roundsPerTenant: 10, gamesPerRound: 200, tagsPerRound: 20 },
  runtime: { node: 'v22.0.0' },
});

// Load the real page with its real scripts; answer only what the card asks for.
async function panel(routes = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  /* `runScripts: 'dangerously'` and real <script> ELEMENTS, not `window.eval`.
     jsdom's eval does not put a script's top-level function declarations on the
     window, while a real browser does create those globals from a classic
     script — so this is the harness matching the page rather than a
     workaround. The page's own <script src> tags are not fetched (no
     `resources: 'usable'`), which is why the one this test needs is injected
     below. */
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/admin.html' });
  const w = dom.window;
  /* `/me` is the boot probe: the page only enters the panel (and therefore only
     loads the card) once an existing operator session answers. Stubbing it is
     what makes this a render test rather than a login test. */
  const answers = { '/me': { ok: true }, '/status': { status: STATUS() }, ...routes };
  w.fetch = async (url) => {
    const key = Object.keys(answers).find((k) => String(url).includes(k));
    /* Everything else the panel loads on entry (corpus, logs, notices, feedback,
       the log-action filter) answers in its own shape. Not tidiness: those cards
       reject on a payload they cannot read, and an unhandled rejection fails the
       whole FILE under `node --test` — so a badly stubbed neighbour would look
       like a Kennzahlen bug. */
    const empty = {
      corpus: { rows: 0, limit: 0, minRatings: 0, updatedAt: null, enriched: 0, pending: 0 },
      actions: [], entries: [], notices: [], feedback: [], items: [], users: [], total: 0,
    };
    const answer = key !== undefined ? answers[key] : empty;
    // `__fail: <status>` makes this route answer NOT ok, which is the only way
    // to drive the panel's error path — api() throws on !res.ok, never on a
    // body that merely carries an `error` key.
    const failed = answer && answer.__fail;
    return { ok: !failed, status: failed || 200, json: async () => answer };
  };
  for (const src of ['public/js/pages/admin.js']) {
    const el = w.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(ROOT, src), 'utf8');
    w.document.body.appendChild(el);
  }
  // let the card's own load() settle
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
  return { w, doc: w.document, dom };
}

const tiles = (doc, grid = '#statusGrid') => [...doc.querySelectorAll(`${grid} .status__item`)].map((el) => ({
  label: el.querySelector('.status__label').textContent,
  // The value rides in the verdict PILL, not a `.status__value` — one element
  // carries both the number and its grading.
  value: el.querySelector('.pill') ? el.querySelector('.pill').textContent : null,
  note: el.querySelector('.status__note') ? el.querySelector('.status__note').textContent : null,
  pill: el.querySelector('.pill') ? el.querySelector('.pill').className : null,
  // One LINE per figure since #1124, each carrying its own label — never two
  // positional lists the reader has to zip.
  breakdown: [...el.querySelectorAll('.status__bd')]
    .map((line) => [line.querySelector('span').textContent, line.querySelector('b').textContent]),
  svg: el.querySelector('svg'),
}));
const labelsOf = (rows) => rows.map((x) => x.label);

/* The grouped „Funktionsnutzung" cards (#1480), read back as rendered: one
   entry per card with its title, its population and one
   [label, count, share, depth] tuple per line. The share's no-break space is
   folded to a plain one so expectations stay readable. */
const groups = (doc) => [...doc.querySelectorAll('#adoptionGrid .adopt')].map((card) => {
  const [head, ...rest] = [...card.querySelectorAll('.adopt__line')];
  const cells = (ln) => [...ln.children].map((c) => c.textContent.replace(/\u00a0/g, ' '));
  const [title, total] = cells(head);
  return {
    title,
    total,
    lines: rest.map((ln) => {
      const [label, n, share] = cells(ln);
      return [label, n, share, Number(/adopt__line--d(\d)/.exec(ln.className)[1])];
    }),
  };
});
const cardOf = (doc, title) => groups(doc).find((c) => c.title === title);

/* ------------------------- the rows that went away ------------------------ */

test('the six inventory rows and the two series are gone from both cards', async (t) => {
  /* Absence assertions, so they are written against the RENDERED page rather
     than against the row builders — a tile can only vanish by not being pushed,
     and nothing else in the suite would notice if one came back. „Runden",
     „Spiele" and „Sessions" are card titles on „Funktionsnutzung" since #1480
     (the population each card counts), so on that card only the old SERIES
     and activation tiles are asserted gone. */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const limits = labelsOf(tiles(doc));
  const titles = groups(doc).map((c) => c.title);
  assert.ok(limits.length >= 4 && titles.length >= 5, 'the cards rendered almost nothing');
  for (const gone of ['Neue Konten', 'Aktivierung', 'Konten (Verlauf)', 'Runden',
    'Spieler*innen', 'Spiele', 'Sessions', 'Sessions (Verlauf)']) {
    assert.equal(limits.includes(gone), false, `„${gone}" is back on „Grenzen & Kontingente"`);
  }
  for (const gone of ['Neue Konten', 'Aktivierung', 'Konten (Verlauf)', 'Spieler*innen',
    'Sessions (Verlauf)']) {
    assert.equal(titles.includes(gone), false, `„${gone}" is back on „Funktionsnutzung"`);
  }
  assert.equal([...doc.querySelectorAll('svg')].length, 0,
    'a history chart is back — both series and renderChart were removed');
});

test('the „Titelbilder" backfill section is gone from the page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.equal(/Titelbilder/.test(html), false, 'the spent backfill card is still in the markup');
  assert.equal(/coverReencode/.test(html), false);
});

/* --------------------------- the two cards -------------------------------- */

test('each figure lands on the card whose question it answers', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  assert.deepEqual(labelsOf(tiles(doc)),
    ['Demo-Konten', 'Mail-Budget', 'Kontingente', 'Node'],
    '„Grenzen & Kontingente" is what is close to refusing a user, plus the runtime');
  assert.deepEqual(groups(doc).map((c) => c.title),
    ['Konten', 'Design-Auswahl beantwortet', 'Runden', 'Spiele', 'Sessions',
      'Freundschaften & Einladungen'],
    '„Funktionsnutzung" is one card per parent population, in the #1480 order');
});

test('no „Kennzahlen" heading remains, and both cards carry the privacy sentence', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const headings = [...doc.querySelectorAll('h2')].map((h) => h.textContent);
  assert.equal(headings.includes('Kennzahlen'), false);
  for (const want of ['Grenzen & Kontingente', 'Funktionsnutzung']) {
    assert.ok(headings.includes(want), `no „${want}" card: ${headings.join(', ')}`);
  }
  /* The privacy statement is what test/status.test.js's personal-data sweep
     exists to keep true, so a reader who screenshots ONE card must see it —
     which is why it repeats rather than sitting on the first card only. */
  for (const grid of ['statusGrid', 'adoptionGrid']) {
    // Whitespace-collapsed: the sentence wraps in the source, so a raw
    // textContent carries the newline and the indent mid-phrase.
    const sub = doc.getElementById(grid).closest('section')
      .querySelector('.sub').textContent.replace(/\s+/g, ' ');
    assert.match(sub, /keine personenbezogenen Daten/, `the ${grid} card dropped the privacy sentence`);
    assert.match(sub, /Demo-Konten/, `the ${grid} card does not say demo accounts are excluded`);
  }
});

test('one failed /status is reported in BOTH error slots', async (t) => {
  /* One fetch feeds both grids. Reporting the failure in one slot only leaves
     the other card silently empty, which reads as „nothing is being used"
     rather than „this did not load" — the worse of the two wrong answers. */
  const { doc, dom } = await panel({ '/status': { __fail: 500, error: 'nope' } });
  t.after(() => dom.window.close());
  for (const id of ['statusError', 'adoptionError']) {
    assert.equal(doc.getElementById(id).hidden, false, `#${id} stayed hidden on a failed load`);
  }
  assert.equal(doc.querySelectorAll('#adoptionGrid .status__item').length, 0);
});

/* ------------------------- the limits card's tiles ------------------------ */

test('every multi-figure limit tile labels each figure on its own line', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const all = tiles(doc);
  for (const row of all.filter((x) => x.breakdown.length)) {
    for (const [label, value] of row.breakdown) {
      assert.ok(label && !/^\s*$/.test(label), `${row.label}: a breakdown line has no label`);
      assert.match(value, /^(\d+( \/ \d+)?|—)$/, `${row.label}: „${value}" is not a figure`);
    }
  }
  // The shape that was replaced: a value that is itself a positional list.
  for (const row of all) {
    assert.equal(/\d+ · \d+/.test(row.value || ''), false,
      `${row.label} still renders a positional „a · b · c" value`);
  }
});

test('Kontingente keeps its graded pill and moves its three ceilings onto lines', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const row = tiles(doc).find((x) => x.label === 'Kontingente');
  assert.equal(row.value, 'aktiv');
  assert.match(row.pill, /pill--ok/, 'the quota tile is the one that still grades itself');
  assert.deepEqual(row.breakdown, [
    ['Runden/Konto', '3 / 10'],
    ['Spiele/Runde', '12 / 200'],
    ['Tags/Runde', '4 / 20'],
  ]);
});

/* -------------------- the grouped adoption cards (#1480) ------------------ */

test('every card renders exactly: parent first, then count + share of its parent', async (t) => {
  /* The whole card, pinned line by line. That is what makes „no figure
     appears twice and none is lost" checkable at all — a per-figure assertion
     cannot see a line that was added twice or quietly left out. Every
     denominator here is the ADOPTION one (#1174) and the fixture makes each
     disagree with its instance-wide twin, so a line dividing by the wrong one
     shows a different percentage. */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  assert.deepEqual(groups(doc), [
    {
      title: 'Konten',
      total: '40',
      lines: [
        ['bestätigt', '28', '70 %', 0],
        ['unbestätigt', '12', '30 %', 0],
        ['gesperrt', '2', '5 %', 0],
        ['BGG-Konto', '6', '15 %', 0],
        ['Passkey', '11', '28 %', 0],
        ['Konto-Bild', '7', '18 %', 0],
        ['BG-Stats-Weitergabe', '4', '10 %', 0],
        ['Wochenquiz diese Woche', '6', '15 %', 0],
        ['ohne Runde (nach Tenant)', '13', '33 %', 0],
      ],
    },
    {
      title: 'Design-Auswahl beantwortet',
      total: '30',
      lines: [['klassisch', '21', '70 %', 0], ['tisch', '9', '30 %', 0]],
    },
    {
      title: 'Runden',
      total: '10',
      lines: [
        ['geteilt', '2', '20 %', 0],
        ['eigene Tags', '6', '60 %', 0],
        ['gespeicherte Filter', '4', '40 %', 0],
        ['Regal genutzt', '7', '70 %', 0],
        ['Aussortiert', '3', '43 %', 1],
        ['Durchgespielt', '1', '14 %', 1],
        ['Wunschliste', '5', '71 %', 1],
        ['gespielte Sessions', '', '', 0],
        ['zwei oder mehr', '2', '20 %', 1],
        ['genau eine', '3', '30 %', 1],
        ['noch keine', '5', '50 %', 1],
      ],
    },
    {
      title: 'Spiele',
      total: '80',
      lines: [
        ['verknüpft', '55', '69 %', 0],
        ['von Hand', '25', '31 %', 0],
        ['mit Besitzer*in', '9', '11 %', 0],
        ['mit Erweiterungen', '4', '5 %', 0],
        ['mit Titelbild', '52', '65 %', 0],
        ['eigenes Bild', '12', '23 %', 1],
        ['vom Anbieter', '40', '77 %', 1],
      ],
    },
    {
      title: 'Sessions',
      total: '30',
      lines: [
        ['mit Gästen', '8', '27 %', 0],
        ['mit Teams', '2', '7 %', 0],
        ['mit Vote-Link', '5', '17 %', 0],
        ['gestartet (ohne Split-Eltern)', '28', '93 %', 0],
        ['als gespielt markiert', '12', '43 %', 1],
        ['von ≥2 bewertet', '18', '64 %', 1],
        ['Abstimmung beendet', '22', '79 %', 1],
        ['Spiel gewählt', '20', '71 %', 1],
        ['Ergebnis erfasst', '9', '32 %', 1],
        ['abgebrochen', '3', '11 %', 1],
      ],
    },
    {
      title: 'Freundschaften & Einladungen',
      total: '',
      lines: [['Freundschaften', '5', '', 0], ['offene Einladungen', '1', '', 0]],
    },
  ]);
});

test('Konten is filtered like every other figure — the instance-wide bare count is gone', async (t) => {
  /* #1480 retired the card's one exception: „Konten" and bestätigt /
     unbestätigt / gesperrt now read the ADOPTION twins. The fixture has 42
     accounts instance-wide against 40 here, 30 verified against 28 and 3
     disabled against 2, so reading `accounts.*` renders different numbers. */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const konten = cardOf(doc, 'Konten');
  assert.equal(konten.total, '40', 'the Konten total read accounts.total');
  const by = Object.fromEntries(konten.lines.map(([l, n]) => [l, n]));
  assert.equal(by['bestätigt'], '28', 'bestätigt read accounts.verified');
  assert.equal(by['unbestätigt'], '12', 'unbestätigt was not derived from the adoption twins');
  assert.equal(by.gesperrt, '2', 'gesperrt read accounts.disabled');
});

test('a nested line is a share of the line directly above it, not of the card', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  /* Every nested line with a parent figure must be n / that parent. Computed
     from the rendered page rather than restated, so a renderer that nested a
     line visually but divided by the card total fails here by name. The
     „gespielte Sessions" bands sit under a label with no figure and divide by
     the card's population — a partition of Runden. */
  for (const card of groups(doc)) {
    let parent = Number(card.total);
    for (const [label, n, share, depth] of card.lines) {
      if (depth === 0) { if (n !== '') parent = Number(n); else parent = Number(card.total); continue; }
      if (share === '' || share === '—') continue;
      assert.equal(share, `${Math.round((100 * Number(n)) / parent)} %`,
        `${card.title} › ${label}: not a share of the line above it (${parent})`);
    }
  }
});

test('no adoption figure carries a verdict pill', async (t) => {
  /* Low uptake is not a fault condition, and a green pill would grade something
     for which nobody set a threshold. */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  assert.equal(doc.querySelectorAll('#adoptionGrid .pill').length, 0);
});

/* ------------------------ the design card (#1201) ------------------------ */

test('the design card is headed by the ANSWERED accounts and claims no choice', async (t) => {
  /* Only accounts that answered the chooser are on a line (#1362), so the
     parent is their sum (30) — neither `adoption.accountsTotal` (40) nor
     `accounts.total` (42). Skippers are included, so nothing may call the
     figure a choice. The switch-back share is gone (#1480). */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const card = cardOf(doc, 'Design-Auswahl beantwortet');
  assert.equal(card.total, '30');
  // Over THIS card only: „Spiel gewählt" is a legitimate funnel line elsewhere.
  const own = [card.title, ...card.lines.flat()].join(' ');
  assert.doesNotMatch(own, /gewählt|bewusst/i, 'skippers are included — the card must not claim a choice');
  assert.doesNotMatch(doc.getElementById('adoptionGrid').textContent, /zurückgewechselt/,
    'the dropped switch-back figure is back');
});

test('the round histogram does not come back beside the account card', async (t) => {
  /* An absence assertion over the RENDERED page: a stale `designs` block in the
     payload must not resurrect „ohne Design"/„Collage" lines, which only ever
     described rounds. */
  const { doc, dom } = await panel({
    '/status': { status: STATUS({ designs: { forest: 4, none: 3, collage: 1 } }) },
  });
  t.after(() => dom.window.close());
  const text = doc.getElementById('adoptionGrid').textContent;
  for (const gone of ['ohne Design', 'Collage', 'forest', 'unbekannt', 'Runden mit Design']) {
    assert.equal(text.includes(gone), false, `„${gone}" — the per-round histogram is back`);
  }
  const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  // The round registry was deleted at the flip (#1202); admin.html must not
  // reference it (a <script> for a 404 would be the only trace).
  assert.equal(/round-desig/.test(html), false,
    'admin.html still loads the round registry the old histogram resolved labels with');
});

test('a fresh instance renders „—" for every share, never NaN or „0 / 0"', async (t) => {
  /* Every denominator is 0 on an instance nobody has used yet, so a share
     renders as an em dash — the case a hand-check never reaches, because the
     operator only ever opens the panel on an instance with data in it. */
  const zero = STATUS().metrics;
  const empty = {
    accounts: { total: 0, verified: 0, disabled: 0, withAvatar: 0 },
    rounds: { total: 0 },
    content: { games: 0, activeGames: 0, members: 0, sessions: 0, sessionsFinished: 0 },
    adoption: {
      ...Object.fromEntries(Object.keys(zero.adoption).map((k) => [k, 0])),
      funnel: Object.fromEntries(Object.keys(zero.adoption.funnel).map((k) => [k, 0])),
      roundsByFinished: { none: 0, one: 0, many: 0 },
    },
    designAdoption: { byDesign: { klassisch: 0 } },
    social: { sharedRounds: 0, invitationsOpen: 0, friendships: 0 },
  };
  const { doc, dom } = await panel({ '/status': { status: STATUS(empty) } });
  t.after(() => dom.window.close());

  const cards = groups(doc);
  assert.equal(cards.length, 6, 'the adoption card did not render at all on empty data');
  const text = doc.getElementById('adoptionGrid').textContent;
  assert.equal(/NaN|Infinity/.test(text), false, `the empty card rendered ${text}`);
  assert.equal(/0 \/ 0/.test(text), false, 'a 0 / 0 claims a share of nothing');
  for (const card of cards.slice(0, 5)) {
    assert.equal(card.total, '0', `${card.title}: a zero population still reads 0`);
    for (const [label, n, share] of card.lines) {
      if (n === '') continue;
      assert.equal(share, '—', `${card.title} › ${label} rendered „${share}" over a zero parent`);
    }
  }
  assert.deepEqual(cardOf(doc, 'Design-Auswahl beantwortet').lines, [['klassisch', '0', '—', 0]],
    'an offered design keeps its line on an empty instance');
});

/* ------------------------------ the storage card -------------------------- */

test('the storage card loads on demand and words its orphans as an estimate', async (t) => {
  const { doc, w, dom } = await panel({
    '/storage': { storage: { objects: 120, bytes: 4096, complete: true, referenced: 118, orphans: 2 } },
  });
  t.after(() => dom.window.close());

  assert.equal(doc.querySelectorAll('#storageGrid .status__item').length, 0,
    'a bucket-wide listing must NOT run on panel load');

  doc.getElementById('storageLoad').dispatchEvent(new w.Event('click'));
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  const labels = [...doc.querySelectorAll('#storageGrid .status__label')].map((e) => e.textContent);
  assert.deepEqual(labels, ['Objekte', 'Belegt', 'Referenziert', 'Vermutlich verwaist']);
  const orphanNote = [...doc.querySelectorAll('#storageGrid .status__note')]
    .map((e) => e.textContent).join(' | ');
  assert.match(orphanNote, /Schätzung/, 'the orphan figure must be worded as an estimate');
  assert.match(orphanNote, /nichts gelöscht/, 'and must say that nothing is deleted');
});

test('an INCOMPLETE sweep marks every figure as a floor', async (t) => {
  /* Without the „≥" a partial listing is indistinguishable from a complete one,
     and the orphan count reads as a total. */
  const { doc, w, dom } = await panel({
    '/storage': { storage: { objects: 5000, bytes: 999, complete: false, referenced: 10, orphans: 4990 } },
  });
  t.after(() => dom.window.close());
  doc.getElementById('storageLoad').dispatchEvent(new w.Event('click'));
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  const values = [...doc.querySelectorAll('#storageGrid .pill')].map((e) => e.textContent);
  assert.ok(values.filter((v) => v.startsWith('≥')).length >= 3,
    `an incomplete sweep must mark its figures as floors: ${values.join(' | ')}`);
});


