'use strict';

/*
 * Standalone operator moderation page script (issue #268). Like login.js, it is
 * NOT part of the SPA's shared global scope — wrapped in an IIFE so it declares
 * no top-level names and needs no entry in eslint.config.js's frontendGlobals
 * (see .claude/rules/eslint-frontend-shared-scope.md).
 *
 * Every call goes to /api/admin, authenticated by the httpOnly `aid` cookie the
 * login sets — there is no token to hold in JS. GET /api/admin/me is the session
 * probe: 200 = signed in, 401 = not, 404 = the surface is disabled entirely.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const loginForm = $('loginForm');
  const panel = $('panel');
  let currentImage = null;
  let lastUsers = [];
  let statementEntry = null;

  // ---- helpers -------------------------------------------------------------

  async function api(path, options) {
    const res = await fetch(`/api/admin${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    let body = {};
    try {
      body = await res.json();
    } catch {
      /* a non-JSON error page (e.g. a proxy 502) — keep the status below */
    }
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  function show(el, text, kind) {
    el.textContent = text;
    el.className = `msg msg--${kind}`;
    el.hidden = false;
  }

  const hide = (el) => { el.hidden = true; };

  // Server errors are English codes (CLAUDE.md: server messages stay English);
  // map the ones an operator can actually hit to German, and fall back to the
  // raw code so nothing is ever swallowed silently.
  const MESSAGES = {
    not_found: 'Nicht gefunden.',
    invalid_password: 'Falsches Passwort.',
    admin_auth_required: 'Sitzung abgelaufen. Bitte neu anmelden.',
    admin_disabled: 'Die Moderationsoberfläche ist auf dieser Instanz nicht aktiviert.',
    invalid_csv: 'Das ist nicht die BGG-Rangliste (Spalten id, name und rank fehlen) '
      + 'oder sie enthält keine verwertbare Zeile. Der bisherige Korpus bleibt unverändert.',
    file_too_large: 'Die Datei ist zu groß. Bitte die entpackte .csv hochladen, nicht das ZIP.',
    no_file: 'Keine Datei ausgewählt.',
    upload_failed: 'Der Upload ist fehlgeschlagen. Bitte erneut versuchen.',
    bgg_token_missing: 'Ohne BGG_API_TOKEN können keine Attribute geladen werden.',
    rate_limited: 'Zu viele Versuche. Bitte kurz warten.',
    confirm_mismatch: 'Die eingegebene E-Mail-Adresse stimmt nicht mit dem Konto überein.',
    tenant_shared: 'Abgebrochen: Auf diesem Tenant liegt noch ein weiteres Konto. '
      + 'Die Daten gehören auch diesem Konto und werden nicht gelöscht.',
    no_notifier_email: 'Die Meldung enthält keine E-Mail-Adresse — es gibt niemanden zu benachrichtigen.',
    mail_failed: 'E-Mail-Versand fehlgeschlagen. Nichts wurde gespeichert — bitte erneut versuchen.',
    invalid_email: 'Keine gültige E-Mail-Adresse.',
    already_neutral: 'Der Nutzername ist bereits neutralisiert.',
    notice_decided: 'Entschiedene Meldungen sind als Nachweis aufzubewahren (Art. 17 DSA).',
  };
  const message = (err) => MESSAGES[err.message] || err.message;

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE') : '—');

  // textContent everywhere below (never innerHTML with server data): a game
  // title or e-mail is attacker-controlled content, and this page runs with
  // operator privileges.
  function cell(row, text, opts = {}) {
    const el = document.createElement(opts.head ? 'th' : 'td');
    el.textContent = text;
    if (opts.colSpan) el.colSpan = opts.colSpan;
    row.appendChild(el);
    return el;
  }

  // A single line of a long free-text field for the table cell; the full wording
  // (with its own line breaks) is in the row's detail dialog.
  function truncate(text, max) {
    const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  }

  // ---- detail dialogs (#403) -----------------------------------------------

  // Every table row opens this one native <dialog>: rows stay a single line and
  // the full record plus all its actions live here, instead of 4–5 inline
  // buttons wrapping into a wall inside a table cell.
  //
  // A spec is { title, pairs: [[label, value]], text, actions: [[label, cls, run]] }.
  // A null/undefined pair value is dropped, so a caller can list every possible
  // field without branching around the absent ones.
  const detailDialog = $('detailDialog');

  function openDetail(spec) {
    $('detailTitle').textContent = spec.title;

    const body = $('detailBody');
    body.replaceChildren();
    const dl = document.createElement('dl');
    for (const [label, value] of spec.pairs) {
      if (value == null) continue;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      // textContent like everywhere else on this page — an e-mail, a username or
      // a report body is attacker-chosen text and this page runs with operator
      // privileges.
      dd.textContent = value;
      dl.append(dt, dd);
    }
    body.appendChild(dl);

    if (spec.text) {
      const block = document.createElement('p');
      block.className = 'detail__text';
      block.textContent = spec.text;
      body.appendChild(block);
    }

    const bar = $('detailActions');
    bar.replaceChildren();
    const actions = spec.actions || [];
    for (const [label, cls, run] of actions) {
      const btn = document.createElement('button');
      btn.className = cls;
      btn.textContent = label;
      // Close BEFORE running: every action either reloads the list underneath
      // (which would leave the dialog showing a stale record) or scrolls to
      // another card, and a modal blocks both. <dialog> restores focus to the
      // row on close, so the operator lands back where they were.
      btn.addEventListener('click', () => { detailDialog.close(); run(); });
      bar.appendChild(btn);
    }
    bar.hidden = !actions.length;

    detailDialog.showModal();
  }

  // A table row that opens `spec`'s dialog. Focusable and Enter/Space-activatable
  // so the actions are reachable without a mouse; deliberately no role="button"
  // — that would detach the cells from their row for a screen reader. The row
  // replaced labelled per-row buttons, so without aria-haspopup a keyboard user
  // would land on a focusable row with nothing saying it opens anything.
  function detailRow(spec) {
    const row = document.createElement('tr');
    row.className = 'clickable';
    row.tabIndex = 0;
    row.setAttribute('aria-haspopup', 'dialog');
    row.addEventListener('click', () => openDetail(spec));
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); // Space would scroll the page
      openDetail(spec);
    });
    return row;
  }

  // ---- login ---------------------------------------------------------------

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = loginForm.querySelector('button');
    hide($('loginError'));
    button.disabled = true;
    try {
      await api('/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
      enterPanel();
    } catch (err) {
      show($('loginError'), message(err), 'err');
      $('password').select();
    } finally {
      button.disabled = false;
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    window.location.reload();
  });

  function enterPanel() {
    loginForm.hidden = true;
    panel.hidden = false;
    $('password').value = '';
    loadStatus();
    loadLogs();
    loadNotices();
    // Konten is deliberately NOT loaded here (#403) — see loadUsers().
    loadFeedback();
    loadCorpus();
    refreshLog();
  }

  // ---- instance metrics (#274, reshaped by #404) ----------------------------

  // Each row is [label, verdict, value, note?]. A NULL verdict renders the
  // neutral pill — which is what a plain count gets, since "42 accounts" is not
  // good or bad. Only the rows measured against a ceiling carry an opinion,
  // and deriving it HERE rather than server-side is deliberate: the server
  // reports facts, the panel interprets them, so a new opinion about what "good"
  // looks like never changes the API.

  const VERDICT_RANK = { ok: 0, warn: 1, off: 2 };

  // Usage against a ceiling: red at or past the cap, amber from 80 %. The same
  // thresholds quotaPill uses on the tenant-lookup card — one idiom for "how
  // close is this to refusing someone", not two.
  function capVerdict(used, limit) {
    const ratio = limit > 0 ? used / limit : 0;
    if (ratio >= 1) return 'off';
    if (ratio >= 0.8) return 'warn';
    return 'ok';
  }

  function statusRows(s) {
    const m = s.metrics;
    const rows = [];

    rows.push(['Konten', null, String(m.accounts.total),
      `${m.accounts.verified} bestätigt · ${m.accounts.total - m.accounts.verified} unbestätigt`
      + ` · ${m.accounts.disabled} gesperrt`]);

    rows.push(['Neue Konten', null, `${m.accounts.new7d} / ${m.accounts.new30d}`,
      'letzte 7 / 30 Tage']);

    rows.push(['Aktivierung', null, `${m.rounds.tenants} / ${m.accounts.total}`,
      'Konten mit mindestens einer Runde']);

    rows.push(['Runden', null, String(m.rounds.total)]);

    // Seats across all rounds — most of them belong to people with no account,
    // which is why this is a different (and larger) number than 'Konten' above.
    // It is what the public „Spieler*innen" counter publishes (#564).
    rows.push(['Spieler*innen', null, String(m.content.members),
      'Mitglieds-Plätze in allen Runden']);

    // Both figures, because they answer different questions and the public page
    // publishes the ACTIVE one: the quota counts every row, the Regal does not.
    rows.push(['Spiele', null, String(m.content.games),
      `${m.content.activeGames} im Regal · ${m.content.games - m.content.activeGames} archiviert oder auf der Wunschliste`]);

    rows.push(['Sessions', null, String(m.content.sessions),
      `${m.content.sessionsFinished} abgeschlossen · ${m.content.sessions30d} in den letzten 30 Tagen`]);

    rows.push(['Demo-Konten', capVerdict(m.demo.live, m.demo.max),
      `${m.demo.live} / ${m.demo.max}`, 'aktiv gegen MAX_LIVE_DEMOS']);

    // The one process-local number on the card: each replica books its own
    // budget (lib/mail.js), so this is the answering process's counter, not a
    // sum over replicas — the note says so, or "17 / 200" reads as global.
    rows.push(['Mail-Budget', capVerdict(m.mail.sent, m.mail.limit),
      `${m.mail.sent} / ${m.mail.limit}`,
      'gesendet heute (UTC) gegen MAIL_DAILY_MAX · zählt nur den antwortenden Prozess, nicht alle Replicas']);

    rows.push(['Teilen & Freunde', null,
      `${m.social.sharedRounds} · ${m.social.invitationsOpen} · ${m.social.friendships}`,
      'geteilte Runden · offene Einladungen · Freundschaften']);

    // The quota row pairs each ceiling with the highest value anyone currently
    // holds, so "is someone about to be refused?" is answerable without a
    // database console — the pill goes amber/red as soon as ANY of the three
    // crosses its threshold, and the note says which. With accounts off the
    // ceilings are inert (.claude/rules/per-tenant-quotas.md), so the peaks are
    // shown without a verdict that implies a refusal that cannot happen.
    const peakVerdict = s.quotas.enforced
      ? ['roundsPerTenant', 'gamesPerRound', 'tagsPerRound']
        .map((k) => capVerdict(m.peaks[k], s.quotas[k]))
        .reduce((worst, v) => (VERDICT_RANK[v] > VERDICT_RANK[worst] ? v : worst), 'ok')
      : 'warn';
    rows.push(['Kontingente', peakVerdict,
      s.quotas.enforced ? 'aktiv' : 'inaktiv (Accounts aus)',
      `Höchstwerte: Runden/Konto ${m.peaks.roundsPerTenant} / ${s.quotas.roundsPerTenant}`
      + ` · Spiele/Runde ${m.peaks.gamesPerRound} / ${s.quotas.gamesPerRound}`
      + ` · Tags/Runde ${m.peaks.tagsPerRound} / ${s.quotas.tagsPerRound}`]);

    return rows;
  }

  async function loadStatus() {
    const grid = $('statusGrid');
    grid.replaceChildren();
    hide($('statusError'));

    let status;
    try {
      ({ status } = await api('/status'));
    } catch (err) {
      show($('statusError'), message(err), 'err');
      return;
    }

    renderTiles(grid, statusRows(status));
  }

  // One [label, verdict, value, note?] row per tile. Shared by the Kennzahlen
  // board and the BGG-Korpus card so the two cannot drift into two ideas of what
  // a status tile looks like. Every value goes in via textContent.
  function renderTiles(grid, rows) {
    for (const [label, verdict, value, note] of rows) {
      const item = document.createElement('div');
      item.className = 'status__item';

      const head = document.createElement('div');
      head.className = 'status__label';
      head.textContent = label;
      item.appendChild(head);

      const pill = document.createElement('span');
      // No verdict = the neutral pill: a bare count is neither good nor bad, and
      // a green one would read as an all-clear about a number nobody graded.
      pill.className = verdict ? `pill pill--${verdict}` : 'pill';
      pill.textContent = value;
      item.appendChild(pill);

      if (note) {
        const hint = document.createElement('div');
        hint.className = 'status__note';
        hint.textContent = note;
        item.appendChild(hint);
      }

      grid.appendChild(item);
    }
  }

  // ---- the BGG game corpus (#681) ------------------------------------------

  // How stale a ranks dump may get before the card says so. The operator's own
  // cadence is monthly, so 45 days is "you have slipped" and 120 is "this is no
  // longer being maintained" — the numbers move slowly enough that neither is a
  // correctness problem, only a quality one.
  const CORPUS_WARN_DAYS = 45;
  const CORPUS_STALE_DAYS = 120;

  const daysSince = (iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
  };

  function corpusRows(c) {
    const rows = [];

    // Deliberately NO verdict on the size: sitting exactly AT the cap is the
    // intended state (the corpus keeps the best-ranked N), so capVerdict's red
    // would be an alarm about the thing working.
    rows.push(['Spiele im Korpus', null, `${c.rows} / ${c.limit}`,
      `bestplatzierte aus der Rangliste, gegen BGG_CORPUS_SIZE`
      + ` · ab ${c.minRatings} Bewertungen`]);

    const enrichVerdict = () => {
      if (!c.rows) return 'off';
      if (c.enriched >= c.rows) return 'ok';
      return 'warn';
    };
    rows.push(['Attribute geladen', enrichVerdict(), `${c.enriched} / ${c.rows}`,
      c.rows
        ? `Gewicht, Spieleranzahl, Kategorien · ${c.batchesPerTick} Abfragen je 15 Min,`
          + ` Auffrischung nach ${c.staleDays} Tagen`
        : 'noch keine Rangliste hochgeladen']);

    const age = daysSince(c.uploadedAt);
    const ageVerdict = () => {
      if (age === null) return 'off';
      if (age >= CORPUS_STALE_DAYS) return 'off';
      if (age >= CORPUS_WARN_DAYS) return 'warn';
      return 'ok';
    };
    rows.push(['Rangliste', ageVerdict(),
      age === null ? 'nie' : `vor ${age} Tg.`,
      // The dump date is only known when the operator's file name kept it — BGG
      // puts it on the ZIP, not on the CSV inside. So the upload time is the
      // fact the verdict is really built on, and it is always known.
      c.dumpDate ? `Stand ${c.dumpDate} · hochgeladen ${c.uploadedAt.slice(0, 10)}`
        : (c.uploadedAt ? `hochgeladen ${c.uploadedAt.slice(0, 10)} · Stand unbekannt` : null)]);

    rows.push(['BGG-Token', c.tokenSet ? 'ok' : 'off', c.tokenSet ? 'gesetzt' : 'fehlt',
      c.tokenSet ? null : 'ohne BGG_API_TOKEN werden keine Attribute geladen']);

    return rows;
  }

  async function loadCorpus() {
    const grid = $('corpusGrid');
    grid.replaceChildren();
    let corpus;
    try {
      ({ corpus } = await api('/corpus'));
    } catch (err) {
      show($('corpusMsg'), message(err), 'err');
      return;
    }
    renderTiles(grid, corpusRows(corpus));
  }

  // NOT through api(): that helper sets Content-Type: application/json, and a
  // multipart body needs the browser to write the header itself so it can put
  // its own boundary in it. Setting it by hand is the classic way to make every
  // upload arrive as an empty field.
  $('corpusForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('corpusFile').files[0];
    if (!file) return;
    hide($('corpusMsg'));
    show($('corpusMsg'), 'Wird hochgeladen und verarbeitet …', 'ok');

    const body = new FormData();
    body.append('file', file);
    let res;
    let payload;
    try {
      res = await fetch('/api/admin/corpus', { method: 'POST', body });
      payload = await res.json().catch(() => ({}));
    } catch (err) {
      show($('corpusMsg'), message(err), 'err');
      return;
    }
    if (!res.ok) {
      show($('corpusMsg'), message(new Error(payload.error || `HTTP ${res.status}`)), 'err');
      return;
    }
    const u = payload.upload;
    show($('corpusMsg'),
      `${u.rows} Spiele übernommen (${u.dropped} von ${u.total} Zeilen verworfen:`
      + ' Erweiterungen, unplatzierte und zu selten bewertete).', 'ok');
    $('corpusForm').reset();
    loadCorpus();
  });

  $('corpusReload').addEventListener('click', loadCorpus);

  $('corpusEnrich').addEventListener('click', async () => {
    hide($('corpusMsg'));
    show($('corpusMsg'), 'Attribute werden geladen …', 'ok');
    let run;
    try {
      ({ run } = await api('/corpus/enrich', { method: 'POST' }));
    } catch (err) {
      show($('corpusMsg'), message(err), 'err');
      return;
    }
    show($('corpusMsg'), run.asked
      ? `${run.asked} Spiele abgefragt, ${run.enriched} beantwortet`
        + `${run.failed ? ' — dann brach BGG ab, der Rest folgt automatisch.' : '.'}`
      : 'Nichts offen — alle Spiele sind aktuell.', run.failed ? 'err' : 'ok');
    loadCorpus();
  });

  // ---- error/warn logs (#359) ----------------------------------------------

  // The most recent warn/error lines this process emitted, newest first, from
  // the in-memory ring buffer (lib/observability.js). Diagnostics only:
  // read-only, no paging (the buffer is bounded), refreshed by its own "Neu
  // laden" button rather than any mutation.
  //
  // Every value is rendered with textContent (via cell() and .textContent
  // below) — a log message or stack can embed a game title or other
  // attacker-influenced text, and this page runs with operator privileges.
  async function loadLogs() {
    const body = $('logsTable').querySelector('tbody');
    body.replaceChildren();
    hide($('logsError'));

    let entries;
    try {
      ({ entries } = await api('/logs'));
    } catch (err) {
      show($('logsError'), message(err), 'err');
      return;
    }

    const head = document.createElement('tr');
    ['Zeitpunkt', 'Stufe', 'Ereignis', 'Meldung'].forEach((h) => cell(head, h, { head: true }));
    body.appendChild(head);

    $('logsCount').textContent = `${entries.length} Einträge`;
    $('logsCount').hidden = !entries.length;

    if (!entries.length) {
      const row = document.createElement('tr');
      cell(row, 'Keine Warn- oder Fehlermeldungen seit dem letzten Neustart.', { colSpan: 4 });
      body.appendChild(row);
      return;
    }

    for (const e of entries) body.appendChild(logRow(e));
  }

  // Fields already shown in their own column — everything else falls into the
  // expandable detail block below.
  const LOG_SHOWN = new Set(['ts', 'level', 'event', 'message', 'stack']);

  // The stack trace first, then any remaining context fields (method, path,
  // err, name, …) as `key: value` lines. '' when there is nothing extra, so a
  // row with only the four columns shows no empty <details>.
  function logDetail(e) {
    const parts = [];
    if (e.stack) parts.push(String(e.stack));
    for (const [k, v] of Object.entries(e)) {
      if (LOG_SHOWN.has(k) || v == null) continue;
      parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
    return parts.join('\n');
  }

  // One log line: a level pill (ERROR reuses the red 'off' pill, WARN the amber
  // 'warn' one), the event name, the message, and — hidden in a <details> so a
  // long stack doesn't dominate the table — the stack plus any extra context.
  function logRow(e) {
    const row = document.createElement('tr');
    cell(row, fmt(e.ts));

    const level = cell(row, '');
    const pill = document.createElement('span');
    pill.className = `pill pill--${e.level === 'error' ? 'off' : 'warn'}`;
    pill.textContent = String(e.level || '').toUpperCase();
    level.appendChild(pill);

    cell(row, e.event || '—');

    const msg = cell(row, '');
    msg.style.wordBreak = 'break-word';
    const text = document.createElement('div');
    text.style.whiteSpace = 'pre-wrap';
    text.textContent = e.message || '—';
    msg.appendChild(text);

    const detail = logDetail(e);
    if (detail) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Details';
      summary.style.cursor = 'pointer';
      summary.style.fontSize = '0.8rem';
      details.appendChild(summary);
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'break-word';
      pre.style.margin = '0.4rem 0 0';
      pre.style.fontSize = '0.8rem';
      pre.textContent = detail;
      details.appendChild(pre);
      msg.appendChild(details);
    }
    return row;
  }

  $('logsReload').addEventListener('click', loadLogs);

  // ---- lookup --------------------------------------------------------------

  // [label, placeholder] per selector. A notice names an e-mail address or a
  // round link far more often than a cover path (#275) — and since #320 a
  // username, the only identifier an outside reporter can legitimately hold.
  const LOOKUP_FIELDS = {
    image: ['Bildpfad', '/uploads/abc123.jpg'],
    round: ['Runden-ID', 'z. B. 8f3a1c2b4d5e6f70'],
    username: ['Nutzername', 'z. B. anna_91'],
    email: ['E-Mail-Adresse', 'name@example.com'],
    tenant: ['Tenant-ID', 'z. B. 4d9e7a10bc2f3e58'],
  };

  $('lookupBy').addEventListener('change', () => {
    const [label, placeholder] = LOOKUP_FIELDS[$('lookupBy').value];
    $('lookupValueLabel').textContent = label;
    $('lookupValue').placeholder = placeholder;
    $('lookupValue').value = '';
  });

  $('lookupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hide($('lookupError'));
    hide($('lookupResult'));
    $('takedownCard').hidden = true;
    $('contentCard').hidden = true;
    $('statementBox').hidden = true;
    currentImage = null;

    const by = $('lookupBy').value;
    try {
      const out = await api(`/lookup?${by}=${encodeURIComponent($('lookupValue').value.trim())}`);
      // Remembered for the statement flow: the affected person is one of this
      // tenant's accounts, so their address prefills the recipient prompt.
      lastUsers = out.users || [];
      renderLookup(out);
      // The takedown card is for an image and only an image — offering it after
      // an e-mail lookup would have no target.
      if (out.owner) {
        currentImage = out.owner.image;
        $('takedownCard').hidden = false;
        hide($('takedownMsg'));
      }
      // A round lookup is almost always ABOUT that round's text, so open the
      // drill-down immediately rather than making the operator click again.
      if (out.round) loadContent(out.round.roundId);
    } catch (err) {
      show($('lookupError'), message(err), 'err');
    }
  });

  const KB = 1024;
  function formatBytes(n) {
    if (!Number.isFinite(n)) return '—';
    if (n < KB) return `${n} B`;
    if (n < KB * KB) return `${(n / KB).toFixed(1)} kB`;
    return `${(n / KB / KB).toFixed(1)} MB`;
  }

  // Usage against a ceiling, as the same pill verdict the status card uses: red
  // at or past the cap, amber from 80 %, else neutral-good. When quotas are not
  // enforced (accounts off) the cap is inert — showing "3 / 10" would imply a
  // refusal that cannot happen, so only the bare count is rendered.
  function quotaPill(used, limit, enforced) {
    const pill = document.createElement('span');
    if (!enforced) {
      pill.className = 'pill';
      pill.textContent = String(used);
      return pill;
    }
    const ratio = limit > 0 ? used / limit : 0;
    let verdict = 'ok';
    if (ratio >= 1) verdict = 'off';
    else if (ratio >= 0.8) verdict = 'warn';
    pill.className = `pill pill--${verdict}`;
    pill.textContent = `${used} / ${limit}`;
    return pill;
  }

  function renderLookup(out) {
    const box = $('lookupResult');
    box.replaceChildren();

    const pairs = [];
    if (out.owner) pairs.push(['Spiel', out.owner.gameTitle], ['Runde', out.owner.roundName]);
    if (out.round) pairs.push(['Runde', out.round.roundName]);
    pairs.push(['Tenant', out.tenantId || '—']);
    pairs.push(['Konten', out.users.length
      ? out.users.map((u) => `${u.username ? `${u.username} · ` : ''}${u.email}${u.disabled ? ' (gesperrt)' : ''}`).join(', ')
      : 'keine (Alt-Tenant)']);
    // "≥" when only a sample was measured: past SIZE_SAMPLE_MAX covers the
    // server stops sizing objects, so the figure is a lower bound, not a total.
    const up = out.uploads;
    pairs.push(['Uploads', `${up.count} · ${up.complete ? '' : '≥ '}${formatBytes(up.bytes)}`]);

    const dl = document.createElement('dl');
    for (const [k, v] of pairs) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    box.appendChild(dl);

    if (out.summary) renderTenantRounds(box, out);
    box.hidden = false;
  }

  // The per-tenant summary: what they hold, and how close each round sits to the
  // quotas that would start refusing writes (#275 item 5) — visible before
  // someone hits a cap and sees a deliberately number-free toast.
  function renderTenantRounds(box, out) {
    const { summary } = out;
    const q = out.quota;
    const t = summary.totals;

    const totals = document.createElement('p');
    totals.className = 'totals';
    for (const [label, value] of [
      ['Runden', q.enforced ? `${t.rounds} / ${q.roundsPerTenant}` : t.rounds],
      ['Spiele', `${t.games} (${t.activeGames} aktiv)`],
      ['Sessions', t.sessions],
      ['Mitglieder', t.members],
      ['Tags', t.tags],
    ]) {
      const span = document.createElement('span');
      span.append(`${label}: `);
      const b = document.createElement('b');
      b.textContent = String(value);
      span.appendChild(b);
      totals.appendChild(span);
    }
    box.appendChild(totals);

    if (!summary.rounds.length) return;

    const wrap = document.createElement('div');
    wrap.className = 'scroll';
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const head = document.createElement('tr');
    ['Runde', 'Spiele', 'Tags', 'Sessions', ''].forEach((h) => cell(head, h, { head: true }));
    tbody.appendChild(head);

    for (const r of summary.rounds) {
      const row = document.createElement('tr');
      cell(row, r.name);
      cell(row, '').appendChild(quotaPill(r.games, q.gamesPerRound, q.enforced));
      cell(row, '').appendChild(quotaPill(r.tags, q.tagsPerRound, q.enforced));
      cell(row, String(r.sessions));
      const btn = document.createElement('button');
      btn.className = 'small ghost';
      btn.textContent = 'Texte';
      btn.addEventListener('click', () => loadContent(r.id));
      cell(row, '').appendChild(btn);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
  }

  // ---- content & redaction (#275) ------------------------------------------

  // One round's user-authored text, each row redactable. This is the drill-down
  // a text notice needs: the report names the offending words, not an id.
  async function loadContent(roundId) {
    const card = $('contentCard');
    const body = $('contentTable').querySelector('tbody');
    body.replaceChildren();
    hide($('contentMsg'));
    card.hidden = false;

    let content;
    try {
      ({ content } = await api(`/content?round=${encodeURIComponent(roundId)}`));
    } catch (err) {
      show($('contentMsg'), message(err), 'err');
      return;
    }

    const head = document.createElement('tr');
    ['Art', 'Text'].forEach((h) => cell(head, h, { head: true }));
    body.appendChild(head);

    for (const [label, kind, id, text] of [
      ['Runde', 'round', content.roundId, content.roundName],
      ...content.members.map((m) => ['Mitglied', 'member', m.id, m.name]),
      ...content.games.map((g) => ['Spiel', 'game', g.id, g.title]),
      ...content.tags.map((tg) => ['Tag', 'tag', tg.id, tg.name]),
      // Flat across the shelf (#653) — an expansion title is user-authored text
      // like every other row here, and its id is unique instance-wide.
      ...(content.expansions || []).map((e) => ['Erweiterung', 'expansion', e.id, e.title]),
    ]) {
      const row = detailRow({
        title: label,
        pairs: [['Art', label], ['ID', id]],
        text: text == null ? '—' : text,
        actions: [['Redigieren', 'small danger',
          () => redact({ kind, roundId: content.roundId, id }, text)]],
      });
      cell(row, label);
      cell(row, truncate(text == null ? '—' : text, 90)).style.wordBreak = 'break-word';
      body.appendChild(row);
    }
  }

  async function redact(target, text) {
    if (!window.confirm(`„${text}“ mit [entfernt] überschreiben?\n\n`
      + 'Der ursprüngliche Wortlaut wird protokolliert; gelöscht wird nichts.')) return;
    const reason = askReason('Redigieren');
    if (!reason) return;

    try {
      await api('/redact', { method: 'POST', body: JSON.stringify({ ...target, reason }) });
      // Refresh BEFORE reporting: loadContent() clears this same message element.
      await loadContent(target.roundId);
      show($('contentMsg'), 'Text redigiert.', 'ok');
      refreshLog();
    } catch (err) {
      show($('contentMsg'), message(err), 'err');
    }
  }

  // Feedback is global rather than round-scoped, so it redacts by id alone and
  // refreshes its own card.
  async function redactFeedback(entry) {
    if (!window.confirm('Diesen Feedback-Text mit [entfernt] überschreiben?')) return;
    const reason = askReason('Redigieren');
    if (!reason) return;

    try {
      await api('/redact', {
        method: 'POST',
        body: JSON.stringify({ kind: 'feedback', id: entry.id, reason }),
      });
      loadFeedback();
      refreshLog();
    } catch (err) {
      show($('feedbackError'), message(err), 'err');
    }
  }

  // Delete one feedback entry (issue #389). Freely deletable — no retention duty
  // (the policy §11 promises deletion once no longer needed), so a plain confirm.
  async function deleteFeedback(entry) {
    if (!window.confirm('Diesen Feedback-Eintrag endgültig löschen?')) return;
    try {
      await api(`/feedback/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      loadFeedback();
    } catch (err) {
      show($('feedbackError'), message(err), 'err');
    }
  }

  // ---- takedown ------------------------------------------------------------

  $('takedownForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentImage) return;
    if (!window.confirm(`Bild ${currentImage} endgültig entfernen?`)) return;

    const button = $('takedownForm').querySelector('button');
    button.disabled = true;
    try {
      const out = await api('/takedown', {
        method: 'POST',
        body: JSON.stringify({ image: currentImage, reason: $('takedownReason').value }),
      });
      show($('takedownMsg'), `Entfernt. Referenzen bereinigt: ${out.cleared}.`, 'ok');
      $('takedownReason').value = '';
      hide($('lookupResult'));
      currentImage = null;
      refreshLog();
      // Art. 17 (#272): the statement of reasons for what just happened,
      // generated server-side from the log entry that was just written.
      offerStatement(out.entry);
    } catch (err) {
      show($('takedownMsg'), message(err), 'err');
    } finally {
      button.disabled = false;
    }
  });

  // ---- statement of reasons (#272) -----------------------------------------

  async function offerStatement(entry) {
    if (!entry) return;
    statementEntry = entry;
    hide($('statementMsg'));
    try {
      const out = await api(`/statement?entry=${encodeURIComponent(entry.id)}`);
      $('statementText').value = out.text;
      $('statementBox').hidden = false;
    } catch {
      // The takedown itself succeeded; a failed preview just leaves the box
      // hidden — the log card still holds everything the statement needs.
    }
  }

  $('statementSend').addEventListener('click', async () => {
    if (!statementEntry) return;
    const to = window.prompt(
      'Begründung senden an (E-Mail der betroffenen Person):',
      lastUsers.length ? lastUsers[0].email : '',
    );
    if (!to || !to.trim()) return;
    try {
      await api('/statement', {
        method: 'POST',
        body: JSON.stringify({ entryId: statementEntry.id, to: to.trim() }),
      });
      show($('statementMsg'), 'Begründung gesendet und im Protokoll vermerkt.', 'ok');
      refreshLog();
    } catch (err) {
      show($('statementMsg'), message(err), 'err');
    }
  });

  // ---- users ---------------------------------------------------------------

  // The full account record and every action that applies to it. (The
  // „Standard-Daten übernehmen" claim that used to sit alongside these went with
  // #405 — the 'default' tenant was claimed once during the go-live and the
  // route is gone.)
  const userDetail = (u) => ({
    title: u.username || u.email,
    pairs: [
      ['E-Mail', u.email],
      ['Nutzername', u.username || '—'],
      ['Tenant', u.tenantId || '—'],
      ['Registriert', fmt(u.createdAt)],
      ['E-Mail bestätigt', u.emailVerified ? 'ja' : 'nein'],
      ['Status', u.disabled ? `gesperrt seit ${fmt(u.disabledAt)}` : 'aktiv'],
      ['Sperrgrund', u.disabled ? (u.disabledReason || '—') : null],
      ['Konto-ID', u.id],
    ],
    actions: [
      [u.disabled ? 'Entsperren' : 'Sperren', u.disabled ? 'small ghost' : 'small danger', () => toggleUser(u)],
      ['Name neutralisieren', 'small ghost', () => renameUser(u)],
      ['Exportieren', 'small ghost', () => exportUser(u)],
      ['Löschen', 'small danger', () => eraseUser(u)],
    ],
  });

  // Search-first (#403): nothing is requested — so no e-mail address leaves the
  // server at all — until the operator asks for a specific account. `null` means
  // "no search has been run yet", which is why loadUsers() is not called on
  // login; `''` is the deliberate "Alle anzeigen" overview. Every action's
  // refresh re-runs whichever of the two is current.
  let userQuery = null;

  async function loadUsers() {
    if (userQuery === null) return;
    const body = $('usersTable').querySelector('tbody');
    body.replaceChildren();
    hide($('usersError'));
    let users;
    try {
      ({ users } = await api(`/users${userQuery ? `?q=${encodeURIComponent(userQuery)}` : ''}`));
    } catch (err) {
      show($('usersError'), message(err), 'err');
      return;
    }

    const head = document.createElement('tr');
    ['Nutzername', 'E-Mail', 'Tenant', 'Status'].forEach((h) => cell(head, h, { head: true }));
    body.appendChild(head);

    $('usersCount').textContent = `${users.length} ${users.length === 1 ? 'Konto' : 'Konten'}`;
    $('usersCount').hidden = false;

    if (!users.length) {
      const row = document.createElement('tr');
      cell(row, userQuery
        ? 'Keine Treffer.'
        : 'Keine Konten (Accounts sind auf dieser Instanz nicht aktiv).', { colSpan: 4 });
      body.appendChild(row);
      return;
    }

    for (const u of users) {
      const row = detailRow(userDetail(u));
      // Attacker-chosen free text — cell() uses textContent, so a handle full of
      // markup renders as the characters it is.
      cell(row, u.username || '—');
      cell(row, u.email);
      cell(row, u.tenantId || '—');

      const status = cell(row, '');
      const pill = document.createElement('span');
      pill.className = u.disabled ? 'pill pill--off' : 'pill';
      pill.textContent = u.disabled ? 'gesperrt' : 'aktiv';
      status.appendChild(pill);

      body.appendChild(row);
    }
  }

  $('usersForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const term = $('usersQuery').value.trim();
    // An empty box is not a search: falling through to the unfiltered list would
    // make the full account list — every e-mail address — one stray Enter away,
    // which is the thing search-first exists to prevent. "Alle anzeigen" is the
    // deliberate path.
    if (!term) return;
    userQuery = term;
    loadUsers();
  });

  $('usersAll').addEventListener('click', () => {
    $('usersQuery').value = '';
    userQuery = '';
    loadUsers();
  });

  async function toggleUser(user) {
    const disabling = !user.disabled;
    const reason = window.prompt(
      `${disabling ? 'Sperren' : 'Entsperren'}: Begründung (wird protokolliert)`,
    );
    // A cancelled prompt (null) aborts; an empty string would be rejected by the
    // server anyway, so treat it the same rather than sending a doomed request.
    if (!reason || !reason.trim()) return;

    try {
      await api(`/users/${encodeURIComponent(user.id)}/disabled`, {
        method: 'POST',
        body: JSON.stringify({ disabled: disabling, reason }),
      });
      loadUsers();
      refreshLog();
    } catch (err) {
      show($('usersError'), message(err), 'err');
    }
  }

  // Force a neutral handle when the username itself is the abuse (#320). The
  // replacement is the server's, not ours — the panel only supplies the
  // mandatory reason, exactly like a redaction.
  async function renameUser(user) {
    const reason = askReason('Nutzernamen neutralisieren');
    if (!reason) return;

    try {
      const out = await api(`/users/${encodeURIComponent(user.id)}/username`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      loadUsers();
      refreshLog();
      show($('usersError'), `Nutzername ersetzt durch „${out.username}“.`, 'ok');
    } catch (err) {
      show($('usersError'), message(err), 'err');
    }
  }

  // ---- export & erasure (#273) ---------------------------------------------

  // Ask for the mandatory reason. A cancelled prompt (null) aborts; an empty
  // string would be rejected by the server anyway, so treat it the same rather
  // than sending a doomed request.
  function askReason(label) {
    const reason = window.prompt(`${label}: Begründung (wird protokolliert)`);
    return reason && reason.trim() ? reason : null;
  }

  // Art. 15/20. The response is JSON rather than a download URL because the
  // required reason travels in the request body (see lib/routes/admin.js) — so the
  // file is assembled here and saved via an object URL.
  async function exportUser(user) {
    const reason = askReason('Export');
    if (!reason) return;

    try {
      const out = await api(`/users/${encodeURIComponent(user.id)}/export`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      const blob = new Blob([JSON.stringify(out.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spielwirbel-export-${user.id}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      // Revoked on the next tick, not inline: the click only *starts* the
      // download, and tearing the object URL down in the same task can cancel it
      // before the browser has read the blob.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      show($('usersError'), `Export erstellt: ${out.export.rounds.length} Runde(n).`, 'ok');
      refreshLog();
    } catch (err) {
      show($('usersError'), message(err), 'err');
    }
  }

  // Art. 17. Irreversible and cascading, so the operator types the account's own
  // address to confirm — the server checks it too, so a mis-clicked row refuses
  // rather than erasing the wrong person.
  async function eraseUser(user) {
    const confirmEmail = window.prompt(
      `Konto und ALLE Daten dieses Tenants endgültig löschen.\n\n`
      + `Nicht umkehrbar. Zum Bestätigen die E-Mail-Adresse des Kontos eingeben:`,
    );
    if (!confirmEmail) return;

    const reason = askReason('Löschung');
    if (!reason) return;

    try {
      const out = await api(`/users/${encodeURIComponent(user.id)}/erase`, {
        method: 'POST',
        body: JSON.stringify({ reason, confirmEmail }),
      });
      const failed = out.imagesFailed ? `, ${out.imagesFailed} Bild(er) nicht entfernt` : '';
      // Refresh BEFORE reporting: loadUsers() clears this same message element.
      await loadUsers();
      refreshLog();
      show($('usersError'),
        `Gelöscht: ${out.rounds} Runde(n), ${out.imagesRemoved} Bild(er)${failed}.`, 'ok');
    } catch (err) {
      show($('usersError'), message(err), 'err');
    }
  }

  // ---- paged list cards (#288) ---------------------------------------------

  // Feedback and Protokoll are the same card twice — newest-first, read-only,
  // paged, exportable — so they share one builder rather than two near-identical
  // loaders that drift apart. Returns reload(), which every action that changes
  // the underlying data already calls.
  //
  // Both used to render only the newest 100 with nothing saying so. For the
  // Protokoll in particular that is the wrong failure mode: it is the record
  // backing Art. 17 statements of reasons, so the total is always shown, even
  // when a single page covers it.
  const PAGE = 100;

  function listCard(opts) {
    const body = $(opts.table).querySelector('tbody');
    const countEl = $(opts.count);
    const moreBtn = $(opts.more);
    const errorEl = $(opts.error);
    let loaded = 0;

    // Extra 'k=v' parameters (the log's filters, #275), read fresh on every
    // request so paging and the CSV always carry whatever is in the filter bar
    // right now — an export that widened back to everything would leak
    // unrelated tenants into a hand-over prepared for one.
    const query = () => (opts.query ? opts.query() : []);
    let lastQuery = '';

    // append=false restarts from the newest entry; append=true fetches the next
    // page and adds it below what is already rendered.
    async function load(append) {
      const parts = query();
      const key = parts.join('&');
      // Editing a filter field and hitting "Mehr laden" WITHOUT "Filtern" would
      // otherwise page the new filter at the old filter's offset and append the
      // result to a list built from the old one — a silently wrong log. Treat a
      // changed filter as a fresh load instead.
      if (append && key !== lastQuery) append = false;
      lastQuery = key;

      if (!append) loaded = 0;
      let entries;
      let total;
      const extra = parts.map((p) => `&${p}`).join('');
      try {
        ({ entries, total } = await api(`${opts.path}?limit=${PAGE}&offset=${loaded}${extra}`));
      } catch (err) {
        show(errorEl, message(err), 'err');
        return;
      }

      if (!append) {
        body.replaceChildren();
        hide(errorEl);
        const head = document.createElement('tr');
        opts.headers.forEach((h) => cell(head, h, { head: true }));
        body.appendChild(head);
      }

      loaded += entries.length;

      if (!total) {
        const row = document.createElement('tr');
        cell(row, opts.empty, { colSpan: opts.headers.length });
        body.appendChild(row);
      } else {
        for (const entry of entries) body.appendChild(opts.row(entry));
      }

      countEl.textContent = `${loaded} von ${total}`;
      countEl.hidden = !total;
      // Hidden rather than disabled once everything is loaded: a dead button is
      // noise on a card that is now complete.
      moreBtn.hidden = loaded >= total;
    }

    // The full set, not just the loaded pages — the reason the download exists.
    // Follows exportUser()'s object-URL precedent, including the deferred revoke.
    async function downloadCsv() {
      const button = $(opts.csv);
      button.disabled = true;
      const extra = query();
      try {
        const res = await fetch(`/api/admin${opts.path}.csv${extra.length ? `?${extra.join('&')}` : ''}`);
        if (!res.ok) {
          const failed = await res.json().catch(() => ({}));
          throw new Error(failed.error || `HTTP ${res.status}`);
        }
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = `spielwirbel-${opts.name}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        // Revoked on the next tick, not inline — see exportUser().
        setTimeout(() => URL.revokeObjectURL(url), 0);
        hide(errorEl);
      } catch (err) {
        show(errorEl, message(err), 'err');
      } finally {
        button.disabled = false;
      }
    }

    moreBtn.addEventListener('click', () => load(true));
    $(opts.csv).addEventListener('click', downloadCsv);
    return () => load(false);
  }

  // ---- log -----------------------------------------------------------------

  // The filter bar's current state as 'k=v' pairs; an empty field is simply
  // omitted, which the server reads as "don't filter on it".
  function logQuery() {
    const parts = [];
    const add = (key, value) => { if (value) parts.push(`${key}=${encodeURIComponent(value)}`); };
    add('action', $('logAction').value);
    add('tenant', $('logTenant').value.trim());
    add('from', $('logFrom').value);
    add('to', $('logTo').value);
    return parts;
  }

  const loadLog = listCard({
    path: '/log',
    name: 'protokoll',
    table: 'logTable',
    count: 'logCount',
    more: 'logMore',
    csv: 'logCsv',
    error: 'logError',
    query: logQuery,
    headers: ['Zeitpunkt', 'Aktion', 'Ziel', 'Begründung'],
    empty: 'Keine Einträge für diesen Filter.',
    row: (e) => {
      const row = document.createElement('tr');
      cell(row, fmt(e.at));
      cell(row, e.action);
      cell(row, e.gameTitle ? `${e.gameTitle} (${e.target})` : e.email || e.target);
      // A redaction's whole point is the original wording, which exists nowhere
      // else once the field is blanked — so show it next to the reason.
      cell(row, e.previous ? `${e.reason || '—'} · vorher: „${e.previous}“` : (e.reason || '—'));
      return row;
    },
  });

  // Offer exactly the actions that can match, rather than a hardcoded list that
  // drifts as new ones are added (this issue added the redact_* kinds).
  async function loadLogActions() {
    let actions;
    try {
      ({ actions } = await api('/log/actions'));
    } catch {
      return; // the list is a convenience; the log itself already reported any error
    }
    const select = $('logAction');
    const chosen = select.value;
    select.replaceChildren();
    for (const [value, label] of [['', 'Alle Aktionen'], ...actions.map((a) => [a, a])]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    }
    select.value = chosen;
  }

  // Every action that writes a log entry may also have introduced a new action
  // NAME, so the two always refresh together.
  function refreshLog() {
    loadLog();
    loadLogActions();
  }

  $('logApply').addEventListener('click', () => loadLog());
  $('logReset').addEventListener('click', () => {
    for (const id of ['logAction', 'logTenant', 'logFrom', 'logTo']) $(id).value = '';
    loadLog();
  });

  // ---- notices (#272) ------------------------------------------------------

  // German labels for the stored category values (lib/routes/contact.js CATEGORIES).
  const CATEGORY_LABELS = {
    copyright: 'Urheberrecht',
    csam: 'Missbrauchsdarstellungen',
    hate: 'Volksverhetzung / Kennzeichen',
    defamation: 'Beleidigung / Verleumdung',
    privacy: 'Persönlichkeitsrecht',
    other: 'Sonstiger rechtswidriger Inhalt',
  };

  const NOTICE_STATUS = {
    open: ['warn', 'offen'],
    actioned: ['ok', 'erledigt'],
    rejected: ['', 'abgelehnt'],
  };

  // A reported URL that names one of OUR stored covers — whether pasted as the
  // bare path or a full https://…/uploads/… address. Only this shape can be
  // handed to the image lookup.
  const uploadsPath = (url) => {
    const m = String(url || '').match(/\/uploads\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+/);
    return m ? m[0] : null;
  };

  // The "resolve → takedown" hand-off: fill the existing image lookup with the
  // reported path, prefill the takedown reason with a reference to the notice
  // (what an Art. 17 statement later quotes), and run the lookup. The takedown
  // route itself is unchanged — this only stops the flow being copy-paste.
  function assignNotice(n, path) {
    $('lookupBy').value = 'image';
    $('lookupBy').dispatchEvent(new Event('change')); // updates label, clears the value
    $('lookupValue').value = path;
    const label = n.category ? (CATEGORY_LABELS[n.category] || n.category) : 'Kontakt';
    $('takedownReason').value = `Meldung vom ${fmt(n.createdAt)} (${label}): ${n.url}`;
    $('lookupForm').requestSubmit();
    $('lookupForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The username half of the same hand-off (#320): drive the existing lookup
  // with the reported handle instead of making the operator retype it. No
  // takedown reason is prefilled — a reported *account* has no single target to
  // act on yet; the lookup card is where the operator decides what to do.
  function lookupUsername(username) {
    $('lookupBy').value = 'username';
    $('lookupBy').dispatchEvent(new Event('change')); // updates label, clears the value
    $('lookupValue').value = username;
    $('lookupForm').requestSubmit();
    $('lookupForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Decide a notice: status + optional note, and — when the notice carries an
  // address — the Art. 16(5) decision mail. The prompt's cancel aborts; an
  // empty note is fine (the mail then states only the outcome).
  async function decideNotice(n, status) {
    const note = window.prompt(
      `${status === 'actioned' ? 'Erledigt' : 'Abgelehnt'}: kurze Begründung für die meldende Person (optional)`,
      '',
    );
    if (note === null) return;
    const sendEmail = n.email
      ? window.confirm(`Entscheidung per E-Mail an ${n.email} mitteilen (Art. 16 Abs. 5)?`)
      : false;
    try {
      await api(`/notices/${encodeURIComponent(n.id)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ status, note: note.trim(), sendEmail }),
      });
      loadNotices();
    } catch (err) {
      show($('noticesError'), message(err), 'err');
    }
  }

  // Delete one notice (issue #389). A DECIDED notice is 3-year Art. 17 retention
  // evidence — warn hard and send the server's `?force=1` override; an open one
  // (test data) just needs a plain confirm. The server refuses a decided delete
  // without the override, so this cannot silently defeat the retention duty.
  async function deleteNotice(n) {
    const decided = Boolean(n.decidedAt);
    const warn = decided
      ? 'Diese Meldung wurde ENTSCHIEDEN und ist als Nachweis (Art. 17 DSA) drei Jahre '
        + 'aufzubewahren. Trotzdem endgültig löschen?'
      : 'Diese Meldung endgültig löschen?';
    if (!window.confirm(warn)) return;
    try {
      await api(`/notices/${encodeURIComponent(n.id)}${decided ? '?force=1' : ''}`, { method: 'DELETE' });
      loadNotices();
    } catch (err) {
      show($('noticesError'), message(err), 'err');
    }
  }

  // The whole notice, and exactly the actions that can apply to it: the image /
  // account hand-offs only when the report actually names one, the decision pair
  // only while it is still open.
  const noticeDetail = (n) => {
    const path = uploadsPath(n.url);
    const actions = [];
    if (path) actions.push(['Bild zuordnen', 'small ghost', () => assignNotice(n, path)]);
    if (n.reportedUsername) {
      actions.push(['Konto suchen', 'small ghost', () => lookupUsername(n.reportedUsername)]);
    }
    if (n.status === 'open') {
      actions.push(['Erledigt', 'small', () => decideNotice(n, 'actioned')]);
      actions.push(['Abgelehnt', 'small ghost', () => decideNotice(n, 'rejected')]);
    }
    actions.push(['Löschen', 'small danger', () => deleteNotice(n)]);

    const [, label] = NOTICE_STATUS[n.status] || ['', n.status];
    return {
      title: n.category ? (CATEGORY_LABELS[n.category] || n.category) : 'Allgemein',
      pairs: [
        ['Zeitpunkt', fmt(n.createdAt)],
        ['Status', label],
        ['Betreff', n.subject || null],
        ['Gemeldete URL', n.url || null],
        ['Gemeldeter Nutzername', n.reportedUsername ? `@${n.reportedUsername}` : null],
        // Anonymous is a legitimate state (CSAM reports, Art. 16(3)), not
        // missing data.
        ['Kontakt', [n.name, n.email].filter(Boolean).join(' · ') || 'anonym'],
        ['Entschieden', n.decidedAt ? fmt(n.decidedAt) : null],
        ['Entscheidungsnotiz', n.decisionNote || null],
      ],
      text: n.message,
      actions,
    };
  };

  const loadNotices = listCard({
    path: '/notices',
    name: 'meldungen',
    table: 'noticesTable',
    count: 'noticesCount',
    more: 'noticesMore',
    csv: 'noticesCsv',
    error: 'noticesError',
    headers: ['Zeitpunkt', 'Kategorie', 'Meldung', 'Status'],
    empty: 'Keine Meldungen.',
    row: (n) => {
      const row = detailRow(noticeDetail(n));
      cell(row, fmt(n.createdAt));
      cell(row, n.category ? (CATEGORY_LABELS[n.category] || n.category) : 'Allgemein');

      // Subject + message, attacker-controlled free text — cell() uses
      // textContent, so nothing renders as markup or a live link. The full
      // wording, the reported URL/username and the contact are in the dialog.
      cell(row, truncate(n.subject ? `${n.subject} — ${n.message}` : n.message, 90))
        .style.wordBreak = 'break-word';

      const status = cell(row, '');
      const [verdict, label] = NOTICE_STATUS[n.status] || ['', n.status];
      const pill = document.createElement('span');
      pill.className = verdict ? `pill pill--${verdict}` : 'pill';
      pill.textContent = label;
      status.appendChild(pill);

      return row;
    },
  });

  // ---- feedback (#260) -----------------------------------------------------

  // In-app user feedback, newest first. Since #275 the message is redactable
  // too: it is user-authored free text like any other, so it can carry the same
  // illegal content a game title can.
  const loadFeedback = listCard({
    path: '/feedback',
    name: 'feedback',
    table: 'feedbackTable',
    count: 'feedbackCount',
    more: 'feedbackMore',
    csv: 'feedbackCsv',
    error: 'feedbackError',
    headers: ['Zeitpunkt', 'Nachricht', 'Kontext', 'Kontakt'],
    empty: 'Noch kein Feedback.',
    row: (f) => {
      const ctx = f.context || {};
      const row = detailRow({
        title: `Feedback vom ${fmt(f.createdAt)}`,
        pairs: [
          ['Pfad', ctx.path || null],
          ['Sprache', ctx.locale || null],
          ['Tenant', ctx.tenantId || null],
          // Only present when the submitter explicitly opted in; anonymous is
          // the default, so an em dash here is the normal case, not missing data.
          ['Kontakt', ctx.email || '—'],
        ],
        text: f.message,
        actions: [
          ['Redigieren', 'small danger', () => redactFeedback(f)],
          ['Löschen', 'small danger', () => deleteFeedback(f)],
        ],
      });
      cell(row, fmt(f.createdAt));
      // The message is user-authored free text — cell() uses textContent, so it
      // is never interpreted as markup on this privileged page. The full wording,
      // with the submitter's own line breaks, is in the dialog.
      cell(row, truncate(f.message, 90)).style.wordBreak = 'break-word';
      cell(row, [ctx.path, ctx.locale, ctx.tenantId].filter(Boolean).join(' · ') || '—');
      cell(row, ctx.email || '—');
      return row;
    },
  });

  // ---- boot ----------------------------------------------------------------

  // Probe for an existing session so a reload doesn't force a re-login. A 404
  // (surface disabled) is reported on the login card rather than left blank.
  api('/me')
    .then(enterPanel)
    .catch((err) => {
      if (err.message === 'admin_disabled') show($('loginError'), message(err), 'err');
    });
})();
