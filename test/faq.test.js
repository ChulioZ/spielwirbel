'use strict';

/*
 * The FAQ page (issue #489): GET /faq, server-rendered, DE authoritative + EN
 * courtesy translation in one script-free document.
 *
 * The interesting half of this suite is the HONESTY gate. Several answers are
 * true of the operator's instance and false of a self-hosted one — donations
 * exist only with DONATE_URL set, the hosting answer only means something where
 * the privacy policy it points at is actually served, and the account answers
 * describe accounts mode. A standalone page would have to hide those with JS
 * from /api/config, which a crawler and a JS-off visitor never run; rendering on
 * the server instead means the untrue sentence is never in the bytes at all.
 * So every gated block is asserted BOTH ways — present when its precondition
 * holds, absent when it does not.
 *
 * The page itself is deliberately NOT gated: unlike /impressum it carries no
 * legal precondition, so it answers 200 on any instance and simply drops the
 * answers that instance cannot make.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const request = require('supertest');

const { app } = require('./helpers');
const faq = require('../lib/faq');
const { SUPPORTED_LOCALES } = require('../public/js/locales');

// The lang tables are browser scripts registering into a global I18N, so they
// load in a vm sandbox — the same shape test/i18n-parity.test.js uses.
function loadLocale(name) {
  const file = path.join(__dirname, '..', 'public', 'js', 'lang', `${name}.js`);
  const context = { I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.I18N[name];
}

const IDENTITY = {
  IMPRESSUM_ADDRESS: 'Musterweg 1\\n12345 Musterstadt',
  IMPRESSUM_EMAIL: 'kontakt@example.test',
};

test.afterEach(() => {
  for (const k of ['IMPRESSUM_ADDRESS', 'IMPRESSUM_EMAIL', 'DONATE_URL',
    'ACCOUNTS_ENABLED', 'SESSION_SECRET']) {
    delete process.env[k];
  }
});

test('GET /faq answers 200 HTML on a bare, unconfigured instance', async () => {
  const res = await request(app).get('/faq');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.text.includes('<html'), 'a real document, not the SPA 404 path');
});

test('both languages render, German authoritative', async () => {
  const res = await request(app).get('/faq');
  assert.ok(res.text.includes('Häufige Fragen'), 'German heading');
  assert.ok(res.text.includes('Frequently asked questions'), 'English heading');
  assert.ok(
    res.text.indexOf('Häufige Fragen') < res.text.indexOf('Frequently asked questions'),
    'German comes first — it is the authoritative text',
  );
});

test('it is script-free — a page that must render with HTML alone', async () => {
  const res = await request(app).get('/faq');
  assert.ok(!/<script/i.test(res.text), 'no script tag');
});

test('every id in the document is unique', async () => {
  // Both language halves render the SAME question list into one document, so
  // every section id was emitted twice until the -en suffix. Invalid HTML, and
  // it makes an anchor like #faq-app ambiguous. Found in a browser probe, not by
  // any assertion here — hence this one.
  const res = await request(app).get('/faq');
  const ids = [...res.text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 6, `expected the page to carry ids, got ${ids.length}`);
  assert.deepEqual(
    ids.filter((id, i) => ids.indexOf(id) !== i), [],
    'duplicate id(s) in the rendered page',
  );
});

test('every question is answered in BOTH languages', () => {
  // The parity that actually matters: a question answered only in German is an
  // English reader hitting a gap, and nothing else in the suite would see it.
  const de = faq.QUESTIONS.map((q) => q.de.q);
  const en = faq.QUESTIONS.map((q) => q.en.q);
  assert.ok(de.length >= 6, `expected the issue's question set, got ${de.length}`);
  assert.equal(de.filter(Boolean).length, de.length, 'every entry has a German question');
  assert.equal(en.filter(Boolean).length, en.length, 'every entry has an English question');
  for (const q of faq.QUESTIONS) {
    assert.ok(q.de.a.trim(), `no German answer for ${q.id}`);
    assert.ok(q.en.a.trim(), `no English answer for ${q.id}`);
  }
});

test('the repo URL matches the landing page\'s source chip', () => {
  // lib/faq.js cannot require LANDING_REPO_URL: public/js/views-landing.js is a
  // shared-global SPA script with no module.exports, so the require-the-shared-
  // file shape .claude/rules/shared-constants-across-the-stack.md prefers is not
  // available. This parity assertion is what licenses the second spelling —
  // change one and it names both (the TAG_ICONS shape).
  const landing = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'views-landing.js'), 'utf8',
  );
  /* Matched as the UNIQUE declaration, not the first one: a commented-out copy
     above the live line would otherwise be what this pins
     (`.claude/rules/css-text-assertions-strip-comments.md`, in JS). Stripping
     comments — the remedy that rule prescribes for CSS — is the wrong tool
     here, because the value itself contains `//` and a naive line-comment strip
     would eat the URL out of the very declaration being read. */
  const found = [...landing.matchAll(/const LANDING_REPO_URL = '([^']+)'/g)];
  assert.equal(found.length, 1,
    `views-landing.js declares LANDING_REPO_URL ${found.length} times, expected exactly 1 `
    + '— did it move, get renamed, or gain a commented-out copy?');
  assert.equal(faq.REPO_URL, found[0][1]);
});

test('user-facing copy says "device", never a specific kind of device', async () => {
  // Operator decision: a round runs from ONE device, and a computer is as valid
  // as a phone or a tablet — the PWA installs on a desktop too. Naming one kind
  // quietly tells everyone else the app is not for them. Covers the FAQ and both
  // lang tables, because the wording regressed in two places at once (the FAQ's
  // "Handy oder Tablet" and the landing page's "Aufs Handy installieren").
  const banned = /\b(Handy|Handys|Smartphones?|Tablets?|phones?)\b/i;

  // Scan QUESTIONS, not the SERVED page: most answers are gated, and the shared
  // test app runs accounts-off + legal-unconfigured, so a request renders only
  // three of the eight. Asserting over the response passed happily with
  // "Handy oder Tablet" sitting in the gated accounts answer — verified by
  // reinstating exactly that and watching this test stay green.
  const offending = [];
  for (const q of faq.QUESTIONS) {
    for (const lang of ['de', 'en']) {
      for (const field of ['q', 'a']) {
        if (banned.test(q[lang][field])) offending.push(`${q.id}.${lang}.${field}`);
      }
    }
  }
  assert.deepEqual(offending, [], 'these FAQ answers name a specific device kind');

  for (const locale of SUPPORTED_LOCALES) {
    const dict = loadLocale(locale);
    const offenders = Object.entries(dict)
      .filter(([, v]) => typeof v === 'string' && banned.test(v))
      .map(([k, v]) => `${locale}:${k} = ${v}`);
    assert.deepEqual(offenders, [], 'say "Gerät"/"device" instead');
  }
});

test('the donations answer leads with what donations do NOT buy', async () => {
  // The "why" paragraph (what the money and time go into) is allowed; it must
  // never displace the unconditional statement. If a future edit puts the appeal
  // first, the answer starts reading as a pitch — see lib/faq.js's content rules.
  process.env.DONATE_URL = 'https://ko-fi.com/example';
  const html = (await request(app).get('/faq')).text;
  const section = faqSection(html, 'donations');
  assert.ok(section, 'the donations answer should render with DONATE_URL set');
  assert.ok(
    section.indexOf('schalten <strong>nichts</strong> frei') < section.indexOf('Wohin es geht'),
    'the "unlocks nothing" sentence must come before the "where it goes" one',
  );
  // Nothing may suggest the service is at risk without money, which is the line
  // between explaining costs and manufacturing pressure.
  assert.doesNotMatch(section, /angewiesen|ohne (Spenden|deine Hilfe)|depends on donations|keep the lights/i);
});

/* ---------------------------- the honesty gates ---------------------------- */

test('the donations answer appears only where DONATE_URL is set', async () => {
  const off = await request(app).get('/faq');
  assert.ok(!/Spende|donation/i.test(off.text), 'no donation claim on an instance without one');

  process.env.DONATE_URL = 'https://ko-fi.com/example';
  const on = await request(app).get('/faq');
  assert.ok(/Spende/.test(on.text), 'German donation answer');
  assert.ok(/donation/i.test(on.text), 'English donation answer');
});

test('the hosting answer and every legal link appear only once legal is configured', async () => {
  const off = await request(app).get('/faq');
  // Those routes 404 while unconfigured, so linking them would hand a visitor a
  // dead end — and the hosting sentence describes the operator's instance.
  assert.ok(!off.text.includes('/datenschutz'), 'no link to a 404ing policy');
  assert.ok(!off.text.includes('/impressum'), 'no link to a 404ing Impressum');
  assert.ok(!off.text.includes('/kontakt.html'), 'no link to a hidden contact form');

  Object.assign(process.env, IDENTITY);
  const on = await request(app).get('/faq');
  assert.ok(on.text.includes('/datenschutz'), 'links the policy once it is served');
  assert.ok(on.text.includes('/kontakt.html'), 'links the contact form once it is served');
});

test('the FAQ never paraphrases the privacy policy — it links it', async () => {
  Object.assign(process.env, IDENTITY);
  const res = await request(app).get('/faq');
  // Restating a processing description in different words is what
  // .claude/rules/keep-legal-docs-current.md guards against: a second, drifting
  // copy of the same statement. The data answers must point at the real one.
  for (const marker of ['Rechtsgrundlage', 'Art. 6', 'Auftragsverarbeit']) {
    assert.ok(!res.text.includes(marker), `${marker} belongs in the policy, not the FAQ`);
  }
});

test('the account answers follow whether accounts are on', async () => {
  const off = await request(app).get('/faq');
  assert.ok(!/Konto|account/i.test(faqSection(off.text, 'accounts')), 'no account answer with accounts off');

  // Both halves, because accountsEnabled() is ACCOUNTS_ENABLED *and* a signing
  // secret — a half-configured instance is not in accounts mode, and gating on
  // the bare env flag would answer for a mode it is not actually in.
  process.env.ACCOUNTS_ENABLED = 'true';
  process.env.SESSION_SECRET = 'faq-test-secret';
  const on = await request(app).get('/faq');
  assert.ok(/Konto/.test(faqSection(on.text, 'accounts')), 'account answer once accounts are on');
});

// The rendered block for one question id, or '' when it was gated away.
function faqSection(html, id) {
  const m = new RegExp(`<section id="faq-${id}"[\\s\\S]*?</section>`, 'g').exec(html);
  return m ? m[0] : '';
}
