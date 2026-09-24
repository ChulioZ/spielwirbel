/* Spielwirbel – where a feedback link points, and which prompt produced it.

   Its own file so the prompt `source` values are ONE list (#1172): the SPA
   offers them (feedback-prompt.js puts one on the /kontakt.html link) and
   lib/routes/contact.js requires this file to validate what arrives. A value the
   route does not know is dropped rather than 400ed, so a hand-copied server list
   that drifted would lose the one field the operator needs to tell the prompts
   apart — with no error anywhere
   (.claude/rules/shared-constants-across-the-stack.md). Dependency-free and tiny
   by design (.claude/rules/frontend-helper-modules-and-coverage.md). */

'use strict';

// The one-time prompts that can open the feedback form. The top-bar button
// sends no source at all — "unprompted" is the absence of a value.
const FEEDBACK_SOURCES = Object.freeze({
  firstSession: 'first_session',
  import: 'import',
});

// Is `value` a source the server keeps? Exact match — the values are ours, so
// there is no case or whitespace variant worth forgiving.
function isFeedbackSource(value) {
  return Object.values(FEEDBACK_SOURCES).includes(value);
}

// The /kontakt.html URL that opens the form on the Feedback category, carrying
// the SPA screen it was opened from and, for a prompt, which one. One builder
// for the top-bar button (core.js) and both prompts, so the three cannot grow
// different parameter names.
function feedbackUrl(path, source) {
  const q = new URLSearchParams({ category: 'feedback', path: String(path || '') });
  if (isFeedbackSource(source)) q.set('source', source);
  return '/kontakt.html?' + q.toString();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FEEDBACK_SOURCES, isFeedbackSource, feedbackUrl };
}
