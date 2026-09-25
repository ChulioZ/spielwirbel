'use strict';

/*
 * Regenerate the landing-page product screenshots (#438, #457, #669).
 *
 *   node scripts/capture-landing-shots.js            # all four shots, every locale
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

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { RATINGS, RESULT_RATINGS, MEMBERS, METADATA, SEEDS } = require('./landing-seed-data');

const { designById } = require('../public/js/designs');

const ROOT = path.join(__dirname, '..');
const { connectCdp } = require('./cdp');
const desktopShot = require('./landing-desktop-shot');

/* WHICH DESIGN the app wears in the pictures (#1199): `--design=tisch` shoots
   Der Tisch's set into public/img/tisch/, the default shoots Klassisch's into
   public/img/ exactly as before. One set per design because the landing shows
   the WORN design's app (views-landing.js landingShots): Der Tisch's for every
   logged-out visitor since the flip (#1202) made it the face, Klassisch's for
   an account on Klassisch that opens the landing.

   The capture runs in open mode (no accounts), where the design is the
   DEVICE's choice (design.js storedDesign), so wearing one is a localStorage
   key written next to the locale in setLocale — no account, no login. */
const DESIGN = (process.argv.find((a) => a.startsWith('--design=')) || '--design=klassisch').slice('--design='.length);
const OUT_DIR = DESIGN === 'klassisch'
  ? path.join(ROOT, 'public', 'img')
  : path.join(ROOT, 'public', 'img', DESIGN);

// Overridable so a second run (another worktree, another agent) does not fight
// this one for the ports.
const PORT = Number(process.env.LANDING_SHOTS_PORT) || 3199;
const CDP_PORT = Number(process.env.LANDING_SHOTS_CDP_PORT) || 9333;
const BASE = `http://127.0.0.1:${PORT}`;

// The three viewports, all PHONE-shaped since #1090. The set used to carry a
// 1280-wide desktop shelf capture for the hero's <picture>; the rebuilt hero is
// two columns from 1024px and gives its image 660-800px, where that capture's
// tile labels shrink to ~9px — so the hero shows the phone shelf shot at every
// width and the wide capture is retired.
//
// `height` is the CROP, and it is measured, not chosen: see probeGeometry()
// below and §4 of the rule. Re-run --probe after any change to the rail, the
// game cards, the vote card or the results screen, because the band moves with
// the *content* as well as with the code — a title that wraps to a second line
// shifts it ~25px.
const VIEWPORTS = {
  // 779 is the #827 number: the Regal's whole tag half folded into one 40px
  // „Filter" button, so the phone crop moved by that delta (821 → 779) and the
  // cut still lands 68px into row 3's cover art. Unchanged by #1090 — that issue
  // touched no round screen.
  shelfPhone: { width: 390, height: 779, deviceScaleFactor: 1.6, mobile: true },
  // 720, not the 780 that shipped before #666. The vote card now SIZES ITSELF to
  // the viewport, so the crop is a fixed point rather than a free choice: the
  // cover is `max(110px, min(240px, calc(100svh - 480px)))`, which reaches its
  // 240px cap at exactly 100svh = 720. Below that the card shrinks with the crop
  // (a smaller cover buys nothing); above it the card stops growing and the crop
  // just adds dead space — at 780 that was ~100px of empty page plus the „powered
  // by BGG" footer sliding into frame. Measured card bottoms: 621@660, 651@690,
  // 671@710, 681@720, 681@780.
  vote: { width: 390, height: 720, deviceScaleFactor: 1.6, mobile: true },
  // The results screen (#1090), same phone width as the other two. Its height is
  // a FLOOR, not the crop: resultCrop() below measures the real cut per locale.
  result: { width: 390, height: 720, deviceScaleFactor: 1.6, mobile: true },
  // The band under the hero (#1199): the one desktop capture, 1440 wide. Its
  // height is a floor too — scripts/landing-desktop-shot.js derives the cut.
  desktop: desktopShot.VIEWPORT,
};

// Shot name -> committed file stem. A map rather than the nested ternary this
// replaced: that form silently wrote every unknown shot to `landing-vote`, which
// is exactly the mistake adding a fourth shot would make.
const FILE_STEM = { shelfPhone: 'shelf-phone', vote: 'vote', result: 'result', desktop: 'desktop' };

// WebP quality. 84 lands each locale's set at ~120 KB against the 200 KB
// per-locale budget test/landing-shots.test.js enforces.
const QUALITY = 84;


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
  const round = await api('POST', '/api/rounds', { name: seed.round, members: seed.members || MEMBERS });
  const rid = round.id;
  const memberIds = round.members.map((m) => m.id);
  // A new round's marker is hashed from its id, so each locale's round would
  // wear a different felt — purple in German, blue in Finnish. For a design whose
  // marker IS the ground of whole screens (Der Tisch's felt), pin the design's
  // default (index 0, Tannenfilz: the face T11.3 draws) so the nine sets read as
  // one product. Klassisch's marker is a thin bar and its committed sets were
  // shot without this, so its seed is left exactly as it was.
  if (DESIGN !== 'klassisch') await api('PATCH', `/api/rounds/${rid}/marker`, { index: 0 });

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

  // Two finished sessions, each rating exactly one game — 4,5,4,5 -> 4.5 and
  // 4,4,5,4 -> 4.3, which is what the shelf's two badges show (in the locale's
  // own notation since #850).
  //
  // These are DRAWS with a one-game pool, not direct picks. The rule file
  // prescribes direct picks (a draw is random, so which games carry a Ø badge
  // would change every run) — but a direct-pick session is created `done: true`,
  // with no voting phase at all, so POST …/votes/:pid answers `voting_closed`.
  // The only route that still writes votes onto one is POST …/results, which
  // survives solely for browsers running a pre-#209 bundle out of the service
  // worker cache and is documented for deletion. Constraining the draw's pool to
  // a single game buys the same reproducibility through the live route.
  // Collected so the result shot can be navigated to directly: unlike the vote
  // screen, `/round/:rid/session/:sid` IS a routable view for a finished session
  // (showResultsById in router.js), so it needs no click-through.
  const sessionIds = [];
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
    sessionIds.push(session.id);
  }

  // A THIRD session, and the only one with a ranking in it — the `result` shot
  // is taken of this one (#1090). The two above draw a one-game pool each so
  // their Ø badges are reproducible, which makes their results screen a list of
  // one; a caption promising the group sees its ranking needs a picture of one.
  //
  // Deterministic without constraining the pool to a single game: include
  // filters are AND and exclude filters are OR, so excluding the first THREE
  // tags leaves exactly the games whose only tag is the fourth. With the
  // assignment above (games 0 and 1 take a tag pair each, the rest take
  // `tags[i % 4]`) that is indices 3, 7 and 11 — three games, so a draw of four
  // takes all of them and the order is the only thing chance decides.
  {
    const { session, games: drawn } = await api('POST', `/api/rounds/${rid}/sessions`, {
      memberIds,
      count: 4,
      tagIds: [],
      excludeTagIds: [tags[0].id, tags[1].id, tags[2].id],
      guests: [],
      teams: [],
    });
    if (drawn.length !== RESULT_RATINGS.length) {
      fail(`the ${locale} result draw produced ${drawn.length} games, expected `
        + `${RESULT_RATINGS.length} (drew ${drawn.map((g) => g.title).join(', ') || 'nothing'}) `
        + '— check the tag assignment');
    }
    for (const [j, mid] of memberIds.entries()) {
      const votes = {};
      drawn.forEach((game, k) => { votes[game.id] = { rating: RESULT_RATINGS[k][j], retire: false }; });
      await api('POST', `/api/rounds/${rid}/sessions/${session.id}/votes/${mid}`, { votes });
    }
    await api('POST', `/api/rounds/${rid}/sessions/${session.id}/close`, {});
    // The top-rated game, so the table band and the ranking agree — a chosen
    // game the group rated third reads as a mistake in the picture.
    await api('POST', `/api/rounds/${rid}/sessions/${session.id}/choice`, { gameId: drawn[0].id });
    await api('POST', `/api/rounds/${rid}/sessions/${session.id}/finish`, { winnerIds: [memberIds[1]] });
    sessionIds.push(session.id);
  }

  return { rid, sessionIds };
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

// The client lives in scripts/cdp.js (shared with render-design-marks.js); its
// header says why a dependency-free CDP client and not `chrome --screenshot`.
// Teardown goes through this script's own registry, since fail() exits.
async function openCdp() {
  try {
    return await connectCdp({ port: CDP_PORT, onCleanup: (fn) => cleanups.push(fn) });
  } catch (err) {
    return fail(err.message);
  }
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
  // The design rides on the same boot-time read, for the same reason.
  await evaluate(cdp, `localStorage.setItem('design', ${JSON.stringify(DESIGN)})`);
}

// The one cheap proof the capture is in the language — and the design — you
// think it is. A Tisch run that silently fell back to the face would commit
// nine Klassisch pictures into the Tisch folder, and every test would pass.
async function assertLocale(cdp, locale) {
  const lang = await evaluate(cdp, 'document.documentElement.lang');
  if (lang !== locale) fail(`page renders lang="${lang}" but ${locale} was requested`);
  const design = await evaluate(cdp, 'document.documentElement.dataset.design');
  if (design !== DESIGN) fail(`page wears design="${design}" but ${DESIGN} was requested`);
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
    const tisch = rect('.tisch');
    const rows = rect('.trow');
    return {
      railBottom: rail.length ? Math.max(...rail.map((r) => r.bottom)) : null,
      cardRows: cards.map((c) => c.bottom),
      // The vote card's own box and its last row: the crop wants to clear the
      // nav buttons and stop before the page's footer, not slice either.
      voteBottom: vote.length ? vote[0].bottom : null,
      navBottom: nav.length ? nav[0].bottom : null,
      // The results screen (#1090): the table band and each ranked row. The crop
      // wants the whole band plus whole rows — a cut through a row's score bar
      // reads as the list continuing, a cut through its title reads as broken.
      tischBottom: tisch.length ? tisch[0].bottom : null,
      rowTops: rows.map((r) => r.top),
      rowBottoms: rows.map((r) => r.bottom),
      docHeight: document.documentElement.scrollHeight,
    };
  })()`).then(async (geom) => ({ ...geom, desktop: await evaluate(cdp, desktopShot.PROBE) }));
}

// The result crop is the one height this script does NOT fix in VIEWPORTS, and
// the reason is worth stating: it cannot be fixed. The ranked rows sit below a
// table band whose height varies by locale (measured 2026-09-14: 521 in Korean,
// 621 in Dutch — a 100px spread), and the third session draws its three games in
// a random ORDER, so which title lands in row 1 (and whether it wraps) changes
// between runs. Every fixed height in that spread cuts through a title in some
// locale, which is exactly what §4 of the rule says looks broken; two candidate
// constants were measured doing so before this was written.
//
// So the cut is derived: the MIDPOINT OF THE GAP between row 1 and row 2. That
// is whitespace by construction, in every locale and every run, and it shows the
// band, the Tafel heading and one complete ranked row. The per-locale heights it
// produces are fine — LANDING_SHOTS declares dimensions per asset, and the
// walkthrough renders all three shots to one height in CSS (.landing-walk).
function resultCrop(geom, locale) {
  const { rowTops, rowBottoms } = geom;
  if (rowTops.length < 2) {
    fail(`the ${locale} result screen has ${rowTops.length} ranked rows, need at least 2`);
  }
  const gap = rowTops[1] - rowBottoms[0];
  if (gap <= 0) fail(`the ${locale} result rows overlap (gap ${gap}) — re-derive the crop`);
  return Math.round(rowBottoms[0] + gap / 2);
}

/* Der Tisch's vote card is NOT the fixed point Klassisch's is (#1199). T2.4
   stacks the five faces as full-width rows on a phone, so the card runs to
   794-839px whatever the viewport — measured at 720, 820 and 880, the bottom
   never moved — and 720 slices the fifth face off. Its height also moves with
   the drawn game (a title that wraps adds a line, and the draw is random), so a
   constant has the result shot's problem. Hence the result shot's answer: cut
   a fixed breath below the card's own bottom, re-derived after the viewport is
   set so a card that DID size itself would fail loudly rather than be sliced. */
function voteCrop(geom, locale) {
  if (!geom.voteBottom) fail(`the ${locale} vote screen has no .vote card to measure`);
  return geom.voteBottom + 24;
}

// Which shots are cut where the page says rather than at their VIEWPORTS
// height. Klassisch's vote crop stays the #669 fixed point; Der Tisch's cannot.
const DERIVED_CROPS = {
  result: resultCrop,
  desktop: desktopShot.desktopCrop,
  ...(DESIGN === 'klassisch' ? {} : { vote: voteCrop }),
};

async function capture(cdp, shot, locale, probeOnly) {
  await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORTS[shot]);
  let geom = await probeGeometry(cdp);
  let metrics = VIEWPORTS[shot];
  const derive = DERIVED_CROPS[shot];
  if (derive) {
    metrics = { ...VIEWPORTS[shot], height: derive(geom, locale) };
    await cdp.send('Emulation.setDeviceMetricsOverride', metrics);
    // Re-probe and re-derive: the viewport change is what the screenshot is
    // taken at, so the cut has to be checked against the layout it actually
    // gets. Nothing here is viewport-height-sized, so the two agree — but
    // asserting that is cheaper than assuming it, and a future screen that DOES
    // size itself would otherwise slice a title silently.
    geom = await probeGeometry(cdp);
    const again = derive(geom, locale);
    if (again !== metrics.height) {
      fail(`the ${locale} ${shot} layout moved when the viewport was set `
        + `(${metrics.height} -> ${again}) — the crop is not a fixed point`);
    }
  }
  console.log(`  ${locale}/${shot}  rail=${geom.railBottom} vote=${geom.voteBottom} nav=${geom.navBottom} `
    + `tisch=${geom.tischBottom} rows=${JSON.stringify(geom.rowBottoms.slice(0, 6))} `
    + `doc=${geom.docHeight} cards=${JSON.stringify(geom.cardRows.slice(0, 8))} desk=${JSON.stringify(geom.desktop)}`);
  if (probeOnly) return;

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: QUALITY });
  const file = path.join(OUT_DIR, `landing-${FILE_STEM[shot]}.${locale}.webp`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  const { width, height, deviceScaleFactor } = metrics;
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
    /* Pre-select 4 of 5 — a blank scale looks unfinished. Index 3 is that face:
       the row is the five ratings and nothing else since #909 removed the
       leading trash tile that had offset them by one.

       Since #1168 the tap ADVANCES the card, so this no longer leaves us on a
       rated card — it leaves us on the next one, blank. The old 400ms wait sat
       just past the 340ms beat, which is the worst possible place: long enough
       to advance, short enough to look like a timing detail. So tap, let the
       beat and its tap guard finish, then step back — a revisited card shows
       its rating preselected and, deliberately, does not advance again. */
    if (moods[3]) {
      moods[3].click();
      await new Promise((r) => setTimeout(r, 800));
      history.back();
      await new Promise((r) => setTimeout(r, 500));
    }
    const shown = document.querySelectorAll('.rating .mood');
    return {
      seen,
      moods: shown.length,
      // Which face the shot will actually show as chosen, 1-based. Guarded
      // below: a blank scale is the failure this whole block exists to avoid,
      // and #1168 produced exactly that without any test going red.
      selected: [...shown].findIndex((b) => b.getAttribute('aria-pressed') === 'true') + 1,
      // What is actually on screen, so a failure says which screen we are stuck on.
      onScreen: [...document.querySelectorAll('button, a.btn')].slice(0, 12)
        .map((b) => (b.id ? '#' + b.id : b.className) + ':' + (b.textContent || '').trim().slice(0, 24)),
      rating: !!rating,
    };
  })()`);
  /* Five tiles, one per rating. This count is a real guard and it has earned its
     keep twice: it caught #797's sixth tile arriving and #909's removing it
     again, in both cases before a marketing screenshot of a scale the app no
     longer has could be committed. Move it deliberately, never to make a run
     pass. */
  if (!walk || walk.moods !== 5) fail(`could not reach the vote screen: ${JSON.stringify(walk, null, 1)}`);
  /* And that the scale is not blank. Same posture as the tile count above: the
     shot's whole job is to show what rating a game looks like, and #1168 turned
     the pre-select into a no-op silently — nine locales' worth of marketing
     screenshots of an untouched scale, which reads as a screen nobody has used. */
  if (walk.selected !== 4) fail(`the vote shot would show no chosen rating (selected=${walk.selected})`);
}

// The results screen's own equivalent of reachVoteScreen's tile-count guard: a
// cold load that fails to resolve the session falls back to the round hub
// (showRound), which is a perfectly valid-looking page in the right language —
// so without this the run would quietly commit nine screenshots of the Start
// screen. Assert the two things the walkthrough's third caption promises: the
// table band, and ranked rows to be a ranking OF.
async function assertResultScreen(cdp) {
  const seen = await evaluate(cdp, `(() => ({
    tisch: !!document.querySelector('.tisch'),
    rows: document.querySelectorAll('.trow').length,
    stamp: !!document.querySelector('.stamp--table'),
  }))()`);
  if (!seen.tisch || seen.rows < RESULT_RATINGS.length) {
    fail(`the result screen did not render a ranking: ${JSON.stringify(seen)}`);
  }
}

/* ------------------------------------------------------------------- main */

async function main() {
  const args = process.argv.slice(2);
  const probeOnly = args.includes('--probe');
  if (!designById(DESIGN)) fail(`unknown design '${DESIGN}'`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const only = args.filter((a) => !a.startsWith('--'));
  // Desktop FIRST: the vote shot's wizard leaves a live draw behind, which the
  // Start tab would then show as an unfinished session ticket.
  const shots = only.length ? only : ['desktop', 'shelfPhone', 'vote', 'result'];
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
      console.log(`  seeded ${locale}: round ${rounds[locale].rid}`);
    }

    // Down, patch, up: see writeProviderMetadata. The old server's cleanup entry
    // stays registered and becomes a no-op — killing an exited child is
    // harmless, and dropping the entry would be the riskier edit of the two.
    await stopServer(server);
    console.log(`  wrote provider metadata onto ${writeProviderMetadata(dataDir)} games`);
    await startServer(dataDir);

    const cdp = await openCdp();
    for (const locale of Object.keys(SEEDS)) {
      await setLocale(cdp, locale);
      const { rid, sessionIds } = rounds[locale];

      for (const shot of shots) {
        if (shot === 'vote') {
          // Set the viewport BEFORE walking the wizard: the vote card lays out
          // against the phone breakpoints, and clicking through at 1280 then
          // shrinking leaves a card measured for the wrong width.
          await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORTS.vote);
          await reachVoteScreen(cdp, rid);
        } else if (shot === 'result') {
          // The THIRD seeded session — the only one with more than one game in
          // it (seedRound). Set the viewport first for the same reason the vote
          // shot does, then navigate: unlike the vote screen this URL resolves
          // on a cold load (showResultsById), so there is nothing to click.
          await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORTS.result);
          await navigate(cdp, `${BASE}/round/${rid}/session/${sessionIds[2]}`);
          await assertResultScreen(cdp);
        } else if (shot === 'desktop') {
          // The hub's Start tab; desktopCrop() refuses a page with no rail/CTA.
          await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORTS.desktop);
          await navigate(cdp, `${BASE}/round/${rid}`);
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
