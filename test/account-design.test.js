'use strict';

/*
 * The switch-back stamp (#1201): `designSwitchedBack: true` is written when an
 * account moves BACK to Klassisch from a design it was actually wearing, so the
 * operator's „Designs" tile can report how many people went back after the
 * flip (#1202). Two halves:
 *
 *  - lib/account-design.js, the rule itself — pure, so it is tested directly —
 *    and the flip's lazy default (#1202) it carries: an account that never
 *    answered the chooser wears the face;
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
  assert.notEqual(SWITCH_BACK_DESIGN, designs.FACE_DESIGN,
    'a switch-back to the face would count every untouched account as having gone back');
});

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

test('switchBackPatch stamps only a move FROM another worn design TO Klassisch', () => {
  const back = { designSwitchedBack: true };
  assert.deepEqual(switchBackPatch(chose('tisch'), 'klassisch'), back);
  assert.deepEqual(switchBackPatch(chose('tisch'), 'tisch'), {}, 'staying put is not a switch');
  assert.deepEqual(switchBackPatch(chose('klassisch'), 'tisch'), {}, 'moving AWAY is not back');
  assert.deepEqual(switchBackPatch(chose('klassisch'), 'klassisch'), {},
    'Klassisch to Klassisch is a no-op — an account that already chose it never left');
  assert.deepEqual(switchBackPatch(chose('tisch', { designSwitchedBack: true }), 'klassisch'), {},
    'already stamped: nothing to write');
  assert.deepEqual(switchBackPatch(null, 'klassisch'), {});
});

test('#1202: a pre-flip account picking Klassisch IS a switch back — it was shown Der Tisch', () => {
  // It stores 'klassisch' but has never answered the chooser, so it WEARS the
  // face. The stored string must not decide, or „Wie bisher" in the chooser —
  // the main way back — would never register on the operator's tile.
  assert.deepEqual(switchBackPatch({ design: 'klassisch', designChooserSeen: null }, 'klassisch'),
    { designSwitchedBack: true });
  assert.deepEqual(switchBackPatch({}, 'klassisch'), { designSwitchedBack: true },
    'an account predating the field wears the face too');
});

test('tallyDesignAdoption resolves like /me: unanswered and unknown fold into the face', () => {
  const out = tallyDesignAdoption([
    { design: null, answered: false, switched: false, n: 2 },
    { design: 'klassisch', answered: false, switched: false, n: 6 }, // pre-flip, untouched
    { design: 'tisch', answered: true, switched: true, n: 3 },
    { design: 'klassisch', answered: true, switched: true, n: 4 },
    { design: 'GEHEIM', answered: true, switched: true, n: 1 },
  ]);
  assert.deepEqual(Object.keys(out.byDesign), designs.selectableDesignIds({ production: false }));
  assert.equal(out.byDesign.klassisch, 4, 'only the accounts that CHOSE Klassisch');
  assert.equal(out.byDesign.tisch, 2 + 6 + 3 + 1);
  assert.equal(out.switchedBack, 4, 'the flag counts only on a current Klassisch');
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
  assert.equal((await patchMe(acc, { design: 'tisch' })).status, 200);
  assert.equal(await stored(acc), false, 'Tisch to Tisch is not a switch');

  await patchMe(acc, { design: 'klassisch' });
  assert.equal(await stored(acc), true, 'Tisch back to Klassisch is');

  await patchMe(acc, { design: 'tisch' });
  assert.equal(await stored(acc), true, 'sticky: trying Tisch again does not unmake the return');

  // The flag is the operator's, not the account's: /me does not hand it out.
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

test('the first-start chooser stamps it too — the main way back after the flip', async () => {
  const acc = await freshAccount();
  const res = await chooser(acc, { design: 'klassisch' });
  assert.equal(res.status, 200);
  assert.equal(res.body.design, 'klassisch');
  assert.equal(await stored(acc), true, 'a fresh account wore the face, so „Wie bisher" is a switch back');
});

test('#1202: „Später entscheiden" keeps the design the account is WEARING, and writes it down', async () => {
  // The pre-flip shape: stored Klassisch, chooser never answered.
  const acc = await freshAccount();
  await repo.updateUser(acc.uid, { design: 'klassisch', designChooserSeen: null });
  const res = await chooser(acc, {});
  assert.equal(res.status, 200);
  assert.equal(res.body.design, 'tisch', 'declining must not quietly undo the flip');
  assert.equal((await repo.getUserById(acc.uid)).design, 'tisch');
  assert.equal(await stored(acc), false, 'declining is not a switch back');
});

test('an account on a design this instance does not offer is not „switched back" by going to Klassisch… unless it was shown the face', async () => {
  // A stored id the registry does not know resolves to the face (Der Tisch), so
  // the account WAS shown Der Tisch and Klassisch is a real return.
  const acc = await freshAccount();
  await repo.updateUser(acc.uid, { design: 'GEHEIM', designChooserSeen: designs.DESIGN_CHOOSER_REVISION });
  await asProduction(async () => {
    assert.equal((await patchMe(acc, { design: 'klassisch' })).status, 200);
  });
  assert.equal(await stored(acc), true);
});
