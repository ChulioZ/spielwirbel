/* Spielwirbel – the „Was ist neu" screen (issue #741).

   A PULLED surface: the user opens it from the account menu, nudged by a small
   dot on that button and — since #842 — by one tile on the home dashboard.
   There is deliberately no banner, toast, modal or interstitial anywhere in this
   feature, because a third DISMISSABLE strip would train people to dismiss the
   Nutzungsbedingungen §11 terms notice unread, and that is the one channel which
   legally has to be seen (.claude/rules/keep-legal-docs-current.md, lib/legal.js).

   #842 narrowed that rule rather than lifting it, so the line is worth stating
   exactly. What is now PERMITTED is an in-flow, self-clearing tile: it sits in
   the dashboard region below the round grid, it carries no dismiss control, and
   it does NOT call markNewsSeen() — opening this screen is still the only
   acknowledgement, so the tile is simply absent on the next home render.

   What is still forbidden, and what the §11 reasoning actually protects: anything
   DISMISSABLE (the dismiss gesture is the habit that transfers), anything above
   the fold, and anything that interrupts — banner, toast, modal, interstitial.
   Don't "improve" discoverability past that line.

   Content comes from NEWS (public/js/news.js), a code constant that ships with
   the release it describes. Part of the shared frontend scope — loads after
   account.js/core.js and uses their helpers (accountsActive/isLoggedIn/
   markNewsSeen, h/esc/app/t, syncUrl/setContext/setDocTitle/applyBackground). */

'use strict';

async function showNews() {
  // Guarded like showHome() rather than like showAccount(): an accounts-mode
  // visitor who is not logged in goes to the front door, but on a password-only
  // or open self-hosted instance — where there are no accounts at all — the list
  // still renders. It is not secret, merely un-badgeable there, because the
  // seen-state is a per-account field and no account exists to hold it.
  if (accountsActive() && !isLoggedIn()) return showHome();
  currentView = () => showNews();
  syncUrl('/neu');
  setContext(t('news.title'));
  setDocTitle(t('news.title'));
  applyBackground(null);

  app.innerHTML = '';
  app.appendChild(h(`<div class="lobby-head"><h1>${esc(t('news.title'))}</h1></div>`));

  if (!NEWS.length) {
    // An honest empty state, not a placeholder entry. The list starts empty and
    // stays empty until something genuinely worth announcing ships.
    app.appendChild(h(`<p class="muted empty-note">${esc(t('news.empty'))}</p>`));
  } else {
    const list = h('<div class="news-list"></div>');
    for (const entry of NEWS) list.appendChild(renderNewsEntry(entry));
    app.appendChild(list);
  }

  // Opening the screen IS the acknowledgement — exactly like the terms banner's
  // dismiss button. Deliberately unconditional on the list being non-empty: with
  // nothing to show the call is a no-op (see markNewsSeen), so this needs no
  // second copy of the "is there anything unseen?" question.
  markNewsSeen();
}

// One entry. The revision doubles as its date — it is a plain ISO day, which is
// what makes that free rather than a second field to keep in step.
function renderNewsEntry(entry) {
  const text = newsText(entry, getLocale()) || {};
  return h(`<article class="news-entry">
      <p class="news-entry__date muted">${esc(fmtDate(entry.revision))}</p>
      <h2 class="news-entry__title">${esc(text.title || '')}</h2>
      <p class="news-entry__body">${esc(text.body || '')}</p>
    </article>`);
}
