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

// Per ACCOUNT since #1201, keyed by the offered designs in registry order. The
// counts sum to `adoption.accountsTotal` (40), never to `accounts.total` (42) —
// the two are made to disagree below on purpose.
const DESIGNS = { klassisch: 31, tisch: 9 };

const STATUS = (over = {}) => ({
  metrics: {
    accounts: { total: 42, verified: 30, disabled: 1, withAvatar: 7 },
    rounds: { total: 11 },
    content: { games: 90, activeGames: 70, members: 25, sessions: 33, sessionsFinished: 20 },
    adoption: {
      roundsWithRetired: 3, roundsWithCompleted: 1, roundsWithWish: 5, roundsWithAnyShelf: 7,
      roundsWithTags: 6,
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
      accountsWithAvatar: 7, accountsWithoutRound: 13, accountsWithBgStats: 4,
      funnel: {
        started: 28, rated: 18, closed: 22, chosen: 20, played: 12, result: 9, cancelled: 3,
      },
      // Sums to roundsTotal, which the tile's own test asserts.
      roundsByFinished: { none: 5, one: 3, many: 2 },
    },
    designAdoption: { byDesign: { ...DESIGNS }, switchedBack: 3 },
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
const adoptionTiles = (doc) => tiles(doc, '#adoptionGrid');
const labelsOf = (rows) => rows.map((x) => x.label);

/* ------------------------- the rows that went away ------------------------ */

test('the six inventory rows and the two series are gone from both cards', async (t) => {
  /* Absence assertions, so they are written against the RENDERED page rather
     than against the row builders — a tile can only vanish by not being pushed,
     and nothing else in the suite would notice if one came back. */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const labels = [...labelsOf(tiles(doc)), ...labelsOf(adoptionTiles(doc))];
  assert.ok(labels.length > 8, `the cards rendered almost nothing: ${labels.join(', ')}`);
  for (const gone of ['Neue Konten', 'Aktivierung', 'Konten (Verlauf)', 'Runden',
    'Spieler*innen', 'Spiele', 'Sessions (Verlauf)']) {
    assert.equal(labels.includes(gone), false, `„${gone}" is back on the card`);
  }
  // „Sessions" is a real tile on the adoption card, so it may not be asserted
  // absent by name — what must be gone is the INVENTORY tile, i.e. a Sessions
  // tile on the limits card.
  assert.equal(labelsOf(tiles(doc)).includes('Sessions'), false,
    'the Sessions inventory tile is back on „Grenzen & Kontingente"');
  assert.equal([...doc.querySelectorAll('svg')].length, 0,
    'a history chart is back — both series and renderChart were removed');
});

test('the „Titelbilder" backfill section is gone from the page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.equal(/Titelbilder/.test(html), false, 'the spent backfill card is still in the markup');
  assert.equal(/coverReencode/.test(html), false);
});

/* --------------------------- the two cards -------------------------------- */

test('each tile lands on the card whose question it answers', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  assert.deepEqual(labelsOf(tiles(doc)),
    ['Demo-Konten', 'Mail-Budget', 'Kontingente', 'Node'],
    '„Grenzen & Kontingente" is what is close to refusing a user, plus the runtime');
  assert.deepEqual(labelsOf(adoptionTiles(doc)),
    ['Konten', 'Regal-Nutzung', 'Designs', 'Teilen & Freunde',
      'Spiele-Quellen & Titelbilder', 'Besitz & Erweiterungen', 'Sessions',
      'Konto-Funktionen & eigene Tags', 'Session-Trichter', 'Runden mit zweiter Session'],
    'Konten sits FIRST on „Funktionsnutzung" — it is the denominator of the tiles below it');
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

/* --------------------------- the breakdown shape -------------------------- */

test('every multi-figure tile labels each figure on its own line', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const all = [...tiles(doc), ...adoptionTiles(doc)];
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

test('Regal-Nutzung is a SHARE of the rounds, with the three states beneath it', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const row = adoptionTiles(doc).find((x) => x.label === 'Regal-Nutzung');
  // 7 of 10, the UNION — not 3 + 1 + 5, which double-counts a round in two
  // states. 10 is `adoption.roundsTotal`, not `rounds.total` (#1174).
  assert.equal(row.value, '7 / 10');
  assert.match(row.note, /von 10/, 'the note must say what the share is out of');
  assert.deepEqual(row.breakdown,
    [['Aussortiert', '3'], ['Durchgespielt', '1'], ['Wunschliste', '5']]);
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

test('no adoption tile carries a verdict', async (t) => {
  /* Low uptake is not a fault condition, and a green pill would grade something
     for which nobody set a threshold. */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  for (const row of adoptionTiles(doc)) {
    assert.equal(row.pill, 'pill', `${row.label} renders a graded pill on the adoption card`);
  }
});

/* ------------------------ the design tile (#1201) ------------------------ */

test('Designs counts ACCOUNTS per design, headlined by the switch-back share', async (t) => {
  /* The per-round histogram (#941) is gone: once designs belong to accounts, a
     round's stored background says nothing about what anybody sees. Every line
     divides by `adoption.accountsTotal` (40), NOT `accounts.total` (42) — the
     fixture makes the two disagree so a renderer reaching for the instance-wide
     figure cannot pass. */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const row = adoptionTiles(doc).find((x) => x.label === 'Designs');
  assert.ok(row, 'no Designs row');
  assert.equal(row.value, '3 / 40', 'the headline is the switch-back share of the card\'s accounts');
  assert.match(row.note, /zurückgewechselt/);
  assert.match(row.note, /von 40/, 'the note must say what the share is out of');
  assert.deepEqual(row.breakdown, [['klassisch', '31 / 40'], ['tisch', '9 / 40']],
    'one line per offered design, in the order the server sent them');
  assert.equal(row.pill, 'pill', 'an adoption share carries the neutral pill');
});

test('the round histogram does not come back beside the account tile', async (t) => {
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

/* ------------------------------ the new shares ---------------------------- */

test('Konten is the ONE bare count, and „mit Bild" appears exactly once', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const konten = adoptionTiles(doc).find((x) => x.label === 'Konten');
  assert.equal(konten.value, '42', 'site adoption has no denominator to divide by');
  assert.deepEqual(konten.breakdown,
    [['bestätigt', '30'], ['unbestätigt', '12'], ['gesperrt', '1']]);
  // The profile-picture figure left this tile and lives as a SHARE one tile over.
  const text = doc.getElementById('adoptionGrid').textContent;
  assert.equal(/mit Bild/.test(text), false, 'the old „mit Bild" wording is back on Konten');
  const konto = adoptionTiles(doc).find((x) => x.label === 'Konto-Funktionen & eigene Tags');
  assert.deepEqual(Object.fromEntries(konto.breakdown)['Konto-Bild'], '7 / 40');
});

test('every new adoption figure renders against its own denominator', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const by = Object.fromEntries(adoptionTiles(doc).map((x) => [x.label, x]));

  const covers = by['Spiele-Quellen & Titelbilder'];
  assert.equal(covers.value, '52 / 80', '12 own + 40 provider covers, of 80 games');
  assert.deepEqual(covers.breakdown, [
    ['verknüpft', '55'], ['von Hand', '25'], ['eigenes Bild', '12'], ['vom Anbieter', '40'],
  ]);

  const owned = by['Besitz & Erweiterungen'];
  assert.equal(owned.value, '9 / 80');
  assert.deepEqual(Object.fromEntries(owned.breakdown)['mit Erweiterungen'], '4 / 80');

  const sessions = by.Sessions;
  assert.equal(sessions.value, '8 / 30');
  const sl = Object.fromEntries(sessions.breakdown);
  assert.equal(sl['mit Teams'], '2 / 30');
  assert.equal(sl['mit Vote-Link'], '5 / 30');

  const konto = Object.fromEntries(by['Konto-Funktionen & eigene Tags'].breakdown);
  assert.equal(by['Konto-Funktionen & eigene Tags'].value, '11 / 40');
  assert.equal(konto['BGG-Konto'], '6 / 40');
  // The one line on this tile measured against ROUNDS rather than accounts,
  // which is why each line carries its own denominator.
  assert.equal(konto['Runden mit eigenen Tags'], '6 / 10');

  const social = by['Teilen & Freunde'];
  assert.equal(social.value, '2 / 10');
  assert.deepEqual(social.breakdown, [['offene Einladungen', '1'], ['Freundschaften', '5']]);
});

test('a fresh instance renders „—", never „0 / 0" or NaN', async (t) => {
  /* Every denominator is 0 on an instance nobody has used yet. „0 / 0" claims a
     share of nothing and a percentage would be NaN, so the share renders as an
     em dash — and this is the case a hand-check never reaches, because the
     operator only ever opens the panel on an instance with data in it. */
  const zero = STATUS().metrics;
  const empty = {
    accounts: { total: 0, verified: 0, disabled: 0, withAvatar: 0 },
    rounds: { total: 0 },
    content: { games: 0, activeGames: 0, members: 0, sessions: 0, sessionsFinished: 0 },
    adoption: Object.fromEntries(Object.keys(zero.adoption).map((k) => [k, 0])),
    designAdoption: { byDesign: { klassisch: 0 }, switchedBack: 0 },
    social: { sharedRounds: 0, invitationsOpen: 0, friendships: 0 },
  };
  const { doc, dom } = await panel({ '/status': { status: STATUS(empty) } });
  t.after(() => dom.window.close());

  const rows = adoptionTiles(doc);
  assert.ok(rows.length >= 8, 'the adoption card did not render at all on empty data');
  const text = doc.getElementById('adoptionGrid').textContent;
  assert.equal(/NaN|Infinity/.test(text), false, `the empty card rendered ${text}`);
  assert.equal(/0 \/ 0/.test(text), false, 'a 0 / 0 pill claims a share of nothing');
  assert.equal(rows.find((x) => x.label === 'Konten').value, '0',
    'the one bare count still reads 0 rather than —');
  for (const label of ['Regal-Nutzung', 'Designs', 'Sessions']) {
    assert.equal(rows.find((x) => x.label === label).value, '—', `${label} did not render —`);
  }
  assert.deepEqual(rows.find((x) => x.label === 'Designs').breakdown, [['klassisch', '—']],
    'an offered design keeps its line on an empty instance, as „—" rather than 0 / 0');
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


/* ------------------------- the funnel and the habit ----------------------- */

test('the funnel headline is „played of started", with the other stages as lines', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const tile = adoptionTiles(doc).find((x) => x.label === 'Session-Trichter');
  assert.ok(tile, 'no Session-Trichter tile');
  /* The headline is „gespielt", not „gestartet": a session that never reaches
     „Als gespielt markieren" leaves no Chronik entry and lifts no score, which
     is the loss the tile exists to show. */
  assert.equal(tile.value, '12 / 28');
  assert.match(tile.note, /28 gestarteten/);
  assert.deepEqual(tile.breakdown, [
    ['von ≥2 bewertet', '18 / 28'],
    ['Abstimmung beendet', '22 / 28'],
    ['Spiel gewählt', '20 / 28'],
    ['Ergebnis erfasst', '9 / 28'],
    ['abgebrochen', '3 / 28'],
  ]);
  /* Every line is a share of STARTED, never of the line above it. The fixture
     is built so a pipeline reading would be visibly wrong — 18 rated sits below
     22 closed, which happens for real whenever a round picks its game directly
     (born closed and chosen, with nobody ever asked to vote). */
  assert.ok(tile.breakdown.every(([, v]) => v === '—' || v.endsWith('/ 28')),
    `a funnel line divides by something other than „started": ${JSON.stringify(tile.breakdown)}`);
});

test('the habit tile bands sum to the round total it divides by', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const tile = adoptionTiles(doc).find((x) => x.label === 'Runden mit zweiter Session');
  assert.ok(tile, 'no „Runden mit zweiter Session" tile');
  assert.equal(tile.value, '2 / 10');
  const [one, none] = tile.breakdown.map(([, v]) => Number(v));
  /* A COMPOSITE tile: the headline plus its two bands account for every round,
     so a reader can trust the breakdown to be exhaustive rather than a
     selection. 2 + 3 + 5 = 10 = adoption.roundsTotal. */
  assert.equal(2 + one + none, 10,
    'the three bands no longer sum to the round total — the tile stopped being exhaustive');
});

test('every share divides by the ADOPTION denominator, not the instance-wide one', async (t) => {
  /* The whole point of ADMIN_EXCLUDE_TENANTS (#1174): a numerator that had the
     operator's tenants removed, over a denominator that did not, reports shares
     above 100 %. Nothing about the rendered tile would look wrong — it is still
     a tidy „n / total" — so the fixture makes the two disagree and this test is
     the only thing that can see which one was used. */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const byLabel = Object.fromEntries(adoptionTiles(doc).map((x) => [x.label, x]));
  const denominatorOf = (v) => (v === '—' ? null : Number(v.split('/')[1].trim()));

  assert.equal(denominatorOf(byLabel['Regal-Nutzung'].value), 10, 'Regal-Nutzung used rounds.total');
  // Per ACCOUNT since #1201, so its denominator is accountsTotal (40), never the
  // instance-wide accounts.total (42).
  assert.equal(denominatorOf(byLabel.Designs.value), 40, 'Designs used accounts.total');
  assert.equal(denominatorOf(byLabel['Teilen & Freunde'].value), 10,
    'Teilen & Freunde used rounds.total');
  assert.equal(denominatorOf(byLabel['Spiele-Quellen & Titelbilder'].value), 80,
    'the covers tile used content.games');
  assert.equal(denominatorOf(byLabel['Besitz & Erweiterungen'].value), 80,
    'the ownership tile used content.games');
  assert.equal(denominatorOf(byLabel.Sessions.value), 30, 'the Sessions tile used content.sessions');
  assert.equal(denominatorOf(byLabel['Konto-Funktionen & eigene Tags'].value), 40,
    'the account tile used accounts.total');

  /* „Konten" is the ONE deliberate exception and must keep counting everybody:
     it is a bare count of who signed up at all, and an operator hidden from it
     could not see their own instance's size. */
  assert.equal(byLabel.Konten.value, '42');
});

test('the two new account figures are shares of the accounts on this card', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const tile = adoptionTiles(doc).find((x) => x.label === 'Konto-Funktionen & eigene Tags');
  const lines = Object.fromEntries(tile.breakdown);
  assert.equal(lines['BG-Stats-Weitergabe'], '4 / 40');
  assert.equal(lines['ohne Runde (nach Tenant)'], '13 / 40');
  // The Konto-Bild line reads the ADOPTION twin, not accounts.withAvatar —
  // both are 7 in the fixture on purpose, so this pins the denominator.
  assert.equal(lines['Konto-Bild'], '7 / 40');
});
