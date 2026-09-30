'use strict';

/*
 * The top-bar design menu (#1429): the palette button beside the language
 * picker, its popover, where a pick is stored, and the precedence rule it made
 * necessary in applyAccountDesign().
 *
 * Driven through the jsdom harness, never require() — design-menu.js touches
 * `document` throughout (test/support/dom.js's header says why).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { DESIGN_REGISTRY, FACE_DESIGN, CLASSIC_DESIGN } = require('../public/js/designs');

const ALL = { designs: DESIGN_REGISTRY.map((d) => d.id) };
const OTHER = 'tisch' === FACE_DESIGN ? CLASSIC_DESIGN : 'tisch';

// `loggedIn` is read by the isLoggedIn stub on every call, so a spec can move
// the session under a running page; `api` records every account request.
function boot(t, { cfg = ALL, me = null, accounts = true, api } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const state = { loggedIn: !!me, sent: [], toasts: [] };
  dom.set('withAppConfig', (cb) => cb(cfg));
  dom.set('accountsActive', () => accounts);
  dom.set('isLoggedIn', () => accounts && state.loggedIn);
  dom.set('toast', (msg, opts) => state.toasts.push([msg, opts && opts.tone]));
  dom.set('accountApi', (method, path, body) => {
    state.sent.push([method, path, JSON.parse(JSON.stringify(body))]);
    return api ? api(body) : Promise.resolve({ ...me, design: body.design });
  });
  if (me) dom.run(`accountUser = ${JSON.stringify(me)}`);
  return { dom, state };
}

const btnOf = (dom) => dom.document.getElementById('designBtn');
const rowsOf = (dom) => [...dom.document.querySelectorAll('.design-menu .design-menu__opt')];
const open = (dom) => { dom.call('setupDesignMenu'); btnOf(dom).focus(); btnOf(dom).click(); };
const rowFor = (dom, id) => rowsOf(dom).find((r) => r.querySelector('input').value === id);
// A real tap: a click on the LABEL carrying detail 1, which jsdom then forwards
// to the radio (label activation) and turns into its `change`.
const tap = (dom, id) => rowFor(dom, id).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
// A keyboard step: the radio changes with no pointer click at all.
const arrowTo = (dom, id) => {
  const input = rowFor(dom, id).querySelector('input');
  input.checked = true;
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

/* ---------------------------------- the gate ---------------------------------- */

test('the button stays hidden until the instance offers a choice', (t) => {
  const one = boot(t, { cfg: { designs: [FACE_DESIGN] } }).dom;
  one.call('setupDesignMenu');
  assert.equal(btnOf(one).hidden, true, 'one design is not a choice');

  const failed = boot(t, { cfg: null }).dom;
  failed.call('setupDesignMenu');
  assert.equal(btnOf(failed).hidden, true, 'no config answer: nothing to offer');

  const many = boot(t).dom;
  many.call('setupDesignMenu');
  assert.equal(btnOf(many).hidden, false);
  assert.equal(btnOf(many).previousElementSibling.id, 'langPicker', 'it sits directly after the language picker');
});

test('the menu lists exactly the offered designs, the worn one checked', (t) => {
  const { dom } = boot(t, { cfg: { designs: [CLASSIC_DESIGN, 'tisch'] } });
  dom.run(`applyDesign(${JSON.stringify('tisch')})`);
  open(dom);
  const group = dom.document.querySelector('.design-menu [role="radiogroup"]');
  assert.ok(group, 'a radio group');
  assert.equal(group.getAttribute('aria-label'), dom.run("t('design.pick.label')"));
  assert.deepEqual(rowsOf(dom).map((r) => r.querySelector('input').value), [CLASSIC_DESIGN, 'tisch']);
  assert.equal(rowFor(dom, 'tisch').querySelector('input').checked, true);
  assert.equal(btnOf(dom).getAttribute('aria-expanded'), 'true');
  assert.equal(dom.document.activeElement, rowFor(dom, 'tisch').querySelector('input'), 'focus lands on the checked radio');
});

/* ----------------------------- where a pick goes ----------------------------- */

test('logged in: a pick PATCHes /me and leaves the device key alone', async (t) => {
  const { dom, state } = boot(t, { me: { id: 'u1', design: CLASSIC_DESIGN } });
  dom.run(`applyAccountDesign()`);
  open(dom);
  tap(dom, 'tisch');
  await flush();
  assert.deepEqual(state.sent, [['PATCH', '/me', { design: 'tisch' }]]);
  assert.equal(dom.get('accountUser').design, 'tisch');
  assert.equal(dom.document.documentElement.dataset.design, 'tisch');
  assert.equal(dom.window.localStorage.getItem('design'), null,
    'the account holds it — a device copy would outrank nothing and only go stale');
  assert.equal(state.toasts.length, 0, 'no success toast: the repaint is the feedback');
});

for (const [label, opts] of [['logged out, accounts on', {}], ['accounts off', { accounts: false }]]) {
  test(`${label}: a pick is stored on the device, with no request`, async (t) => {
    const { dom, state } = boot(t, opts);
    open(dom);
    tap(dom, 'tisch');
    await flush();
    assert.deepEqual(state.sent, [], 'nothing goes to the server');
    assert.equal(dom.window.localStorage.getItem('design'), 'tisch');
    assert.equal(dom.document.documentElement.dataset.design, 'tisch');
    assert.equal(dom.run('applyAccountDesign()'), 'tisch', 'and it survives the next boot-time resolution');
  });
}

test('a refused save reverts the paint and toasts', async (t) => {
  const { dom, state } = boot(t, {
    me: { id: 'u1', design: CLASSIC_DESIGN },
    api: () => Promise.reject(new Error('invalid_design')),
  });
  dom.run('applyAccountDesign()');
  open(dom);
  tap(dom, 'tisch');
  assert.equal(dom.document.documentElement.dataset.design, 'tisch', 'previewed while in flight');
  await flush();
  assert.equal(dom.document.documentElement.dataset.design, CLASSIC_DESIGN, 'reverted');
  assert.deepEqual(state.toasts, [[dom.run("t('konto.design.invalid')"), 'error']]);
});

/* ------------------------------ pointer vs keys ------------------------------ */

const press = (dom, key) => dom.document.activeElement.dispatchEvent(
  new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

test('arrow keys only PREVIEW; Escape puts the worn design back and returns focus', async (t) => {
  const { dom, state } = boot(t, { accounts: false });
  open(dom);
  arrowTo(dom, 'tisch');
  await flush();
  assert.ok(dom.document.querySelector('.design-menu'), 'a keyboard walk must survive its first step');
  assert.equal(dom.document.documentElement.dataset.design, 'tisch', 'each step shows the design');
  assert.equal(dom.window.localStorage.getItem('design'), null, 'but stores nothing');

  press(dom, 'Escape');
  assert.equal(dom.document.querySelector('.design-menu'), null);
  assert.equal(dom.document.documentElement.dataset.design, CLASSIC_DESIGN, 'Escape takes the preview back off');
  assert.equal(dom.document.activeElement, btnOf(dom), 'focus back on the button');
  assert.equal(btnOf(dom).getAttribute('aria-expanded'), 'false');
  assert.deepEqual(state.sent, []);
});

test('Enter answers with the radio the arrow keys reached', async (t) => {
  const { dom, state } = boot(t, { me: { id: 'u1', design: CLASSIC_DESIGN } });
  dom.run('applyAccountDesign()');
  open(dom);
  arrowTo(dom, 'tisch');
  assert.deepEqual(state.sent, [], 'no request while only previewing');
  rowFor(dom, 'tisch').querySelector('input').focus();
  press(dom, 'Enter');
  await flush();
  assert.equal(dom.document.querySelector('.design-menu'), null);
  assert.deepEqual(state.sent, [['PATCH', '/me', { design: 'tisch' }]]);
  assert.equal(dom.document.documentElement.dataset.design, 'tisch');
});

test('a tap answers and closes — on a new row, and on the row already checked', async (t) => {
  const { dom } = boot(t, { accounts: false });
  open(dom);
  tap(dom, 'tisch');
  await flush();
  assert.equal(dom.document.querySelector('.design-menu'), null, 'a tap is the answer');
  assert.equal(dom.window.localStorage.getItem('design'), 'tisch');

  btnOf(dom).click();
  tap(dom, 'tisch'); // checked already: no `change` fires
  assert.equal(dom.document.querySelector('.design-menu'), null, 'tapping the worn row closes too');

  btnOf(dom).click();
  arrowTo(dom, CLASSIC_DESIGN);
  tap(dom, CLASSIC_DESIGN); // the previewed row is checked: tapping it keeps it
  await flush();
  assert.equal(dom.window.localStorage.getItem('design'), CLASSIC_DESIGN);
  assert.equal(dom.document.documentElement.dataset.design, CLASSIC_DESIGN);
});

test('a second press on the button closes the menu', (t) => {
  const { dom } = boot(t);
  open(dom);
  btnOf(dom).click();
  assert.equal(dom.document.querySelector('.design-menu'), null);
  assert.equal(btnOf(dom).getAttribute('aria-expanded'), 'false');
});

/* ------------------------------ the precedence ------------------------------ */

test('logged out wears the device pick; logged in the account; logout and a lost session go back', async (t) => {
  // The REAL accountsActive/isLoggedIn/logout/onSessionLost, so the precedence is
  // read off the same token and account state the app uses.
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  for (const stub of ['setupAccountUi', 'showLanding', 'showLogin', 'invalidateRoundCache', 'resetAvatarCache']) {
    dom.set(stub, () => {});
  }
  dom.set('authFetch', () => Promise.resolve({ ok: true, data: {} }));
  dom.run('accountsMode = true');
  const signIn = () => {
    dom.window.localStorage.setItem('sa_access', 'a');
    dom.window.localStorage.setItem('sa_refresh', 'r');
    dom.run(`accountUser = { id: 'u1', design: ${JSON.stringify(CLASSIC_DESIGN)} }`);
  };
  // Neither the face nor the account's design, so no fallback can pass for it.
  const PICK = 'ocean';
  assert.notEqual(PICK, FACE_DESIGN);
  dom.run(`storeDesign(${JSON.stringify(PICK)})`);

  assert.equal(dom.run('applyAccountDesign()'), PICK, 'a logged-out visitor wears their device pick');
  signIn();
  assert.equal(dom.run('applyAccountDesign()'), CLASSIC_DESIGN, 'at login the account wins');

  await dom.run('logout()');
  assert.equal(dom.document.documentElement.dataset.design, PICK,
    'logout repaints — the landing must not keep the account’s design');

  signIn();
  dom.run('applyAccountDesign()');
  dom.run('onSessionLost()');
  assert.equal(dom.document.documentElement.dataset.design, PICK, 'and so does a lost session');
  assert.equal(dom.window.localStorage.getItem('design'), PICK, 'the device pick was never overwritten');
});

test('a stored id this instance no longer offers falls back to the face once config arrives', (t) => {
  const dom = loadApp({ locale: 'de', design: null });
  t.after(() => dom.close());
  dom.set('accountsActive', () => false);
  let answer;
  dom.set('withAppConfig', (cb) => { answer = cb; });
  dom.window.localStorage.setItem('design', OTHER);

  dom.run('initDesign()');
  assert.equal(dom.document.documentElement.dataset.design, OTHER,
    'trusted until the server answers, so a returning visitor sees no flash of the face');
  answer({ designs: [FACE_DESIGN] });
  assert.equal(dom.document.documentElement.dataset.design, FACE_DESIGN);
  assert.equal(dom.run('applyAccountDesign()'), FACE_DESIGN, 'and later resolutions agree');

  answer(null); // a failed config request must not throw
});

/* ------------------------- the language globe (CSS) ------------------------- */

const fs = require('node:fs');
const path = require('node:path');
const { rulesOf, topLevel, mediaBlocks, declaredValue } = require('./support/css');

test('the invisible select covers the globe: same width, pulled back by width + bar gap', () => {
  const top = rulesOf(topLevel());
  const bodies = (sel) => top.filter(([s]) => s === sel).map(([, b]) => b).join(';');
  const globe = bodies('.lang-picker__globe');
  const select = bodies('.lang-picker');
  const bar = bodies('.topbar');
  const w = declaredValue(globe, 'width');
  assert.match(w || '', /^\d+px$/, 'the globe pins its width, or nothing can be matched to it');
  assert.equal(declaredValue(select, 'width'), w);
  assert.equal((declaredValue(select, 'margin-left') || '').replace(/\s+/g, ''), `calc(-1*(${w}+var(--topbar-gap)))`);
  assert.equal(declaredValue(select, 'opacity'), '0');
  assert.equal(declaredValue(bar, 'gap'), 'var(--topbar-gap)', 'the gap the pull subtracts must be the gap the bar uses');
  assert.match(declaredValue(bar, '--topbar-gap') || '', /^\d+px$/);

  // A `gap:` set on the bar anywhere else would move the globe out from under
  // the select with nothing red — so it has to go through the property.
  const sheets = [['styles.css media blocks', mediaBlocks().map(([, css]) => css).join('\n')]];
  const dir = path.join(__dirname, '..', 'public', 'css', 'designs');
  for (const f of fs.readdirSync(dir)) {
    sheets.push([f, fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);
  }
  let seen = 0;
  for (const [name, css] of sheets) {
    for (const [sel, body] of rulesOf(css)) {
      if (!/\.topbar(?![\w-])\s*$/.test(sel.split(',').pop().trim()) && !/\.topbar(?![\w-])(\s*,|$)/.test(sel)) continue;
      seen += 1;
      assert.equal(declaredValue(body, 'gap'), null, `${name}: "${sel}" sets the bar's gap directly — set --topbar-gap`);
    }
  }
  assert.ok(seen >= 3, `only ${seen} .topbar rules scanned — is the sweep reading anything?`);
});
