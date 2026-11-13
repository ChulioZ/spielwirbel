/* Spielwirbel – views: the group challenge (#1779).

   Four surfaces, one derivation (challenges.js) — nothing here decides what
   counts, it only says it:

     .hub-card--challenge   the Start card while a challenge runs (and for a
                            few days after it ends, so the group sees the end)
     .challenge-section     Pokale › Challenge: the current one, start / end,
                            and the short history
     .challenge-moment      the result screen: one line when THIS session moved
                            or completed the current challenge, inside the
                            Abzeichen moment so it sits in each design's frame
     .chronik-row--challenge  under the session that completed one — it also
                            carries .chronik-row--badge, so every design paints
                            it as it paints an Abzeichen row

   The shared markup every design skins, like the Abzeichen's: each design
   paints these through its own tokens, so the content is the same everywhere.
   „Einfacher Modus" hides all of it with the Abzeichen (`trophies`) — a goal
   to play towards is the same kind of extra as a mark for having played.

   Words are `challenge.*` in lang/*.js; composition is limited to joining
   those with „ · ". Part of the frontend; all files share one global script
   scope. Every caller reaches these at RENDER time. */

'use strict';

// How long an ended challenge stays on the Start card: long enough for the
// group to see it was done (or missed), short enough not to squat there.
const CHALLENGE_HUB_LINGER_DAYS = 7;

// „10 Sessions", „Jedes Spiel im Regal einmal", …
function challengeGoalText(ch) {
  if (ch.kind === 'wholeShelf') return t('challenge.goal.wholeShelf');
  return tn(ch.n, `challenge.goal.${ch.kind}One`, `challenge.goal.${ch.kind}`);
}

// The progress line: „3 von 10 · bis 31.03.2026 · noch 12 Tage", or the outcome.
function challengeStatusText(cur, now = Date.now()) {
  const progress = t('challenge.progress', { count: cur.count, of: cur.of });
  if (cur.state === 'completed') return [t('challenge.state.completed'), fmtDate(cur.completedAt.at)].join(' · ');
  if (cur.state === 'expired') return [progress, t('challenge.state.expired', { date: fmtDate(cur.deadline) })].join(' · ');
  if (cur.state === 'ended') return [progress, t('challenge.state.ended')].join(' · ');
  const days = challengeDaysLeft(cur, now);
  const left = days <= 1 ? t('challenge.lastDay') : tn(days, 'challenge.daysLeftOne', 'challenge.daysLeft');
  return [progress, t('challenge.until', { date: fmtDate(cur.deadline) }), left].join(' · ');
}

// The bar: `--pct` is the share done, painted by each design.
function challengeBar(cur) {
  const pct = cur.of ? Math.round((Math.min(cur.count, cur.of) / cur.of) * 100) : 0;
  return `<span class="challenge-bar" style="--pct:${pct}%" role="img" aria-label="${esc(t('challenge.progress', { count: cur.count, of: cur.of }))}"><span class="challenge-bar__fill"></span></span>`;
}

// When the challenge stopped running, or null while it still runs.
function challengeEndedAt(cur) {
  if (cur.state === 'completed') return Date.parse(cur.completedAt.at);
  if (cur.state === 'ended') return Date.parse(cur.endedAt);
  if (cur.state === 'expired') return Date.parse(cur.deadline);
  return null;
}

/* ------------------------------- Start card ------------------------------- */

function hubChallengeCard(round, now = Date.now()) {
  if (simpleHidden('trophies')) return null;
  const cur = currentChallenge(round, now);
  if (!cur) return null;
  const ended = challengeEndedAt(cur);
  if (ended !== null && now - ended > CHALLENGE_HUB_LINGER_DAYS * 24 * 60 * 60 * 1000) return null;
  const card = hubCard(cur.state === 'completed' ? 'ti-flag-check' : 'ti-flag', t('challenge.title'));
  card.classList.add('hub-card--link', 'hub-card--challenge');
  card.dataset.state = cur.state;
  const row = h(`<a class="hub-row hub-card__go">
       <span class="hub-row__main">
         <span class="hub-row__title">${esc(challengeGoalText(cur))}</span>
         <span class="hub-row__sub">${esc(challengeStatusText(cur, now))}</span>
         ${challengeBar(cur)}
       </span>
       <i class="ti ti-chevron-right hub-row__go" aria-hidden="true"></i>
     </a>`);
  navLink(row, roundPath(round.id, 'pokale'), () => showRound(round.id, 'pokale'));
  card.querySelector('.hub-card__body').appendChild(row);
  return card;
}

/* ------------------------------ Pokale section ---------------------------- */

// Null under the simple mode, so the caller appends nothing.
function renderChallengeSection(round, now = Date.now()) {
  if (simpleHidden('trophies')) return null;
  const sec = h(`<section class="challenge-section" id="challenge">
       <div class="section-head"><h2>${iconText('ti-flag', t('challenge.title'))}</h2></div>
     </section>`);
  const cur = currentChallenge(round, now);
  const canEdit = roundCan(round, 'round.write');
  if (cur) {
    const box = h(`<div class="challenge-current" data-state="${esc(cur.state)}">
         <p class="challenge-current__goal">${esc(challengeGoalText(cur))}</p>
         <p class="challenge-current__status">${esc(challengeStatusText(cur, now))}</p>
         ${challengeBar(cur)}
       </div>`);
    if (canEdit) {
      const running = cur.state === 'running';
      const btn = h(`<button type="button" class="link-btn challenge-current__end">${esc(t(running ? 'challenge.end' : 'challenge.archive'))}</button>`);
      btn.addEventListener('click', () => endChallenge(round, running));
      box.appendChild(btn);
    }
    sec.appendChild(box);
  } else {
    sec.appendChild(h(`<p class="muted challenge-section__empty">${esc(t('challenge.none'))}</p>`));
  }
  if (canEdit && (!cur || cur.state !== 'running')) {
    const start = h(`<button type="button" class="btn challenge-section__start">${iconText('ti-flag', t('challenge.start'))}</button>`);
    start.addEventListener('click', () => openChallengeSheet(round, start));
    sec.appendChild(start);
  }
  const past = challengeHistory(round, now);
  if (past.length) {
    const list = h(`<details class="challenge-history"><summary>${esc(t('challenge.history'))}</summary><ul class="challenge-history__list"></ul></details>`);
    past.forEach((ch) => list.querySelector('ul').appendChild(h(`<li class="challenge-history__item" data-state="${esc(ch.state)}">
         <span class="challenge-history__goal">${esc(challengeGoalText(ch))}</span>
         <span class="challenge-history__status">${esc([fmtDate(ch.startedAt), challengeStatusText(ch, now)].join(' · '))}</span>
       </li>`)));
    sec.appendChild(list);
  }
  return sec;
}

const challengeRefresh = async (rid) => {
  await fetchRoundFresh(rid);
  showRound(rid, 'pokale');
};

async function endChallenge(round, running) {
  if (running && !await confirmDialog({
    body: t('challenge.endConfirm'), confirmLabel: t('challenge.end'), icon: 'ti-flag-off', danger: false,
  })) return;
  try {
    await api('DELETE', `/api/rounds/${round.id}/challenge`);
    if (running) toast(t('challenge.toast.ended'), { tone: 'success' });
    await challengeRefresh(round.id);
  } catch (e) { toast(e.message, { tone: 'error' }); }
}

// 'YYYY-MM-DD' of a local date, for the date input.
const challengeDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function openChallengeSheet(round, anchor) {
  openEditor(anchor, 'challenge', t('challenge.sheet.title'), (el, close) => {
    const hasShelf = round.games.some(isActiveGame);
    const kinds = CHALLENGE_KINDS.filter((k) => k !== 'wholeShelf' || hasShelf);
    const kind = h(`<select class="input" id="challengeKind">${kinds
      .map((k) => `<option value="${k}">${esc(t(`challenge.kind.${k}`))}</option>`).join('')}</select>`);
    const n = h(`<input class="input" id="challengeN" type="number" inputmode="numeric" min="${CHALLENGE_N_MIN}" max="${CHALLENGE_N_MAX}" value="5" />`);
    const deadline = h('<input class="input" id="challengeDeadline" type="date" />');
    const today = new Date();
    deadline.min = challengeDay(today);
    deadline.max = challengeDay(new Date(today.getTime() + (CHALLENGE_DEADLINE_MAX_DAYS - 1) * 24 * 60 * 60 * 1000));
    deadline.value = challengeDay(new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000));
    const field = (id, label, control) => {
      const f = h(`<div class="field"><label for="${id}">${esc(label)}</label></div>`);
      f.appendChild(control);
      return f;
    };
    const nField = field('challengeN', t('challenge.sheet.n'), n);
    // Inline display rather than `hidden`: `.field` carries its own display rule
    // in some designs, which the attribute alone would lose to.
    const sync = () => { nField.style.display = CHALLENGE_COUNTED.includes(kind.value) ? '' : 'none'; };
    kind.addEventListener('change', sync);
    sync();
    const ok = h(`<button type="button" class="btn btn--primary">${esc(t('challenge.sheet.submit'))}</button>`);
    ok.addEventListener('click', async () => {
      const body = { kind: kind.value, deadline: challengeDeadlineInstant(deadline.value) };
      if (CHALLENGE_COUNTED.includes(kind.value)) body.n = Number(n.value);
      const invalid = challengeStartError(body);
      if (invalid) return toast(t(invalid === 'Invalid n' ? 'challenge.error.n' : 'challenge.error.deadline', { min: CHALLENGE_N_MIN, max: CHALLENGE_N_MAX }));
      try {
        await api('POST', `/api/rounds/${round.id}/challenge`, body);
        close();
        toast(t('challenge.toast.started'), { tone: 'success' });
        await challengeRefresh(round.id);
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
    el.append(field('challengeKind', t('challenge.sheet.kind'), kind), nField,
      field('challengeDeadline', t('challenge.sheet.deadline'), deadline), editorActions(ok));
    return () => kind.focus();
  });
}

/* ---------------------------- the result screen --------------------------- */

/* One line when the round's LATEST finished session moved the current
   challenge — the Abzeichen moment's rule: this is the moment it happened, an
   older session's part is in the Chronik. It is appended INSIDE `host`, the
   result screen's `.badge-moment`, right after fillBadgeMoment refilled it, so
   every design's composition places it without knowing about it; the host is
   un-hidden when the challenge is all it has to say. */
function fillChallengeMoment(host, round, session, now = Date.now()) {
  const stale = host.querySelector('.challenge-moment');
  if (stale) stale.remove();
  if (!session.finished || simpleHidden('trophies') || !round.challenge) return;
  const known = round.sessions.some((s) => s.id === session.id);
  const sessions = known ? round.sessions.map((s) => (s.id === session.id ? session : s)) : round.sessions.concat(session);
  const latest = sessions.filter((s) => s.finished)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .pop();
  if (!latest || latest.id !== session.id) return;
  const cur = currentChallenge({ ...round, sessions }, now);
  if (!cur || !cur.steps.some((s) => s.sessionId === session.id)) return;
  const done = !!(cur.completedAt && cur.completedAt.sessionId === session.id);
  const text = done
    ? t('challenge.moment.completed', { goal: challengeGoalText(cur) })
    : [t('challenge.moment.advanced', { goal: challengeGoalText(cur) }), challengeStatusText(cur, now)].join(' · ');
  const el = h(`<div class="challenge-moment" data-state="${done ? 'completed' : 'running'}">
       <p class="challenge-moment__text">${iconText(done ? 'ti-flag-check' : 'ti-flag', text)}</p>
       ${done ? '' : challengeBar(cur)}
     </div>`);
  host.appendChild(el);
  host.hidden = false;
}

/* -------------------------------- the Chronik ------------------------------ */

// sessionId -> the challenges that session completed (current and past).
function challengeChronikIndex(round, now = Date.now()) {
  const out = new Map();
  if (simpleHidden('trophies')) return out;
  const all = challengeHistory(round, now);
  const cur = currentChallenge(round, now);
  if (cur) all.unshift(cur);
  all.forEach((ch) => {
    if (!ch.completedAt) return;
    const list = out.get(ch.completedAt.sessionId) || [];
    list.push(ch);
    out.set(ch.completedAt.sessionId, list);
  });
  return out;
}

function chronikChallengeRows(round, completed) {
  return (completed || []).map((ch) => {
    const row = h(`<div class="chronik-row chronik-row--badge chronik-row--challenge">
         <span class="chronik-row__icon"><i class="ti ti-flag-check" aria-hidden="true"></i></span>
         <span class="chronik-row__label">${esc(t('challenge.chronik'))}</span>
         <a class="chronik-row__text">${esc(challengeGoalText(ch))}</a>
       </div>`);
    navLink(row.querySelector('a'), roundPath(round.id, 'pokale'), () => showRound(round.id, 'pokale'));
    return row;
  });
}
