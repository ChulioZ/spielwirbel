/* Spielwirbel – the round's „Wer zu kurz kommt, ist dran" setting (#1777,
   redefined by #1830) and the one line that names who it favours tonight.

   The setting is a per-round toggle, off by default. With it on, a member who
   recently played games they did not enjoy gets more say: the SERVER draw
   (lib/draw-boost.js — there is no client re-draw) favours their favourites,
   and a session started with it on (`session.voteBoost`) weighs their ballot
   more in the result. Who that is comes from vote-boost.js, never from a
   stored list.

   Its own file rather than more of views-round-settings.js, which sits at its
   700-line budget (.claude/rules/token-friendly-source-files.md).

   Part of the frontend's shared global scope; every sibling name is read at
   call time (.claude/rules/frontend-script-load-order.md). */

'use strict';

/* The Einstellungen section: a heading (so every design's composition groups it
   as its own section, like the saved filters) and one checkbox row. */
function renderDrawBoostSection(round) {
  const frag = document.createDocumentFragment();
  frag.appendChild(h(`<h2 class="rs-section__h" id="drawBoostHeading">${esc(t('drawBoost.title'))}</h2>`));
  const row = h(`<label class="ds-row konto-notify__row draw-boost__row">
      <div class="ds-row__main"><span>${esc(t('drawBoost.label'))}</span>
        <span class="field__hint muted">${esc(t('drawBoost.note'))}</span></div>
      <div class="ds-row__meta"><input type="checkbox" class="provider-row__box" /></div>
    </label>`);
  const box = row.querySelector('input');
  box.checked = round.drawBoost === true;
  box.addEventListener('change', async () => {
    const on = box.checked;
    box.disabled = true;
    try {
      await api('PATCH', `/api/rounds/${round.id}/draw-boost`, { on });
      // Keep the held round and its SWR entry in step, so the next render does
      // not paint the old state from cache (the marker picker's reason).
      if (on) round.drawBoost = true;
      else delete round.drawBoost;
      swrStore.set('round:' + round.id, round);
      toast(t(on ? 'drawBoost.toast.on' : 'drawBoost.toast.off'));
    } catch (e) {
      box.checked = !on;
      toast(e.message, { tone: 'error' });
    } finally {
      box.disabled = false;
    }
  });
  const list = h('<div class="ds-list" aria-labelledby="drawBoostHeading"></div>');
  list.appendChild(row);
  frag.appendChild(list);
  return frag;
}

/* The hint, or null: „Anna und Ben haben heute etwas mehr Mitsprache" (#1830).
   Shown on the lobby and on the result screen of a session that started with
   the boost on, naming the seated members who are boosted — the same members
   whose ballots the result weighs (vote-boost.js), so it cannot announce a say
   the screen does not give. No numbers, by the voting stance: faces, not
   percentages. */
function voteBoostNote(round, session) {
  const ids = boostedSeatIds(round, session);
  if (!ids.length) return null;
  const names = ids.map((id) => (round.members.find((m) => m.id === id) || {}).name).filter(Boolean);
  if (!names.length) return null;
  return h(`<p class="muted vote-boost-note"><i class="ti ti-heart" aria-hidden="true"></i>
      ${esc(tn(names.length, 'voteBoost.hintOne', 'voteBoost.hint', { names: joinNames(names) }))}</p>`);
}
