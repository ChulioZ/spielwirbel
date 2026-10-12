'use strict';

/* „Einfacher Modus" (#1646) through the real views: each option takes its own
 * elements away, the default shows them, and nothing else on the same screen
 * moves. The mode is set on the cached account record (`accountUser`), so the
 * real predicate (`simpleHidden` → `simpleModeHides`) decides every case. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, flush } = require('./support/dom');
const { RID, night, badgeRound, stubApi, wideAt } = require('./support/badge-fixture');

const VOTES = { m1: { g1: { rating: 4 }, g2: { rating: 3 } }, m2: { g1: { rating: 5 }, g2: { rating: 2 } } };

function boot(t, simpleMode) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  const round = badgeRound([night('s1', 1, { votes: VOTES }), night('s2', 2, { votes: VOTES })]);
  stubApi(dom, round);
  wideAt(dom, false);
  // A signed-in account carrying the preference — undefined means "no account".
  if (simpleMode !== undefined) {
    dom.run(`accountUser = { id: 'u1', username: 'ada', simpleMode: ${JSON.stringify(simpleMode)} };`);
  }
  return { dom, round };
}
const OFF = { all: false, except: [] };
const only = (f) => ({ all: false, except: [f] });
const tabs = (dom) => [...dom.app.querySelectorAll('.dock .dock__item')].map((a) => a.getAttribute('href').split('/').pop());

test('the predicate reads the cached account, and no account hides nothing', (t) => {
  const { dom } = boot(t);
  assert.equal(dom.call('simpleHidden', 'trophies'), false, 'logged out: nothing is hidden');
  dom.run("accountUser = { id: 'u1', simpleMode: { all: true, except: ['recap'] } };");
  assert.equal(dom.call('simpleHidden', 'trophies'), true);
  assert.equal(dom.call('simpleHidden', 'recap'), false, 'an exception is shown');
  assert.equal(dom.call('simpleHidden', 'someLaterFeature'), true, 'a later id follows "all"');
});

test('trophies: the Pokale tab, its preview and every Abzeichen leave — and only with it hidden', (t) => {
  for (const [mode, hidden] of [[OFF, false], [only('trophies'), true], [{ all: true, except: [] }, true],
    [{ all: true, except: ['trophies'] }, false]]) {
    const { dom, round } = boot(t, mode);
    dom.call('renderHubTabs', round, 'start');
    assert.equal(tabs(dom).includes('pokale'), !hidden, `dock under ${JSON.stringify(mode)}`);
    assert.equal(tabs(dom).length, hidden ? 3 : 4, 'the other three tabs stay');
    const railTabs = [...dom.app.querySelectorAll('.rail__group .rail__item')].map((a) => a.getAttribute('href'));
    assert.equal(railTabs.some((h) => h.endsWith('/pokale')), !hidden, 'the rail follows the dock');
    assert.equal(dom.call('hubPokalePreview', round) === null, hidden, 'the hub preview');
    dom.app.innerHTML = '';
    dom.call('renderChronikTab', round, []);
    assert.equal(dom.app.querySelectorAll('.chronik-row--badge').length > 0, !hidden, 'the Chronik’s badge rows');
    assert.ok(dom.app.querySelectorAll('.tl-item').length >= 2, 'the timeline itself always stays');
  }
});

test('stats: the pulse, the anniversary card and the two section previews leave', (t) => {
  for (const [mode, hidden] of [[OFF, false], [only('stats'), true], [only('trophies'), false]]) {
    const { dom, round } = boot(t, mode);
    // More than HUB_PREVIEW_COVERS games, or the Regal preview has nothing to show either way.
    const active = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, title: `Spiel ${i}`, tagIds: [] }));
    assert.equal(dom.call('hubPulseCard', round, active) === null, hidden, `pulse under ${JSON.stringify(mode)}`);
    assert.equal(dom.call('hubRegalPreview', round, active) === null, hidden, 'the Regal preview');
    assert.equal(dom.call('hubChronikPreview', round) === null, hidden, 'the Chronik preview');
  }
});

test('recap: the Chronik’s period recap leaves, the timeline stays', (t) => {
  for (const [mode, hidden] of [[OFF, false], [only('recap'), true], [{ all: true, except: ['recap'] }, false]]) {
    const { dom, round } = boot(t, mode);
    assert.equal(dom.call('renderPeriodRecapSection', round, []) === null, hidden, `section under ${JSON.stringify(mode)}`);
    dom.app.innerHTML = '';
    dom.call('renderChronikTab', round, []);
    assert.equal(!!dom.app.querySelector('.precap, .period-recap, [class*="recap"]'), !hidden, 'nothing of the recap renders');
    assert.ok(dom.app.querySelectorAll('.tl-item').length >= 2, 'the timeline itself always stays');
  }
});

test('ratingDetails: „Wer wie gewertet hat" and the Stempelkarte leave the Spielepass, the score stays', async (t) => {
  for (const [mode, hidden] of [[OFF, false], [only('ratingDetails'), true]]) {
    const { dom } = boot(t, mode);
    await dom.call('showGameDetail', RID, 'g1');
    await flush();
    assert.equal(!!dom.app.querySelector('.gd-raters'), !hidden, `raters under ${JSON.stringify(mode)}`);
    assert.equal(!!dom.app.querySelector('.gd-history'), !hidden, 'the Stempelkarte');
    assert.ok(dom.app.querySelector('.gd-head h1, .gd-title'), 'the page itself renders either way');
  }
});

test('gameExtras: the expansions chip and „Mehr zum Spiel" leave the Spielepass', async (t) => {
  for (const [mode, hidden] of [[OFF, false], [only('gameExtras'), true]]) {
    const { dom } = boot(t, mode);
    await dom.call('showGameDetail', RID, 'g1');
    await flush();
    assert.equal(!!dom.app.querySelector('.tag--expansions'), !hidden, `chip under ${JSON.stringify(mode)}`);
    assert.equal(!!dom.app.querySelector('.gd-more'), !hidden, '„Mehr zum Spiel"');
  }
});

test('trophies: a profile with no record but an earned year mark still renders, without the mark', (t) => {
  /* The no-record branch of renderProfileCard appends the badge row whenever an
     account-tier mark is earned, so a hidden `trophies` (which makes the
     builder answer null) must not reach appendChild. Found by CodeRabbit on
     #1653; the friend profile's card threw instead of rendering. */
  const { dom } = boot(t, only('trophies'));
  const badges = [{ key: 'accountYears', tier: 1, state: 'earned', at: '2026-01-01T00:00:00.000Z' }];
  const card = dom.call('renderProfileCard', { username: 'bob', createdAt: '2025-01-01T00:00:00.000Z',
    stats: { sessions: 0, badges } }, () => {});
  assert.ok(card.querySelector('h1'), 'the card rendered');
  assert.equal(card.querySelector('.profile-card__badges'), null, 'no badge row under a hidden `trophies`');
});
