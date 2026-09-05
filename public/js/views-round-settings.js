/* Spielwirbel – the round's Einstellungen screen (#561).

   One home for every round-LEVEL action, at every width. Before this, the three
   that are not about a specific game were stranded in tab footers: "Einladen"
   and "Spiele verschieben" at the foot of the Regal grid, and — worst —
   "Diese Runde löschen" at the foot of the CHRONIK timeline, which was the only
   footer that was not `rail-owned`, so it sat there at every width while the
   rail carried no entry for it at all. Deleting a round is not a history
   concern, and on a phone it was reachable only by switching tabs and scrolling
   past the entire month-grouped history.

   It is a sibling of showTags/showBackground (views-round-detail.js)
   and deliberately NOT in that file: it is an independently editable concern and
   that file is already past its size budget (.claude/rules/token-friendly-source-files.md).

   The two sheets it opens — showTransferGames and showInvite — are in
   views-round-actions.js, loaded right after this file (#528). They had stayed
   behind in views-round-tabs.js when #561 moved their entry points here, so a
   change to either action meant opening the Regal's file to edit an
   Einstellungen action.

   Part of the frontend; all files share one global script scope. Every name it
   uses from a sibling file is referenced at call time, never at load time
   (.claude/rules/frontend-script-load-order.md). */

'use strict';

async function showRoundSettings(rid) {
  currentView = () => showRoundSettings(rid);
  syncUrl(roundPath(rid, 'settings'));
  app.innerHTML = '<p class="muted">…</p>';
  let round;
  try { round = await fetchRound(rid); }
  catch { return showHome(); }
  applyBackground(round.background);
  setContext(round.name);
  setDocTitle(t('rail.settings'), round.name);

  app.innerHTML = '';
  renderSubScreenTabs(round, 'settings');
  app.appendChild(backRow(() => showRound(rid)));
  app.appendChild(h(`<div class="page-head"><h1>${esc(t('rail.settings'))}</h1></div>`));

  // --- The three routed configuration screens. Real <a href> via navLink (#330);
  // they own their own screens, so this only links to them and duplicates nothing.
  app.appendChild(h(`<h2 class="rs-section__h">${esc(t('roundSettings.config'))}</h2>`));
  const nav = h('<div class="ds-list"></div>');
  [
    { icon: 'ti-tags', label: t('round.tags'), sub: 'tags', go: () => showTags(rid) },
    { icon: 'ti-palette', label: t('round.design'), sub: 'design', go: () => showBackground(rid) },
  ].forEach(({ icon, label, sub, go }) => {
    const row = h(`<a class="ds-row rs-row">
         <div class="ds-row__main"><i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span></div>
         <div class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></div>
       </a>`);
    navLink(row, roundPath(rid, sub), go);
    nav.appendChild(row);
  });
  app.appendChild(nav);

  // --- The two sheet actions. The gate asks the shared capability table (#137)
  // rather than testing `shared`, so a grantee is never offered an action the
  // route would 403 — and the two cannot drift, since the server consults the same
  // table (.claude/rules/shared-constants-across-the-stack.md). Both are still
  // owner-only in effect: no grantee role clears either capability.
  // They open sheets rather than routing, so they stay <button>s (#330).
  const actions = [];
  if (round.games.length && roundCan(round, 'games.moveOut')) {
    actions.push({ icon: 'ti-arrow-right', label: t('transferGames.link'), onClick: () => showTransferGames(round) });
  }
  if (accountsActive() && roundCan(round, 'round.shares.manage')) {
    actions.push({ icon: 'ti-users', label: t('invite.link'), onClick: () => showInvite(round) });
  }
  if (actions.length) {
    app.appendChild(h(`<h2 class="rs-section__h">${esc(t('roundSettings.manage'))}</h2>`));
    const list = h('<div class="ds-list"></div>');
    actions.forEach(({ icon, label, onClick }) => {
      const row = h(`<button class="ds-row rs-row" type="button">
           <span class="ds-row__main"><i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span></span>
           <span class="ds-row__meta"><i class="ti ti-chevron-right" aria-hidden="true"></i></span>
         </button>`);
      row.addEventListener('click', onClick);
      list.appendChild(row);
    });
    app.appendChild(list);
  }

  // --- The one irreversible action, visually separated — the Konto screen's
  // pattern (#419), which is what this screen exists to give the round too. On a
  // SHARED round the owner-only delete is replaced by "leave": a grantee gives up
  // their own access, while the owner's round and their seat's history stay.
  app.appendChild(h(`<h2 class="rs-section__h rs-section__h--danger">${esc(t('roundSettings.danger'))}</h2>`));
  const danger = h(`<div class="rs-danger">
       <p class="muted">${esc(t(round.shared ? 'roundSettings.leaveIntro' : 'roundSettings.deleteIntro'))}</p>
     </div>`);
  if (round.shared) {
    const leaveBtn = h(`<button class="btn btn--danger" type="button">${esc(t('share.leave'))}</button>`);
    leaveBtn.addEventListener('click', async () => {
      if (!confirm(t('share.leaveConfirm', { name: round.name }))) return;
      try {
        await api('DELETE', `/api/rounds/${rid}/shares/${accountUser.id}`);
        showHome();
      } catch (e) { toast(e.message); }
    });
    danger.appendChild(leaveBtn);
  } else {
    const delBtn = h(`<button class="btn btn--danger" type="button">${esc(t('round.deleteRound'))}</button>`);
    delBtn.addEventListener('click', async () => {
      if (!confirm(t('round.deleteConfirm', { name: round.name }))) return;
      try {
        await api('DELETE', '/api/rounds/' + rid);
        showHome();
      } catch (e) { toast(e.message); }
    });
    danger.appendChild(delBtn);
  }
  app.appendChild(danger);
}
