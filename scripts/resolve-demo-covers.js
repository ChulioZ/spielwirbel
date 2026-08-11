'use strict';

/*
 * Re-resolve the guest demo's seed games against the live providers (#427) and
 * print a ready-to-paste DEMO_GAMES block for lib/demo-seed.js.
 *
 *   node --env-file-if-exists=.env scripts/resolve-demo-covers.js
 *
 * WHY THIS EXISTS. The seeded covers are HOTLINKS to the providers' own CDNs
 * (.claude/rules/provider-cover-hotlinking.md) — we never copy the bytes. A
 * hotlink can rot when a provider reorganises its CDN, and BGG's cover URLs
 * cannot be written by hand at all: their transform paths are signed
 * (.claude/rules/provider-cover-sizing.md) and their API answers 401 without a
 * token, so a guessed URL is guaranteed to render nothing. Re-running this is
 * the only correct way to refresh them.
 *
 * WHAT IT NEEDS. BGG_API_TOKEN — the XML API answers 401 without one (re-measured
 * 2026-08-12), so EVERY row comes back with a null image and the app falls back
 * to its own coverPlaceholder() gradient. That is the honest state: a missing
 * cover is a cosmetic loss and never a broken screen. It prints only public
 * product data; it never reads or echoes the token.
 *
 * A ROTTED COVER IS NOT AN OUTAGE. Resist "fixing" one by saving the image into
 * public/img — that converts a link into a reproduction of someone else's
 * artwork on our most public surface, which is the single thing the hotlinking
 * rule exists to prevent.
 */

const { getProvider, providerCoverUrl } = require('../lib/providers');
const { DEMO_GAMES } = require('../lib/demo-seed');

// Resolved through the live registry rather than a local map, so a seed row
// naming a RETIRED provider (#744) reports "unknown provider" here instead of
// crashing on a require that no longer resolves.
async function resolve(spec) {
  const provider = getProvider(spec.source.provider);
  if (!provider) return { ...spec, error: `unknown provider ${spec.source.provider}` };

  const detail = await provider.detail(spec.source.externalId).catch((e) => ({ error: e.message }));
  if (detail && detail.error) return { ...spec, error: detail.error };

  // A provider whose detail carries no image is not an error — the row keeps its
  // placeholder. (This used to fall back to a search hit matched by exact id,
  // for PS Store's imageUrl-less product pages; BGG's detail always carries one.)
  const raw = detail.imageUrl || null;

  return {
    ...spec,
    resolvedTitle: detail.title || null,
    minPlayers: detail.minPlayers != null ? detail.minPlayers : spec.minPlayers,
    maxPlayers: detail.maxPlayers != null ? detail.maxPlayers : spec.maxPlayers,
    source: { ...spec.source, url: detail.url || spec.source.url },
    // The same guard the add-game route applies: https only, no characters that
    // could break out of `background-image:url('…')`, and a host some provider
    // vouches for. Anything else becomes null rather than being stored.
    image: providerCoverUrl(raw),
  };
}

(async () => {
  const out = [];
  // Sequential on purpose: these are third-party stores, and a burst of parallel
  // requests is exactly the rudeness they throttle for (BGG answers "too busy"
  // rather than queueing). A one-off script has no reason to be in a hurry.
  for (const spec of DEMO_GAMES) {
    out.push(await resolve(spec));
  }

  for (const g of out) {
    const state = g.error ? `ERROR ${g.error}` : (g.image ? 'cover ok' : 'NO COVER');
    const drift = g.resolvedTitle && g.resolvedTitle !== g.title
      ? `  <- provider says "${g.resolvedTitle}"` : '';
    console.error(`${g.title.padEnd(34)} ${state}${drift}`);
  }

  // stdout is the paste-able block; the report above goes to stderr, so
  // `> /tmp/block.js` gives you just the code.
  console.log('const DEMO_GAMES = [');
  for (const g of out) {
    console.log('  {');
    console.log(`    title: ${JSON.stringify(g.title)},`);
    console.log(`    minPlayers: ${g.minPlayers},`);
    console.log(`    maxPlayers: ${g.maxPlayers},`);
    console.log('    source: {');
    console.log(`      provider: ${JSON.stringify(g.source.provider)},`);
    console.log(`      externalId: ${JSON.stringify(g.source.externalId)},`);
    console.log(`      url: ${JSON.stringify(g.source.url)},`);
    console.log('    },');
    console.log(`    image: ${g.image ? JSON.stringify(g.image) : 'null'},`);
    console.log(`    tags: ${JSON.stringify(g.tags || [])},`);
    console.log('  },');
  }
  console.log('];');
})().catch((e) => {
  console.error('resolve-demo-covers failed:', e.message);
  process.exit(1);
});
