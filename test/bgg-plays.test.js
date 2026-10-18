'use strict';

/*
 * BGG plays for the play-history import (#1665): the /xmlapi2/plays parser,
 * against a live capture with every name replaced, and the round-scoped
 * GET …/lookup/plays route that pages through it for the acting account.
 *
 * Accounts are ON: the handle hangs off the account, exactly as for the
 * collection import (test/bgg-import.test.js). `fetch` is stubbed throughout.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.BGG_API_TOKEN = 'test-token';

const fs = require('fs');
const path = require('path');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const { outbox } = require('../lib/mail');
const { parsePlays } = require('../lib/providers/bgg');

const CAPTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'bgg-plays-2026-10-18.xml'), 'utf8');
// What BGG answered for a username it does not know, verbatim (2026-10-18).
const UNKNOWN = `<?xml version="1.0" encoding="utf-8"?>\t<div class='messagebox error'>\n\t\tInvalid object or user\n\t</div>\n`;
const PAST_END = '<?xml version="1.0" encoding="utf-8"?><plays username="AdaPlays" userid="100001" total="2" page="99" termsofuse="x">\n</plays>';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

/* ------------------------------- the parser -------------------------------- */

test('parsePlays reads the captured page: date, quantity, location, game and players', () => {
  const { invalidUser, total, plays } = parsePlays(CAPTURE, 'AdaPlays');
  assert.equal(invalidUser, false);
  assert.equal(total, 2);
  assert.equal(plays.length, 2);
  const [a, b] = plays;
  assert.deepEqual({ id: a.id, date: a.date, quantity: a.quantity, location: a.location, game: a.game },
    { id: '900000001', date: '2026-10-14', quantity: 1, location: 'Strandhaus', game: { bggId: 161970, title: 'Alchemists' } });
  assert.deepEqual(a.players.map((p) => [p.name, p.score, p.win, !!p.me]),
    [['Ada Lovelace', '64', false, true], ['Bea', '59', false, false], ['Cem', '63', false, false], ['Dio', '55', false, false]]);
  assert.equal(b.quantity, 2, 'quantity is kept for the client to expand');
  assert.equal(b.players[1].score, '', 'an empty score stays empty, not 0');
});

test('parsePlays drops a co-player\'s BGG username — only the account row is marked', () => {
  const xml = CAPTURE.replace('username="" userid="0" name="Bea"', 'username="bea_on_bgg" userid="7" name="Bea"');
  const json = JSON.stringify(parsePlays(xml, 'AdaPlays'));
  assert.ok(!json.includes('bea_on_bgg'), 'a co-player handle must not leave the parser');
  assert.ok(!json.includes('AdaPlays'), 'nor the account\'s own — `me` is enough');
});

test('parsePlays tells an unknown user (a 200 HTML box) from a page past the end', () => {
  assert.deepEqual(parsePlays(UNKNOWN), { invalidUser: true, total: 0, plays: [] });
  assert.deepEqual(parsePlays(PAST_END), { invalidUser: false, total: 2, plays: [] });
  assert.deepEqual(parsePlays(''), { invalidUser: true, total: 0, plays: [] });
});

/* -------------------------------- the route -------------------------------- */

const PASSWORD = 'correct horse battery';
async function makeAccount(email) {
  await request(app).post('/api/account/register').send({ email, username: email.split('@')[0], password: PASSWORD });
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=(v1\.[0-9a-f]+\.[A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  return { token: login.body.accessToken, user: await repo.getUserByEmail(email) };
}
const auth = (token) => ({ Authorization: `Bearer ${token}` });

function stubBgg(body, status = 200) {
  const urls = [];
  global.fetch = async (url) => { urls.push(String(url)); return { status, text: async () => body }; };
  return urls;
}

test('GET …/lookup/plays pages the account\'s plays, by the account\'s handle only', async () => {
  const a = await makeAccount('plays-ok@example.com');
  const round = (await request(app).post('/api/rounds').set(auth(a.token)).send({ name: 'R', members: ['Ada'] })).body;
  await request(app).patch('/api/account/me').set(auth(a.token)).send({ bggUsername: 'AdaPlaysOk' });
  const urls = stubBgg(CAPTURE);
  const res = await request(app)
    .get(`/api/rounds/${round.id}/lookup/plays?provider=bgg&page=1&username=someone-else`)
    .set(auth(a.token));
  assert.equal(res.status, 200);
  assert.equal(res.body.state, 'ok');
  assert.equal(res.body.total, 2);
  assert.equal(res.body.plays.length, 2);
  assert.equal(urls.length, 1);
  const asked = new URL(urls[0]);
  assert.equal(asked.pathname, '/xmlapi2/plays');
  assert.equal(asked.searchParams.get('username'), 'AdaPlaysOk', 'never the query parameter');
  assert.equal(asked.searchParams.get('page'), '1');
});

test('GET …/lookup/plays reports no_username, invalid_user and queued as states', async () => {
  const a = await makeAccount('plays-states@example.com');
  const round = (await request(app).post('/api/rounds').set(auth(a.token)).send({ name: 'R', members: ['Ada'] })).body;
  const get = () => request(app).get(`/api/rounds/${round.id}/lookup/plays?provider=bgg&page=1`).set(auth(a.token));

  assert.equal((await get()).body.state, 'no_username');
  await request(app).patch('/api/account/me').set(auth(a.token)).send({ bggUsername: 'NobodyHere' });
  stubBgg(UNKNOWN);
  assert.equal((await get()).body.state, 'invalid_user');
  // A queued answer must not be cached: a fresh handle so no earlier entry answers.
  await request(app).patch('/api/account/me').set(auth(a.token)).send({ bggUsername: 'QueuedHere' });
  const urls = stubBgg('', 202);
  assert.equal((await get()).body.state, 'queued');
  const before = urls.length;
  stubBgg(CAPTURE);
  const again = await get();
  assert.equal(again.body.state, 'ok', 'the retry asks BGG again rather than the cache');
  assert.ok(before >= 1);
});

test('GET …/lookup/plays answers 502 on a genuine BGG outage', async () => {
  const a = await makeAccount('plays-502@example.com');
  const round = (await request(app).post('/api/rounds').set(auth(a.token)).send({ name: 'R', members: ['Ada'] })).body;
  await request(app).patch('/api/account/me').set(auth(a.token)).send({ bggUsername: 'OutageHere' });
  stubBgg('', 500);
  const res = await request(app).get(`/api/rounds/${round.id}/lookup/plays?provider=bgg&page=1`).set(auth(a.token));
  assert.equal(res.status, 502);
});
