'use strict';

/*
 * Re-resolve the guest demo's seed games against the live providers (#427,
 * widened to the metadata and to three rounds by #953) and print ready-to-paste
 * game blocks for lib/demo-seed.js.
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
 * IT ALSO RESOLVES THE PROVIDER METADATA (#953) — weight, playtime bounds, age,
 * categories, mechanics and rating. `detail()` already carries all of it (it
 * requests stats=1), so this costs no extra request. It matters because
 * `metadataFilterOptions` derives which filter controls EXIST from the values
 * actually stored: an unseeded demo shelf offers no complexity, playtime or age
 * control until the lazy backfill has hopped BGG and the screen has re-rendered.
 * Seeding it also means a demo mint costs BGG nothing at all.
 *
 * WHAT IT NEEDS. BGG_API_TOKEN — the XML API answers 401 without one (re-measured
 * 2026-08-12), so EVERY row comes back with a null image and no metadata, and the
 * app falls back to its own coverPlaceholder() gradient and to the lazy backfill.
 * That is the honest state: a missing cover is a cosmetic loss and never a broken
 * screen. It prints only public product data; it never reads or echoes the token.
 *
 * READ THE STDERR REPORT, NOT JUST THE BLOCK. It prints `<- provider says "X"`
 * whenever the resolved title differs from the seeded one, which is the only
 * check on a hand-written `externalId`: a wrong id resolves perfectly and ships a
 * game whose cover and metadata belong to something else.
 *
 * THE BLOCKS DO NOT CARRY THE FILE'S COMMENTS. lib/demo-seed.js explains per
 * round and per row why things are the way they are, and none of that survives a
 * regeneration — merge the resolved VALUES into the existing arrays rather than
 * overwriting them wholesale.
 *
 * A ROTTED COVER IS NOT AN OUTAGE. Resist "fixing" one by saving the image into
 * public/img — that converts a link into a reproduction of someone else's
 * artwork on our most public surface, which is the single thing the hotlinking
 * rule exists to prevent.
 */

const { getProvider, providerCoverUrl } = require('../lib/providers');
const { DEMO_ROUNDS } = require('../lib/demo-seed');
// The same field set the repo backends store, so this script cannot emit a key
// the seed would silently drop — nor miss one they would have kept
// (.claude/rules/provider-info-is-a-field-set.md).
const { PROVIDER_INFO_FIELDS, assignProviderInfo } = require('../lib/provider-info-fields');

// Which const each round's games are declared as in lib/demo-seed.js, so the
// printed block can be matched to the array it replaces.
const BLOCK_NAME = { main: 'MAIN_GAMES', duo: 'DUO_GAMES', group: 'GROUP_GAMES' };

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
    // Only the fields that carry a real value, exactly as the repo would store
    // them — an empty categories list is "BGG named none" and is skipped rather
    // than emitted as [], which keeps the seed's rows absent-key clean.
    info: assignProviderInfo({}, detail),
  };
}

function printGame(g) {
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
  // Emitted in the field set's own order rather than the provider's, so two runs
  // of this script produce a diffable block.
  for (const key of PROVIDER_INFO_FIELDS) {
    if (g.info[key] === undefined) continue;
    console.log(`    ${key}: ${JSON.stringify(g.info[key])},`);
  }
  // The two off-shelf markers are the seed's own, never the provider's, so they
  // are carried straight through — losing one would quietly put an archived game
  // back on the shelf and into the draw pool.
  if (g.retired) console.log('    retired: true,');
  if (g.wish) console.log('    wish: true,');
  console.log('  },');
}

(async () => {
  const resolved = [];
  // Sequential on purpose: these are third-party stores, and a burst of parallel
  // requests is exactly the rudeness they throttle for (BGG answers "too busy"
  // rather than queueing). A one-off script has no reason to be in a hurry.
  for (const round of DEMO_ROUNDS) {
    const out = [];
    for (const spec of round.games) out.push(await resolve(spec));
    resolved.push({ round, out });
  }

  for (const { round, out } of resolved) {
    console.error(`\n--- ${BLOCK_NAME[round.key] || round.key}`);
    for (const g of out) {
      const state = g.error
        ? `ERROR ${g.error}`
        : `${g.image ? 'cover ok' : 'NO COVER'}  ${Object.keys(g.info || {}).length}/${PROVIDER_INFO_FIELDS.length} fields`;
      const drift = g.resolvedTitle && g.resolvedTitle !== g.title
        ? `  <- provider says "${g.resolvedTitle}"` : '';
      console.error(`${g.title.padEnd(24)} ${state}${drift}`);
    }
  }

  /* REFUSE TO PRINT A BLOCK THAT WOULD ERASE THE SEED.

     Without the API token every row comes back with no cover and no metadata,
     and the block is then a perfectly well-formed erasure of everything the last
     successful run resolved — which is now ~500 lines of covers and metadata
     (#953), not the handful of URLs this script printed when it was written.
     Pasting it back looks like a refresh and is a wipe, and nothing downstream
     would say so: the seed stays valid, the tests stay green, and the demo
     quietly returns to placeholder gradients and a Regal offering no filters.

     So a run that resolved NOTHING AT ALL is treated as a failed run rather than
     as an empty answer — the same asymmetry backfillProviderInfo draws between an
     upstream failure and a successful answer that carries no data
     (lib/provider-info.js). A partial run still prints: values only accrete, and
     a row BGG genuinely has nothing for is a real answer. */
  const rows = resolved.flatMap((r) => r.out);
  const resolvedSomething = rows.filter((g) => g.image || Object.keys(g.info || {}).length);
  if (!resolvedSomething.length) {
    console.error(`\nRefusing to print a block: none of the ${rows.length} rows resolved a cover or`
      + ' any metadata, so pasting it back would ERASE what lib/demo-seed.js already holds.'
      + '\nThe usual cause is a missing BGG_API_TOKEN (the XML API answers 401) — see this'
      + ' script\'s header for how to supply it.');
    process.exitCode = 1;
    return;
  }

  // stdout is the paste-able block; the report above goes to stderr, so
  // `> /tmp/block.js` gives you just the code.
  for (const { round, out } of resolved) {
    console.log(`const ${BLOCK_NAME[round.key] || round.key} = [`);
    for (const g of out) printGame(g);
    console.log('];');
    console.log('');
  }
})().catch((e) => {
  console.error('resolve-demo-covers failed:', e.message);
  process.exit(1);
});
