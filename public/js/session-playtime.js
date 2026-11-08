/* Spielwirbel – a session's playing time on screen (#1770): the running line
 * on the results band while a game is on the table, the recorded minutes once
 * it was played, the sheet that sets or clears them, and the minutes field of a
 * logged evening („Session nachtragen", which has no timer).
 *
 * The rules — bounds, the timer's reading, the round's median — live in
 * session-duration.js, shared with the route; this file is only the DOM. The
 * band is drawn by resultRenderBand for every design, so these notes are too:
 * a design restyles `.tisch__note`, it does not fork it.
 *
 * Part of the frontend; all files share one global script scope (load order: see
 * index.html). */

// Minutes as the app already prints a playing time („110 Min."), so the timer,
// the record and the Spielepass line read in one unit.
function fmtPlayMinutes(n) {
  return t('gameInfo.playtimeValue', { n });
}

// The two fields the server decides, copied from a response onto the screen's
// session object. Deleted when absent, so a cleared choice stops the line.
function syncPlayClock(session, saved) {
  ['startedPlayingAt', 'durationMinutes'].forEach((k) => {
    if (saved && saved[k] != null) session[k] = saved[k];
    else delete session[k];
  });
}

// „Läuft seit 42 Min." — read off the stored start, so a reload or a second
// device shows the same figure. Refreshed every 30 s; the interval stops itself
// once the band is rebuilt and this node has left the document, so no screen
// change has to remember to clear it. No per-second writes, and none at all to
// the server: the start was stamped once.
const PLAY_TIMER_TICK_MS = 30000;

function playTimerNote(session) {
  if (!session.startedPlayingAt) return null;
  const note = h('<div class="tisch__note tisch__note--timer"><i class="ti ti-stopwatch" aria-hidden="true"></i> <span></span></div>');
  const label = note.querySelector('span');
  const paint = () => {
    const m = elapsedMinutes(session.startedPlayingAt, new Date().toISOString());
    label.textContent = t('result.timerRunning', { time: fmtPlayMinutes(m == null ? 0 : m) });
  };
  paint();
  const timer = setInterval(() => {
    if (!note.isConnected) { clearInterval(timer); return; }
    paint();
  }, PLAY_TIMER_TICK_MS);
  return note;
}

// „Gespielt: 110 Min." on a played session that has a figure; nothing otherwise
// (the „Mehr" menu's „Spieldauer eintragen" is the way to add one).
function playDurationNote(session) {
  if (!isValidDuration(session.durationMinutes)) return null;
  return h(`<div class="tisch__note tisch__note--duration">${iconText('ti-clock', t('result.durationPlayed', { time: fmtPlayMinutes(session.durationMinutes) }))}</div>`);
}

// A typed figure, as the route accepts it: '' clears (null), anything else must
// be a whole number of minutes in the shared bounds. Pure.
function parseDurationInput(text) {
  const raw = String(text == null ? '' : text).trim();
  if (raw === '') return { value: null };
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return isValidDuration(n) ? { value: n } : { error: true };
}

function durationInvalidToast() {
  toast(t('duration.toast.invalid', { min: DURATION_MIN, max: DURATION_MAX }), { tone: 'error' });
}

// A minutes input. Digits only, as the playing-time editor does it.
function durationInput(id, value) {
  const inp = h(`<input id="${id}" class="input duration-field__input" inputmode="numeric" maxlength="${String(DURATION_MAX).length}" autocomplete="off">`);
  if (value != null) inp.value = String(value);
  inp.addEventListener('input', () => {
    const digits = inp.value.replace(/\D/g, '');
    if (inp.value !== digits) inp.value = digits;
  });
  return inp;
}

let durationFieldSeq = 0;

// The logged evening's optional field („Session nachtragen", #1770). Shown only
// while the sheet LOGS — an evening played now is timed instead.
function durationField() {
  const id = `duration-${++durationFieldSeq}`;
  const wrap = h(`<div class="field duration-field">
      <label for="${id}">${esc(t('duration.logLabel'))}</label>
    </div>`);
  const input = durationInput(id, null);
  wrap.appendChild(input);
  wrap.input = input;
  wrap.read = () => parseDurationInput(input.value);
  return wrap;
}

// Set, change or clear a played session's minutes. Re-renders the caller from
// the server's view, like the date and points sheets beside it in „Mehr".
function showSessionDurationSheet(round, session, onSaved) {
  const current = isValidDuration(session.durationMinutes) ? session.durationMinutes : null;
  let input = null;
  openBulkPicker({ title: t('duration.sheetTitle'), hint: t('duration.sheetHint') }, (sheet) => {
    const id = `duration-${++durationFieldSeq}`;
    const field = h(`<div class="field duration-field"><label for="${id}">${esc(t('duration.label'))}</label></div>`);
    input = durationInput(id, current);
    field.appendChild(input);
    sheet.querySelector('.sheet__actions').before(field);
    return field;
  }, async () => {
    const parsed = parseDurationInput(input.value);
    if (parsed.error) return durationInvalidToast();
    if (parsed.value === current) return;
    try {
      await api('PUT', `/api/rounds/${round.id}/sessions/${session.id}/duration`, { durationMinutes: parsed.value });
      toast(t(parsed.value == null ? 'duration.toast.cleared' : 'duration.toast.saved'));
      const fresh = await fetchRoundFresh(round.id);
      const sess = fresh.sessions.find((s) => s.id === session.id) || session;
      onSaved(fresh, sess);
    } catch (e) { toast(e.message, { tone: 'error' }); }
  });
}
