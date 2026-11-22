'use strict';

/* #1779 — the group challenge's four client surfaces (views-challenges.js):
 * the Start card, Pokale › Challenge with its start sheet, the line in the
 * result moment, and the Chronik row. The derivation is challenges.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadApp, waitFor } = require('./support/dom');

const RID = 'r1';
const DAY = 24 * 60 * 60 * 1000;
const iso = (d) => new Date(Date.now() + d * DAY).toISOString();
const played = (id, gid, d) => ({ id, createdAt: iso(d), chosenGameId: gid, gameIds: [gid], memberIds: ['m1'], votes: {}, finished: true, cancelled: false, done: true, winnerIds: [] });

function round(extra = {}) {
  return {
    id: RID, name: 'Freitagsrunde', background: null, tags: [],
    members: [{ id: 'm1', name: 'Anna' }, { id: 'm2', name: 'Ben' }],
    games: [{ id: 'g1', title: 'Azul', tagIds: [] }, { id: 'g2', title: 'Brass', tagIds: [] }],
    sessions: [], ...extra,
  };
}

function boot(t, calls = [], data = round()) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('api', async (method, url, body) => {
    calls.push({ method, url, body });
    if (/^\/api\/rounds\/[^/]+$/.test(url)) return data;
    if (url === '/api/rounds') return [];
    return {};
  });
  dom.set('accountsActive', () => false);
  // jsdom has no matchMedia; a phone-width answer opens the editor as a sheet.
  dom.run('window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });');
  dom.set('isLoggedIn', () => false);
  return dom;
}

const running = (extra = {}) => ({ kind: 'sessions', n: 3, startedAt: iso(-5), deadline: iso(10), ...extra });

test('Start row: absent without a challenge; a running one names goal, progress and deadline (#1853)', (t) => {
  const dom = boot(t);
  assert.equal(dom.call('hubChallengeRow', round()), null);
  const row = dom.call('hubChallengeRow', round({ challenge: running(), sessions: [played('s1', 'g1', -1)] }));
  // ONE slim row, and it is the link itself — not a card holding one.
  assert.equal(row.tagName, 'A');
  assert.ok(row.classList.contains('hub-challenge'));
  assert.equal(row.querySelector('.hub-card'), null);
  assert.equal(row.dataset.state, 'running');
  assert.equal(row.querySelector('.hub-challenge__goal').textContent, '3 Sessions');
  assert.match(row.querySelector('.hub-challenge__status').textContent, /^1 von 3 · bis .+ · noch 10 Tage$/);
  assert.equal(row.querySelector('.challenge-bar').style.getPropertyValue('--pct'), '33%');
  // Lands on the Pokale section where the challenge lives (renderChallengeSection's id).
  assert.equal(row.getAttribute('href'), `/round/${RID}/pokale#challenge`);
});

test('Start row: an ended challenge lingers for a week, then leaves', (t) => {
  const dom = boot(t);
  const recent = dom.call('hubChallengeRow', round({ challenge: running({ startedAt: iso(-10), deadline: iso(-2) }) }));
  assert.equal(recent.dataset.state, 'expired');
  assert.equal(dom.call('hubChallengeRow', round({ challenge: running({ startedAt: iso(-30), deadline: iso(-8) }) })), null);
});

const sheetBody = (dom) => dom.window.document.querySelector('.sheet-backdrop .editor--challenge');

test('Pokale: with no challenge the section is ONE „Challenge starten" row, opening the start form; it POSTs the picked goal (#1856)', async (t) => {
  const calls = [];
  const dom = boot(t, calls);
  const sec = dom.call('renderChallengeSection', round());
  dom.app.appendChild(sec);
  assert.equal(sec.id, 'challenge', 'the Start tab and the Chronik land on this id');
  assert.equal(sec.children.length, 1, 'one row, nothing else');
  const row = sec.querySelector('button.challenge-row--start');
  assert.ok(row, 'the row is a button');
  assert.equal(row.getAttribute('aria-label'), 'Challenge starten');
  assert.equal(sec.querySelector('.challenge-section__empty, .challenge-history'), null, 'no paragraph on the page');
  row.click();
  const doc = dom.window.document;
  const kind = doc.getElementById('challengeKind');
  assert.ok(kind, 'with no history the row opens the start form directly');
  assert.deepEqual([...kind.options].map((o) => o.value), ['newGames', 'wholeShelf', 'sessions', 'distinctGames']);
  kind.value = 'distinctGames';
  kind.dispatchEvent(new dom.window.Event('change'));
  doc.getElementById('challengeN').value = '4';
  [...doc.querySelectorAll('.editor-actions .btn--primary')].pop().click();
  await new Promise((r) => setTimeout(r, 0));
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.url, `/api/rounds/${RID}/challenge`);
  const body = JSON.parse(JSON.stringify(post.body));
  assert.equal(body.kind, 'distinctGames');
  assert.equal(body.n, 4);
  assert.ok(Date.parse(body.deadline) > Date.now() + 29 * DAY, 'defaults to a month ahead');
});

test('Pokale: the whole-shelf preset is not offered on an empty shelf, and needs no number', (t) => {
  const dom = boot(t);
  const sec = dom.call('renderChallengeSection', round({ games: [] }));
  dom.app.appendChild(sec);
  sec.querySelector('.challenge-row').click();
  const kind = dom.window.document.getElementById('challengeKind');
  assert.ok(![...kind.options].some((o) => o.value === 'wholeShelf'));
});

test('Pokale: with no challenge and no right to write, the section is not there at all (#1856)', (t) => {
  const dom = boot(t);
  dom.set('roundCan', () => false);
  assert.equal(dom.call('renderChallengeSection', round()), null);
  // A running one is still shown to a reader, without its end control.
  const sec = dom.call('renderChallengeSection', round({ challenge: running() }));
  dom.app.appendChild(sec);
  sec.querySelector('.challenge-row').click();
  assert.ok(sheetBody(dom).querySelector('.challenge-current'), 'the sheet shows the status');
  assert.equal(sheetBody(dom).querySelector('.challenge-current__end, .challenge-section__start'), null);
});

test('Pokale: a running challenge is one row — flag, goal, status, bar, chevron — and its sheet ends it, never restarts it; the history is there (#1856)', (t) => {
  const dom = boot(t);
  const past = { kind: 'wholeShelf', shelfSnapshot: ['g1'], startedAt: iso(-60), deadline: iso(-40) };
  const sec = dom.call('renderChallengeSection', round({ challenge: running(), challengeHistory: [past] }));
  dom.app.appendChild(sec);
  assert.equal(sec.children.length, 1);
  const row = sec.querySelector('button.challenge-row');
  assert.equal(row.dataset.state, 'running');
  assert.equal(row.querySelector('.challenge-row__goal').textContent, '3 Sessions');
  assert.match(row.querySelector('.challenge-row__status').textContent, /^0 von 3 · bis .+ · noch 10 Tage$/);
  assert.ok(row.querySelector('.challenge-bar'), 'the bar is on the row');
  assert.equal(row.querySelector('.challenge-bar').getAttribute('aria-hidden'), 'true', 'the row’s name says it in words');
  assert.ok(row.querySelector('.challenge-row__go.ti-chevron-right'));
  assert.match(row.getAttribute('aria-label'), /^Challenge: 3 Sessions\. 0 von 3/);
  row.click();
  const body = sheetBody(dom);
  assert.equal(body.querySelector('.challenge-current__goal').textContent, '3 Sessions');
  assert.equal(body.querySelector('.challenge-current__end').textContent, 'Challenge beenden');
  assert.equal(body.querySelector('.challenge-section__start'), null);
  const items = body.querySelectorAll('.challenge-history__item');
  assert.equal(items.length, 1);
  assert.equal(items[0].dataset.state, 'expired');
  assert.equal(items[0].querySelector('.challenge-history__goal').textContent, 'Jedes Spiel im Regal einmal');
});

test('Pokale: an ended challenge shows its outcome on the row; the sheet archives it and offers a new one in place (#1856)', async (t) => {
  const dom = boot(t);
  // From 860px the editor is a popover, which REPLACES any popover open — so
  // a start form opened as its own overlay would restore focus to the start
  // button it came from, gone with the overview. In place, it returns to the row.
  dom.run('window.matchMedia = (q) => ({ matches: /min-width/.test(q), addEventListener() {}, removeEventListener() {} });');
  const doc = dom.window.document;
  const sec = dom.call('renderChallengeSection', round({ challenge: running({ startedAt: iso(-10), deadline: iso(-2) }) }));
  dom.app.appendChild(sec);
  const row = sec.querySelector('.challenge-row');
  assert.equal(row.dataset.state, 'expired');
  assert.match(row.querySelector('.challenge-row__status').textContent, new RegExp(dom.run("t('challenge.state.expired', { date: '' })").trim().split(' ')[0]));
  row.focus();
  row.click();
  const pop = () => doc.querySelector('.popover--challenge');
  assert.equal(pop().querySelector('.challenge-current__end').textContent, dom.run("t('challenge.archive')"));
  pop().querySelector('.challenge-section__start').click();
  assert.equal(doc.querySelectorAll('.popover').length, 1);
  assert.ok(pop().querySelector('#challengeKind'), 'the start form is in the same overlay');
  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitFor(() => !doc.querySelector('.popover'), { label: 'Escape closes the popover' });
  assert.equal(doc.activeElement, row, 'focus returns to the challenge row');
});

test('result moment: the latest session that moved it gets one line; the one that completes it says so', (t) => {
  const dom = boot(t);
  const doc = dom.window.document;
  const s1 = played('s1', 'g1', -2); const s2 = played('s2', 'g2', -1);
  const host = doc.createElement('section');
  host.hidden = true;
  dom.call('fillChallengeMoment', host, round({ challenge: running(), sessions: [s1, s2] }), s2);
  assert.equal(host.hidden, false);
  assert.match(host.querySelector('.challenge-moment__text').textContent, /Challenge: 3 Sessions · 2 von 3/);

  const done = doc.createElement('section');
  dom.call('fillChallengeMoment', done, round({ challenge: running({ n: 2 }), sessions: [s1, s2] }), s2);
  assert.equal(done.querySelector('.challenge-moment').dataset.state, 'completed');
  assert.match(done.textContent, /Challenge geschafft: 2 Sessions/);

  const older = doc.createElement('section');
  older.hidden = true;
  dom.call('fillChallengeMoment', older, round({ challenge: running(), sessions: [s1, s2] }), s1);
  assert.equal(older.hidden, true, 'an older session is the Chronik’s business');
  assert.equal(older.querySelector('.challenge-moment'), null);
});

test('result moment: a refill replaces its line rather than stacking a second one', (t) => {
  const dom = boot(t);
  const host = dom.window.document.createElement('section');
  const r = round({ challenge: running(), sessions: [played('s1', 'g1', -1)] });
  dom.call('fillChallengeMoment', host, r, r.sessions[0]);
  dom.call('fillChallengeMoment', host, r, r.sessions[0]);
  assert.equal(host.querySelectorAll('.challenge-moment').length, 1);
});

test('Chronik: one row under the session that completed a challenge, current or past', (t) => {
  const dom = boot(t);
  const s1 = played('s1', 'g1', -50); const s2 = played('s2', 'g2', -1);
  const past = { kind: 'distinctGames', n: 1, startedAt: iso(-60), deadline: iso(-40) };
  const r = round({ challenge: running({ n: 1 }), challengeHistory: [past], sessions: [s1, s2] });
  const index = dom.call('challengeChronikIndex', r);
  assert.deepEqual([...index.keys()].sort(), ['s1', 's2']);
  const rows = dom.call('chronikChallengeRows', r, index.get('s1'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.chronik-row__text').textContent, '1 verschiedenes Spiel');
  assert.ok(rows[0].classList.contains('chronik-row--badge'), 'painted as an Abzeichen row by every design');
});
