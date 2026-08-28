'use strict';

// Flat ESLint config. No build step in this project, so this only lints.
// Two worlds: the Node.js backend (CommonJS) and the frontend classic
// `<script>`s under public/js, which share ONE global scope in a fixed load
// order (see public/index.html and .claude/rules/frontend-script-load-order.md).

const js = require('@eslint/js');
const globals = require('globals');

// Names the frontend scripts define at top level and reference across files.
// Declaring them here lets `no-undef` catch typos and load-order mistakes
// (referencing something not yet defined) without flagging the legitimate
// cross-file calls. 'writable' = reassigned somewhere; 'readonly' = not.
const frontendGlobals = {
  // locales.js
  LOCALES: 'readonly', SUPPORTED_LOCALES: 'readonly', LOCALE_LABELS: 'readonly',
  LOCALE_TAGS: 'readonly', localeTag: 'readonly',
  // i18n.js
  I18N: 'writable',
  locale: 'writable', detectLocale: 'readonly', initLocale: 'readonly',
  applyTabTitle: 'readonly',
  getLocale: 'readonly', setLocale: 'readonly', t: 'readonly', tn: 'readonly',
  pluralRules: 'readonly', pluralCategory: 'readonly',
  fmtDateTime: 'readonly', fmtDate: 'readonly', fmtMonth: 'readonly', fmtMoney: 'readonly',
  // core.js
  app: 'readonly', context: 'readonly', toastEl: 'readonly',
  currentView: 'writable', h: 'readonly', esc: 'readonly', toastTimer: 'writable',
  toast: 'readonly', api: 'readonly', setContext: 'readonly', setDocTitle: 'readonly',
  backRow: 'readonly', joinNames: 'readonly',
  // doc-title.js
  docTitle: 'readonly', DOC_TITLE_SEP: 'readonly', DOC_TITLE_BRAND_SEP: 'readonly',
  // popover-fit.js (issue #739)
  popoverFit: 'readonly', popoverRoom: 'readonly', POPOVER_GAP: 'readonly',
  // report-link.js
  feedReportUrl: 'readonly', setContactAvailable: 'readonly',
  REPORT_SUBJECT_MAX: 'readonly', REPORT_USERNAME_MAX: 'readonly',
  // install-prompt.js (issue #616)
  INSTALL_DISMISSED_KEY: 'readonly', isIosDevice: 'readonly', installStateFrom: 'readonly',
  installEnv: 'readonly', installState: 'readonly', runInstallPrompt: 'readonly',
  installOfferDismissed: 'readonly', dismissInstallOffer: 'readonly', hideOnInstalled: 'readonly',
  fetchRound: 'readonly', invalidateRoundCache: 'readonly',
  fetchActivities: 'readonly', fetchRoundList: 'readonly', fetchRoundFresh: 'readonly',
  swrStore: 'readonly', swrRenderToken: 'writable', uiBusy: 'readonly',
  // swr.js
  createSwrStore: 'readonly',
  // focus-trap.js
  trapFocus: 'readonly', focusables: 'readonly', FOCUSABLE: 'readonly',
  // page-lock.js
  lockPage: 'readonly', unlockPage: 'readonly',
  guardDragDismiss: 'readonly', DRAG_SLOP: 'readonly',
  // session-path.js
  sessionSetupPath: 'readonly', sessionStepPath: 'readonly',
  sessionFinalePath: 'readonly', parseSessionPath: 'readonly',
  // nav-link.js (issue #330)
  isPlainClick: 'readonly', navLink: 'readonly',
  applyStaticTexts: 'readonly', setupLangPicker: 'readonly', initFooter: 'readonly',
  gamesSort: 'writable',
  regalFilters: 'writable', regalFiltersRid: 'writable',
  chronikFilter: 'writable', chronikFilterRid: 'writable', CHRONIK_FILTERS: 'readonly',
  TAG_STATES: 'readonly', cycleTagState: 'readonly',
  paintTagChip: 'readonly', matchesTagFilter: 'readonly',
  renderTagBulkToggle: 'readonly',
  renderTagModeToggle: 'readonly', includedTagCount: 'readonly',
  tagIconPicker: 'readonly',
  randomOrderCache: 'readonly', randomOrderedGames: 'readonly',
  gameStatsForSession: 'readonly', gameStats: 'readonly',
  retireRecommendations: 'readonly', minimizedRecs: 'readonly',
  STANDARD_ACCENT: 'readonly',
  applyBackground: 'readonly', setThemeColor: 'readonly', avgColor: 'readonly',
  MEMBER_COLORS: 'readonly', memberColor: 'readonly', initials: 'readonly',
  personColor: 'readonly',
  renderSeatPicker: 'readonly', renderGuestPicker: 'readonly', renderTeamPicker: 'readonly',
  hasGameInfo: 'readonly', gameInfoButton: 'readonly', openGameInfoSheet: 'readonly', renderGameInfoSection: 'readonly',
  wantsGameInfo: 'readonly', mergeGameInfo: 'readonly',
  foldGameInfoList: 'readonly', refreshShelfGameInfo: 'readonly',
  // username-policy.js
  USERNAME_MIN: 'readonly', USERNAME_MAX: 'readonly', USERNAME_RE: 'readonly',
  isValidUsername: 'readonly',
  RESERVED_USERNAMES: 'readonly', RESERVED_FRAGMENTS: 'readonly',
  normalizeUsername: 'readonly', isReservedUsername: 'readonly',
  // passkey.js (issue #418)
  b64urlToBytes: 'readonly', bytesToB64url: 'readonly',
  toCreateOptions: 'readonly', toRequestOptions: 'readonly',
  registrationToJson: 'readonly', assertionToJson: 'readonly',
  passkeysSupported: 'readonly', isPasskeyCancel: 'readonly',
  createPasskey: 'readonly', getPasskey: 'readonly',
  // ...and the view-side halves (account.js, views-account.js). Used only
  // within their own files today, so lint would not flag their absence — they
  // are listed because every sibling helper in those files is, and the list is
  // what turns a future cross-file typo into an error rather than a silent
  // runtime failure (.claude/rules/eslint-frontend-shared-scope.md).
  wirePasskeyLogin: 'readonly', buildPasskeySection: 'readonly', renderPasskeyRow: 'readonly',
  // round-roles.js (issue #137) — also required by lib/round-access.js and the
  // rounds/members/invitations routes
  ROUND_ROLES: 'readonly', ROLE_RANK: 'readonly', LEGACY_GRANT_ROLE: 'readonly',
  CAPABILITY_ROLE: 'readonly', DEFAULT_CAPABILITY_ROLE: 'readonly',
  normalizeRole: 'readonly', capabilityRole: 'readonly', can: 'readonly',
  roundCan: 'readonly',
  // draw-pool.js (issues #634, #653) — also required by lib/draw.js
  isActiveGame: 'readonly', fitsPlayerCount: 'readonly', requiredExpansions: 'readonly',
  EXPANSION_TITLE_MAX: 'readonly',
  expansionBaseCandidates: 'readonly', expansionAcquirePlan: 'readonly', acquirableBases: 'readonly',
  expansionParentTitles: 'readonly',
  // draw-pool.js's metadata filters (issue #725) — also required by lib/draw.js
  // and lib/routes/sessions.js
  fitsMetadataFilters: 'readonly', metadataFilterOptions: 'readonly',
  hasMetadataFilterOptions: 'readonly', normalizeMetadataFilters: 'readonly',
  countMetadataFilters: 'readonly',
  PLAYTIME_CHOICES: 'readonly', AGE_CHOICES: 'readonly', WEIGHT_CHOICES: 'readonly',
  // metadata-filter.js (issue #725)
  renderMetadataFilter: 'readonly',
  // vote-scale.js (issue #797) — also required by lib/session-votes.js,
  // lib/recommend.js and both repo backends
  RATING_MIN: 'readonly', RATING_MAX: 'readonly',
  wantsRetire: 'readonly', effectiveRating: 'readonly',
  // session-people.js (issue #458)
  MAX_SESSION_GUESTS: 'readonly', GUEST_NAME_MAX: 'readonly', MIN_TEAM_SIZE: 'readonly',
  sessionPeople: 'readonly', personLabel: 'readonly',
  sessionPartyGroups: 'readonly',
  // Pre-existing omissions from the same file, folded in while adding the line
  // above: both are top-level names in the shared scope and neither was listed.
  resolveTeamMembers: 'readonly', sessionPartyCount: 'readonly',
  // bulk-tidy.js (issue #832)
  selectionTouchesHistory: 'readonly',
  setupArchiveSelection: 'readonly',
  // session-outcome.js (issue #796) — also required by lib/routes/sessions.js
  sessionChildIds: 'readonly', sessionOutcome: 'readonly', isSplitParent: 'readonly',
  // table-split.js (issue #796) — also required by lib/draw.js and lib/session-split.js
  MIN_TABLE_PARTIES: 'readonly', VIOLATION_MAX: 'readonly', NEUTRAL_RATING: 'readonly',
  MAX_TABLE_PROPOSALS: 'readonly', seatRating: 'readonly', tableFeedback: 'readonly',
  admittedTableSizes: 'readonly', fitsSomeTable: 'readonly',
  feasibleTableCounts: 'readonly', scoreSplit: 'readonly', compareSplits: 'readonly',
  proposeTableSplits: 'readonly',
  // …and its search internals. Nothing outside that file uses them, but they are
  // top-level names in the one shared global scope all the same, so they are
  // listed for the reason the rule gives: an unlisted name makes a cross-file typo
  // silent rather than a `no-undef`. They carry a `split`/`table` prefix for the
  // same reason `isFiniteNum` is not called `isNumber` — `no-redeclare` is off
  // here, so a second file declaring `improve` or `seedFrom` would take over for
  // everyone with load order deciding (.claude/rules/eslint-frontend-shared-scope.md).
  splitSeedFrom: 'readonly', mulberry32: 'readonly', shuffleSeeded: 'readonly',
  chooseTableSizes: 'readonly', seedTableAssignment: 'readonly',
  trySplitMove: 'readonly', trySplitSwap: 'readonly', trySplitGameSwap: 'readonly',
  improveSplit: 'readonly', bestSplitForCount: 'readonly', restartBudget: 'readonly',
  // session-log.js
  SESSION_EVENTS: 'readonly', SESSION_LOG_MAX: 'readonly', sessionLogLines: 'readonly',
  partyName: 'readonly', teamsForPeople: 'readonly',
  // news.js (issue #741)
  NEWS: 'readonly', newsRevision: 'readonly', newsText: 'readonly',
  sessionTeams: 'readonly', sessionParties: 'readonly',
  TEAM_TOKEN_MEMBER: 'readonly', TEAM_TOKEN_GUEST: 'readonly',
  themeAccent: 'readonly', resolveAccent: 'readonly',
  activePopover: 'writable', closePopover: 'readonly', openPopover: 'readonly',
  repositionPopover: 'readonly',
  readClipboardImage: 'readonly', shuffled: 'readonly', iconText: 'readonly',
  createCoverLoader: 'readonly',
  makeGameLink: 'readonly', makeMemberLink: 'readonly',
  GAME_ICON: 'readonly', playersText: 'readonly',
  // account.js (issue #138): onboarding + token wiring, shared with core.js api()
  accountsMode: 'writable', accountUser: 'writable',
  SA_ACCESS: 'readonly', SA_REFRESH: 'readonly', saStore: 'readonly',
  SA_DEMO: 'readonly', demoMarkerFollowsRotation: 'readonly',
  HANDLER_401: 'readonly',
  // memoized /api/config, gating the two links to the legal pages (issue #520)
  accountCfg: 'writable', withAppConfig: 'readonly',
  getAccessToken: 'readonly', getRefreshToken: 'readonly',
  setTokens: 'readonly', clearTokens: 'readonly',
  getDemoToken: 'readonly', setDemoToken: 'readonly', clearDemoToken: 'readonly',
  accountsActive: 'readonly', isLoggedIn: 'readonly', authFetch: 'readonly',
  currentUserId: 'readonly', currentUsername: 'readonly',
  isDemoAccount: 'readonly', bgStatsEnabled: 'readonly', setCachedPref: 'readonly',
  startDemo: 'readonly', setupDemoBanner: 'readonly',
  setupTermsBanner: 'readonly',
  enterDemo: 'readonly', resumeDemo: 'readonly', endDemo: 'readonly',
  authErrorKey: 'readonly',
  probeMe: 'readonly', refreshAccessToken: 'readonly', onSessionLost: 'readonly',
  logout: 'readonly', linkToken: 'readonly', bootApp: 'readonly',
  initAccounts: 'readonly', enterApp: 'readonly', authScreen: 'readonly',
  openAuth: 'readonly', setAuthDocTitle: 'readonly', authError: 'readonly', setError: 'readonly',
  // routed auth screens (issue #501)
  isAuthRoute: 'readonly', isVoteLinkRoute: 'readonly', isPublicStatsRoute: 'readonly',
  pendingPath: 'writable', authScreensAvailable: 'readonly',
  showLogin: 'readonly', showRegister: 'readonly', showForgot: 'readonly',
  showAuthDone: 'readonly', buildResend: 'readonly', renderVerifyLanding: 'readonly',
  renderResetLanding: 'readonly', setupAccountUi: 'readonly',
  accountApi: 'readonly', setupInboxUi: 'readonly', setInboxDot: 'readonly',
  refreshInboxBadge: 'readonly',
  // account.js — the „Was ist neu" dot (issue #741)
  hasUnseenNews: 'readonly', setNewsDot: 'readonly', markNewsSeen: 'readonly',
  // views-news.js (issue #741)
  showNews: 'readonly', renderNewsEntry: 'readonly',
  // views-stats.js (issue #564)
  showEntdecken: 'readonly', renderPublicStats: 'readonly', loadPublicStats: 'readonly',
  publicStatsHasContent: 'readonly', mountLandingStats: 'readonly',
  mountHomeStatsTeaser: 'readonly', statsCard: 'readonly',
  renderEntdeckenCta: 'readonly',
  formatCount: 'readonly', formatAverage: 'readonly',
  STATS_PODIUMS: 'readonly', STATS_COUNTERS: 'readonly',
  // views-inbox.js (issue #207)
  showInbox: 'readonly', renderInboxItem: 'readonly',
  renderInvitationItem: 'readonly', renderGenericItem: 'readonly',
  unreadDot: 'readonly', afterRemove: 'readonly',
  // views-friends.js (issue #325)
  showFriends: 'readonly', renderHomeFriends: 'readonly',
  renderFriendRequestItem: 'readonly', renderFeedEvent: 'readonly',
  renderIncomingRequest: 'readonly', renderOutgoingRequest: 'readonly',
  renderFriendRow: 'readonly', friendAvatar: 'readonly', friendName: 'readonly',
  feedText: 'readonly', friendSendError: 'readonly',
  // views-friends.js — account profile (issue #558)
  showProfile: 'readonly', renderProfileCta: 'readonly',
  friendRowMain: 'readonly', wireFriendRowMain: 'readonly',
  // views-account.js (issue #482)
  showAccount: 'readonly', renderKontoFact: 'readonly',
  buildPasswordForm: 'readonly', setKontoError: 'readonly',
  // self-service account deletion (issue #419)
  buildDeleteSection: 'readonly', openDeleteSheet: 'readonly',
  // inbox-mail opt-outs (issue #618) + the BG Stats opt-in (issue #485), which
  // share one account-preference toggle row
  buildNotifyForm: 'readonly', buildPrefToggle: 'readonly', buildBgStatsForm: 'readonly',
  // support.js (issue #173)
  showSupport: 'readonly', initSupport: 'readonly', setupSupportUi: 'readonly',
  // views-landing.js (issue #322): logged-out landing page
  showLanding: 'readonly', LANDING_FEATURES: 'readonly', LANDING_STEPS: 'readonly',
  LANDING_SHOTS: 'readonly', landingShots: 'readonly',
  LANDING_SHOT_BP: 'readonly', LANDING_REPO_URL: 'readonly',
  landingCfg: 'writable', landingRevealOperatorClaims: 'readonly',
  // ranking.js + lookup-cover.js + lookup-title.js + lookup-score.js +
  // cover.js + tag-icons.js (also CommonJS modules for tests — hence `module`)
  computePlaces: 'readonly', module: 'readonly',
  // podium.js (issue #836): the shared rank-per-column podium
  PODIUM_MAX_PER_RANK: 'readonly', podiumColumns: 'readonly', podiumColHtml: 'readonly',
  // recap.js (issue #484). The internal helpers are listed too, like every
  // other helper module's: they share the one global scope whether or not
  // another file calls them, and no-redeclare is off — so an unlisted name is
  // a future silent collision rather than a private one.
  RECAP_MIN_RATINGS: 'readonly', roundRecap: 'readonly', recapMean: 'readonly',
  collectRatings: 'readonly', bestAndWorst: 'readonly', mostDivisive: 'readonly',
  memberFavourites: 'readonly', retiredIds: 'readonly', isNameableGame: 'readonly',
  // session-share.js (issue #526) — internal helpers listed for the same reason.
  sessionShareText: 'readonly', shareRatingLines: 'readonly', shareHeadline: 'readonly',
  SHARE_MEDALS: 'readonly', SHARE_TROPHY: 'readonly',
  // bgstats.js (issue #485) — internal helpers listed for the same reason.
  BGSTATS_SOURCE: 'readonly', BGSTATS_CREATE_PLAY: 'readonly', BGSTATS_URL_MAX: 'readonly',
  bgStatsPlayDate: 'readonly', bgStatsGuestId: 'readonly', bgStatsTeamLabel: 'readonly',
  bgStatsBggId: 'readonly', bgStatsPlay: 'readonly', bgStatsPlayUrl: 'readonly',
  scoreHit: 'readonly', foldTitle: 'readonly', existingTitleState: 'readonly',
  gameHue: 'readonly', coverPlaceholder: 'readonly',
  coverUrl: 'readonly', COVER_THUMB: 'readonly', COVER_CARD: 'readonly',
  COVER_HERO: 'readonly', COVER_RESIZERS: 'readonly',
  providerMatchCover: 'readonly', pickedTitle: 'readonly',
  // lookup-nav.js (issue #542)
  nextLookupIndex: 'readonly', lookupOptionIndex: 'readonly',
  // bgg-covers.js + cover-picker.js (issue #519)
  BGG_LANGUAGES: 'readonly', bggCoverLanguage: 'readonly', coverRank: 'readonly',
  sortEditionCovers: 'readonly', coverCaption: 'readonly',
  editionFromCover: 'readonly', editionLabel: 'readonly', editionFields: 'readonly',
  editionCoverPicker: 'readonly',
  TAG_ICONS: 'readonly', tagIconClass: 'readonly',
  // views-home.js
  showHome: 'readonly', showNewRound: 'readonly',
  // views-round.js (hub + Start tab) and its siblings loaded right after it:
  // views-regal.js, views-chronik.js, views-pokale.js, views-archive.js,
  // views-round-detail.js, views-round-settings.js, views-round-actions.js,
  // views-round-lookup.js. They
  // share one global scope, so all their top-level names are listed together.
  showRoundSettings: 'readonly',
  showRound: 'readonly', showRetired: 'readonly', showCompleted: 'readonly',
  showWishlist: 'readonly', showRecommendations: 'readonly',
  recReasonText: 'readonly', recNum: 'readonly', recFacts: 'readonly', recEmptyKey: 'readonly',
  showArchive: 'readonly', ARCHIVES: 'readonly', THEMES: 'readonly',
  showBackground: 'readonly', showGameDetail: 'readonly', showAddGame: 'readonly',
  OFF_SHELF_LISTS: 'readonly', offShelfListOf: 'readonly',
  showTags: 'readonly', showMoveGames: 'readonly',
  showInvite: 'readonly', inviteError: 'readonly', insertFriendPicker: 'readonly',
  showBggImport: 'readonly', canImportBgg: 'readonly', bggImportError: 'readonly',
  buildBggForm: 'readonly',
  HUB_TABS: 'readonly', HUB_TAB_OF: 'readonly', hubTabOwning: 'readonly',
  // round-rail.js
  RAIL_OWN_ENTRY: 'readonly', RAIL_SETTINGS_SUB: 'readonly', railItem: 'readonly',
  buildRoundRail: 'readonly',
  renderHubTabs: 'readonly', renderSubScreenTabs: 'readonly', renderStartTab: 'readonly',
  editableRoundName: 'readonly',
  renderRegalTab: 'readonly', renderChronikTab: 'readonly', renderPokaleTab: 'readonly',
  CHRONIK_MILESTONES: 'readonly', chronikTier: 'readonly',
  pokaleStatCard: 'readonly', pokaleGameCard: 'readonly', recapGames: 'readonly',
  renderRecapSection: 'readonly',
  activeSheet: 'writable', closeSheet: 'readonly', openSheet: 'readonly',
  handleSheetPop: 'readonly',
  openEditor: 'readonly', usesEditorSheet: 'readonly', EDITOR_SHEET_BELOW: 'readonly',
  renderPriceSection: 'readonly', renderPriceNoOffers: 'readonly', priceAge: 'readonly',
  startDirectSession: 'readonly',
  showLinkProvider: 'readonly', attachLookup: 'readonly', searchProvider: 'readonly',
  lookupDetail: 'readonly',
  providerLabel: 'readonly', providerLabelShort: 'readonly',
  PROVIDER_LABELS: 'readonly', PROVIDER_LABELS_SHORT: 'readonly', LOOKUP_PROVIDERS: 'readonly', MAX_SUGGESTIONS: 'readonly',
  // views-member.js
  showMember: 'readonly', memberStats: 'readonly',
  openAddMember: 'readonly', addMemberBtn: 'readonly',
  // views-session.js
  showStartSession: 'readonly', startVoting: 'readonly', showResults: 'readonly',
  showFinale: 'readonly', canShareResult: 'readonly', shareResult: 'readonly',
  // views-session-tables.js (issue #796)
  showTableBuilder: 'readonly', tableStateFrom: 'readonly', tablePeopleIds: 'readonly',
  tableCoverBg: 'readonly',
  // views-session-live.js
  showSessionLobby: 'readonly', stopLobbyPoll: 'readonly', mySeatIn: 'readonly',
  sessionGames: 'readonly', LOBBY_POLL_MS: 'readonly', lobbyPoll: 'writable',
  renderSessionLog: 'readonly',
  // views-vote-link.js
  showVoteLink: 'readonly', renderVoteLinkClaim: 'readonly',
  renderVoteLinkCards: 'readonly', renderVoteLinkDone: 'readonly',
  renderVoteLinkDead: 'readonly', voteLinkClaim: 'readonly',
  setVoteLinkClaim: 'readonly', voteLinkColor: 'readonly',
  VOTE_LINK_CLAIM_KEY: 'readonly',
  // router.js
  routing: 'writable', navIndex: 'writable', roundPath: 'readonly',
  gamePath: 'readonly', memberPath: 'readonly', resultsPath: 'readonly',
  profilePath: 'readonly', votePath: 'readonly',
  syncUrl: 'readonly', navBack: 'readonly', resolveRoute: 'readonly',
  routeTo: 'readonly', showResultsById: 'readonly',
  activeFlow: 'writable', activeGuard: 'writable',
  beginFlow: 'readonly', endFlow: 'readonly', confirmLeave: 'readonly',
};

module.exports = [
  { ignores: ['node_modules/**', 'data/**', 'dist/**'] },
  js.configs.recommended,
  {
    // Empty `catch {}` is a deliberate "swallow and keep the default" idiom here.
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    // Node.js backend + tests (CommonJS).
    files: ['**/*.js'],
    ignores: ['public/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // Frontend classic scripts: shared global scope, browser environment.
    // These files hand-roll a "module system" over one global scope, so three
    // recommended rules fight the pattern and are relaxed here:
    //  - no-redeclare: each shared name is BOTH declared in its home file and
    //    listed in `frontendGlobals` so consumers don't trip no-undef.
    //  - no-unused-vars is scoped to `vars: 'local'` so top-level functions
    //    used only from *other* files aren't flagged (ESLint lints per file and
    //    can't see cross-file use); unused *locals* inside functions still are.
    // Everything else recommended (no-dupe-keys on the lang tables, no-undef for
    // real typos, no-unreachable, valid-typeof, …) stays on.
    files: ['public/js/**/*.js'],
    ignores: ['public/js/pages/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...frontendGlobals },
    },
    rules: {
      'no-redeclare': 'off',
      'no-unused-vars': ['error', { vars: 'local', args: 'after-used', caughtErrors: 'all' }],
    },
  },
  {
    // Standalone-page scripts (public/js/pages/**): each is a self-contained IIFE
    // loaded by its OWN html document only, so it shares nothing with the SPA's
    // global scope — no `frontendGlobals`, and the two rules relaxed above stay
    // ON. That is what makes the directory boundary real rather than a
    // convention: a page script reaching for an SPA global (`t`, `api`,
    // `showHome`) is a `no-undef` error here, and a genuinely unused top-level
    // name inside one of these IIFEs is reported instead of being excused as
    // "used from another file" — it cannot be, because nothing else loads it.
    files: ['public/js/pages/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    // The service worker (public/sw.js) runs in the ServiceWorkerGlobalScope,
    // not a window: its own globals (self, caches, clients, skipWaiting, …).
    // It's outside public/js/**, so it needs its own block rather than the
    // frontend one above.
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },
];
