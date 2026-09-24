'use strict';

/*
 * GET /manifest.webmanifest, per design (#1199).
 *
 * Every design brings its own app icon (operator decision after the Tisch
 * review, docs/design/tisch/Tisch-T11-Karte-Marke.dc.html T11.2), so the
 * manifest stops being one static file. Mounted in createApp() directly in
 * front of express.static, i.e. exactly as open as the file it replaces: no
 * auth gate, no tenant, no account read.
 *
 * WHICH DESIGN. `?design=<id>` if that id is selectable on this instance, else
 * the FACE (FACE_DESIGN). design.js points the page's <link rel="manifest"> at
 * the design it is wearing (manifestHref in public/js/designs.js), so an
 * account's choice reaches the manifest without the server reading the account:
 * the response depends on the URL alone, and the access cookie keeps its single
 * job (the /uploads gate — lib/accounts.js).
 *
 * THE FACE'S OWN FILE IS SERVED UNTOUCHED. A design that declares no colours of
 * its own — Klassisch, today's face — falls through to express.static, so the
 * bytes, the headers and the ETag production serves today do not move by one
 * byte. Only a design with its own page/accent gets a derived manifest: the
 * static file with that design's icons, theme_color (its accent — the same
 * value applyBackground writes into <meta name="theme-color">,
 * .claude/rules/theme-color-meta-tag.md) and background_color (its page, which
 * is what the splash screen paints).
 *
 * THE PWA CAVEAT, stated where someone will look for it: an INSTALLED app keeps
 * the icon it was installed with. Browsers re-read the manifest on their own
 * schedule and several (iOS entirely, Android for the launcher icon) do not
 * swap an installed icon at all — so switching design changes the icon on the
 * next install, not on the home screen someone already has.
 */

const fs = require('fs');
const path = require('path');
const designs = require('../public/js/designs');

// Which design this request is asking for. An allowlist against the selectable
// set, never a passthrough: `?design=` is attacker-controlled and an unknown id
// must not produce anything but the face.
function manifestDesign(query, { production }) {
  const asked = typeof query === 'string' ? query : '';
  if (asked && designs.isSelectableDesign(asked, { production })) return designs.designById(asked);
  return designs.designById(designs.FACE_DESIGN);
}

// The static manifest re-dressed for `design`, or null when the design has no
// colours of its own and the file itself is the answer.
function manifestFor(base, design) {
  if (!design || !design.page || !design.accent) return null;
  return {
    ...base,
    background_color: design.page,
    theme_color: design.accent,
    icons: designs.designMarks(design.id).icons.map((icon) => ({ ...icon })),
  };
}

function createManifestRoute(assetDir) {
  const file = path.join(assetDir, 'manifest.webmanifest');
  // Parsed once: the path is exempt from the global limiter (it is an asset,
  // .claude/rules/security-middleware.md), so it must not cost a disk read per
  // request, and the file cannot change under a running process anyway.
  let base = null;
  return (req, res, next) => {
    const production = process.env.NODE_ENV === 'production';
    const design = manifestDesign(req.query.design, { production });
    if (!base) {
      try {
        base = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        return next(err);
      }
    }
    const body = manifestFor(base, design);
    if (!body) return next();
    // Revalidated like the static file (Express's ETag), never held stale: a
    // design's icon moving must reach the next install, not the one after.
    res.set('Cache-Control', 'no-cache');
    return res.type('application/manifest+json').send(JSON.stringify(body));
  };
}

module.exports = { createManifestRoute, manifestFor, manifestDesign };
