'use strict';

/*
 * The Freundeskreis feed's in-context report control (issue #559) — the parts
 * the report-link unit tests cannot reach: that the URL the builder emits is
 * actually accepted by POST /api/contact (the caps are real, and a long game
 * title must not produce an unsubmittable form), that the flag glyph is
 * declared, and that the two ends of the deep link still agree.
 *
 * The view and the contact page are DOM code no test can require — a view file
 * in the coverage report sinks coverage:ci
 * (.claude/rules/frontend-helper-modules-and-coverage.md) — so those two are
 * asserted against their source text, like test/round-settings.test.js does.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { app } = require('./helpers');
const repo = require('../lib/repo');
const { feedReportUrl, setContactAvailable } = require('../public/js/report-link');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Comments would satisfy or defeat these matches on their own
// (.claude/rules/css-text-assertions-strip-comments.md).
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

afterEach(() => { delete process.env.CONTACT_TO; });

// Everything the feed button actually sends: the builder's query string, plus
// the message and good-faith statement the reporter fills in on the form.
function submissionFor(ev) {
  setContactAvailable(true);
  const url = feedReportUrl(ev);
  assert.ok(url, 'the builder produced no URL');
  const params = new URLSearchParams(url.split('?')[1]);
  return {
    category: params.get('category'),
    reportedUsername: params.get('reportedUsername'),
    subject: params.get('subject'),
    message: 'Dieser Eintrag ist beleidigend.',
    goodFaith: true,
  };
}

const A_LONG_TITLE = 'Die Legenden von Andor '.repeat(30); // ~690 chars

test('a report built from a feed item is accepted and stored as a notice', async () => {
  process.env.CONTACT_TO = 'ops@example.com';
  const body = submissionFor({ username: 'ada', subject: `Feed-Eintrag: ada — Cascadia (1.8.2026)` });
  const res = await request(app).post('/api/contact').send(body);
  assert.equal(res.status, 200);

  const notice = (await repo.listContactNotices(1))[0];
  assert.equal(notice.category, 'other');
  assert.equal(notice.reportedUsername, 'ada');
  assert.equal(notice.goodFaith, true);
  assert.match(notice.subject, /Cascadia/);
});

test('an over-long game title still produces a SUBMITTABLE report', async () => {
  process.env.CONTACT_TO = 'ops@example.com';
  const body = submissionFor({ username: 'ada', subject: `Feed-Eintrag: ada — ${A_LONG_TITLE}` });
  const res = await request(app).post('/api/contact').send(body);
  assert.equal(res.status, 200, `a long title made the form unsubmittable: ${JSON.stringify(res.body)}`);
});

/* The control that makes the test above non-vacuous: without the builder's
   truncation the SAME report is rejected outright, so a 200 there is evidence
   the cap is doing work rather than evidence the schema is lenient. */
test('the untruncated subject is what the server rejects', async () => {
  process.env.CONTACT_TO = 'ops@example.com';
  const body = submissionFor({ username: 'ada', subject: 'x' });
  body.subject = `Feed-Eintrag: ada — ${A_LONG_TITLE}`; // as it would be without clip()
  const res = await request(app).post('/api/contact').send(body);
  assert.equal(res.status, 400, 'contactSchema no longer caps the subject — re-check report-link.js');
});

test('an over-long handle would be rejected too — the builder caps it', async () => {
  process.env.CONTACT_TO = 'ops@example.com';
  const body = submissionFor({ username: 'ada' });
  body.reportedUsername = 'u'.repeat(120);
  const res = await request(app).post('/api/contact').send(body);
  assert.equal(res.status, 400, 'contactSchema no longer caps reportedUsername — re-check report-link.js');
});

/* A `ti-*` class whose rule is missing renders NOTHING — no tofu, no console
   warning, no failing test (.claude/rules/tabler-icon-codepoints.md). 0xeaa6 is
   `flag` in THIS bundle's cmap (fontTools), not tabler.io's number; a
   wrong-but-present value would draw a plausible other icon in silence. */
test('ti-flag is declared at its cmap-verified codepoint', () => {
  const icons = stripCssComments(read('public/fonts/tabler-icons.css'));
  assert.match(icons, /\.ti-flag::before \{ content: "\\eaa6"; \}/, 'ti-flag is missing or moved off 0xeaa6');
});

test('the report button is styled — an undeclared class leaves a bare UA button', () => {
  const css = stripCssComments(read('public/styles.css'));
  assert.match(css, /\.feed-item__report \{/);
  assert.match(css, /\.feed-item__report:hover \{/);
});

test('the feed renders the button only through the gated builder', () => {
  const view = read('public/js/views-friends.js');
  assert.match(view, /feedReportUrl\(/, 'renderFeedEvent no longer builds the URL through the gate');
  assert.match(view, /if \(url\)/, 'the button is no longer conditional on a URL being available');
  assert.match(view, /ti-flag/);
  // The subject is a query-string value, not markup: escaping it here would
  // send &amp; into the reporter's text field.
  assert.doesNotMatch(view, /subject: t\('friends\.feed\.reportSubject'[\s\S]{0,80}esc\(/);
});

test('the contact page still reads the two parameters the button sends', () => {
  const page = read('public/js/pages/kontakt.js');
  assert.match(page, /params\.get\('reportedUsername'\)/, 'the deep link no longer prefills the reported account');
  assert.match(page, /params\.get\('subject'\)/, 'the deep link no longer prefills the subject');
  assert.match(page, /fields\.reportedUsername\.value = initialReported/);
  assert.match(page, /fields\.subject\.value = initialSubject/);
});

test('both languages carry the report strings, with the subject placeholders', () => {
  for (const loc of ['de', 'en']) {
    const table = read(`public/js/lang/${loc}.js`);
    assert.match(table, /'friends\.feed\.report':/, `${loc} is missing the button label`);
    const subject = table.match(/'friends\.feed\.reportSubject': '([^']+)'/);
    assert.ok(subject, `${loc} is missing the subject line`);
    for (const p of ['{user}', '{game}', '{date}']) {
      assert.ok(subject[1].includes(p), `${loc}'s subject line drops ${p}`);
    }
  }
});
