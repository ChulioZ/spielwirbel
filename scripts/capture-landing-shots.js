'use strict';

/*
 * Regenerate the landing-page product screenshots (#438, #457, #669).
 *
 *   node scripts/capture-landing-shots.js            # all three shots, every locale
 *   node scripts/capture-landing-shots.js vote       # just the vote card
 *   node scripts/capture-landing-shots.js --probe    # measure geometry, write nothing
 *
 * WHY THIS IS COMMITTED. It was not, for the first two regenerations — and
 * .claude/rules/landing-product-screenshots.md said "the full capture script
 * lives in git history alongside this rule's PRs", which was simply not true:
 * neither #438's nor #457's commit contains one. So #669's reshoot began by
 * rewriting from the recipe what two earlier sessions had already written. The
 * rule now points here instead.
 *
 * WHAT IT DOES. Starts a server against a throwaway DATA_DIR, seeds one round
 * per locale through the real API, drives headless Chrome over CDP, and writes
 * public/img/landing-<shot>.<locale>.webp. Every non-obvious constraint below is
 * explained where it bites; the rule file carries the reasoning at length.
 *
 * THE SEED CARRIES NO COVER ART, EVER. Invented titles and no images, so every
 * cover is the app's own coverPlaceholder() gradient. A committed marketing
 * image containing a provider's cover would be re-hosting someone else's
 * copyrighted artwork on the most public page we have — the precise thing
 * .claude/rules/provider-cover-hotlinking.md exists to avoid. This is why the
 * script does NOT reuse lib/demo.js's seedTenant() the way scripts/seed-dev.js
 * does: that seed hotlinks real provider covers.
 *
 * LOOK AT EVERY IMAGE AFTERWARDS. test/landing-shots.test.js checks that the
 * files are served, that their declared dimensions match the real pixels, that
 * every locale has a full set and that each set stays inside its weight budget —
 * and it cannot see whether the picture depicts anything sensible. A capture of
 * an error page, or of the wrong locale, passes all of it.
 */

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'img');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const PORT = 3199;
const CDP_PORT = 9333;
const BASE = `http://127.0.0.1:${PORT}`;

// The two viewports, and the only two that exist: a 1280px desktop shot scaled
// into a 375px phone column is illegible, and a phone shot stretched across a
// 900px hero is absurd — hence the <picture> switch at LANDING_SHOT_BP.
//
// `height` is the CROP, and it is measured, not chosen: see probeGeometry()
// below and §4 of the rule. Re-run --probe after any change to the rail, the
// game cards or the vote card, because the band moves with the *content* as
// well as with the code — a title that wraps to a second line shifts it ~25px.
const VIEWPORTS = {
  // Both shelf crops grew by exactly what the Regal grew above its grid (#752).
  // Two controls landed there after #669 — the bulk select/clear toggle (#723)
  // and the „Weitere Filter" disclosure (#725) — and each pushes every card row
  // down 41px. The wide layout shows both (+82); the phone collapses the tag
  // half into its „Filter" chip and so takes only the disclosure (+41).
  //
  // Measured at 1280: rail ends 689, row 1 ends 557, row 2 ends 794. The old 790
  // therefore landed 4px ABOVE row 2's bottom edge, slicing its titles; at 390
  // it cut through row 3's badges. Shifting each crop by its own delta restores
  // the composition #669 derived rather than re-deriving a new one: the cut
  // still clears the rail and lands inside row 3's cover art.
  shelfWide: { width: 1280, height: 872, deviceScaleFactor: 1.25, mobile: false },
  shelfPhone: { width: 390, height: 821, deviceScaleFactor: 1.6, mobile: true },
  // 720, not the 780 that shipped before #666. The vote card now SIZES ITSELF to
  // the viewport, so the crop is a fixed point rather than a free choice: the
  // cover is `max(110px, min(240px, calc(100svh - 480px)))`, which reaches its
  // 240px cap at exactly 100svh = 720. Below that the card shrinks with the crop
  // (a smaller cover buys nothing); above it the card stops growing and the crop
  // just adds dead space — at 780 that was ~100px of empty page plus the „powered
  // by BGG" footer sliding into frame. Measured card bottoms: 621@660, 651@690,
  // 671@710, 681@720, 681@780.
  vote: { width: 390, height: 720, deviceScaleFactor: 1.6, mobile: true },
};

// WebP quality. 84 lands each locale's set at ~120 KB against the 200 KB
// per-locale budget test/landing-shots.test.js enforces.
const QUALITY = 84;

/*
 * The seeds. One per locale, same SHAPE in each (12 games, 4 seats, 4 tags, 2
 * finished sessions) so every set shows the same badges and counts and a
 * difference between two locales can only be the app or the words.
 *
 * Translating the app's chrome is not translating the screenshot: an English
 * page showing a round called „Donnerstagsrunde" holding „Die Krähenbrücke" is
 * exactly the half-translated impression #457 removed. So the content is
 * localized too — round name, game titles.
 *
 * The first two games are the ones the finished sessions rate, in that order:
 * 4,5,4,5 -> Ø 4.5 and 4,4,5,4 -> Ø 4.3 (4.25 rounds up in toFixed(1)). Every
 * other game shows the "neu"/"new" badge. Cover gradients are derived from the
 * title (gameHue() in public/js/cover.js), so they follow the words and differ
 * between the two locales by construction — that is not a bug in the set.
 */
const RATINGS = [
  [4, 5, 4, 5], // -> Ø 4.5 on games[0]
  [4, 4, 5, 4], // -> Ø 4.3 on games[1]
];

// Same four seats in both locales: they are proper names, and the committed sets
// have always shown the same MA/JO/LE/TI avatars in both languages.
const MEMBERS = ['Marco', 'Jonas', 'Lea', 'Tim'];

/*
 * Provider metadata (#717/#724), cycled over the shelf. Without it TWO of the
 * affordances these screenshots exist to show simply do not render, because both
 * are gated on a game having something to say:
 *
 *   - the vote card's ⓘ (#724/#730) — `hasGameInfo` (public/js/game-info.js) is
 *     false for a game carrying none of these fields, by design, so a hand-typed
 *     game "looks exactly as it always did";
 *   - the Regal's „Weitere Filter" disclosure (#725) — `metadataFilterOptions`
 *     (public/js/draw-pool.js) derives the controls from stored values and drops
 *     the whole disclosure when the shelf can offer none.
 *
 * So a plain reshoot of the old seed can never depict either, however current
 * the code is: the app is right and the *seed* is what predates the features.
 * That is what #752 turned out to be — the issue asked only for a recapture.
 *
 * NUMBERS ONLY, and no `source`. Both are deliberate:
 *   - the numeric four satisfy `hasGameInfo` and give the disclosure its three
 *     controls, so categories/mechanics would add nothing visible (the ⓘ sheet
 *     is closed and the disclosure collapsed in every frame) while putting
 *     invented strings into BGG's own vocabulary. `rating` is skipped for a
 *     stronger reason: it must never reach a voting surface at all
 *     (.claude/rules/provider-info-is-a-field-set.md).
 *   - a game with no `source` is not eligible for the lazy backfill
 *     (`needsProviderInfo` short-circuits on it), so the Regal and setup screens
 *     — both backfill triggers since #736 — cannot turn a capture run into an
 *     upstream BGG request. The script stays offline by construction.
 */
const METADATA = [
  { weight: 1.8, minPlaytime: 30, maxPlaytime: 45, minAge: 8 },
  { weight: 2.6, minPlaytime: 45, maxPlaytime: 75, minAge: 10 },
  { weight: 3.4, minPlaytime: 60, maxPlaytime: 120, minAge: 12 },
  { weight: 2.1, minPlaytime: 20, maxPlaytime: 40, minAge: 8 },
];

const SEEDS = {
  de: {
    round: 'Donnerstagsrunde',
    tags: ['Brettspiel', 'Koop', 'Kennerspiel', 'Digital'],
    games: [
      'Sternenhafen', 'Hexenkessel', 'Die Krähenbrücke', 'Kartografen des Nordens',
      'Tal der Laternen', 'Obsidian Drift', 'Marktplatz von Verano', 'Rost & Regen',
      'Zunftmeister', 'Salz & Sand', 'Der letzte Zug', 'Nordlichtjagd',
    ],
  },
  en: {
    round: 'Thursday Crew',
    tags: ['Board game', 'Co-op', 'Strategy', 'Digital'],
    games: [
      'Starhaven', 'Emberkettle', 'The Crowbridge', 'Mapmakers of the North',
      'Valley of Lanterns', 'Obsidian Drift', 'Verano Market', 'Rust & Rain',
      'Guildmaster', 'Salt & Sand', 'The Last Train', 'Northern Lights',
    ],
  },
};

// Teardown registry. `fail()` exits the process, and `process.exit` does NOT run
// a `finally` block — so without this every failure orphans the server on :3199
// and a headless Chrome on :9333, both of which then hold their ports against the
// next run. Measured while building this script: two failed runs left one stray
// server, two stray Chromes and three temp datasets behind. Register each
// resource as it is created and tear down through one path.
const cleanups = [];
function cleanup() {
  while (cleanups.length) {
    const fn = cleanups.pop();
    try { fn(); } catch { /* best effort: one failure must not skip the rest */ }
  }
}

function fail(message) {
  console.error(`capture-landing-shots: ${message}`);
  cleanup();
  process.exit(1);
}

// Ctrl-C is the other way out of a long run, and it bypasses `finally` too.
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- the server */

// A throwaway dataset, always. Two guards rather than one because they fail
// differently: DATABASE_URL routes every write past DATA_DIR entirely (the same
// hole scripts/seed-dev.js guards), and an inherited DATA_DIR would seed
// whatever the caller last pointed at.
function tempDataDir() {
  if (process.env.DATABASE_URL) {
    fail('DATABASE_URL is set, which sends every write to the Postgres backend.\n'
      + '  This script only ever seeds a throwaway JSON dataset. Unset it and re-run.');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-shots-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function startServer(dataDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(PORT),
      // Open mode on purpose: no ACCOUNTS_ENABLED, no AUTH_PASSWORD, so the API
      // is reachable unauthenticated as the 'default' tenant and GET / renders
      // the app itself rather than the logged-out landing page we are shooting
      // the images FOR.
      ACCOUNTS_ENABLED: '',
      AUTH_PASSWORD: '',
      DEMO_ENABLED: '',
      NODE_ENV: 'development',
      LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanups.push(() => child.kill());
  child.stderr.on('data', (b) => process.stderr.write(`  [server] ${b}`));

  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return child;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  child.kill();
  return fail('the server did not come up on ' + BASE);
}

/* ----------------------------------------------------------------- the seed */

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) fail(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// One round per locale, in one dataset. Each screen is reached by round id, so
// the two never meet on screen.
async function seedRound(locale) {
  const seed = SEEDS[locale];
  const round = await api('POST', '/api/rounds', { name: seed.round, members: MEMBERS });
  const rid = round.id;
  const memberIds = round.members.map((m) => m.id);

  const tags = [];
  for (const name of seed.tags) tags.push(await api('POST', `/api/rounds/${rid}/tags`, { name }));

  // Tags are assigned so that ONE include-filter pair isolates each rated game:
  // include semantics are AND, so [t0, t1] matches games[0] and nothing else,
  // and [t2, t3] matches games[1]. Every other game carries a single tag, so no
  // third game can ever satisfy either pair. That is what makes the draw below
  // deterministic — see the comment there.
  const pairs = [[tags[0].id, tags[1].id], [tags[2].id, tags[3].id]];
  const games = [];
  for (const [i, title] of seed.games.entries()) {
    games.push(await api('POST', `/api/rounds/${rid}/games`, {
      title,
      minPlayers: 2,
      maxPlayers: i % 3 === 0 ? 6 : 4,
      tagIds: i < 2 ? pairs[i] : [tags[i % tags.length].id],
    }));
  }

  // Two finished sessions, each rating exactly one game — 4,5,4,5 -> Ø 4.5 and
  // 4,4,5,4 -> Ø 4.3, which is what the shelf's two badges show.
  //
  // These are DRAWS with a one-game pool, not direct picks. The rule file
  // prescribes direct picks (a draw is random, so which games carry a Ø badge
  // would change every run) — but a direct-pick session is created `done: true`,
  // with no voting phase at all, so POST …/votes/:pid answers `voting_closed`.
  // The only route that still writes votes onto one is POST …/results, which
  // survives solely for browsers running a pre-#209 bundle out of the service
  // worker cache and is documented for deletion. Constraining the draw's pool to
  // a single game buys the same reproducibility through the live route.
  for (const [i, ratings] of RATINGS.entries()) {
    const { session, games: drawn } = await api('POST', `/api/rounds/${rid}/sessions`, {
      memberIds, count: 1, tagIds: pairs[i], excludeTagIds: [], guests: [], teams: [],
    });
    if (drawn.length !== 1 || drawn[0].id !== games[i].id) {
      fail(`the ${locale} draw for '${games[i].title}' was not deterministic `
        + `(drew ${drawn.map((g) => g.title).join(', ') || 'nothing'}) — check the tag assignment`);
    }
    for (const [j, mid] of memberIds.entries()) {
      await api('POST', `/api/rounds/${rid}/sessions/${session.id}/votes/${mid}`, {
        // Keyed by GAME id: the person is in the URL (sanitizePersonVotes).
        votes: { [games[i].id]: { rating: ratings[j], retire: false } },
      });
    }
    await api('POST', `/api/rounds/${rid}/sessions/${session.id}/close`, {});
    await api('POST', `/api/rounds/${rid}/sessions/${session.id}/choice`, { gameId: games[i].id });
    await api('POST', `/api/rounds/${rid}/sessions/${session.id}/finish`, { winnerIds: [memberIds[0]] });
  }

  return rid;
}

// The one thing the API cannot seed. POST …/games accepts title, player counts,
// tags and a cover; the six provider fields are written only by a real BGG
// lookup (resolveProviderInfo in lib/routes/games.js) or by the lazy backfill —
// neither of which a capture script may depend on, since both need a token, a
// network and an upstream request per run.
//
// So it is written to the dataset directly, with the server STOPPED: the store
// holds data.json in memory and rewrites the whole file on every mutation, so an
// external edit under a running server is silently lost on its next save
// (.claude/rules/data-json-external-edits.md). The API still owns the shape of
// everything else — this touches four keys on rows the API created.
function writeProviderMetadata(dataDir) {
  const file = path.join(dataDir, 'data.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const round of data.rounds || []) {
    (round.games || []).forEach((game, i) => {
      Object.assign(game, METADATA[i % METADATA.length]);
      n++;
    });
  }
  if (!n) fail('no games found in the seeded dataset — the seed did not land');
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return n;
}

// Stop a server and WAIT for it to exit. Not a formality: the write above races
// the child's final save otherwise, and a lost metadata write shows up only as
// screenshots missing the very affordances they were reshot for.
function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });
}

/* ------------------------------------------------------------------ the CDP */

// ~40 lines instead of a dependency: Node has a global WebSocket, and headless
// Chrome speaks CDP over one. This is not optional convenience — `chrome
// --screenshot` FLOORS the CSS viewport at 500px regardless of --window-size, so
// a "390px" capture is really a 390-wide crop of a 500-wide layout with every
// phone breakpoint unfired. Emulation.setDeviceMetricsOverride is the only way
// to set the viewport exactly.
async function connectCdp() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const chrome = execFile(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
  ]);
  cleanups.push(() => { chrome.kill(); fs.rmSync(profile, { recursive: true, force: true }); });

  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
    if (!target) await sleep(100);
  }
  if (!target) return fail('Chrome did not expose a CDP page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || '')})`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of [...listeners]) fn(msg);
    }
  });

  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  const once = (method) => new Promise((resolve) => {
    const fn = (msg) => { if (msg.method === method) { listeners.delete(fn); resolve(msg.params); } };
    listeners.add(fn);
  });

  cleanups.push(() => ws.close());
  await send('Page.enable');
  await send('Runtime.enable');
  return { send, once };
}

// Evaluate in the page and return the value. awaitPromise so a probe can await
// the app; returnByValue so objects come back as data rather than handles.
async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) fail(`page threw: ${exceptionDetails.text} ${result && result.description || ''}`);
  return result.value;
}

async function navigate(cdp, url) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  // The app boots and renders from JS after load; nothing fires a "view ready"
  // event, so settle instead of racing it.
  await sleep(700);
}

/* --------------------------------------------------------------- the shoot */

// localStorage needs an origin, and initLocale() reads the key ONCE at load — so
// setting it on a rendered page and screenshotting gives the PREVIOUS locale,
// with no failure mode other than a German screenshot on an English page. Hence:
// land on the origin once, write the key, and only then navigate to the screen.
async function setLocale(cdp, locale) {
  await navigate(cdp, `${BASE}/`);
  await evaluate(cdp, `localStorage.setItem('locale', ${JSON.stringify(locale)})`);
}

// The one cheap proof the capture is in the language you think it is.
async function assertLocale(cdp, locale) {
  const lang = await evaluate(cdp, 'document.documentElement.lang');
  if (lang !== locale) fail(`page renders lang="${lang}" but ${locale} was requested`);
}

// Geometry probe (§4): a crop slicing through a LABEL looks broken, one slicing
// through cover ART reads as "the page continues", and those are a few pixels
// apart. Read the numbers out of the page rather than eyeballing screenshots.
async function probeGeometry(cdp) {
  return evaluate(cdp, `(() => {
    const rect = (sel) => [...document.querySelectorAll(sel)].map((e) => {
      const r = e.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    const cards = rect('.game-card');
    const rail = rect('.rail a, .rail button');
    const vote = rect('.vote');
    const nav = rect('.vote__nav');
    return {
      railBottom: rail.length ? Math.max(...rail.map((r) => r.bottom)) : null,
      cardRows: cards.map((c) => c.bottom),
      // The vote card's own box and its last row: the crop wants to clear the
      // nav buttons and stop before the page's footer, not slice either.
      voteBottom: vote.length ? vote[0].bottom : null,
      navBottom: nav.length ? nav[0].bottom : null,
      docHeight: document.documentElement.scrollHeight,
    };
  })()`);
}

async function capture(cdp, shot, locale, probeOnly) {
  await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORTS[shot]);
  const geom = await probeGeometry(cdp);
  console.log(`  ${locale}/${shot}  rail=${geom.railBottom} vote=${geom.voteBottom} nav=${geom.navBottom} `
    + `doc=${geom.docHeight} cards=${JSON.stringify(geom.cardRows.slice(0, 8))}`);
  if (probeOnly) return;

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: QUALITY });
  const file = path.join(OUT_DIR, `landing-${shot === 'shelfWide' ? 'shelf-wide' : shot === 'shelfPhone' ? 'shelf-phone' : 'vote'}.${locale}.webp`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  const { width, height, deviceScaleFactor } = VIEWPORTS[shot];
  console.log(`  wrote ${path.relative(ROOT, file)} `
    + `(${Math.round(width * deviceScaleFactor)}x${Math.ceil(height * deviceScaleFactor)}, `
    + `${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

// The vote screen has NO URL: resolveRoute() maps every transient session path
// back to the round hub on a cold load, so it can only be reached by clicking.
// Pre-select a rating — a blank scale looks unfinished.
async function reachVoteScreen(cdp, rid) {
  await navigate(cdp, `${BASE}/round/${rid}`);
  const walk = await evaluate(cdp, `(async () => {
    // Wait for each control rather than sleeping a guessed interval: the draw
    // animates, and a fixed wait that is long enough today silently becomes a
    // "the button wasn't there" failure after any timing change.
    const until = async (sel, ms = 8000) => {
      for (let t = 0; t < ms; t += 50) {
        const el = document.querySelector(sel);
        if (el) return el;
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    };
    const step = async (sel) => { const el = await until(sel); if (el) el.click(); return !!el; };
    const seen = [];
    seen.push(['cta', await step('.hub-cta, .rail__cta')]);

    // Reset what the Start screen restored from the last draw (#252). The two
    // seeded sessions each ran with count 1 and a two-tag include filter, so
    // without this the shot's session draws that ONE already-rated game and the
    // card's primary action reads "Fertig"/"Done" — the end of a wizard rather
    // than the middle of one, which is not what the hero is illustrating.
    await until('#count');
    for (const chip of document.querySelectorAll('#filterChips .chip')) {
      // Ignored = neither class. Click round the cycle rather than assuming its
      // order (core.js cycleTagState).
      for (let i = 0; i < 3 && (chip.classList.contains('is-on') || chip.classList.contains('is-excluded')); i++) chip.click();
    }
    const count = document.querySelector('#count');
    count.value = '4';                       // #go reads .value at click time
    count.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));

    seen.push(['go', await step('#go')]);
    // The draw lands on the live-vote LOBBY (#209/#612), not on the vote card:
    // per-device voting means someone must first claim a seat. Take the third —
    // a fixed seat rather than a shuffled one, so both locales show the same
    // person and a difference between the two sets can only be the app or the
    // words. The rule file's older recipe went straight from #go to #goBtn.
    seen.push(['hotseat', await (async () => {
      await until('.live-vote__hotseat-btn');
      const seats = document.querySelectorAll('.live-vote__hotseat-btn');
      if (!seats[2]) return false;
      seats[2].click();
      return true;
    })()]);
    seen.push(['handover', await step('#goBtn')]);
    const rating = await until('.rating .mood');
    const moods = document.querySelectorAll('.rating .mood');
    /* Pre-select 4 of 5 — a blank scale looks unfinished. Index 4, not 3: since
       #797 the row opens with the trash tile that carries the retirement
       proposal (the 0 of the scale), so the faces are offset by one. */
    if (moods[4]) moods[4].click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      seen,
      moods: moods.length,
      // What is actually on screen, so a failure says which screen we are stuck on.
      onScreen: [...document.querySelectorAll('button, a.btn')].slice(0, 12)
        .map((b) => (b.id ? '#' + b.id : b.className) + ':' + (b.textContent || '').trim().slice(0, 24)),
      rating: !!rating,
    };
  })()`);
  // Six tiles for a member since #797: the zero, then the five faces. This
  // count is a real guard — it is what caught the change rather than shipping a
  // marketing screenshot of a scale the app no longer has.
  if (!walk || walk.moods !== 6) fail(`could not reach the vote screen: ${JSON.stringify(walk, null, 1)}`);
}

/* ------------------------------------------------------------------- main */

async function main() {
  const args = process.argv.slice(2);
  const probeOnly = args.includes('--probe');
  const only = args.filter((a) => !a.startsWith('--'));
  const shots = only.length ? only : ['shelfWide', 'shelfPhone', 'vote'];
  for (const s of shots) if (!VIEWPORTS[s]) fail(`unknown shot '${s}' (have: ${Object.keys(VIEWPORTS).join(', ')})`);

  const dataDir = tempDataDir();
  console.log(`capture-landing-shots: dataset ${dataDir}`);
  const server = await startServer(dataDir);
  try {
    const rounds = {};
    // Every locale in ONE run, always. Sets that drift apart one PR at a time
    // can no longer be told apart from seed differences (§3b).
    for (const locale of Object.keys(SEEDS)) {
      rounds[locale] = await seedRound(locale);
      console.log(`  seeded ${locale}: round ${rounds[locale]}`);
    }

    // Down, patch, up: see writeProviderMetadata. The old server's cleanup entry
    // stays registered and becomes a no-op — killing an exited child is
    // harmless, and dropping the entry would be the riskier edit of the two.
    await stopServer(server);
    console.log(`  wrote provider metadata onto ${writeProviderMetadata(dataDir)} games`);
    await startServer(dataDir);

    const cdp = await connectCdp();
    for (const locale of Object.keys(SEEDS)) {
      await setLocale(cdp, locale);
      const rid = rounds[locale];

      for (const shot of shots) {
        if (shot === 'vote') {
          // Set the viewport BEFORE walking the wizard: the vote card lays out
          // against the phone breakpoints, and clicking through at 1280 then
          // shrinking leaves a card measured for the wrong width.
          await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORTS.vote);
          await reachVoteScreen(cdp, rid);
        } else {
          await navigate(cdp, `${BASE}/round/${rid}/regal`);
        }
        await assertLocale(cdp, locale);
        await capture(cdp, shot, locale, probeOnly);
      }
    }
  } finally {
    cleanup();
  }
  console.log('capture-landing-shots: done — now LOOK at every image before committing.');
}

main().catch((err) => fail(err.stack || err.message));
