'use strict';

/* Der Tisch's HUB and LOBBY (#1189) — the screen layer over #1188's tokens.
 *
 * Two halves, and they are guarded by two different instruments because they
 * fail differently.
 *
 * The CSS half is text: jsdom applies no external stylesheet, so nothing in
 * this repo can observe the felt band, the arc or the round tables as pixels
 * (.claude/rules/testing-views-under-jsdom.md). What a text assertion CAN hold
 * is the handful of claims that are load-bearing rather than cosmetic — above
 * all that every rule here is gated on the scheme, which is the one mistake
 * that puts a dark design's felt on a light round's page.
 *
 * The DOM half is the seat hints, which are the only JS this issue added: two
 * inline custom properties, on two screens, that the CSS above cannot derive.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadApp } = require('./support/dom');
const { rulesOf } = require('./support/css');

const SHEET = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'css', 'designs', 'tisch.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const HOOK = ':root[data-design="tisch"]';
const GATE = '[data-scheme="dark"]';

/* Every rule in the file, media blocks flattened away — the gate question is
   about the selector, and a @media wrapper does not change it. rulesOf() yields
   [selector, body] pairs, not objects.

   Only the @media OPENERS are removed, never a closing brace: rulesOf's body
   pattern is `[^{}]*`, so each block's orphaned `}` simply matches nothing and
   the rules around it parse unchanged. Stripping a trailing `}` to "balance"
   them is the version that bit — it eats the brace of whatever rule happens to
   be last in the file, which is exactly where a new rule gets appended. */
const RULES = rulesOf(SHEET.replace(/@media[^{]+\{/g, ''));

const designRules = RULES
  .map(([selector, body]) => [selector.split(',').map((x) => x.trim()), body])
  .filter(([sels]) => sels.every((x) => x.startsWith(HOOK)));

const bodiesFor = (needle) => RULES
  .filter(([selector]) => selector.includes(needle))
  .map(([, body]) => body)
  .join('\n');

// The tokens the design declares ONLY inside its scheme-gated block, i.e. the
// ones that simply do not exist when that block does not match.
const gatedOnlyTokens = () => {
  const blockOf = (sel) => {
    const at = SHEET.indexOf(sel + ' {');
    assert.ok(at !== -1, `${sel} block not found — did the hook move?`);
    let depth = 1;
    let i = SHEET.indexOf('{', at) + 1;
    const from = i;
    for (; depth > 0; i += 1) {
      if (SHEET[i] === '{') depth += 1;
      else if (SHEET[i] === '}') depth -= 1;
    }
    return SHEET.slice(from, i - 1);
  };
  const names = (css) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const appCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const inApp = names(appCss);
  const voice = names(blockOf(HOOK));
  const only = [...names(blockOf(HOOK + GATE))].filter((t) => !inApp.has(t) && !voice.has(t));
  assert.ok(only.length > 10, `only ${only.length} design-only tokens — did the parse break?`);
  return only;
};

test('a rule reading a scheme-gated token is itself scheme-gated', () => {
  /* The central architectural claim of this issue, derived rather than listed.
     Until the flip (#1202) a round on a LIGHT palette writes its own page
     inline and CLEARS data-scheme, while <html> still says data-design="tisch"
     — so the gated block does not match and every token in it is undefined. A
     component rule reading one is then invalid, and the sharpest case is the
     overlay: `--surface: var(--paper)` makes --surface invalid at
     computed-value time, so every descendant reading it falls back to `unset`.

     The token half of this has its own rule
     (.claude/rules/design-colour-blocks-are-scheme-gated.md); #1188 applied it
     to the block and shipped five of its own component rules ungated, which is
     what this derivation caught.

     Derived, because an enumeration is the shape that silently stops covering
     the newest member — and the geometry-only rules (finding A7's 24px target)
     stay ungated for free, since they name no token at all. */
  const gated = gatedOnlyTokens();
  const offenders = [];
  let reading = 0;
  for (const [sels, body] of designRules) {
    const used = gated.filter((tok) => body.includes(`var(${tok}`));
    if (!used.length) continue;
    reading += 1;
    const ungated = sels.filter((sel) => !sel.includes(GATE));
    if (ungated.length) offenders.push(`${ungated.join(', ')} -> ${used.join(' ')}`);
  }
  assert.ok(reading >= 10,
    `only ${reading} rules read a design-only token — this check has stopped seeing the sheet`);
  assert.deepEqual(offenders, [],
    'these rules read a token that does not exist in a LIGHT round, where they still match');
});

test('the felt falls back to the design default when a round has no marker', () => {
  /* --marker is on :root inside a round (applyMarker) and inline on each lobby
     tile, and is ABSENT for a round still wearing a world — markerColors()
     returns null there by design. So both felts read it through a var()
     fallback rather than through [data-marked], which would paint those rounds
     nothing at all. Both surfaces, because the issue names both. */
  for (const [what, needle] of [['the hub stage', '.hero'], ['the lobby tile', '.round-card']]) {
    const body = bodiesFor(HOOK + GATE + ' ' + needle);
    assert.match(body, /var\(--marker,\s*var\(--felt\)\)/,
      `${what} does not fall back to the design's own felt for a round with no marker`);
    assert.match(body, /var\(--marker-deep,\s*var\(--felt-deep\)\)/,
      `${what} falls back on the light stop but not on the deep one`);
  }
});

test('the dock is the table edge: 86px, four entries wide, paper ink on felt', () => {
  /* T2.6 states all three, and the ink is review finding A1: gold measures
     4.20:1 on the felt's light stop, so a 12px dock label is --felt-ink
     (5.38:1) and gold is left to the glyph. The height and the flex are what
     turn the floating pill into the bottom of the screen. */
  const dock = bodiesFor(HOOK + GATE + ' .dock');
  assert.match(dock, /height:\s*86px/, 'the dock bar is not 86px');
  assert.match(dock, /border-top:\s*3px solid var\(--gold-edge\)/, 'the dock has no brass rim');
  const item = bodiesFor(HOOK + GATE + ' .dock__item');
  assert.match(item, /flex:\s*1/, 'the dock entries do not share the width');
  assert.match(item, /min-height:\s*58px/, 'the dock entries are not 58px');
  assert.match(item, /color:\s*var\(--felt-ink\)/, 'the dock labels are not the felt ink (finding A1)');
  assert.doesNotMatch(item, /color:\s*var\(--gold\)/, 'a dock label may not be gold — 4.20:1 on felt');
});

test('the brass plate is one treatment, and it is scoped to the hub action', () => {
  /* Scoped to .hub-cta / .rail__cta rather than to .btn--primary on purpose:
     repainting every primary button in the app belongs to the screens that
     hold them (#1190-#1200), not to this issue. */
  /* --gold-deep, NOT --brand: a round on a world writes that world's accent as
     an inline --brand on its own lobby tile, which tinted the plate green.
     The token block records the measurement. */
  const plate = /linear-gradient\(180deg,\s*var\(--brass-hi\),\s*var\(--gold-deep\)\)/;
  assert.equal(
    designRules.filter(([, body]) => /var\(--brass-hi\),\s*var\(--brand\)/.test(body)).length, 0,
    'a plate is built on --brand, which a round can overwrite inline on its own tile'
  );
  for (const sel of ['.hub-cta', '.rail__cta', '.round-card__name', '.dock__item.is-active', '.rail__item.is-active']) {
    assert.match(bodiesFor(HOOK + GATE + ' ' + sel), plate, `${sel} is not struck from the same plate`);
  }
  assert.deepEqual(
    designRules.flatMap(([sels]) => sels).filter((s) => /\.btn--primary(?![\w-])/.test(s)), [],
    'the design sheet repaints .btn--primary — that reaches every screen, not just the hub'
  );
});

/* -------------------------------- the seat hints ------------------------- */

const round = (members) => ({
  id: 1, name: 'Donnerstagsrunde', background: null, marker: 0,
  members: members.map((name, i) => ({ id: i + 1, name })),
  games: [{ id: 1, title: 'Nordlichter' }],
  sessions: [], tags: [],
});

test('the hub seat strip carries an index per seat and a count on the row', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async () => round(['Lea', 'Jonas', 'Mia']));
  await dom.call('showRound', 1, 'start');

  const row = dom.app.querySelector('.hero__members');
  assert.ok(row, 'the hub rendered no seat strip');
  /* Every CHILD, not every avatar: the „+" seat and the retired tail are on the
     row too, and an arc that skipped them would leave a gap where they sit. */
  const seats = [...row.children];
  assert.ok(seats.length >= 4, `only ${seats.length} seats — the „+" seat is missing, so the count is wrong`);
  assert.equal(row.style.getPropertyValue('--seat-n'), String(seats.length),
    'the row does not state how many seats it holds, so a design cannot place any of them');
  assert.deepEqual(
    seats.map((el) => el.style.getPropertyValue('--seat-i')),
    seats.map((_, i) => String(i)),
    'the seats are not indexed 0..n-1 in DOM order'
  );
});

test('the lobby tile indexes its seats, and counts the overflow bubble as one', async (t) => {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const members = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: 'M' + i }));
  dom.set('accountsActive', () => false);
  dom.set('api', async () => [{
    id: 1, name: 'Donnerstagsrunde', members, gameCount: 3, playedCount: 1,
    background: null, marker: 2, openSessions: [], lastPlayed: null,
  }]);
  await dom.call('showHome');

  const stack = dom.app.querySelector('.avatar-stack');
  assert.ok(stack, 'the lobby rendered no avatar stack');
  const seats = [...stack.children];
  /* The bubble is a seat on the rim — it stands for the places that did not
     fit — so it is indexed and counted like the rest. A count that excluded it
     would leave a gap in the ring exactly where the overflow is. */
  assert.ok(stack.querySelector('.avatar-stack__more'), 'this fixture must overflow, or the bubble is untested');
  assert.equal(stack.style.getPropertyValue('--seat-n'), String(seats.length),
    'the stack does not count the overflow bubble as a seat');
  assert.deepEqual(
    seats.map((el) => el.style.getPropertyValue('--seat-i')),
    seats.map((_, i) => String(i)),
    'the lobby seats are not indexed 0..n-1 in DOM order'
  );
});
