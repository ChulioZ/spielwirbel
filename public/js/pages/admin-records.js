'use strict';

/*
 * The operator panel's „Spielwirbel-Rekorde" card (#1788): the flagged scores
 * to review („Gültig" / „Nicht werten") and the current instance-wide records,
 * where a record-holding score nobody flagged can be excluded too. Its own IIFE
 * beside js/pages/admin.js (#970), started by the `admin:panel` event, which
 * hands over the shared row dialog (`openDetail`). German-only like the page.
 *
 * Every row is identified by an opaque `ref` (a hash of the score key) — the
 * payload carries no round, tenant, member or account id, so there is nothing
 * here that could name the person behind a score. textContent everywhere.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$('recordsCard')) return;

  const REASONS = {
    session: 'mehr als 3× der Median der Session',
    jump: 'mehr als 2× über dem bisherigen Rekord',
    distribution: 'außerhalb der Verteilung (Q3 + 3×IQR)',
  };
  const MESSAGES = {
    not_found: 'Dieser Wert steht nicht (mehr) in der Liste.',
    admin_auth_required: 'Sitzung abgelaufen. Bitte neu anmelden.',
  };

  let openDetail = null;
  let data = { reviews: [], records: [] };

  async function api(path, options) {
    const res = await fetch(`/api/admin${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
    let body = {};
    try { body = await res.json(); } catch { /* a non-JSON error page — keep the status */ }
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  function say(text, kind) {
    const el = $('recordsMsg');
    el.textContent = text;
    el.className = `msg msg--${kind}`;
    el.hidden = false;
  }
  const fail = (err) => say(MESSAGES[err.message] || err.message, 'err');

  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE') : '—');
  const num = (v) => (v == null ? '—' : String(Math.round(v * 10) / 10).replace('.', ','));
  const name = (e) => e.title || `BGG ${e.bggId}`;
  const dir = (e) => (e.lowWins ? 'niedrigste gewinnt' : 'höchste gewinnt');

  function cell(row, text, head) {
    const el = document.createElement(head ? 'th' : 'td');
    el.textContent = text;
    row.appendChild(el);
  }

  function table(id, heads, rows, cells, onOpen) {
    const body = $(id).tBodies[0];
    body.replaceChildren();
    const head = document.createElement('tr');
    heads.forEach((h) => cell(head, h, true));
    body.appendChild(head);
    if (!rows.length) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = heads.length;
      td.textContent = 'Nichts in dieser Liste.';
      row.appendChild(td);
      body.appendChild(row);
    }
    for (const e of rows) {
      const row = document.createElement('tr');
      cells(e).forEach((c) => cell(row, c));
      // Row → the shared dialog (.claude/rules/admin-moderation-surface.md §6).
      row.tabIndex = 0;
      row.setAttribute('aria-haspopup', 'dialog');
      row.addEventListener('click', () => onOpen(e));
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(e); }
      });
      body.appendChild(row);
    }
  }

  function count(id, n, one, many) {
    const el = $(id);
    el.textContent = `${n} ${n === 1 ? one : many}`;
    el.hidden = false;
  }

  function render() {
    table('reviewsTable', ['Spiel', 'Punkte', 'Rekord', 'Status', 'Datum'], data.reviews,
      (e) => [name(e), String(e.points), e.record == null ? '—' : String(e.record), e.heldBack ? 'zurückgehalten' : 'zählt bis zur Entscheidung', fmt(e.at)],
      openReview);
    count('reviewsCount', data.reviews.length, 'Wert', 'Werte');
    table('recordsTable', ['Spiel', 'Rekord', 'Richtung', 'Wertungen', 'Runden'], data.records,
      (e) => [name(e), String(e.value), dir(e), String(e.count), String(e.rounds)],
      openRecord);
    count('recordsCount', data.records.length, 'Spiel', 'Spiele');
  }

  function openReview(e) {
    openDetail({
      title: `${name(e)}: ${e.points}`,
      pairs: [
        ['BGG-ID', e.bggId],
        ['Punkte', String(e.points)],
        ['Status', e.heldBack ? 'zurückgehalten (zählt noch nicht)' : 'zählt, bis entschieden ist'],
        ['Auffällig', e.reasons.map((r) => REASONS[r] || r).join('; ')],
        ['Richtung', dir(e)],
        ['Aktueller Rekord', e.record == null ? '—' : String(e.record)],
        ['Wertungen', String(e.count)],
        ['Median', num(e.median)],
        ['90. Perzentil', num(e.p90)],
        ['Spieler in der Session', e.players == null ? '—' : String(e.players)],
        ['Andere Punkte der Session', e.peers.length ? e.peers.join(', ') : '—'],
        ['Datum der Session', fmt(e.at)],
        ['Auffällig seit', fmt(e.flaggedAt)],
      ],
      text: 'Entscheidet nur über den Spielwirbel-Rekord. Die Rekorde und Punkte der Runde bleiben, wie sie sind.',
      actions: [
        ['Gültig', 'small', () => act(e.ref, 'valid')],
        ['Nicht werten', 'ghost small', () => act(e.ref, 'exclude')],
      ],
    });
  }

  function openRecord(e) {
    openDetail({
      title: `${name(e)}: ${e.value}`,
      pairs: [
        ['BGG-ID', e.bggId],
        ['Rekord', String(e.value)],
        ['Richtung', dir(e)],
        ['Wertungen', String(e.count)],
        ['Median', num(e.median)],
        ['90. Perzentil', num(e.p90)],
        ['Runden', String(e.rounds)],
        ['Aufgestellt am', fmt(e.recordAt)],
      ],
      text: e.refs.length > 1
        ? 'Mehrere Werte teilen diesen Rekord; „Nicht werten" nimmt den ersten davon heraus.'
        : '„Nicht werten" nimmt den Rekordwert dauerhaft heraus; der nächstbeste rückt nach.',
      actions: e.refs.length ? [['Nicht werten', 'ghost small', () => act(e.refs[0], 'exclude')]] : [],
    });
  }

  async function act(ref, action) {
    if (action === 'exclude'
      && !window.confirm('Diesen Wert dauerhaft aus dem Spielwirbel-Rekord nehmen? Die Runde selbst behält ihn.')) return;
    try {
      data = await api(`/game-records/${encodeURIComponent(ref)}`, { method: 'POST', body: JSON.stringify({ action }) });
      render();
      say('Gespeichert.', 'ok');
    } catch (err) {
      fail(err);
    }
  }

  async function load() {
    try {
      data = await api('/game-records');
      render();
    } catch (err) {
      fail(err);
    }
  }

  function download(blob, which, ext) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spielwirbel-rekorde-${which}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // The CSV is built server-side (lib/csv.js), so the download and the clipboard
  // both fetch it rather than joining cells here.
  async function csv(which, copy) {
    const res = await fetch(`/api/admin/game-records.csv?list=${which}${copy ? '&copy=1' : ''}`);
    if (!res.ok) {
      const failed = await res.json().catch(() => ({}));
      throw new Error(failed.error || `HTTP ${res.status}`);
    }
    return res;
  }

  for (const which of ['reviews', 'records']) {
    $(`${which}Csv`).addEventListener('click', async () => {
      try { download(await (await csv(which, false)).blob(), which, 'csv'); } catch (err) { fail(err); }
    });
    $(`${which}Json`).addEventListener('click', () => {
      download(new Blob([JSON.stringify({ [which]: data[which] }, null, 2)], { type: 'application/json' }), which, 'json');
    });
    $(`${which}Copy`).addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(await (await csv(which, true)).text());
        say('In die Zwischenablage kopiert.', 'ok');
      } catch (err) {
        fail(err);
      }
    });
  }

  document.addEventListener('admin:panel', (e) => {
    openDetail = e.detail.openDetail;
    load();
  });
}());
