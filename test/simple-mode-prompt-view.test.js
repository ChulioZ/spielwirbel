'use strict';

/* The one-time „Einfacher Modus" prompt on the Start tab (#1768), through the
 * real renderStartTab: who is shown it, where it sits, and what each answer
 * sends and does. The account is the cached `accountUser`, so the real
 * predicate (`simpleModePromptDue`) decides every case. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');
const { night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');

const OFF = { all: false, except: [] };

function boot(t, { me = { id: 'u1', username: 'ada', simpleMode: OFF, simpleModePromptSeen: null }, sessions } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = badgeRound(sessions || [night('s1', 1)]);
  stubApi(dom, round);
  wideAt(dom, false);
  if (me) dom.run(`accountUser = ${JSON.stringify(me)};`);
  const sent = [];
  dom.set('accountApi', (method, path, body) => {
    sent.push([method, path, JSON.parse(JSON.stringify(body || {}))]);
    return Promise.resolve({ ...me, simpleModePromptSeen: '2026-11-09T12:00:00.000Z',
      simpleMode: (body && body.simpleMode) || OFF });
  });
  const toasts = [];
  dom.set('toast', (msg) => toasts.push(msg));
  dom.run('globalThis.__redraws = 0; currentView = () => { globalThis.__redraws += 1; };');
  return { dom, round, sent, toasts };
}
const render = ({ dom, round }) => { dom.app.innerHTML = ''; dom.call('renderStartTab', round, round.games); };
const card = (dom) => dom.app.querySelector('.simple-prompt');

test('an account that has not answered sees it on a played round, below the CTA and above the cards', (t) => {
  const ctx = boot(t);
  render(ctx);
  const c = card(ctx.dom);
  assert.ok(c, 'the prompt renders');
  assert.ok(c.classList.contains('hub-card'), 'in the shared card frame every design styles');
  const cta = ctx.dom.app.querySelector('.hub-cta');
  const grid = ctx.dom.app.querySelector('.hub-cards');
  const FOLLOWS = ctx.dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(cta.compareDocumentPosition(c) & FOLLOWS, 'after the one action');
  assert.ok(c.compareDocumentPosition(grid) & FOLLOWS, 'before the card grid');
  // Keyboard-reachable, every control a real button or link with a name.
  const controls = [...c.querySelectorAll('button, a')];
  assert.equal(controls.length, 4, 'keep, simple, close and the Konto link');
  for (const el of controls) {
    assert.ok((el.getAttribute('aria-label') || el.textContent).trim(), 'every control has an accessible name');
  }
  assert.equal(c.querySelector('a').getAttribute('href'), '/konto');
  assert.equal(c.querySelector('.simple-prompt__close').getAttribute('aria-label'),
    ctx.dom.run("t('simplePrompt.close')"));
});

test('nobody else is asked: no account, a demo, an answered account, a chosen mode, an unplayed round', (t) => {
  const cases = [
    ['no account (accounts off)', { me: null }],
    ['a demo', { me: { id: 'd', demo: true, simpleMode: OFF, simpleModePromptSeen: null } }],
    ['already answered', { me: { id: 'u', simpleMode: OFF, simpleModePromptSeen: '2026-11-01T00:00:00.000Z' } }],
    ['a mode already chosen on Konto', { me: { id: 'u', simpleMode: { all: false, except: ['recap'] }, simpleModePromptSeen: null } }],
    ['a round with nothing played', { sessions: [night('s1', 1, { finished: false, done: false, winnerIds: [] })] }],
  ];
  for (const [label, opts] of cases) {
    const ctx = boot(t, opts);
    render(ctx);
    assert.equal(card(ctx.dom), null, label);
  }
});

test('„Alles behalten" stamps only, removes the card at once and redraws nothing', async (t) => {
  const ctx = boot(t);
  render(ctx);
  card(ctx.dom).querySelector('.simple-prompt__keep').click();
  assert.equal(card(ctx.dom), null, 'gone before the request returns');
  await flush();
  assert.deepEqual(ctx.sent, [['POST', '/simple-mode-prompt-seen', {}]]);
  assert.deepEqual(JSON.parse(ctx.dom.run('JSON.stringify(accountUser.simpleMode)')), OFF, 'the mode is untouched');
  assert.ok(ctx.dom.run('accountUser.simpleModePromptSeen'), 'answered in the cached account');
  assert.equal(ctx.dom.run('__redraws'), 0);
  render(ctx);
  assert.equal(card(ctx.dom), null, 'and it does not come back');
});

test('the × counts as „keep everything"', async (t) => {
  const ctx = boot(t);
  render(ctx);
  card(ctx.dom).querySelector('.simple-prompt__close').click();
  await flush();
  assert.deepEqual(ctx.sent, [['POST', '/simple-mode-prompt-seen', {}]]);
  assert.equal(card(ctx.dom), null);
});

test('„simple" sends the whole mode with the answer, caches it, toasts and redraws', async (t) => {
  const ctx = boot(t);
  render(ctx);
  card(ctx.dom).querySelector('.simple-prompt__simple').click();
  assert.equal(card(ctx.dom), null);
  await flush();
  assert.deepEqual(ctx.sent, [['POST', '/simple-mode-prompt-seen', { simpleMode: { all: true, except: [] } }]]);
  assert.deepEqual(JSON.parse(ctx.dom.run('JSON.stringify(accountUser.simpleMode)')), { all: true, except: [] });
  assert.equal(ctx.dom.call('simpleHidden', 'trophies'), true, 'the mode is live for the rest of the app');
  assert.deepEqual(ctx.toasts, [ctx.dom.run("t('konto.simple.saved')")]);
  assert.equal(ctx.dom.run('__redraws'), 1, 'the hub redraws under the new mode');
});

test('a failed „simple" puts the mode back and says so', async (t) => {
  const ctx = boot(t);
  ctx.dom.set('accountApi', () => Promise.reject(new Error('network')));
  render(ctx);
  card(ctx.dom).querySelector('.simple-prompt__simple').click();
  await flush();
  assert.deepEqual(JSON.parse(ctx.dom.run('JSON.stringify(accountUser.simpleMode)')), OFF);
  assert.deepEqual(ctx.toasts, [ctx.dom.run("t('auth.error.network')")]);
});
