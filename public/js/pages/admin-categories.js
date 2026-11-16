'use strict';

/*
 * The operator panel's „Wertungskategorien" card (#1787): per BGG game, every
 * distinct scoring-category set rounds have typed (#1780), with how many rounds
 * use it, and the three actions — confirm one set as the game's base for every
 * round (its spelling correctable first), „Zurückstellen", and „Bestätigung
 * aufheben". The sibling of js/pages/admin-scoring.js (#1786), started by the
 * same `admin:panel` event. German-only like the rest of the page.
 *
 * textContent and input.value everywhere: category names are text users typed
 * in private rounds, and this page runs with operator privileges.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$('categoriesCard')) return;

  const STATE_LABELS = { open: 'offen', confirmed: 'bestätigt', dismissed: 'zurückgestellt' };
  const MESSAGES = {
    not_found: 'Dieses Spiel steht nicht (mehr) in der Liste.',
    set_not_found: 'Diesen Satz legt keine Runde (mehr) an.',
    not_confirmed: 'Für dieses Spiel ist nichts bestätigt.',
    names_mismatch: 'Die Zahl der Kategorien darf sich nicht ändern.',
    invalid_names: 'Jede Kategorie braucht einen Namen (höchstens 30 Zeichen).',
    duplicate_names: 'Zwei Kategorien hätten danach denselben Namen.',
    admin_auth_required: 'Sitzung abgelaufen. Bitte neu anmelden.',
  };
  const SEP = ' · ';

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
    const el = $('categoriesMsg');
    el.textContent = text;
    el.className = `msg msg--${kind}`;
    el.hidden = false;
  }
  const fail = (err) => say(MESSAGES[err.message] || err.message, 'err');

  const stateQuery = () => {
    const v = $('categoriesState').value;
    return v ? `?state=${encodeURIComponent(v)}` : '';
  };

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE') : '—');
  // The same normalisation the server matches by (lib/game-categories.js).
  const norm = (names) => names.map((n) => String(n).trim().replace(/\s+/g, ' ').toLocaleLowerCase()).join('\u0001');

  function cell(row, text, head) {
    const el = document.createElement(head ? 'th' : 'td');
    el.textContent = text;
    row.appendChild(el);
  }

  // One row per game × set, and for a confirmed game whose base equals none of
  // the rounds' sets, one for the base itself.
  function rows() {
    const out = [];
    for (const g of games) {
      const base = g.categories ? norm(g.categories) : null;
      g.sets.forEach((set) => out.push({ g, set, isBase: base !== null && norm(set.names) === base }));
      if (base !== null && !g.sets.some((s) => norm(s.names) === base)) out.push({ g, set: { names: g.categories, rounds: 0 }, isBase: true });
    }
    return out;
  }

  function render() {
    const body = $('categoriesTable').tBodies[0];
    body.replaceChildren();
    const head = document.createElement('tr');
    ['Spiel', 'Kategorien', 'Runden', 'Status'].forEach((h) => cell(head, h, true));
    body.appendChild(head);
    const list = rows();
    if (!list.length) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = 'Keine Spiele in dieser Ansicht.';
      row.appendChild(td);
      body.appendChild(row);
    }
    for (const r of list) {
      const row = document.createElement('tr');
      cell(row, r.g.title || `BGG ${r.g.bggId}`);
      cell(row, r.set.names.join(SEP));
      cell(row, String(r.set.rounds));
      cell(row, r.isBase ? `${STATE_LABELS.confirmed}: dieser Satz` : STATE_LABELS[r.g.state]);
      // Row → the shared dialog (.claude/rules/admin-moderation-surface.md §6).
      row.tabIndex = 0;
      row.setAttribute('aria-haspopup', 'dialog');
      row.addEventListener('click', () => open(r));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r); }
      });
      body.appendChild(row);
    }
    const count = $('categoriesCount');
    count.textContent = `${games.length} ${games.length === 1 ? 'Spiel' : 'Spiele'}`;
    count.hidden = false;
  }

  // The set's names as editable inputs: the operator may correct spelling
  // before confirming, never the number or order of categories.
  function nameInputs(names) {
    const wrap = document.createElement('div');
    wrap.className = 'stack';
    const inputs = names.map((name, i) => {
      const label = document.createElement('label');
      label.textContent = `Kategorie ${i + 1} `;
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 30;
      input.value = name;
      label.appendChild(input);
      wrap.appendChild(label);
      return input;
    });
    return { wrap, inputs };
  }

  function open(r) {
    const { g, set } = r;
    const confirmed = g.state === 'confirmed';
    const editor = confirmed ? null : nameInputs(set.names);
    const actions = confirmed
      ? [['Bestätigung aufheben', 'ghost small', () => act(g, { action: 'revoke' })]]
      : [
        ['Diesen Satz bestätigen', 'small', () => act(g, {
          action: 'confirm', set: set.names, names: editor.inputs.map((i) => i.value),
        })],
        ...(g.state === 'open' ? [['Zurückstellen', 'ghost small', () => act(g, { action: 'dismiss' })]] : []),
      ];
    openDetail({
      title: g.title || `BGG ${g.bggId}`,
      pairs: [
        ['BGG-ID', g.bggId],
        ['Runden mit Kategorien', String(g.rounds)],
        ['Sätze', String(g.sets.length)],
        ['Dieser Satz', `${set.names.join(SEP)} (${set.rounds} ${set.rounds === 1 ? 'Runde' : 'Runden'})`],
        ['Status', STATE_LABELS[g.state]],
        ['Bestätigt', confirmed ? g.categories.join(SEP) : null],
        ['Bestätigt am', confirmed ? fmt(g.confirmedAt) : null],
      ],
      node: editor ? editor.wrap : null,
      text: confirmed
        ? 'Gilt in allen Runden als Grundsatz. Aufheben stellt die Kategorien jeder Runde wieder her.'
        : 'Bestätigen stellt diesen Satz in jeder Runde an den Anfang, gesperrt. Gleichnamige Kategorien einer Runde behalten ihre Werte; Runden, denen eine fehlt, bekommen sie leer dazu.',
      actions,
    });
  }

  async function act(g, body) {
    if (body.action === 'revoke'
      && !window.confirm(`Bestätigung für „${g.title || g.bggId}" aufheben? Jede Runde hat danach wieder ihre eigenen Kategorien.`)) return;
    try {
      await api(`/game-categories/${encodeURIComponent(g.bggId)}`, { method: 'POST', body: JSON.stringify(body) });
      await load();
      say('Gespeichert.', 'ok');
    } catch (err) {
      fail(err);
    }
  }

  async function load() {
    try {
      ({ games } = await api(`/game-categories${stateQuery()}`));
      render();
    } catch (err) {
      fail(err);
    }
  }

  function download(blob, ext) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spielwirbel-wertungskategorien-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // Built server-side (lib/csv.js), like the scoring card's.
  async function csvText(copy) {
    const q = stateQuery();
    const res = await fetch(`/api/admin/game-categories.csv${q}${copy ? `${q ? '&' : '?'}copy=1` : ''}`);
    if (!res.ok) {
      const failed = await res.json().catch(() => ({}));
      throw new Error(failed.error || `HTTP ${res.status}`);
    }
    return res;
  }

  $('categoriesState').addEventListener('change', () => { $('categoriesMsg').hidden = true; load(); });

  $('categoriesCsv').addEventListener('click', async () => {
    try { download(await (await csvText(false)).blob(), 'csv'); } catch (err) { fail(err); }
  });

  $('categoriesJson').addEventListener('click', () => {
    download(new Blob([JSON.stringify({ games }, null, 2)], { type: 'application/json' }), 'json');
  });

  $('categoriesCopy').addEventListener('click', async () => {
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
