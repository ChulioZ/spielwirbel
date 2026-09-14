'use strict';

/* The operator panel's Kennzahlen card, rendered (#941).
 *
 * `public/js/pages/admin.js` is a standalone IIFE loaded by its own document, so
 * nothing in the suite drove it before this: the route specs prove what the
 * server SENDS, and nothing proved what the panel DOES with it. That gap is
 * exactly where #941's additions live — the two history charts, the design
 * histogram's label resolution, and the storage card — none of which the server
 * has an opinion about (`.claude/rules/admin-kennzahlen-card.md`: the server
 * reports facts, statusRows holds the opinions).
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

// 26 buckets, with a recognisable shape: a zero week, a peak, and a known last.
const history = () => {
  const out = {};
  for (let i = 0; i < 26; i += 1) {
    const d = new Date(Date.UTC(2026, 2, 23) + i * 7 * 86400000).toISOString().slice(0, 10);
    out[d] = i === 5 ? 9 : (i % 3 === 0 ? 0 : 2);
  }
  return out;
};

const STATUS = () => ({
  metrics: {
    accounts: { total: 42, verified: 30, disabled: 1, withAvatar: 7, history: history() },
    rounds: { total: 11 },
    content: {
      games: 90, activeGames: 70, members: 25, sessions: 33, sessionsFinished: 20, sessions30d: 4,
      roundsWithRetired: 3, roundsWithCompleted: 1, roundsWithWish: 5, sessionHistory: history(),
    },
    designs: { forest: 4, '#f4f1ea': 2, 'not-a-design': 1, none: 3, collage: 1 },
    social: { sharedRounds: 2, invitationsOpen: 1, friendships: 5 },
    demo: { live: 1, max: 5 },
    mail: { sent: 2, limit: 200 },
    peaks: { roundsPerTenant: 3, gamesPerRound: 12, tagsPerRound: 4 },
  },
  quotas: { enforced: true, roundsPerTenant: 10, gamesPerRound: 200, tagsPerRound: 20 },
  runtime: { node: 'v22.0.0' },
});

// Load the real page with its real scripts; answer only what the card asks for.
async function panel(routes = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  /* `runScripts: 'dangerously'` and real <script> ELEMENTS, not `window.eval`.
     jsdom's eval does not put a script's top-level function declarations on the
     window — so `resolveDesign` came back undefined and every design read
     „unbekannt", which looks exactly like the resolver being broken. A real
     browser does create those globals from a classic script, so this is the
     harness matching the page rather than a workaround. The page's own
     <script src> tags are not fetched (no `resources: 'usable'`), which is why
     the two this test needs are injected below. */
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
    return {
      ok: true,
      status: 200,
      json: async () => (key !== undefined ? answers[key] : empty),
    };
  };
  for (const src of ['public/js/round-designs.js', 'public/js/pages/admin.js']) {
    const el = w.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(ROOT, src), 'utf8');
    w.document.body.appendChild(el);
  }
  // let the card's own load() settle
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
  return { w, doc: w.document, dom };
}

const tiles = (doc) => [...doc.querySelectorAll('#statusGrid .status__item')].map((el) => ({
  label: el.querySelector('.status__label').textContent,
  // The value rides in the verdict PILL, not a `.status__value` — one element
  // carries both the number and its grading.
  value: el.querySelector('.pill') ? el.querySelector('.pill').textContent : null,
  note: el.querySelector('.status__note') ? el.querySelector('.status__note').textContent : null,
  svg: el.querySelector('svg'),
}));

/* ------------------------- the rows that went away ------------------------ */

test('„Neue Konten" and „Aktivierung" are gone from the card', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const labels = tiles(doc).map((x) => x.label);
  assert.ok(labels.length > 5, `the card rendered almost nothing: ${labels.join(', ')}`);
  assert.equal(labels.includes('Neue Konten'), false);
  assert.equal(labels.includes('Aktivierung'), false);
});

test('the „Titelbilder" backfill section is gone from the page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.equal(/Titelbilder/.test(html), false, 'the spent backfill card is still in the markup');
  assert.equal(/coverReencode/.test(html), false);
});

/* ------------------------------ the charts -------------------------------- */

test('the two history rows render a 26-bar chart with an accessible name', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const charted = tiles(doc).filter((x) => x.svg);
  assert.deepEqual(charted.map((x) => x.label), ['Konten (Verlauf)', 'Sessions (Verlauf)'],
    'exactly the two dated metrics may carry a chart');

  for (const row of charted) {
    assert.equal(row.svg.getAttribute('role'), 'img',
      'a bare <svg> is invisible to a screen reader');
    const label = row.svg.getAttribute('aria-label');
    assert.ok(label && /26 Wochen/.test(label) && /Höchstwert 9/.test(label),
      `the chart's accessible name does not summarise the series: ${label}`);
    assert.equal(row.svg.querySelectorAll('rect').length, 26, 'one bar per week');
    // The row keeps a TEXT value beside the chart — what anyone not looking at
    // pixels actually reads.
    assert.ok(row.value && /^\d+$/.test(row.value), `no text value beside the chart: ${row.value}`);
  }
});

test('the chart paints in the page\'s own tokens, never a hex', async (t) => {
  /* test/standalone-page-brand.test.js sweeps this page for stray palette
     hexes, and a chart is exactly where one would look harmless. */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const fills = new Set();
  for (const r of doc.querySelectorAll('#statusGrid svg rect')) fills.add(r.getAttribute('fill'));
  assert.ok(fills.size >= 1);
  for (const f of fills) assert.match(f, /^var\(--[a-z-]+\)$/, `${f} is not a token`);
});

test('a zero week still draws a stub, so a quiet week is not a gap', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const bars = [...doc.querySelectorAll('#statusGrid svg')][0].querySelectorAll('rect');
  const heights = [...bars].map((b) => Number(b.getAttribute('height')));
  assert.ok(heights.every((h) => h >= 1), 'a week with no signups vanished from the chart');
  assert.ok(Math.max(...heights) > Math.min(...heights), 'every bar is the same height');
});

/* --------------------------- the design histogram ------------------------- */

test('designs are resolved by the PANEL, and an unknown id reads „unbekannt"', async (t) => {
  /* The server sends a raw histogram keyed by the stored id and never checks it
     against the registry — round-designs.js's header says so, so that the design
     list never becomes a cross-boundary contract. */
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const row = tiles(doc).find((x) => x.label === 'Designs');
  assert.ok(row, 'no Designs row');
  assert.equal(row.value, '5', 'five distinct keys came back');
  assert.match(row.note, /forest 4/, 'a known world is named by its id');
  assert.match(row.note, /standard 2/,
    'a LEGACY hex-only round resolves through the page-colour path to its design');
  assert.match(row.note, /ohne Design 3/);
  assert.match(row.note, /Collage 1/);
  assert.match(row.note, /unbekannt/,
    'an id the registry no longer knows must read „unbekannt", not echo the stored string');
  assert.equal(/not-a-design/.test(row.note), false,
    'the raw unknown id was echoed back as though it were a design');
});

/* ------------------------------ the new numbers --------------------------- */

test('the Konten row carries the profile-picture share on its detail line', async (t) => {
  // A share of an existing count, exactly like „bestätigt" — and this issue
  // removed two rows for being noise, so a whole row for one share would work
  // against that.
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const row = tiles(doc).find((x) => x.label === 'Konten');
  assert.match(row.note, /7 mit Bild/);
});

test('the shelf-use row counts ROUNDS against the round total', async (t) => {
  const { doc, dom } = await panel();
  t.after(() => dom.window.close());
  const row = tiles(doc).find((x) => x.label === 'Regal-Nutzung');
  assert.ok(row, 'no Regal-Nutzung row');
  assert.equal(row.value, '3 · 1 · 5');
  assert.match(row.note, /von 11\)/, 'the note must say what the counts are out of');
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
