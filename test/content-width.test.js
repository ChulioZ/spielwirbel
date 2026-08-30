'use strict';

/* The content column's width, and the grid density inside it (#332).

   #332 set out to fix both ends of the viewport range: a 1920 screen wasted 48%
   of itself on gutter while the Regal stayed at four columns, and the same 220px
   grid floor gave every PHONE a single column (a 22-game shelf measured ~6300px
   of scroll). The phone half shipped and is pinned below.

   The desktop half was reverted, and the invariant that replaced it is the most
   important assertion in this file: **the column has exactly ONE width.**
   `.app` is centred, so varying its width moves both edges — and the hub tab
   strip lives inside it, so a second width made the strip slide 220px sideways
   every time you switched tabs. Width may vary again only once navigation moves
   out of the content column (the desktop rail). Until then a second width is a
   regression, not an improvement, and it must fail loudly rather than ship
   twice.

   The criteria are pinned as ARITHMETIC over the declared numbers — how many
   columns a grid actually gets at a given viewport — rather than as "a rule
   mentioning grid exists". A floor nudged 150px -> 180px keeps every naive
   assertion green while silently returning the phone to one column; the column
   count is what notices. (Verified by making that edit and watching it go red.)

   Parsing traps (stripped comments, whole-class matching) live in
   test/support/css.js — see `.claude/rules/css-text-assertions-strip-comments.md`. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { RULES, rulesOf, bodyOf, mediaBlocks, whole, rootPx, gridSpec, columnsIn } =
  require('./support/css');

// The horizontal padding of a `padding: <v> <h> <v>` shorthand.
const sidePadding = (body) => {
  const m = body && body.match(/padding:\s*\d+px\s+(\d+)px/);
  return m ? Number(m[1]) : null;
};

/* Every rule under a query matching `re`, newest first. The stylesheet scopes
   each narrow-screen override next to the component it belongs to, so there are
   several `max-width: 520px` blocks and the two numbers this file needs (`.app`
   padding, the `.cards` floor) live in different ones. Reversed so a lookup
   returns the last-declared rule, i.e. the one the cascade actually applies. */
const rulesUnder = (re) => mediaBlocks()
  .filter(([query]) => re.test(query))
  .flatMap(([, css]) => rulesOf(css))
  .reverse();

test('the page and its footer take their width from the same variable', () => {
  // A hardcoded px in either drifts from the other the moment the width is
  // re-tuned, and the footer silently stops lining up with the column above it
  // — the same reasoning as the shared --dock-clearance (#324). Since #326 the
  // footer itself is a full-bleed tinted band, so the column-width constraint
  // lives on its centred inner wrapper (.site-footer__inner); that is the
  // element that must share --w-content with .app.
  assert.ok(rootPx('--w-content'), ':root does not declare --w-content');
  for (const sel of ['.app', '.site-footer__inner']) {
    const body = bodyOf(sel);
    assert.ok(body, `${sel} rule not found`);
    assert.match(body, /max-width:\s*var\(--w-content\)/,
      `${sel} does not take its max-width from --w-content`);
  }
});

test("the column's width depends on the VIEWPORT, never on what a screen renders", () => {
  /* The #332 regression, pinned so it cannot ship twice.

     `.app` is centred, so changing its width moves both its edges — and before
     the rail, navigation was inside it. #332 selected the width by content
     (`.app:has(.cards, …)`), so the tab strip sat at x=480 on Start and x=260
     on Regal, sliding back and forth as the user moved along the tab row.

     A width keyed to the viewport cannot do that: every screen at a given
     viewport gets the same column, so nothing moves as you navigate. A width
     keyed to CONTENT can, and always will. That is the distinction this
     asserts — not "one width", which the rail breakpoint legitimately broke.

     Note the rail's own `.app:has(.rail)` rule is fine and deliberately not
     caught here: it sets `display`/`grid-template-columns`, i.e. it PLACES an
     element. Only rules that choose the column's WIDTH are constrained. */
  const columnRules = RULES.filter(([sel, body]) => {
    if (!/max-width:/.test(body)) return false;
    // A rule targets the column itself when its final compound is the column —
    // `.app > *:not(.rail)` caps CHILDREN and is a different thing entirely.
    return sel.split(',').some((part) => {
      const last = part.trim().split(/[\s>+~]+/).pop() || '';
      return whole('.app').test(last) || whole('.site-footer').test(last);
    });
  });
  assert.ok(columnRules.length, 'no rule sets the content column width at all');

  const contentKeyed = columnRules
    .map(([sel]) => sel)
    .filter((sel) => sel.split(',').some((part) => {
      const last = part.trim().split(/[\s>+~]+/).pop() || '';
      if (!whole('.app').test(last) && !whole('.site-footer').test(last)) return false;
      /* Strip the two column classes and the combinators joining them from the
         WHOLE part; a viewport-keyed rule is built from nothing else. Anything
         left over — `:has(…)`, a state class, an attribute selector — keys off
         content.

         Checking the whole part rather than its last compound is load-bearing:
         `.app:has(.cards) + .site-footer` carries its condition on the FIRST
         compound, and that is the exact shape #332 shipped for the footer. An
         earlier version of this assertion inspected only the last compound and
         let it through. */
      return part
        .replace(/\.app(?![\w-])/g, '')
        .replace(/\.site-footer(?![\w-])/g, '')
        .replace(/[\s>+~]/g, '') !== '';
    }));
  assert.deepEqual(contentKeyed, [],
    'these rules pick the column width from what the screen renders, which moves the navigation');
});

/* The rail hides four things the content column used to carry (the Start tab's
   hero, its CTA, its Tags/Provider/Design links, the Regal's archive footer) and
   the dock itself. Every one of those hides is a plain `display: none` competing
   with a component rule declared ~400 lines further down the stylesheet, so each
   one can lose on specificity or on source order — silently, rendering BOTH the
   rail entry and the thing it replaced. All three shapes below actually happened
   while building this; they cost a browser round trip each and no test noticed. */
test('the rail out-ranks every component it hides', () => {
  // `a.btn` is (0,1,1), so a bare `.rail-owned` (0,1,0) loses to it — and three
  // of the hidden elements are exactly `a.btn`. The qualified form is (0,2,0).
  const railOwned = RULES.filter(([sel]) => whole('.rail-owned').test(sel));
  assert.ok(railOwned.length, 'nothing hides the rail-owned elements');
  railOwned.forEach(([sel, body]) => {
    assert.match(body, /display:\s*none/, `"${sel}" does not hide anything`);
    const classes = (sel.match(/\.[\w-]+/g) || []).length;
    assert.ok(classes >= 2,
      `"${sel}" is one class (0,1,0) and loses to \`a.btn\` (0,1,1), which three of the elements it must hide are`);
  });
});

test('the dock is hidden AFTER it is shown', () => {
  /* `.dock { display: none }` ties `.dock { display: flex }` on specificity, so
     source order decides. Declared in the Layout section — where it reads like
     it belongs, next to the rest of the rail — it lost, and both navs rendered
     at once. RULES is in document order, so the index comparison is the check. */
  const shows = RULES.findIndex(([sel, body]) =>
    /^\.dock$/.test(sel.trim()) && /display:\s*flex/.test(body));
  const hides = RULES.findIndex(([sel, body]) =>
    /^\.dock$/.test(sel.trim()) && /display:\s*none/.test(body));
  assert.ok(shows >= 0, 'no base .dock rule sets display: flex');
  assert.ok(hides >= 0, 'nothing hides the dock at the rail breakpoint');
  assert.ok(hides > shows,
    'the dock is hidden before it is shown, so the later rule wins and BOTH navs render');
});

test('the rail is hidden by default, not only below the breakpoint', () => {
  /* The rail must be `display: none` in the base cascade and switched ON inside
     the min-width block — not the reverse. A rail that defaults to visible and
     is hidden by a max-width query renders on every phone the moment someone
     adds a narrower breakpoint above it. */
  const base = bodyOf('.rail');
  assert.ok(base, 'no base .rail rule');
  assert.match(base, /display:\s*none/,
    '.rail does not default to hidden, so it can leak onto narrow screens');
});

test('a 390 viewport gets two Regal columns, not one', () => {
  const narrow = rulesUnder(/max-width:\s*520px/);
  assert.ok(narrow.length, 'no max-width: 520px block found');

  // Both numbers come from the narrow blocks: they re-pad `.app` as well.
  const pad = sidePadding(bodyOf('.app', narrow));
  assert.ok(pad, '.app is not re-padded for narrow screens');
  const spec = gridSpec(bodyOf('.cards', narrow));
  assert.ok(spec && spec.floor && spec.gap,
    '.cards has no narrow-screen override, so the 220px floor still forces one column');

  const columns = columnsIn(390 - 2 * pad, spec);
  assert.equal(columns, 2,
    `a 390px phone gets ${columns} Regal column(s); the 22-game shelf needs two to halve its scroll`);
});

test('nothing hides the results footer wholesale — that is "Session löschen"', () => {
  /* This block used to guard a `.app .back-row { display: none }` in the
     >= 1280px media query, and specifically that it was scoped to `.back-row`
     rather than to the wrapper. #623 deleted that hide outright — the rail is
     "up" and the control is "back", so hiding it left eight sub-screens with no
     in-app way back on a desktop. The inverse assertion (nothing hides the
     control at ANY width) lives in test/back-control.test.js, next to the
     screens it protects.

     What survives here is the other half, which was always the sharper one and
     is now independent of the back control: a hide written against the wrapper
     carrying "Session löschen" would silently take a destructive action off one
     screen — no error, nothing in the DOM to suggest a control is missing.

     THE WRAPPER MOVED IN #614. It used to be `.section.center`, which the
     results screen shared byte-for-byte with the back row — and that shared,
     generic spelling was the whole reason the trap existed. The cancel control
     joined the delete in a dedicated `.section.result-footer` row, and
     `class="section center"` now appears nowhere in `public/js` at all, so the
     old assertion had stopped watching anything: its anti-vacuous floor checks
     that the CSS still DECLARES `.section`/`.center` (it does, for other rules),
     never that a screen still uses them. Hence the floor below counts the
     wrapper's real uses in the view instead. */
  const view = fs.readFileSync(path.join(__dirname, '..', 'public/js/views-session.js'), 'utf8');
  assert.match(view, /class="section result-footer"/,
    'the results screen no longer renders a .result-footer — this guard now watches nothing');

  const hides = RULES.filter(([, body]) => /display:\s*none/.test(body));
  const tooBroad = hides
    .map(([sel]) => sel)
    .filter((sel) => /\.result-footer(?![\w-])/.test(sel));
  assert.deepEqual(tooBroad, [],
    'these rules hide the whole results footer, which takes "Session löschen" with it');
});

test('short-entry lists tile, and their rows may wrap inside a tile', () => {
  /* The tags and provider screens moved from full-width rows to tiles: as rows
     each carried ~200px of ink across a 900px line, putting a tag's count and
     actions — and a provider's checkbox — some 700px from the label.

     The wrap is the load-bearing half. `.ds-row` is a nowrap flex line sized
     for a 900px width, so inside a ~280px tile the tag rows pushed their
     edit/delete buttons straight out through the right edge, where they were
     CLIPPED AND UNCLICKABLE — visible only as a slightly odd screenshot, with
     every test green. */
  const tiles = bodyOf('.ds-list--tiles');
  assert.ok(tiles, '.ds-list--tiles rule not found');
  assert.match(tiles, /display:\s*grid/, 'the tile list is not a grid');
  const spec = gridSpec(tiles);
  assert.ok(spec.floor && spec.gap, '.ds-list--tiles declares no minmax floor / gap');

  const row = bodyOf('.ds-list--tiles .ds-row');
  assert.ok(row, 'no rule lets a row wrap inside its tile');
  assert.match(row, /flex-wrap:\s*wrap/,
    'rows cannot wrap inside a tile, so a row wider than the tile clips its own controls');

  // `auto-fill` is what makes this need no breakpoint: it must still collapse
  // to a single column on the narrowest phone this app supports.
  assert.match(tiles, /auto-fill/, 'a fixed column count would not collapse on a phone');
  assert.ok(spec.floor <= 320,
    `a ${spec.floor}px floor is wider than a 320px phone's content box, so the grid would overflow`);
});

/* The two setup forms (session setup, new round) lay themselves out in two
   columns from 860px up. Three things about that opt-out fail silently. */
test('a setup form and its page head opt out of the reading measure TOGETHER', () => {
  /* The #543 lesson, one screen over. `.page-head` is a SIBLING of `.setup-grid`,
     not its wrapper, so neither of the grid exemptions above reaches it — exempt
     only the grid and the screen's own <h1> stays capped at --w-read and centred
     while the form beside it spans --w-setup, leaving the heading indented from
     the content it heads. Both must take the SAME variable, or they drift the
     moment one of the two numbers is re-tuned (the shared --dock-clearance
     reasoning, applied to a width). */
  const exemptions = RULES.filter(([sel, body]) =>
    whole('.setup-grid').test(sel) && /max-width:/.test(body));
  assert.ok(exemptions.length,
    'nothing exempts .setup-grid from the reading measure, so a two-column form is NARROWER at 1280 than at 1279');

  exemptions.forEach(([sel, body]) => {
    assert.ok(whole('.page-head').test(sel),
      `"${sel}" widens the setup grid without widening the page head, which leaves the screen's own heading indented from its content`);
    // Conditioned on a setup grid being present: unconditionally, every OTHER
    // screen's page head would lose its reading measure too.
    assert.match(sel, /:has\(\.setup-grid\)/,
      `"${sel}" is not conditioned on a setup grid being present, so it widens every screen's page head`);
    // One variable for both, and it must be a variable — a literal px here
    // drifts from whatever the grid gets.
    const vars = [...body.matchAll(/max-width:\s*var\((--[\w-]+)\)/g)].map((m) => m[1]);
    assert.equal(vars.length, 1,
      `"${sel}" does not take its width from a single custom property`);
    // The cap it competes with is (0,3,0); winning on source order alone breaks
    // silently when someone moves a block.
    const classes = (sel.match(/\.[\w-]+/g) || []).length;
    assert.ok(classes > 3,
      `"${sel}" has ${classes} class components and does not out-rank the (0,3,0) reading-measure cap`);
  });
});

test('the setup width is WIDER than the reading measure it replaces', () => {
  // Pinned as arithmetic, not as "a --w-setup exists": set it to 880 and every
  // selector assertion above stays green while the exemption silently makes the
  // screen narrower than the cap it exists to escape.
  const setup = rootPx('--w-setup');
  const read = rootPx('--w-read');
  assert.ok(setup, ':root does not declare --w-setup');
  assert.ok(setup > read,
    `--w-setup (${setup}px) is not wider than --w-read (${read}px), so the exemption buys nothing`);
  assert.ok(setup <= rootPx('--w-shell'), '--w-setup exceeds the shell it sits in');
});

test('a setup form is two columns from its breakpoint, with room for a tile row', () => {
  /* The grid must actually become two columns, and the preview panel inside the
     narrower of them must still fit more than one tile — a floor nudged up
     leaves a one-tile column, which looks like the panel is broken rather than
     like a number changed. */
  const hit = mediaBlocks()
    .map(([query, css]) => ({ query, body: bodyOf('.setup-grid', rulesOf(css)) }))
    .find((b) => b.body && /grid-template-columns/.test(b.body));
  assert.ok(hit, '.setup-grid never becomes a multi-column grid');

  const from = Number(hit.query.match(/min-width:\s*(\d+)px/)[1]);
  const tracks = hit.body.match(/grid-template-columns:([^;]+);/)[1];
  assert.equal((tracks.match(/minmax\(/g) || []).length, 2,
    `.setup-grid declares "${tracks.trim()}" rather than two tracks`);
  // minmax(0, …): a bare `1fr` track has an auto (min-content) minimum, so a
  // long game title would push its column wider than half the grid.
  assert.ok(!/minmax\(\s*(?!0)/.test(tracks),
    'a track without a 0 minimum lets its content blow the grid out');

  const gap = Number(hit.body.match(/column-gap:\s*(\d+)px/)[1]);
  const column = (from - 2 * sidePadding(bodyOf('.app')) - gap) / 2;
  // rulesUnder() flattens every block matching the query, so the panel is found
  // whether or not it shares a block with the grid today.
  const panel = bodyOf('.setup-panel', rulesUnder(/min-width:\s*860px/));
  assert.ok(panel, 'the pool panel is never shown at the breakpoint the grid uses');
  const panelPad = Number(panel.match(/padding:\s*\d+px\s+(\d+)px/)[1]);
  const tiles = columnsIn(column - 2 * panelPad, gridSpec(bodyOf('.setup-panel__body')));
  assert.ok(tiles >= 2,
    `at its own ${from}px breakpoint the pool panel fits ${tiles} tile(s) per row`);
});

test('the pool panel and the compact strip are never both on', () => {
  /* Two presentations of one thing, picked by width (the rail/dock shape). The
     panel must default to HIDDEN and be switched on inside the query — a panel
     that defaults to visible renders on every phone the moment someone adds a
     narrower breakpoint above it, on top of the strip it replaces. */
  const base = bodyOf('.setup-panel');
  assert.ok(base, 'no base .setup-panel rule');
  assert.match(base, /display:\s*none/,
    '.setup-panel does not default to hidden, so it can leak onto narrow screens beside the strip it replaces');

  const strip = RULES.filter(([sel, body]) =>
    whole('.pool-hint').test(sel) && /display:\s*none/.test(body));
  assert.ok(strip.length,
    'nothing hides the compact pool strip where the panel takes over, so both render at once');
  strip.forEach(([sel]) => {
    // `.pool-hint { display: flex }` is (0,1,0) and is declared further down the
    // sheet, so a one-class hide wins only by position.
    const classes = (sel.match(/\.[\w-]+/g) || []).length;
    assert.ok(classes >= 2,
      `"${sel}" is one class (0,1,0) and ties \`.pool-hint { display: flex }\`, which is declared later`);
  });
});

test('the home lobby tiles once there is room for a second round card', () => {
  /* The lobby is a stack of full-width rows on a phone and a grid above the
     strip breakpoint. A floor set too high leaves it a one-column grid — which
     looks like the change landed while changing nothing at all. */
  const hit = mediaBlocks()
    .map(([query, css]) => ({ query, body: bodyOf('.lobby-list', rulesOf(css)) }))
    .find((b) => b.body && /grid-template-columns/.test(b.body));
  assert.ok(hit, '.lobby-list never becomes a multi-column grid');

  const from = Number(hit.query.match(/min-width:\s*(\d+)px/)[1]);
  const spec = gridSpec(hit.body);
  const base = gridSpec(bodyOf('.lobby-list'));
  // Capped by the column, not by the viewport, once past --w-content.
  const shell = Math.min(from, rootPx('--w-content'));
  const columns = columnsIn(shell - 2 * sidePadding(bodyOf('.app')), {
    floor: spec.floor,
    gap: spec.gap || base.gap,
  });
  assert.ok(columns >= 2,
    `at its own ${from}px breakpoint the lobby still shows ${columns} column(s)`);
});

test('a voter chip keeps room for a real name beside its status badge', () => {
  /* `.live-person__state` is `flex: none`, so the status badge keeps the full
     width of "✓ abgestimmt" whatever happens, and `.live-person__name` — the
     only shrinkable child — absorbs every pixel the track gives up. The failure
     is therefore silent and it gets WORSE the moment someone votes: at the old
     200px floor the name box measured 45px inside a 218px chip, rendering
     "Julian" as "Juli…" (and clipping an 11-character name even before anyone
     had voted).

     Pinned as arithmetic over the declared numbers, like the Regal and lobby
     assertions above: what matters is the width the NAME is left with, which a
     floor nudged back down would quietly halve while every "a grid exists"
     assertion stayed green. */
  const spec = gridSpec(bodyOf('.live-vote__people'));
  assert.ok(spec && spec.floor && spec.gap, '.live-vote__people is no longer an auto-fill grid');

  // What the chip spends before the name gets anything: its own side padding,
  // the avatar, the two flex gaps, and the un-shrinkable status badge.
  const chip = bodyOf('.live-person');
  const pad = Number(chip.match(/padding:\s*\d+px\s+(\d+)px/)[1]);
  const gap = Number(chip.match(/gap:\s*(\d+)px/)[1]);
  const avatar = Number(bodyOf('.live-person__avatar').match(/width:\s*(\d+)px/)[1]);
  /* Measured from the rendered chip: the icon + `lobby.voted` at --text-sm.
     GERMAN is the worst case of the five shipped locales ("abgestimmt", vs
     "ha votado"/"ha votato"/"voted"/"a voté"), so this is the real ceiling
     today — but it is a measurement, not a derivation. A new locale whose
     word is longer than the German one silently makes the floor too small
     again, so re-measure this when one is added. */
  const BADGE = 95;

  const nameWidth = spec.floor - 2 * pad - avatar - 2 * gap - BADGE;
  assert.ok(nameWidth >= 100,
    `a voter chip leaves its name ${nameWidth}px, which truncates an ordinary member name`);
});
