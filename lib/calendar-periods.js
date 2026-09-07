'use strict';

/*
 * Calendar period boundaries on ONE fixed zone (#964).
 *
 * The Discover podiums are LABELLED with calendar periods („diese Woche",
 * „diesen Monat", „dieses Jahr") and were computed over ROLLING ones — the last
 * 7, 30 and 365 days. On any date that is not a Monday / the 1st / January 1st
 * the label and the window described different periods, and the year card was
 * the worst of the three: on 2026-09-07 „dieses Jahr" counted mostly 2025.
 *
 * WHY ONE FIXED ZONE, AND WHY IT IS THE SERVER'S. The payload is built
 * server-side and cached process-wide (lib/scheduler.js rebuilds it every
 * 15 min), so one set of numbers is served to every visitor — the client cannot
 * recompute a boundary for its own zone without recomputing the counts, which
 * it never sees. Europe/Berlin is the operator's own calendar and matches the
 * only two other server-side date renderings (lib/routes/contact.js,
 * lib/routes/admin.js).
 *
 * THAT IS THE OPPOSITE CHOICE FROM public/js/period-recap.js, deliberately.
 * The Chronik's per-period recap buckets on the DEVICE's local calendar,
 * because it is derived on demand for one round from a payload that reader
 * already holds — so it can afford to answer "your July". This one cannot, and
 * a card that said „diesen Monat" while meaning a different month per reader
 * would be worse than a card that names the month it means. Hence the period
 * identity travelling in the payload: the label cannot disagree with the window
 * it describes, because it is derived from it.
 *
 * Both repo backends derive their cutoffs from here rather than each spelling
 * the arithmetic — Postgres could do it natively with date_trunc(… AT TIME ZONE
 * …), but then two independent implementations would have to agree, and
 * test/support/repo-contract.js compares them.
 *
 * A ROLLOVER IS PICKED UP WITHIN THE SCHEDULER'S TICK, not at the stroke of
 * midnight: lib/scheduler.js rebuilds the payload every 15 minutes, so for up to
 * a quarter of an hour after a period ends the cached podium still describes the
 * old one. That is fine and needs no timer of its own — the counts are a public
 * summary, not a clock — but it is why the period's identity travels WITH the
 * counts rather than being derived at render time, which would disagree.
 *
 * DST IS THE TRAP, and it is avoided by construction rather than handled:
 * nothing here is of the shape "midnight minus N hours", which is wrong twice a
 * year (2026-03-29 is a 23-hour day in Berlin and 2026-10-25 a 25-hour one).
 * Every boundary is built as a CALENDAR date and then resolved to the instant
 * its local midnight begins.
 */

const ZONE = 'Europe/Berlin';

// One formatter per zone — constructing an Intl.DateTimeFormat is not cheap and
// each boundary costs two reads. Keyed by zone because `localMidnight` takes
// one: production only ever passes ZONE, but the second pass below is
// unreachable at Berlin's offset and would otherwise be untestable (see there).
//
// `hourCycle: 'h23'` rather than `hour12: false` — the latter renders midnight
// as hour "24" in some ICU builds, which would push every boundary a day out.
const FORMATTERS = new Map();
function formatterFor(zone) {
  let fmt = FORMATTERS.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTERS.set(zone, fmt);
  }
  return fmt;
}

// The zone's wall-clock reading of an instant, as numbers.
function zoneParts(ms, zone) {
  const out = {};
  for (const p of formatterFor(zone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

// The zone's UTC offset in ms at that instant: what its wall clock reads, minus
// what the clock in UTC reads.
function offsetAt(ms, zone) {
  const p = zoneParts(ms, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}

/*
 * The instant at which local midnight of the calendar date Y-M-D begins in
 * `zone`. The module's one primitive: every boundary is a calendar date resolved
 * through here, which is what keeps DST out of the arithmetic entirely — nothing
 * is ever "midnight minus N × 86400000", the shape that is wrong twice a year.
 *
 * TWO PASSES. The first offset is read at the GUESSED instant (00:00 UTC of that
 * date), which can sit on the far side of a transition from the midnight being
 * looked for; the guess is then corrected and the offset re-read where the
 * answer actually lands.
 *
 * THE SECOND PASS CANNOT BE EXERCISED THROUGH ZONE, and that is exactly why this
 * function is exported and takes its zone. 00:00 UTC is 01:00/02:00 Berlin on
 * the SAME date, always later than local midnight and never across Berlin's
 * 02:00 switch, so for Berlin the two passes provably agree — measured, with the
 * second pass deleted the whole periodBoundaries suite stayed green. Deleting it
 * would leave the module correct only by an argument about one zone's offset
 * size, silently wrong the day ZONE moves. So it keeps the general form and
 * test/calendar-periods.test.js pins it at Pacific/Auckland, where 00:00 UTC
 * lands at 12:00–13:00 local and a 02:00 transition really does fall in between.
 */
function localMidnight(zone, year, month, day) {
  const naive = Date.UTC(year, month - 1, day);
  const first = naive - offsetAt(naive, zone);
  return naive - offsetAt(first, zone);
}

/*
 * The three calendar boundaries containing `nowIso`, plus the identity of the
 * month and the year so a card can name the period it is showing.
 *
 * A PURE FUNCTION OF `nowIso`, which is why lib/public-stats.js may call it
 * separately from the repo backends instead of threading one result through:
 * the same instant yields the same boundaries, so the payload's period label
 * cannot describe a different window than the counts beside it.
 *
 * The week needs no identity — the cards name the month and the year, and
 * nobody reads calendar-week numbers.
 */
function periodBoundaries(nowIso = new Date().toISOString()) {
  const parsed = Date.parse(nowIso);
  const at = Number.isFinite(parsed) ? parsed : Date.now();
  const p = zoneParts(at, ZONE);

  // ISO-8601 weeks start on MONDAY. The weekday is read off the bare calendar
  // date in UTC, where no transition can move it, rather than off the instant.
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - ((dow + 6) % 7)));

  const iso = (ms) => new Date(ms).toISOString();
  return {
    week: iso(localMidnight(ZONE, monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate())),
    month: iso(localMidnight(ZONE, p.year, p.month, 1)),
    year: iso(localMidnight(ZONE, p.year, 1, 1)),
    monthKey: `${p.year}-${String(p.month).padStart(2, '0')}`,
    yearKey: String(p.year),
  };
}

module.exports = { periodBoundaries, localMidnight, ZONE };
