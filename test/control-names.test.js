'use strict';

/* Three controls whose accessible NAME was wrong (audit 2026-10-04 A5–A7),
   rendered for real under jsdom (.claude/rules/testing-views-under-jsdom.md).

   A5 — the count steppers were named „−" and „+": a screen reader announced
        "minus, button" with nothing saying what it decreases. The session
        setup's count stepper (the issue) and the add-game sheet's two player
        steppers (the same markup, one screen over) take real labels now.
   A6 — each result row repeats „Spielen" and „Mehr" with no game in the name,
        so a list of controls reads „Spielen, Spielen, Spielen". They point
        `aria-describedby` at their own row's title, which keeps the visible
        label as the name (A-017, SC 2.5.3) and needs no per-locale phrasing.
   A7 — a lobby card is one <a>, and its name was everything inside it,
        including every avatar's initials: „Freitagsrunde MAANBECL 3 Spiele …".
        The stack is ONE image named by the member count now. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, translator } = require('./support/dom');

const de = translator('de');

const ANNA = { id: 'm1', name: 'Anna' };
const BEN = { id: 'm2', name: 'Ben' };

const game = (over) => ({ id: 7, title: 'Catan', tagIds: [], minPlayers: 2, maxPlayers: 4, image: null, ...over });
const round = (over = {}) => ({
  id: 'r1', name: 'Donnerstagsrunde', shared: false, background: null,
  games: [game()], members: [ANNA, BEN], sessions: [], activity: [], tags: [], providers: [], ...over,
});

function boot(t, data) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url) => (/\/activities$/.test(url) ? [] : data));
  dom.set('accountsActive', () => false);
  dom.set('isLoggedIn', () => false);
  dom.run('window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });');
  return dom;
}

const label = (el) => el.getAttribute('aria-label');

/* ------------------------------------------------------------- A5 steppers */

test('the session setup\'s count stepper names what it changes', async (t) => {
  const data = round();
  const dom = boot(t, data);
  await dom.call('showStartSession', data);
  const btns = [...dom.document.querySelectorAll('.setup-bar .stepper__btn')];
  assert.equal(btns.length, 2, 'the count stepper did not render');
  assert.deepEqual(btns.map(label), [de('startSession.countDown'), de('startSession.countUp')],
    'a stepper button is named by its glyph („−"/„+"), not by what it does');
});

test('the add-game sheet\'s player steppers name which bound they move', async (t) => {
  const dom = boot(t, round());
  await dom.call('showAddGame', round());
  const names = [...dom.document.querySelectorAll('.sheet .stepper__btn')].map(label);
  assert.deepEqual(names, [
    de('addGame.minPlayersDown'), de('addGame.minPlayersUp'),
    de('addGame.maxPlayersDown'), de('addGame.maxPlayersUp'),
  ]);
  // Four distinct names: two „−" buttons a screen reader cannot tell apart is
  // the defect, not merely an unlabelled one.
  assert.equal(new Set(names).size, 4, 'two stepper buttons share a name');
});

test('no stepper anywhere is named by a bare glyph', () => {
  // The two screens above are the only steppers today; this pins the markup
  // shape so a third one written by copying the old line goes red.
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'public', 'js');
  const offenders = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    .filter((f) => /stepper__btn[^>]*aria-label="[−+-]"/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(offenders, []);
});

/* ---------------------------------------------------------- A6 result rows */

const session = (over = {}) => ({
  id: 's1', createdAt: '2026-07-01T20:00:00.000Z', gameIds: ['g1', 'g2'], memberIds: ['m1'],
  votes: { m1: { g1: { rating: 5 }, g2: { rating: 3 } } }, votedIds: ['m1'],
  finished: false, cancelled: false, done: true, winnerIds: [], chosenGameId: null, events: [], ...over,
});

test('each result row\'s „Spielen" and „…" are described by THAT row\'s game', async (t) => {
  const r = round({ games: [{ id: 'g1', title: 'Catan', tagIds: [] }, { id: 'g2', title: 'Azul', tagIds: [] }] });
  const s = session();
  r.sessions = [s];
  const dom = boot(t, r);
  await dom.call('showResults', r, s, r.games, false);

  const rows = [...dom.app.querySelectorAll('.trow')];
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const title = row.querySelector('.trow__title');
    const controls = [row.querySelector('.play-btn'), row.querySelector('.trow__menu')];
    assert.ok(controls.every(Boolean), 'an open session offers „Spielen" and „…" on every row');
    for (const c of controls) {
      const ref = c.getAttribute('aria-describedby');
      assert.ok(ref, `„${c.textContent.trim() || label(c)}" names no game — every row reads the same`);
      const target = dom.document.getElementById(ref);
      assert.equal(target, title, 'described by something other than its own row\'s title');
    }
  }
  // Ids are unique, or the second row would describe itself with the first title.
  const ids = rows.map((row) => row.querySelector('.trow__title').id);
  assert.equal(new Set(ids).size, ids.length);

  // The column is REBUILT on every phase change (updateChosen); the reference
  // must survive that, not only the first render.
  rows[1].querySelector('.play-btn').click();
  await new Promise((res) => setImmediate(res));
  const menu = rows[0].querySelector('.trow__menu');
  assert.equal(dom.document.getElementById(menu.getAttribute('aria-describedby')), rows[0].querySelector('.trow__title'),
    'the rebuilt action column lost its description');
});

/* --------------------------------------------- the member page's name editor

   Reported during the 2026-10-04 audit as a click-only <span>, and it was: the
   member page's rename trigger predates #424 (which made the game title and,
   later, the round name keyboard-operable) and never got `tabindex`, `role` or
   a key handler — views-round.js's own comment said so. Tab skipped it in every
   design; Das Programmheft and Forest happen to add a visible „Bearbeiten"
   button that clicks it, so four designs had no keyboard path to a rename at
   all. Asserted per design, because two of them compose the card differently. */

const DESIGN_IDS = require('../public/js/designs').DESIGN_REGISTRY.map((d) => d.id);

for (const design of DESIGN_IDS) {
  test(`${design}: the member name is a keyboard-operable rename trigger`, async (t) => {
    const r = round({ games: [], sessions: [] });
    const dom = loadApp({ locale: 'de', design });
    t.after(() => dom.close());
    dom.set('api', async (method, url) => (/\/activities$/.test(url) ? [] : r));
    dom.set('accountsActive', () => false);
    dom.set('isLoggedIn', () => false);
    await dom.call('showMember', r.id, ANNA.id);

    // Scoped to the card: the desktop rail carries a `.gd-title` of its own.
    const trigger = dom.app.querySelector('.member-card h1 .gd-title');
    assert.ok(trigger, 'no name trigger on the member card');
    assert.ok(trigger.tabIndex >= 0 || /^(BUTTON|A)$/.test(trigger.tagName), 'Tab never reaches the name trigger');
    assert.equal(trigger.getAttribute('role'), 'button', 'a screen reader hears plain text, not a control');

    for (const key of ['Enter', ' ']) {
      trigger.focus();
      const ev = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      trigger.dispatchEvent(ev);
      const input = dom.app.querySelector('.member-card h1 .gd-title-input');
      assert.ok(input, `${JSON.stringify(key)} on the trigger opened no editor`);
      if (key === ' ') assert.ok(ev.defaultPrevented, 'Space must not also scroll the page');
      assert.equal(dom.document.activeElement, input, 'the editor did not take focus');
      // Escape cancels and hands focus back, or a keyboard user restarts at <body>.
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert.equal(dom.app.querySelector('.member-card h1 .gd-title-input'), null, 'Escape left the editor open');
      assert.equal(dom.document.activeElement, dom.app.querySelector('.member-card h1 .gd-title'),
        'Escape dropped focus instead of returning it to the trigger');
    }
  });
}

/* ---------------------------------------------------------- A7 lobby cards */

test('a lobby card\'s avatar stack is one image named by the member count', async (t) => {
  const r = { id: 1, name: 'Donnerstagsrunde', members: [ANNA, BEN, { id: 'm3', name: 'Clara' }], memberCount: 3,
    gameCount: 3, sessionCount: 1, playedCount: 1, background: null, lastPlayed: null };
  const dom = boot(t, [r]);
  await dom.call('showHome');
  const card = dom.document.querySelector('.round-card:not(.round-card--new)');
  const stack = card.querySelector('.avatar-stack');
  assert.equal(stack.getAttribute('role'), 'img',
    'the initials are read out one by one inside the link\'s name („AN BE CL")');
  assert.equal(label(stack), de('home.members', { n: 3 }));
  // The initials are still drawn, so this is about the name, not the picture.
  assert.equal(stack.querySelectorAll('.avatar').length, 3);
});
