'use strict';

/*
 * The data-access-layer contract (lib/repo, issue #127) against the default JSON
 * backend. The same suite runs against PostgreSQL in test/repo.postgres.test.js.
 * helpers.js points DATA_DIR at a fresh temp dir before the store loads.
 */

require('./helpers');
const repo = require('../lib/repo');

require('./support/repo-contract')(repo);
