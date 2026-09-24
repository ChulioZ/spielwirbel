'use strict';

/* The two one-time feedback prompts (#1172).

   The top-bar feedback button (#321) sits where nobody has an opinion, so the
   app asks at the two moments someone does: right after a round's first session
   reaches its result, and right after an account's first BoardGameGeek
   collection import. One sentence, one button, once each — the attention budget
   `lib/legal.js` spells out for banners people learn to dismiss unread.

   Both open the same contact form the top-bar button opens, with a `source`
   (feedback-link.js) so the operator can tell which prompt produced a message.
   Tested by RUNNING it under jsdom (test/feedback-prompt.test.js) — there is no
   `module.exports` on purpose, since a Node require would pull this DOM file into
   the coverage report (.claude/rules/frontend-helper-modules-and-coverage.md). */

// Where "already asked" is remembered, per device: one JSON object mapping each
// source to the ids it was shown for — round ids for the first-session prompt,
// account ids for the import one. Named in the § 25 TDDDG inventory in
// lib/legal.js (both languages).
const FEEDBACK_ASKED_KEY = 'spielwirbel.feedbackAsked';
// Per source. Generous for one device, and only there so a list that nothing
// ever prunes cannot grow without bound; the oldest id falls off first.
const FEEDBACK_ASKED_MAX = 100;

function readFeedbackAsked() {
  try {
    const all = JSON.parse(localStorage.getItem(FEEDBACK_ASKED_KEY) || '{}');
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

// Has this device already shown `source`'s prompt for `id`? Reads false when
// storage is unavailable, so the failure mode is "asked again", never "silently
// never asked" — the same direction installOfferDismissed() fails in.
function feedbackAsked(source, id) {
  const list = readFeedbackAsked()[source];
  return Array.isArray(list) && list.includes(String(id));
}

function markFeedbackAsked(source, id) {
  const all = readFeedbackAsked();
  const key = String(id);
  const list = (Array.isArray(all[source]) ? all[source] : []).filter((x) => x !== key);
  list.push(key);
  all[source] = list.slice(-FEEDBACK_ASKED_MAX);
  try {
    localStorage.setItem(FEEDBACK_ASKED_KEY, JSON.stringify(all));
  } catch { /* storage unavailable — the prompt simply comes back next time */ }
}

// Is `session` the first of its round to reach a result? "Reached" is `done`
// (voting closed) or `finished` (marked played), on any OTHER session: at the
// reveal this one is closed but usually not yet marked played, so counting
// `finished` sessions — the obvious reading — would find zero here and one on
// the round's SECOND session, i.e. ask at exactly the wrong time.
function isFirstResultSession(round, session) {
  return !(round.sessions || []).some((s) => s.id !== session.id && (s.done || s.finished));
}

// Neither prompt is shown to a demo (the account and everything in it expires,
// and "how did your first session go" over seeded data asks about nothing the
// visitor did), nor while the contact channel is unconfigured (the button would
// open a page saying so).
function feedbackPromptAllowed() {
  return !isDemoAccount() && isContactAvailable();
}

// The card itself: one sentence and one button, plus a quiet way out. Shaped
// like the install card it stands in for (.install-offer), so the results
// screen keeps one look for its aside whichever of the two it is showing.
function feedbackCard(text, source) {
  const card = h(`<div class="feedback-offer">
       <p>${esc(text)}</p>
     </div>`);
  const actions = h('<div class="install-actions"></div>');
  const go = h(`<button class="btn btn--primary feedback-offer__cta" type="button">${iconText('ti-message', t('feedback.prompt.cta'))}</button>`);
  go.addEventListener('click', () => {
    // A new tab, like the top-bar button (#390): the SPA stays loaded behind it.
    window.open(feedbackUrl(location.pathname, source), '_blank', 'noopener');
    card.remove();
  });
  const no = h(`<button class="link-btn feedback-offer__dismiss" type="button">${esc(t('feedback.prompt.dismiss'))}</button>`);
  no.addEventListener('click', () => card.remove());
  actions.appendChild(go);
  actions.appendChild(no);
  card.appendChild(actions);
  return card;
}

/* The results-screen prompt, or null — in which case the install card
   (buildInstallOffer) takes the slot as before.

   `reveal` is the same gate on *when* the install card uses: only the "this
   session just closed here" callers pass it, so looking an old result up never
   asks. Remembered the moment it is SHOWN, not when answered: the issue is
   "once", and a card that re-appeared on every reveal until someone clicked it
   is the nagging this budget exists to avoid. */
function buildFeedbackOffer(reveal, round, session) {
  if (!reveal || !feedbackPromptAllowed()) return null;
  if (!isFirstResultSession(round, session)) return null;
  if (feedbackAsked(FEEDBACK_SOURCES.firstSession, round.id)) return null;
  markFeedbackAsked(FEEDBACK_SOURCES.firstSession, round.id);
  return feedbackCard(t('feedback.prompt.session'), FEEDBACK_SOURCES.firstSession);
}

// The import prompt, or null: once per account on this device, whichever shelf
// (owned or wishlist) that first import filled. Only called after an import that
// actually added something — asking "did it work?" over zero games is noise.
function buildImportFeedbackPrompt() {
  const uid = currentUserId();
  if (!uid || !feedbackPromptAllowed()) return null;
  if (feedbackAsked(FEEDBACK_SOURCES.import, uid)) return null;
  markFeedbackAsked(FEEDBACK_SOURCES.import, uid);
  return feedbackCard(t('feedback.prompt.import'), FEEDBACK_SOURCES.import);
}
