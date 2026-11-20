'use strict';

/* The „Wie war's?" band on the result screen (#1838), rendered through the real
   showResults under jsdom:
   - a played session offers one seat per person at the table, an unfinished one
     none, and the winner picker hides it;
   - a seat that answered shows a check, never its face, and opening it
     preselects nothing;
   - choosing a face PUTs the verdict for that seat and the played game. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, flush } = require('./support/dom');
const { night, badgeRound, stubApi } = require('./support/badge-fixture');

function mount(t, session) {
  const r = badgeRound([session], 3);
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  stubApi(dom, r);
  dom.set('toast', () => {});
  const calls = [];
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (/\/verdicts\//.test(url)) return { answered: [] };
    return /\/activities$/.test(url) ? [] : {};
  });
  return { r, dom, calls };
}
const band = (dom) => dom.app.querySelector('.verdict');
const seats = (dom) => [...dom.app.querySelectorAll('.verdict__seat')];

test('a played session asks the people at its table, and only them', async (t) => {
  // Anna and Ben sat at the table; Clara is in the round but did not join.
  const { r, dom } = mount(t, night('s1', 5, { memberIds: ['m1', 'm2'] }));
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  assert.ok(band(dom), 'the band renders on a played session');
  assert.equal(band(dom).querySelector('.verdict__title').textContent, "Wie war's?");
  assert.deepEqual(seats(dom).map((b) => b.querySelector('.verdict__name').textContent), ['Anna', 'Ben']);
  assert.ok(seats(dom).every((b) => !b.classList.contains('is-done')));
});

test('an unfinished session has no band; the winner picker hides it', async (t) => {
  const open = mount(t, night('s1', 5, { finished: false, winnerIds: [] }));
  await open.dom.call('showResults', open.r, open.r.sessions[0], open.r.games, false);
  assert.equal(band(open.dom), null);

  const { r, dom } = mount(t, night('s2', 5));
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  const change = [...dom.app.querySelectorAll('.tisch button')].find((b) => /Ändern/.test(b.textContent));
  change.click();
  await flush(dom);
  assert.equal(band(dom), null, 'not while the winner is being corrected');
});

test('an answered seat shows a check and never its face; opening a seat preselects nothing', async (t) => {
  const { r, dom } = mount(t, night('s1', 5, { verdicts: { m1: { g1: { rating: 2 } } } }));
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  const [anna, ben] = seats(dom);
  assert.ok(anna.classList.contains('is-done'));
  assert.match(anna.textContent, /hat gesagt/);
  assert.equal(anna.querySelector('.ti-mood-sad'), null, 'no face on the seat');
  assert.ok(!ben.classList.contains('is-done'));

  seats(dom)[0].click();
  const faces = [...band(dom).querySelectorAll('.verdict__ask .mood')];
  assert.equal(faces.length, 5);
  assert.equal(faces.filter((f) => f.getAttribute('aria-pressed') === 'true').length, 0,
    'even an answered seat opens with nothing selected');
});

test('choosing a face saves that seat\'s verdict on the played game', async (t) => {
  const { r, dom, calls } = mount(t, night('s1', 5));
  await dom.call('showResults', r, r.sessions[0], r.games, false);
  seats(dom)[1].click();
  band(dom).querySelectorAll('.verdict__ask .mood')[3].click();
  await flush(dom);
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put, 'a verdict was sent');
  assert.equal(put.url, '/api/rounds/r1/sessions/s1/verdicts/m2');
  assert.deepEqual(JSON.parse(JSON.stringify(put.body)), { gameId: 'g1', rating: 4 });
  assert.ok(seats(dom)[1].classList.contains('is-done'), 'Ben now shows as answered');
  assert.equal(band(dom).querySelector('.verdict__ask').hidden, true, 'and the faces close');
});
