'use strict';

/* Der Tisch (#1057): the chosen game's own band, above the Tafel.
 *
 * It replaces the in-row `.row-finish` panel, which sat 1000+px down a 2905px
 * page on the evening it was needed and then stayed there at full size
 * afterwards — a 344px winner picker on a session finished months ago. The band
 * exists in three states and in only three states, and the one that matters most
 * is the FOURTH: with no game chosen it must not exist at all. The deep-dive's
 * empty „Auf dem Tisch" slot was rejected on 2026-09-12 for exactly that.
 *
 * Driven through the jsdom harness because every assertion here is about what
 * the screen builds and in which phase (.claude/rules/testing-views-under-jsdom.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const {
  RULES, bodyOf, mediaBlocks, rulesOf, topLevel, outranks, resolvedDeclaration, declaredValue,
} = require('./support/css');

const ME = 'user-me';

function fixture(over = {}, roundOver = {}) {
  const session = {
    id: 's1',
    createdAt: '2026-08-02T18:00:00.000Z',
    finishedAt: '2026-08-02T22:10:00.000Z',
    gameIds: ['g1', 'g2'],
    memberIds: ['m1', 'm2', 'm3'],
    votes: {
      m1: { g1: { rating: 5 }, g2: { rating: 3 } },
      m2: { g1: { rating: 4 }, g2: { rating: 2 } },
      m3: { g1: { rating: 4 }, g2: { rating: 2 } },
    },
    votedIds: ['m1', 'm2', 'm3'],
    done: true,
    cancelled: false,
    finished: false,
    winnerIds: [],
    chosenGameId: 'g1',
    events: [],
    ...over,
  };
  const round = {
    id: 'r1',
    name: 'Freitagsrunde',
    background: null,
    tags: [],
    members: [
      { id: 'm1', name: 'Anna', userId: ME },
      { id: 'm2', name: 'Ben' },
      { id: 'm3', name: 'Clara' },
    ],
    games: [
      { id: 'g1', title: 'Catan', tagIds: [], minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', tagIds: [], minPlayers: 1, maxPlayers: 8 },
    ],
    sessions: [session],
    ...roundOver,
  };
  round.sessions = [session];
  return { round, session };
}

async function show(t, over = {}, roundOver = {}) {
  const { round, session } = fixture(over, roundOver);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sent = [];
  dom.set('api', async (method, path, body) => {
    if (method === 'POST' && /\/finish$/.test(path)) {
      sent.push({ path, body: JSON.parse(JSON.stringify(body)) });
      const winnerIds = body.winnerIds || [];
      const saved = { ...session, finished: body.finished !== false, winnerIds,
        finishedAt: body.finished === false ? null : '2026-08-02T22:10:00.000Z' };
      if (body.ending && !winnerIds.length) saved.ending = body.ending; else delete saved.ending;
      return saved;
    }
    if (method === 'POST' && /\/choice$/.test(path)) { sent.push({ path, body: { ...body } }); return {}; }
    return round;
  });
  dom.set('isLoggedIn', () => true);
  dom.set('currentUserId', () => ME);
  await dom.call('showResults', round, session);
  return { dom, sent };
}

const band = (dom) => dom.app.querySelector('.tisch');
const btn = (dom, rx) => [...dom.app.querySelectorAll('.tisch button, .tisch-bar button')]
  .find((b) => rx.test(b.textContent));

// ------------------------------------------------------------ the three states

test('with no game chosen the band does not exist — nothing may take that room', async (t) => {
  const { dom } = await show(t, { chosenGameId: null });
  assert.ok(band(dom).hidden, 'an empty „Auf dem Tisch" slot is exactly what was rejected');
  assert.equal(band(dom).textContent.trim(), '', 'and it holds nothing either');
  assert.ok(dom.app.querySelector('.tisch-bar').hidden, 'nor does the phone CTA');
});

test('am Tisch: the box, the title, who brings it, and one action', async (t) => {
  const { dom } = await show(t, {}, {
    games: [
      { id: 'g1', title: 'Catan', tagIds: [], ownerIds: ['m1'], minPlayers: 1, maxPlayers: 8 },
      { id: 'g2', title: 'Azul', tagIds: [], minPlayers: 1, maxPlayers: 8 },
    ],
  });
  const el = band(dom);
  assert.equal(el.hidden, false);
  assert.equal(el.dataset.state, 'table');
  assert.ok(el.querySelector('.tisch__box'), 'the box');
  assert.equal(el.querySelector('.tisch__title').textContent.trim(), 'Catan');
  assert.match(el.querySelector('.tisch__note').textContent, /Gehört Anna/);
  assert.ok(btn(dom, /Als gespielt markieren/), 'the one action the evening needs');
  assert.equal(el.querySelector('.stamp'), null, 'nothing is stamped before it is played');
  assert.equal(el.querySelector('.winner-chips'), null, 'and no winner is asked for yet (#254)');
});

test('„Anderes Spiel wählen" clears the choice, the band and the row chip together', async (t) => {
  const { dom, sent } = await show(t);
  assert.ok(dom.app.querySelector('.trow.is-chosen .trow__chip'), 'the chosen row states it');
  btn(dom, /Anderes Spiel wählen/).click();
  await flush();
  assert.deepEqual(sent.map((s) => ({ ...s.body })), [{ gameId: null }]);
  assert.ok(band(dom).hidden, 'the band goes with the choice');
  assert.equal(dom.app.querySelector('.trow.is-chosen'), null, 'and so does the row chip');
  assert.equal(dom.app.querySelectorAll('.play-btn').length, 2, 'every row offers „Spielen" again');
});

test('finishing stamps the box and opens the picker, because who won is the one question left', async (t) => {
  const { dom, sent } = await show(t);
  btn(dom, /Als gespielt markieren/).click();
  await flush();

  assert.deepEqual(sent.map((s) => s.body), [{ finished: true, winnerIds: [] }]);
  assert.equal(band(dom).dataset.state, 'picking');
  const stamp = band(dom).querySelector('.stamp.stamp--table');
  assert.ok(stamp, 'the box is stamped');
  assert.match(stamp.textContent, /Gespielt/);
  assert.doesNotMatch(stamp.textContent, /Invalid/, 'and carries a real date');
  assert.equal(dom.app.querySelectorAll('.winner-chips').length, 2,
    'the picker opens: parties and endings');
  assert.ok(dom.app.querySelector('.tisch-bar').hidden, 'the phone CTA is spent');
});

/* #1327: the picker stays OPEN across party taps, because more than one person
   often won — a shared win among three used to cost three „Ändern" presses.
   Only „Fertig" (or an ending, which is single-choice) closes it. The picker is
   one shared renderer for every design, so this runs against it with no design
   worn and needs no per-design twin. */
test('several winners are recorded in a row, and „Fertig" shows them as seats', async (t) => {
  const { dom, sent } = await show(t, { finished: true });
  // An archived session opens on the PICTURE, not on the picker.
  assert.equal(dom.app.querySelectorAll('.winner-chips').length, 0,
    'a session finished months ago must not open on a 344px picker');
  btn(dom, /Ändern/).click();
  assert.equal(dom.app.querySelectorAll('.winner-chips').length, 2, '„Ändern" reopens it');

  const chip = (rx) => [...dom.app.querySelectorAll('.winner-chip')].find((c) => rx.test(c.textContent));
  chip(/Anna/).click();
  await flush();
  assert.equal(dom.app.querySelectorAll('.winner-chips').length, 2, 'a party tap keeps the picker open');
  chip(/Ben/).click();
  await flush();
  assert.deepEqual(sent.map((s) => s.body.winnerIds), [['m1'], ['m1', 'm2']],
    'each tap saves the whole list, without „Ändern" in between');
  assert.equal(chip(/Anna/).getAttribute('aria-pressed'), 'true');
  assert.equal(chip(/Ben/).getAttribute('aria-pressed'), 'true');
  assert.equal(band(dom).dataset.state, 'picking');

  btn(dom, /Fertig/).click();
  assert.equal(dom.app.querySelectorAll('.winner-chips').length, 0, '„Fertig" closes it');
  const seats = [...band(dom).querySelectorAll('.tisch__seats .seat')];
  assert.deepEqual(seats.map((s) => s.querySelector('.seat__name').textContent.trim()), ['Anna', 'Ben']);
  assert.match(band(dom).querySelector('.tisch__won').textContent, /haben gewonnen/);
});

test('deselecting a winner also keeps the picker open', async (t) => {
  const { dom, sent } = await show(t, { finished: true, winnerIds: ['m1', 'm2'] });
  btn(dom, /Ändern/).click();
  [...dom.app.querySelectorAll('.winner-chip')].find((c) => /Anna/.test(c.textContent)).click();
  await flush();
  assert.deepEqual(sent.map((s) => s.body.winnerIds), [['m2']]);
  assert.equal(band(dom).dataset.state, 'picking', 'a correction is not the end of the question');
});

/* The re-render detaches the tapped button, so without a hand-back keyboard and
   screen-reader focus falls to <body> — now that the picker stays open, that
   would mean a full Tab back into it for every further winner. */
test('focus returns to the re-rendered chip of the party just tapped', async (t) => {
  const { dom } = await show(t, { finished: true });
  btn(dom, /Ändern/).click();
  const ben = () => [...dom.app.querySelectorAll('.winner-chip')].find((c) => /Ben/.test(c.textContent));
  const before = ben();
  before.focus();
  before.click();
  await flush();
  assert.notEqual(ben(), before, 'the chip really was rebuilt');
  assert.equal(dom.window.document.activeElement, ben(), 'focus is on the new Ben chip');
  assert.equal(ben().getAttribute('aria-pressed'), 'true');
});

test('closing the picker moves no focus', async (t) => {
  const { dom } = await show(t, { finished: true });
  btn(dom, /Ändern/).click();
  const ending = dom.app.querySelectorAll('.winner-chips')[1].querySelector('.winner-chip');
  ending.focus();
  ending.click();
  await flush();
  assert.equal(dom.app.querySelectorAll('.winner-chips').length, 0, 'an ending closes it');
  assert.equal(dom.window.document.activeElement, dom.window.document.body,
    'the hand-back is for an OPEN picker only — closing must not pull focus anywhere');
});

test('a team win renders one seat per member', async (t) => {
  const { dom } = await show(t, {
    finished: true,
    winnerIds: ['m1', 'm2'],
    teams: [{ id: 't1', name: 'Die Zwei', memberIds: ['m1', 'm2'] }],
  });
  const seats = [...band(dom).querySelectorAll('.tisch__seats .seat')];
  assert.deepEqual(seats.map((s) => s.querySelector('.seat__name').textContent.trim()), ['Anna', 'Ben'],
    'a team win is its people — that is what `winnerIds` already stores');
  assert.match(band(dom).querySelector('.tisch__won').textContent, /haben gewonnen/,
    'and the plural follows the seat count');
});

test('an ending renders its own line instead of seats', async (t) => {
  const { dom } = await show(t, { finished: true, ending: 'noWinner' });
  assert.equal(band(dom).querySelector('.tisch__seats'), null, 'nobody won, so there is nobody to seat');
  assert.match(band(dom).querySelector('.tisch__outcome').textContent, /ohne Sieger/);
});

test('„Zurücksetzen" returns the band to the am-Tisch state', async (t) => {
  const { dom, sent } = await show(t, { finished: true, winnerIds: ['m1'] });
  btn(dom, /Zurücksetzen/).click();
  await flush();
  assert.deepEqual(sent.map((s) => s.body), [{ finished: false, winnerIds: [] }]);
  assert.equal(band(dom).dataset.state, 'table');
  assert.equal(band(dom).querySelector('.stamp'), null, 'the stamp is lifted with it');
  assert.ok(btn(dom, /Als gespielt markieren/), 'and the evening can be played again');
  assert.equal(dom.app.querySelector('.tisch-bar').hidden, false, 'the phone CTA is back');
});

test('the in-row finish panel and the chosen-game banner are gone', async (t) => {
  const { dom } = await show(t, { finished: true, winnerIds: ['m1'] });
  assert.equal(dom.app.querySelector('.row-finish'), null);
  assert.equal(dom.app.querySelector('.chosen-banner'), null);
  assert.equal(dom.app.querySelector('.winner-result'), null,
    'the trophy line is the seats now');
  // The chosen row stays in the ranking with its chip: the ranking is the VOTE's
  // record and must stay complete — place 3 must not become place 2.
  assert.equal(dom.app.querySelectorAll('.trow').length, 2);
});

/* `data-state` is the band's only hook into the sheet, and until #1139 nothing
   consumed it at all — so it had never been asserted against the branch it is
   supposed to name. It must track the RENDER, not the data: `finished` is
   already true while the picker is open (the finish is recorded first, the
   question comes after), so a two-value attribute said „done" over a screen
   showing the question. */
test('the band says „picking" while and only while the picker is open', async (t) => {
  const { dom } = await show(t, { finished: true, winnerIds: ['m1'] });
  assert.equal(band(dom).dataset.state, 'done', 'a recorded evening opens on the picture');

  btn(dom, /Ändern/).click();
  assert.equal(band(dom).dataset.state, 'picking', '„Ändern" is the picker, so the band narrows');

  btn(dom, /Fertig/).click();
  assert.equal(band(dom).dataset.state, 'done', 'and „Fertig" gives the width back');

  btn(dom, /Ändern/).click();
  [...dom.app.querySelectorAll('.winner-chip')].find((c) => /Ben/.test(c.textContent)).click();
  await flush();
  assert.equal(band(dom).dataset.state, 'picking', 'recording a winner keeps it open (#1327)');
  btn(dom, /Fertig/).click();
  assert.equal(band(dom).dataset.state, 'done');

  btn(dom, /Zurücksetzen/).click();
  await flush();
  assert.equal(band(dom).dataset.state, 'table', 'and an unfinished evening is neither');
});

// ------------------------------------------------------------ the CSS contract

test('the phone CTA sticks to the bottom and is hidden from the rail breakpoint up', () => {
  const bar = bodyOf('.tisch-bar');
  assert.ok(bar, '.tisch-bar rule is gone');
  assert.match(bar, /position:\s*sticky/, 'a bar that does not stick is one more card');
  assert.match(bar, /bottom:\s*0/);
  assert.match(bar, /env\(safe-area-inset-bottom/, 'or it sits under the home indicator');

  const hide = mediaBlocks()
    .filter(([q]) => /min-width:\s*1280px/.test(q))
    .flatMap(([, css]) => rulesOf(css))
    .find(([sel, body]) => /\.tisch-bar/.test(sel) && /display:\s*none/.test(body));
  assert.ok(hide, 'the bar is never hidden on desktop, where a fitting column makes it a card');
  // (0,3,0): `.tisch-bar[hidden]` is (0,2,0) — an attribute counts in the same
  // column as a class — so a two-class selector here would TIE it and ride on
  // source order, which is what this sheet's own convention forbids.
  assert.ok(outranks(hide[0], '.tisch-bar[hidden]'),
    `"${hide[0]}" ties the [hidden] rule it competes with and rides on source order`);
});

test('the band is a two-column grid and its box carries a box shadow', () => {
  const el = bodyOf('.tisch');
  assert.match(el, /grid-template-columns:\s*128px/, 'the box leads at a size worth recognising');
  assert.match(bodyOf('.tisch__box'), /box-shadow:\s*var\(--shadow-2\)/,
    'this is the physical thing somebody carries to the table');
  assert.match(bodyOf('.tisch__seats .avatar'), /box-shadow:\s*0 0 0 3px var\(--gold\)/,
    'the winners are ringed in gold');
});

/* The table stamp against the component it re-sizes.
 *
 * `bodyOf('.stamp--table')` above reads the rule's TEXT, and the text was
 * correct the whole time #1057 was broken in production: every property the
 * modifier declares is ALSO declared by `.stamp` itself, at the same (0,1,0)
 * specificity, so the winner was decided by SOURCE ORDER — and `.stamp` sits
 * ~470 lines further down the sheet. `position` therefore resolved to
 * `relative`, the stamp left the corner, stayed in flow at the box's full
 * width and grew to its own content height: measured on the shipped
 * stylesheet, a 159px card over a 128px cover (124% of it), and 224% at 390px
 * where the box is 96px.
 *
 * So these ask which declaration WINS, not which one exists — the distinction
 * `.claude/rules/assert-the-decision-not-its-ingredients.md` is about, and the
 * reason test/support/css.js has resolvedDeclaration() at all. */
const TABLE_STAMP = { tag: 'span', classes: ['stamp', 'stamp--table'] };

test('the table stamp WINS the cascade against the Stempelkarte it re-sizes', () => {
  const pos = resolvedDeclaration(TABLE_STAMP, 'position');
  assert.equal(pos.value, 'absolute',
    `${pos.sel} wins and sets position: ${pos.value} — the stamp is back in flow`);

  const pad = resolvedDeclaration(TABLE_STAMP, 'padding');
  assert.equal(pad.value, '5px 8px 6px', `${pad.sel} wins the padding instead`);

  /* The box carries `font-size: 44px` for the cover PLACEHOLDER GLYPH, and
     font-size inherits — so without a reset here the stamp's two short lines
     were 66px each. This is the half a specificity fix alone does not reach. */
  const fs = resolvedDeclaration(TABLE_STAMP, 'font-size');
  assert.match(fs.value, /var\(--text-sm\)/,
    `${fs.sel} wins the font-size and leaves it at "${fs.value}" — the box's glyph size`);
});

test('the phone stamp drops the DATE, which no 96px box can hold', () => {
  /* „13.09.2026" is one unbreakable token and overran the 84px stamp by 9px;
     every locale that writes the date with spaces wrapped instead, which is the
     same bug in the other direction — pt reached 82px of stamp on a 96px cover.
     Type size does not reach it: pt needs ~8px to fit on one line. */
  // The 96px box is the <= 639px form — NOT the <= 859px block the
  // Stempelkarte's own phone width lives in, which is a different question.
  const phone = mediaBlocks().filter(([q]) => /max-width:\s*639px/.test(q));
  const hide = phone.flatMap(([, css]) => rulesOf(css))
    .find(([sel]) => sel.replace(/\s+/g, ' ') === '.tisch__box .stamp--table .stamp__date');
  assert.ok(hide, 'the phone stamp no longer drops the date — re-measure before removing this');
  assert.equal(declaredValue(hide[1], 'display'), 'none');

  // And it must outrank the rule that gives the date its size, or it changes
  // nothing at all.
  assert.ok(outranks('.tisch__box .stamp--table .stamp__date', '.stamp--table .stamp__date'));
});

test('the stamp on the box is the SAME component as the game page presses', () => {
  // Not a look-alike: `.stamp--table` only re-sizes it, so a change to the
  // Stempelkarte's border, mask or tint reaches this surface for free.
  const table = bodyOf('.tisch__box .stamp--table');
  assert.ok(table, 'the .stamp--table rule is gone (it is compounded with the box — see below)');
  assert.doesNotMatch(table, /border:\s*3px double/, 'the double rule belongs to `.stamp` itself');
  assert.match(bodyOf('.stamp::before'), /border:\s*3px double var\(--sc\)/,
    'and `.stamp` must still be the thing that declares it');
});

/* #1139 — the picker state on a phone.
 *
 * The band kept its two-column table layout while the picker was open, so a
 * 390pt phone left the chips a 222pt gutter. Measured there, on the issue's
 * fixture (three-line title, four members, three endings): the band ran 665px,
 * the question took four lines to ask one thing, and „Fortsetzung folgt"
 * wrapped INSIDE its own pill — a 72px chip beside six 48px ones. After: 507px,
 * one line, and a uniform 44px.
 *
 * Note what is NOT the evidence. The issue's own acceptance criterion — the
 * actions row above `clientHeight` with the band scrolled to the top — was
 * already true on `main` at every realistic phone height, so it discriminates
 * nothing; the 158px and the uniform chip heights are the finding.
 *
 * These ask which declaration WINS, not merely that one exists — the picking
 * rules compete with the `.tisch` / `.tisch__box` rules in the same media
 * block, and this sheet's standing trap is a tie decided by source order. */
const phoneRules = () => mediaBlocks()
  .filter(([q]) => /max-width:\s*639px/.test(q))
  .flatMap(([, css]) => rulesOf(css));

const phoneRule = (sel) => phoneRules()
  .find(([s]) => s.replace(/\s+/g, ' ') === sel);

test('the picking band gives its width to the answer, and outranks the table layout', () => {
  const band = phoneRule('.tisch[data-state="picking"]');
  assert.ok(band, 'the picker still renders at the table width on a phone');
  assert.match(declaredValue(band[1], 'grid-template-columns'), /^64px/,
    'the chips get the room back only if the box column actually shrinks');
  // (0,2,0) vs (0,1,0). A second class instead of the attribute would TIE the
  // `.tisch` rule beside it and ride on source order.
  assert.ok(outranks('.tisch[data-state="picking"]', '.tisch'),
    'ties the phone `.tisch` rule it competes with and rides on source order');

  const box = phoneRule('.tisch[data-state="picking"] .tisch__box');
  assert.ok(box, 'the box keeps its 96px table size while the picker is open');
  assert.equal(declaredValue(box[1], 'width'), '64px');
  assert.ok(outranks('.tisch[data-state="picking"] .tisch__box', '.tisch__box'));
});

test('the box is SHRUNK, never hidden — the stamp on it is the receipt', async (t) => {
  /* The „Gespielt" stamp is appended to the box in the same render that opens
     the picker, and it is the only confirmation on screen that the finish was
     recorded. Hiding the box to buy the width would take the receipt with it. */
  const { dom } = await show(t);
  btn(dom, /Als gespielt markieren/).click();
  await flush();
  const box = band(dom).querySelector('.tisch__box');
  assert.ok(box, 'the box is still built while picking');
  assert.match(box.querySelector('.stamp.stamp--table').textContent, /Gespielt/);

  const rule = phoneRule('.tisch[data-state="picking"] .tisch__box');
  assert.notEqual(declaredValue(rule[1], 'display'), 'none', 'that would take the receipt with it');
});

/* The chip rules TIE the base ones at (0,1,0), so specificity decides nothing
   and the cascade falls to source order. Written beside the band's other phone
   rules — the obvious place, 30 lines up — every one of them LOSES to the base
   rule below it and the block changes nothing at all, while reading exactly
   like a block that works. Measured: with the rules in that position the chips
   stayed at 18px/10px 18px. So this asks which declaration WINS.
   (.claude/rules/assert-the-decision-not-its-ingredients.md) */
test('phone chips are denser HORIZONTALLY, and never below the target-size floor', () => {
  const chip = phoneRule('.winner-chip');
  assert.ok(chip, 'the chip is the same pill at 390pt as at 1440pt');
  // The win is the padding: shorter pills fit more per row, which is what
  // collapses the rows. The height saving is incidental — and floored, because
  // 16px type with 8px of padding computes to ~42px.
  assert.match(declaredValue(chip[1], 'padding'), /^8px 14px$/);
  assert.equal(declaredValue(chip[1], 'min-height'), '44px',
    'a chip under 44px fails the target-size floor this app holds itself to');
  assert.match(declaredValue(chip[1], 'font-size'), /var\(--text-md\)/,
    'a bare px here would also fail test/design-tokens.test.js');
  assert.equal(declaredValue(phoneRule('.winner-chips')[1], 'gap'), '8px');

  // Source order, stated directly: the phone rule must come after the base one.
  const positions = (sel) => RULES
    .map(([s], i) => [s.replace(/\s+/g, ' '), i])
    .filter(([s]) => s === sel)
    .map(([, i]) => i);
  for (const sel of ['.winner-chip', '.winner-chips']) {
    const [base, phone] = positions(sel);
    assert.equal(positions(sel).length, 2, `${sel} is declared ${positions(sel).length} times, not 2`);
    assert.ok(phone > base,
      `the phone ${sel} rule sits BEFORE the base one it ties — the base wins and it does nothing`);
  }
});

test('above 639px the picker is untouched — desktop has the room', () => {
  // topLevel() strips every @media block, so this is the desktop sheet alone —
  // `bodyOf` would have answered with whichever copy comes first in the file.
  const base = rulesOf(topLevel());
  const bodyOfBase = (sel) => (base.find(([s]) => s.trim() === sel) || [])[1];

  assert.match(bodyOfBase('.tisch'), /grid-template-columns:\s*128px/,
    'the band narrowed everywhere, not just where it had to');
  const chip = bodyOfBase('.winner-chip');
  assert.match(chip, /font-size:\s*var\(--text-lg\)/);
  assert.match(chip, /padding:\s*10px 18px/);
  assert.equal(declaredValue(chip, 'min-height'), null, 'the floor is a phone correction, not a base');
  assert.equal(declaredValue(bodyOfBase('.winner-chips'), 'gap'), '10px');

  // And no picking rule may exist outside a phone query at all.
  assert.deepEqual(base.map(([sel]) => sel).filter((sel) => /data-state="picking"/.test(sel)), [],
    'a picking rule escaped its media query and now narrows the desktop band');
});

test('the dead .member-chip component is gone, not left beside the one it duplicated', () => {
  /* A near-identical copy of `.winner-chip` that no JS, HTML or test ever built
     — the „keep in sync" trap sitting next to the component #1139 changes. */
  assert.equal(bodyOf('.member-chip'), null);
  assert.equal(bodyOf('.member-chips'), null);
});
