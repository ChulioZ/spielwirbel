'use strict';

/*
 * Browser-side fault reports (issue #1149): POST /api/client-error.
 *
 * Nothing that went wrong in a visitor's browser used to reach the operator —
 * see the header of public/js/error-report.js for the worked example (the
 * WebKit canvas-taint bug, which failed for every Safari and iOS visitor and
 * left no trace anywhere but one localized toast).
 *
 * UNAUTHENTICATED, mounted ahead of the app's auth gate in createApp() next to
 * /api/contact, because the faults most worth hearing about are the ones on the
 * login and landing screens. Behind its own low limiter
 * (clientErrorLimiter, CLIENT_ERROR_RATE_LIMIT_MAX) and writing into its OWN
 * ring buffer, never the instance warn/error one — recordClientError() in
 * lib/observability.js says why that separation is load-bearing.
 *
 * NOT A SECURITY FEATURE, and it must not become an attack surface either. The
 * payload is a fixed, closed allowlist: a field outside it is a 400 and is
 * never logged, so no free text an extension or a caller invented can reach a
 * surface the operator reads with operator privileges. The panel renders every
 * field as textContent — that is the second line, and this schema is the first.
 *
 * Deliberately absent from the payload: the full stack, the full user agent,
 * any DOM content, any form value, any round/session/member/account id.
 */

const express = require('express');
const { z } = require('zod');
const { validateBody } = require('../validate');
const { recordClientError, uaEngine } = require('../observability');
// The client OFFERS these and this route VALIDATES against them, so they are
// ONE file (.claude/rules/shared-constants-across-the-stack.md) — a hand-copied
// server list here is the member-colour palette bug waiting to happen, and it
// would fail in the direction that produces no error: the browser would report
// a kind the server 400s, and the fault it was reporting stays invisible.
const {
  CLIENT_ERROR_KINDS, CLIENT_ERROR_MESSAGE_MAX, isClientErrorPathShape,
} = require('../../public/js/error-report');
const { SUPPORTED_LOCALES } = require('../../public/js/locales');

const router = express.Router();

// Our own scripts only, by shape. The name pattern admits the production
// build's content-hashed spelling (js/core.js -> js/core.7e38c5aa.js), which is
// the only one production ever reports; the ORIGIN half of the check is the
// client's job (clientErrorSource), since the server cannot know which document
// the script was loaded into. Character class and bounded quantifiers, so it is
// linear on hostile input (CodeQL js/polynomial-redos).
const SOURCE_RE = /^js\/[A-Za-z0-9._-]{1,60}\.js:\d{1,7}(:\d{1,7})?$/;

// .strict(), so an unknown key is a 400 rather than being quietly dropped. That
// is the stronger choice on purpose: a client sending a field this route does
// not know is a client disagreeing with the schema, and hearing about it is
// worth more than accepting a report whose shape nobody can account for.
//
// `kind` is checked by MEMBERSHIP in the shared list rather than with z.enum():
// it accepts a non-string (an array, a number) and refuses it, where z.enum on
// a runtime array is a shape this codebase does not otherwise rely on.
const reportSchema = z.object({
  kind: z.string().refine((v) => CLIENT_ERROR_KINDS.includes(v), 'invalid_kind'),
  // Generously capped here and TRUNCATED below, rather than 400'd: a long
  // message is still a real fault, and refusing it would lose the report.
  message: z.string().max(4000).optional(),
  source: z.string().max(120).regex(SOURCE_RE, 'invalid_source').optional(),
  // Validated with the very function that PRODUCED it: a shape is exactly a
  // string that is its own shape, so there is no second pattern here to drift
  // out of sync with the client's route table. A pathname carrying a round id —
  // or a vote-link token, which is a live credential — is not its own shape and
  // is refused.
  path: z.string().max(80).refine(isClientErrorPathShape, 'invalid_path').optional(),
  locale: z.string().refine((v) => SUPPORTED_LOCALES.includes(v), 'invalid_locale').optional(),
}).strict();

// 204: the client is fire-and-forget and reads nothing back, so there is no body
// to send and no reason to invite one.
router.post('/', (req, res) => {
  const body = validateBody(reportSchema, req, res);
  if (!body) return;
  recordClientError({
    kind: body.kind,
    // Truncated server-side as well as client-side. The client's own cap is not
    // enough: this endpoint is open, and the buffer's bound has to hold against
    // whatever is actually sent rather than against what our own code sends.
    message: body.message ? body.message.slice(0, CLIENT_ERROR_MESSAGE_MAX) : null,
    source: body.source || null,
    path: body.path || null,
    locale: body.locale || null,
    // SERVER-DERIVED, and the client never sends one: engine plus major version
    // only, off the request's own header. See uaEngine.
    ua: uaEngine(req.get('user-agent')),
  });
  res.status(204).end();
});

module.exports = router;
