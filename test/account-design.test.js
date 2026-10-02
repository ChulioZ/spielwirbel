'use strict';

/*
 * Which design an account wears (#1186) and how the operator's design tile
 * counts it (#1201/#1362). Two halves:
 *
 *  - lib/account-design.js — pure, so it is tested directly — and the flip's
 *    lazy default (#1202) it carries: an account that never answered the
 *    chooser wears the face;
 *  - the two routes that change a design (PATCH /me, POST /design-chooser-seen),
 *    driven end to end.
 *
 * The switch-back stamp `designSwitchedBack` (#1201) is gone (#1480, operator
 * decision): its only reader was removed, so no creation or design-change path
 * may write it any more — the specs below pin that, on every path that used to.
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
const demo = require('../lib/demo');
const { accountDesign, tallyDesignAdoption } = require('../lib/account-design');

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
// Whether the removed field reached the stored record at all — `in`, not a
// value check, because writing `false` would be the same data-minimisation
// failure as writing `true`.
const carriesSwitchBack = async (uid) => 'designSwitchedBack' in (await repo.getUserById(uid));

/* ------------------------------- the rule ---------------------------------- */

// An account that has answered the chooser — the only kind whose stored design
// is a CHOICE since the flip (#1202).
const chose = (design, extra = {}) => ({ design, designChooserSeen: designs.DESIGN_CHOOSER_REVISION, ...extra });

test('#1202: an account that never answered the chooser wears the face, whatever it stores', () => {
  // Every account registered before the flip stores the face of ITS day —
  // Klassisch — without having chosen it. The flip moves all of them.
  assert.equal(designs.FACE_DESIGN, 'tisch');
  assert.equal(accountDesign({ design: 'klassisch', designChooserSeen: null }), 'tisch');
  assert.equal(accountDesign({ design: 'klassisch' }), 'tisch', 'absent key: never answered');
  assert.equal(accountDesign({}), 'tisch');
  assert.equal(accountDesign(null), 'tisch');
  // Once answered, the stored design is a choice and is honoured.
  assert.equal(accountDesign(chose('klassisch')), 'klassisch');
  assert.equal(accountDesign(chose('tisch')), 'tisch');
  // …unless this instance does not offer it.
  assert.equal(accountDesign(chose('GEHEIM')), 'tisch');
  // ANY run of the chooser counts: a later run (a new design) must not move an
  // account that chose Klassisch back onto the face while it is pending.
  assert.equal(accountDesign({ design: 'klassisch', designChooserSeen: '2000-01-01' }), 'klassisch');
});

test('tallyDesignAdoption counts only answered accounts; an unknown answered id folds into the face', () => {
  /* #1362: an account that never answered the chooser counts on NO line — it
     never saw the alternatives. A skip is stored exactly like a confirmed Tisch
     (answered, 'tisch'), so it counts under Tisch. */
  const out = tallyDesignAdoption([
    { design: null, answered: false, n: 2 },
    { design: 'klassisch', answered: false, n: 6 }, // pre-flip, untouched
    { design: 'tisch', answered: false, n: 5 },     // post-flip, untouched
    { design: 'tisch', answered: true, n: 3 },       // skipper or confirmed Tisch
    { design: 'klassisch', answered: true, n: 4 },
    { design: 'GEHEIM', answered: true, n: 1 },
  ]);
  assert.deepEqual(Object.keys(out.byDesign), designs.selectableDesignIds({ production: false }));
  assert.equal(out.byDesign.klassisch, 4, 'only the accounts that CHOSE Klassisch');
  assert.equal(out.byDesign.tisch, 3 + 1, 'answered Tisch plus the unknown answered id, never the unanswered');
  assert.equal(Object.values(out.byDesign).reduce((a, b) => a + b, 0), 3 + 4 + 1,
    'the lines sum to the ANSWERED accounts');
  assert.deepEqual(Object.keys(out), ['byDesign'], 'the switch-back share was dropped (#1480)');
  assert.equal(JSON.stringify(out).includes('GEHEIM'), false, 'a stored id reached the keys');
});

/* ------------------------------- the routes -------------------------------- */

test('#1480: registration does not write designSwitchedBack', async () => {
  const acc = await freshAccount();
  const record = store.data.users.find((u) => u.id === acc.uid);
  assert.equal('designSwitchedBack' in record, false);
});

test('#1480: a demo account is created without designSwitchedBack', async () => {
  const guest = await demo.createDemoAccount('de', null);
  assert.equal(typeof guest, 'object', `the demo mint failed: ${guest}`);
  assert.equal(await carriesSwitchBack(guest.id), false);
});

test('#1480: PATCH /me writes no switch-back stamp on any design change', async () => {
  const acc = await freshAccount();
  for (const design of ['tisch', 'klassisch', 'tisch', 'klassisch']) {
    assert.equal((await patchMe(acc, { design })).status, 200);
    assert.equal(await carriesSwitchBack(acc.uid), false, `after a move to ${design}`);
  }
  const me = await request(app).get('/api/account/me').set('Authorization', `Bearer ${acc.accessToken}`);
  assert.equal('designSwitchedBack' in me.body, false);
});

test('#1202: a pick on Konto answers the chooser, so the pick is actually WORN', async () => {
  const acc = await freshAccount();
  const res = await patchMe(acc, { design: 'klassisch' });
  assert.equal(res.status, 200);
  assert.equal(res.body.design, 'klassisch', 'without the stamp /me would still answer the face');
  assert.equal(res.body.designChooserSeen, designs.DESIGN_CHOOSER_REVISION);

  // Already answered: a later pick leaves the stamp alone.
  await repo.updateUser(acc.uid, { designChooserSeen: '2000-01-01' });
  await patchMe(acc, { design: 'tisch' });
  assert.equal((await repo.getUserById(acc.uid)).designChooserSeen, '2000-01-01');
});

test('#1480: the first-start chooser writes no switch-back stamp — the old main way back', async () => {
  const acc = await freshAccount();
  const res = await chooser(acc, { design: 'klassisch' });
  assert.equal(res.status, 200);
  assert.equal(res.body.design, 'klassisch');
  assert.equal(await carriesSwitchBack(acc.uid), false);
});

test('#1202: „Später entscheiden" keeps the design the account is WEARING, and writes it down', async () => {
  // The pre-flip shape: stored Klassisch, chooser never answered.
  const acc = await freshAccount();
  await repo.updateUser(acc.uid, { design: 'klassisch', designChooserSeen: null });
  const res = await chooser(acc, {});
  assert.equal(res.status, 200);
  assert.equal(res.body.design, 'tisch', 'declining must not quietly undo the flip');
  assert.equal((await repo.getUserById(acc.uid)).design, 'tisch');
  assert.equal(await carriesSwitchBack(acc.uid), false);
});

