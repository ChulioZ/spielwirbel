/* Spielwirbel – the round's desktop navigation rail (#332 follow-up).

   From 1280px up, a round's navigation lives in a persistent left rail instead
   of the in-flow tab strip: identity, the one big CTA, the four sections, the
   two archives and the settings screens.

   WHY IT IS A RAIL. The strip lives inside `.app`, so the column's width and the
   strip's position are coupled: giving grid screens a wider column moved the
   strip 220px sideways on every other tab (#332, reverted). Within a screen the
   strip and content need a shared edge; across screens the strip must not move —
   which forces every screen sharing the strip onto one width. Lifting navigation
   OUT of the content flow is what dissolves that, and it is also the only place
   the round's settings and archives have ever had a home (#334).

   BOTH navs are always rendered; CSS picks one by width (`.rail` is hidden below
   1280, `.dock` at/above it). No JS width branch, so a resize needs no
   re-render — the same discipline as the dock's two presentations (#331). Only
   one is ever in the accessibility tree, because the other is `display: none`.

   The rail is prepended INTO `.app`, like the dock, so `app.innerHTML = ''` at
   the top of every view tears it down for free. A rail owned by a wrapper
   outside `.app` would need every non-round view to remember to clear it — the
   same "no begin-view hook" trap that made a per-view width flag unworkable.

   Part of the frontend; all files share one global script scope. */

'use strict';

// Round sub-screens that have their OWN rail entry. On these, that entry is
// marked current and no section is — the alternative (highlighting the section
// that owns them, as the strip must) would light up two things at once.
const RAIL_OWN_ENTRY = ['retired', 'completed', 'tags', 'providers', 'design'];

// One rail row. `sub` decides the current marker: an entry for the screen you
// are ON is "page" and click-inert, exactly like the active hub tab (#330/#331).
function railItem({ icon, label, path, onNav, current }) {
  const el = h(`<a class="rail__item${current ? ' is-active' : ''}"${current ? ' aria-current="page"' : ''}>
       <i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span>
     </a>`);
  return navLink(el, path, current ? null : onNav);
}

function railAction({ icon, label, onClick }) {
  const el = h(`<button class="rail__item">
       <i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span>
     </button>`);
  el.addEventListener('click', onClick);
  return el;
}

function buildRoundRail(round, activeTab, sub) {
  const rid = round.id;
  const activeGames = round.games.filter((g) => !g.retired && !g.completed);
  const playedCount = round.sessions.filter((s) => s.finished).length;
  // A sub-screen with its own entry claims the current marker, so the section
  // list stays unhighlighted rather than lighting up two rows at once.
  const ownEntry = sub && RAIL_OWN_ENTRY.includes(sub) ? sub : null;

  const rail = h(`<aside class="rail" aria-label="${esc(t('a11y.roundNav'))}"></aside>`);

  // --- Identity. The hero this mirrors stays on the Start tab for narrow
  // screens, where there is no rail to carry it; CSS hides it here instead.
  const id = h(`<div class="rail__id">
       <div class="rail__name">${esc(round.name)}</div>
       <div class="rail__members">${round.members
         .map((m) => `<a class="avatar" style="background:${memberColor(round, m.id)}" title="${esc(m.name)}">${esc(initials(m.name))}</a>`)
         .join('')}</div>
       <div class="rail__chips">
         <span class="stat-chip"><i class="ti ti-cards" aria-hidden="true"></i>${esc(tn(activeGames.length, 'home.chip.gamesOne', 'home.chip.games'))}</span>
         <span class="stat-chip"><i class="ti ti-confetti" aria-hidden="true"></i>${esc(tn(playedCount, 'home.chip.sessionsOne', 'home.chip.sessions'))}</span>
       </div>
     </div>`);
  id.querySelectorAll('.rail__members .avatar').forEach((el, i) => {
    const m = round.members[i];
    if (m) makeMemberLink(el, rid, m.id);
  });
  rail.appendChild(id);

  // --- The one big action, reachable from every section rather than only from
  // the Start tab (which is where it has to stay on a phone).
  const cta = h(
    `<button class="btn btn--primary rail__cta"><i class="ti ti-tornado" aria-hidden="true"></i>${esc(t('round.startSession'))}</button>`
  );
  cta.addEventListener('click', () => showStartSession(round));
  if (activeGames.length === 0) {
    cta.disabled = true;
    cta.title = t('round.startSessionDisabled');
  }
  rail.appendChild(cta);

  // --- The four sections.
  const nav = h(`<nav class="rail__group" aria-label="${esc(t('a11y.hubTabs'))}"></nav>`);
  [
    { id: 'start', icon: 'ti-home', label: t('hub.tab.start') },
    { id: 'regal', icon: 'ti-cards', label: t('hub.tab.regal') },
    { id: 'chronik', icon: 'ti-history', label: t('hub.tab.chronik') },
    { id: 'pokale', icon: 'ti-trophy', label: t('hub.tab.pokale') },
  ].forEach(({ id: tabId, icon, label }) => {
    // On a sub-screen owned by this section (game detail, member, results) the
    // section is where you ARE inside, but not the page you are on — so it is
    // marked, and stays a live link, but never "page". Same distinction the
    // strip draws (#331); here it only applies when the screen has no entry of
    // its own.
    const inside = !ownEntry && sub && tabId === activeTab;
    const el = h(`<a class="rail__item${tabId === activeTab && !ownEntry ? ' is-active' : ''}"${inside ? ' aria-current="true"' : ''}>
         <i class="ti ${icon}" aria-hidden="true"></i><span>${esc(label)}</span>
       </a>`);
    const current = tabId === activeTab && !sub;
    if (current) el.setAttribute('aria-current', 'page');
    navLink(el, roundPath(rid, tabId), current ? null : () => showRound(rid, tabId));
    nav.appendChild(el);
  });
  rail.appendChild(nav);

  // --- Archives. Counted here rather than on the Regal, where they were a
  // link at the very bottom of the grid and effectively undiscoverable (#334).
  const archive = h(`<div class="rail__group">
       <div class="rail__label">${esc(t('rail.archive'))}</div>
     </div>`);
  archive.appendChild(railItem({
    icon: 'ti-trash',
    label: t('retired.link', { n: round.games.filter((g) => g.retired).length }),
    path: roundPath(rid, 'retired'),
    onNav: () => showRetired(rid),
    current: ownEntry === 'retired',
  }));
  archive.appendChild(railItem({
    icon: 'ti-circle-check',
    label: t('completed.link', { n: round.games.filter((g) => g.completed).length }),
    path: roundPath(rid, 'completed'),
    onNav: () => showCompleted(rid),
    current: ownEntry === 'completed',
  }));
  rail.appendChild(archive);

  // --- Settings. Three routed screens that used to sit among the Start tab's
  // quick actions, plus the move action that lived in the Regal's footer.
  const settings = h(`<div class="rail__group">
       <div class="rail__label">${esc(t('rail.settings'))}</div>
     </div>`);
  settings.appendChild(railItem({
    icon: 'ti-tags', label: t('round.tags'), path: roundPath(rid, 'tags'),
    onNav: () => showTags(rid), current: ownEntry === 'tags',
  }));
  settings.appendChild(railItem({
    icon: 'ti-world-search', label: t('round.providers'), path: roundPath(rid, 'providers'),
    onNav: () => showProviders(rid), current: ownEntry === 'providers',
  }));
  settings.appendChild(railItem({
    icon: 'ti-palette', label: t('round.design'), path: roundPath(rid, 'design'),
    onNav: () => showBackground(rid), current: ownEntry === 'design',
  }));
  // Gated on the WHOLE shelf, not activeGames: archived games move too, so a
  // round holding nothing but retired games must still offer it (#253).
  if (round.games.length) {
    settings.appendChild(railAction({
      icon: 'ti-arrow-right', label: t('moveGames.link'),
      onClick: () => showMoveGames(round),
    }));
  }
  // Invite an account to share this round (#207) — accounts mode only.
  if (accountsActive()) {
    settings.appendChild(railAction({
      icon: 'ti-users', label: t('invite.link'),
      onClick: () => showInvite(round),
    }));
  }
  rail.appendChild(settings);

  return rail;
}
