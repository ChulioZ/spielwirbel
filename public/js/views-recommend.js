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
  // tn() injects `n` and picks the category via Intl.PluralRules, so n = 1
  // gets „Am besten solo" rather than the nonsensical „Am besten mit 1
  // Personen" — the same shape as home.chip.gamesOne, not an `n === 1` branch.
  if (reason.term === 'players') return tn(reason.players, 'suggest.reason.playersOne', 'suggest.reason.players');
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

// Which empty state to show. The five are NOT interchangeable — they ask the
// reader for opposite things (import your shelf / wait for the database / no
// database here / un-ignore something), and a single "nothing to show" would
// send someone off to re-import a collection that is already imported.
//
// `allDismissed` is checked LAST of the five: the three database states are
// about whether we could say anything at all, which is a more fundamental answer
// than what this round has hidden. But it must come before `noneLeft`, which
// claims "you already own everything that fits" — false, and unactionable, for a
// round that has simply ignored what was left.
function recEmptyKey(data) {
  if (!data.corpusRows) return 'noCorpus';
  if (data.linkedGames < data.minProfileGames) return 'fewGames';
  if (data.profileGames < data.minProfileGames) return 'unknownGames';
  if ((data.dismissed || []).length) return 'allDismissed';
  return 'noneLeft';
}

// The „Ignorierte" surface: a toggle plus, once opened, the list of titles this
// round has said no to, each with a way back.
//
// Collapsed by default and absent entirely when the list is empty: it is a
// RECOVERY surface, and a round that has never dismissed anything must not pay
// for it with a row that pushes the recommendations down the screen.
//
// The titles are the ones stored at dismissal time, not looked up — a dismissed
// row may have fallen out of the corpus since, and the reader still has to be
// able to find it to undo it.
function recIgnoredSection(rid, dismissed) {
  if (!dismissed.length) return null;
  const wrap = h('<div class="rec-ignored-wrap"></div>');
  const toggle = h(`<button class="link-btn" data-act="show-ignored" aria-expanded="false">
       <i class="ti ti-eye-off" aria-hidden="true"></i> ${esc(t('suggest.showIgnored', { n: dismissed.length }))}</button>`);
  wrap.appendChild(toggle);

  toggle.addEventListener('click', () => {
    const open = wrap.querySelector('.rec-ignored');
    if (open) {
      open.remove();
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = `<i class="ti ti-eye-off" aria-hidden="true"></i> ${esc(t('suggest.showIgnored', { n: dismissed.length }))}`;
      return;
    }
    toggle.setAttribute('aria-expanded', 'true');
    toggle.innerHTML = `<i class="ti ti-eye-off" aria-hidden="true"></i> ${esc(t('suggest.hideIgnored'))}`;
    const list = h(`<div class="rec-ignored"><h2 class="rec-ignored__title">${esc(t('suggest.ignoredTitle'))}</h2></div>`);
    dismissed.forEach((d) => {
      const row = h(`<div class="rec-ignored__row">
           <span class="rec-ignored__name">${esc(d.title || d.externalId)}</span>
           <button class="link-btn"><i class="ti ti-arrow-back-up" aria-hidden="true"></i> ${esc(t('suggest.restore'))}</button>
         </div>`);
      row.querySelector('button').addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          await api('DELETE', `/api/rounds/${rid}/recommendations/dismissed/${encodeURIComponent(d.externalId)}`);
          toast(t('suggest.restored', { title: d.title || d.externalId }));
          // A re-render rather than a row removal: the restored title re-enters
          // the ranking, so the list above it is no longer the one on screen.
          showRecommendations(rid);
        } catch (e) {
          ev.currentTarget.disabled = false;
          toast(e.message);
        }
      });
      list.appendChild(row);
    });
    wrap.appendChild(list);
  });
  return wrap;
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
    // The way back has to be reachable from the empty state too — `allDismissed`
    // is the one empty state whose action is "un-ignore something", and it would
    // otherwise name an affordance that is not on the screen.
    const ignored = recIgnoredSection(rid, data.dismissed || []);
    if (ignored) app.appendChild(ignored);
    return;
  }

  // A lead-in, because a list of games the group does NOT own is otherwise easy
  // to misread as their own shelf.
  app.appendChild(h(`<p class="muted rec-lead">${esc(t('suggest.lead', { n: data.profileGames }))}</p>`));

  const list = h('<div class="rec-list"></div>');
  recs.forEach((rec) => {
    const reasons = (rec.reasons || []).map(recReasonText).filter(Boolean);
    const facts = recFacts(rec);
    // The BGG box art (#779), hotlinked like every other provider cover
    // (.claude/rules/provider-cover-hotlinking.md) and already gated server-side
    // by providerCoverUrl, so `rec.image` is either a vouched-for https URL or
    // null. On this screen the cover is the recognition cue — the reader owns
    // none of these games, so the title is all they have to go on otherwise.
    //
    // coverPlaceholder() returns '' when an image is present, so the frame stays
    // one plain interpolation for both branches
    // (.claude/rules/deterministic-cover-placeholders.md).
    const imgStyle = rec.image ? ` style="background-image:url('${coverUrl(rec.image, COVER_THUMB)}')"` : '';
    const card = h(`<div class="rec-card">
         <div class="rec-card__img"${imgStyle}>${coverPlaceholder({ title: rec.title, image: rec.image })}</div>
         <div class="rec-card__body">
           <div class="rec-card__title">${esc(rec.title)}${rec.year ? ` <span class="muted">(${esc(rec.year)})</span>` : ''}</div>
           ${facts.length ? `<div class="muted rec-card__facts">${facts.join('<span class="rec-card__sep">·</span>')}</div>` : ''}
           ${reasons.length ? `<ul class="rec-card__why">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
         </div>
         <!-- Two of the three actions carry a SHORT visible label (#817): spelled
              out, the row wrapped to a second line on every card at 375px. The
              names are preserved rather than dropped — dismiss is icon-only and
              names itself via aria-label + title, and the link's aria-label
              CONTAINS its visible „BGG" as WCAG 2.2 SC 2.5.3 requires. -->
         <div class="rec-card__actions">
           <button class="btn btn--primary" data-act="wish"><i class="ti ti-heart" aria-hidden="true"></i> ${esc(t('suggest.wish'))}</button>
           <button class="link-btn link-btn--icon" data-act="dismiss" aria-label="${esc(t('suggest.dismiss'))}" title="${esc(t('suggest.dismiss'))}"><i class="ti ti-ban" aria-hidden="true"></i></button>
           <a class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('suggest.open'))}"><i class="ti ti-external-link" aria-hidden="true"></i> ${esc(t('suggest.openShort'))}</a>
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
      // The card's own cover, or nothing (#789). Without it the wish row stores
      // no image at all — the add is the only moment the URL is in hand, so the
      // placeholder would then follow the game through the wish list, its detail
      // page and the Regal until somebody hand-picked a cover.
      //
      // Not new trust in client input: the route re-validates it through
      // providerCoverUrl, exactly as the add-game sheet's cover picker is
      // (.claude/rules/provider-cover-hotlinking.md). `rec.image` has already
      // been through that gate server-side (lib/recommend.js), so this hands
      // back a URL the server itself vouched for one request ago.
      if (rec.image) fd.append('imageUrl', rec.image);
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
    card.querySelector('[data-act="dismiss"]').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await api('POST', `/api/rounds/${rid}/recommendations/dismissed`, { externalId: rec.externalId, title: rec.title });
      } catch (e) {
        btn.disabled = false;
        // The cap only ever binds on abuse (500 by default), but a raw
        // `quota_dismissed` in a toast tells the reader nothing they can act on.
        return toast(e.message === 'quota_dismissed' ? t('suggest.toast.quota') : e.message);
      }
      toast(t('suggest.dismissed', { title: rec.title }));
      // The card is REPLACED IN PLACE by a persistent undo row rather than the
      // screen being re-rendered, and the undo deliberately does not live in the
      // toast: toast() is a 2.2s aria-live region with no action slot, so a
      // button inside it would take the only way back away again on a timer —
      // and the app's own undo idiom (the session-cancel row in
      // views-session.js) is in-place for exactly that reason.
      //
      // Not re-rendering also keeps the reader's place: re-scoring would pull a
      // fresh candidate into the list and shift everything below the card they
      // were just looking at.
      const undone = h(`<div class="rec-undone">
           <span class="rec-undone__name">${esc(t('suggest.dismissed', { title: rec.title }))}</span>
           <button class="link-btn"><i class="ti ti-arrow-back-up" aria-hidden="true"></i> ${esc(t('suggest.undo'))}</button>
         </div>`);
      undone.querySelector('button').addEventListener('click', async (ev2) => {
        ev2.currentTarget.disabled = true;
        try {
          await api('DELETE', `/api/rounds/${rid}/recommendations/dismissed/${encodeURIComponent(rec.externalId)}`);
          // Back to the real card, not a re-render: the ranking is unchanged by
          // an undo of something that never left it.
          undone.replaceWith(card);
          btn.disabled = false;
        } catch (e) {
          ev2.currentTarget.disabled = false;
          toast(e.message);
        }
      });
      card.replaceWith(undone);
    });

    list.appendChild(card);
  });
  app.appendChild(list);

  const ignored = recIgnoredSection(rid, data.dismissed || []);
  if (ignored) app.appendChild(ignored);

  // Where the numbers come from, stated on the screen rather than only in the
  // code: BGG must be credited wherever its data is presented (#117).
  app.appendChild(h(`<p class="muted rec-source">${esc(t('suggest.source'))}</p>`));
}
