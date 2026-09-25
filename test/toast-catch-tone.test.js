'use strict';

/* Every toast() that reports a caught failure carries a tone (#1261 review).

   #1261 converted every toast inside a catch to `{ tone: 'error' }` — and within
   a day two PRs merged beside it had added new catch toasts with no tone, so an
   error read as a neutral 2.2-second note again. A convention nobody re-checks is
   one PR from drifting, so this scans for it.

   It parses (espree, the parser ESLint already runs on these files) rather than
   greps: a toast's options can sit several lines below the call, and „inside a
   catch" is a question about the syntax tree, not about the text near the call.
   Two shapes count as a caught failure:
     - a toast anywhere in a `catch (e) { … }` clause's body;
     - a toast inside the handler FUNCTION passed to `.catch(…)` — only there.
       A success toast in a `.then(…)` callback of a chain that ends in
       `.catch(() => {})` is not in the handler, and must not count (the naive
       "any `.catch` call is an ancestor" test flagged views-member.js's
       „Rolle gespeichert" toast for exactly that reason).
   A tone is `{ tone: … }` as the second argument; which tone is the site's call
   (a caught error is usually 'error', but the scan does not second-guess it). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const espree = require('espree');

const ROOT = path.join(__dirname, '..');
const DIRS = ['public/js', 'public/js/pages'];

// file:line → why this caught toast legitimately has no tone. Empty today; an
// entry needs a reason a reviewer can check, never "it was easier".
const ALLOW = new Map();

function sources() {
  return DIRS.flatMap((dir) => fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `${dir}/${f}`));
}

const isToast = (n) => n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'toast';
const hasTone = (call) => {
  const opts = call.arguments[1];
  return !!opts && opts.type === 'ObjectExpression'
    && opts.properties.some((p) => p.key && (p.key.name === 'tone' || p.key.value === 'tone'));
};
const isCatchCall = (n) => n.type === 'CallExpression' && n.callee.type === 'MemberExpression'
  && !n.callee.computed && n.callee.property.name === 'catch';

// Walk with the ancestor chain, so "is this toast inside a catch handler" is
// answered from the tree: a CatchClause ancestor, or a function that is itself
// an ARGUMENT of a `.catch(…)` call.
function caughtToasts(src) {
  const ast = espree.parse(src, { ecmaVersion: 'latest', loc: true });
  const found = [];
  const walk = (node, anc) => {
    if (!node || typeof node.type !== 'string') return;
    if (isToast(node)) {
      const inCatch = anc.some((a, i) => a.type === 'CatchClause'
        || (/Function/.test(a.type) && i > 0 && isCatchCall(anc[i - 1]) && anc[i - 1].arguments.includes(a)));
      if (inCatch) found.push(node);
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach((c) => walk(c, anc.concat(node)));
      else if (v && typeof v.type === 'string') walk(v, anc.concat(node));
    }
  };
  walk(ast, []);
  return found;
}

test('the scan tells a caught toast from a success toast in a chain that ends in .catch', () => {
  // The anti-vacuous half: both shapes it must flag, and the one it must not.
  const src = `
    async function a() { try { await x(); } catch (e) { toast(e.message); } }
    function b() { x().catch((e) => toast(e.message)); }
    function c() { x().then(() => { toast('saved'); }).catch(() => {}); }
    async function d() { try { await x(); } catch (e) { toast(e.message, { tone: 'error' }); } }`;
  const hits = caughtToasts(src);
  assert.equal(hits.length, 3, 'a, b and d are caught toasts; c is not');
  assert.deepEqual(hits.filter((h) => !hasTone(h)).map((h) => h.loc.start.line), [2, 3]);
});

test('every toast reporting a caught failure carries a tone (#1261)', () => {
  const missing = [];
  let checked = 0;
  for (const rel of sources()) {
    for (const call of caughtToasts(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) {
      checked++;
      const at = `${rel}:${call.loc.start.line}`;
      if (!hasTone(call) && !ALLOW.has(at)) missing.push(at);
    }
  }
  // #1261 converted ~90 sites; far fewer means the walk stopped seeing them.
  assert.ok(checked > 60, `only ${checked} caught toasts found — the scan has gone blind`);
  assert.deepEqual(missing, [],
    'a toast in a catch reports a failure — give it { tone: \'error\' } (or add an ALLOW entry with a reason)');
});
