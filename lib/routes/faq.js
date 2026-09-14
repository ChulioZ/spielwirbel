'use strict';

/*
 * The FAQ page (issue #489): GET /faq, mounted ahead of the auth gate in
 * createApp() — its whole audience is people who have not signed up, so it must
 * render for a logged-out visitor.
 *
 * Unlike lib/routes/legal.js this route never 404s: an FAQ has no legal
 * precondition, so every instance serves it and lib/faq.js simply drops the
 * answers that instance cannot honestly give.
 *
 * ONE LANGUAGE PER PAGE since #1088, resolved here and handed to renderFaq():
 * an explicit `?lang=` wins, then Accept-Language, then German.
 */

const express = require('express');
const faq = require('../faq');
// The shipped locale set from the one file that owns it — the same require
// lib/routes/contact.js makes, and for the same reason
// (.claude/rules/shared-constants-across-the-stack.md).
const { SUPPORTED_LOCALES } = require('../../public/js/locales');

const router = express.Router();

/* An ALLOWLIST, never a passthrough. `?lang=` is attacker-controlled and lands
   in `<html lang>`, in the canonical URL and in a CHROME lookup, so anything not
   in the shipped set falls back rather than being reflected
   (.claude/rules/not-english-is-not-german.md is the same call one level up:
   German is the exception, everything unrecognised falls THROUGH). */
router.get('/faq', (req, res) => {
  const asked = String(req.query.lang || '');
  if (SUPPORTED_LOCALES.includes(asked)) {
    return res.type('html').send(faq.renderFaq(asked));
  }
  /* No explicit choice, so the answer depends on the request's own header —
     which means a shared cache must not serve one visitor's language to the
     next. `Vary` is set only on this branch: an explicit `?lang=` is already in
     the URL, so that response varies by nothing. */
  res.vary('Accept-Language');
  /* The HEADER has to be present before `acceptsLanguages` is consulted. With no
     Accept-Language at all it treats the request as `*` and returns the FIRST
     entry of the list it was handed — which is `en`, because that is where
     locales.js starts — so a caller sending no header would silently get English
     where German is the documented default. Measured: supertest sends none, and
     every request in the suite was answered in English until this guard. */
  const header = req.get('Accept-Language');
  const matched = header ? req.acceptsLanguages(SUPPORTED_LOCALES) : null;
  res.type('html').send(faq.renderFaq(matched || 'de'));
});

module.exports = router;
