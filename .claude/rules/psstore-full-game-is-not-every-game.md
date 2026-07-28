# `FULL_GAME` is not every game — PS Store files standard editions as `GAME_BUNDLE`

`parseSearch` (`lib/providers/psstore.js`) kept only products whose
`storeDisplayClassification` was `FULL_GAME`, on the reasonable-looking premise
that everything else on a search page is DLC or storefront noise. It isn't.
**Sony files a large share of ordinary standard editions under `GAME_BUNDLE`**
(localized "Spielpaket"), apparently because the SKU bundles the base game with
something else.

Measured live against `store.playstation.com/de-de` on 2026-07-28:

| Query | What the user got | Where the real game was |
|---|---|---|
| Split Fiction | Splitgate, Split, World Splitter | `GAME_BUNDLE`, **first node in the blob** |
| Gran Turismo 7 | *Grandia*, Grand Kingdom | `GAME_BUNDLE` |
| It Takes Two | only the Freunde-Pass | `GAME_BUNDLE` |
| EA SPORTS FC 25 | **nothing at all** | `GAME_BUNDLE` |
| Fortnite | **nothing at all** | `GAME_BUNDLE` |

Astro Bot, Baldur's Gate 3, Overcooked! 2, Elden Ring and Helldivers 2 are
genuinely `FULL_GAME`, which is why the filter looked fine for years.

## Why it was invisible

Nothing fails. The fetch is a clean `200`, the blob parses, `collectProducts`
walks it correctly, and the *product page* for the dropped game resolves
perfectly — `detail('UP0006-PPSA08560_00-SPLITSTANDARDED0')` returns Split
Fiction with `minPlayers: 1, maxPlayers: 2`. Only the search filter discards it,
and the dropdown then fills with unrelated near-matches from the same provider,
so it reads as *"the lookup is a bit weak"* rather than as a bug.

Two of the biggest games on the platform returning an **empty** PlayStation list
is the tell that this was never a ranking problem.

## The fix, and the two classes deliberately left out

`GAME_CLASSIFICATIONS = new Set(['FULL_GAME', 'GAME_BUNDLE'])`. The client-side
ranking absorbs the extra rows on its own: for "Split Fiction" the game scores 5
(exact) and the Freunde-Pass 4 (prefix), so the game wins
(`.claude/rules/add-game-lookup-provider.md`).

- **`PREMIUM_EDITION` stays out.** It holds real deluxe editions of the base game
  — which would be a defensible thing to offer — but it also holds plain DLC
  wearing the badge (measured: "Splitgate - Starter Weapon Pack", "Splitgate -
  Starter Character Pack"). The base game is already found without it, so the
  noise buys nothing.
- **`price.isFree` is NOT a usable discriminator**, however much the "drop the
  free Freunde-Pass" idea wants one. Measured: EA SPORTS FC 25's standard edition
  and **every** Fortnite entry report `isFree: true`. Filtering on it would
  re-break precisely the two queries this fix repaired.

**The one cost, so it isn't rediscovered as a regression:** `parseSearch` slices
to `limit` (8) **before** anything ranks the hits — `scoreHit` runs later, client
side, across providers. Admitting a second classification therefore lets a
`GAME_BUNDLE` hit consume a slot and push a lower-relevance `FULL_GAME` hit off
the end. Measured on "Astro Bot": ASTROSMASH and Bot Gaiden dropped out in favour
of two Astroneer editions, while the top hit was untouched. That is the right
trade — blob order is roughly relevance order, so what gets displaced is the
tail, not the answer — but it does mean **a title can disappear from the dropdown
without being dropped by the filter**. Check the slice before blaming
`GAME_CLASSIFICATIONS`.

## The residual, which is a *ranking* issue and not this one

For "It Takes Two" the game ("It Takes Two PS4™ & PS5™") and the Freunde-Pass
both score **4** — each is a prefix match after folding — so nothing in our
ranking separates them and **Sony's blob order decides**. That order is not
stable: two fetches minutes apart put the Freunde-Pass first and then the game
first. So the free pass can still surface above the game, and a single green
spot-check does not prove otherwise.

The game is at least *present* now, which it was not. If the tie is ever worth
breaking, do it in `scoreHit` (`public/js/lookup-score.js`) — not by re-narrowing
the classification filter, and not on `price.isFree` (see above).

## The `Concept` node is not the alternative

Sony's blob also carries `Concept` objects, which look like the platonic "the
game, not a SKU" record and therefore like the principled fix. They are not a
substitute: for the "Split Fiction" search the blob held exactly **one**
`Concept`, and it was *Mini Car Racing - Tiny Split Screen Tournament*. Concepts
do not cover the primary hits.

## Verifying a change here

The parsers are pure and unit-tested with no network
(`test/providers-psstore.test.js`), which is right for CI — but a fixture cannot
tell you what Sony actually classifies things as **today**. This whole bug lived
under a green suite whose fixtures all said `FULL_GAME`, hand-written from the
same assumption as the code.

So when touching the classification filter, probe the live blob once:

```js
const walk = (n, out) => {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { for (const v of n) walk(v, out); return; }
  if (n.__typename === 'Product' && n.name) out.push(n);
  for (const v of Object.values(n)) walk(v, out);
};
// fetch the search page, ps.extractNextData(html), then walk it and print
// [p.storeDisplayClassification, p.name] for every node — filtered AND dropped.
```

Print the **dropped** nodes too; a filter can only be judged against what it
throws away. The new spec was verified by reinstating the `FULL_GAME`-only set
on purpose and watching it go red (`actual: []`). Back the file up to the
scratchpad first — `git checkout` restores from the index and discards the whole
uncommitted change (`.claude/rules/css-text-assertions-strip-comments.md`).

**Related:** `.claude/rules/add-game-lookup-provider.md` (the provider contract
and the cross-provider ranking that absorbs the extra rows),
`.claude/rules/guest-demo-accounts.md` §4 (which recorded two of the symptoms
above as "PS Store search is fuzzy" — the mitigation there is still right, the
diagnosis was this bug).
