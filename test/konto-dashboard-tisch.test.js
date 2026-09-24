'use strict';

/* Konto as Der Tisch's dashboard (#1265, T5.2 at 1440, T5.4 at 390).
 *
 * The view is RUN through the jsdom harness rather than source-matched
 * (.claude/rules/testing-views-under-jsdom.md), under BOTH designs:
 *
 *  - Klassisch must render exactly the column it rendered before #1265 — the
 *    same children of #app, in the same order, with the same headings. That is
 *    the half a design branch most easily breaks without anything looking
 *    wrong on the design being built.
 *  - Der Tisch renders the dashboard: Du | Design, then BoardGameGeek, then the
 *    danger card, with every setting behind a disclosure row — and every control
 *    Klassisch offers is still in the DOM, i.e. still reachable.
 *
 * The contrast half is at the foot: the one ground this slice paints that the
 * token sweep cannot see is the danger card's --danger tint, mixed in styles.css
 * from a Tisch token.
 *
 * Named for the screen and the design so it collides with no module basename
 * (.claude/rules/test-file-names-collide-silently.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush, translator } = require('./support/dom');
const { bodyOfIn } = require('./support/css');
const { contrast, evaluate, token } = require('./support/theme');
const { DESIGN_REGISTRY, designById } = require('../public/js/designs');

const T = translator('de');
const TISCH = designById('tisch');
const ALL = { designs: DESIGN_REGISTRY.map((d) => d.id) };

const ME = {
  id: 'u1', email: 'ada@example.com', username: 'ada', emailVerified: true,
  createdAt: '2025-05-14T10:00:00Z', bggUsername: 'adabgg', avatar: null,
  pendingEmail: null, demo: false, design: 'klassisch',
  statsVisible: true, bgStats: false,
  notifyRoundInvitations: true, notifyFriendRequests: false,
};

async function konto(t, { design = 'klassisch', me = {}, cfg = ALL } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const who = { ...ME, design, ...me };
  const calls = [];
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => true);
  dom.set('toast', () => {});
  dom.set('withAppConfig', (cb) => cb(cfg));
  // A passkey on file and a browser that can add one, so the passkey section
  // renders its controls — an empty, unsupported one has none, and the
  // reachability sweep below would be blind to that whole row.
  dom.set('passkeysSupported', () => true);
  dom.set('accountApi', async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === '/passkeys') {
      return { passkeys: [{ credentialId: 'c1', name: 'Laptop', createdAt: '2026-01-02T00:00:00Z', lastUsedAt: null }] };
    }
    if (method === 'PATCH' && path === '/me') return { ...who, ...body };
    return who;
  });
  dom.call('applyDesign', design);
  await dom.call('showAccount');
  await flush();
  return { dom, calls };
}

// The shape of #app, one line per child: its tag, its classes and — for a
// heading — its text. Enough to see a reordered, added or dropped section.
const shape = (app) => [...app.children].map((el) => {
  const head = /^H\d$/.test(el.tagName) ? ` "${el.textContent}"` : '';
  return `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${head}`;
});

/* ------------------------------- Klassisch -------------------------------- */

test('Klassisch renders the same column as before #1265 — no dashboard, same order', async (t) => {
  const { dom } = await konto(t);
  const h2 = (key, extra = '') => `h2.konto-section__h${extra} "${T(key)}"`;
  assert.deepEqual(shape(dom.app), [
    'div.lobby-head',
    h2('konto.identity'),
    'div.konto-facts',
    h2('konto.avatar.title'),
    'div.konto-avatar',
    h2('konto.profile.title'),
    'div.konto-notify',
    'div.konto-design',
    h2('konto.bgg.title'),
    'form.konto-pw',
    h2('konto.bgstats.title'),
    'div.konto-notify',
    h2('konto.notify.title'),
    'div.konto-notify',
    h2('konto.email.title'),
    'div.konto-notify',
    h2('konto.pw.title'),
    'form.konto-pw',
    h2('konto.passkey.title'),
    'div.konto-notify',
    h2('konto.delete.title', '.konto-section__h--danger'),
    'div.konto-danger',
  ]);
  assert.equal(dom.document.querySelector('.konto-dash, .konto-row, .konto-card'), null,
    'a Tisch-only element leaked into the Klassisch column');
  // The picture form renders exactly its three parts — no name block slipped in.
  assert.deepEqual([...dom.app.querySelector('.konto-avatar').children].map((c) => c.className),
    ['avatar konto-avatar__preview', 'konto-avatar__actions', 'konto-error']);
});

/* -------------------------------- Der Tisch -------------------------------- */

test('Der Tisch composes the dashboard: Du, Design, BoardGameGeek, then the danger card', async (t) => {
  const { dom } = await konto(t, { design: 'tisch' });
  assert.deepEqual(shape(dom.app), ['div.lobby-head', 'div.konto-dash']);
  const cards = [...dom.app.querySelector('.konto-dash').children].map((c) => [...c.classList].find((k) => k.startsWith('konto-card--')));
  assert.deepEqual(cards, ['konto-card--du', 'konto-card--design', 'konto-card--bgg', 'konto-card--danger']);
  // The Design card is the real section, filled.
  assert.ok(dom.app.querySelector('.konto-card--design .design-picker'), 'the Design card holds no picker');
  // The danger card is the real deletion entry point.
  assert.equal(dom.app.querySelector('.konto-card--danger button').textContent, T('konto.delete.cta'));
});

test('the „Du" card: picture, then name and address, then the picture buttons — in DOM order', async (t) => {
  const { dom } = await konto(t, { design: 'tisch' });
  const head = dom.app.querySelector('.konto-card--du .konto-avatar');
  assert.deepEqual([...head.children].map((c) => c.classList[0]),
    ['avatar', 'konto-du__who', 'konto-avatar__actions', 'konto-error']);
  const name = head.querySelector('.konto-du__name');
  assert.equal(name.tagName, 'A', 'the handle must stay the link to the profile (#1089)');
  assert.equal(name.getAttribute('href'), dom.run('profilePath("ada")'));
  const meta = head.querySelector('.konto-du__meta').textContent;
  assert.match(meta, /ada@example\.com/);
  assert.ok(meta.includes(T('konto.du.since', { date: dom.call('fmtMonth', ME.createdAt) })), meta);
});

test('the setting rows keep the app\'s order — password ABOVE passkey — and each opens its own form', async (t) => {
  const { dom } = await konto(t, { design: 'tisch' });
  const rows = [...dom.app.querySelectorAll('.konto-card--du .konto-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.konto-row__label').textContent), [
    T('konto.profile.title'), T('konto.bgstats.title'), T('konto.notify.title'),
    T('konto.email.title'), T('konto.pw.title'), T('konto.passkey.title'),
  ]);

  // What each panel must hold, i.e. the Klassisch builder it reuses.
  const holds = ['.konto-notify input[type=checkbox]', '.konto-notify input[type=checkbox]',
    '.konto-notify input[type=checkbox]', '#keNew', '#kpCurrent', '.konto-passkeys'];
  rows.forEach((row, i) => {
    const btn = row.querySelector('h3 > button.konto-row__btn');
    assert.ok(btn, 'a row is a button inside a heading (the APG accordion)');
    const panel = dom.document.getElementById(btn.getAttribute('aria-controls'));
    assert.ok(panel && row.contains(panel), 'aria-controls names the row\'s own panel');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.hidden, true, 'every setting starts collapsed');
    assert.ok(panel.querySelector(holds[i]), `row ${i} does not hold ${holds[i]}`);

    btn.click();
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.hidden, false);
    btn.click();
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.hidden, true);
  });
});

test('every control the Klassisch column offers is still in the Tisch dashboard', async (t) => {
  const { dom: plain } = await konto(t);
  const { dom: tisch } = await konto(t, { design: 'tisch' });
  const controls = (app) => new Set([
    ...[...app.querySelectorAll('input')].map((i) => `input#${i.id}[${i.type}]`),
    ...[...app.querySelectorAll('button, a')].map((b) => `${b.tagName}:${b.textContent.trim()}`),
  ]);
  const have = controls(tisch.app);
  const missing = [...controls(plain.app)].filter((c) => !have.has(c));
  assert.deepEqual(missing, [], 'unreachable under Der Tisch');
  // The anti-vacuous floor: a sweep that found nothing would pass trivially.
  assert.ok(controls(plain.app).size >= 10, `the Klassisch sweep found only ${controls(plain.app).size} controls`);
});

test('each row states its current value, and a toggle row follows a change', async (t) => {
  const { dom, calls } = await konto(t, { design: 'tisch', me: { pendingEmail: 'neu@example.com' } });
  const value = (label) => [...dom.app.querySelectorAll('.konto-row')]
    .find((r) => r.querySelector('.konto-row__label').textContent === T(label))
    .querySelector('.konto-row__value').textContent;
  assert.equal(value('konto.profile.title'), T('konto.row.on'));
  assert.equal(value('konto.bgstats.title'), T('konto.row.off'));
  assert.equal(value('konto.notify.title'), T('konto.row.partly'));
  assert.equal(value('konto.email.title'), T('konto.row.pending'));
  assert.equal(value('konto.pw.title'), '');

  const box = dom.app.querySelector('#kontoPanel-bgstats input[type=checkbox]');
  box.checked = true;
  box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(value('konto.bgstats.title'), T('konto.row.on'));
  await flush();
  // …and the save went through the Klassisch toggle's own request, unforked.
  assert.deepEqual({ ...calls.find((c) => c.method === 'PATCH').body }, { bgStats: true });
});

test('a demo gets the Du, Design and BoardGameGeek cards, two rows and no danger card', async (t) => {
  const { dom } = await konto(t, { design: 'tisch', me: { demo: true } });
  const cards = [...dom.app.querySelector('.konto-dash').children].map((c) => [...c.classList].find((k) => k.startsWith('konto-card--')));
  assert.deepEqual(cards, ['konto-card--du', 'konto-card--design', 'konto-card--bgg']);
  assert.deepEqual([...dom.app.querySelectorAll('.konto-row__label')].map((l) => l.textContent),
    [T('konto.profile.title'), T('konto.bgstats.title')]);
  assert.ok(dom.app.textContent.includes(T('konto.demo.note')));
  assert.ok(!dom.app.querySelector('.konto-du__meta').textContent.includes('@'),
    'a demo\'s synthetic address must not be shown');
  assert.equal(dom.app.querySelector('.konto-avatar__actions'), null, 'a demo is offered no picture upload');
});

test('with one design offered the Design card stays empty, so tisch.css can hide it', async (t) => {
  const { dom } = await konto(t, { design: 'tisch', cfg: { designs: ['klassisch'] } });
  assert.equal(dom.app.querySelector('.konto-card--design').children.length, 0);
});

test('picking a design that composes the screen differently re-renders it', async (t) => {
  const { dom } = await konto(t, { design: 'tisch' });
  assert.ok(dom.app.querySelector('.konto-dash'));
  const radio = dom.app.querySelector('.design-picker input[value="klassisch"]');
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  for (let i = 0; i < 4; i++) await flush();
  assert.equal(dom.app.querySelector('.konto-dash'), null, 'Klassisch is worn but the dashboard is still on screen');
  assert.ok(dom.app.querySelector('.konto-facts'), 'the Klassisch column did not come back');
});

/* -------------------------------- contrast -------------------------------- */

test('the danger card\'s heading and intro clear AA on its --danger tint under Der Tisch', () => {
  // The tint is styles.css's `.konto-danger` mix, resolved on this design's
  // tokens — the card keeps it rather than taking the plain walnut ground.
  const bg = /background:\s*([^;]+);/.exec(bodyOfIn('.konto-danger'))[1].trim();
  const ground = evaluate(bg, TISCH);
  for (const ink of ['--danger', '--ink-soft', '--ink']) {
    const ratio = contrast(token(ink, TISCH), ground);
    assert.ok(ratio >= 4.5, `${ink} measures ${ratio.toFixed(2)}:1 on the danger card (floor 4.5)`);
  }
});

test('the row value and identity line clear AA on the walnut card', () => {
  // At rest the row sits on the walnut card; hovered, on --control-fill.
  for (const ground of ['--surface', '--control-fill']) {
    for (const ink of ['--ink', '--ink-soft']) {
      const ratio = contrast(token(ink, TISCH), token(ground, TISCH));
      assert.ok(ratio >= 4.5, `${ink} on ${ground} measures ${ratio.toFixed(2)}:1`);
    }
  }
  // The focus ring and the card edge are non-text: 3:1.
  assert.ok(contrast(token('--gold', TISCH), token('--surface', TISCH)) >= 3);
});
