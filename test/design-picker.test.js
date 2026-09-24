'use strict';

/*
 * The per-user design PICKER (#1186): the card list the Konto screen and the
 * first-start chooser share, the chooser sheet itself, and the two-source
 * resolution in applyAccountDesign().
 *
 * Named after what it covers rather than after the module, because `design.js`
 * and `designs.js` already have `test/design-layer.test.js` and a third spec
 * named for a basename is how one silently overwrites another
 * (.claude/rules/test-file-names-collide-silently.md).
 *
 * Everything here touches the DOM, so it runs through the jsdom+vm harness and
 * NOT through require() — a view file in the coverage report drags coverage:ci
 * under its floor (.claude/rules/frontend-helper-modules-and-coverage.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');
/* Objects built inside the jsdom realm have that realm's Object.prototype, so a
   deepEqual against a literal declared here fails on the prototype alone —
   printing two identical-looking values. Round-tripping through JSON is the
   cheapest way to compare what a stub actually RECEIVED. */
const plain = (v) => JSON.parse(JSON.stringify(v));
const { bodyOf, bodyOfIn, declaredValue } = require('./support/css');
const {
  DESIGN_REGISTRY, FACE_DESIGN, DESIGN_CHOOSER_REVISION, designById,
} = require('../public/js/designs');

const BOTH = { designs: DESIGN_REGISTRY.map((d) => d.id) };
const FACE_ONLY = { designs: [FACE_DESIGN] };

// A logged-in account wearing `design`, with the config already answered — the
// state every spec below starts from unless it says otherwise.
function boot(t, { cfg = BOTH, me = null, accounts = true } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('withAppConfig', (cb) => cb(cfg));
  dom.set('accountsActive', () => accounts);
  dom.set('isLoggedIn', () => accounts && !!me);
  dom.set('toast', () => {});
  if (me) dom.run(`accountUser = ${JSON.stringify(me)}`);
  return dom;
}

/* -------------------------- the licensed CSS copy --------------------------- */

test('#1186: the .design-card tile defaults ARE Klassisch\'s :root colours', () => {
  /* Klassisch declares no colours in the registry — it IS the :root block, and
     designs.js says why restating them in JS would drift. The tile still needs
     two values to paint, so styles.css carries the only copy, and this is the
     test that licenses it (.claude/rules/shared-constants-across-the-stack.md's
     TAG_ICONS shape: a copy plus a parity assertion that goes red on a one-sided
     edit). Retune --brand and this names both values. */
  const root = bodyOf(':root');
  const card = bodyOfIn('.design-card');
  assert.equal(declaredValue(card, '--tile-page'), declaredValue(root, '--page-bg'));
  assert.equal(declaredValue(card, '--tile-accent'), declaredValue(root, '--brand'));
  // Anti-vacuous: an empty string on both sides would satisfy the two above.
  assert.match(declaredValue(root, '--page-bg'), /^#[0-9a-f]{6}$/i);
  assert.match(declaredValue(root, '--brand'), /^#[0-9a-f]{6}$/i);
});

/* ------------------------------- the card list ------------------------------ */

test('#1186: the picker renders one card per OFFERED design, current one marked', (t) => {
  const dom = boot(t);
  const list = dom.call('renderDesignPicker', BOTH, 'tisch', () => {});
  const cards = list.querySelectorAll('.design-card');
  assert.equal(cards.length, DESIGN_REGISTRY.length);
  // Registry order, so the face heads the list without a sort key.
  assert.equal(cards[0].querySelector('input').value, FACE_DESIGN);
  assert.equal(cards[0].querySelector('.design-card__badge').textContent, 'Wie bisher');
  assert.equal(list.querySelector('input:checked').value, 'tisch');
  assert.ok(cards[1].classList.contains('is-on'));

  // A design's own colours paint its tile; Klassisch's carries NOTHING inline,
  // which is what makes the CSS defaults above load-bearing rather than a
  // fallback nobody reaches.
  assert.equal(cards[0].querySelector('.design-tile').style.getPropertyValue('--tile-page'), '');
  assert.equal(cards[1].querySelector('.design-tile').style.getPropertyValue('--tile-page'),
    designById('tisch').page);
});

test('#1186: the picker offers only what the SERVER listed', (t) => {
  const dom = boot(t);
  const list = dom.call('renderDesignPicker', FACE_ONLY, FACE_DESIGN, () => {});
  assert.equal(list.querySelectorAll('.design-card').length, 1);
  assert.equal(list.querySelector('input').value, FACE_DESIGN);
});

test('#1186: choosing a card reports the id and moves the mark', (t) => {
  const dom = boot(t);
  const picked = [];
  const list = dom.call('renderDesignPicker', BOTH, FACE_DESIGN, (id) => picked.push(id));
  const second = list.querySelectorAll('.design-card')[1];
  second.querySelector('input').checked = true;
  second.querySelector('input').dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual(picked, ['tisch']);
  assert.ok(second.classList.contains('is-on'));
  assert.equal(list.querySelectorAll('.design-card')[0].classList.contains('is-on'), false,
    'exactly one card may read as chosen');
});

/* -------------------------------- the chooser ------------------------------- */

test('#1186: the chooser fires once, and only where there is a choice', (t) => {
  const sheets = (dom) => dom.document.querySelectorAll('.design-chooser').length;

  const unseen = boot(t, { me: { id: 'u1', design: FACE_DESIGN, designChooserSeen: null } });
  unseen.call('maybeShowDesignChooser', unseen.get('accountUser'));
  assert.equal(sheets(unseen), 1, 'an account that has not seen it is asked');

  const seen = boot(t, { me: { id: 'u2', design: FACE_DESIGN, designChooserSeen: DESIGN_CHOOSER_REVISION } });
  seen.call('maybeShowDesignChooser', seen.get('accountUser'));
  assert.equal(sheets(seen), 0, 'and once seen, never again for this revision');

  const alone = boot(t, { cfg: FACE_ONLY, me: { id: 'u3', design: FACE_DESIGN, designChooserSeen: null } });
  alone.call('maybeShowDesignChooser', alone.get('accountUser'));
  assert.equal(sheets(alone), 0, 'one design is not a choice — this is production today');

  const out = boot(t, { accounts: false });
  out.call('maybeShowDesignChooser', null);
  assert.equal(sheets(out), 0, 'no account, nothing to store the answer on');
});

test('#1186: confirming stores the pick and the stamp in ONE request', async (t) => {
  const me = { id: 'u1', design: FACE_DESIGN, designChooserSeen: null };
  const dom = boot(t, { me });
  const sent = [];
  dom.set('accountApi', (method, path, body) => {
    sent.push([method, path, body]);
    return Promise.resolve({ ...me, design: body.design || me.design, designChooserSeen: DESIGN_CHOOSER_REVISION });
  });

  dom.call('maybeShowDesignChooser', me);
  const sheet = dom.document.querySelector('.design-chooser');
  // Preview: moving through the cards applies the design straight away, because
  // what a design IS is what it looks like.
  const tisch = sheet.querySelectorAll('.design-card')[1].querySelector('input');
  tisch.checked = true;
  tisch.dispatchEvent(new dom.window.Event('change'));
  assert.equal(dom.document.documentElement.dataset.design, 'tisch', 'previewed live');

  sheet.querySelector('#designChooserGo').click();
  await flush();
  assert.deepEqual(plain(sent), [['POST', '/design-chooser-seen', { design: 'tisch' }]]);
  assert.equal(dom.get('accountUser').designChooserSeen, DESIGN_CHOOSER_REVISION);
  assert.equal(dom.document.documentElement.dataset.design, 'tisch');
});

test('#1186: declining reverts the preview BEFORE the request, and still records it', async (t) => {
  const me = { id: 'u1', design: FACE_DESIGN, designChooserSeen: null };
  const dom = boot(t, { me });
  const sent = [];
  /* The request is held IN FLIGHT on purpose. Resolving it immediately hides
     what this spec is about: applyAccountDesign() in the .then() reverts the
     page too, so with a fast stub the synchronous revert is redundant and
     deleting it leaves the suite green — measured
     (.claude/rules/redundant-guards-make-each-other-untestable.md). The two are
     NOT redundant in the app: between the click and the response the user is
     still looking at a design they just declined, and if the request fails they
     keep it until they reload. */
  let release;
  dom.set('accountApi', (method, path, body) => {
    sent.push(body);
    return new dom.window.Promise((resolve) => { release = () => resolve({ ...me, designChooserSeen: DESIGN_CHOOSER_REVISION }); });
  });

  dom.call('maybeShowDesignChooser', me);
  const sheet = dom.document.querySelector('.design-chooser');
  const tisch = sheet.querySelectorAll('.design-card')[1].querySelector('input');
  tisch.checked = true;
  tisch.dispatchEvent(new dom.window.Event('change'));
  assert.equal(dom.document.documentElement.dataset.design, 'tisch', 'previewed live');

  sheet.querySelector('#designChooserSkip').click();
  assert.equal(dom.document.documentElement.dataset.design, FACE_DESIGN,
    'reverted at once, not one round trip later');
  assert.deepEqual(plain(sent), [{}], 'seen, with no design');

  release();
  await flush();
  assert.equal(dom.document.documentElement.dataset.design, FACE_DESIGN, 'and it stays reverted');
});

test('#1186: a chooser answer that never arrives leaves no previewed design behind', async (t) => {
  const me = { id: 'u1', design: FACE_DESIGN, designChooserSeen: null };
  const dom = boot(t, { me });
  // The offline case: accountApi rejects, the catch deliberately does nothing,
  // and the synchronous revert above is the ONLY thing standing between the
  // user and a design they declined.
  dom.set('accountApi', () => dom.window.Promise.reject(new dom.window.Error('network')));

  dom.call('maybeShowDesignChooser', me);
  const sheet = dom.document.querySelector('.design-chooser');
  const tisch = sheet.querySelectorAll('.design-card')[1].querySelector('input');
  tisch.checked = true;
  tisch.dispatchEvent(new dom.window.Event('change'));

  sheet.querySelector('#designChooserSkip').click();
  await flush();
  assert.equal(dom.document.documentElement.dataset.design, FACE_DESIGN);
});

test('#1186: the chooser is answered exactly ONCE however it is dismissed', async (t) => {
  const me = { id: 'u1', design: FACE_DESIGN, designChooserSeen: null };
  const dom = boot(t, { me });
  let calls = 0;
  dom.set('accountApi', () => { calls += 1; return Promise.resolve({ ...me, designChooserSeen: DESIGN_CHOOSER_REVISION }); });

  dom.call('maybeShowDesignChooser', me);
  const sheet = dom.document.querySelector('.design-chooser');
  // Confirm, then hit skip on the (now detached) sheet: the buttons and
  // closeSheet's own teardown are two paths into finish(), and without the
  // `settled` guard the stamp request would go out twice.
  sheet.querySelector('#designChooserGo').click();
  sheet.querySelector('#designChooserSkip').click();
  await flush();
  assert.equal(calls, 1);
});

/* --------------------------- which design applies --------------------------- */

test('#1186: with accounts ON the account field decides, not the device key', (t) => {
  const dom = boot(t, { me: { id: 'u1', design: 'tisch', designChooserSeen: null } });
  dom.window.localStorage.setItem('design', FACE_DESIGN);
  assert.equal(dom.run('applyAccountDesign()'), 'tisch',
    'a stale device value must not outrank the account — that is the whole point of per-user');
  assert.equal(dom.document.documentElement.dataset.design, 'tisch');
});

test('#1186: with accounts OFF the device key decides', (t) => {
  const dom = boot(t, { accounts: false });
  assert.equal(dom.run('applyAccountDesign()'), FACE_DESIGN, 'nothing stored yet');
  dom.run('storeDesign("tisch")');
  assert.equal(dom.window.localStorage.getItem('design'), 'tisch');
  assert.equal(dom.run('applyAccountDesign()'), 'tisch');

  // A value this build has never heard of leaves the page on the face rather
  // than unpainted — a design can be retired between two visits.
  dom.run('storeDesign("a-design-that-was-retired")');
  assert.equal(dom.run('applyAccountDesign()'), FACE_DESIGN);
});

test('#1186: a localStorage that throws does not take the boot with it', (t) => {
  const dom = boot(t, { accounts: false });
  // Safari's private window and any blocked-site-data setting throw on ACCESS,
  // not on a missing key — so both sides need the guard, and a design
  // preference is not worth a boot that dies before the first render.
  dom.window.Object.defineProperty(dom.window, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError'); },
  });
  assert.equal(dom.run('storedDesign()'), '');
  dom.run('storeDesign("tisch")'); // must not throw
  assert.equal(dom.run('applyAccountDesign()'), FACE_DESIGN);
});

/* ------------- re-rendering the screen on a committed change (#1266) ------------- */

test('the chooser re-renders the screen underneath once, on the answer, never on a preview', async (t) => {
  const me = { id: 'u1', design: FACE_DESIGN, designChooserSeen: null };
  const dom = boot(t, { me });
  dom.set('accountApi', (method, path, body) => Promise.resolve({ ...me, design: body.design || me.design, designChooserSeen: DESIGN_CHOOSER_REVISION }));
  dom.run(`applyDesign(${JSON.stringify(FACE_DESIGN)}); designViewsReady(); globalThis.__renders = 0; currentView = () => { globalThis.__renders++; }`);

  dom.call('maybeShowDesignChooser', me);
  const sheet = dom.document.querySelector('.design-chooser');
  const tisch = sheet.querySelectorAll('.design-card')[1].querySelector('input');
  tisch.checked = true;
  tisch.dispatchEvent(new dom.window.Event('change'));
  assert.equal(dom.run('globalThis.__renders'), 0, 'a preview must not rebuild anything');

  sheet.querySelector('#designChooserGo').click();
  await flush();
  assert.equal(dom.run('globalThis.__renders'), 1, 'the screen built under the old design is rebuilt under the kept one');
});

test('the Konto picker re-renders only once the server has taken the pick', async (t) => {
  const me = { id: 'u1', design: FACE_DESIGN };
  const dom = boot(t, { me });
  let resolve;
  dom.set('accountApi', () => new dom.window.Promise((r) => { resolve = r; }));
  dom.run(`applyDesign(${JSON.stringify(FACE_DESIGN)}); designViewsReady(); globalThis.__renders = 0; currentView = () => { globalThis.__renders++; }`);
  const section = dom.call('buildDesignSection', dom.get('accountUser'));
  dom.document.body.appendChild(section);
  const tisch = section.querySelectorAll('.design-card')[1].querySelector('input');
  tisch.checked = true;
  tisch.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.equal(dom.run('globalThis.__renders'), 0,
    'in flight: re-rendering now would redraw the picker from the old account, old card checked');
  resolve({ ...me, design: 'tisch' });
  await flush();
  assert.equal(dom.run('globalThis.__renders'), 1);
  assert.equal(dom.document.documentElement.dataset.design, 'tisch');
});
