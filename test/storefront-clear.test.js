'use strict';

/*
 * The storefront clean-up (#981): the one-off operator action that clears what
 * #744 deliberately left behind.
 *
 * #744 retired the four digital storefronts as lookup providers but kept two
 * things — covers already stored keep rendering (hotlinked from the storefront's
 * CDN) and stored `source` links stay as data. That is precisely why
 * `LEGACY_COVER_HOSTS` is frozen into the CSP `img-src` list and why the privacy
 * policy still names Sony, Valve, Nintendo and Microsoft as recipients. So this
 * action is the prerequisite for removing all of it, and what it must get right
 * is WHICH ROWS: too loose and it blanks a cover the browser was happy to
 * render, too tight and a host stays in `img-src` forever.
 */

process.env.ADMIN_PASSWORD = 'operator-secret-pw';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app, store } = require('./helpers');
const repo = require('../lib/repo');
const providers = require('../lib/providers');
const { storefrontMatch } = require('../lib/repo/storefront-match');

const HOSTS = providers.legacyCoverHosts();
const IDS = ['psstore', 'steam', 'nintendo', 'xbox'];

/* ------------------------------- the matcher ------------------------------- */

test('the matcher mirrors the download guard: the apex host AND any subdomain', () => {
  // `host === h || host.endsWith('.' + h)` is the rule every provider's own
  // guard applies and the one the CSP wildcard pair mirrors. A looser test
  // (`includes`) would clear a cover on `not-steamstatic.com.evil.test`.
  for (const url of [
    'https://steamstatic.com/x.jpg',
    'https://cdn.akamai.steamstatic.com/x.jpg',
    'https://image.api.playstation.com/x.png',
    'https://assets.nintendo.com/x.png',
    'https://store-images.s-microsoft.com/x.png',
  ]) {
    assert.equal(storefrontMatch({ image: url }, HOSTS, IDS).cover, true, url);
  }
  for (const url of [
    'https://cf.geekdo-images.com/x.jpg',
    'https://notsteamstatic.com/x.jpg',
    'https://steamstatic.com.evil.test/x.jpg',
    'not a url at all',
  ]) {
    assert.equal(storefrontMatch({ image: url }, HOSTS, IDS).cover, false, url);
  }
});

test('an UPLOADED cover is never a storefront cover — only its source link goes', () => {
  /* `/uploads/…` is our own object with no storefront in it. Counted separately
     because "how many covers go blank" is the number the operator decides on. */
  const m = storefrontMatch({ image: '/uploads/abc.webp', source: { provider: 'steam' } }, HOSTS, IDS);
  assert.deepEqual(m, { cover: false, source: true, upload: true });
});

test('a live provider\'s source link is left alone', () => {
  assert.equal(storefrontMatch({ source: { provider: 'bgg', id: '13' } }, HOSTS, IDS).source, false);
  assert.equal(storefrontMatch({ source: { provider: 'xbox', id: '9' } }, HOSTS, IDS).source, true);
});

/* --------------------------------- the run --------------------------------- */

const T = 'default';

/* The action is GLOBAL by nature — it asks "which rows anywhere still point at a
   retired storefront" — so every case starts from an empty store. Without this
   each test counts the previous test's shelf too, and the numbers drift upward
   in a way that looks like a matcher bug. */
async function seed() {
  store.data.rounds.length = 0;
  const round = await repo.createRound(T, { name: 'Shelf', members: ['Alice'] });
  const add = (fields) => repo.createGame(T, round.id, {
    title: fields.title, minPlayers: 1, maxPlayers: 4,
    image: fields.image === undefined ? null : fields.image,
    ...(fields.source ? { source: fields.source } : {}),
  });
  await add({ title: 'PS game', image: 'https://image.api.playstation.com/a.png', source: { provider: 'psstore', id: '1' } });
  await add({ title: 'Steam game', image: 'https://cdn.akamai.steamstatic.com/b.jpg' });
  await add({ title: 'Own cover', image: '/uploads/own.webp', source: { provider: 'xbox', id: '3' } });
  await add({ title: 'BGG game', image: 'https://cf.geekdo-images.com/c.jpg', source: { provider: 'bgg', id: '13' } });
  await add({ title: 'Plain', image: null });
  return round;
}

test('the dry run counts without touching a single row', async () => {
  const round = await seed();
  const before = JSON.stringify((await repo.getRound(T, round.id)).games);

  const run = await repo.clearStorefrontLinks({ hosts: HOSTS, providerIds: IDS, dryRun: true });
  assert.equal(run.games, 3, 'two storefront covers plus the uploaded one\'s source link');
  assert.equal(run.covers, 2);
  assert.equal(run.sources, 2, 'psstore and xbox — bgg is a live provider');
  assert.equal(run.uploads, 1, 'the one whose cover survives, so the operator can read the difference');
  assert.equal(run.rounds, 1);

  assert.equal(JSON.stringify((await repo.getRound(T, round.id)).games), before,
    'a dry run that writes is worse than no dry run at all');
  const acts = await repo.listActivities(T, round.id);
  assert.equal(acts.filter((a) => a.type === 'storefront_cleared').length, 0);
});

test('clearing blanks the storefront covers, drops the links, and keeps the upload', async () => {
  const round = await seed();
  const run = await repo.clearStorefrontLinks({ hosts: HOSTS, providerIds: IDS, dryRun: false });
  assert.equal(run.games, 3);

  const byTitle = Object.fromEntries((await repo.getRound(T, round.id)).games.map((g) => [g.title, g]));
  assert.equal(byTitle['PS game'].image, null, 'the cover goes to the placeholder');
  assert.equal('source' in byTitle['PS game'], false, 'and the link is gone, not nulled');
  assert.equal(byTitle['Steam game'].image, null);
  // The upload is ours: the bytes have no storefront in them, so only the link goes.
  assert.equal(byTitle['Own cover'].image, '/uploads/own.webp');
  assert.equal('source' in byTitle['Own cover'], false);
  // A live provider is untouched in both fields.
  assert.equal(byTitle['BGG game'].image, 'https://cf.geekdo-images.com/c.jpg');
  assert.equal(byTitle['BGG game'].source.provider, 'bgg');

  // One Chronik entry per ROUND, not per game — thirty identical lines would
  // bury the shelf's own history.
  const acts = (await repo.listActivities(T, round.id)).filter((a) => a.type === 'storefront_cleared');
  assert.equal(acts.length, 1);
  assert.equal(acts[0].n, 3);
});

test('a second press finds nothing — the action is idempotent', async () => {
  await seed();
  await repo.clearStorefrontLinks({ hosts: HOSTS, providerIds: IDS, dryRun: false });
  const again = await repo.clearStorefrontLinks({ hosts: HOSTS, providerIds: IDS, dryRun: true });
  assert.equal(again.games, 0, 'which is also how the operator knows the card can be removed');
});

/* --------------------------------- the route -------------------------------- */

async function adminCookie() {
  const res = await request(app).post('/api/admin/login').send({ password: 'operator-secret-pw' });
  assert.equal(res.status, 200);
  return res.headers['set-cookie'];
}

test('the route counts by default and only clears on an explicit confirm', async () => {
  const round = await seed();
  const cookie = await adminCookie();

  // No body at all, and a body without the flag: both are dry runs. The default
  // being the harmless one is what stops a malformed request clearing a shelf.
  for (const body of [{}, { confirm: false }]) {
    const res = await request(app).post('/api/admin/storefronts/clear').set('Cookie', cookie).send(body);
    assert.equal(res.status, 200);
    assert.equal(res.body.dryRun, true);
    assert.equal(res.body.run.games, 3);
  }
  assert.equal((await repo.getRound(T, round.id)).games[0].image,
    'https://image.api.playstation.com/a.png', 'nothing was cleared');

  const done = await request(app).post('/api/admin/storefronts/clear').set('Cookie', cookie).send({ confirm: true });
  assert.equal(done.body.dryRun, false);
  assert.equal((await repo.getRound(T, round.id)).games[0].image, null);
});

test('the route is behind the operator gate like every other admin action', async () => {
  const res = await request(app).post('/api/admin/storefronts/clear').send({ confirm: true });
  assert.equal(res.status, 401);
});

test('the frozen host list is exposed as a COPY, so nothing can prune it', () => {
  // The whole point of the freeze is that unregistering a provider must not
  // silently revoke the render permission for covers already on a shelf.
  const a = providers.legacyCoverHosts();
  a.push('evil.test');
  assert.equal(providers.legacyCoverHosts().includes('evil.test'), false);
  assert.ok(providers.legacyCoverHosts().length >= 5);
});

test.after(() => { store.data.rounds.length = 0; });
