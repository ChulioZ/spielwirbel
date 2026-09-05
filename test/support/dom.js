'use strict';

/* A jsdom + `vm` harness for the frontend's shared-global-scope scripts (#602).
 *
 * It exists so a view can be tested by RENDERING it and driving it, instead of
 * by matching its own source text. A regex over `views-friends.js` survives any
 * refactor that keeps the string while breaking the feature, and it cannot see
 * the things that actually go wrong in a view — a listener wired to the wrong
 * element, an aria-label that lands on the icon instead of the control, a
 * null-guard that renders an empty node rather than nothing.
 *
 * ## The constraint that dictates the whole design: NEVER `require()` a view
 *
 * `npm run coverage:ci` gates on 90% lines across every file that got loaded,
 * and a DOM view file is almost entirely unreachable from Node — so
 * `require('../public/js/views-friends.js')` would enter the coverage report at
 * ~10% and drag the global figure under the floor. That is a red `coverage`
 * check with EVERY TEST GREEN and nothing in the output naming the cause
 * (`.claude/rules/frontend-helper-modules-and-coverage.md`; measured at −11
 * points from a single export on #281).
 *
 * `vm.runInContext` executes a frontend file without entering the report at
 * all, which is why the harness loads scripts that way and why no amount of
 * "it would read better as a require" may change it. If a `views-*.js` or
 * `core.js` ever appears in the `coverage:ci` file table, this harness is being
 * used wrong.
 *
 * ## Reaching what a script declared
 *
 * A top-level `const`/`let` lands in the context's global LEXICAL scope, not on
 * the global object — so `ctx.h` is `undefined` while `h` is perfectly callable
 * from code evaluated in the same context (`.claude/rules/in-app-nav-links.md`
 * §1 makes the same point about `window.*` in the browser). Hence `run()` /
 * `call()` rather than plucking properties off the context.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { SUPPORTED_LOCALES } = require('../../public/js/locales');

const ROOT = path.join(__dirname, '..', '..');
const JS_DIR = path.join(ROOT, 'public', 'js');
const read = (rel) => fs.readFileSync(path.join(JS_DIR, rel), 'utf8');

/* main.js bootstraps the app (routing + a /api/config probe) and pwa.js
   registers the service worker. Both are side effects a spec wants to opt into,
   never to inherit, so the harness stops just short of them. */
const BOOTSTRAP = ['main.js', 'pwa.js'];

/* The script list is PARSED from index.html rather than restated here: that
   file is the authoritative load order (CLAUDE.md), so a new frontend file is
   picked up automatically and cannot drift out of sync with a copy. */
function shellScripts() {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="\/js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(srcs.length > 10, 'no <script src="/js/…"> tags found in index.html — did the markup change?');
  return srcs.filter((s) => !BOOTSTRAP.includes(s));
}

const SCRIPTS = shellScripts();
const SOURCES = SCRIPTS.map((name) => ({ name, code: read(name) }));
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/* The i18n layer on its own, with no DOM: the three specs that predate this
   harness (i18n-locales, session-share, players-plural) each carried a private
   copy of exactly this, and a fourth copy is how they start to drift.
   `document` is the two-line stub i18n.js actually touches — a whole jsdom
   window here would be ~14ms of nothing for a spec that only wants `t()`. */
function loadI18n(locale) {
  const context = {
    I18N: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: {} },
    navigator: { language: 'en' },
    Intl,
  };
  vm.createContext(context);
  /* The lang tables are DERIVED from the shipped locale set, never listed here:
     a hand-copied ['en', 'de'] left this harness one locale behind the app the
     moment a third shipped, and the failure is a spec comparing a Spanish DOM
     against an English t() — which reads as a broken view rather than as a
     stale test fixture (.claude/rules/locale-set-is-data.md §1). */
  const files = ['locales.js', 'i18n.js', ...SUPPORTED_LOCALES.map((l) => `lang/${l}.js`)];
  for (const file of files) {
    vm.runInContext(read(file), context, { filename: file });
  }
  if (locale) context.setLocale(locale);
  return context;
}

/* A translate function bound to one locale, exactly as a view passes `t` in. */
function translator(locale) {
  const ctx = loadI18n(locale);
  const t = (key, params) => ctx.t(key, params);
  // The plural half of the same surface, bound to the same locale. A view holds
  // both as globals; a spec passing this one function around would otherwise
  // have to thread a second one beside it through every call (#838).
  t.tn = (n, keyOne, keyOther, params) => ctx.tn(n, keyOne, keyOther, params);
  // The number half of the same surface (#850). A view injects `fmtAvg` into
  // session-share.js exactly like `t`/`tn`, and it is bound to the SAME locale
  // here — a spec that formatted with the default locale while translating in
  // German would assert a mixed-language line that the app can never produce.
  t.fmtAvg = (n) => ctx.fmtAvg(n);
  return t;
}

/**
 * Boot the whole frontend shell in a jsdom window.
 *
 * The document is the REAL public/index.html, so `#app`, `#homeBtn`, the toast
 * and every other element the scripts reach for at load time exist — core.js
 * wires `#homeBtn` in a top-level statement, and a hand-built skeleton would
 * quietly diverge from the markup it is standing in for.
 *
 * Stub the cross-file globals a view calls but does not own (`api`,
 * `accountApi`, `toast`, …) with `set()` on the returned handle, after loading.
 *
 * @param {object} [opts]
 * @param {string} [opts.locale='de']  locale to activate before the spec runs
 */
function loadApp(opts = {}) {
  const dom = new JSDOM(INDEX_HTML, {
    url: 'https://spielwirbel.app/',
    // The <script src> tags must NOT execute themselves: we run the files
    // through `vm` so they stay out of the coverage report (see the header).
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const ctx = dom.getInternalVMContext();

  /* A view that reaches the network in a test is a bug in the test, so the
     default fetch REJECTS loudly instead of hanging on an unresolved promise —
     an un-stubbed call then names itself in the failure. */
  ctx.fetch = () => Promise.reject(new Error('dom.js: unstubbed fetch — pass an `api`/`accountApi` stub'));

  /* jsdom has no layout and no scrolling: its window.scrollTo() only prints a
     "Not implemented" line and does nothing. Since syncUrl resets scroll on
     every forward navigation (#623) that is a line per pushed view — so replace
     it with a recorder, which silences the noise AND is the only observable a
     spec has for the reset (`.claude/rules/scroll-reset-on-forward-navigation.md`). */
  const scrolls = [];
  dom.window.scrollTo = (...args) => { scrolls.push(args); };

  for (const { name, code } of SOURCES) {
    vm.runInContext(code, ctx, { filename: `public/js/${name}` });
  }

  const run = (code) => vm.runInContext(code, ctx);

  /* Call a top-level function by name with real arguments. The args are stashed
     on the context and spread, which is what lets a spec pass an object through
     to a view without serialising it. */
  const call = (name, ...args) => {
    ctx.__harnessArgs = args;
    try {
      return run(`${name}(...__harnessArgs)`);
    } finally {
      delete ctx.__harnessArgs;
    }
  };

  /* Define/replace a global — the stubbing seam.
     This reaches a `function`-declared name (which IS a property of the global
     object) and nothing else: a top-level `const`/`let` lives in the global
     lexical scope, where an outside assignment is invisible to the scripts.
     That split is convenient rather than limiting — every cross-file global a
     view wants stubbed (`api`, `accountApi`, `toast`, `showHome`,
     `accountsActive`, `isLoggedIn`) is a function declaration, while the `const`
     ones (`h`, `esc`, `profilePath`) are pure helpers a spec wants for real.
     Stub something lexical and it silently keeps the real implementation, so
     `set` refuses names it cannot actually replace. */
  const set = (name, value) => {
    assert.notEqual(
      run(`typeof ${name} === 'undefined' || Object.hasOwn(globalThis, ${JSON.stringify(name)})`),
      false,
      `dom.js: '${name}' is a top-level const/let — it cannot be stubbed from outside the context`,
    );
    ctx[name] = value;
  };

  run(`setLocale(${JSON.stringify(opts.locale || 'de')})`);

  return {
    window: dom.window,
    document: dom.window.document,
    context: ctx,
    run,
    call,
    set,
    /** Read a top-level binding, including a `const` the context object hides. */
    get: (name) => run(name),
    /** The `#app` container every view renders into. */
    get app() { return dom.window.document.getElementById('app'); },
    /** Every window.scrollTo() call so far, as its argument list. */
    scrolls,
    close: () => dom.window.close(),
  };
}

/* Let every pending microtask (and the timer turn after them) run.
   Needed since #939: a confirmation is a promise now, so a handler written as
   `if (!await confirmDialog(…)) return;` reaches its api() call one turn after
   the click that started it. A spec that clicks and asserts in the same tick
   sees nothing sent — which reads as the action being wired wrong rather than
   as the spec being one turn early. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

module.exports = { loadApp, loadI18n, translator, flush };
