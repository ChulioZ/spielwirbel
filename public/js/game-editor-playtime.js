/* Spielwirbel – the game page's playing-time editor (#1627).
 *
 * A round corrects BGG's playing time by hand, the way it already sets the
 * player range: a long setup, a variant, a slow table. What it stores is a
 * SEPARATE `playtimeOverride: { min, max }` beside the provider pair — see
 * `gamePlaytime` in draw-pool.js for why writing into `minPlaytime`/`maxPlaytime`
 * would be reverted by the next BGG fill.
 *
 * Its own file rather than a sixth editor in game-editors.js, which sits at its
 * token budget; it takes the same `{ game, updateGame }` context the five there
 * do, and reuses their row builders under the designs that draw T15a's rows.
 *
 * Part of the frontend; all files share one global script scope (load order: see
 * index.html). */

// The two bounds a user typed, as the override the route accepts — or a toast
// key naming what is wrong. One filled field is a single figure („90 Min."),
// so it becomes both bounds rather than a half-open interval the filter cannot
// read. Pure; its spec runs it through the jsdom harness, since it reads
// PLAYTIME_OVERRIDE_MAX off the shared scope.
function playtimeOverrideFrom(minText, maxText) {
  const read = (v) => (String(v).trim() === '' ? null : Number(String(v).trim()));
  let min = read(minText);
  let max = read(maxText);
  if (min === null && max === null) return { error: 'detail.toast.playtimeNeeded' };
  if (min === null) min = max;
  if (max === null) max = min;
  const ok = (n) => Number.isInteger(n) && n >= 1 && n <= PLAYTIME_OVERRIDE_MAX;
  if (!ok(min) || !ok(max)) return { error: 'detail.toast.playtimeNeeded' };
  if (max < min) return { error: 'detail.toast.playtimeRange' };
  return { override: { min, max } };
}

function openPlaytimePopover(ctx, anchor) {
  const { game, updateGame } = ctx;
  openEditor(anchor, 'playtime', t('gameInfo.playtime'), (el, close) => {
    const formRows = formSheetDesign();
    const current = gamePlaytime(game);
    const field = (key) => {
      const inp = h(`<input class="input" inputmode="numeric" maxlength="${String(PLAYTIME_OVERRIDE_MAX).length}" />`);
      inp.placeholder = t(key);
      inp.setAttribute('aria-label', t(key));
      inp.addEventListener('input', () => {
        const digits = inp.value.replace(/\D/g, '');
        if (inp.value !== digits) inp.value = digits;
      });
      return inp;
    };
    const min = field('detail.playtimeFrom');
    const max = field('detail.playtimeTo');
    if (current.minPlaytime != null) min.value = current.minPlaytime;
    if (current.maxPlaytime != null) max.value = current.maxPlaytime;

    const okBtn = h(`<button class="btn btn--primary">${esc(t('common.apply'))}</button>`);
    const save = () => {
      const res = playtimeOverrideFrom(min.value, max.value);
      if (res.error) return toast(t(res.error));
      close();
      updateGame({ playtimeOverride: res.override });
    };
    okBtn.addEventListener('click', save);
    [min, max].forEach((inp) => inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
    }));

    // Back to BGG's figure — offered only while an override exists. Names the
    // figure it returns to, or says plainly that the time goes away when BGG
    // has none (a hand-typed game).
    let reset = null;
    if (current.overridden) {
      const bgg = playtimeRangeText({ minPlaytime: game.minPlaytime, maxPlaytime: game.maxPlaytime });
      const label = bgg ? t('detail.playtimeReset', { value: bgg }) : t('detail.playtimeClear');
      reset = formRows ? editorRowButton('ti-refresh', label) : h(`<button type="button" class="link-btn pp-reset">${esc(label)}</button>`);
      reset.addEventListener('click', () => {
        close();
        updateGame({ playtimeOverride: null });
      });
    }

    if (formRows) {
      const row = h(`<div class="editor-row" role="group" aria-labelledby="ptLabel">
          <span class="editor-row__label" id="ptLabel">${esc(t('detail.playtimeLabel'))}</span>
          <span class="editor-row__control"></span>
        </div>`);
      row.querySelector('.editor-row__control').append(min, h('<span aria-hidden="true">–</span>'), max);
      el.append(row);
      if (reset) el.append(reset);
      el.append(editorActions(okBtn));
      return () => { min.focus(); min.select(); };
    }
    const row = h('<div class="pp-row"></div>');
    row.append(min, h('<span aria-hidden="true">–</span>'), max, okBtn);
    el.appendChild(h(`<div class="muted pp-hint">${esc(t('detail.playtimeLabel'))}</div>`));
    el.appendChild(row);
    if (reset) el.appendChild(reset);
    return () => { min.focus(); min.select(); };
  });
}
