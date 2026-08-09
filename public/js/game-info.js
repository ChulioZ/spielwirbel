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
    desc.textContent = game.description;
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
