/* Provider-sourced game info — BGG weight (#717), plus playing time, minimum
   age, categories, mechanics and the community rating (#724). One builder for
   the three surfaces that show it: the info sheet the two voting cards open
   (hot-seat wizard + vote-link cards), and the game-detail section.

   BGG's DESCRIPTION was rendered here until #729 and is not any more: it is
   publisher marketing copy, English-only for a bilingual UI, long enough to
   need a clamp and an expand toggle, and it answered none of the question a
   voter has — playing time answers a real one in four characters. Rows written
   before that still carry the string; nothing reads it, so a game whose row
   holds one renders exactly as one without.

   Every value here is still BGG's own text, so it goes in via textContent,
   never interpolation.

   The RATING is the one field the three surfaces disagree about: detail only,
   never a voting card, because vote anchoring is a property of the voting
   screen. Both gates here default it OFF so a forgetful caller fails safe, and
   the enforceable half lives on the server (lib/routes/vote-link.js).

   No module.exports guard on purpose: this file builds DOM, so requiring it
   into Node would drag it into the coverage report
   (.claude/rules/frontend-helper-modules-and-coverage.md) — specs drive it
   through the jsdom harness instead. */

// Whether there is anything to show for this game. The affordances render only
// when true, so a storefront game (no provider metadata at all) looks exactly as
// it always did.
//
// `rating` counts only when the caller renders it, and it DEFAULTS TO OFF for
// the same fail-safe reason as gameInfoBody: on a voting surface a game carrying
// nothing but a rating must not grow an ⓘ button whose sheet would then be
// empty, while on the detail screen — which does render it — that same game has
// something to show. The two flags must agree, so both callers pass the same
// options object.
function hasGameInfo(game, { rating = false } = {}) {
  return !!game && (game.weight != null
    || game.minPlaytime != null || game.maxPlaytime != null || game.minAge != null
    || (game.categories || []).length > 0 || (game.mechanics || []).length > 0
    || (rating && game.rating != null));
}

// How many categories/mechanics the vote sheet lists before it summarises the
// rest. BGG gives 3–8 categories and up to ~15 mechanics for a heavy game, which
// is more than a voter deciding between five games wants to read; the detail
// screen passes Infinity and shows all of them.
const GAME_INFO_LIST_CAP = 5;

// One labelled fact row. The value goes in via textContent, never interpolation:
// categories and mechanics are BGG's own strings, so they are never
// interpolated into markup.
function factRow(label, value) {
  const row = h(`<div class="game-info__fact"><span class="game-info__fact-label">${esc(label)}</span><span class="game-info__fact-value"></span></div>`);
  row.querySelector('.game-info__fact-value').textContent = value;
  return row;
}

// A capped, comma-joined list — "Economic, Negotiation, +3 more" — so a long
// mechanic list cannot turn the sheet into a wall of text.
function factList(values, cap) {
  const shown = values.slice(0, cap);
  const rest = values.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, ${t('gameInfo.listMore', { n: rest })}` : shown.join(', ');
}

// BGG serves a playtime RANGE and the spread is the information: Toriki reports
// 20–600, where 20 is one sitting and 600 the full campaign, so collapsing it to
// one number tells a voter the opposite of what they need. Shown as a range only
// where the bounds actually differ; a game with one known bound reads as that
// single number rather than as a half-open interval nobody can parse.
function playtimeText(game) {
  const lo = game.minPlaytime;
  const hi = game.maxPlaytime;
  if (lo != null && hi != null && lo !== hi) return t('gameInfo.playtimeRange', { min: lo, max: hi });
  const one = lo != null ? lo : hi;
  return one == null ? null : t('gameInfo.playtimeValue', { n: one });
}

// The shared body: weight as a labelled five-dot scale (one decimal — BGG's
// four decimals would imply a precision the number does not have), the standard
// metadata facts, and the BGG attribution line the licence asks for wherever
// its data is displayed.
//
// `rating` DEFAULTS TO OFF, and that direction is the whole guarantee (#724):
// this one builder fills three surfaces, two of which are voting cards, so a
// caller that forgets the flag must fail SAFE. Only the game-detail section opts
// in. The server-side half — the ballot projection in lib/routes/vote-link.js
// omitting the field entirely — is the real enforcement; this is the view half.
function gameInfoBody(game, { rating = false, listCap = GAME_INFO_LIST_CAP } = {}) {
  const box = h('<div class="game-info__body"></div>');
  if (game.weight != null) {
    const filled = Math.round(game.weight);
    const dots = Array.from({ length: 5 }, (_, i) =>
      `<span class="weight-dots__dot${i < filled ? ' is-filled' : ''}"></span>`).join('');
    box.appendChild(h(`<div class="game-info__weight">
        <span class="game-info__weight-label">${esc(t('gameInfo.weight'))}</span>
        <span class="weight-dots" aria-hidden="true">${dots}</span>
        <span class="game-info__weight-value">${esc(t('gameInfo.weightValue', { n: game.weight.toFixed(1) }))}</span>
      </div>`));
  }
  const facts = h('<div class="game-info__facts"></div>');
  const playtime = playtimeText(game);
  if (playtime) facts.appendChild(factRow(t('gameInfo.playtime'), playtime));
  if (game.minAge != null) facts.appendChild(factRow(t('gameInfo.minAge'), t('gameInfo.minAgeValue', { n: game.minAge })));
  if ((game.categories || []).length) facts.appendChild(factRow(t('gameInfo.categories'), factList(game.categories, listCap)));
  if ((game.mechanics || []).length) facts.appendChild(factRow(t('gameInfo.mechanics'), factList(game.mechanics, listCap)));
  // One decimal, like the weight — BGG's five are a precision the number does
  // not have.
  if (rating && game.rating != null) {
    facts.appendChild(factRow(t('gameInfo.rating'), t('gameInfo.ratingValue', { n: game.rating.toFixed(1) })));
  }
  if (facts.children.length) box.appendChild(facts);
  box.appendChild(h(`<div class="muted game-info__source">${esc(t('gameInfo.source'))}</div>`));
  return box;
}

// Whether asking the server could still add something: a BGG-linked game missing
// at least one importable field. Shared by the detail page and the hot-seat
// wizard — which fire the per-game GET …/provider-info — and since #736 by
// refreshShelfGameInfo below, which gates the shelf-wide POST on the same
// question. The server-side TTL gate is the backstop that keeps a data-less game
// from costing an upstream request per view.
//
// Mirrors PROVIDER_INFO_FIELDS in lib/provider-info-fields.js. A field left out here
// only costs a trigger that never fires (the server would still backfill on the
// next session start), so this is the softer of the two lists — but keep them
// together anyway, or the detail page stops being a way to refresh a game.
function wantsGameInfo(game) {
  return !!game && !!game.source && game.source.provider === 'bgg'
    && (game.weight == null
      || game.minPlaytime == null || game.maxPlaytime == null || game.minAge == null
      || !(game.categories || []).length || !(game.mechanics || []).length
      || game.rating == null);
}

// Fold a GET …/provider-info answer into a game object the view already holds.
// ACCRETIVE, mirroring the server's own mutator: only a field the local copy
// lacks is filled, so a slow answer can never blank something already rendered.
//
// One function rather than a copy per caller (the detail page and the hot-seat
// wizard both do this) — the two lists drifting would mean a field that reaches
// one surface and not the other, with nothing to show for it anywhere.
function mergeGameInfo(game, info) {
  if (!game || !info) return game;
  for (const k of ['weight', 'minPlaytime', 'maxPlaytime', 'minAge', 'rating']) {
    if (info[k] != null && game[k] == null) game[k] = info[k];
  }
  for (const k of ['categories', 'mechanics']) {
    if ((info[k] || []).length && !(game[k] || []).length) game[k] = info[k];
  }
  return game;
}

// Fold a shelf-wide answer into the game objects a screen already holds (#736),
// reporting how many actually changed. Mutates IN PLACE — every seat, chip and
// pool closure on the setup screen holds these exact objects, so replacing them
// would detach the screen from what it renders.
//
// "Changed" is measured by serialising the game rather than by re-listing the
// fields mergeGameInfo copies. A second field list here would be the drift
// .claude/rules/provider-info-is-a-field-set.md exists for — one that leaves a
// newly-imported field silently unable to trigger a repaint.
function foldGameInfoList(games, infos) {
  const byId = new Map((games || []).map((g) => [g.id, g]));
  let changed = 0;
  (infos || []).forEach((info) => {
    const game = byId.get(info && info.id);
    if (!game) return;
    const before = JSON.stringify(game);
    mergeGameInfo(game, info);
    if (JSON.stringify(game) !== before) changed += 1;
  });
  return changed;
}

// Ask the server to fill the shelf's missing provider metadata, then fold the
// answer in and tell the caller to repaint (#736). Used by the two screens that
// FILTER on this metadata — the session setup screen and the Regal — because
// until #736 neither was a backfill trigger, so their filters silently did not
// filter and their controls silently did not appear.
//
// Fire-and-forget by design: the screen renders instantly from stored values and
// this only ever adds to it. `onFilled` is not called when nothing changed, so a
// filled shelf costs no repaint — which matters because repainting rebuilds the
// disclosure, and doing that for nothing would snap it shut under the user.
//
// The `wantsGameInfo` gate is what keeps a filled shelf from issuing a request
// at all; the server's TTL gate is the backstop for the games it cannot see.
function refreshShelfGameInfo(rid, games, onFilled) {
  if (!(games || []).some(wantsGameInfo)) return;
  api('POST', `/api/rounds/${rid}/games/provider-info`)
    .then((res) => {
      if (foldGameInfoList(games, (res || {}).games) > 0) onFilled();
    })
    .catch(() => {});
}

// The ⓘ affordance for the two vote cards, or null when the game has nothing
// to show — the card's height budget and primary actions stay untouched either
// way (.claude/rules/fitting-a-screen-to-the-viewport-height.md).
function gameInfoButton(game) {
  if (!hasGameInfo(game)) return null;
  const b = h(`<button type="button" class="vote__info" aria-label="${esc(t('gameInfo.open', { title: game.title }))}"><i class="ti ti-info-circle" aria-hidden="true"></i></button>`);
  b.addEventListener('click', () => openGameInfoSheet(game));
  return b;
}

// The sheet both vote cards open. Goes through openSheet for the focus trap,
// page lock and Back-dismissal (#145/#333/#622) — never assign activeSheet.
function openGameInfoSheet(game) {
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog" role="dialog" aria-modal="true" aria-label="${esc(t('gameInfo.title'))}">
        <div class="sheet__head">
          <h2>${esc(game.title)}</h2>
          <button class="sheet__close" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div class="game-info"></div>
      </div>
    </div>`);
  backdrop.querySelector('.game-info').appendChild(gameInfoBody(game));
  document.body.appendChild(backdrop);
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  backdrop.querySelector('.sheet__close').addEventListener('click', () => closeSheet());
}

// The game-detail section (#717), same body under a section heading — and the
// ONE surface that opts into the community rating and the uncapped lists (#724).
// It used to be the long half of this feature; since #729 dropped the
// description it is the same short fact list the sheet shows, plus the rating.
// It is not a voting screen, so the vote-anchoring concern that keeps the rating
// off the cards does not apply here.
function renderGameInfoSection(game) {
  const sec = h(`<div class="section gd-about"><h2>${esc(t('gameInfo.title'))}</h2></div>`);
  sec.appendChild(gameInfoBody(game, { rating: true, listCap: Infinity }));
  return sec;
}
