'use strict';

/* The voting lobby at the rail width (#1719): the screen's width exemption
   from the 900px reading measure, and Klassisch's roster reflow inside it.
   Der Tisch's and Ocean's rows are pinned by their own design specs through
   test/support/live-roster.js. Split from test/content-width.test.js, which
   owns the reading measure itself and the other six exemptions. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rulesOf, bodyOf, mediaBlocks, rootPx, gridSpec, columnsIn, declaredValue, outranks } =
  require('./support/css');

/* The voting lobby (#1719) — the seventh screen out of the reading measure, on
   the setup forms' argument: `showSessionLobby` renders no rail, no dock and no
   back row, so there is nothing in the column for a width change to move. ONE
   selector for that reason, and the spec checks the absence rather than
   assuming it, like the Freundeskreis's above. */
const WIDE = mediaBlocks().filter(([q]) => /min-width:\s*1280px/.test(q)).map(([, css]) => css).join('\n');
const LOBBY_EXEMPTION = '.app > *:not(.rail):not(.dock).live-vote:has(> .live-vote__people)';

test('the voting lobby opts out of the reading measure at the rail width, and only the lobby', () => {
  const body = bodyOf(LOBBY_EXEMPTION, rulesOf(WIDE));
  assert.ok(body, 'nothing in the ≥1280px block lifts .live-vote out of the 900px reading measure');
  assert.equal(declaredValue(body, 'max-width'), 'var(--w-detail)');
  assert.ok(outranks(LOBBY_EXEMPTION, '.app > *:not(.rail):not(.dock)'),
    'the exemption does not out-rank the reading-measure cap, so it would win or lose on source order');
  // Conditioned on the roster: the shared vote-link page renders a root
  // `.live-vote` too, a claim screen that keeps the reading measure.
  const link = fs.readFileSync(path.join(__dirname, '..', 'public/js/views-vote-link.js'), 'utf8');
  assert.match(link, /class="live-vote"/, 'the vote-link page no longer renders a root .live-vote — revisit the condition');
  assert.doesNotMatch(link, /live-vote__people/,
    'the vote-link page grew a roster, so the lobby exemption now widens it as well');

  /* Navigation: no back row anywhere, and the sub-screen tab strip only for the
     three designs that compose this screen themselves — each of which sets the
     lobby's width in its own sheet, at a weight this rule does not reach. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views-session-live.js'), 'utf8');
  let view = src.slice(src.indexOf('function showSessionLobby'));
  view = view.slice(0, view.indexOf('\n}\n'));
  assert.doesNotMatch(view, /backRow\(|renderHubTabs\(/,
    'the lobby grew a back row or hub tabs — a sibling the one-selector exemption does not move with it');
  const navs = view.match(/^.*renderSubScreenTabs\(.*$/gm) || [];
  assert.deepEqual(navs.map((l) => l.trim()), ["if (bruecke || ph || forest) renderSubScreenTabs(round, 'session');"],
    'the lobby renders its tab strip under another design — re-derive the exemption for it');
  for (const [file, cls] of [['bruecke', 'live-vote--bruecke'], ['programmheft', 'live-vote--ph'], ['forest', 'live-vote--forest']]) {
    const sheet = fs.readFileSync(path.join(__dirname, '..', `public/css/designs/${file}.css`), 'utf8');
    const own = rulesOf(sheet).find(([sel, b]) => sel.includes(`.app > *:not(.rail):not(.dock).${cls}`) && /max-width:/.test(b));
    assert.ok(own, `${file} no longer sets its own lobby width, so it now inherits the shared exemption`);
    assert.ok(outranks(own[0].trim(), LOBBY_EXEMPTION), `${file}'s own lobby width no longer out-ranks the shared one`);
  }
});

test('Klassisch\'s lobby roster runs in rows of two at the detail width, on a floor no lower than the name\'s', () => {
  const K = ':root[data-design="klassisch"]';
  const wide = gridSpec(bodyOf(`${K} .live-vote > .live-vote__people`, rulesOf(WIDE)));
  assert.ok(wide && wide.floor, 'Klassisch keeps its one-column roster at the rail width');
  const base = gridSpec(bodyOf('.live-vote__people'));
  assert.ok(wide.floor >= base.floor,
    `the wide roster's ${wide.floor}px floor is under the ${base.floor}px a voter's name is sized against`);
  assert.ok(outranks(`${K} .live-vote > .live-vote__people`, `${K} .live-vote__people`),
    'the wide roster ties the one-column rule and is decided by source order');
  assert.equal(declaredValue(bodyOf(`${K} .live-vote__people > .live-vote__count`, rulesOf(WIDE)), 'grid-column'), '1 / -1');

  // The roster's width at 1440: the lobby at --w-detail, minus Klassisch's own
  // panel track and column gap from its 860px split.
  const split = bodyOf(`${K} .live-vote:has(.live-vote__panel-head)`);
  const panel = Number(split.match(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+(\d+)px/)[1]);
  const gap = Number(split.match(/column-gap:\s*(\d+)px/)[1]);
  const roster = rootPx('--w-detail') - panel - gap;
  assert.ok(columnsIn(roster, { floor: wide.floor, gap: base.gap }) >= 2,
    `a ${roster}px roster holds one ${wide.floor}px column — the reflow never happens`);
});
