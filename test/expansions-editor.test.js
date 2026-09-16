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
const { loadApp, flush } = require('./support/dom');

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

const { rulesOf, topLevel, whole } = require('./support/css');

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
