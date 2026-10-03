'use strict';

/* Forest's sign-in, Konto and design chooser (#1470, F5.1-F5.5).
 *
 * Operator ruling „A design owns its layout": the views branch on
 * designIs('forest') and nothing else. The price of that licence is proof that
 * the branch is Forest's alone, so the first test is a golden snapshot of every
 * screen this slice touches under Klassisch — login, register, forgot-password,
 * the Konto (a real account and a demo) and the one-time chooser. It was
 * generated from the views BEFORE #1470 touched them (byte-identical to the
 * fixture #1376 pinned, so it is that file). Regenerate only for a change that
 * deliberately alters Klassisch:
 *   SPIELWIRBEL_UPDATE_GOLDEN=1 node --test test/forest-konto.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { DESIGN_REGISTRY } = require('../public/js/designs');

// The SAME golden Das Programmheft's slice pins (#1376): it was generated
// before either design touched these screens, and #1470 regenerated it
// unchanged — one Klassisch, one file.
const GOLDEN = path.join(__dirname, 'fixtures', 'programmheft-konto-klassisch-golden.json');
const ALL = { designs: DESIGN_REGISTRY.map((d) => d.id), footer: true };

const ME = {
  id: 'u1', email: 'ada@example.org', username: 'ada', demo: false, design: 'klassisch',
  designChooserSeen: null, bggUsername: null, notify: {}, profileStats: true,
};

function boot(t, design, { loggedIn = false, me = ME } = {}) {
  const dom = loadApp({ locale: 'de', design });
  t.after(() => dom.close());
  dom.set('withAppConfig', (cb) => cb(ALL));
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => loggedIn);
  dom.set('passkeysSupported', () => true);
  dom.set('toast', () => {});
  dom.set('accountApi', async (method, url) => {
    if (method === 'GET' && url === '/me') return { ...me };
    if (method === 'GET' && /passkeys/.test(url)) return [];
    return {};
  });
  if (loggedIn) dom.run(`accountUser = ${JSON.stringify(me)}`);
  return dom;
}

// The screen's own content, with whitespace folded so a template literal's
// indentation is not part of the contract.
function snapshot(root) {
  return root.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
}

async function renderAll(t, design) {
  const out = {};
  for (const screen of ['showLogin', 'showRegister', 'showForgot']) {
    const dom = boot(t, design);
    dom.call(screen);
    await flush();
    out[screen] = snapshot(dom.app);
  }
  for (const [key, me] of [['konto', ME], ['kontoDemo', { ...ME, demo: true, email: 'x@demo.invalid' }]]) {
    const dom = boot(t, design, { loggedIn: true, me: { ...me, design } });
    await dom.call('showAccount');
    await flush();
    out[key] = snapshot(dom.app);
  }
  {
    const dom = boot(t, design, { loggedIn: true, me: { ...ME, design } });
    dom.call('showDesignChooser', ALL, { ...ME, design }, null);
    out.chooser = snapshot(dom.document.querySelector('.sheet-backdrop'));
  }
  return out;
}

test('Klassisch: sign-in, register, forgot, Konto and the chooser render exactly as before #1470', async (t) => {
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

test('the snapshot can see Forest: the same screens under it are NOT the golden', async (t) => {
  // The control that proves the comparison above discriminates at all.
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const fo = await renderAll(t, 'forest');
  for (const k of ['showLogin', 'showRegister', 'konto', 'kontoDemo', 'chooser']) {
    assert.notEqual(fo[k], golden[k], `Forest's ${k} is identical to Klassisch's`);
  }
  // Forgot-password keeps the single card (F5 draws no pair for it).
  assert.equal(fo.showForgot, golden.showForgot, 'forgot-password markup moved');
});

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const FO = { ...ME, design: 'forest' };

/* ------------------------------- sign-in pair -------------------------------- */

for (const [screen, own, other] of [['showLogin', 'login', 'register'], ['showRegister', 'register', 'login']]) {
  test(`#1470: ${screen} under Forest is the pair — both forms, its own card the h1`, async (t) => {
    const dom = boot(t, 'forest');
    const paths = [];
    dom.set('syncUrl', (p) => paths.push(p));
    dom.call(screen);
    await flush();
    const pair = dom.app.querySelector('.auth > .auth-pair');
    assert.ok(pair, 'no Forest pair');
    assert.equal(pair.dataset.current, own);
    assert.deepEqual(paths, [`/${own}`], 'the route is the screen\'s own');
    // DOM order = visual order: the phone's switch, then login, then register.
    const kids = [...pair.children];
    assert.deepEqual(kids.map((el) => el.className), ['auth-seg', 'auth__card', 'auth__card']);
    const [loginCard, registerCard] = kids.slice(1);
    assert.ok(loginCard.querySelector('#authEmail') && loginCard.querySelector('#passkeyLogin'));
    assert.ok(registerCard.querySelector('#regEmail') && registerCard.querySelector('.auth__terms'));
    // One h1 — the route's card — and the document title follows it.
    const ownCard = own === 'login' ? loginCard : registerCard;
    const otherCard = own === 'login' ? registerCard : loginCard;
    assert.equal(pair.querySelectorAll('h1').length, 1);
    assert.equal(ownCard.querySelector('.auth__title').tagName, 'H1');
    assert.equal(otherCard.querySelector('.auth__title').tagName, 'H2');
    assert.ok(dom.document.title.startsWith(text(ownCard.querySelector('h1'))), `title "${dom.document.title}"`);
    // F5.1 draws no logo on either card, and the cross-links are the pair itself.
    assert.equal(pair.querySelector('.auth__logo, #toRegister, #toLogin'), null);
    // The passkey stays under the submit (#1193), forgot keeps its link.
    const order = [...loginCard.querySelectorAll('button')].map((b) => b.id || b.type);
    assert.ok(order.indexOf('submit') < order.indexOf('passkeyLogin'), order.join());
    assert.ok(loginCard.querySelector('#toForgot'));
    // Every id unique: two forms on one page must not collide.
    const ids = [...dom.app.querySelectorAll('[id]')].map((el) => el.id);
    assert.deepEqual(ids, [...new Set(ids)], 'duplicate ids on the pair page');
    // The switch marks the route; focus sits in the route's first field.
    const seg = pair.querySelector(`.auth-seg__item[data-seg="${own}"]`);
    assert.equal(seg.getAttribute('aria-current'), 'page');
    assert.equal(pair.querySelector(`.auth-seg__item[data-seg="${other}"]`).getAttribute('aria-current'), null);
    assert.equal(dom.document.activeElement, ownCard.querySelector('input'));
  });
}

test('#1470: each form of the pair submits on its own', async (t) => {
  const dom = boot(t, 'forest');
  const sent = [];
  dom.set('authFetch', async (url) => { sent.push(url); return { ok: false, data: {} }; });
  dom.call('showLogin');
  await flush();
  const [loginCard, registerCard] = dom.app.querySelectorAll('.auth__card');
  loginCard.querySelector('#authEmail').value = 'ada';
  loginCard.querySelector('#authPassword').value = 'secret-pw';
  loginCard.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();
  registerCard.querySelector('#regEmail').value = 'ada@example.org';
  registerCard.querySelector('#regUser').value = 'ada';
  registerCard.querySelector('#regPw').value = 'secret-password';
  registerCard.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();
  assert.deepEqual(sent, ['/login', '/register']);
});

/* --------------------------------- posters ----------------------------------- */

test('#1470: under Forest every design is a leaf poster — Klassisch first, painted from its own row', (t) => {
  const dom = boot(t, 'forest', { loggedIn: true, me: FO });
  const wrap = dom.call('buildDesignSection', { ...FO });
  const cards = [...wrap.querySelectorAll('.design-card')];
  assert.deepEqual(cards.map((c) => c.querySelector('input').value), DESIGN_REGISTRY.map((d) => d.id));
  for (const card of cards) {
    const design = DESIGN_REGISTRY.find((d) => d.id === card.querySelector('input').value);
    assert.ok(card.classList.contains('design-card--leaf'), `${design.id} is not a leaf card`);
    const art = card.querySelector('.design-tile--leaf');
    assert.equal(art.getAttribute('aria-hidden'), 'true');
    assert.equal(art.textContent.trim(), '', 'F5 sets no word on the picture');
    assert.deepEqual([...art.children].map((el) => el.className), ['design-tile__sun', 'design-tile__leaf', 'design-tile__dot']);
    assert.equal(art.style.getPropertyValue('--poster-top'), design.poster.ground[0]);
    assert.equal(art.style.getPropertyValue('--poster-foot'), design.poster.ground[1]);
    assert.equal(art.style.getPropertyValue('--poster-ink'), design.poster.ink);
    assert.equal(art.style.getPropertyValue('--poster-sub'), design.poster.sub);
    assert.equal(art.nextElementSibling, card.querySelector('.design-card__body'), 'the picture, then its band');
    assert.equal(text(card.querySelector('.design-card__name')), dom.run(`t(${JSON.stringify(design.labelKey)})`));
    for (const sel of ['.design-card__active', '.design-card__picked']) {
      const mark = card.querySelector(sel);
      assert.ok(mark && mark.getAttribute('aria-hidden') === 'true', `${sel} must be aria-hidden`);
    }
    assert.equal(text(card.querySelector('.design-card__active')), 'Aktiv');
  }
  assert.deepEqual(cards.filter((c) => c.classList.contains('is-on')).map((c) => c.querySelector('input').value), ['forest']);
  assert.ok(wrap.querySelector('.konto-design__head .konto-section__h'));
});

test('#1470: Forest\'s light poster is its registry row\'s, not F5\'s dusk bill', () => {
  const forest = DESIGN_REGISTRY.find((d) => d.id === 'forest');
  const tisch = DESIGN_REGISTRY.find((d) => d.id === 'tisch');
  // Luminance of the ground's top: Forest's reads light beside Tisch's green.
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  assert.ok(lum(forest.poster.ground[0]) > 0.85, 'Forest\'s poster is not light');
  assert.ok(lum(tisch.poster.ground[0]) < 0.5);
});

/* --------------------------------- chooser ----------------------------------- */

test('#1470: the chooser under Forest is the print sheet of leaf posters, ONE named commit', async (t) => {
  const dom = boot(t, 'forest', { loggedIn: true, me: FO });
  const sent = [];
  dom.set('accountApi', async (method, url, body) => { sent.push([method, url, body]); return { ...FO, ...body }; });
  dom.call('showDesignChooser', ALL, { ...FO }, null);
  const sheet = dom.document.querySelector('.design-chooser--print');
  assert.ok(sheet, 'no Forest chooser');
  assert.equal(sheet.querySelectorAll('.design-card--leaf').length, DESIGN_REGISTRY.length);
  assert.equal(sheet.querySelector('.design-card--print'), null);
  const go = sheet.querySelector('#designChooserGo');
  assert.equal(text(go), 'Forest übernehmen');
  const radio = sheet.querySelector('input[value="klassisch"]');
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event('change'));
  assert.equal(text(go), 'Klassisch übernehmen');
  go.click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [['POST', '/design-chooser-seen', { design: 'klassisch' }]]);
});

/* ---------------------------------- Konto ------------------------------------ */

async function konto(t, design, me) {
  const dom = boot(t, design, { loggedIn: true, me: { ...me, design } });
  await dom.call('showAccount');
  await flush();
  return dom;
}

test('#1470: the Konto keeps every section beside an index with an icon per entry and „Abmelden"', async (t) => {
  const klassisch = await konto(t, 'klassisch', ME);
  const want = [...klassisch.app.querySelectorAll('h2.konto-section__h')].map(text);
  assert.ok(want.length >= 10, 'the Klassisch Konto rendered implausibly few sections');

  const dom = await konto(t, 'forest', ME);
  let out = 0;
  dom.set('logout', () => { out++; });
  const nav = dom.app.querySelector('.konto-ph > nav.konto-index');
  assert.ok(nav, 'no index');
  assert.deepEqual([...dom.app.querySelectorAll('.konto-ph__body h2.konto-section__h')].map(text), want);
  const links = [...nav.querySelectorAll('button.konto-index__link')];
  assert.deepEqual(links.map(text), want);
  const missing = links.filter((l) => !l.querySelector('i.ti[aria-hidden="true"]')).map(text);
  assert.deepEqual(missing, [], 'every entry gets F5.3\'s icon');
  // The icons are real glyphs, each a different one.
  const icons = links.map((l) => [...l.querySelector('i.ti').classList].find((c) => c !== 'ti'));
  assert.equal(new Set(icons).size, icons.length);
  // Marked visually only: no aria-current on a jump.
  links[2].scrollIntoView = () => {};
  dom.app.querySelectorAll('.konto-ph__body > *')[2].scrollIntoView = () => {};
  links[2].click();
  assert.deepEqual(links.map((l) => l.classList.contains('is-on')), links.map((_, i) => i === 2));
  assert.equal(nav.querySelector('[aria-current]'), null);
  // „Abmelden" last, and it is the account menu's own action.
  const logoutBtn = nav.lastElementChild;
  assert.ok(logoutBtn.matches('button.konto-index__logout'));
  assert.equal(text(logoutBtn), dom.run("t('auth.logout')"));
  logoutBtn.click();
  assert.equal(out, 1);
});

test('#1470: a demo\'s Forest Konto gets the index but no „Abmelden"', async (t) => {
  const dom = await konto(t, 'forest', { ...ME, demo: true, email: 'x@demo.invalid' });
  assert.ok(dom.app.querySelector('nav.konto-index .konto-index__link'));
  assert.equal(dom.app.querySelector('.konto-index__logout'), null);
});

/* -------------------------------- stylesheet --------------------------------- */

const { rulesOf } = require('./support/css');

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'forest.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1470')) return '/*#1470*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
const AFTER = SHEET.slice(SHEET.indexOf('/*#1470*/') + '/*#1470*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const FLAT = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
const GATE = ':root[data-design="forest"]:not([data-scheme="dark"])';

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

test('#1470: every rule of the section is gated on the light scheme and spells no colour', () => {
  assert.ok(SHEET.includes('/*#1470*/'), 'the section header moved — re-read this test');
  assert.ok(FLAT.length > 60, `the scan found implausibly few rules (${FLAT.length})`);
  for (const [selector] of FLAT) {
    for (const part of topLevelParts(selector)) assert.ok(part.startsWith(GATE), `${part} is not gated`);
  }
  const literal = FLAT.filter(([, body]) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(body)).map(([sel]) => sel);
  assert.deepEqual(literal, []);
});

test('#1470: no other design\'s poster colour is declared anywhere in forest.css', () => {
  const sheet = SHEET.toLowerCase();
  const own = DESIGN_REGISTRY.find((d) => d.id === 'forest');
  const mine = [own.page, own.accent, ...own.poster.ground, own.poster.ink, own.poster.sub].filter(Boolean).map((c) => c.toLowerCase());
  const foreign = [];
  const others = DESIGN_REGISTRY.filter((d) => d.id !== 'forest' && d.poster);
  assert.ok(others.length >= 3, 'fewer than three other posters — this test checks nothing');
  for (const d of others) {
    for (const hex of [d.page, d.accent, ...d.poster.ground, d.poster.ink, d.poster.sub].filter(Boolean)) {
      const c = hex.toLowerCase();
      if (!mine.includes(c) && sheet.includes(c)) foreign.push(`${d.id} ${c}`);
    }
  }
  assert.deepEqual(foreign, [], 'a poster colour belongs to its design\'s registry row, not to forest.css');
  const art = FLAT.find(([sel, body]) => /\.design-tile--leaf$/.test(sel) && /linear-gradient/.test(body));
  assert.ok(art && /var\(--poster-top/.test(art[1]) && /var\(--poster-foot/.test(art[1]), 'the leaf poster does not read its inline colours');
});

test('#1470: text links on the sign-in pages are sized at target-min', () => {
  const sized = (needle) => FLAT.some(([sel, body]) => sel.includes(needle) && /min-height:\s*var\(--target-min\)/.test(body));
  assert.ok(sized('.link-btn'), 'the text links are not at target-min');
});

/* U13: the wordmark fits its tile in every locale. Measured in Chromium at
   1440/1024/390/320 in all nine; what is pinned here is the mechanism — the name
   keeps its word (break-word, never `anywhere` or min-width: 0), and on a phone
   the two-across row WRAPS with a card never narrower than its word, so a long
   name takes the row rather than leaving its frame. */
test('#1470 U13: the name keeps its word, and the phone row wraps around a long one', () => {
  const names = FLAT.filter(([sel]) => sel.endsWith('.design-card--leaf .design-card__name'));
  assert.ok(names.length >= 2);
  for (const [, body] of names) {
    assert.doesNotMatch(body, /min-width:\s*0|overflow-wrap:\s*anywhere|hyphens:\s*auto/);
  }
  assert.ok(names.some(([, body]) => /overflow-wrap:\s*break-word/.test(body)));
  const row = FLAT.find(([sel, body]) => sel.endsWith('.design-picker') && /flex-wrap:\s*wrap/.test(body));
  assert.ok(row, 'the phone picker is not a wrapping row');
  const card = FLAT.find(([sel, body]) => sel.endsWith(') .design-card--leaf') && /min-width:\s*min-content/.test(body));
  assert.ok(card, 'a phone card may shrink below its longest word');
});
