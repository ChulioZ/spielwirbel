'use strict';

// Unit tests for the feed report-link builder (issue #559) — the pure half of
// the in-context DSA notice entry point. The button itself is rendered by
// views-friends.js; everything worth asserting (the parameter set, the caps the
// server enforces, and the three cases that must produce NO button) lives here.

const test = require('node:test');
const assert = require('node:assert');

const {
  feedReportUrl,
  setContactAvailable,
  REPORT_SUBJECT_MAX,
  REPORT_USERNAME_MAX,
} = require('../public/js/report-link');

// The module starts unavailable and is switched on by initFooter's /api/config
// probe, so every test that wants a URL has to say so.
const available = () => setContactAvailable(true);

/* MUST be the first test in the file, and must NOT call setContactAvailable:
   it asserts the module's untouched DEFAULT. A version of this test that set
   `false` first passed happily with the default flipped to `true` — i.e. with a
   report button rendered on an instance whose contact channel is unconfigured,
   the exact state the gate exists to prevent. */
test('the gate is closed until /api/config opens it', () => {
  assert.equal(feedReportUrl({ username: 'ada', subject: 'x' }), null);
});

test('an explicit close re-hides the button', () => {
  setContactAvailable(true);
  assert.ok(feedReportUrl({ username: 'ada' }));
  setContactAvailable(false);
  assert.equal(feedReportUrl({ username: 'ada', subject: 'x' }), null);
});

test('no URL without a username — a report that names nobody is useless', () => {
  available();
  assert.equal(feedReportUrl({ username: null, subject: 'x' }), null);
  assert.equal(feedReportUrl({ username: '', subject: 'x' }), null);
  assert.equal(feedReportUrl({ username: '   ', subject: 'x' }), null);
  assert.equal(feedReportUrl({}), null);
  assert.equal(feedReportUrl(), null);
});

test('builds the contact-form URL with the report category and the reported handle', () => {
  available();
  const url = new URL(feedReportUrl({ username: 'ada', subject: 'Feed entry' }), 'https://x.test');
  assert.equal(url.pathname, '/kontakt.html');
  assert.equal(url.searchParams.get('category'), 'other');
  assert.equal(url.searchParams.get('reportedUsername'), 'ada');
  assert.equal(url.searchParams.get('subject'), 'Feed entry');
});

test('emits no url parameter — a feed item has no URL of its own', () => {
  available();
  const url = new URL(feedReportUrl({ username: 'ada', subject: 's' }), 'https://x.test');
  assert.equal(url.searchParams.get('url'), null);
});

test('encodes values that would otherwise break the query string', () => {
  available();
  const raw = feedReportUrl({ username: 'a&b=c', subject: 'Feed: „Tick & Trick" #1?' });
  // The reserved characters must not survive raw into the query.
  assert.ok(!raw.includes('&b=c'), raw);
  const url = new URL(raw, 'https://x.test');
  assert.equal(url.searchParams.get('reportedUsername'), 'a&b=c');
  assert.equal(url.searchParams.get('subject'), 'Feed: „Tick & Trick" #1?');
});

test('truncates the subject to the schema cap so the form stays submittable', () => {
  available();
  const long = 'G'.repeat(500);
  const subject = new URL(feedReportUrl({ username: 'ada', subject: long }), 'https://x.test')
    .searchParams.get('subject');
  assert.equal(subject.length, REPORT_SUBJECT_MAX);
  assert.equal(REPORT_SUBJECT_MAX, 200); // contactSchema: subject.max(200)
  assert.ok(subject.endsWith('…'), 'truncation is visible to the reporter');
});

test('a subject exactly at the cap is left alone', () => {
  available();
  const exact = 'G'.repeat(REPORT_SUBJECT_MAX);
  const subject = new URL(feedReportUrl({ username: 'ada', subject: exact }), 'https://x.test')
    .searchParams.get('subject');
  assert.equal(subject, exact);
});

test('truncates the handle to the schema cap rather than 400ing the whole notice', () => {
  available();
  const long = 'u'.repeat(120);
  const name = new URL(feedReportUrl({ username: long }), 'https://x.test')
    .searchParams.get('reportedUsername');
  assert.equal(name.length, REPORT_USERNAME_MAX);
  assert.equal(REPORT_USERNAME_MAX, 60); // contactSchema: reportedUsername.max(60)
});

test('omits an empty subject instead of sending a blank parameter', () => {
  available();
  const url = new URL(feedReportUrl({ username: 'ada' }), 'https://x.test');
  assert.equal(url.searchParams.has('subject'), false);
  assert.equal(url.searchParams.get('reportedUsername'), 'ada');
});
