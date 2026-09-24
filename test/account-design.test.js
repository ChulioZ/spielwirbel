'use strict';

/*
 * The switch-back stamp (#1201): `designSwitchedBack: true` is written when an
 * account moves BACK to Klassisch from a design it was actually wearing, so the
 * operator's „Designs" tile can report how many people went back after the
 * flip (#1202). Two halves:
 *
 *  - lib/account-design.js, the rule itself — pure, so it is tested directly;
 *  - the two routes that change a design (PATCH /me, POST /design-chooser-seen),
 *    which must both apply it, driven end to end.
 *
 * Its own file rather than more of test/account.test.js, which is already well
 * past the source budget. No module called account-design exists under
 * public/js, so the name cannot collide (.claude/rules/test-file-names-collide-silently.md).
 */

process.env.ACCOUNTS_ENABLED = 'true';
process.env.SESSION_SECRET = 'test-session-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers');
const repo = require('../lib/repo');
const store = require('../lib/store');
const { outbox } = require('../lib/mail');
const designs = require('../public/js/designs');
const {
  SWITCH_BACK_DESIGN, accountDesign, switchBackPatch, tallyDesignAdoption,
} = require('../lib/account-design');

const PASSWORD = 'correct horse battery';
let seq = 0;

async function freshAccount() {
  seq += 1;
  const email = `design-back-${seq}@example.com`;
  const reg = await request(app).post('/api/account/register')
    .send({ email, username: `designback${seq}`, password: PASSWORD });
  assert.equal(reg.status, 200);
  const m = outbox[outbox.length - 1].text.match(/\/[vr]\?t=([a-z0-9]+\.([0-9a-f]+)\.[A-Za-z0-9_-]+)/);
  assert.ok(m, 'the verification mail carries a link');
  await request(app).post('/api/account/verify-email').send({ token: m[1] });
  const login = await request(app).post('/api/account/login').send({ email, password: PASSWORD });
  assert.equal(login.status, 200);
  return { uid: m[2], accessToken: login.body.accessToken };
}

const patchMe = (acc, body) => request(app)
  .patch('/api/account/me').set('Authorization', `Bearer ${acc.accessToken}`).send(body);
const chooser = (acc, body) => request(app)
  .post('/api/account/design-chooser-seen').set('Authorization', `Bearer ${acc.accessToken}`).send(body);
const stored = async (acc) => (await repo.getUserById(acc.uid)).designSwitchedBack;

async function asProduction(fn) {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before;
  }
}

/* ------------------------------- the rule ---------------------------------- */

test('the switch-back target is a registered design that production offers', () => {
  // Klassisch stays selectable forever („Wie bisher"); if it ever stopped being
  // enabled, no account in production could switch back to it and the tile
  // would read zero for a reason nobody could see.
  const row = designs.designById(SWITCH_BACK_DESIGN);
  assert.ok(row, `${SWITCH_BACK_DESIGN} is not in the registry`);
  assert.equal(row.enabled, true);
});

test('switchBackPatch stamps only a move FROM another worn design TO Klassisch', () => {
  const back = { designSwitchedBack: true };
  assert.deepEqual(switchBackPatch({ design: 'tisch' }, 'klassisch'), back);
  assert.deepEqual(switchBackPatch({ design: 'tisch' }, 'tisch'), {}, 'staying put is not a switch');
  assert.deepEqual(switchBackPatch({ design: 'klassisch' }, 'tisch'), {}, 'moving AWAY is not back');
  assert.deepEqual(switchBackPatch({ design: 'klassisch' }, 'klassisch'), {},
    'Klassisch to Klassisch is a no-op — the pre-flip default must never read as a switch');
  assert.deepEqual(switchBackPatch({}, 'klassisch'), {}, 'an account predating the field wore Klassisch');
  assert.deepEqual(switchBackPatch({ design: 'tisch', designSwitchedBack: true }, 'klassisch'), {},
    'already stamped: nothing to write');
  assert.deepEqual(switchBackPatch(null, 'klassisch'), {});
});

test('switchBackPatch judges the design the account was SHOWN, not the stored string', async () => {
  // Production before the flip offers Klassisch alone, so a stored 'tisch' from a
  // dev instance resolves to Klassisch — the account never saw Tisch, and
  // „going back" from it is not going back.
  await asProduction(async () => {
    assert.equal(accountDesign({ design: 'tisch' }), 'klassisch');
    assert.deepEqual(switchBackPatch({ design: 'tisch' }, 'klassisch'), {});
  });
});

test('tallyDesignAdoption folds unknown ids into the face and keys only offered ids', () => {
  const out = tallyDesignAdoption([
    { design: null, switched: false, n: 2 },
    { design: 'tisch', switched: true, n: 3 },
    { design: 'klassisch', switched: true, n: 4 },
    { design: 'GEHEIM', switched: true, n: 1 },
  ]);
  assert.deepEqual(Object.keys(out.byDesign), designs.selectableDesignIds({ production: false }));
  assert.equal(out.byDesign.klassisch, 7);
  assert.equal(out.byDesign.tisch, 3);
  // The unknown id wears Klassisch and carries the flag, so it counts — what
  // matters is what the account SEES, which is also what /me says.
  assert.equal(out.switchedBack, 5, 'the flag counts only on a current Klassisch');
  assert.equal(JSON.stringify(out).includes('GEHEIM'), false, 'a stored id reached the keys');
});

/* ------------------------------- the routes -------------------------------- */

test('registration writes designSwitchedBack: false, not an absent key', async () => {
  const acc = await freshAccount();
  const record = store.data.users.find((u) => u.id === acc.uid);
  assert.equal(record.designSwitchedBack, false);
});

test('PATCH /me stamps a return to Klassisch, once, and never clears it', async () => {
  const acc = await freshAccount();
  assert.equal((await patchMe(acc, { design: 'klassisch' })).status, 200);
  assert.equal(await stored(acc), false, 'Klassisch to Klassisch is not a switch');

  await patchMe(acc, { design: 'tisch' });
  assert.equal(await stored(acc), false, 'moving to Tisch is not a switch back');

  await patchMe(acc, { design: 'klassisch' });
  assert.equal(await stored(acc), true, 'Tisch back to Klassisch is');

  await patchMe(acc, { design: 'tisch' });
  assert.equal(await stored(acc), true, 'sticky: trying Tisch again does not unmake the return');

  // The flag is the operator's, not the account's: /me does not hand it out.
  const me = await request(app).get('/api/account/me').set('Authorization', `Bearer ${acc.accessToken}`);
  assert.equal('designSwitchedBack' in me.body, false);
});

test('the first-start chooser stamps it too — the main way back after the flip', async () => {
  const acc = await freshAccount();
  await patchMe(acc, { design: 'tisch' });
  const res = await chooser(acc, { design: 'klassisch' });
  assert.equal(res.status, 200);
  assert.equal(await stored(acc), true);

  // Declining („Später entscheiden") sends no design and must stamp nothing.
  const other = await freshAccount();
  await patchMe(other, { design: 'tisch' });
  await chooser(other, {});
  assert.equal(await stored(other), false);
});

test('in production, a stored-but-unoffered design going to Klassisch is NOT a switch', async () => {
  // The pre-flip production state: the account holds 'tisch' from a dev build,
  // but has only ever been shown Klassisch.
  const acc = await freshAccount();
  await patchMe(acc, { design: 'tisch' });
  await asProduction(async () => {
    assert.equal((await patchMe(acc, { design: 'klassisch' })).status, 200);
  });
  assert.equal(await stored(acc), false);
});
