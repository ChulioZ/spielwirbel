'use strict';

/* The storefront clean-up (#981), as one cross-tenant operator action.

   #744 retired the four digital storefronts as lookup providers but deliberately
   kept two things: covers already stored keep rendering (hotlinked from the
   storefront's CDN) and stored `source` links stay as data. That is why
   `LEGACY_COVER_HOSTS` is frozen into the CSP and why the privacy policy still
   names Sony, Valve, Nintendo and Microsoft as recipients. Clearing the rows is
   what lets all of that go.

   `hostMatch` mirrors the download guard's rule exactly (`host === h ||
   host.endsWith('.' + h)`), so the set cleared here is the set the CSP admits —
   a looser match would clear a cover the browser was happy to render, a tighter
   one would leave a row behind and keep the host in `img-src` forever.

   AN UPLOADED COVER IS KEPT. `/uploads/…` is our own object, with no storefront
   in it; only the `source` link goes. Counted separately, because "how many
   covers will go blank" is the number the operator is deciding on. */
function storefrontMatch(game, hosts, providerIds) {
  const out = { cover: false, source: false, upload: false };
  const img = String(game.image || '');
  if (img.startsWith('/uploads/')) {
    out.upload = true;
  } else if (img) {
    let host = '';
    try { host = new URL(img).hostname.toLowerCase(); } catch { host = ''; }
    out.cover = !!host && hosts.some((h) => host === h || host.endsWith('.' + h));
  }
  out.source = !!(game.source && providerIds.includes(game.source.provider));
  return out;
}

module.exports = { storefrontMatch };
