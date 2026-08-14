/* Spielwirbel – "Das könnte euch auch gefallen" (#682): games the round does not
   own, ranked server-side from the licensed BGG corpus against the round's own
   taste, each card saying WHY it is there and offering one tap onto the
   Wunschliste.

   Everything on screen comes from GET …/recommendations. There is no scoring
   here on purpose: the weights are one block in lib/recommend.js, and a second
   opinion in the client would be the drift
   .claude/rules/shared-constants-across-the-stack.md exists for. */

'use strict';

// The reason line names the two terms that actually earned the placement. The
// server sends the DATA (which term, which numbers, which of the round's own
// games); the sentence is built here, because it is the only half that has to be
// translated. A term the client has no phrase for renders as nothing at all —
// the session-log failure mode — so an unknown one is dropped rather than
// half-rendered.
function recReasonText(reason) {
  if (!reason || !reason.term) return '';
  if (reason.term === 'quality') return t('suggest.reason.quality', { rating: recNum(reason.rating) });
  if (reason.term === 'complexity') return t('suggest.reason.complexity', { weight: recNum(reason.weight) });
  if (reason.term === 'players') return t('suggest.reason.players', { n: reason.players });
  if (reason.term === 'time') return t('suggest.reason.time', { minutes: reason.minutes });
  if (reason.term === 'mechanics') return t('suggest.reason.mechanics', { games: joinNames(reason.games || []) });
  if (reason.term === 'categories') return t('suggest.reason.categories', { games: joinNames(reason.games || []) });
  return '';
}

// Named `recNum` rather than the obvious `fmtNum`: these files share ONE global
// scope and `no-redeclare` is off there, so a name this generic would silently
// take over for everyone (.claude/rules/eslint-frontend-shared-scope.md).
// One decimal in the reader's own locale — a German reader reads 3,1 rather than
// 3.1, and these numbers sit inside a sentence.
function recNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  // `localeTag()` takes the locale EXPLICITLY and falls back to English when
  // called bare — so a missing `getLocale()` here is not a no-op, it silently
  // prints 8.4 to a German reader who should see 8,4. Same shape as
  // views-stats.js's number formatting.
  return v.toLocaleString(localeTag(getLocale()), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// The facts under the title. Every one of them is BGG's, rendered verbatim —
// nothing here rescales a weight or reworks a range (the licence forbids
// modifying the data, .claude/rules/bgg-corpus.md).
function recFacts(rec) {
  const facts = [];
  if (typeof rec.rating === 'number') facts.push(`<i class="ti ti-star" aria-hidden="true"></i> ${esc(recNum(rec.rating))}`);
  if (typeof rec.weight === 'number') facts.push(`<i class="ti ti-scale" aria-hidden="true"></i> ${esc(t('suggest.fact.weight', { weight: recNum(rec.weight) }))}`);
  const range = (a, b) => {
    // Ordered, because BGG's two bounds are not guaranteed to be: a row whose
    // min exceeds its max renders "80–60 Min.", which reads as a bug in the app
    // rather than as odd upstream data. Seen on the first browser pass. Ordering
    // is not MODIFYING the data — both numbers are still shown, unrounded.
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return lo === hi ? String(hi) : `${lo}–${hi}`;
  };
  if (typeof rec.minPlayers === 'number' && typeof rec.maxPlayers === 'number') {
    facts.push(`<i class="ti ti-users" aria-hidden="true"></i> ${esc(t('suggest.fact.players', { players: range(rec.minPlayers, rec.maxPlayers) }))}`);
  }
  if (typeof rec.maxPlaytime === 'number') {
    const time = typeof rec.minPlaytime === 'number' ? range(rec.minPlaytime, rec.maxPlaytime) : String(rec.maxPlaytime);
    facts.push(`<i class="ti ti-clock" aria-hidden="true"></i> ${esc(t('suggest.fact.time', { time }))}`);
  }
  return facts;
}

// Which empty state to show. The three are NOT interchangeable — they ask the
// reader for opposite things (import your shelf / wait for the database / no
// database here), and a single "nothing to show" would send someone off to
// re-import a collection that is already imported.
function recEmptyKey(data) {
  if (!data.corpusRows) return 'noCorpus';
  if (data.linkedGames < data.minProfileGames) return 'fewGames';
  if (data.profileGames < data.minProfileGames) return 'unknownGames';
  return 'noneLeft';
}

async function showRecommendations(rid) {
  currentView = () => showRecommendations(rid);
  syncUrl(roundPath(rid, 'recommendations'));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  setContext(round.name);
  setDocTitle(t('suggest.title'), round.name);

  let data;
  try { data = await api('GET', `/api/rounds/${rid}/recommendations`); }
  catch (e) { return toast(e.message); }

  app.innerHTML = '';
  renderSubScreenTabs(round, 'recommendations');
  app.appendChild(backRow(() => showRound(rid, 'regal')));
  app.appendChild(h(`<div class="page-head"><div>
       <h1>${esc(t('suggest.title'))}</h1>
       <div class="muted">${esc(round.name)}</div>
     </div></div>`));

  const recs = data.recommendations || [];
  if (!recs.length) {
    const key = recEmptyKey(data);
    const box = h(`<div class="empty"><p>${esc(t(`suggest.empty.${key}`))}</p></div>`);
    // Only the "your shelf is too thin" case has an action behind it: importing
    // a BGG collection is what fills a profile fastest. The other two are about
    // the instance's database, which the reader cannot do anything about.
    if (key === 'fewGames' && canImportBgg()) {
      const btn = h(`<button class="btn btn--primary"><i class="ti ti-download" aria-hidden="true"></i> ${esc(t('bggImport.link'))}</button>`);
      btn.addEventListener('click', () => showBggImport(round, 'own'));
      box.appendChild(btn);
    }
    app.appendChild(box);
    return;
  }

  // A lead-in, because a list of games the group does NOT own is otherwise easy
  // to misread as their own shelf.
  app.appendChild(h(`<p class="muted rec-lead">${esc(t('suggest.lead', { n: data.profileGames }))}</p>`));

  const list = h('<div class="rec-list"></div>');
  recs.forEach((rec) => {
    const reasons = (rec.reasons || []).map(recReasonText).filter(Boolean);
    const facts = recFacts(rec);
    // No cover: a corpus row carries no image, and hotlinking one would mean a
    // fetch per card against BGG's CDN for a screen nobody asked to load images
    // for. The deterministic placeholder is what every coverless game already
    // uses (.claude/rules/deterministic-cover-placeholders.md).
    const card = h(`<div class="rec-card">
         <div class="rec-card__img">${coverPlaceholder({ title: rec.title })}</div>
         <div class="rec-card__body">
           <div class="rec-card__title">${esc(rec.title)}${rec.year ? ` <span class="muted">(${esc(rec.year)})</span>` : ''}</div>
           ${facts.length ? `<div class="muted rec-card__facts">${facts.join('<span class="rec-card__sep">·</span>')}</div>` : ''}
           ${reasons.length ? `<ul class="rec-card__why">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
         </div>
         <div class="rec-card__actions">
           <button class="btn btn--primary" data-act="wish"><i class="ti ti-heart" aria-hidden="true"></i> ${esc(t('suggest.wish'))}</button>
           <a class="link-btn" target="_blank" rel="noopener noreferrer"><i class="ti ti-external-link" aria-hidden="true"></i> ${esc(t('suggest.open'))}</a>
         </div>
       </div>`);
    card.querySelector('a.link-btn').href = rec.url;

    card.querySelector('[data-act="wish"]').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      // The ordinary add-game write, not a route of its own: a recommendation
      // accepted is exactly a wished game carrying its BGG link, so it flows
      // through the pipeline #560/#664 already built — including the server-side
      // provider-info fetch that fills the metadata the Regal filters on.
      const fd = new FormData();
      fd.append('title', rec.title);
      // The corpus's own range, with the same fallback the add-game form uses
      // when a provider states none: the route requires both, and a game the
      // range is unknown for must stay drawable at every table size.
      fd.append('minPlayers', String(rec.minPlayers || 1));
      fd.append('maxPlayers', String(rec.maxPlayers || Math.max(rec.minPlayers || 1, 99)));
      fd.append('wish', 'true');
      fd.append('sourceProvider', 'bgg');
      fd.append('sourceExternalId', rec.externalId);
      fd.append('sourceUrl', rec.url);
      try {
        await api('POST', `/api/rounds/${rid}/games`, fd);
        toast(t('suggest.wished', { title: rec.title }));
        // Re-render rather than removing the card: the game is now owned, so it
        // is excluded from the next scoring — and one more candidate moves into
        // the list to take its place.
        showRecommendations(rid);
      } catch (e) {
        btn.disabled = false;
        toast(e.message);
      }
    });
    list.appendChild(card);
  });
  app.appendChild(list);

  // Where the numbers come from, stated on the screen rather than only in the
  // code: BGG must be credited wherever its data is presented (#117).
  app.appendChild(h(`<p class="muted rec-source">${esc(t('suggest.source'))}</p>`));
}
