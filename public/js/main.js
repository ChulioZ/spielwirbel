/* Spielwirbel – bootstrap (loads last). */

'use strict';

initLocale();
applyStaticTexts();
setupLangPicker();
initFooter();
// One capture-phase listener for every avatar on every screen (#841): a picture
// whose bytes are gone (an operator takedown, an erasure) degrades to the
// initials it replaced instead of a broken-image glyph. `error` does not bubble,
// and an inline onerror would need script the CSP refuses — hence one listener
// here rather than an attribute per image.
installAvatarFallback(document);
// Resolve the account state (#138) first, then render: in accounts mode this may
// show the auth UI instead of routing into the app; in legacy mode bootApp just
// routes the current URL (deep link / reload), not always Home.
bootApp();
