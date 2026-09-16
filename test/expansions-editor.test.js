'use strict';

/* The expansions EDITOR — one tick-list in a centred dialog (#1143).

   Its own file rather than a section of test/game-expansions.test.js, which
   covers the write route and the surfaces that merely READ what a round owns
   (the chip, the Regal badge, the results warning). This is the overlay: how the
   set is assembled and committed, which is edited on its own and pushed that
   file past the 700-line budget (.claude/rules/token-friendly-source-files.md).

   Named for what it covers, not for a module basename — `expansions` alone would
   have collided with the file it was split out of
   (.claude/rules/test-file-names-collide-silently.md).

   Every spec here drives the real view under jsdom rather than matching source
   (.claude/rules/testing-views-under-jsdom.md). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush, loadI18n } = require('./support/dom');

// The two stored expansions the fixture's Catan owns — one with a player range
// and one without, since "no range" renders its own line.
const EXP = [
  { id: 'x1', title: '5–6 Spieler', source: null, minPlayers: 5, maxPlayers: 6, addedAt: '2026-08-01T10:00:00.000Z' },
  { id: 'x2', title: 'Ohne Angabe', source: null, minPlayers: null, maxPlayers: null, addedAt: '2026-08-01T10:00:00.000Z' },
];

function roundFixture(expansions) {
  return {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    providers: [],
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [
      { id: 'g1', title: 'Catan', minPlayers: 3, maxPlayers: 4, tagIds: [], image: null, ...(expansions ? { expansions } : {}) },
    ],
    sessions: [],
  };
}

/* The fixture is a BGG-linked game throughout, because the provider's candidates
   are what make the list long enough to be the wrong shape for an anchored card
   in the first place. */

const CANDIDATES = [
  { providerId: 'p1', title: 'Seefahrer' },
  { providerId: 'p2', title: 'Städte & Ritter' },
];

function bootPicker(t, { owned = null, candidates = CANDIDATES, cap } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = roundFixture(owned);
  round.games[0].source = { provider: 'bgg', externalId: '13' };
  // NOT the fixture's `[]`, which means "query nothing" rather than "all"
  // (the absent-≠-empty shape the retired `providers` setting had, #744) — with
  // it the lookup never runs and there are no candidate rows at all.
  round.providers = ['bgg'];
  const puts = [];
  dom.set('api', async (method, url, body) => {
    if (/\/activities$/.test(url)) return [];
    if (/\/lookup\/expansions/.test(url)) return { expansions: candidates };
    if (method === 'PUT') { puts.push(body); return { ...round.games[0], expansions: [] }; }
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return round;
    return {};
  });
  dom.set('isLoggedIn', () => false);
  if (cap !== undefined) dom.run(`setExpansionsCap(${JSON.stringify(cap)})`);
  return { dom, puts };
}

async function openPicker(dom, gameId = 'g1') {
  await dom.call('showGameDetail', 'r1', gameId);
  dom.app.querySelector('.gd-chips .tag--expansions').click();
  // The candidates arrive a few microtasks later and the rows are only built
  // then; without this the list holds nothing but the owned entries.
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  const card = dom.document.querySelector('.editor--expansions');
  assert.ok(card, 'the expansions editor did not open');
  return card;
}

const payloads = (put) => [...put.expansions].map((e) => ({ ...e }));

/* The presentation, and the ONLY spec in this file that stubs the width branch.
   `usesEditorSheet` is forced to the DESKTOP answer, which is where the anchored
   card used to be — so this is what fails if the editor ever consults the 860px
   split again AND that split still has a popover branch. The rest of the file
   catches the split coming back at all (see the note on `openExpansions`); this
   one catches what it would resolve to. */
test('the editor is a centred list dialog even at desktop width — never an anchored card', async (t) => {
  const { dom } = bootPicker(t, { owned: EXP });
  dom.set('usesEditorSheet', () => false);
  const card = await openPicker(dom);

  assert.equal(dom.document.querySelector('.popover--expansions'), null,
    'the anchored card is back: at 1280x800 a 26-row list clamps it, dropping its '
    + 'children’s flex floors and putting the commit button 271px below its own edge');
  const sheet = card.closest('.sheet');
  assert.ok(sheet, 'the editor is not inside a sheet');
  assert.ok(sheet.classList.contains('sheet--dialog'), 'centred dialog, not a bottom sheet');
  assert.ok(sheet.classList.contains('sheet--list'),
    'a scanning list wants the 640px width, not the 460px a short form reads best at');
  // One scroll region: `.sheet`. Anything else here is the third scroller this
  // issue removed.
  assert.equal(card.querySelector('.exp-pick__body, .exp-have__body'), null);
});

test('owned entries and provider candidates are ONE list — ticked and unticked', async (t) => {
  const { dom } = bootPicker(t, { owned: EXP });
  const card = await openPicker(dom);

  const rows = [...card.querySelectorAll('.exp-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.ds-row__title').textContent),
    ['5–6 Spieler', 'Ohne Angabe', 'Seefahrer', 'Städte & Ritter'],
    'owned first, then what the provider still has');
  assert.deepEqual(rows.map((r) => r.querySelector('input').checked), [true, true, false, false]);
  // Same component for all four — the two boxes with two heads are gone.
  assert.equal(new Set(rows.map((r) => r.className.replace(' ds-row--picked', ''))).size, 1);
  // A <label> row is genuinely clickable, so it must NOT carry the inert opt-out
  // (.claude/rules/ds-row-is-a-click-target.md).
  assert.equal(card.querySelector('.exp-row.ds-row--static'), null);
  assert.equal(rows[0].tagName, 'LABEL');
});

test('unticking an owned entry removes it on Übernehmen — no confirm dialog', async (t) => {
  const { dom, puts } = bootPicker(t, { owned: EXP });
  // If the rewrite ever reaches for the old confirm path this fails loudly
  // rather than hanging on an unsettled promise
  // (.claude/rules/confirm-dialog-is-a-promise-on-a-single-slot-sheet.md §3).
  dom.set('confirmDialog', async () => { throw new Error('confirmDialog must not be involved'); });
  const card = await openPicker(dom);

  card.querySelectorAll('.exp-row input')[0].click();   // untick the first owned one
  card.querySelector('.exp-bar .btn--primary').click();
  await flush();

  assert.equal(puts.length, 1, 'one PUT');
  // The survivor only. The route replaces the list wholesale, so omission IS
  // the removal.
  assert.deepEqual(payloads(puts[0]), [{ id: 'x2' }]);
});

test('unticking and DISMISSING changes nothing — the dialog is the undo', async (t) => {
  const { dom, puts } = bootPicker(t, { owned: EXP });
  const card = await openPicker(dom);
  card.querySelectorAll('.exp-row input')[0].click();
  dom.document.querySelector('.sheet__close').click();
  await flush();
  assert.equal(puts.length, 0,
    'an untick is reversible until commit — that is what pays for removal being silent');
});

test('committing an unchanged set sends nothing at all', async (t) => {
  const { dom, puts } = bootPicker(t, { owned: EXP });
  const card = await openPicker(dom);
  card.querySelector('.exp-bar .btn--primary').click();
  await flush();
  assert.equal(puts.length, 0, 'every owned row still ticked and no candidate ticked');
});

test('the free-text form is collapsed, and its range fields wait for a name', async (t) => {
  const { dom, puts } = bootPicker(t, { owned: EXP });
  const card = await openPicker(dom);

  const own = card.querySelector('.exp-own');
  assert.equal(own.tagName, 'DETAILS',
    'a native disclosure — Enter/Space and the focus ring come from the platform');
  assert.equal(own.open, false, 'collapsed on open: it used to be a permanently open 157px form');

  const range = card.querySelector('.exp-own__range');
  assert.equal(range.hidden, true, 'nothing to range over yet');
  const name = card.querySelector('.exp-own__name');
  name.value = 'Händler & Barbaren';
  name.dispatchEvent(new dom.window.Event('input'));
  assert.equal(range.hidden, false);

  // Both-or-neither is unchanged: a lone bound states no interval.
  range.querySelectorAll('.input')[0].value = '5';
  card.querySelector('.exp-bar .btn--primary').click();
  await flush();
  assert.equal(puts.length, 0, 'a half-declared range is still refused');

  range.querySelectorAll('.input')[1].value = '6';
  card.querySelector('.exp-bar .btn--primary').click();
  await flush();
  assert.equal(puts.length, 1);
  assert.deepEqual(payloads(puts[0]), [
    { id: 'x1' }, { id: 'x2' },
    { title: 'Händler & Barbaren', minPlayers: 5, maxPlayers: 6 },
  ]);
});

/* The quota, stated BEFORE the write. It reached the client only as
   `detail.toast.expansionQuota` after a PUT the server had already refused —
   which is the one thing a sticky bar can fix and a taller card cannot. */
test('the bar counts the ticked set against the cap, and refuses past it', async (t) => {
  const { dom, puts } = bootPicker(t, { owned: EXP, cap: 3 });
  const card = await openPicker(dom);
  const count = card.querySelector('.exp-bar__count');
  const ok = card.querySelector('.exp-bar .btn--primary');

  assert.equal(count.textContent, '2 von 3 im Regal');
  assert.equal(ok.disabled, false);

  card.querySelectorAll('.exp-row input')[2].click();   // a candidate -> 3
  assert.equal(count.textContent, '3 von 3 im Regal');
  assert.equal(ok.disabled, false, 'at the ceiling is still allowed');

  card.querySelectorAll('.exp-row input')[3].click();   // -> 4, over
  assert.equal(count.textContent, '4 von 3 im Regal');
  assert.ok(count.classList.contains('exp-bar__count--over'));
  assert.equal(ok.disabled, true, 'refused here rather than by the 403');

  // A hand-typed entry counts too — it is one more row the PUT will carry.
  card.querySelectorAll('.exp-row input')[3].click();   // back to 3
  const name = card.querySelector('.exp-own__name');
  name.value = 'Eigenbau';
  name.dispatchEvent(new dom.window.Event('input'));
  assert.equal(count.textContent, '4 von 3 im Regal');
  assert.equal(ok.disabled, true);

  ok.click();
  await flush();
  assert.equal(puts.length, 0, 'a disabled button sends nothing');
});

test('with no ceiling to count against, the bar states a bare count', async (t) => {
  // `null` is what /api/config reports where quotas are inert (accounts off), and
  // it must not read as "0 von 0" or as over a limit — a self-hosted round may
  // legitimately hold more than the default.
  const { dom } = bootPicker(t, { owned: EXP, cap: null });
  const card = await openPicker(dom);
  assert.equal(card.querySelector('.exp-bar__count').textContent, '2 im Regal');
  assert.equal(card.querySelector('.exp-bar .btn--primary').disabled, false);
});

/* The filter is the one control that depends on how long the list turned out to
   be, so it can only be decided once the candidates have arrived. */
test('the filter appears only past ~20 rows, and narrows the one list', async (t) => {
  const many = Array.from({ length: 25 }, (_, i) => ({ providerId: 'p' + i, title: 'Erweiterung ' + i }));
  const { dom } = bootPicker(t, { candidates: many });
  const card = await openPicker(dom);

  const filter = card.querySelector('.exp-filter');
  assert.ok(filter, '25 rows is past the threshold');
  assert.equal(card.querySelectorAll('.exp-row').length, 25);

  filter.value = 'ung 1';
  filter.dispatchEvent(new dom.window.Event('input'));
  const shown = [...card.querySelectorAll('.exp-row .ds-row__title')].map((el) => el.textContent);
  assert.deepEqual(shown, ['Erweiterung 1', 'Erweiterung 10', 'Erweiterung 11', 'Erweiterung 12',
    'Erweiterung 13', 'Erweiterung 14', 'Erweiterung 15', 'Erweiterung 16', 'Erweiterung 17',
    'Erweiterung 18', 'Erweiterung 19']);

  filter.value = 'Catan Junior';
  filter.dispatchEvent(new dom.window.Event('input'));
  assert.equal(card.querySelectorAll('.exp-row').length, 0);
  assert.match(card.querySelector('.exp-list').textContent, /Keine Erweiterung/);
});

test('a short list gets no filter — it would be chrome in a dialog that is about height', async (t) => {
  const { dom } = bootPicker(t, { owned: EXP });
  const card = await openPicker(dom);
  assert.equal(card.querySelectorAll('.exp-row').length, 4);
  assert.equal(card.querySelector('.exp-filter'), null);
});

/* A FILTERED row that is ticked must still be committed. The filter re-renders
   the list, so an implementation holding the picked set in the DOM rather than
   in the row model would silently drop everything scrolled out of view. */
test('a tick survives the filter that hides its row', async (t) => {
  const many = Array.from({ length: 25 }, (_, i) => ({ providerId: 'p' + i, title: 'Erweiterung ' + i }));
  const { dom, puts } = bootPicker(t, { candidates: many });
  const card = await openPicker(dom);

  card.querySelectorAll('.exp-row input')[0].click();       // Erweiterung 0
  const filter = card.querySelector('.exp-filter');
  filter.value = 'Erweiterung 24';
  filter.dispatchEvent(new dom.window.Event('input'));
  assert.equal(card.querySelectorAll('.exp-row').length, 1, 'the ticked row is out of view');
  card.querySelectorAll('.exp-row input')[0].click();       // Erweiterung 24

  card.querySelector('.exp-bar .btn--primary').click();
  await flush();
  assert.deepEqual(payloads(puts[0]), [{ providerId: 'p0' }, { providerId: 'p24' }]);
});

/* ---------------- the dialog's own CSS (#1143) ------------------------------
   Asserted over the stylesheet text, because jsdom applies no external
   stylesheet. Existence is looked up in `topLevel()` so a grouped `@media` reset
   naming the same selector cannot answer for a deleted rule
   (.claude/rules/css-rule-lookup-answers-with-the-media-reset.md). */

const { rulesOf, topLevel, whole, mediaBlocks, CSS } = require('./support/css');

const TOP = rulesOf(topLevel());
const topBody = (sel) => (TOP.find(([s]) => s.split(',').map((x) => x.trim()).includes(sel)) || [])[1] || null;

test('nothing bounds the expansions editor any more — the cap and both scroll boxes are gone', () => {
  /* The inverse of the guard this replaces. That one asserted the popover kept
     its cap while the sheet did not; there is no popover presentation left, so
     the question is whether anything in the sheet reintroduced one. A `.sheet`
     has no fold to protect and is already its own scroll container, so a cap
     here clips content nothing was constraining and a nested scroll box takes
     the gesture away from it (.claude/rules/popover-vs-sheet-editors.md §4). */
  const BOUNDS = ['max-height', 'overflow-y', 'overscroll-behavior'];
  const rules = TOP.filter(([sel]) => whole('.editor--expansions').test(sel));
  // Anti-vacuous: the editor still owns a dozen layout rules, so an empty list
  // would mean the selector was renamed, not that nothing bounds it.
  assert.ok(rules.length >= 8,
    `only ${rules.length} rules name .editor--expansions — has it been renamed?`);
  for (const [sel, body] of rules) {
    for (const prop of BOUNDS) {
      assert.doesNotMatch(body, new RegExp(`(^|;)\\s*${prop}\\s*:`),
        `${sel} sets ${prop} — the dialog scrolls itself`);
    }
  }
  // …and the popover presentation is really gone, not merely unused by the view.
  assert.equal(TOP.some(([sel]) => whole('.popover--expansions').test(sel)), false,
    'a .popover--expansions rule survives the editor that used it');
});

test('the range fields are hidden by a PAIRED [hidden] rule, not by the attribute alone', () => {
  // `.exp-own__range` declares `display: flex`, and an author rule beats the UA
  // stylesheet's `[hidden] { display: none }` — so without this the two number
  // fields render before there is a name to range over
  // (.claude/rules/hidden-attribute-vs-display-rule.md).
  const paired = topBody('.editor--expansions .exp-own__range[hidden]');
  assert.ok(paired, 'no [hidden] rule — the attribute hides nothing here');
  assert.match(paired, /display:\s*none/);
});

test('the sticky commit bar sits flush against the scrollport', () => {
  // It reuses `.sheet__actions`, so the sticky, the rule and the safe-area
  // padding all come from the component rather than being restated.
  const bar = topBody('.editor--expansions .exp-bar');
  assert.ok(bar, 'the bar has no rule of its own');
  const actions = topBody('.sheet__actions');
  assert.match(actions, /position:\s*sticky/);
  assert.match(actions, /bottom:\s*0/);
  // `.sheet > :last-child:not(.sheet__actions)` adds 26px below the editor, which
  // would otherwise sit UNDER the sticky bar and hold it that far off the edge.
  const flush = topBody('.sheet > .editor.editor--expansions:last-child');
  assert.ok(flush, 'the trailing gap is back under the sticky bar');
  assert.match(flush, /margin-bottom:\s*0/);
});

/* ---- What each owned row says it UNLOCKS (#1144) ---------------------------

   The editor never mentioned the one thing an owned expansion reaches into:
   `fitsPlayerCount`. A row reported the expansion's own interval („2–6
   Personen"), which the reader then had to compare against the base box's range
   in their head — on a screen that does not show that range at all.

   POSITIVE ATTRIBUTION ONLY. A row that unlocks nothing carries NO line, and
   that is the load-bearing half rather than an omission: an expansion that
   changes no player count is the overwhelming majority, so a „changes nothing"
   line would be the line on nearly every row and would read as a complaint
   about a perfectly good box. The three-state version was built and rejected
   (operator, 2026-09-16).

   Every line that IS rendered is a sentence derived from the pool's own
   predicates. Reverting to a min/max comparison keeps the first case green and
   breaks the solo one, which is why both are here. */

// Catan's own box is 3–4 throughout this section, so every number below is a
// count the base game cannot seat.
const UNLOCKS = [
  { id: 'u1', title: 'Fünf–Sechs', source: null, minPlayers: 5, maxPlayers: 6, addedAt: '2026-08-01T10:00:00.000Z' },
  { id: 'u2', title: 'Händler', source: null, minPlayers: 3, maxPlayers: 4, addedAt: '2026-08-01T10:00:00.000Z' },
  { id: 'u3', title: 'Ohne Angabe', source: null, minPlayers: null, maxPlayers: null, addedAt: '2026-08-01T10:00:00.000Z' },
];

const metas = (card) => [...card.querySelectorAll('.exp-row')]
  .map((r) => { const m = r.querySelector('.ds-row__main .muted'); return m ? m.textContent : null; });

test('a row says what it UNLOCKS — and says nothing at all when it unlocks nothing', async (t) => {
  const { dom } = bootPicker(t, { owned: UNLOCKS });
  const card = await openPicker(dom);

  assert.deepEqual(metas(card).slice(0, 3), [
    'Ermöglicht 5–6 Personen',
    // A 3–4 expansion on a 3–4 game, and one with no range recorded. Neither
    // gets a line: there is nothing positive to say, and saying so on every
    // content expansion is what this shape exists to avoid.
    null,
    null,
  ]);
  // The raw interval is what the row used to print, and „3–4 Personen" on a 3–4
  // game is exactly the non-answer this replaces.
  assert.doesNotMatch(card.textContent, /3–4 Personen/,
    'the expansion’s own interval is not the reader’s question');
  // Nor does the rejected three-state version leave a trace: no locale may
  // carry a phrase for the two empty cases, or it would be one edit from
  // returning.
  assert.doesNotMatch(card.textContent, /Ändert die Spielerzahl|Ohne Spielerzahl/);
});

/* The keys really are gone, in every locale — not merely unused by this view.
   An unread key is one call site from coming back, and this is the assertion
   that makes removing it a decision rather than a tidy-up. */
test('no locale carries a phrase for "this expansion changes nothing"', () => {
  const { SUPPORTED_LOCALES } = require('../public/js/locales');
  for (const loc of SUPPORTED_LOCALES) {
    const dict = loadI18n(loc);
    for (const key of ['detail.expansionAddsNone', 'detail.expansionNoRange']) {
      // t() falls back to the key name when the key is absent — which is
      // exactly the signal we want here.
      assert.equal(dict.t(key), key, `${loc}: '${key}' is back`);
    }
  }
});

test('a run is a run and a gap is a gap — never the hull between them', async (t) => {
  /* 3–4 base + a 2–6 expansion admits 2, 5 and 6. This guards the FORMATTER,
     not the derivation: a line built from the set's own ends would print
     „2–6 Personen" and offer a table of four through an expansion, and of
     three, which the base box already seats. (Measured — the natural min/max
     HULL happens to produce the same three counts for this fixture, so it is
     the solo case below that discriminates that half, not this one.) */
  const { dom } = bootPicker(t, {
    owned: [{ id: 'g1', title: 'Lücke', source: null, minPlayers: 2, maxPlayers: 6, addedAt: '2026-08-01T10:00:00.000Z' }],
  });
  const card = await openPicker(dom);
  assert.equal(metas(card)[0], 'Ermöglicht 2, 5–6 Personen');
});

test('a SOLO expansion inflects, and never names the pair a hull would invent', async (t) => {
  const { dom } = bootPicker(t, {
    owned: [{ id: 's1', title: 'Solo', source: null, minPlayers: 1, maxPlayers: 1, addedAt: '2026-08-01T10:00:00.000Z' }],
  });
  const card = await openPicker(dom);
  assert.equal(metas(card)[0], 'Ermöglicht 1 Person', 'an uninflected „1 Personen" is the tell');
  assert.doesNotMatch(card.textContent, /1–4|Ermöglicht 2/, 'a hull of 3–4 and 1–1 admits a pair nothing seats');
});

/* A provider candidate carries no line either, and for a DATA reason rather
   than the editorial one above: GET …/lookup/expansions returns
   `{ providerId, title }`, so the player counts do not exist client-side until
   the server resolves the ticked ids on save. Fetching them would be one
   upstream request per candidate. */
test('a provider candidate gets no line — its counts are not known yet', async (t) => {
  const { dom } = bootPicker(t, { owned: UNLOCKS });
  const card = await openPicker(dom);
  assert.deepEqual(metas(card).slice(3), [null, null], 'Seefahrer and Städte & Ritter');
});

/* The spine (#1144). A CSS-text assertion because jsdom applies no external
   stylesheet — the DOM half of this feature is the line above, which the specs
   further up drive through the real view. */
test('the spine marks the ticked state without costing the list any height', () => {
  const base = topBody('.editor--expansions .exp-row::before');
  const on = topBody('.editor--expansions .exp-row.ds-row--picked::before');
  assert.ok(base && on, 'the spine rules are gone');

  // Absolutely positioned, so 26 rows are exactly as tall as they were without
  // it — the „zero extra height" the seats band was dropped in favour of.
  assert.match(base, /position:\s*absolute/);
  // Theme tokens, never literals: on a dark design --sunken is the LIGHTER of
  // the two (.claude/rules/theme-derived-colors.md).
  assert.match(base, /background:\s*var\(--sunken\)/);
  assert.match(on, /background:\s*var\(--brand\)/);
  assert.doesNotMatch(base + on, /#[0-9a-fA-F]{3,8}/, 'a literal colour cannot follow the round’s design');
  // transform, not height — a growing box would reflow the list under the
  // pointer that is clicking it.
  assert.match(base, /transform:[^;]*scaleY\(0?\.\d+\)/);
  assert.match(on, /transform:[^;]*scaleY\(1\)/);
  // The duration and the radius come from the scales, not from literals
  // (test/design-tokens.test.js enforces both sheet-wide).
  assert.match(base, /transition:[^;]*var\(--dur-/);

  // …and it is never the only signal. The checkbox is asserted by the DOM specs
  // above; this is the row-level treatment it rides on.
  assert.ok(topBody('.ds-row--picked'), '.ds-row--picked carries the border and tint');
});

test('the spine’s transition is suppressed under prefers-reduced-motion', () => {
  const reduce = mediaBlocks(CSS).filter(([q]) => /prefers-reduced-motion:\s*reduce/.test(q));
  const off = reduce.flatMap(([, css]) => rulesOf(css))
    .find(([sel]) => sel === '.editor--expansions .exp-row::before');
  assert.ok(off, 'no reduce override for the spine');
  assert.match(off[1], /transition:\s*none/);
  // The two END states must stay outside the query: suppressing the colour or
  // the scale as well would park every spine at the unticked look, which is a
  // wrong statement rather than a still picture.
  assert.doesNotMatch(off[1], /background|transform/);
});
