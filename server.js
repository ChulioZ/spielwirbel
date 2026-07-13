'use strict';

/*
 * Spieleabend – small local server.
 *
 * Persistence: a single file data/data.json (see lib/store.js).
 * Images: stored as files under data/uploads/; data.json only holds the path.
 *
 * Start:  npm start   ->  http://localhost:3000
 *
 * Note: auth is optional and off by default – the MVP runs on a local home
 *       network only. Set AUTH_PASSWORD to gate the app behind a single shared
 *       login (issue #129, see lib/auth.js); a full account model is the roadmap.
 *       Local-only/open is the current stage, not a permanent stance.
 */

const { DATA_FILE, UPLOAD_DIR } = require('./lib/store');
const { createApp } = require('./lib/app');

const app = createApp();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  🎲  Spieleabend running at  http://localhost:${PORT}\n`);
  console.log(`      Data is stored in:   ${DATA_FILE}`);
  console.log(`      Images are stored in: ${UPLOAD_DIR}\n`);
});
