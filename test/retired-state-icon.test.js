'use strict';

/* One icon per concept (#1360 follow-up): retiring a game is reversible, so the
 * retired STATE wears `ti-archive` everywhere it is named — the confirm, the
 * triggers, and the labels on the archive, the tags, the Chronik and the recap —
 * and the bin stays with the deletions that really lose data. Removing a WISH is
 * neither: it is un-wishing, so it gets `ti-heart-off`.
 *
 * Rendered through the jsdom harness where a screen can be booted cheaply; the
 * label sites that only render deep inside a session/recap flow are pinned by
 * a scan over their source (.claude/rules/source-scanning-guards-enumerate-shapes.md:
 * each pattern below was checked red against its own reverted site). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { loadApp } = require('./support/dom');

const RID = 'r1';

function bootApp(t_) {
  const dom = loadApp();
  t_.after(() => dom.close());
  const round = {
    id: RID, name: 'Freitagsrunde', background: null, tags: [], providers: [],
    members: [{ id: 'm1', name: 'Anna' }],
    games: [
      { id: 'g2', title: 'Azul', retired: true, retiredAt: '2026-07-01T10:00:00.000Z', tagIds: [] },
      { id: 'g3', title: 'Cascadia', completed: true, completedAt: '2026-07-02T10:00:00.000Z', tagIds: [] },
      { id: 'g4', title: 'Ark Nova', wish: true, wishAt: '2026-07-03T10:00:00.000Z', tagIds: [] },
    ],
    sessions: [],
  };
  dom.set('api', async (method, url) => {
    if (/\/activities$/.test(url)) return [];
    if (/^\/api\/rounds\/[^/]+$/.test(url) && method === 'GET') return round;
    return {};
  });
  dom.set('toast', () => {});
  const dialogs = [];
  dom.set('confirmDialog', async (opts) => { dialogs.push(opts); return false; });
  return { dom, dialogs };
}

const row = (app) => app.querySelector('.archive-list .archive-row');

test('removing a wish is un-wishing: ti-heart-off on the button and on its confirm', async (t_) => {
  const { dom, dialogs } = bootApp(t_);
  await dom.call('showWishlist', RID);
  const del = row(dom.app).querySelector('[data-act="delete"] .ti');
  assert.ok(del.classList.contains('ti-heart-off'), `wish removal icon is ${del.className}`);
  row(dom.app).querySelector('[data-act="delete"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(dialogs.length, 1, 'the removal raised no confirm');
  assert.equal(dialogs[0].icon, 'ti-heart-off');
});

test('the retired archive labels its rows with ti-archive, not the bin', async (t_) => {
  const { dom } = bootApp(t_);
  await dom.call('showRetired', RID);
  const meta = row(dom.app).querySelector('.archive-row__meta .ti');
  assert.ok(meta.classList.contains('ti-archive'), `retired row meta icon is ${meta.className}`);
});

/* The control: a real deletion keeps the bin, on both the button and the confirm. */
test('deleting from an archive keeps ti-trash — that one really loses the history', async (t_) => {
  const { dom, dialogs } = bootApp(t_);
  await dom.call('showCompleted', RID);
  const btn = row(dom.app).querySelector('[data-act="delete"]');
  assert.ok(btn.querySelector('.ti').classList.contains('ti-trash'));
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(dialogs[0].icon, 'ti-trash');
});

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');

for (const [file, rx, what] of [
  ['off-shelf.js', /sub: 'retired', icon: '(ti-[a-z-]+)'/, 'the retired-archive link'],
  ['views-chronik.js', /game_retired: \{ icon: '(ti-[a-z-]+)'/, 'the Chronik game_retired row'],
  ['views-chronik.js', /games_retired: \{ icon: '(ti-[a-z-]+)'/, 'the Chronik games_retired row'],
  ['views-period-recap.js', /chip\('(ti-[a-z-]+)', tn\(rec\.retired/, 'the recap retired chip'],
  ['views-round-detail.js', /iconText\('(ti-[a-z-]+)', t\('result\.retiredTag'\)\)/, 'the game-detail retired tag'],
  ['views-session.js', /iconText\('(ti-[a-z-]+)', t\('result\.retiredTag'\)\)/, 'the session-result retired tag'],
]) {
  test(`${what} uses ti-archive`, () => {
    const m = src(file).match(rx);
    assert.ok(m, `${what}: pattern no longer matches ${file} — update this scan`);
    assert.equal(m[1], 'ti-archive', `${what} (${file}) still uses ${m[1]}`);
  });
}
