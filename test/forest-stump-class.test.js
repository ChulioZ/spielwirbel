'use strict';

/* One class per element (#1572). `.forest-stump` named two things: the hub's
 * stump around „Session wirbeln" (#1466, forest-hub.js) and Neue Session's pot
 * (#1468, views-session-forest.js). The pot's `display: flex; flex-direction:
 * column` outranked the hub's `display: grid; place-items: center`, so the
 * heart sat 31px above the stump's centre at every width — and the hub's
 * 260px bark disc leaked the other way, drawing a second rim round the pot.
 * The pot is `.forest-pot` now.
 *
 * Asked of the stylesheet's text through the cascade model in support/css.js
 * (subject compound only, so every rule that COULD reach the element counts),
 * rather than of one selector string: a third screen reusing either class
 * would be caught the same way.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf, matchesEl, declaredValue } = require('./support/css');

const RULES = rulesOf(fs.readFileSync(path.join(__dirname, '..', 'public/css/designs/forest.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ''));
const HUB_STUMP = { tag: 'div', classes: ['forest-stump'], attrs: {} };
const POT = { tag: 'section', classes: ['forest-pot'], attrs: { 'aria-labelledby': 'potHeading' } };
// Every value any rule (media blocks included) sets for `prop` on `el`. The
// whole-class prefilter keeps matchesEl() off selectors it was never asked
// about (it throws on shapes it cannot model, e.g. a font-face descriptor).
const values = (el, prop) => RULES
  .filter(([sel]) => el.classes.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(sel)))
  .filter(([sel, body]) => declaredValue(body, prop) && matchesEl(sel, el))
  .map(([, body]) => declaredValue(body, prop));

test('the hub stump is laid out by its own rule only: a grid that centres the heart', () => {
  assert.ok(RULES.length > 500, 'the stylesheet was read');
  assert.deepEqual(values(HUB_STUMP, 'display'), ['grid'], 'exactly one rule sets display on the stump');
  assert.deepEqual(values(HUB_STUMP, 'place-items'), ['center']);
  for (const prop of ['flex-direction', 'align-items', 'gap', 'margin']) {
    assert.deepEqual(values(HUB_STUMP, prop), [], `no rule sets ${prop} on the hub stump`);
  }
});

test('Neue Session\'s pot keeps its column and none of the hub stump\'s disc', () => {
  assert.deepEqual(values(POT, 'display'), ['flex']);
  assert.deepEqual(values(POT, 'flex-direction'), ['column']);
  // The pot draws its stump on .setup-panel; the hub's disc on the section
  // itself would be a second bark rim round it.
  for (const prop of ['width', 'height', 'border', 'border-radius', 'background']) {
    assert.deepEqual(values(POT, prop), [], `no rule sets ${prop} on the pot section`);
  }
});
