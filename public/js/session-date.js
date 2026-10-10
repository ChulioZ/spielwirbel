/* Spielwirbel – a session's DAY, when it is not today (#1616), and its
   optional TIME (#1629).

   Three pieces, all DOM:
   - `playedOnField`, the „Wann?" field the direct-play sheet carries — a day
     and an optional time;
   - `showSessionDateSheet`, moving a finished session to another day or time —
     opened from the results screen's rare actions;
   - `showLogSessionPicker`, the Chronik's „Session nachtragen": pick a game
     from the shelf, then the SAME direct-play sheet, dated yesterday.

   The arithmetic lives in played-on.js (pure, shared with the server); this
   file only renders and posts. No `module.exports`: DOM. */

let playedOnFieldSeq = 0;

// Set by a caller that is about to open a freshly LOGGED session's results, and
// consumed once by showResults: that screen opens a finished session on its
// picture, with the winner picker shut — right for an evening looked up later,
// wrong for one entered a moment ago, where the next question is who won.
let resultPickerOpenFor = null;
function openResultPickerOnce(sid) { resultPickerOpenFor = sid; }
function takeResultPickerOpen(sid) {
  const open = !!sid && resultPickerOpenFor === sid;
  resultPickerOpenFor = null;
  return open;
}

// The „Wann?" field: a native date input — the platform's own calendar on
// every device, already localised — bounded to PLAYED_ON_MIN…today, beside an
// OPTIONAL native time input (#1629). An empty time means „we only know the
// day": the session is stored at the 20:00 stand-in and shown by date alone.
// The ✕ empties the time, because not every platform's time input can be
// cleared by hand (iOS cannot). `value()` reads the day key ('YYYY-MM-DD', or
// '' while cleared) and `time()` the 'HH:MM', or ''. `note` replaces the hint
// under the inputs; '' drops it (the change sheet states its own above).
function playedOnField(dayKey, note, timeKey = '') {
  const id = `playedOn-${++playedOnFieldSeq}`;
  const today = localDayKey(new Date());
  const timeLabel = t('playedOn.timeLabel');
  const wrap = h(`<div class="field played-on">
      <label for="${id}">${esc(t('playedOn.label'))}</label>
      <div class="row played-on__row">
        <input id="${id}" class="input played-on__input" type="date" min="${PLAYED_ON_MIN}" max="${today}" value="${esc(dayKey || today)}">
        <span class="played-on__at">
          <input class="input played-on__time" type="time" aria-label="${esc(timeLabel)}" title="${esc(timeLabel)}" value="${esc(timeKey)}">
          <button type="button" class="played-on__clear" aria-label="${esc(t('playedOn.timeClear'))}" title="${esc(t('playedOn.timeClear'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </span>
      </div>
      ${note === '' ? '' : `<p class="field__hint muted">${esc(note || t('playedOn.timeHint'))}</p>`}
    </div>`);
  const input = wrap.querySelector('.played-on__input');
  const timeInput = wrap.querySelector('.played-on__time');
  const clear = wrap.querySelector('.played-on__clear');
  const syncClear = () => { clear.hidden = !timeInput.value; };
  timeInput.addEventListener('input', syncClear);
  timeInput.addEventListener('change', syncClear);
  clear.addEventListener('click', () => {
    timeInput.value = '';
    syncClear();
    // So a caller listening for changes (the direct-play button label) hears it.
    timeInput.dispatchEvent(new Event('change', { bubbles: true }));
    timeInput.focus();
  });
  syncClear();
  wrap.input = input;
  wrap.timeInput = timeInput;
  wrap.value = () => input.value;
  wrap.time = () => timeInput.value;
  return wrap;
}

// The field's { day, time } ('' for no time), or null with a toast when it is
// unusable: an empty or impossible day, one before PLAYED_ON_MIN or after
// today, or a time still ahead. The inputs' own min/max stop a picker from
// offering those days, but a typed value is not bounded by them, and a time
// input has no notion of „not later than now" at all.
function readPlayedOn(field) {
  const day = field.value();
  const time = field.time();
  if (!day || !playedOnInstant(day, new Date(), time)) {
    toast(t('playedOn.toast.invalid'), { tone: 'error' });
    return null;
  }
  if (day > localDayKey(new Date())) {
    toast(t('playedOn.toast.future'), { tone: 'error' });
    return null;
  }
  if (day < PLAYED_ON_MIN) {
    toast(t('playedOn.toast.invalid'), { tone: 'error' });
    return null;
  }
  if (isFuturePlayedOn(day, time)) {
    toast(t('playedOn.toast.futureTime'), { tone: 'error' });
    return null;
  }
  return { day, time };
}

// Move a finished session to another day or time. `onSaved(fresh, session)`
// re-renders the caller from the server's view, since every date-derived thing
// on the screen (the stamp, the Chronik's month, the recap) follows from it.
// The time starts filled with the session's own when it has a real one, and
// empty for a date-only session — so „Übernehmen" untouched changes nothing.
function showSessionDateSheet(round, session, onSaved) {
  const stamp = session.createdAt ? new Date(session.createdAt) : new Date();
  const current = localDayKey(stamp);
  const currentTime = isDateOnlySession(session) ? '' : localTimeKey(stamp);
  let field = null;
  openBulkPicker({ title: t('playedOn.changeTitle'), hint: t('playedOn.changeHint') }, (sheet) => {
    field = playedOnField(current, '', currentTime);
    sheet.querySelector('.sheet__actions').before(field);
    return field;
  }, async () => {
    const picked = readPlayedOn(field);
    if (!picked) return;
    if (picked.day === current && picked.time === currentTime) return;
    const playedOn = playedOnInstant(picked.day, new Date(), picked.time);
    try {
      await api('PATCH', `/api/rounds/${round.id}/sessions/${session.id}/date`, {
        playedOn,
        dateOnly: !picked.time,
      });
      toast(t('playedOn.toast.changed', { date: picked.time ? fmtDateTime(playedOn) : fmtDate(playedOn) }));
      const fresh = await fetchRoundFresh(round.id);
      const sess = fresh.sessions.find((s) => s.id === session.id) || session;
      onSaved(fresh, sess);
    } catch (e) { toast(e.message, { tone: 'error' }); }
  });
}

// The Chronik's „Session nachtragen": choose WHICH game was played, then hand
// over to the direct-play sheet with the date field set to yesterday — the
// common case, and the one that tells the user at once that the field is there
// to change. Shelf games only: the same isActiveGame predicate direct play
// itself enforces, so nothing is offered that the server would refuse.
function showLogSessionPicker(round) {
  const games = round.games.filter(isActiveGame)
    .slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const label = t('chronik.log.title');
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
        <div class="sheet__head">
          <h2>${esc(label)}</h2>
          <button class="sheet__close" type="button" aria-label="${esc(t('common.close'))}"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <p class="muted">${esc(t('chronik.log.hint'))}</p>
        <div class="field">
          <label for="logPickSearch">${esc(t('chronik.log.search'))}</label>
          <input id="logPickSearch" class="input" type="search" autocomplete="off" autocorrect="off" spellcheck="false">
        </div>
        <ul class="log-pick" role="list"></ul>
        <p class="muted log-pick__empty" hidden>${esc(t('chronik.log.none'))}</p>
      </div>
    </div>`);
  const sheet = backdrop.querySelector('.sheet');
  const list = sheet.querySelector('.log-pick');
  const empty = sheet.querySelector('.log-pick__empty');
  const search = sheet.querySelector('#logPickSearch');
  // Yesterday as a CALENDAR day: now − 24 h lands two days back in the first
  // hour after a DST change (.claude/rules/server-computed-calendar-periods.md §3).
  const now = new Date();
  const yesterday = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12));

  // One <button> per game: picking IS the action, so there is no OK step.
  games.forEach((g) => {
    const li = h(`<li><button type="button" class="ds-row log-pick__row" data-title="${esc(String(g.title).toLowerCase())}">
        <span class="ds-row__main">${esc(g.title)}</span>
        <span class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></span>
      </button></li>`);
    li.querySelector('button').addEventListener('click', () => {
      closeSheet(() => startDirectSession(round, g, { dayKey: yesterday }));
    });
    list.appendChild(li);
  });
  const filter = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    list.querySelectorAll('li').forEach((li) => {
      const hit = !q || li.firstElementChild.dataset.title.includes(q);
      li.hidden = !hit;
      if (hit) shown++;
    });
    empty.hidden = shown > 0;
  };
  search.addEventListener('input', filter);
  filter();

  document.body.appendChild(backdrop);
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeSheet(); });
  sheet.querySelector('.sheet__close').addEventListener('click', () => closeSheet());
  search.focus();
}
