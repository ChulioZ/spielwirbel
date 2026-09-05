/* Spielwirbel – views: the round hub SHELL — the tab strip (Start / Regal /
   Chronik / Pokale, as a dock on phones and an in-flow strip on desktop), the
   round fetch behind it, and the inline round-name editor.

   Each tab's own content lives in a sibling loaded right after this one:
   views-round-start.js (the Start tab and its card grid, #923),
   views-regal.js, views-chronik.js and views-pokale.js. Beyond the tabs:
   views-archive.js (retired / completed / Wunschliste),
   views-round-detail.js (game detail, design, sheet helpers),
   views-round-settings.js + views-round-actions.js (Einstellungen and the two
   sheets it opens) and views-round-lookup.js (provider lookup + add/link game).

   The header used to describe this file as "the Start tab (launchpad +
   buy-next)". There has never been a buy-next section — a stale pointer of
   exactly the kind .claude/rules/token-friendly-source-files.md warns about,
   removed with the split that made the rest of the sentence wrong too.

   Part of the frontend; all files share one global script scope. */

// =================== Round: hub (Start / Regal / Chronik) ===================

// The round screen is a hub with tabs, presented per device (#331): a floating
// dock at the bottom on phones, an in-flow strip at the top of the content
// column on desktop.
const HUB_TABS = ['start', 'regal', 'chronik', 'pokale'];

// Which hub tab owns each round SUB-screen, so those screens can show the
// section they belong to instead of being orphans of it. Keyed the way the
// router names them (resolveRoute in router.js), so a new sub-screen that
// forgets its entry here simply renders no strip rather than a wrong one.
const HUB_TAB_OF = {
  regal: ['game', 'retired', 'completed', 'wishlist', 'recommendations'],
  chronik: ['session'],
  start: ['member', 'design', 'tags', 'settings'],
};
const hubTabOwning = (sub) =>
  HUB_TABS.find((tab) => (HUB_TAB_OF[tab] || []).includes(sub)) || 'start';

async function showRound(rid, tab) {
  const activeTab = HUB_TABS.includes(tab) ? tab : 'start';
  currentView = () => showRound(rid, activeTab);
  syncUrl(roundPath(rid, activeTab));
  app.innerHTML = '<p class="muted">…</p>';
  // The round may not exist (e.g. a deep link / reload to a deleted round) —
  // fall back to Home instead of hanging on the loading state. The activity
  // feed is not part of the round payload (#197); only the Chronik renders it —
  // the timeline itself, and the period recap that reads the shelf changes out
  // of the same feed (#800, moved here from Pokale by #851) — so fetch it just
  // for that tab, in parallel with the round. A failed feed fetch degrades to
  // an empty feed (sessions still render) rather than blocking the tab.
  const NEEDS_ACTIVITIES = ['chronik'];
  let round, activities;
  try {
    [round, activities] = await Promise.all([
      fetchRound(rid),
      NEEDS_ACTIVITIES.includes(activeTab)
        ? fetchActivities(rid).catch(() => [])
        : [],
    ]);
  } catch { return showHome(); }
  applyBackground(round.background);
  setContext(round.name);
  // The four hub tabs share one view, so they share one title line and differ
  // only in the tab label — which is what makes them distinguishable in a tab
  // strip or a history list, where the round name alone would repeat four times.
  setDocTitle(t('hub.tab.' + activeTab), round.name);

  app.innerHTML = '';
  const activeGames = round.games.filter((g) => !g.retired && !g.completed && !g.wish);
  if (activeTab === 'regal') renderRegalTab(round, activeGames);
  else if (activeTab === 'chronik') renderChronikTab(round, activities);
  else if (activeTab === 'pokale') renderPokaleTab(round);
  else renderStartTab(round, activeGames);
  renderHubTabs(round, activeTab);
}

// The hub's tab bar. ONE element with two presentations, branched in CSS by
// viewport width alone (#331): below the strip breakpoint it is the floating
// bottom dock it has always been; above it, an in-flow strip at the top of the
// content column, where sibling sections of one entity belong.
//
// It is PREPENDED for that reason. On a phone the element is `position: fixed`,
// so its position in the DOM is inert there and the dock looks exactly as
// before — but on desktop it has to precede the tab content, and putting the
// navigation before the content is the better reading/tab order either way.
//
// `sub` marks a round sub-screen (game detail, tags, design, …). Those get the
// desktop strip, so they stop being orphans with no section context — but never
// the phone dock: it has never floated there, and starting now would put a
// fixed element and 120px of clearance onto eight more screens, which is the
// opposite of what this issue cleans up. `.dock--sub` is what CSS keys that on.
//
// From 1280px up BOTH of those give way to the rail (js/round-rail.js), which
// takes navigation out of the content column entirely. All three presentations
// are rendered and CSS shows exactly one, so a resize never needs a re-render.
// Takes the whole `round` because the rail carries its identity and counts, not
// just its id.
//
// `offShelf` reaches the rail alone (#794). It names the off-shelf list holding
// the game a detail screen is showing, and only the rail has rows for those
// lists — the dock carries the four hub tabs and nothing else, so below 1280px
// a wish game keeps marking Regal, which is #777's territory rather than this
// argument's.
function renderHubTabs(round, activeTab, sub, offShelf) {
  const rid = round.id;
  const tabs = [
    { id: 'start', icon: 'ti-home', label: t('hub.tab.start') },
    { id: 'regal', icon: 'ti-cards', label: t('hub.tab.regal') },
    { id: 'chronik', icon: 'ti-history', label: t('hub.tab.chronik') },
    { id: 'pokale', icon: 'ti-trophy', label: t('hub.tab.pokale') },
  ];
  const dock = h(`<nav class="dock${sub ? ' dock--sub' : ''}" aria-label="${esc(t('a11y.hubTabs'))}"></nav>`);
  tabs.forEach(({ id: tabId, icon, label }) => {
    // aria-current marks the tab you are on (#145). It was signalled by the
    // is-active class alone, i.e. by color — and since the active tab also does
    // nothing when clicked, a screen-reader user met a dead control with no
    // clue why.
    //
    // On a sub-screen it is "true", not "page": that tab is the section you are
    // inside, but it is emphatically not the page you are on, and saying "page"
    // would announce the game detail screen as if it were the Regal.
    const active = tabId === activeTab;
    const current = sub ? 'true' : 'page';
    const item = h(`<a class="dock__item${active ? ' is-active' : ''}"${active ? ` aria-current="${current}"` : ''}>
         <i class="ti ${icon}" aria-hidden="true"></i>${esc(label)}
       </a>`);
    // Every tab carries its href, so any of them can be copied or opened in a
    // new tab — but on a hub tab the active one stays click-inert (no onNav),
    // because it points at the screen you are already on and a real navigation
    // there would be a full page reload. On a sub-screen the owning tab is a
    // live link: clicking it is how you get back up to that section.
    navLink(item, roundPath(rid, tabId), active && !sub ? null : () => showRound(rid, tabId));
    dock.appendChild(item);
  });
  // Rail first, so it is the column's first child and the dock the second —
  // both inert in the presentation where CSS hides them.
  app.prepend(dock);
  app.prepend(buildRoundRail(round, activeTab, sub, offShelf));
}

// Prepend the desktop-only strip to a round sub-screen, marking the tab that
// owns it. `sub` is the router's own path segment (see HUB_TAB_OF).
//
// The segment is passed THROUGH, not reduced to a boolean. The dock only ever
// asks "is this a sub-screen at all", so `true` was enough for it — but the rail
// gives five of those screens an entry of their own and has to know which one it
// is on. Collapsing it here made Tags/Provider/Design and both archives light up
// "Start" instead of themselves, which looks like a plausible answer and is not.
//
// `offShelf` is optional and passed only by the game detail, whose `sub` is the
// same 'game' for four different screens: HUB_TAB_OF answers where the game
// detail lives in the hub (always the Regal, which is what the dock needs) and
// cannot answer where THIS game lives, which is what the rail marks.
function renderSubScreenTabs(round, sub, offShelf) {
  renderHubTabs(round, hubTabOwning(sub), sub, offShelf);
}

// The round's name as an inline-editable heading (#562). Until then it was typed
// once in showNewRound() and immutable for the round's whole life — the one
// string the round owns that could not be corrected, while member names, game
// titles, tags and the design all could.
//
// Rendered in TWO places, so the builder is shared exactly like addMemberBtn
// (#563): the Start tab's hero below 1280px, and the rail's identity block above
// it, where CSS hides the hero. An affordance on the hero alone would simply not
// exist on a desktop.
//
// A focusable <span>, not a <button>. `.gd-title` is the app's existing
// inline-title-edit component (game detail #424, member page) and already
// carries the hover tint and the focus ring, whereas a <button> here would need
// its UA chrome reset against two different heading types — the hero's 30px <h1>
// and the rail's 22px display face — which is exactly the font/line-height reset
// whose silent failures .claude/rules/native-button-vs-focusable-span.md
// documents. What a span owes in exchange is `role` + `tabindex` + an explicit
// Enter/Space handler; all three are here, and each is useless without the
// others. (Note views-member.js's copy predates #424 and has none of them — copy
// the game-detail shape, not that one.)
function editableRoundName(round) {
  // #137: the round's name identifies it on every other person's home screen, so
  // renaming is co-owner and up. Below that this is plain text — no `.gd-title`,
  // so it carries none of the component's affordance (hover tint, focus ring,
  // pointer), which is the .claude/rules/ds-row-is-a-click-target.md lesson: an
  // element must not promise an interaction it will not perform. Both call sites
  // (the hero and the desktop rail) go through here, so the gate covers both.
  if (!roundCan(round, 'round.edit')) return h(`<span>${esc(round.name)}</span>`);

  const el = h(`<span class="gd-title" role="button" tabindex="0" title="${esc(t('round.editName'))}">${esc(round.name)}</span>`);

  const startEdit = () => {
    const input = h('<input class="input rn-title-input" />');
    input.value = round.name;
    el.replaceWith(input);
    input.focus();
    input.select();
    let handled = false;
    const commit = async () => {
      if (handled) return;
      handled = true;
      const name = input.value.trim();
      // Blank is refused here so it never round-trips (the route validates the
      // same shape as the backstop), and an unchanged name is not sent at all:
      // the server would answer 200 having written nothing, but the toast would
      // still claim a rename happened.
      if (!name) {
        toast(t('round.toast.needName'));
        input.replaceWith(el);
        return;
      }
      if (name === round.name) return input.replaceWith(el);
      try {
        await api('PATCH', `/api/rounds/${round.id}`, { name });
        toast(t('round.toast.renamed'));
        // currentView() rather than a fixed showRound(): the rail carries this
        // heading on every round screen, so the edit can be started from the
        // Regal, the Chronik or a sub-screen too (#563's reasoning). It also
        // refreshes the top-bar context label, which shows the round's name.
        currentView();
      } catch (e) {
        toast(e.message);
        input.replaceWith(el);
      }
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      // Escape restores the trigger, so restore focus to it as well — otherwise a
      // keyboard user who cancels is dropped to <body> and starts again from the
      // top of the document. Removing the focused input fires no blur, and
      // `handled` keeps commit() out of it either way.
      else if (e.key === 'Escape') { handled = true; input.replaceWith(el); el.focus(); }
    });
  };

  el.addEventListener('click', startEdit);
  el.addEventListener('keydown', (e) => {
    // preventDefault on Space, or the page scrolls under the editor.
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(); }
  });
  return el;
}
