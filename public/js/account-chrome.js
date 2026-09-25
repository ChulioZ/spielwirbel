/* Spielwirbel – the account CHROME (#521/#741/#207), split out of account.js by
   #969: the terms-change banner, the top-bar account menu, the inbox badge and
   the „Was ist neu" dot.

   Everything here hangs off elements that live permanently in index.html and is
   toggled with the `hidden` attribute — which is why styles.css carries the
   explicit `[hidden] { display: none }` companions
   (.claude/rules/hidden-attribute-vs-display-rule.md).

   `setupTermsBanner` is the load-bearing one: Nutzungsbedingungen §11 promises
   users are told of material changes "im Dienst oder per E-Mail", and this is
   the only channel that keeps it (.claude/rules/keep-legal-docs-current.md).
   test/account.test.js pins that only a TERMS_REVISION bump raises it.

   Part of the frontend; all files share one global script scope. Loads last of
   the account files. See index.html for the load order. */

'use strict';

// The terms-change notice (#521): Nutzungsbedingungen §11 promises we inform
// users of material changes "im Dienst oder per E-Mail", and until now nothing
// did — a published promise the implementation could not keep.
//
// The decision is a comparison of two fields the server sends TOGETHER on /me
// (see meProjection): the account's resolved accepted revision and the current
// one. Both come from one response, so this can never read a stale pair, and the
// LEGACY_TERMS_REVISION fallback for accounts predating #521 is applied
// server-side — the client deliberately knows nothing about it.
//
// Like the demo banner, the element lives permanently in index.html and is
// toggled with the `hidden` attribute, which is why styles.css carries an
// explicit `.terms-banner[hidden] { display: none }`
// (.claude/rules/hidden-attribute-vs-display-rule.md).
function setupTermsBanner() {
  const bar = document.getElementById('termsBanner');
  if (!bar) return;
  const on = accountsActive() && isLoggedIn() && !!accountUser
    && !!accountUser.termsRevision
    && accountUser.acceptedTermsRevision !== accountUser.termsRevision;
  bar.hidden = !on;
  if (!on) return;

  const text = document.getElementById('termsBannerText');
  if (text) text.textContent = t('terms.updated.text');
  // Gated on cfg.footer like the rest of the legal surface: lib/routes/legal.js
  // hard-404s until the operator identity is configured, so on such an instance
  // the notice states the change without offering a link that would break.
  const link = document.getElementById('termsBannerLink');
  if (link) {
    link.textContent = t('terms.updated.link');
    // Land the reader on the change summary in THEIR language. The document
    // carries a German section (authoritative, id="aenderungen") followed by an
    // English one (id="changes-en"); without this an English reader would be
    // dropped onto the German summary with the English one far below. Re-applied
    // on every call, so it follows the language picker like the label above.
    // German only for `de` — NOT "anything that isn't `en`" (#822): the document
    // has exactly two summaries, so every further locale belongs on the English
    // one, which is the same outcome this comment already argues for.
    link.href = `/nutzungsbedingungen#${getLocale() === 'de' ? 'aenderungen' : 'changes-en'}`;
    withAppConfig((cfg) => { link.hidden = !(cfg && cfg.footer); });
  }
  const dismiss = document.getElementById('termsBannerDismiss');
  if (dismiss) {
    dismiss.textContent = t('terms.updated.dismiss');
    dismiss.onclick = async () => {
      // Hide immediately: the click is the acknowledgement, and leaving the
      // strip up until a round trip lands reads as the button being broken.
      bar.hidden = true;
      try {
        // accountApi resolves to the PARSED BODY (it throws on a non-2xx), so
        // this is the fresh meProjection — not a { status, data } envelope.
        // Re-seating it is load-bearing rather than tidy: setupTermsBanner runs
        // again on every language switch, and against a stale `accountUser` it
        // would re-show the notice the user just dismissed.
        const me = await accountApi('POST', '/accept-terms');
        if (me && me.termsRevision) accountUser = me;
      } catch {
        // A failed write just means the notice returns on the next load, which
        // is the right failure direction for something that must be seen.
      }
    };
  }
}

/* ----------------------------- top-bar account ----------------------------- */

// Reveal (accounts mode + logged in) or hide the top-bar account button, and wire
// its menu (e-mail + logout). Called on boot, login, and logout.
function setupAccountUi() {
  // Tracks exactly the same login transitions as the account button (boot,
  // login, logout, session-lost), which is why it hangs off this function
  // rather than being called from each of those sites separately.
  setupDemoBanner();
  setupTermsBanner(); // #521, same transitions
  // #841, same transitions. Seats the CALLER'S OWN picture into the avatar cache
  // so their linked seat renders it without a batch request — and so a login as
  // a different account overwrites the previous one's entry rather than
  // inheriting it. Hangs off this function for exactly the reason the two above
  // do: it tracks boot, login, logout and session-lost, and nothing else has to
  // remember to call it.
  if (accountUser) rememberAvatar(accountUser.id, accountUser.avatar || null);
  // #207, same transitions — and it belongs UP HERE with the other two rather
  // than at the foot of this function, where it used to sit. Everything below
  // returns early for a logged-out user, so the inbox button was never hidden on
  // the way out: logging out left it on the landing page as a dead control
  // (clicking it lands in showInbox, which guards itself and bounces Home).
  // A cold boot never showed it — bootApp() returns before calling this for a
  // logged-out visitor, so the button keeps index.html's `hidden` — which is why
  // only the logout and session-lost transitions ever exposed it.
  // setupInboxUi() handles the logged-out case itself and self-guards on a
  // missing element, so it is safe ahead of both returns below.
  setupInboxUi();
  const btn = document.getElementById('accountBtn');
  if (!btn) return;
  const loggedIn = accountsActive() && isLoggedIn();
  btn.hidden = !loggedIn;
  // The „Was ist neu" dot (#741). It lives INSIDE the button above, so hiding
  // that button takes the dot with it — this call is what keeps the two honest
  // across the same login transitions the rest of this function tracks (boot,
  // login, logout, session-lost).
  setNewsDot(loggedIn && hasUnseenNews());
  // Der Tisch's avatar + name face (#1279) — before the early return, so a
  // logout takes the previous account's name off the button with it.
  renderAccountFace();
  if (!loggedIn) return;
  btn.onclick = () => openPopover(btn, (el, close) => {
    const username = (accountUser && accountUser.username) || '';
    el.appendChild(h(`<div class="popover__head">${
      username ? `<strong>${esc(username)}</strong>` : ''
    }${esc((accountUser && accountUser.email) || '')}</div>`));
    /* „Mein Profil" (#1089): the first entry point to your OWN profile. Until
       then only OTHER people's were reachable (a Kreis card, the feed, a shared
       link), so the one screen an account has about itself could be opened only
       by typing its own URL.

       Gated on holding a username, because the profile is addressed by handle —
       an account mid-erasure has none, and the row would open a 404. */
    if (username) {
      const mine = h(`<button class="popover__opt"><i class="ti ti-user-circle" aria-hidden="true"></i> ${esc(t('profile.menu'))}</button>`);
      mine.addEventListener('click', () => { close(); showProfile(username); });
      el.appendChild(mine);
    }
    // Freundeskreis (#325): the entry point to the dedicated friends view.
    const friends = h(`<button class="popover__opt"><i class="ti ti-users" aria-hidden="true"></i> ${esc(t('friends.menu'))}</button>`);
    friends.addEventListener('click', () => { close(); showFriends(); });
    el.appendChild(friends);
    // Konto (#482): account settings — password change today, passkeys (#418)
    // and account deletion (#419) later.
    const konto = h(`<button class="popover__opt"><i class="ti ti-user" aria-hidden="true"></i> ${esc(t('konto.menu'))}</button>`);
    konto.addEventListener('click', () => { close(); showAccount(); });
    el.appendChild(konto);
    // Entdecken (#564): the instance-wide statistics. Listed unconditionally
    // rather than gated on /api/stats/public answering — the menu is built
    // synchronously on every open, and a network round-trip per open to decide
    // whether to show one row would either stall the popover or make it jump.
    // The screen itself renders an honest empty state when the feature is off.
    const entdecken = h(`<button class="popover__opt"><i class="ti ti-world-search" aria-hidden="true"></i> ${esc(t('stats.menu'))}</button>`);
    entdecken.addEventListener('click', () => { close(); showEntdecken(); });
    el.appendChild(entdecken);
    // „Was ist neu" (#741). The only entry point to /neu, which is what makes
    // this a PULLED surface — the dot on the button above merely says there is
    // something here, and costs nothing when there is not.
    //
    // That dot is repeated on this row (#764), because the button it sits on is
    // a MENU rather than a destination: without the repeat the trail ends here,
    // and a user who opens the menu, guesses wrong and closes it has spent the
    // nudge's attention without reading the entry — while the dot stays lit and
    // charges them again next time. Read from the same `hasUnseenNews()` that
    // setNewsDot() is called with above, so the two marks cannot disagree; it
    // needs no network call, which is what lets this menu stay synchronous (see
    // the Entdecken comment). Nothing clears it explicitly — the handler's
    // showNews() stamps it seen, and the next open rebuilds the row.
    const unseen = hasUnseenNews();
    const newsOpt = h(`<button class="popover__opt${unseen ? ' popover__opt--marked' : ''}"${
      // The dot is decorative; the state belongs in the row's accessible name,
      // or a screen reader meets a nameless span. Only set when marked, so the
      // seen row keeps the plain text as its name.
      unseen ? ` aria-label="${esc(t('news.menuUnseen'))}"` : ''
    }><i class="ti ti-sparkles" aria-hidden="true"></i> ${esc(t('news.menu'))}${
      unseen ? '<span class="popover__dot" aria-hidden="true"></span>' : ''
    }</button>`);
    newsOpt.addEventListener('click', () => { close(); showNews(); });
    el.appendChild(newsOpt);
    // A demo has nothing to log back INTO — it holds no password identity, so
    // "Abmelden" would strand the account alive and unreachable, holding a
    // capacity slot for the rest of its TTL (#502). Ending it erases it instead.
    if (isDemoAccount()) {
      const end = h(`<button class="popover__opt"><i class="ti ti-trash" aria-hidden="true"></i> ${esc(t('demo.end.menu'))}</button>`);
      end.addEventListener('click', () => { close(); endDemo(); });
      el.appendChild(end);
    } else {
      const out = h(`<button class="popover__opt"><i class="ti ti-logout" aria-hidden="true"></i> ${esc(t('auth.logout'))}</button>`);
      out.addEventListener('click', () => { close(); logout(); });
      el.appendChild(out);
    }
  });
}

/* The account button's FACE (#1279). Klassisch keeps index.html's person glyph;
   Der Tisch draws the account as its avatar plus its name (T3/T6: „LE Lea"),
   and tisch.css hides the name below 768px, where the phone frame (T6.1)
   draws the avatar alone.

   Klassisch's DOM is never touched: the Klassisch branch acts only when a Tisch
   face is present to take back (a design switch or a logout), and then restores
   exactly the markup index.html ships. `#newsDot` is MOVED, never rebuilt, so
   its lit/unlit state survives every repaint.

   Called from setupAccountUi (every login transition) and from applyDesign
   (design.js), because the button lives outside every view and so is not
   rebuilt by the re-render a design change triggers. */
function renderAccountFace() {
  const btn = document.getElementById('accountBtn');
  if (!btn) return;
  const dot = document.getElementById('newsDot');
  const username = (accountUser && accountUser.username) || '';
  const tisch = designIs('tisch') && accountsActive() && isLoggedIn() && !!username;
  const hasTischFace = !!btn.querySelector('.topbar__avatar');
  if (!tisch && !hasTischFace) return;
  // The disc takes the account's own colour (accountColor, the one the friends
  // screens use) through memberTone — lifted on a dark scheme, which Der Tisch
  // is, so the --on-accent initials read on it like every seat avatar's do.
  // aria-hidden: the name beside it, and the button's label, carry the person.
  btn.innerHTML = tisch
    ? `<span class="avatar topbar__avatar" style="background:${memberTone(accountColor(username))}" aria-hidden="true">${
      avatarFace(initials(username), { src: accountUser.avatar || null })}</span><span class="topbar__name">${esc(username)}</span>`
    : '<i class="ti ti-user" aria-hidden="true"></i>';
  if (dot) btn.appendChild(dot);
  // A class rather than `:has()`: `.topbar__acct` declares no `display` so the
  // `hidden` attribute keeps working, and the face's flex row is keyed off this.
  btn.classList.toggle('topbar__acct--face', tisch);
  btn.setAttribute('aria-label', accountBtnLabel());
}

// The account button's accessible name. With the name ON the button (Der Tisch)
// it has to contain that visible text (WCAG 2.5.3); applyStaticTexts reads this
// too, so a language switch keeps the name in it.
function accountBtnLabel() {
  const btn = document.getElementById('accountBtn');
  const username = (accountUser && accountUser.username) || '';
  return btn && username && btn.querySelector('.topbar__name')
    ? t('a11y.accountNamed', { name: username })
    : t('a11y.account');
}

// The inbox button (issue #207): visible only when logged in, opens the inbox
// view, and shows an unread dot. Called from setupAccountUi so it tracks the same
// login transitions (boot, login, logout, session-lost).
function setupInboxUi() {
  const btn = document.getElementById('inboxBtn');
  if (!btn) return;
  const loggedIn = accountsActive() && isLoggedIn();
  btn.hidden = !loggedIn;
  if (!loggedIn) { setInboxDot(false); return; }
  btn.onclick = () => showInbox();
  refreshInboxBadge();
}

// Toggle the unread dot on the inbox button.
function setInboxDot(on) {
  const dot = document.getElementById('inboxDot');
  if (dot) dot.hidden = !on;
}

// Light the unread dot if any inbox item is unread. Best-effort: a failure just
// leaves the dot as-is (accountApi bounces a dead session to login). Reused by
// showInbox() after it marks/dismisses an item.
async function refreshInboxBadge() {
  if (!(accountsActive() && isLoggedIn())) return;
  try {
    const { items } = await accountApi('GET', '/inbox');
    setInboxDot(items.some((i) => !i.read));
  } catch {}
}

/* ------------------------- „Was ist neu" (issue #741) ----------------------- */

// Is there a news entry this account has not seen? Needs NO network call — the
// entry list ships in this very bundle (public/js/news.js) and the account's own
// stamp already rode in on /me. That is the whole reason the dot costs nothing
// when there is nothing to say.
//
// A null revision (the empty list) answers false, so no dot can ever appear
// before the first entry exists. `accountUser` is deliberately required: with no
// account there is no seen-state, and dotting everyone would be worse than not
// dotting at all.
function hasUnseenNews() {
  const rev = newsRevision();
  return !!rev && !!accountUser && accountUser.lastSeenNewsRevision !== rev;
}

// Toggle the unseen dot on the account button.
function setNewsDot(on) {
  const dot = document.getElementById('newsDot');
  if (dot) dot.hidden = !on;
}

// Record that the current entries have been seen — called by showNews(), because
// OPENING the screen is the acknowledgement (the same shape as the terms
// banner's dismiss button, and the reason there is no separate "mark read"
// control). Lives here rather than in views-news.js so the `accountUser`
// re-seating below stays in the file that owns that variable.
async function markNewsSeen() {
  if (!hasUnseenNews()) return; // nothing to record, including the empty-list case
  setNewsDot(false); // optimistic: the click is the acknowledgement, a round trip is not
  try {
    // accountApi resolves to the PARSED BODY, i.e. a fresh meProjection.
    // Re-seating it is load-bearing rather than tidy: setupAccountUi() runs again
    // on the next login transition, and against a stale `accountUser` it would
    // re-light the dot the user just cleared.
    const me = await accountApi('POST', '/news-seen');
    if (me && me.id) accountUser = me;
  } catch {
    // A failed write just means the dot returns on the next load — the right
    // failure direction for a nudge nobody is blocked on.
  }
}

