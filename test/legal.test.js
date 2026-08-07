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
const vm = require('node:vm');
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
    'BG Stats', 'bgstatsapp.com',                // the play-push recipient — same click-link shape (#485)
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

test('#520: §3 does not claim every account needs an e-mail address', async () => {
  Object.assign(process.env, IDENTITY);
  const res = await request(app).get('/nutzungsbedingungen');
  assert.equal(res.status, 200);
  // A demo account holds a synthetic `demo-<hex>@demo.invalid` address the
  // visitor never supplies and NO password identity (lib/demo.js), so the old
  // blanket "an account with a valid e-mail address is required" was simply
  // untrue of the one path an anonymous visitor actually takes.
  assert.ok(
    !/ist ein Konto mit einer gültigen E-Mail-Adresse\s+erforderlich/.test(res.text),
    'DE §3 must not require an e-mail address for EVERY account'
  );
  assert.ok(
    !/requires an account with a valid e-mail address/.test(res.text),
    'EN §3 must not require an e-mail address for EVERY account'
  );
  // Prose spans source line breaks, so match against a whitespace-normalized
  // copy — otherwise the assertion encodes the current wrapping and goes red on
  // a harmless re-flow rather than on a meaning change.
  const flat = res.text.replace(/\s+/g, ' ');
  assert.ok(flat.includes('ohne E-Mail-Adresse und ohne Passwort'), 'DE §3 names what a demo lacks');
  assert.ok(flat.includes('without an e-mail address and without a password'), 'EN §3 names what a demo lacks');
});

test('#520: §3 offers the self-service deletion the app actually has', async () => {
  Object.assign(process.env, IDENTITY);
  const res = await request(app).get('/nutzungsbedingungen');
  assert.equal(res.status, 200);
  // DELETE /api/account (#419, with its own Konto screen) and DELETE
  // /api/account/demo (#502, „Demo beenden") both exist, so naming the operator
  // contact channels as the ONLY route understates the user's own controls.
  const flat = res.text.replace(/\s+/g, ' ');
  assert.ok(flat.includes('selbst in der App löschen'), 'DE §3 names in-app deletion');
  assert.ok(flat.includes('delete your account yourself in the app'), 'EN §3 names in-app deletion');
  assert.ok(flat.includes('in der App beenden'), 'DE §3 names ending a demo');
  assert.ok(flat.includes('a demo account can be ended'), 'EN §3 names ending a demo');
  // …without dropping the informal contact route, which is still offered.
  assert.ok(flat.includes('im Impressum genannten Kontaktwege'), 'DE §3 keeps the informal route');
  assert.ok(flat.includes('contact channels in the legal notice'), 'EN §3 keeps the informal route');
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
  // #521 adds two more: the terms-change notice itself (it ships hidden and is
  // revealed only for an account that is behind) and its link to the terms.
  for (const selector of [
    '.demo-banner__terms[hidden]', '.auth__terms[hidden]',
    '.terms-banner[hidden]', '.terms-banner__link[hidden]',
  ]) {
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

/* ------------------------- per-document revisions (#521) -------------------- */

/*
 * The three "Stand" dates were ONE shared `REVISION` until #521. The split is
 * load-bearing rather than tidiness: `TERMS_REVISION` is what the in-app change
 * notice keys off, so under a shared constant a typo fix in the Impressum would
 * tell every user the *terms* had changed — training people to dismiss the one
 * channel Nutzungsbedingungen §11 has.
 *
 * All three hold the same date today, which makes the obvious assertion
 * ("the page shows 2026-07-29") VACUOUS — it passes just as well against a
 * single shared constant, i.e. against exactly the regression it exists to
 * catch. So these specs load a PATCHED copy of lib/legal.js with one constant
 * moved on and assert that only that document's date follows. lib/legal.js
 * requires nothing, so a standalone copy of its source runs fine in a sandbox.
 */
function loadLegalWith(overrides, rawOverrides) {
  let src = fs.readFileSync(path.join(REPO, 'lib/legal.js'), 'utf8');
  for (const [name, value] of Object.entries(overrides)) {
    const decl = new RegExp(`const ${name} = '[^']*';`);
    // Confirm the patch actually LANDED before trusting anything it proves —
    // a regex that silently matched nothing would make every assertion below
    // pass against unmodified source (.claude/rules/noindex-vs-disallow-…).
    assert.match(src, decl, `patch target ${name} not found in lib/legal.js`);
    src = src.replace(decl, `const ${name} = '${value}';`);
  }
  // Non-string declarations (TERMS_CHANGELOG is an array literal spanning
  // lines), replaced as a raw expression up to the closing `];`.
  for (const [name, expr] of Object.entries(rawOverrides || {})) {
    const decl = new RegExp(`const ${name} = \\[[\\s\\S]*?\\n\\];`);
    assert.match(src, decl, `patch target ${name} not found in lib/legal.js`);
    src = src.replace(decl, `const ${name} = ${expr};`);
  }
  const sandbox = { module: { exports: {} }, process, require, console };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(src, sandbox, { filename: 'legal.patched.js' });
  return sandbox.module.exports;
}

const standOf = (html) => (html.match(/Stand: ([\d-]+)/) || [])[1];

test('#521: each document renders its OWN revision constant', () => {
  Object.assign(process.env, IDENTITY);
  const BUMPED = '2099-01-01';

  // Baseline: unpatched, all three agree, so a mistake here is invisible.
  const base = loadLegalWith({});
  assert.equal(standOf(base.renderImpressum()), legal.IMPRESSUM_REVISION);
  assert.equal(standOf(base.renderDatenschutz()), legal.PRIVACY_REVISION);
  assert.equal(standOf(base.renderNutzungsbedingungen()), legal.TERMS_REVISION);

  // Move ONE constant at a time; only its own document may follow.
  const cases = [
    ['IMPRESSUM_REVISION', 'renderImpressum'],
    ['PRIVACY_REVISION', 'renderDatenschutz'],
    ['TERMS_REVISION', 'renderNutzungsbedingungen'],
  ];
  for (const [constant, renderer] of cases) {
    const patched = loadLegalWith({ [constant]: BUMPED });
    for (const [, other] of cases) {
      const stand = standOf(patched[other]());
      if (other === renderer) {
        assert.equal(stand, BUMPED, `${constant} must move ${other}`);
      } else {
        assert.notEqual(stand, BUMPED,
          `${constant} must NOT move ${other} — the constants are shared again`);
      }
    }
  }
});

test('#521: only a TERMS bump raises the change notice', () => {
  const legacyUser = {};                                   // predates #521
  const currentUser = { acceptedTermsRevision: legal.TERMS_REVISION };

  // Mirrors what setupTermsBanner (public/js/account.js) does with the two
  // fields /me hands it — the comparison lives on the CLIENT, so there is no
  // server-side predicate to call here.
  const behind = (mod, user) => {
    const { acceptedTermsRevision, termsRevision } = mod.termsAcceptanceOf(user);
    return acceptedTermsRevision !== termsRevision;
  };

  // Nothing changed: neither account is behind.
  assert.equal(behind(legal, legacyUser), false);
  assert.equal(behind(legal, currentUser), false);

  // The assertion that proves the split is real rather than cosmetic: bumping
  // either of the OTHER two documents must leave the notice silent.
  for (const constant of ['IMPRESSUM_REVISION', 'PRIVACY_REVISION']) {
    const patched = loadLegalWith({ [constant]: '2099-01-01' });
    assert.equal(behind(patched, legacyUser), false,
      `${constant} must not raise the terms notice`);
    assert.equal(behind(patched, currentUser), false,
      `${constant} must not raise the terms notice`);
  }

  // A terms bump raises it for BOTH — including the legacy account, which is
  // the whole point of LEGACY_TERMS_REVISION being frozen: were the fallback
  // `|| TERMS_REVISION`, an account with the key absent would stay silent here.
  const bumped = loadLegalWith({ TERMS_REVISION: '2099-01-01' });
  assert.equal(behind(bumped, legacyUser), true);
  assert.equal(behind(bumped, currentUser), true);
  assert.equal(bumped.termsAcceptanceOf(legacyUser).acceptedTermsRevision,
    legal.LEGACY_TERMS_REVISION, 'an absent key resolves to the frozen rollout revision');
});

/* --------------------- the terms change history (#521) --------------------- */

/*
 * The notice tells a user the terms changed; this section is what tells them
 * WHAT changed. Handing someone 1000 unchanged lines is not informing them, and
 * the notice's link says „Änderungen ansehen" — so the anchor it points at has
 * to exist and has to hold a summary of the current revision.
 *
 * The section is informational and NOT part of the contract: a summary that read
 * as normative could contradict the clause it describes, and § 305c Abs. 2 BGB
 * construes that ambiguity against us.
 */

// The changelog's own shape rules, checked against whatever ships today.
test('#521: every changelog entry is complete, bilingual and correctly ordered', () => {
  const log = legal.TERMS_CHANGELOG;
  assert.ok(Array.isArray(log));
  for (const e of log) {
    assert.match(e.revision, /^\d{4}-\d{2}-\d{2}$/, 'each entry names an ISO date');
    for (const lang of ['de', 'en']) {
      assert.equal(typeof e[lang], 'string', `entry ${e.revision} needs a ${lang} summary`);
      assert.ok(e[lang].trim().length > 0, `entry ${e.revision}: ${lang} summary is empty`);
    }
    assert.ok(e.revision <= legal.TERMS_REVISION,
      `entry ${e.revision} is newer than TERMS_REVISION — a summary of an unpublished version`);
  }
  // Newest first: the section is read top-down and the render does not sort.
  const revisions = log.map((e) => e.revision);
  assert.deepEqual(revisions, [...revisions].sort().reverse(), 'entries must be newest-first');
});

// THE invariant, as one function so the real module and the patched ones are
// judged by identical logic — a hand-inlined copy per case is how a guard comes
// to pass for the shipped state and miss the state it exists for.
function documentedTermsChange(mod) {
  if (mod.TERMS_REVISION === mod.LEGACY_TERMS_REVISION) return; // never changed yet
  assert.ok(mod.TERMS_CHANGELOG.length > 0,
    'the terms have changed, so the change history must not be empty');
  assert.equal(mod.TERMS_CHANGELOG[0].revision, mod.TERMS_REVISION,
    'the newest change-history entry must describe the current revision');
}

test('#521: bumping TERMS_REVISION without saying what changed fails', () => {
  // Holds today, vacuously: the terms have not changed since the notice shipped,
  // so TERMS_REVISION is still the rollout value and an empty history is honest.
  documentedTermsChange(legal);

  // Because today only exercises the vacuous branch, drive the real one through
  // patched modules — otherwise this proves nothing until the first terms
  // change, which is precisely when it is needed.
  assert.throws(
    () => documentedTermsChange(loadLegalWith({ TERMS_REVISION: '2099-01-01' })),
    /change history must not be empty/,
    'a bump with no entry at all must fail',
  );

  assert.throws(
    () => documentedTermsChange(loadLegalWith(
      { TERMS_REVISION: '2099-01-01' },
      { TERMS_CHANGELOG: "[{ revision: '2026-08-01', de: 'Alt.', en: 'Old.' }]" },
    )),
    /must describe the current revision/,
    'a bump whose newest entry describes an OLDER revision must fail — the stale-entry case',
  );

  // And the correct shape passes, so the guard is not simply always-throwing.
  documentedTermsChange(loadLegalWith(
    { TERMS_REVISION: '2099-01-01' },
    { TERMS_CHANGELOG: "[{ revision: '2099-01-01', de: 'DE-Zusammenfassung.', en: 'EN summary.' }]" },
  ));
});

test('#521: the change history renders only when it has entries, and disclaims itself', () => {
  Object.assign(process.env, IDENTITY);

  // Empty (today): no heading, no anchor — a heading over an empty list reads as
  // a broken page, and the notice cannot fire before the first entry exists.
  const empty = loadLegalWith({}).renderNutzungsbedingungen();
  assert.ok(!empty.includes('Änderungshistorie'), 'no heading while there is nothing to show');
  assert.ok(!empty.includes('id="aenderungen"'), 'no anchor while there is nothing to show');

  const withLog = loadLegalWith({}, {
    TERMS_CHANGELOG: "[{ revision: '2026-08-01', de: 'Haftung präzisiert.', en: 'Liability clarified.' }]",
  }).renderNutzungsbedingungen();

  // The anchor the in-app notice links to (/nutzungsbedingungen#aenderungen).
  // Without it the notice's „Änderungen ansehen" lands at the top of the
  // document — the label promising a diff and delivering the whole text.
  assert.ok(withLog.includes('id="aenderungen"'), 'the notice link target must exist');
  assert.ok(withLog.includes('Änderungshistorie'));
  assert.ok(withLog.includes('Haftung präzisiert.'), 'the DE summary renders in the DE section');
  assert.ok(withLog.includes('Liability clarified.'), 'the EN summary renders in the EN section');
  assert.ok(withLog.includes('2026-08-01'), 'each entry names its revision');

  // Informational, not contractual — in BOTH languages. Without this the summary
  // sits ambiguously beside the clauses it describes (§ 305c Abs. 2 BGB).
  assert.ok(withLog.includes('nicht Vertragsbestandteil'), 'DE disclaimer');
  assert.ok(withLog.includes('not part of the contract'), 'EN disclaimer');
});

test('#521: a changelog summary is escaped, like every other interpolated value', () => {
  Object.assign(process.env, IDENTITY);
  const html = loadLegalWith({}, {
    TERMS_CHANGELOG: "[{ revision: '2026-08-01', de: '<script>x</script> & \"q\"', en: 'plain' }]",
  }).renderNutzungsbedingungen();
  assert.ok(!html.includes('<script>x</script>'), 'summary text must not inject markup');
  assert.ok(html.includes('&lt;script&gt;'), 'it is escaped instead');
});
