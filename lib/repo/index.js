'use strict';

/*
 * Data-access layer entry point — picks the backend once, at require time.
 *
 * Routes do `require('../lib/repo')` and get whichever backend is configured:
 *   - DATABASE_URL set  -> ./postgres.js (managed PostgreSQL)
 *   - otherwise         -> ./json.js     (the default: data/data.json)
 *
 * The default stays the zero-dependency JSON store, so local dev and the test
 * suite run without a database (issue #127). Both backends implement the same
 * async contract (see json.js for the documented shape); a caller must
 * `await repo.init()` once before serving so the Postgres backend can ensure its
 * schema (json.init() is a no-op). server.js does this before listening.
 */

module.exports = process.env.DATABASE_URL ? require('./postgres') : require('./json');
