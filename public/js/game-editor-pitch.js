/* Spielwirbel – the game page's pitch-line editor (#1837).
 *
 * A round writes one sentence about a game in its own words („Würfel als
 * Arbeiter, fies, 45 min"), and the vote card shows it under the title. This
 * file draws that line on the game page and the editor behind it; the vote
 * cards' half is `votePitchHtml` in vote-card-composed.js.
 *
 * Its own file rather than another editor in game-editors.js, which sits at its
 * token budget — the shape game-editor-playtime.js set: the same
 * `{ game, updateGame }` context, the same row builders under the designs that
 * draw T15a's form rows.
 *
 * The check is `gamePitchFrom` (game-pitch.js), the function the route
 * validates with, so the editor cannot accept a line the server refuses. No
 * `maxlength` on the input: it counts UTF-16 units while the shared check
 * counts characters, so an emoji-heavy line would be cut short here and
 * accepted there. The counter states the limit instead.
 *
 * Part of the frontend; all files share one global script scope (load order: see
 * index.html). */

// The pitch line on the game page: the text, as a button that opens the
// editor (the title's „activate to edit" pattern, but a real <button>, since a
// one-line block has no mid-line wrap to protect). Null when there is none —
// the empty state is a chip in the chip row instead, like the other editors.
function gamePitchLine(game, onEdit) {
  const text = typeof game.pitch === 'string' ? game.pitch.trim() : '';
  if (!text) return null;
  const el = h(`<button type="button" class="gd-pitch" title="${esc(t('pitch.edit'))}">${esc(text)}</button>`);
  el.addEventListener('click', () => onEdit(el));
  return el;
}

function openPitchPopover(ctx, anchor) {
  const { game, updateGame } = ctx;
  openEditor(anchor, 'pitch', t('pitch.title'), (el, close) => {
    const formRows = formSheetDesign();
    const inp = h('<input id="pitchInput" class="input pitch-input" type="text" autocomplete="off" aria-describedby="pitchCount" />');
    inp.placeholder = t('pitch.placeholder');
    inp.setAttribute('aria-label', t('pitch.title'));
    if (typeof game.pitch === 'string') inp.value = game.pitch;
    const count = h('<span class="muted pitch-count" id="pitchCount"></span>');
    const paint = () => {
      const n = [...inp.value.trim()].length;
      count.textContent = t('pitch.count', { n, max: GAME_PITCH_MAX });
      count.classList.toggle('is-over', n > GAME_PITCH_MAX);
    };
    inp.addEventListener('input', paint);
    paint();

    const okBtn = h(`<button class="btn btn--primary">${esc(t('common.apply'))}</button>`);
    const save = () => {
      const res = gamePitchFrom(inp.value);
      if (res.error) return toast(t('pitch.tooLong', { max: GAME_PITCH_MAX }));
      close();
      // Nothing to send when nothing changed — an unchanged Apply would only
      // cost a request and a „Gespeichert" toast for no change.
      if ((res.pitch || null) === (game.pitch || null)) return;
      updateGame({ pitch: res.pitch });
    };
    okBtn.addEventListener('click', save);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
    });

    // Remove — offered only while there is a line to remove.
    let clear = null;
    if (game.pitch) {
      const label = t('pitch.clear');
      clear = formRows ? editorRowButton('ti-trash', label, 'danger') : h(`<button type="button" class="link-btn pp-reset">${esc(label)}</button>`);
      clear.addEventListener('click', () => {
        close();
        updateGame({ pitch: null });
      });
    }

    if (formRows) {
      const row = h(`<div class="editor-row" role="group" aria-labelledby="pitchLabel">
          <span class="editor-row__label" id="pitchLabel">${esc(t('pitch.label'))}</span>
          <span class="editor-row__control"></span>
        </div>`);
      row.querySelector('.editor-row__control').append(inp, count);
      el.append(row);
      if (clear) el.append(clear);
      el.append(editorActions(okBtn));
      return () => { inp.focus(); inp.select(); };
    }
    el.appendChild(h(`<div class="muted pp-hint">${esc(t('pitch.label'))}</div>`));
    const row = h('<div class="pp-row pitch-row"></div>');
    row.append(inp, okBtn);
    el.appendChild(row);
    el.appendChild(count);
    if (clear) el.appendChild(clear);
    return () => { inp.focus(); inp.select(); };
  });
}
