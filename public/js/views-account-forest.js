/* Spielwirbel – Konto as Forest composes it (#1470). */

'use strict';

/* Forest's Konto (#1470, F5.3): Das Programmheft's index beside the sections,
   drawn as Forest draws it — every section a card on the clearing, and the
   index a card of its own with an icon per entry and „Abmelden" at its foot.
   So this composes on top of composeKontoProgramme (which builds the cards,
   the index and its jump-to-section buttons from the headings actually on the
   page) rather than restating any of it, and adds only what F5.3 adds.

   Like Das Programmheft's, the index only JUMPS: F5.3 draws it as if it
   switched between pages, and hiding every section but one would move entries
   out of reach (handover §2). The entry last jumped to is marked, visually
   only — nothing about the page changed, so it carries no aria-current.

   „Abmelden" is the account menu's own action (logout()), repeated where F5.3
   draws it; a demo does not get it, for the reason its account menu says
   „Demo beenden" instead. The icon of an entry is looked up by its heading's
   text, resolved per render, so a section the map does not know simply gets
   none. Its own file, for views-account-tisch.js's reason. */
function composeKontoForest(me) {
  composeKontoProgramme();
  const nav = app.querySelector('.konto-index');
  if (!nav) return;
  const icons = kontoForestIcons();
  for (const link of nav.querySelectorAll('.konto-index__link')) {
    const icon = icons.get(link.textContent);
    if (icon) link.prepend(h(`<i class="ti ${icon}" aria-hidden="true"></i>`));
    link.addEventListener('click', () => {
      for (const other of nav.querySelectorAll('.konto-index__link')) other.classList.toggle('is-on', other === link);
    });
  }
  if (me && !me.demo) {
    const out = h(`<button type="button" class="konto-index__logout">${iconText('ti-logout', t('auth.logout'))}</button>`);
    out.addEventListener('click', () => logout());
    nav.appendChild(out);
  }
}

// F5.3's icons, keyed by the heading each section prints in this locale.
function kontoForestIcons() {
  return new Map([
    ['konto.identity', 'ti-id'],
    ['konto.avatar.title', 'ti-photo'],
    ['konto.profile.title', 'ti-user'],
    ['konto.design.title', 'ti-palette'],
    ['konto.bgg.title', 'ti-dice-5'],
    ['konto.bgstats.title', 'ti-link'],
    ['konto.demo.title', 'ti-user-circle'],
    ['install.title', 'ti-download'],
    ['konto.notify.title', 'ti-message'],
    ['konto.email.title', 'ti-mail'],
    ['konto.pw.title', 'ti-lock'],
    ['konto.passkey.title', 'ti-fingerprint'],
    ['konto.delete.title', 'ti-trash'],
  ].map(([key, icon]) => [t(key), icon]));
}
