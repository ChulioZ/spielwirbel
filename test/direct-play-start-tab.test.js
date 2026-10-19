'use strict';

/* „Jetzt spielen" on the Start tab (#1682): a secondary way into a session for
 * one chosen game, including one the group does not own. Rendered through the
 * real hub under every registered design, then the picker it opens is driven
 * through to the two hand-offs: a listed game straight into the direct-play
 * sheet, and „Ein Spiel, das ihr nicht habt" into the add-game form's guest
 * mode, whose created row then opens that sheet. The route half (guest games
 * accepted, nothing else off the shelf) is in test/guest-games.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, waitFor } = require('./support/dom');
// Every registered design, never a hand-copied list.
const { DESIGN_REGISTRY } = require('../public/js/designs');

const game = (id, title, extra = {}) => ({ id, title, minPlayers: 2, maxPlayers: 4, createdAt: '2026-01-02T10:00:00.000Z', ...extra });

const round = (games) => ({
  id: 'r1',
  name: 'Sonntagsrunde',
  background: null,
  members: [{ id: 'm1', name: 'Lea' }, { id: 'm2', name: 'Jo' }],
  games,
  sessions: [],
  tags: [],
});

const SHELF = () => [
  game('g1', 'Catan'),
  game('g2', 'Azul'),
  game('g3', 'Agricola', { retired: true }),
  game('g4', 'Brass', { wish: true }),
  game('g5', 'Cascadia', { guestGame: true }),
];

async function hub(t, design, r) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  if (design !== 'klassisch') dom.run(`applyDesign(${JSON.stringify(design)})`);
  dom.set('api', async (method, url) => (/recommendations/.test(url) ? { recommendations: [] } : r));
  await dom.call('showRound', r.id, 'start');
  return dom;
}

const pane = (dom) => [...dom.app.children].filter((el) => !el.matches('.rail, .dock'));
const inPane = (dom, sel) => pane(dom).flatMap((el) => (el.matches(sel) ? [el] : [...el.querySelectorAll(sel)]));

for (const { id } of DESIGN_REGISTRY) {
  test(`${id}: the Start tab offers „Jetzt spielen" after the CTA, enabled on an empty shelf too`, async (t) => {
    for (const games of [SHELF(), []]) {
      const dom = await hub(t, id, round(games));
      const [play] = inPane(dom, '.hub-play');
      assert.ok(play, `${id} (${games.length} games): no „Jetzt spielen" on the Start tab`);
      assert.equal(inPane(dom, '.hub-play').length, 1, 'one copy in the pane');
      assert.equal(play.textContent.trim(), 'Jetzt spielen');
      assert.equal(play.disabled, false, 'the young-round lock is the draw\'s, not direct play\'s');
      assert.equal(play.classList.contains('btn--primary'), false, '„Session wirbeln" stays the one primary action');
      const cta = inPane(dom, '.hub-cta')[0];
      if (cta) {
        assert.ok(cta.compareDocumentPosition(play) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'it follows the CTA');
      }
      const presets = inPane(dom, '.hub-presets')[0];
      if (presets) {
        assert.ok(presets.compareDocumentPosition(play) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
          'it never sits between the CTA and the presets that modify it');
      }
      // Klassisch's rail carries the CTA from 1280px up, so it carries this too
      // and the pane's copy hides with the CTA; a lean rail carries neither.
      const railCopy = dom.app.querySelector('.rail .rail__play');
      const lean = dom.run('railIsLean()');
      assert.equal(!!railCopy, !lean, `${id}: the rail copy follows the rail's CTA`);
      assert.equal(play.classList.contains('rail-owned'), !lean);
    }
  });
}

test('the picker lists the shelf and earlier guest games, and a pick opens the direct-play sheet', async (t) => {
  const dom = await hub(t, 'klassisch', round(SHELF()));
  const handed = [];
  dom.set('startDirectSession', (r, g, opts) => handed.push({ id: g.id, dayKey: (opts || {}).dayKey }));
  inPane(dom, '.hub-play')[0].click();

  const sheet = dom.document.querySelector('.sheet');
  assert.equal(sheet.querySelector('h2').textContent, 'Welches Spiel spielt ihr?');
  const rows = [...sheet.querySelectorAll('.play-pick li .play-pick__row')];
  assert.deepEqual(rows.map((b) => b.querySelector('.ds-row__main').textContent.trim()), ['Azul', 'Cascadia', 'Catan'],
    'retired and wished-for games are not offered; the guest game is');
  assert.equal(rows[1].querySelector('.play-pick__tag').textContent, 'Gastspiel', 'an earlier guest game says so');
  assert.equal(rows[0].querySelector('.play-pick__tag'), null);

  rows[1].click();
  await waitFor(() => handed.length, { label: 'the picker closing into the direct-play sheet' });
  assert.deepEqual(handed[0], { id: 'g5', dayKey: undefined }, 'from the Start tab it is tonight — no logged day');
});

test('„Ein Spiel, das ihr nicht habt" stays under an empty search and runs the guest-mode form', async (t) => {
  const dom = await hub(t, 'klassisch', round(SHELF()));
  const forms = [];
  dom.set('showAddGameForm', (r, opts) => forms.push(opts));
  const handed = [];
  dom.set('startDirectSession', (r, g, opts) => handed.push({ id: g.id, dayKey: (opts || {}).dayKey, known: r.games.some((x) => x.id === g.id) }));
  inPane(dom, '.hub-play')[0].click();

  const sheet = dom.document.querySelector('.sheet');
  const search = sheet.querySelector('#playPickSearch');
  search.value = 'Heat';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(sheet.querySelector('.play-pick__empty').hidden, false, 'an empty search says so');
  const guestRow = sheet.querySelector('.play-pick__guest');
  assert.ok(guestRow && !guestRow.hidden, '„not found" is exactly when the guest row is wanted');
  assert.match(guestRow.textContent, /Ein Spiel, das ihr nicht habt/);

  guestRow.click();
  assert.equal(forms.length, 1);
  assert.equal(forms[0].title, 'Heat', 'the typed query becomes the title');
  assert.equal(forms[0].guest.name, null, 'nobody in particular brought it');

  forms[0].guest.onCreated(game('g9', 'Heat', { guestGame: true }));
  assert.deepEqual(handed[0], { id: 'g9', dayKey: undefined, known: true }, 'the new row joins the round and opens the sheet');
});

test('an empty round\'s picker is the guest row alone, with no search to come up empty', async (t) => {
  const dom = await hub(t, 'klassisch', round([]));
  inPane(dom, '.hub-play')[0].click();
  const sheet = dom.document.querySelector('.sheet');
  assert.equal(sheet.querySelectorAll('.play-pick li').length, 0);
  assert.equal(sheet.querySelector('#playPickSearch').closest('.field').hidden, true);
  assert.equal(sheet.querySelector('.play-pick__empty').hidden, true);
  assert.ok(sheet.querySelector('.play-pick__guest'));
});

test('the add-game form\'s nameless guest mode is titled for the game, not a guest', async (t) => {
  const dom = await hub(t, 'klassisch', round(SHELF()));
  dom.call('showAddGameForm', round(SHELF()), { guest: { name: null, onCreated() {} } });
  const sheets = [...dom.document.querySelectorAll('.sheet')];
  assert.equal(sheets[sheets.length - 1].querySelector('h2').textContent, 'Ein Spiel, das ihr nicht habt');
});
