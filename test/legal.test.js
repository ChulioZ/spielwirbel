'use strict';

/*
 * Legal pages (issues #134/#140): /impressum + /datenschutz +
 * /nutzungsbedingungen are server-rendered from the IMPRESSUM_ADDRESS /
 * IMPRESSUM_EMAIL env identity and must
 *
 *  1. answer 404 while EITHER var is unset (no placeholder Impressum, ever),
 *  2. render all documents (DE authoritative + EN courtesy) once configured,
 *  3. escape the env values (they are interpolated into HTML),
 *  4. stay reachable without any auth (a legal notice must be public, and the
 *     DSA Art. 14 content rules must be publicly available), and
 *  5. never link the shut-down EU ODR platform (Reg. (EU) 2024/3228) or cite
 *     the repealed § 5 TMG — the stale-boilerplate traps #134 documents.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { app } = require('./helpers');
const { createApp } = require('../lib/app');
const legal = require('../lib/legal');
const { bodyOf } = require('./support/css');

const REPO = path.join(__dirname, '..');

const IDENTITY = {
  IMPRESSUM_ADDRESS: 'Musterweg 1\\nc/o Empfangsservice\\n12345 Musterstadt',
  IMPRESSUM_EMAIL: 'kontakt@example.test',
};

test.afterEach(() => {
  for (const k of ['IMPRESSUM_ADDRESS', 'IMPRESSUM_EMAIL', 'AUTH_PASSWORD']) delete process.env[k];
});

test('all legal routes 404 while the identity is not configured', async () => {
  for (const path of ['/impressum', '/datenschutz', '/nutzungsbedingungen']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 404, `${path} must 404 unconfigured`);
    assert.ok(!res.text.includes('<html'), 'no shell/app markup on the 404');
  }
});

test('one var alone is not enough — no partial Impressum', async () => {
  process.env.IMPRESSUM_ADDRESS = IDENTITY.IMPRESSUM_ADDRESS;
  assert.equal((await request(app).get('/impressum')).status, 404);
  delete process.env.IMPRESSUM_ADDRESS;
  process.env.IMPRESSUM_EMAIL = IDENTITY.IMPRESSUM_EMAIL;
  assert.equal((await request(app).get('/impressum')).status, 404);
});

test('configured: the Impressum renders identity, both languages, § 5 DDG', async () => {
  Object.assign(process.env, IDENTITY);
  const res = await request(app).get('/impressum');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.text.includes(legal.OPERATOR_NAME), 'operator name present');
  // The \n escapes in the env value become line breaks.
  assert.ok(res.text.includes('Musterweg 1<br>c/o Empfangsservice<br>12345 Musterstadt'));
  assert.ok(res.text.includes('kontakt@example.test'));
  assert.ok(res.text.includes('§ 5 DDG'), 'cites the DDG');
  assert.ok(!/§\s*5\s*TMG/.test(res.text), 'never the repealed TMG');
  assert.ok(res.text.includes('Courtesy translation'), 'EN section present');
  assert.ok(res.text.includes('/kontakt.html'), 'links the second contact channel');
});

test('configured: the privacy policy covers the real processors and no ODR link', async () => {
  Object.assign(process.env, IDENTITY);
  const res = await request(app).get('/datenschutz');
  assert.equal(res.status, 200);
  for (const marker of [
    'Railway', 'Cloudflare',                     // the two platform processors
    // Since #440 mail is sent through the operator's own mailbox, so there is
    // no separate delivery provider to name — Heinlein below covers both
    // directions. A new marker belongs here if one is ever reintroduced.
    'Heinlein',                                  // operator-mailbox host (#307)
    'ZERODOX',                                   // address-service recipient — separate controller, no AVV (#226)
    'eigenständiger Verantwortlicher',           // …and the classification itself is pinned in the DE text
    'Ko-fi', 'Stripe', 'PayPal',                 // donation-link parties — independent controllers (#173)
    'eigenständige Verantwortliche',             // …their classification pinned in the DE text too
    'geekdo-images.com', 'steamstatic.com',      // hotlinked cover hosts disclosed (#172)
    'Nutzungsereignisse',                        // product-event logging (#261) disclosed
    'keine Konto- oder Mandanten-Kennung',       // feedback is anonymous since #321 — pin the §11 disclosure
    'Aktionsprotokoll',                          // moderation log + erasure-record retention
    '§ 25', 'TDDDG',                             // consent-free storage position
    'Art. 77',                                   // right to lodge a complaint
    'Art. 22',                                   // explicit no-automated-decisions statement
    legal.OPERATOR_NAME,
  ]) {
    assert.ok(res.text.includes(marker), `policy must mention ${marker}`);
  }
  assert.ok(!res.text.includes('ec.europa.eu/consumers/odr'), 'no link to the shut-down ODR platform');
  assert.ok(!res.text.includes('TTDSG'), 'uses the current TDDDG name');
});

test('configured: the policy states the moderation-log retention decision (#140)', async () => {
  Object.assign(process.env, IDENTITY);
  const res = await request(app).get('/datenschutz');
  assert.equal(res.status, 200);
  // The 3-year rule (operator decision 2026-07-21) in both languages, tied to
  // the norm it is derived from — vvt.md row 10 and docs/legal/retention.md
  // state the same period; changing one means changing all of them.
  assert.ok(res.text.includes('drei Jahre'), 'DE names the 3-year period');
  assert.ok(res.text.includes('three years'), 'EN names the 3-year period');
  assert.ok(res.text.includes('§§ 195, 199 BGB'), 'cites the limitation-period basis');
});

test('configured: the Nutzungsbedingungen carry the DSA content rules (#140)', async () => {
  Object.assign(process.env, IDENTITY);
  const res = await request(app).get('/nutzungsbedingungen');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  for (const marker of [
    legal.OPERATOR_NAME,
    'kontakt@example.test',            // notice channel + DSA contact point from env
    'unentgeltlich',                   // free service, donations unlock nothing
    '§§ 86, 86a StGB', '§ 130 StGB',   // prohibited-content list is explicit, not generic
    'sexuellen Missbrauchs von Kindern',
    'Cover-Bilder',                    // the #172 uploader-rights clause
    '2022/2065',                       // cites the DSA by regulation number
    'Art. 16 Abs. 2',                  // notice elements (URL, reasoning, good faith)
    'Art. 17 DSA',                     // statement of reasons promised
    'Art. 11, 12 DSA',                 // contact points named
    'Produkthaftungsgesetz',           // liability cascade
    'Courtesy translation',            // EN half present
    'Terms of use',
  ]) {
    assert.ok(res.text.includes(marker), `terms must mention ${marker}`);
  }
  // Deliberately NO minimum-age clause (#140 operator decision 2026-07-21):
  // no consent-based processing (Art. 8 DSGVO not triggered), hosting service
  // not platform (no Art. 28 DSA duty). The re-evaluation triggers live in
  // .claude/rules/keep-legal-docs-current.md — if an age clause is ever added
  // on purpose, update this assertion together with that rule.
  assert.ok(!res.text.includes('Mindestalter'), 'no age clause (recorded decision)');
  assert.ok(!/16\s*Jahre/.test(res.text), 'no 16-years wording (recorded decision)');
  assert.ok(!res.text.includes('ec.europa.eu/consumers/odr'), 'no ODR link');
  assert.ok(!/§\s*5\s*TMG/.test(res.text), 'never the repealed TMG');
});

test('env values are escaped before interpolation', async () => {
  process.env.IMPRESSUM_ADDRESS = 'Weg 1 <script>alert(1)</script>';
  process.env.IMPRESSUM_EMAIL = 'a"b@example.test';
  const res = await request(app).get('/impressum');
  assert.equal(res.status, 200);
  assert.ok(!res.text.includes('<script>alert'), 'address is escaped');
  assert.ok(res.text.includes('&lt;script&gt;'), 'escaped form present');
  assert.ok(!res.text.includes('"a"b@'), 'email quotes escaped in attributes');
});

test('reachable without a session under the shared-password gate', async () => {
  Object.assign(process.env, IDENTITY);
  process.env.AUTH_PASSWORD = 'gate-pw';
  const gatedApp = createApp();
  assert.equal((await request(gatedApp).get('/api/rounds')).status, 401);
  assert.equal((await request(gatedApp).get('/impressum')).status, 200);
  assert.equal((await request(gatedApp).get('/datenschutz')).status, 200);
  assert.equal((await request(gatedApp).get('/nutzungsbedingungen')).status, 200);
});

/* --------------------------------------------------------------------------
   #520: the terms must bind demo users, and nothing may link to a 404 legal page

   There are exactly two account-creation paths. `POST /api/account/register`
   renders the register form's terms line; `POST /api/account/demo` renders
   nothing — a demo account is created without registration, so §1's old
   registration-only acceptance never covered the one visitor who reaches a
   fully writable account anonymously, in one click.

   The three assertions below pin the halves a browser cannot: the amended §1 in
   BOTH languages, and the fail-closed default of the two links that point at
   /nutzungsbedingungen — a page that hard-404s until the operator identity is
   configured. Whether they are correctly REVEALED on a configured instance is
   `withAppConfig()`'s job and is verified in a browser.
   -------------------------------------------------------------------------- */

test('#520: Nutzungsbedingungen §1 covers demo accounts in both languages', async () => {
  Object.assign(process.env, IDENTITY);
  const res = await request(app).get('/nutzungsbedingungen');
  assert.equal(res.status, 200);
  // Acceptance is no longer tied to registration alone. Matched as whole
  // sentences rather than on the word "Demo" — that appears elsewhere in the
  // document, so a bare-word assertion would stay green against a reverted §1.
  assert.ok(
    /Mit der Registrierung eines Kontos\s+oder dem Start eines Demo-Kontos akzeptierst du diese Bedingungen/.test(res.text),
    'DE §1 ties acceptance to registration OR starting a demo'
  );
  assert.ok(
    /By registering an account or\s+starting a demo account you accept these terms/.test(res.text),
    'EN §1 ties acceptance to registration OR starting a demo'
  );
  // …and the document says plainly that a demo needs no registration, so a
  // reader cannot conclude §1 only ever meant the registered path.
  assert.ok(res.text.includes('entsteht ohne Registrierung'), 'DE explains a demo needs no registration');
  assert.ok(res.text.includes('created\nwithout registration'), 'EN explains a demo needs no registration');
});

test('#520: both links to /nutzungsbedingungen ship hidden (fail closed)', () => {
  const html = fs.readFileSync(path.join(REPO, 'public/index.html'), 'utf8');
  const banner = /<a class="demo-banner__terms" id="demoBannerTerms"[^>]*>/.exec(html);
  assert.ok(banner, 'the demo banner carries a terms anchor');
  assert.ok(banner[0].includes('href="/nutzungsbedingungen"'), 'it points at the terms');
  assert.ok(/\bhidden\b/.test(banner[0]), 'it ships hidden — revealed only where the page resolves');

  // The register form's legal line is built in account.js, not in the shell.
  const js = fs.readFileSync(path.join(REPO, 'public/js/account.js'), 'utf8');
  assert.ok(
    /<p class="auth__terms muted" hidden>/.test(js),
    'the register form ships its legal line hidden'
  );
});

test('#520: each hidden legal link undoes its own display', () => {
  // The `hidden` attribute hides only through the UA stylesheet, so any author
  // `display` on these selectors beats it and republishes a link to a 404 with
  // no error anywhere (.claude/rules/hidden-attribute-vs-display-rule.md).
  for (const selector of ['.demo-banner__terms[hidden]', '.auth__terms[hidden]']) {
    const body = bodyOf(selector);
    assert.ok(body, `${selector} rule not found`);
    assert.match(body, /display:\s*none/, `${selector} must set display: none`);
  }
});

test('renderAddress: trims, drops blank lines, handles real newlines', () => {
  assert.equal(legal.renderAddress('A 1\n\n  B 2  \nC 3'), 'A 1<br>B 2<br>C 3');
  assert.equal(legal.renderAddress('A 1\\nB 2'), 'A 1<br>B 2');
  assert.equal(legal.renderAddress('x & <y>'), 'x &amp; &lt;y&gt;');
});

// #388: a *ladungsfähige Anschrift* served through a receiving service (the
// ZERODOX / anschrift.net "c/o" format) already leads with the operator's name,
// so the identity blocks must NOT prepend it again — the name must appear
// exactly once per language (DE + EN), never the "Julian Zenker\nJulian Zenker"
// doubling that shipped to production.
const countName = (text) => text.split(legal.OPERATOR_NAME).length - 1;

test('#388: an address that leads with the operator name is not doubled', async () => {
  process.env.IMPRESSUM_ADDRESS = `${legal.OPERATOR_NAME}\\nc/o ZERODOX\\nGartenstraße 1\\n12345 Musterstadt`;
  process.env.IMPRESSUM_EMAIL = IDENTITY.IMPRESSUM_EMAIL;
  for (const path of ['/impressum', '/datenschutz']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 200, `${path} renders`);
    assert.ok(!res.text.includes(`${legal.OPERATOR_NAME}<br>${legal.OPERATOR_NAME}`),
      `${path}: name not doubled`);
    assert.ok(res.text.includes(`${legal.OPERATOR_NAME}<br>c/o ZERODOX`),
      `${path}: name once, then the address`);
    // Once in the DE identity block + once in the EN one = 2, never 4.
    assert.equal(countName(res.text), 2, `${path}: name appears exactly once per language`);
  }
});

test('#388: a plain address (no leading name) still shows the name once', async () => {
  Object.assign(process.env, IDENTITY); // 'Musterweg 1\nc/o Empfangsservice\n…' — no leading name
  for (const path of ['/impressum', '/datenschutz']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 200, `${path} renders`);
    assert.ok(res.text.includes(`${legal.OPERATOR_NAME}<br>Musterweg 1`),
      `${path}: name prepended to a nameless address`);
    assert.equal(countName(res.text), 2, `${path}: name once per language`);
  }
});

test('nameAndAddress: dedupes a leading name (trimmed, case-insensitive), else prepends', () => {
  // c/o address already leads with the name → rendered once, no prepend.
  assert.equal(
    legal.nameAndAddress('Julian Zenker\\nc/o ZERODOX\\n12345 Musterstadt'),
    'Julian Zenker<br>c/o ZERODOX<br>12345 Musterstadt',
  );
  // The match is trimmed + case-insensitive; the address' own text renders verbatim.
  assert.equal(legal.nameAndAddress('  julian zenker  \\nStraße 1'), 'julian zenker<br>Straße 1');
  // A plain street/city value → the operator name is prepended.
  assert.equal(
    legal.nameAndAddress('Musterweg 1\\n12345 Musterstadt'),
    'Julian Zenker<br>Musterweg 1<br>12345 Musterstadt',
  );
});
