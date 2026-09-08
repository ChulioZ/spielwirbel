'use strict';

/* The owner picker's avatar chips (#971/#976) take the member's palette tone
 * from memberColor(), like every other avatar in the app. The 2026-09-08 audit
 * found them painted `m.color || '#888'`: a member's colour is position-derived
 * unless one was picked on the member page, so the stored field is usually
 * absent and every chip came out flat grey — white initials at 3.5:1 on a
 * screen where the rail shows the same people in colour. Named for what it
 * covers; `owner-picker.test.js` holds the pure halves. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadApp } = require('./support/dom');

const round = { id: 'r1', members: [
  { id: 'm1', name: 'Anna' },                    // no stored colour — the common case
  { id: 'm2', name: 'Ben', color: '#1d9e75' },   // picked on the member page
] };

test('a member without a stored colour gets the palette tone, never a flat grey', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.context.__round = round;
  dom.run('document.body.appendChild(renderOwnerChips(__round, new Set()))');
  const chips = [...dom.document.querySelectorAll('.chip .chip__avatar')];
  assert.equal(chips.length, 2);
  const expected = dom.run("[memberColor(__round, 'm1'), memberColor(__round, 'm2')]");
  // jsdom normalises a parsed hex to rgb(), so read the attribute the code wrote.
  assert.equal(chips[0].getAttribute('style'), `background:${expected[0]}`, 'position-derived tone for the colour-less member');
  assert.equal(chips[1].getAttribute('style'), `background:${expected[1]}`, 'the stored palette colour for the other');
  for (const c of chips) assert.ok(!c.getAttribute('style').includes('#888'), 'no hardcoded grey');
});
