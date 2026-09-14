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
const { SUPPORTED_LOCALES, localeTag } = require('../public/js/locales');

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

test('ONE language per page, chosen by ?lang, then Accept-Language, then German', async () => {
  /* It rendered a German half above an English one in one document until #1088.
     That shape does not survive nine locales — stacking them all would put eight
     screens of other people's languages above the reader's own — so the page
     renders exactly one and links the rest. */
  const de = await request(app).get('/faq');
  assert.ok(de.text.includes('Häufige Fragen'), 'German is the default');
  assert.ok(!de.text.includes('Frequently asked questions'), 'the English half is still stacked below');

  const en = await request(app).get('/faq?lang=en');
  assert.ok(en.text.includes('Frequently asked questions'));
  assert.ok(!en.text.includes('Häufige Fragen'), 'two languages in one document');

  // Every shipped locale renders its own page, with its own <html lang>.
  for (const code of SUPPORTED_LOCALES) {
    const res = await request(app).get(`/faq?lang=${code}`);
    assert.equal(res.status, 200, `?lang=${code} did not render`);
    assert.equal(res.text.match(/<html lang="([^"]+)"/)[1], localeTag(code));
  }
});

test('an unknown ?lang is ignored, and Accept-Language decides when there is none', async () => {
  /* An ALLOWLIST, never a passthrough: `?lang=` is attacker-controlled and lands
     in <html lang> and in the canonical URL.

     TWO layers refuse it — the route's `SUPPORTED_LOCALES.includes` and
     renderFaq's own `CHROME[lang] ? lang : 'de'` — so this asserts the OUTCOME
     and each layer masks the other when broken alone. Measured: breaking either
     one leaves the suite green, and breaking BOTH reddens this test by name.
     That is defence in depth working, not a vacuous assertion — but do not read
     a green run as evidence that either guard individually still exists. */
  const bogus = await request(app).get('/faq?lang=xx');
  assert.ok(bogus.text.includes('Häufige Fragen'), 'an unknown code did not fall back to German');
  assert.ok(!/xx/.test(bogus.text.match(/<html lang="([^"]+)"/)[1]), 'the code was reflected into <html lang>');

  const ko = await request(app).get('/faq').set('Accept-Language', 'ko');
  assert.equal(ko.text.match(/<html lang="([^"]+)"/)[1], localeTag('ko'));
  // A header-decided response must not be served from a shared cache to the next
  // visitor; an explicit ?lang= is already in the URL and varies by nothing.
  assert.match(String(ko.headers.vary || ''), /Accept-Language/i);
  assert.doesNotMatch(String((await request(app).get('/faq?lang=ko')).headers.vary || ''), /Accept-Language/i);

  const none = await request(app).get('/faq').set('Accept-Language', 'zz');
  assert.ok(none.text.includes('Häufige Fragen'), 'no match did not fall back to German');
});

test('the language row links every OTHER language, and the ids are the same set', async () => {
  const it = await request(app).get('/faq?lang=it');
  const row = it.text.match(/<nav class="langs"[\s\S]*?<\/nav>/)[0];
  for (const code of SUPPORTED_LOCALES) {
    if (code === 'it') {
      assert.ok(!row.includes(`?lang=${code}"`), 'the current language links to itself');
    } else {
      assert.ok(row.includes(`href="/faq?lang=${code}"`), `no link to ${code}`);
    }
  }
  // The `-en` suffix is gone, so #faq-app is linkable from any language — which
  // only holds if every page emits the SAME id set.
  const idsOf = (html) => [...html.matchAll(/<section id="(faq-[^"]+)"/g)].map((m) => m[1]).sort();
  const base = idsOf((await request(app).get('/faq')).text);
  // Five, not ten: the default test instance has no DONATE_URL, no accounts and
  // no legal identity, so five of the ten answers are gated away — and the page
  // no longer renders each one twice.
  assert.ok(base.length >= 4, `expected the ungated question set, got ${base.length}`);
  for (const code of SUPPORTED_LOCALES) {
    assert.deepEqual(idsOf((await request(app).get(`/faq?lang=${code}`)).text), base,
      `${code} renders a different id set, so an anchor is not portable`);
  }
});

test('it is script-free — a page that must render with HTML alone', async () => {
  const res = await request(app).get('/faq');
  assert.ok(!/<script/i.test(res.text), 'no script tag');
});

test('every id in the document is unique', async () => {
  /* It used to render the same question list TWICE in one document, so every
     section id was emitted twice until the `-en` suffix — invalid HTML, and it
     made an anchor like #faq-app ambiguous. With one language per page the
     suffix is gone and this is nearly trivial, which is why it now runs over
     EVERY language rather than only the default: the thing that could
     reintroduce a duplicate is a chrome element sharing an id with a section. */
  for (const code of SUPPORTED_LOCALES) {
    const page = await request(app).get(`/faq?lang=${code}`);
    const all = [...page.text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(all.filter((id, i) => all.indexOf(id) !== i), [], `duplicate id(s) in ${code}`);
  }
  const res = await request(app).get('/faq');
  const ids = [...res.text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  // The floor dropped with the second half of the document: the ungated instance
  // answers five questions, which used to be ten ids because each was emitted
  // in both languages.
  assert.ok(ids.length >= 4, `expected the page to carry ids, got ${ids.length}`);
  assert.deepEqual(
    ids.filter((id, i) => ids.indexOf(id) !== i), [],
    'duplicate id(s) in the rendered page',
  );
});

test('every question is answered in EVERY shipped locale', () => {
  /* The parity that actually matters: a question answered only in German is a
     reader hitting a gap, and nothing else in the suite would see it. The set is
     DERIVED from public/js/locales.js, never listed here — a tenth language must
     not be able to ship a page that falls back
     (.claude/rules/locale-set-is-data.md). */
  assert.ok(faq.QUESTIONS.length >= 6, `expected the issue's question set, got ${faq.QUESTIONS.length}`);
  assert.ok(SUPPORTED_LOCALES.length >= 2, 'locales.js yielded fewer than two languages');
  for (const q of faq.QUESTIONS) {
    for (const code of SUPPORTED_LOCALES) {
      assert.ok(q[code], `${q.id} has no "${code}" block`);
      assert.ok(String(q[code].q || '').trim(), `no ${code} question for ${q.id}`);
      assert.ok(String(q[code].a || '').trim(), `no ${code} answer for ${q.id}`);
    }
    // A typo'd code (`kr:` for `ko:`) satisfies nothing and breaks nothing — the
    // page just falls back — so an unknown key has to be a failure.
    for (const key of Object.keys(q)) {
      assert.ok(key === 'id' || key === 'gate' || SUPPORTED_LOCALES.includes(key),
        `${q.id} carries "${key}", which is not a shipped locale`);
    }
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
  /* PER LANGUAGE since #1088, because the ban is on the WORD and every language
     has its own (.claude/rules/source-scanning-guards-enumerate-shapes.md: the
     spelling the scan misses is invisible). Korean has no word boundaries, so it
     takes the substring shape — the same split test/session-naming.test.js
     makes. Each addition was proved red by planting the word on purpose. */
  const BANNED_BY_LOCALE = {
    de: /\b(Handy|Handys|Smartphones?|Tablets?)\b/i,
    en: /\b(phones?|smartphones?|tablets?)\b/i,
    es: /\b(m[oó]vil(es)?|tel[eé]fonos?|tabletas?)\b/i,
    fr: /\b(t[eé]l[eé]phones?|portables?|tablettes?)\b/i,
    it: /\b(telefon[oi]|cellulari?|tablets?)\b/i,
    nl: /\b(telefoons?|mobiel(tje)?s?|tablets?)\b/i,
    pt: /\b(celulares?|telefones?|tablets?)\b/i,
    fi: /\b(puhelim\w*|k[aä]nnyk\w*|tabletti\w*)\b/i,
    ko: /(휴대폰|스마트폰|핸드폰|태블릿)/,
  };

  // Scan QUESTIONS, not the SERVED page: most answers are gated, and the shared
  // test app runs accounts-off + legal-unconfigured, so a request renders only
  // three of the eight. Asserting over the response passed happily with
  // "Handy oder Tablet" sitting in the gated accounts answer — verified by
  // reinstating exactly that and watching this test stay green.
  const offending = [];
  let checked = 0;
  for (const q of faq.QUESTIONS) {
    for (const lang of SUPPORTED_LOCALES) {
      const rx = BANNED_BY_LOCALE[lang];
      assert.ok(rx, `no banned-word pattern for "${lang}" — a locale nobody scans passes in silence`);
      for (const field of ['q', 'a']) {
        checked += 1;
        if (rx.test(q[lang][field])) offending.push(`${q.id}.${lang}.${field}`);
      }
    }
  }
  // Anti-vacuous, and DERIVED: a lookup that stopped finding blocks would report
  // a clean sweep over nothing.
  assert.equal(checked, faq.QUESTIONS.length * SUPPORTED_LOCALES.length * 2,
    'the scan did not reach every answer in every language');
  assert.deepEqual(offending, [], 'these FAQ answers name a specific device kind');

  // The matcher's own self-test: the negatives are what prove it bans the device
  // KIND rather than any word near it.
  assert.ok(BANNED_BY_LOCALE.es.test('desde el móvil') && !BANNED_BY_LOCALE.es.test('desde el dispositivo'));
  assert.ok(BANNED_BY_LOCALE.fr.test('sur le téléphone') && !BANNED_BY_LOCALE.fr.test('sur l’appareil'));
  assert.ok(BANNED_BY_LOCALE.fi.test('omalta puhelimelta') && !BANNED_BY_LOCALE.fi.test('omalta laitteelta'));
  assert.ok(BANNED_BY_LOCALE.ko.test('휴대폰에서') && !BANNED_BY_LOCALE.ko.test('기기에서'));

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
  /* And in EVERY language, because the ordering is a content rule rather than a
     German one: a translation that leads with the appeal turns the answer into a
     pitch, and only this loop can see it (#173, #1088). The marker is the
     emphasised "nothing" each translation carries. */
  for (const code of SUPPORTED_LOCALES) {
    const page = faqSection((await request(app).get(`/faq?lang=${code}`)).text, 'donations');
    assert.ok(page, `no donations answer in ${code}`);
    const nothing = page.indexOf('<strong>');
    const firstPara = page.indexOf('<p>');
    assert.ok(nothing > -1, `${code} lost the emphasised "nothing"`);
    assert.ok(page.indexOf('</p>', firstPara) > nothing,
      `${code} moved the "unlocks nothing" statement out of the first paragraph`);
  }
  // Nothing may suggest the service is at risk without money, which is the line
  // between explaining costs and manufacturing pressure.
  assert.doesNotMatch(section, /angewiesen|ohne (Spenden|deine Hilfe)|depends on donations|keep the lights/i);
});

/* ---------------------------- the honesty gates ---------------------------- */

test('the donations answer appears only where DONATE_URL is set', async () => {
  const off = await request(app).get('/faq');
  assert.ok(!/Spende|donation/i.test(off.text), 'no donation claim on an instance without one');

  process.env.DONATE_URL = 'https://ko-fi.com/example';
  assert.ok(/Spende/.test((await request(app).get('/faq')).text), 'German donation answer');
  assert.ok(/donation/i.test((await request(app).get('/faq?lang=en')).text), 'English donation answer');
  // The gate drops the SAME question in every language, or one translation would
  // make a claim its own instance cannot honestly give.
  for (const code of SUPPORTED_LOCALES) {
    assert.ok(faqSection((await request(app).get(`/faq?lang=${code}`)).text, 'donations'),
      `${code} lost the donations answer while DONATE_URL is set`);
  }
});

test('every gate drops the same questions in every language', async () => {
  /* The half a per-language spot check cannot see. The gates are evaluated once
     per render, so a language whose block is missing would render an EMPTY
     section rather than none — and the id set assertion above would not care. */
  delete process.env.DONATE_URL;
  delete process.env.ACCOUNTS_ENABLED;
  const idsOf = async (code) => [...(await request(app).get(`/faq?lang=${code}`)).text
    .matchAll(/<section id="(faq-[^"]+)"/g)].map((m) => m[1]).join(',');
  const base = await idsOf('de');
  assert.ok(!base.includes('faq-donations'), 'the gate did not drop the donations answer');
  for (const code of SUPPORTED_LOCALES) {
    assert.equal(await idsOf(code), base, `${code} answers a different set of questions`);
  }
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

test('the reference language carries no translation note; the other eight do', async () => {
  /* German stays the text every translation is made FROM, so saying so is the
     honest minimum — but it would be nonsense on the German page itself. What
     went with the two halves is the phrase "like the legal pages": the FAQ has
     no legal weight, and borrowing that framing overstated what this page is. */
  // Matched as the RENDERED element, not as the string: `.lang-note` is also a
  // CSS selector in the inline <style>, which every page carries — so a bare
  // substring test reports the note present on all nine.
  const note = (html) => /<p class="lang-note">/.test(html);
  assert.ok(!note((await request(app).get('/faq')).text),
    'the German page tells its reader it is a translation');
  for (const code of SUPPORTED_LOCALES.filter((c) => c !== 'de')) {
    assert.ok(note((await request(app).get(`/faq?lang=${code}`)).text),
      `${code} does not say the German version is the reference`);
  }
});

// The rendered block for one question id, or '' when it was gated away.
function faqSection(html, id) {
  const m = new RegExp(`<section id="faq-${id}"[\\s\\S]*?</section>`, 'g').exec(html);
  return m ? m[0] : '';
}
