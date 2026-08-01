'use strict';

/*
 * The Freundeskreis feed's in-context report control (issue #559) — the parts
 * the report-link unit tests cannot reach: that the URL the builder emits is
 * actually accepted by POST /api/contact (the caps are real, and a long game
 * title must not produce an unsubmittable form), that the flag glyph is
 * declared, and that the two ends of the deep link still agree.
 *
 * The view itself is exercised through the jsdom harness (#602): renderFeedEvent
 * is RUN and the produced nodes are asserted, rather than its source text being
 * matched. The harness loads it via `vm` and never `require`s it — a view file
 * in the coverage report sinks coverage:ci
 * (.claude/rules/frontend-helper-modules-and-coverage.md). The contact page,
 * the icon codepoint and the lang tables stay source-matched: a DOM cannot see
 * any of the three.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { app } = require('./helpers');
const repo = require('../lib/repo');
const { feedReportUrl, setContactAvailable } = require('../public/js/report-link');
const { loadApp } = require('./support/dom');

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

/* ---------------------- the rendered control (#602) -------------------------

   Everything below used to be four regexes over views-friends.js, and the
   behaviour they stood in for — that a click opens the right URL, that the gate
   suppresses the button, that a username-less event renders no control — was
   verified by hand in a browser and guarded by CI not at all. The view is now
   RUN: renderFeedEvent produces real nodes and the assertions read them. */

const EVENT = {
  type: 'session_played',
  username: 'ada',
  title: 'Cascadia',
  at: '2026-08-01T18:00:00Z',
  coverUrl: null,
};

// One booted frontend shell per test, torn down with it.
function feed(t, { contact = true, locale = 'de' } = {}) {
  const dom = loadApp({ locale });
  t.after(() => dom.close());
  dom.run(`setContactAvailable(${contact ? 'true' : 'false'})`);
  return dom;
}

const reportBtn = (item) => item.querySelector('.feed-item__report');

test('a feed item renders the report button, labelled on the control itself', (t) => {
  const dom = feed(t);
  const item = dom.call('renderFeedEvent', EVENT);
  const btn = reportBtn(item);

  assert.ok(btn, 'no report button was rendered');
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.getAttribute('type'), 'button');
  /* The label has to sit on the <button>, not on the <i> inside it: an
     aria-label on a decorative icon names nothing a screen reader can activate,
     and it renders identically. The icon must stay aria-hidden for the same
     reason — otherwise the control is announced twice. */
  assert.equal(btn.getAttribute('aria-label'), 'Diesen Eintrag melden');
  assert.equal(btn.querySelector('.ti-flag').getAttribute('aria-hidden'), 'true');
  assert.equal(btn.querySelector('.ti-flag').getAttribute('aria-label'), null);
});

test('clicking it opens the built report URL in a new tab, with noopener', (t) => {
  const dom = feed(t);
  const opened = [];
  dom.window.open = (...args) => opened.push(args);

  reportBtn(dom.call('renderFeedEvent', EVENT)).click();

  assert.equal(opened.length, 1, 'the click did not open anything — the listener is not wired');
  const [url, target, features] = opened[0];
  assert.match(url, /^\/kontakt\.html\?/);
  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('category'), 'other', 'without category=other the form hides its Art. 16(2) fields');
  assert.equal(params.get('reportedUsername'), 'ada');
  assert.match(params.get('subject'), /ada/);
  assert.match(params.get('subject'), /Cascadia/);
  // #390: the SPA stays loaded behind the contact page, and noopener stops the
  // opened page reaching back through window.opener.
  assert.equal(target, '_blank');
  assert.equal(features, 'noopener');
});

test('the button is absent when the contact channel is unconfigured', (t) => {
  // The gate's whole job: no button pointing at a page that cannot take a
  // report. Absent, not disabled — a disabled control still promises a channel.
  const dom = feed(t, { contact: false });
  const item = dom.call('renderFeedEvent', EVENT);
  assert.equal(reportBtn(item), null, 'the gate is closed and the button rendered anyway');
  // Anti-vacuous: the item itself must still render, or this passes against a
  // view that produces nothing at all.
  assert.match(item.querySelector('.feed-item__text').textContent, /Cascadia/);
});

test('an event naming no account renders no button — reporting nobody is worse', (t) => {
  // A mid-erasure event renders friends.unknownUser; there is no handle to
  // report, so the control must not appear even though the gate is open.
  const dom = feed(t);
  const item = dom.call('renderFeedEvent', { ...EVENT, username: null });
  assert.equal(reportBtn(item), null, 'a username-less event still offered a report button');
  assert.match(item.querySelector('.feed-item__text').textContent, /Unbekannt|Cascadia/);
});

test('the subject reaches the form unescaped, while the feed line is escaped', (t) => {
  /* Two different jobs for the same title, and the natural implementation gets
     one of them wrong. The feed line is injected as HTML, so `&` must arrive as
     `&amp;` there; the subject is a query-string value the reporter reads and
     edits in a plain text field, so escaping it would put a literal "&amp;" in
     their message. The old source-text guard for this could only check that
     `esc(` did not appear near the subject — it could not see either result. */
  const dom = feed(t);
  const opened = [];
  dom.window.open = (...args) => opened.push(args);
  const title = 'Fish & Chips <b>';

  const item = dom.call('renderFeedEvent', { ...EVENT, title });
  // textContent decodes entities back, so read the markup to see the escaping.
  assert.match(item.querySelector('.feed-item__text').innerHTML, /Fish &amp; Chips &lt;b&gt;/);
  assert.equal(item.querySelector('.feed-item__text b'), null, 'the title was injected as live markup');

  reportBtn(item).click();
  const subject = new URLSearchParams(opened[0][0].split('?')[1]).get('subject');
  assert.match(subject, /Fish & Chips <b>/, `the subject was HTML-escaped on its way to the form: ${subject}`);
});

test('the report control is localized with the rest of the item', (t) => {
  const dom = feed(t, { locale: 'en' });
  const btn = reportBtn(dom.call('renderFeedEvent', EVENT));
  assert.equal(btn.getAttribute('aria-label'), 'Report this entry');
  assert.equal(btn.getAttribute('title'), 'Report this entry');
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
