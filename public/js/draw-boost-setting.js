/* Spielwirbel – the round's draw-boost setting (#1777, „Wer zu kurz kommt, ist
   dran") and the lobby's one line about it.

   The setting is a per-round toggle, off by default. With it on the SERVER draw
   (lib/draw-boost.js — the only implementation, there is no client re-draw)
   gives the favourites of the seated member whose favourites reached the table
   least a better chance of entering the vote. Nothing here computes who that
   is: the lobby names the member the server stored on the session
   (`drawBoostMemberId`), present only when the boost actually changed the odds.

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

/* The lobby's line, or null: „Heute mit Extra-Chance für die Lieblingsspiele
   von Ben". No numbers, by the issue's voting stance — it says that the boost
   applied and for whom, never by how much. */
function drawBoostNote(round, session) {
  const mid = session && session.drawBoostMemberId;
  const member = mid && (round.members || []).find((m) => m.id === mid);
  if (!member) return null;
  return h(`<p class="muted live-vote__boost"><i class="ti ti-heart" aria-hidden="true"></i>
      ${esc(t('lobby.drawBoost', { name: member.name }))}</p>`);
}
