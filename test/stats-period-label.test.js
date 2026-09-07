'use strict';

/*
 * The Discover podium's period labels (#964), under a NEGATIVE-OFFSET timezone.
 *
 * TZ IS SET BEFORE ANYTHING IS REQUIRED, and it is the point of the file. The
 * payload names its month as a bare "YYYY-MM" key, and the natural way to
 * render that — hand the period's boundary instant to `fmtMonth` — is wrong for
 * every reader west of UTC: an instant at or near UTC midnight on the 1st is
 * still the PREVIOUS month locally, so the card would confidently name the
 * wrong one. Under the default UTC of a CI runner that bug is invisible, which
 * is why this file pins America/Los_Angeles rather than adding a case next door.
 */
process.env.TZ = 'America/Los_Angeles';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./support/dom');

const PAYLOAD = {
  generatedAt: '2026-09-07T10:00:00.000Z',
  games: {
    playedWeek: { title: 'Ark Nova', image: null, url: null, plays: 9 },
    playedMonth: { title: 'Cascadia', image: null, url: null, plays: 31, period: '2026-09' },
    playedYear: { title: 'Wingspan', image: null, url: null, plays: 402, period: '2026' },
  },
};

function boot(t) {
  const dom = loadApp({ locale: 'de' });
  t.after(() => dom.close());
  dom.set('fetch', async (url) => {
    if (String(url).startsWith('/api/stats/public')) return { ok: true, json: async () => PAYLOAD };
    if (String(url).startsWith('/api/config')) return { ok: true, json: async () => ({}) };
    throw new Error(`unexpected fetch: ${url}`);
  });
  dom.set('accountsActive', () => true);
  dom.set('isLoggedIn', () => false);
  return dom;
}

test('fmtMonthKey names the month the key names, not the reader’s', async (t) => {
  const dom = boot(t);

  assert.equal(await dom.call('fmtMonthKey', '2026-09'), 'September 2026');
  assert.equal(await dom.call('fmtMonthKey', '2026-01'), 'Januar 2026');

  /* THE CONTROL, and the reason the two lines above are not trivially true:
     the same month rendered from its own UTC boundary instant — the obvious
     implementation — reads AUGUST here, eight hours west of UTC. If this
     assertion ever fails, the harness is running in UTC and the two above have
     stopped discriminating. */
  assert.equal(await dom.call('fmtMonth', '2026-09-01T00:00:00.000Z'), 'August 2026');

  // Garbage is a blank, never a literal placeholder or an "Invalid Date".
  for (const bad of ['', null, undefined, '2026', 'September', '2026-9']) {
    assert.equal(await dom.call('fmtMonthKey', bad), '', `expected '' for ${JSON.stringify(bad)}`);
  }
});

test('the month and year cards name their period; the week card does not', async (t) => {
  const dom = boot(t);
  await dom.call('showEntdecken');

  const labels = [...dom.document.querySelectorAll('.stats-card__label')].map((n) => n.textContent.trim());
  assert.deepEqual(labels, [
    'Meistgespielt diese Woche',
    'Meistgespielt im September 2026',
    'Meistgespielt 2026',
  ]);
});
