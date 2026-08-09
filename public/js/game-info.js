/* Provider-sourced game info — BGG weight + description (#717).
   One builder for the three surfaces that show it: the info sheet the two
   voting cards open (hot-seat wizard + vote-link cards), and the game-detail
   section. The description is BGG's licensed text stored unmodified, so it is
   rendered via textContent (never innerHTML) and only CLAMPED for display —
   the expand toggle is a real <button>, per
   .claude/rules/native-button-vs-focusable-span.md.

   No module.exports guard on purpose: this file builds DOM, so requiring it
   into Node would drag it into the coverage report
   (.claude/rules/frontend-helper-modules-and-coverage.md) — specs drive it
   through the jsdom harness instead. */

// Whether there is anything to show for this game. The affordances render only
// when true, so a storefront game (no weight, no description) looks exactly as
// it always did.
function hasGameInfo(game) {
  return !!game && (game.weight != null || !!game.description);
}

// Description lengths under this render whole; longer ones start clamped with
// a "show more" toggle. Display-only — the stored text is never cut.
const GAME_INFO_CLAMP_CHARS = 280;

// BGG stores its descriptions HTML-encoded and XML-encodes them again when
// serving, so after the provider's one XML decode the text still carries HTML
// entities for many games — Ark Nova ends "&mdash;description from the
// publisher" (captured live 2026-08-09). Decoded at RENDER time, not at store
// time, so every already-stored row self-corrects on its next view with no
// migration code (the render-time precedent in
// .claude/rules/provider-cover-sizing.md).
//
// DOMParser rather than the textarea-innerHTML idiom: an innerHTML assignment
// fed remote data is a CodeQL XSS sink however inert the element, while a
// parsed document is never inserted anywhere. '<' is pre-escaped so anything
// tag-shaped in the text survives as literal text instead of becoming an
// element the textContent walk would drop, and the 'x' sentinel keeps leading
// whitespace out of the HTML parser's ignore-initial-whitespace modes (blank
// first lines are real BGG data). The guard keeps entity-free text — the
// common case — byte-identical without a parse.
function decodeGameDescription(s) {
  const text = String(s);
  if (!/&(#\d|#x[0-9a-fA-F]|[a-zA-Z]+;)/.test(text)) return text;
  const doc = new DOMParser().parseFromString('x' + text.replace(/</g, '&lt;'), 'text/html');
  return doc.body.textContent.slice(1);
}

// The shared body: weight as a labelled five-dot scale (one decimal — BGG's
// four decimals would imply a precision the number does not have), the
// description, and the BGG attribution line the licence asks for wherever its
// data is displayed.
function gameInfoBody(game) {
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
  if (game.description) {
    const desc = h('<p class="game-info__desc"></p>');
    desc.textContent = decodeGameDescription(game.description);
    box.appendChild(desc);
    if (game.description.length > GAME_INFO_CLAMP_CHARS) {
      desc.classList.add('is-clamped');
      const toggle = h(`<button type="button" class="link-btn game-info__more" aria-expanded="false">${esc(t('gameInfo.showMore'))}</button>`);
      toggle.addEventListener('click', () => {
        const expanded = !desc.classList.toggle('is-clamped');
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.textContent = t(expanded ? 'gameInfo.showLess' : 'gameInfo.showMore');
      });
      box.appendChild(toggle);
    }
  }
  box.appendChild(h(`<div class="muted game-info__source">${esc(t('gameInfo.source'))}</div>`));
  return box;
}

// Whether asking the server could still add something: a BGG-linked game
// missing at least one of the two fields. Shared by the detail page and the
// hot-seat wizard — both fire the same GET …/provider-info trigger, whose
// server-side TTL gate keeps a data-less game from costing an upstream
// request per view.
function wantsGameInfo(game) {
  return !!game && !!game.source && game.source.provider === 'bgg'
    && (game.weight == null || !game.description);
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

// The game-detail section (#717), same body under a section heading.
function renderGameInfoSection(game) {
  const sec = h(`<div class="section gd-about"><h2>${esc(t('gameInfo.title'))}</h2></div>`);
  sec.appendChild(gameInfoBody(game));
  return sec;
}
