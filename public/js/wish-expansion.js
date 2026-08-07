'use strict';

/*
 * Which game a wished EXPANSION should be acquired onto (#664).
 *
 * A wished expansion carries `expansionOf` — the base games BGG says it belongs
 * to, resolved server-side by the wishlist import. Turning that into an action
 * means answering one question: does this round already hold one of those games?
 *
 * Its own file for the coverage reason in
 * .claude/rules/frontend-helper-modules-and-coverage.md — requiring a view file
 * to export it would drag that file into the coverage report and red the gate
 * with every test still passing.
 */

// The games of this round that one of the expansion's declared parents names.
//
// Matching is on the PROVIDER LINK, never on the title: two printings of one
// game routinely differ in spelling, and a title match would attach an expansion
// to the wrong box with no error. The expansion's own provider is the one that
// resolved the parents, so a game linked to a different provider can never match
// even if the external ids happen to collide.
//
// `game` itself is excluded: a row can never be its own base game, and the
// server refuses that pairing too.
function expansionBaseCandidates(round, game) {
  const parents = Array.isArray(game.expansionOf) ? game.expansionOf : [];
  const provider = (game.source || {}).provider;
  const wanted = new Set(parents.map((p) => String(p && p.providerId)));
  const candidates = !provider ? [] : (round.games || []).filter((g) =>
    g.id !== game.id
    && g.source
    && g.source.provider === provider
    && wanted.has(String(g.source.externalId)));
  return { parents, candidates };
}

// What the acquire flow should do next, as a plain decision so the view has no
// branching logic of its own to get wrong:
//
//   'attach'      -> exactly one parent is already in the round; use `base`
//   'pickBase'    -> several are (or the parent list is empty) -> ask which game
//   'createBase'  -> none is, and exactly one parent is known -> fetch + create it
//   'pickParent'  -> none is, and several parents are known -> ask which one
//
// The empty-parent case deliberately routes to 'pickBase' rather than refusing:
// BGG does not always report an inbound link, and an expansion nobody can file
// is worse than one the user files by hand. It is also why 'pickBase' is offered
// the round's whole shelf rather than only the matched candidates.
function expansionAcquirePlan(round, game) {
  const { parents, candidates } = expansionBaseCandidates(round, game);
  if (candidates.length === 1) return { action: 'attach', base: candidates[0] };
  if (candidates.length > 1) return { action: 'pickBase', choices: candidates };
  if (parents.length === 1) return { action: 'createBase', parent: parents[0] };
  if (parents.length > 1) return { action: 'pickParent', choices: parents };
  return { action: 'pickBase', choices: acquirableBases(round, game) };
}

// Every game of the round an expansion may be filed under when its own parent
// list is no help. A wish is included on purpose — acquiring the expansion then
// brings its base game onto the shelf in the same step — while the expansion
// itself, and every OTHER wished expansion, is excluded: an expansion never
// holds expansions of its own.
function acquirableBases(round, game) {
  return (round.games || []).filter((g) => g.id !== game.id && !Array.isArray(g.expansionOf));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { expansionBaseCandidates, expansionAcquirePlan, acquirableBases };
}
