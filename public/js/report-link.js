/* Spielwirbel – the Freundeskreis feed's report link (issue #559).

   The feed is the app's only surface where one user sees another user's free
   text (a friend's game title), so it is the one screen where a DSA Art. 16(1)
   notice mechanism has to be reachable *in context* rather than via the footer.
   This builds the deep link into the existing public contact form — no new
   endpoint, no new notice shape: the report lands in the same operator mailbox
   and the same Meldungen inbox as a footer-form report.

   Its own small file, not an export from views-friends.js, because requiring a
   DOM view file into the coverage report sinks coverage:ci
   (.claude/rules/frontend-helper-modules-and-coverage.md). Part of the shared
   frontend scope; loaded before core.js, which calls setContactAvailable. */

'use strict';

// Both caps mirror contactSchema (lib/routes/contact.js). They are load-bearing
// rather than cosmetic: an over-long value 400s the WHOLE notice, so a long game
// title would otherwise produce a button whose form can never be submitted. We
// truncate instead — a clipped subject still reaches the operator, and a
// near-miss handle is explicitly tolerated by the schema's own reasoning.
const REPORT_SUBJECT_MAX = 200;
const REPORT_USERNAME_MAX = 60;

// Set from initFooter's /api/config probe (core.js), the same all-or-nothing
// gate that reveals the footer links and the feedback button. Starts false so a
// probe that never answers leaves no button pointing at an unreachable page.
let contactAvailable = false;

function setContactAvailable(flag) {
  contactAvailable = !!flag;
}

// Cut to `max` characters with a visible ellipsis, so the reporter can see the
// subject was clipped and edit it before sending.
function clip(value, max) {
  return value.length <= max ? value : value.slice(0, max - 1) + '…';
}

// The /kontakt.html URL for reporting one feed item, or null when no button
// should be rendered at all: the contact channel is unconfigured, or the event
// names no account (a mid-erasure event renders friends.unknownUser — reporting
// nobody is worse than offering nothing).
//
// Deliberately no `url` parameter: a feed item has no URL of its own, and
// filling "Gemeldete URL" with /freunde would name the reporter's own screen.
// `category=other` reveals the form's Art. 16(2) fields, which is what makes
// this a notice rather than an ordinary message.
function feedReportUrl(opts) {
  if (!contactAvailable) return null;
  const username = String((opts && opts.username) || '').trim();
  if (!username) return null;

  const params = new URLSearchParams({
    category: 'other',
    reportedUsername: clip(username, REPORT_USERNAME_MAX),
  });
  const subject = String((opts && opts.subject) || '').trim();
  if (subject) params.set('subject', clip(subject, REPORT_SUBJECT_MAX));
  return '/kontakt.html?' + params.toString();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { feedReportUrl, setContactAvailable, REPORT_SUBJECT_MAX, REPORT_USERNAME_MAX };
}
