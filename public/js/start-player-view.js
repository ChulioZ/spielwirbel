/* Spielwirbel – „Wer fängt an?" (#1769): the button and the short whirl over
   the people at the table, offered on the results screen of a decided session
   and in the „Jetzt spielen" sheet once two parties sit at the table.

   One builder for both entry points, so the two cannot drift. The caller hands
   a `getParties()` that answers the CURRENT parties (sessionParties, or the
   direct-play sheet's live pickers through draftSession) and calls `refresh()`
   whenever they may have changed. The answer is shown, never stored, and
   „Nochmal" draws again.

   Under prefers-reduced-motion there is no whirl — the answer appears at once.
   Either way the sentence is spoken through the silent live region
   (announce(), live-region.js); the lit chips are aria-hidden, because a reader
   being read every step of a spin is noise, not information.

   Each design paints it in its own stylesheet; the markup is the same
   everywhere. DOM, so no module.exports — the pure half is start-player.js. */

function startPlayerReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch { return false; }
}

function renderStartPlayer(round, getParties) {
  const el = h(`<section class="start-player" hidden>
      <button type="button" class="btn start-player__go"></button>
      <ul class="start-player__ring" role="list" aria-hidden="true"></ul>
      <p class="start-player__answer"></p>
    </section>`);
  const btn = el.querySelector('.start-player__go');
  const ring = el.querySelector('.start-player__ring');
  const answer = el.querySelector('.start-player__answer');
  let parties = [];
  let key = null; // null: the first refresh always builds (labels the button)
  let timer = null;
  let drawn = false;

  const label = () => {
    btn.innerHTML = drawn
      ? iconText('ti-refresh', t('startPlayer.again'))
      : iconText('ti-arrows-shuffle', t('startPlayer.button'));
  };

  const face = (p) => `<span class="avatar${p.guest ? ' avatar--guest' : ''}"${p.guest ? '' : ` style="background:${memberColor(round, p.id)}"`}>${avatarFace(initials(p.name), { userId: p.userId })}</span>`;

  const reset = () => {
    clearTimeout(timer);
    timer = null;
    drawn = false;
    el.removeAttribute('aria-busy');
    answer.textContent = '';
    ring.innerHTML = parties.map((party) => `<li class="start-player__seat" data-id="${esc(party.id)}">
        <span class="start-player__faces">${party.people.map(face).join('')}</span>
        <span class="start-player__name">${esc(party.name)}</span>
      </li>`).join('');
    label();
  };

  const seats = () => [...ring.children];
  const light = (idx) => seats().forEach((s, i) => s.classList.toggle('is-lit', i === idx));

  const land = (idx) => {
    timer = null;
    el.removeAttribute('aria-busy');
    light(-1);
    seats().forEach((s, i) => s.classList.toggle('is-picked', i === idx));
    const party = parties[idx];
    const msg = t(party.team ? 'startPlayer.answerTeam' : 'startPlayer.answer', { name: party.name });
    answer.textContent = msg;
    announce(msg);
    drawn = true;
    label();
  };

  btn.addEventListener('click', () => {
    if (timer || !canDrawStartPlayer(parties)) return;
    const pick = pickStartPlayer(parties);
    const idx = parties.indexOf(pick);
    answer.textContent = '';
    seats().forEach((s) => s.classList.remove('is-picked'));
    if (startPlayerReducedMotion()) { land(idx); return; }
    const seq = startPlayerWhirl(parties.length, idx);
    const delays = whirlDelays(seq.length);
    el.setAttribute('aria-busy', 'true');
    let i = 0;
    const step = () => {
      // The screen re-rendered under the whirl: stop quietly.
      if (!el.isConnected) { timer = null; return; }
      if (i >= seq.length) { land(idx); return; }
      light(seq[i]);
      timer = setTimeout(step, delays[i]);
      i += 1;
    };
    step();
  });

  el.refresh = () => {
    parties = getParties() || [];
    el.hidden = !canDrawStartPlayer(parties);
    const next = parties.map((p) => `${p.id}:${p.name}`).join('|');
    // A different table invalidates the answer; the same one keeps it.
    if (next !== key) { key = next; reset(); }
  };
  el.refresh();
  return el;
}
