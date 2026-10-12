'use strict';

/* The „Einfacher Modus" section of Konto (#1646): one parent over a box per
 * feature, the select-all rules, and that what is saved is what the shared
 * module computes — rendered by the real builder, saving through a stub. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');
const { SIMPLE_MODE_FEATURES } = require('../public/js/simple-mode');

function boot(t, simpleMode, { quiz = true, prices = true } = {}) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const sent = [];
  let stored = simpleMode;
  dom.set('accountApi', async (method, path, body) => {
    sent.push(JSON.parse(JSON.stringify(body)));
    stored = body.simpleMode; // the server normalises; a well-formed body is stored as sent
    return { simpleMode: stored };
  });
  dom.set('toast', () => {});
  dom.set('quizAvailable', () => quiz);
  dom.set('priceWatchesAvailable', () => prices);
  dom.run("accountUser = { id: 'u1' };");
  const form = dom.call('buildSimpleModeForm', { simpleMode });
  dom.document.body.appendChild(form);
  const parent = form.querySelector('.konto-simple__all input');
  const box = (f) => form.querySelector(`[data-feature="${f}"] input`);
  const shown = () => [...form.querySelectorAll('[data-feature]')].map((r) => r.dataset.feature);
  return { dom, form, parent, box, shown, sent };
}
const click = async (el) => { el.click(); await flush(); };

test('an untouched account: everything unticked, the parent off, all thirteen offered', (t) => {
  const { parent, box, shown } = boot(t, { all: false, except: [] });
  assert.deepEqual(shown(), SIMPLE_MODE_FEATURES);
  assert.equal(parent.checked, false);
  assert.equal(parent.indeterminate, false);
  for (const f of SIMPLE_MODE_FEATURES) assert.equal(box(f).checked, false, f);
});

test('the parent ticks every option, and a click on it again clears every exception', async (t) => {
  const { parent, box, sent } = boot(t, { all: false, except: ['recap'] });
  assert.equal(parent.indeterminate, true, 'one hidden option is a mixed set');
  await click(parent);
  assert.deepEqual(sent.at(-1), { simpleMode: { all: true, except: [] } }, 'mixed → hide everything');
  assert.equal(parent.checked, true);
  assert.equal(parent.indeterminate, false);
  await click(box('trophies'));
  assert.deepEqual(sent.at(-1), { simpleMode: { all: true, except: ['trophies'] } }, 'an exception under "all"');
  assert.equal(box('trophies').checked, false);
  assert.equal(parent.indeterminate, true);
  await click(parent);
  assert.deepEqual(sent.at(-1), { simpleMode: { all: true, except: [] } }, 'the parent is uniform again');
  await click(parent);
  assert.deepEqual(sent.at(-1), { simpleMode: { all: false, except: [] } }, 'all → nothing');
  for (const f of SIMPLE_MODE_FEATURES) assert.equal(box(f).checked, false, f);
});

test('the quiz and price alerts are offered only where the instance runs them', (t) => {
  const { shown, parent } = boot(t, { all: true, except: ['quiz', 'priceAlerts'] }, { quiz: false, prices: false });
  assert.deepEqual(shown(), SIMPLE_MODE_FEATURES.filter((f) => f !== 'quiz' && f !== 'priceAlerts'));
  assert.equal(parent.checked, true, 'every SHOWN option is hidden, so the parent reads all');
  assert.equal(parent.indeterminate, false);
});

test('the cached account follows the saved value, so the rest of the app reads it', async (t) => {
  const { dom, box } = boot(t, { all: false, except: [] });
  await click(box('stats'));
  assert.equal(dom.call('simpleHidden', 'stats'), true);
  assert.equal(dom.call('simpleHidden', 'trophies'), false);
});
