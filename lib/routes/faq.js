'use strict';

/*
 * The FAQ page (issue #489): GET /faq, mounted ahead of the auth gate in
 * createApp() — its whole audience is people who have not signed up, so it must
 * render for a logged-out visitor.
 *
 * Unlike lib/routes/legal.js this route never 404s: an FAQ has no legal
 * precondition, so every instance serves it and lib/faq.js simply drops the
 * answers that instance cannot honestly give.
 */

const express = require('express');
const faq = require('../faq');

const router = express.Router();

router.get('/faq', (req, res) => {
  res.type('html').send(faq.renderFaq());
});

module.exports = router;
