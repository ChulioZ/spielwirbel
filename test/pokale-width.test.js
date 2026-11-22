'use strict';

/* Pokale's one content width (#1856), split out of test/content-width.test.js
   (which holds the column's own width and the other screens' exemptions) to
   keep that file under its line budget. Same parsing helpers. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf, mediaBlocks, whole } = require('./support/css');

/* Pokale has ONE content width (#1856): the standings page, the challenge row
   and the Abzeichen rows. The last two used to stop at the reading measure
   beside a standings block that ran on to the pane's edge — two right edges on
   one screen. All three are direct `.app` children, so each must be named in
   the exemption itself; `:has()` on the page alone would leave the two
   sections below it capped. Checked in the 1280px block, where the cap lives. */
test('every Pokale section takes the same width from the rail breakpoint on (#1856)', () => {
  const wide = mediaBlocks().filter(([q]) => /min-width:\s*1280px/.test(q));
  assert.ok(wide.length, 'no min-width: 1280px block found');
  const exempt = wide.flatMap(([, css]) => rulesOf(css))
    .filter(([, body]) => /max-width:\s*none/.test(body))
    .flatMap(([sel]) => sel.split(/,(?![^(]*\))/).map((s) => s.trim()));
  for (const cls of ['.pokale-page', '.challenge-section', '.badge-section']) {
    const hit = exempt.find((s) => whole(cls).test(s));
    assert.ok(hit, `${cls} is capped at the reading measure while the standings beside it are not`);
    assert.match(hit, /^\.app\s*>\s*\*:not\(\.rail\):not\(\.dock\):is\(/,
      `${cls} must be exempt as a direct .app child, out-ranking the (0,3,0) cap`);
  }
  // The page section actually carries the class the exemption names.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views-pokale.js'), 'utf8');
  assert.match(src, /class="section pokale-page/, 'renderPokaleTab no longer marks its section as the Pokale page');
});
