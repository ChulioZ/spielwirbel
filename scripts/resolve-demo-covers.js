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
 * WHAT IT NEEDS. BGG_API_TOKEN, for the board games only — the PlayStation and
 * Steam lookups are public. Without it the BGG rows come back with a null image,
 * which is the honest state: the app falls back to its own coverPlaceholder()
 * gradient, so a missing cover is a cosmetic loss and never a broken screen.
 * It prints only public product data; it never reads or echoes the token.
 *
 * A ROTTED COVER IS NOT AN OUTAGE. Resist "fixing" one by saving the image into
 * public/img — that converts a link into a reproduction of someone else's
 * artwork on our most public surface, which is the single thing the hotlinking
 * rule exists to prevent.
 */

const bgg = require('../lib/providers/bgg');
const psstore = require('../lib/providers/psstore');
const steam = require('../lib/providers/steam');
const { providerCoverUrl } = require('../lib/providers');
const { DEMO_GAMES } = require('../lib/demo-seed');

const PROVIDERS = { bgg, psstore, steam };

// PS Store's detail() parses the product page and often finds no image there,
// while its search DOES return a thumbnail on the same allowlisted host. So the
// cover is taken from a search hit matched back to the exact product id — never
// from the query's first result, which is fuzzy enough to return a different
// game entirely ("Gran Turismo 7" resolves to "Grandia").
async function psCover(externalId, title) {
  const hits = await psstore.search(title, 8).catch(() => []);
  const exact = hits.find((h) => h.providerId === externalId);
  return exact ? exact.thumbnail : null;
}

async function resolve(spec) {
  const provider = PROVIDERS[spec.source.provider];
  if (!provider) return { ...spec, error: `unknown provider ${spec.source.provider}` };

  const detail = await provider.detail(spec.source.externalId).catch((e) => ({ error: e.message }));
  if (detail && detail.error) return { ...spec, error: detail.error };

  const raw = detail.imageUrl
    || (spec.source.provider === 'psstore' ? await psCover(spec.source.externalId, spec.title) : null);

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
