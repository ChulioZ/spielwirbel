'use strict';

/*
 * Familien-Spielesammlung – small local server.
 *
 * Persistence: a single file data/data.json (see lib/store.js).
 * Images: stored as files under data/uploads/; data.json only holds the path.
 *
 * Start:  npm start   ->  http://localhost:3000
 *
 * Note: intentionally no authentication – meant for a local home network only.
 */

const express = require('express');
const path = require('path');

const { ROOT, DATA_FILE, UPLOAD_DIR } = require('./lib/store');

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// API routes (split by resource).
app.use('/api/rounds', require('./routes/rounds'));
app.use('/api/rounds/:rid/games', require('./routes/games'));
app.use('/api/rounds/:rid/sessions', require('./routes/sessions'));
app.use('/api/rounds/:rid/activities', require('./routes/activities'));
app.use('/api/rounds/:rid/background', require('./routes/background'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  🎲  Familien-Spielesammlung running at  http://localhost:${PORT}\n`);
  console.log(`      Data is stored in:   ${DATA_FILE}`);
  console.log(`      Images are stored in: ${UPLOAD_DIR}\n`);
});
