'use strict';

/*
 * „Einfacher Modus" (#1646) through the real routes: PATCH /api/account/me
 * validates the shape and normalises the ids, /me projects it, and an account
 * predating the key reads as OFF.
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const store = require('../lib/store');
const { outbox } = require('../lib/mail');

let seq = 0;
async function freshAccount() {
  seq += 1;
  const email = `simple-${seq}@example.com`;
  const password = 'correct horse battery';
  const reg = await request(app).post('/api/account/register')
    .send({ email, username: `simple${seq}`, password });
  assert.equal(reg.status, 200);
  const m = outbox[outbox.length - 1].text.match(/\/v\?t=([a-z0-9]+\.([0-9a-f]+)\.[A-Za-z0-9_-]+)/);
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password });
  assert.equal(login.status, 200);
  return { uid: m[2], token: login.body.accessToken };
}
const getMe = (token) => request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
const patchMe = (token, body) => request(app).patch('/api/account/me')
  .set('Authorization', `Bearer ${token}`).send(body);

test('a new account starts OFF, and the value round-trips normalised', async () => {
  const acc = await freshAccount();
  assert.deepEqual((await getMe(acc.token)).body.simpleMode, { all: false, except: [] });

  const res = await patchMe(acc.token, { simpleMode: { all: true, except: ['recap', 'notAFeature', 'trophies', 'recap'] } });
  assert.equal(res.status, 200);
  // Unknown ids are dropped silently, duplicates collapse, feature order is kept.
  assert.deepEqual(res.body.simpleMode, { all: true, except: ['trophies', 'recap'] });
  assert.deepEqual((await getMe(acc.token)).body.simpleMode, { all: true, except: ['trophies', 'recap'] },
    'and it persists');
  // Another field's PATCH leaves it alone.
  assert.deepEqual((await patchMe(acc.token, { bgStats: true })).body.simpleMode, { all: true, except: ['trophies', 'recap'] });
});

test('a wrong SHAPE is refused and writes nothing', async () => {
  const acc = await freshAccount();
  await patchMe(acc.token, { simpleMode: { all: false, except: ['stats'] } });
  for (const bad of [true, 'all', null, [], { all: 'true', except: [] }, { all: true },
    { all: true, except: 'stats' }, { all: false, except: [1] }]) {
    const res = await patchMe(acc.token, { simpleMode: bad });
    assert.equal(res.status, 400, `${JSON.stringify(bad)} must be refused`);
    assert.equal(res.body.error, 'invalid_simple_mode_pref');
  }
  assert.deepEqual((await getMe(acc.token)).body.simpleMode, { all: false, except: ['stats'] },
    'a refusal writes nothing');
});

test('an account predating the key reads as OFF', async () => {
  const acc = await freshAccount();
  await patchMe(acc.token, { simpleMode: { all: true, except: [] } });
  const record = store.data.users.find((u) => u.id === acc.uid);
  delete record.simpleMode;
  store.saveData();
  assert.equal('simpleMode' in store.data.users.find((u) => u.id === acc.uid), false, 'the key is really gone');
  // `all` defaults OFF: a projection that read an absent key as `all: true`
  // would empty the app for every account registered before #1646.
  assert.deepEqual((await getMe(acc.token)).body.simpleMode, { all: false, except: [] });
});
