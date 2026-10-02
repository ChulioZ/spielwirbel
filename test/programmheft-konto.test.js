'use strict';

/* Das Programmheft's sign-in, Konto and design chooser (#1376, P5.1-P5.5).
 *
 * Operator ruling „A design owns its layout": the views branch on
 * designIs('programmheft') and nothing else. The price of that licence is proof
 * that the branch is Programmheft's alone, so the first test is a golden
 * snapshot of every screen this slice touches under Klassisch — login,
 * register, forgot-password, the Konto (a real account and a demo) and the
 * one-time chooser. It was generated from the views BEFORE #1376 touched them.
 * Regenerate only for a change that deliberately alters Klassisch:
 *   SPIELWIRBEL_UPDATE_GOLDEN=1 node --test test/programmheft-konto.test.js
 *
 * The rest pins what regresses silently:
 *   - the posters: every offered design, Klassisch first and unbadged, each
 *     painted INLINE from its own registry row — no other design's colour in
 *     programmheft.css (the issue's acceptance line);
 *   - the chooser: one radio per design, one commit button named after the
 *     pick, „Später entscheiden" once per presentation, DOM order = visual;
 *   - the Konto: every section still present, in its order, and the index
 *     beside it pointing at each one;
 *   - the stylesheet section: gated on the light scheme, tokens only, text
 *     links at target-min, the wordmark sized by its tile (review R2-1).
 *
 * The layout itself (and the wordmark fit, in every shipped locale) is CSS jsdom
 * cannot apply; it was measured in Chromium at 390 and 1440.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp, flush } = require('./support/dom');
const { DESIGN_REGISTRY } = require('../public/js/designs');

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

test('Klassisch: sign-in, register, forgot, Konto and the chooser render exactly as before #1376', async (t) => {
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

test('the snapshot can see Programmheft: the same screens under it are NOT the golden', async (t) => {
  // The control that proves the comparison above discriminates at all.
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const ph = await renderAll(t, 'programmheft');
  assert.notEqual(ph.konto, golden.konto, 'Programmheft\'s Konto is identical to Klassisch\'s');
  assert.notEqual(ph.kontoDemo, golden.kontoDemo, 'Programmheft\'s demo Konto is identical to Klassisch\'s');
  assert.notEqual(ph.chooser, golden.chooser, 'Programmheft\'s chooser is identical to Klassisch\'s');
  // The sign-in pages are the app's own markup, restyled (the passkey stays
  // under the submit, the fields keep their order) — so under Programmheft
  // they ARE the golden, and must stay so.
  for (const k of ['showLogin', 'showRegister', 'showForgot']) assert.equal(ph[k], golden[k], `${k} markup moved`);
});

/* --------------------------------- posters ----------------------------------- */

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const PH = { ...ME, design: 'programmheft' };

test('#1376: under Programmheft every design is a print poster — Klassisch first, unbadged (#1445), painted from its own row', (t) => {
  const dom = boot(t, 'programmheft', { loggedIn: true, me: PH });
  const wrap = dom.call('buildDesignSection', { ...PH });
  const cards = [...wrap.querySelectorAll('.design-card')];
  assert.deepEqual(cards.map((c) => c.querySelector('input').value), DESIGN_REGISTRY.map((d) => d.id));
  assert.equal(wrap.querySelector('.design-card__badge'), null, 'Klassisch carries no badge (#1445)');
  for (const card of cards) {
    const design = DESIGN_REGISTRY.find((d) => d.id === card.querySelector('input').value);
    assert.ok(card.classList.contains('design-card--print'), `${design.id} is not a print card`);
    const art = card.querySelector('.design-tile--print');
    assert.equal(art.getAttribute('aria-hidden'), 'true');
    assert.equal(art.textContent.trim(), '', 'P5 prints no word on the colour field');
    assert.equal(art.style.getPropertyValue('--poster-top'), design.poster.ground[0]);
    assert.equal(art.style.getPropertyValue('--poster-foot'), design.poster.ground[1]);
    assert.equal(art.style.getPropertyValue('--poster-ink'), design.poster.ink);
    assert.equal(art.style.getPropertyValue('--poster-sub'), design.poster.sub);
    // DOM order = visual order: the poster, then its band.
    assert.equal(art.nextElementSibling, card.querySelector('.design-card__body'));
    assert.equal(text(card.querySelector('.design-card__name')),
      dom.run(`t(${JSON.stringify(design.labelKey)})`));
    assert.equal(text(card.querySelector('.design-card__line')), dom.run(`t(${JSON.stringify(design.shortKey || design.descKey)})`));
    const active = card.querySelector('.design-card__active');
    assert.ok(active && active.getAttribute('aria-hidden') === 'true');
    assert.equal(text(active), 'Aktiv');
  }
  assert.deepEqual(cards.filter((c) => c.classList.contains('is-on')).map((c) => c.querySelector('input').value), ['programmheft']);
  // The hint sits on the title's baseline: both inside the head.
  const head = wrap.querySelector('.konto-design__head');
  assert.ok(head && head.querySelector('.konto-section__h') && head.querySelector('.muted'));
});

test('#1376: Klassisch\'s design cards never get the print parts', (t) => {
  const dom = boot(t, 'klassisch', { loggedIn: true, me: ME });
  const wrap = dom.call('buildDesignSection', { ...ME });
  assert.equal(wrap.querySelector('.design-card--print, .design-tile--print, .design-card__active, .design-card__line, .konto-design__head'), null);
  assert.equal(wrap.querySelectorAll('.design-card__desc').length, DESIGN_REGISTRY.length);
});

/* --------------------------------- chooser ----------------------------------- */

test('#1376: the chooser selects with a poster and answers with ONE named commit', async (t) => {
  const dom = boot(t, 'programmheft', { loggedIn: true, me: PH });
  const sent = [];
  dom.set('accountApi', async (method, url, body) => { sent.push([method, url, body]); return { ...PH, ...body }; });
  dom.call('showDesignChooser', ALL, { ...PH }, null);
  const sheet = dom.document.querySelector('.design-chooser--print');
  assert.ok(sheet, 'no Programmheft chooser');
  assert.equal(sheet.querySelectorAll('.design-card--print').length, DESIGN_REGISTRY.length);
  // DOM order = visual order at 1440: promise, „Später", commit; the phone's
  // „Später" comes after the commit (P5.5) and is the stylesheet's to show.
  const foot = [...sheet.querySelector('.design-chooser__commit').children].map((el) => el.id || el.className.split(' ').pop());
  assert.deepEqual(foot, ['design-chooser__foot', 'designChooserSkip', 'designChooserGo', 'designChooserSkipRow']);
  const go = sheet.querySelector('#designChooserGo');
  assert.equal(text(go), 'Das Programmheft übernehmen');
  const radio = sheet.querySelector('input[value="ocean"]');
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event('change'));
  assert.equal(text(go), 'Ocean übernehmen');
  assert.equal(dom.document.documentElement.dataset.design, 'programmheft', 'a pick is not a preview');
  go.click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [['POST', '/design-chooser-seen', { design: 'ocean' }]]);
});

test('#1376: the phone\'s „Später entscheiden" declines like the wide one', async (t) => {
  const dom = boot(t, 'programmheft', { loggedIn: true, me: PH });
  const sent = [];
  dom.set('accountApi', async (method, url, body) => { sent.push([method, url, body]); return { ...PH }; });
  dom.call('showDesignChooser', ALL, { ...PH }, null);
  dom.document.querySelector('#designChooserSkipRow').click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [['POST', '/design-chooser-seen', {}]]);
  assert.equal(dom.document.querySelector('.design-chooser'), null);
});

/* ---------------------------------- Konto ------------------------------------ */

async function konto(t, design, me) {
  const dom = boot(t, design, { loggedIn: true, me: { ...me, design } });
  await dom.call('showAccount');
  await flush();
  return dom;
}

test('#1376: the Konto keeps every section, in order, beside an index that jumps to each', async (t) => {
  const klassisch = await konto(t, 'klassisch', ME);
  const want = [...klassisch.app.querySelectorAll('h2.konto-section__h')].map(text);
  assert.ok(want.length >= 10, 'the Klassisch Konto rendered implausibly few sections');

  const dom = await konto(t, 'programmheft', ME);
  const layout = dom.app.querySelector(':scope > .konto-ph');
  assert.ok(layout, 'no Programmheft composition');
  const [nav, body] = layout.children;
  assert.ok(nav.matches('nav.konto-index') && body.matches('.konto-ph__body'), 'the index must come first, then the sections');
  assert.equal(nav.getAttribute('aria-label'), 'Inhalt');
  assert.deepEqual([...body.querySelectorAll('h2.konto-section__h')].map(text), want);
  const links = [...nav.querySelectorAll('button.konto-index__link')];
  assert.deepEqual(links.map(text), want);
  // Nothing of the screen is left outside the two columns but its heading.
  assert.deepEqual([...dom.app.children].map((el) => el.className), ['lobby-head', 'konto-ph']);

  let scrolled = null;
  const sections = [...body.children];
  sections[3].scrollIntoView = () => { scrolled = sections[3]; };
  links[3].click();
  assert.equal(scrolled, sections[3], 'the entry did not jump to its section');
  assert.equal(dom.document.activeElement, sections[3].querySelector('h2'), 'focus did not follow the jump');
});

test('#1376: a demo\'s Konto gets an index of its own, shorter sections', async (t) => {
  const dom = await konto(t, 'programmheft', { ...ME, demo: true });
  const links = [...dom.app.querySelectorAll('.konto-index__link')].map(text);
  assert.deepEqual(links, [...dom.app.querySelectorAll('.konto-ph__body h2.konto-section__h')].map(text));
  assert.equal(links[links.length - 1], dom.run("t('konto.demo.title')"));
});

/* -------------------------------- stylesheet --------------------------------- */

const { rulesOf } = require('./support/css');

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'programmheft.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => {
    if (c.includes('===== #1376')) return '/*#1376*/';
    return c.startsWith('/* ===== #') ? '/*§*/' : '';
  });
// The section runs to the NEXT section header: a sibling slice appending after
// it is not #1376's.
const AFTER = SHEET.slice(SHEET.indexOf('/*#1376*/') + '/*#1376*/'.length);
const SECTION = AFTER.includes('/*§*/') ? AFTER.slice(0, AFTER.indexOf('/*§*/')) : AFTER;
const FLAT = rulesOf(SECTION.replace(/@media[^{]+\{/g, ''));
const GATE = ':root[data-design="programmheft"]:not([data-scheme="dark"])';

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

test('#1376: every rule of the section is gated on the light scheme and spells no colour', () => {
  assert.ok(SHEET.includes('/*#1376*/'), 'the section header moved — re-read this test');
  assert.ok(FLAT.length > 60, `the scan found implausibly few rules (${FLAT.length})`);
  for (const [selector] of FLAT) {
    for (const part of topLevelParts(selector)) assert.ok(part.startsWith(GATE), `${part} is not gated`);
  }
  const literal = FLAT.filter(([, body]) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(body)).map(([sel]) => sel);
  assert.deepEqual(literal, []);
});

test('#1376: no other design\'s poster colour is declared anywhere in programmheft.css', () => {
  const sheet = SHEET.toLowerCase();
  const own = DESIGN_REGISTRY.find((d) => d.id === 'programmheft');
  const mine = [own.page, own.accent, ...own.poster.ground, own.poster.ink, own.poster.sub].map((c) => c.toLowerCase());
  const foreign = [];
  const others = DESIGN_REGISTRY.filter((d) => d.id !== 'programmheft' && d.poster);
  assert.ok(others.length >= 3, 'fewer than three other posters — this test checks nothing');
  for (const d of others) {
    for (const hex of [d.page, d.accent, ...d.poster.ground, d.poster.ink, d.poster.sub].filter(Boolean)) {
      const c = hex.toLowerCase();
      if (!mine.includes(c) && sheet.includes(c)) foreign.push(`${d.id} ${c}`);
    }
  }
  assert.deepEqual(foreign, [], 'a poster colour belongs to its design\'s registry row, not to programmheft.css');
  // …and the posters do read them, from the inline properties.
  const art = FLAT.find(([sel, body]) => /\.design-tile--print$/.test(sel) && /linear-gradient/.test(body));
  assert.ok(art && /var\(--poster-top/.test(art[1]) && /var\(--poster-foot/.test(art[1]));
});

test('#1376: text links on the sign-in pages are sized at target-min', () => {
  const sized = (needle) => FLAT.some(([sel, body]) =>
    sel.includes(needle) && /display:\s*inline-flex/.test(body) && /min-height:\s*var\(--target-min\)/.test(body));
  assert.ok(sized('.auth .link-btn'), 'the cross-links are not at target-min');
  assert.ok(sized('.auth__terms a'), 'the legal line\'s links are not at target-min');
});

/* Review R2-1: the longest name any locale prints must fit its poster. The fit
   itself was measured in Chromium in every shipped locale at 1440/1024/700/390 (no
   line box past the frame, no mid-word split); what is pinned here is the
   mechanism — a column floor wide enough for the name, and a name that may not
   shrink below its longest word (break-word, never `anywhere`, which lowers
   min-content and lets „Aktiv" squeeze „PROGRAMMHEF-T"). */
test('#1376 R2-1: the poster floors hold the longest name, and the name keeps its word', () => {
  const floor = (scope) => {
    const rule = FLAT.find(([sel, body]) => sel.endsWith(`${scope} .design-picker`) && /minmax\(/.test(body));
    assert.ok(rule, `no poster grid for ${scope}`);
    return Number(rule[1].match(/minmax\((\d+)px/)[1]);
  };
  // 197px of Anton at 26px (Konto), 182px at 24px (chooser) — nl
  // „PROGRAMMABOEKJE" — plus the band's 12px either side.
  assert.ok(floor('.konto-design') >= 197 + 24, 'the Konto floor is narrower than its longest name');
  assert.ok(floor('.design-chooser--print') >= 182 + 24, 'the chooser floor is narrower than its longest name');
  const name = FLAT.find(([sel, body]) => sel.endsWith('.design-card--print .design-card__name') && /font-size/.test(body));
  assert.match(name[1], /overflow-wrap:\s*break-word/);
  assert.doesNotMatch(name[1], /min-width:\s*0/);
  const head = FLAT.find(([sel]) => sel.endsWith(' .design-card__head'));
  assert.match(head[1], /flex-wrap:\s*wrap/, '„Aktiv" must wrap under the name, not squeeze it');
});
