'use strict';

/*
 * Route the BGG module's batched `details(ids)` through its single `detail(id)`
 * (#1832), so a public-stats spec can keep stubbing ONE game's answer at a time.
 *
 * Those specs are about ranking, thresholds and the no-typed-byte guarantee,
 * and a per-game stub is the natural way to say "this game has no name" or
 * "this one has these designers". How the batch is sent and parsed is
 * test/public-stats-batching.test.js's subject (through global.fetch) and
 * test/providers-bgg.test.js's.
 *
 * What it keeps faithful: one call is ONE request, at most MAX_THING_IDS ids
 * are asked, a game answered with no title is simply absent from `items`, and
 * a throw from any id fails the whole request — as one upstream error would.
 * `requests` counts calls, for the specs that measure the budget.
 *
 * Installed at require time; `node --test` gives every file its own process.
 */
module.exports = function batchViaDetail(bgg) {
  const state = { requests: 0 };
  bgg.details = async (ids) => {
    state.requests += 1;
    const asked = ids.slice(0, bgg.MAX_THING_IDS).map(String);
    const items = [];
    for (const id of asked) {
      const d = await bgg.detail(id);
      if (d && typeof d.title === 'string' && d.title.trim()) items.push({ ...d, providerId: id });
    }
    return { items, asked };
  };
  return state;
};
