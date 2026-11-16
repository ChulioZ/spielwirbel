'use strict';

/*
 * The operator panel's „Spieleinstellungen" card (#1786): BGG games rounds have
 * scored, with how many rounds set lowest-wins vs. left the default, and the
 * three actions — confirm a direction for every round, „Zurückstellen", and
 * „Bestätigung aufheben". Its own IIFE beside js/pages/admin.js rather than more
 * lines in that file (#970), started by the `admin:panel` event admin.js
 * dispatches once the operator is signed in, which also hands over the shared
 * row dialog (`openDetail`). German-only like the rest of the page.
 *
 * textContent everywhere: a title is the corpus name when BGG's dump knows the
 * game, but otherwise one a round typed, and this page runs with operator
 * privileges.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$('scoringCard')) return;

  const STATE_LABELS = { open: 'offen', confirmed: 'bestätigt', dismissed: 'zurückgestellt' };
  const MESSAGES = {
    not_found: 'Dieses Spiel steht nicht (mehr) in der Liste.',
    not_confirmed: 'Für dieses Spiel ist nichts festgelegt.',
    admin_auth_required: 'Sitzung abgelaufen. Bitte neu anmelden.',
  };

  let openDetail = null;
  let games = [];

  async function api(path, options) {
    const res = await fetch(`/api/admin${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
    let body = {};
    try { body = await res.json(); } catch { /* a non-JSON error page — keep the status */ }
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  function say(text, kind) {
    const el = $('scoringMsg');
    el.textContent = text;
    el.className = `msg msg--${kind}`;
    el.hidden = false;
  }
  const fail = (err) => say(MESSAGES[err.message] || err.message, 'err');

  const stateQuery = () => {
    const v = $('scoringState').value;
    return v ? `?state=${encodeURIComponent(v)}` : '';
  };

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE') : '—');
  const fixed = (g) => (g.lowScoreWins == null ? '—' : g.lowScoreWins ? 'Niedrigste gewinnt' : 'Höchste gewinnt');

  function cell(row, text, head) {
    const el = document.createElement(head ? 'th' : 'td');
    el.textContent = text;
    row.appendChild(el);
  }

  function render() {
    const body = $('scoringTable').tBodies[0];
    body.replaceChildren();
    const head = document.createElement('tr');
    ['Spiel', 'Runden', 'Niedrigste', 'Höchste', 'Status'].forEach((h) => cell(head, h, true));
    body.appendChild(head);
    if (!games.length) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'Keine Spiele in dieser Ansicht.';
      row.appendChild(td);
      body.appendChild(row);
    }
    for (const g of games) {
      const row = document.createElement('tr');
      cell(row, g.title || `BGG ${g.bggId}`);
      cell(row, String(g.rounds));
      cell(row, String(g.lowWins));
      cell(row, String(g.highWins));
      cell(row, g.state === 'confirmed' ? `${STATE_LABELS.confirmed}: ${fixed(g)}` : STATE_LABELS[g.state]);
      // Row → the shared dialog, like every table on this page
      // (.claude/rules/admin-moderation-surface.md §6: tabindex + haspopup,
      // never role=button).
      row.tabIndex = 0;
      row.setAttribute('aria-haspopup', 'dialog');
      row.addEventListener('click', () => open(g));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(g); }
      });
      body.appendChild(row);
    }
    const count = $('scoringCount');
    count.textContent = `${games.length} ${games.length === 1 ? 'Spiel' : 'Spiele'}`;
    count.hidden = false;
  }

  function open(g) {
    const actions = g.state === 'confirmed'
      ? [['Bestätigung aufheben', 'ghost small', () => act(g, { action: 'revoke' })]]
      : [
        ['Höchste gewinnt bestätigen', 'small', () => act(g, { action: 'confirm', lowScoreWins: false })],
        ['Niedrigste gewinnt bestätigen', 'small', () => act(g, { action: 'confirm', lowScoreWins: true })],
        ...(g.state === 'open' ? [['Zurückstellen', 'ghost small', () => act(g, { action: 'dismiss' })]] : []),
      ];
    openDetail({
      title: g.title || `BGG ${g.bggId}`,
      pairs: [
        ['BGG-ID', g.bggId],
        ['Runden mit Punkten', String(g.rounds)],
        ['Niedrigste gewinnt', String(g.lowWins)],
        ['Höchste gewinnt', String(g.highWins)],
        ['Status', STATE_LABELS[g.state]],
        ['Festgelegt', g.state === 'confirmed' ? fixed(g) : null],
        ['Festgelegt am', g.state === 'confirmed' ? fmt(g.confirmedAt) : null],
      ],
      text: g.state === 'confirmed'
        ? 'Gilt in allen Runden. Aufheben stellt die Einstellung jeder Runde wieder her.'
        : 'Bestätigen legt die Richtung für alle Runden fest — auch für die, die es anders eingestellt haben.',
      actions,
    });
  }

  async function act(g, body) {
    if (body.action === 'revoke'
      && !window.confirm(`Bestätigung für „${g.title || g.bggId}" aufheben? Jede Runde hat danach wieder ihre eigene Einstellung.`)) return;
    try {
      await api(`/game-scoring/${encodeURIComponent(g.bggId)}`, { method: 'POST', body: JSON.stringify(body) });
      await load();
      say('Gespeichert.', 'ok');
    } catch (err) {
      fail(err);
    }
  }

  async function load() {
    try {
      ({ games } = await api(`/game-scoring${stateQuery()}`));
      render();
    } catch (err) {
      fail(err);
    }
  }

  function download(blob, ext) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spielwirbel-spieleinstellungen-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    // Revoked on the next tick, not inline — see exportUser() in admin.js.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // The CSV is built SERVER-side (lib/csv.js: quoting and formula leads), so the
  // download and the clipboard both fetch it rather than joining cells here.
  async function csvText(copy) {
    const q = stateQuery();
    const res = await fetch(`/api/admin/game-scoring.csv${q}${copy ? `${q ? '&' : '?'}copy=1` : ''}`);
    if (!res.ok) {
      const failed = await res.json().catch(() => ({}));
      throw new Error(failed.error || `HTTP ${res.status}`);
    }
    return res;
  }

  $('scoringState').addEventListener('change', () => { $('scoringMsg').hidden = true; load(); });

  $('scoringCsv').addEventListener('click', async () => {
    try { download(await (await csvText(false)).blob(), 'csv'); } catch (err) { fail(err); }
  });

  $('scoringJson').addEventListener('click', () => {
    download(new Blob([JSON.stringify({ games }, null, 2)], { type: 'application/json' }), 'json');
  });

  $('scoringCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(await (await csvText(true)).text());
      say('In die Zwischenablage kopiert.', 'ok');
    } catch (err) {
      fail(err);
    }
  });

  document.addEventListener('admin:panel', (e) => {
    openDetail = e.detail.openDetail;
    load();
  });
}());
