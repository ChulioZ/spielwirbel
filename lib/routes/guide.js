'use strict';

/*
 * The „Was spielen wir heute?" guide (issue #1171): GET /<lang>/<slug>, one
 * page per shipped language. Mounted ahead of the auth gates in createApp() like
 * /faq — its whole audience is a stranger arriving from a search result.
 *
 * Not an Express path pattern with params: the lookup is an exact match of
 * `req.path` against the nine ENCODED paths lib/guide.js derives from the slug
 * table. The Korean slug is Hangul and arrives percent-encoded, so the table has
 * to be compared in that form anyway — and an exact Map lookup means this router
 * never parses, decodes or routes a path that is not one of the nine.
 * Anything not in the table — an unknown slug, an unknown locale, a trailing
 * slash — calls next() and falls through to the SPA exactly as before.
 */

const express = require('express');
const guide = require('../guide');

const router = express.Router();

router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const lang = guide.GUIDE_PATHS.get(req.path);
  if (!lang) return next();
  /* `public`: nothing on the page is personal — the same bytes for every visitor
     of this URL. An hour, not a day: the call to action follows DEMO_ENABLED,
     and an operator who turns the demo off should not have a shared cache
     advertising it until tomorrow. */
  res.set('Cache-Control', 'public, max-age=3600');
  return res.type('html').send(guide.renderGuide(lang));
});

module.exports = router;
