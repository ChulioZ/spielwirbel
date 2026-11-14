/* Spielwirbel – the evening's photo on the results screen (#1774).

   One photo per played session: add, replace, remove. The block sits after the
   points in every design and keeps one shape across them — a framed picture
   with its two actions under it, or, before there is one, a single „Foto
   hinzufügen" button with the consent hint beside it.

   It reads its phase from the result screen's context (`rs`, views-session.js)
   rather than from the session object alone, because the screen changes that
   phase after render: „Als gespielt markieren" turns a session played without
   re-rendering this block, so resultRenderBand() calls `rs.photoRefresh()` on
   every phase change, the same way it repaints the foot.

   Shown when:
     - the session HAS a photo — in any state, so a photo whose result was reset
       (or whose played game was deleted) stays visible and removable;
     - or it is played and not cancelled — the one state that may take one,
       which is also what the route enforces (409 `not_played`).

   Load order: after core.js (h, esc, api, toast) and confirm-dialog.js, before
   views-session.js, which calls renderSessionPhoto at render time. */

'use strict';

// The route's codes, mapped to the message a person can act on. The cap and an
// unreadable file are the two worth stating precisely; everything else is the
// generic failure.
function sessionPhotoErrorKey(code) {
  if (code === 'photo_too_large') return 'result.photo.err.tooLargeServer';
  if (code === 'invalid_image') return 'result.photo.err.invalid';
  if (code === 'quota_photos') return 'result.photo.err.quota';
  return 'result.photo.err.generic';
}

function renderSessionPhoto(rs) {
  const { round, session } = rs;
  const url = `/api/rounds/${round.id}/sessions/${session.id}/photo`;
  const el = h('<section class="session-photo" hidden></section>');

  // `capture` is deliberately NOT set: on a phone it would open the camera
  // only, and a photo of the board is as often already in the gallery.
  const file = h('<input type="file" accept="image/*" class="session-photo__file" hidden>');

  const upload = async (chosen) => {
    if (chosen.size > PHOTO_MAX_BYTES) {
      toast(t('result.photo.err.tooLarge', { mb: PHOTO_MAX_MB }), { tone: 'error' });
      return;
    }
    const body = new FormData();
    body.append('photo', chosen);
    el.classList.add('is-busy');
    try {
      const saved = await api('PUT', url, body);
      session.photo = saved.photo;
      toast(t('result.photo.toast.saved'));
    } catch (e) {
      toast(t(sessionPhotoErrorKey(e.message), { mb: PHOTO_MAX_MB }), { tone: 'error' });
    } finally {
      el.classList.remove('is-busy');
      paint();
    }
  };

  file.addEventListener('change', () => {
    const chosen = file.files && file.files[0];
    file.value = ''; // so picking the same file again still fires `change`
    if (chosen) upload(chosen);
  });

  const remove = async () => {
    if (!await confirmDialog({
      body: t('result.photo.removeConfirm'),
      confirmLabel: t('result.photo.remove'), icon: 'ti-trash',
    })) return;
    try {
      await api('DELETE', url);
      delete session.photo;
      toast(t('result.photo.toast.removed'));
    } catch {
      toast(t('result.photo.err.generic'), { tone: 'error' });
    }
    paint();
  };

  function paint() {
    const photo = session.photo || null;
    const canAdd = rs.finished && !rs.cancelled;
    el.replaceChildren();
    el.hidden = !photo && !canAdd;
    if (el.hidden) return;
    el.appendChild(file);

    if (photo) {
      const fig = h(`<figure class="session-photo__frame">
           <img class="session-photo__img" src="${esc(photo)}" alt="${esc(t('result.photo.alt'))}" decoding="async">
         </figure>`);
      const actions = h('<div class="session-photo__actions"></div>');
      const replace = h(`<button class="link-btn" type="button">${iconText('ti-camera-plus', t('result.photo.replace'))}</button>`);
      replace.addEventListener('click', () => file.click());
      const drop = h(`<button class="link-btn" type="button">${iconText('ti-trash', t('result.photo.remove'))}</button>`);
      drop.addEventListener('click', remove);
      actions.append(replace, drop);
      el.append(fig, actions);
      return;
    }

    const add = h(`<button class="btn btn--ghost session-photo__add" type="button">${iconText('ti-camera-plus', t('result.photo.add'))}</button>`);
    add.addEventListener('click', () => file.click());
    // The consent hint sits with the button that uploads, where the decision is
    // made — a photo can show people, and they should have agreed to it.
    el.append(add, h(`<p class="session-photo__hint muted">${esc(t('result.photo.hint'))}</p>`));
  }

  paint();
  rs.photoRefresh = paint;
  return el;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sessionPhotoErrorKey };
}
