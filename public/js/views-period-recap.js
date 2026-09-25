/* Spielwirbel – views: the Chronik's per-period recap section (#800, #851) and
   the share delivery its PNG card goes out through — also used by the
   Regal-Steckbrief (views-shelf-profile.js) and the account's own recap
   (views-profile.js). Split out of views-chronik.js (#1345), which keeps the
   timeline and calls renderPeriodRecapSection() from renderChronikTab().
   Part of the frontend; all files share one global script scope. */

/*
 * The per-period recap (#800): what one calendar month or year looked like, as
 * its own section above the timeline (#851) — and the one thing on this screen
 * made to leave it, as a PNG the user hands to their group chat.
 *
 * The aggregation is period-recap.js; recap-card.js draws the image. This
 * function only picks the period and renders. Returns null (no section at all)
 * when the round has nothing to say about any period, so there is no empty
 * state to design — periodsOf() already refuses to offer a period with neither
 * a played session nor a shelf change.
 */
function renderPeriodRecapSection(round, activities) {
  const periods = periodsOf(round, activities);
  if (!periods.length) return null;

  // Months are formatted through the locale machinery (fmtMonth -> localeTag,
  // js/locales.js), never a month-name array of our own — a hardcoded one is
  // the thing that silently ships English months to a French reader.
  const labelOf = (p) => (p.kind === 'month' ? fmtMonth(p.at) : p.key);
  const idOf = (p) => `${p.kind}:${p.key}`;

  const sec = h('<div class="section precap"></div>');
  /* Der Tisch on a phone (#1271, T13.5): the recap is ONE felt line at the top
     of the Chronik — „Rückblick September 2026" — that opens the full section
     in place. The same section, not a second copy of it: the line is a
     disclosure over the panel below it, and from 521px up tisch.css hides the
     line and shows the panel as always (the desktop column is T13.1's). */
  let panel = sec;
  let entryLabel = null;
  if (designIs('tisch')) {
    sec.classList.add('precap--entry');
    const entry = h(`<button type="button" class="precap__entry" aria-expanded="false" aria-controls="precap-panel">
         <i class="ti ti-history" aria-hidden="true"></i>
         <span class="precap__entry-label"></span>
         <i class="ti ti-chevron-down precap__entry-chev" aria-hidden="true"></i>
       </button>`);
    entryLabel = entry.querySelector('.precap__entry-label');
    panel = h('<div class="precap__panel" id="precap-panel"></div>');
    entry.addEventListener('click', () => {
      const open = !sec.classList.contains('is-open');
      sec.classList.toggle('is-open', open);
      entry.setAttribute('aria-expanded', String(open));
    });
    sec.appendChild(entry);
    sec.appendChild(panel);
  }
  panel.appendChild(h(`<div class="section-head"><h2>${esc(t('periodRecap.title'))}</h2></div>`));
  panel.appendChild(h(`<p class="muted recap__lead">${esc(t('periodRecap.lead'))}</p>`));

  // Two groups rather than one flat list: a round three years in has 36 months,
  // and „2026" sitting between „März 2026" and „Februar 2026" reads as a month
  // whose name went missing. Months lead because the freshest slice is the one
  // the tab gets opened for; the default selection is simply the first option.
  const group = (list, label) =>
    list.length
      ? `<optgroup label="${esc(label)}">${list.map((p) => `<option value="${esc(idOf(p))}">${esc(labelOf(p))}</option>`).join('')}</optgroup>`
      : '';
  const head = h(`<div class="precap__head">
       <select class="select precap__picker" aria-label="${esc(t('periodRecap.pickerLabel'))}">
         ${group(periods.filter((p) => p.kind === 'month'), t('periodRecap.months'))}
         ${group(periods.filter((p) => p.kind === 'year'), t('periodRecap.years'))}
       </select>
     </div>`);
  const picker = head.querySelector('.precap__picker');
  panel.appendChild(head);

  const body = h('<div class="precap__body"></div>');
  panel.appendChild(body);

  const currentPeriod = () => periods.find((p) => idOf(p) === picker.value) || periods[0];

  // The dependencies period-recap.js takes injected (see its header). Built
  // once: two literals is how the picker's card and the shared image would start
  // to disagree about how much evidence a crown costs, or about which games may
  // wear one.
  const deps = {
    peopleOf: sessionPeople,
    scoreOf: scoreRatings,
    // The shelf half of the same rule (#894): the period card is shrunk exactly
    // as the all-time one is, so „Bestbewertet" means one thing on both.
    shelfOf: shelfScore,
    playsOf: playCounts,
    minRatings: RECAP_MIN_RATINGS,
    isActive: isActiveGame,
  };

  // What the card would say, built from the SAME numbers the screen is showing
  // — the session share button's rule (#526): the image can never claim more
  // than the section above it, because there is nothing else here to read.
  const shareModel = (period, rec) => ({
    heading: round.name,
    periodLabel: labelOf(period),
    sessions: rec.sessions,
    gamesPlayed: rec.gamesPlayed,
    played: rec.topPlayed ? recapGames(round, rec.topPlayed.gameIds).map((g) => g.title) : [],
    playedSub: rec.topPlayed ? tn(rec.topPlayed.count, 'home.chip.sessionsOne', 'home.chip.sessions') : '',
    rated: rec.topRated ? recapGames(round, rec.topRated.gameIds).map((g) => g.title) : [],
    ratedScore: rec.topRated ? fmtAvg(displayScore(rec.topRated.score)) : '',
    shelf: recapShelfEntries(rec),
  });

  if (canShareRecapImage()) {
    const btn = h(`<button class="btn btn--ghost precap__share">${iconText('ti-share', t('share.button'))}</button>`);
    // Built at CLICK time, like the results screen's share button: the picker
    // moves under this closure, so a model captured at render would share the
    // month the user was looking at before.
    btn.addEventListener('click', () => {
      const period = currentPeriod();
      shareRecapCard(period, shareModel(period, periodRecap(round, activities, period, deps)));
    });
    head.appendChild(btn);
  }

  function renderBody() {
    const period = currentPeriod();
    const rec = periodRecap(round, activities, period, deps);
    body.innerHTML = '';
    // The phone's one-line entry names the period the panel shows, so it
    // follows the picker.
    if (entryLabel) entryLabel.textContent = t('periodRecap.entry', { period: labelOf(period) });

    /* Ocean draws each total as a NUMBER TILE (#1218, O13.1/O13.5 „Zahlenkachel":
       a big display-face figure over a small label). The labels are the ones the
       share card already prints beside its figures (periodRecap.label.*), so the
       tile and the PNG it shares cannot name a number two ways. Same five
       figures, same non-zero rule — only the presentation differs. */
    const ocean = designIs('ocean');
    const chip = ocean
      ? (icon, text, n, label) => h(`<span class="stat-chip stat-chip--tile"><span class="stat-chip__n">${esc(String(n))}</span><span class="stat-chip__label">${esc(t(label))}</span></span>`)
      : (icon, text) => h(`<span class="stat-chip"><i class="ti ${icon}" aria-hidden="true"></i>${esc(text)}</span>`);
    const totals = h('<div class="recap__totals"></div>');
    totals.appendChild(chip('ti-confetti', tn(rec.sessions, 'home.chip.sessionsOne', 'home.chip.sessions'), rec.sessions, 'periodRecap.label.sessions'));
    totals.appendChild(chip('ti-cards', tn(rec.gamesPlayed, 'periodRecap.playedOne', 'periodRecap.played'), rec.gamesPlayed, 'periodRecap.label.gamesPlayed'));
    // Only the non-zero shelf numbers, the call the Rückblick's archive chip
    // already makes: "0 aussortiert" is noise on a quiet month.
    if (rec.added) totals.appendChild(chip('ti-plus', tn(rec.added, 'periodRecap.addedOne', 'periodRecap.added'), rec.added, 'periodRecap.label.added'));
    if (rec.retired) totals.appendChild(chip('ti-trash', tn(rec.retired, 'periodRecap.retiredOne', 'periodRecap.retired'), rec.retired, 'periodRecap.label.retired'));
    if (rec.completed) totals.appendChild(chip('ti-circle-check', tn(rec.completed, 'periodRecap.completedOne', 'periodRecap.completed'), rec.completed, 'periodRecap.label.completed'));
    body.appendChild(totals);

    // One loader per render of this body (#979) — renderBody re-runs on every
    // change of the period picker, and the cards it built last time are gone.
    const loadCover = createCoverLoader();
    const cards = h('<div class="pokale-cards"></div>');
    // The labels carry the period. They no longer HAVE to — #851 moved this
    // section off the Pokale tab, so the all-time cards it used to collide with
    // are on another screen — but here the „· Juli 2026" is what ties a card to
    // the picker above it, so the scoped keys are kept deliberately.
    // (The shared PNG uses the short labels instead — there the period is the
    // headline, so repeating it in every row would be noise.)
    const scope = { period: labelOf(period) };
    if (rec.topPlayed) {
      cards.appendChild(pokaleGameCard(round, 'ti-flame', t('periodRecap.mostPlayed', scope), recapGames(round, rec.topPlayed.gameIds),
        tn(rec.topPlayed.count, 'home.chip.sessionsOne', 'home.chip.sessions'), loadCover));
    }
    // Absent rather than crowned by a single vote: below RECAP_MIN_RATINGS
    // within the period there is no card at all (period-recap.js).
    if (rec.topRated) {
      cards.appendChild(pokaleGameCard(round, 'ti-star', t('periodRecap.bestRated', scope), recapGames(round, rec.topRated.gameIds),
        fmtAvg(displayScore(rec.topRated.score)), loadCover));
    }
    // The grid is appended even when EMPTY. Its original reason is gone —
    // #851 took this section OUT of the >=1280px wide-column exemption, so a
    // dropped container can no longer resize it under the reader — but keeping
    // it costs nothing (an empty grid has no height, and `:empty` drops its
    // margin) and keeps one render path instead of two.
    body.appendChild(cards);
    if (!cards.children.length) body.appendChild(h(`<p class="muted precap__thin">${esc(t('periodRecap.thin'))}</p>`));
  }

  picker.addEventListener('change', renderBody);
  renderBody();
  return sec;
}

// Can this browser deliver the PNG at all? Two independent paths, and the share
// sheet is NOT implied by navigator.share: `canShare({ files })` is a separate
// capability that desktop Chrome does not have. The download fallback covers
// it; where neither exists the button is never rendered rather than shown and
// inert, exactly as canShareResult() decides for the session summary.
function canShareRecapImage() {
  const canFiles = !!(navigator.canShare && navigator.share && typeof File !== 'undefined');
  return canFiles || 'download' in document.createElement('a');
}

// Hand the card to the user's own picker, or save it. Nothing is ever sent
// anywhere by us — the same trust shape as the session share text (#526): the
// image is produced on the device and the USER chooses the recipient.
//
// `name` is the downloaded file's name. The account's own recap (#1147) passes
// one ending in `-me`, so its card and a round's card of the same month can sit
// in one downloads folder without the second silently becoming "(1)".
async function shareRecapCard(period, model, name = `spielwirbel-${period.key}.png`) {
  let blob;
  try {
    blob = await recapCardBlob(model);
  } catch (err) {
    // The error was not even bound to a variable until #1149. Nothing here
    // touches the server, so this catch was the END of the story: canvas.toBlob()
    // threw a SecurityError for EVERY round on a world design in Safari and
    // every iOS browser, and the only trace anywhere was this one toast on the
    // user's own screen (.claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md).
    // The toast is unchanged — this adds a report, it does not change what the
    // user sees.
    reportClientError('recap_export', err);
    toast(t('periodRecap.toast.failed'), { tone: 'error' });
    return;
  }
  await deliverShareImage(blob, name);
}

// Hand a finished PNG to the user's own share sheet, or save it where the
// browser has no file sharing. Shared by the recap's card and the
// Regal-Steckbrief's (#1173, views-shelf-profile.js), so the two cannot drift
// apart on the load-bearing details below.
async function deliverShareImage(blob, name) {
  if (navigator.canShare && navigator.share && typeof File !== 'undefined') {
    const file = new File([blob], name, { type: 'image/png' });
    // canShare must be asked about THIS file: a browser can advertise
    // navigator.share and still refuse file payloads.
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        // Dismissing the sheet is a normal outcome, not a failure — toasting
        // would scold a user who simply changed their mind.
        if (e && e.name === 'AbortError') return;
        // Anything else falls through to the download rather than dead-ending.
      }
    }
  }
  // Two things here are load-bearing and both fail SILENTLY — no error, no
  // toast, simply no file. The anchor is appended before it is clicked, because
  // a detached one has historically been ignored; and the object URL is revoked
  // on a later task rather than on the next line, because revoking it while the
  // download the click just started is still reading it races that read.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
  toast(t('periodRecap.toast.saved'));
}
