'use strict';

/*
 * Every mutating route that reads `req.body` goes through `validateBody` (#213)
 * — or is named below with the reason it does not.
 *
 * #213 moved body validation to one zod boundary, and two handlers written
 * AFTER it copied the pre-#213 shape from their neighbours instead
 * (`req.body.wish !== false`, `Array.isArray(req.body && req.body.tables)`) —
 * neither exploitable, both the drift the boundary exists to stop. Nothing
 * could see it: a hand-rolled read is exactly as green as a validated one
 * (2026-09-06 code-maturity audit, M-003).
 *
 * This is a SOURCE SCAN, so it sees call shapes, not semantics
 * (.claude/rules/source-scanning-guards-enumerate-shapes.md): a handler is the
 * text from one `router.<method>(` to the next, "reads the body" is a literal
 * `req.body`, and "validates" is a literal `validateBody(` in that same text.
 * Taken red on the two sites above before they were converted.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'lib', 'routes');

/* Raw readers that stay raw, each with the reason. A new entry takes an
   argument; an entry whose handler stops reading the body goes stale and is
   reported below, so the list cannot rot into names nobody has looked at. */
const ALLOW = {
  // Twelve handlers validate PER FIELD through emailSchema/passwordSchema/… —
  // it is zod, but a parallel pattern to the shared boundary (M-003 P-side).
  'account.js': 'per-field zod schemas (safeParse on each field), not the shared boundary',
  // The body is handed straight to @simplewebauthn's verifier, which owns its shape.
  'passkeys.js': 'the WebAuthn response is verified by @simplewebauthn/server',
  // The shared-password gate: one string, compared with timingSafeEqual.
  'auth.js POST /login': 'a single password field, compared constant-time',
  'admin.js POST /login': 'a single password field, compared constant-time',
  // Its own zod union with `.catch` — a malformed design becomes the default
  // rather than a 400, which is what the client would do with an unknown one.
  'background.js POST /': 'own zod schema with .catch (unknown design -> default)',
  // The honeypot is read beside validateBody, deliberately outside the schema so
  // a filled-in field is not reported as a validation error to the bot.
  'games.js POST /': 'multipart (multer) form: the fields arrive as strings and buildSource/buildEdition own them',
  'games.js PATCH /:gid': 'validateBody runs; the raw alias `b` feeds the cover branches that predate #213',
  'sessions.js POST /:sid/choice': 'null-or-string legacy contract (#532): `null` clears, anything else is coerced',
};

const HANDLER = /^router\.(get|post|put|patch|delete)\('([^']*)'/gm;

test('every mutating route that reads req.body validates it, or is allowlisted with a reason', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();
  assert.ok(files.length >= 10, `found only ${files.length} routers`);

  const raw = [];
  const seen = new Set();
  let handlers = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(DIR, file), 'utf8');
    const marks = [...text.matchAll(HANDLER)];
    marks.forEach((m, i) => {
      const method = m[1].toUpperCase();
      if (method === 'GET') return;
      handlers += 1;
      const block = text.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : text.length);
      if (!/\breq\.body\b/.test(block)) return;
      if (/\bvalidateBody\(/.test(block) && !ALLOW[`${file} ${method} ${m[2]}`]) return;
      const key = `${file} ${method} ${m[2]}`;
      if (ALLOW[file] || ALLOW[key]) { seen.add(ALLOW[file] ? file : key); return; }
      raw.push(key);
    });
  }
  // Counts hits, not attempts — a regex that stopped matching handlers at all
  // would otherwise pass over an empty list.
  assert.ok(handlers > 60, `matched only ${handlers} mutating handlers, expected the whole surface`);

  assert.deepEqual(raw, [],
    `these mutating handlers read req.body without validateBody() — route the body through a zod schema, or name the site in ALLOW with a reason:\n  ${raw.join('\n  ')}`);

  const stale = Object.keys(ALLOW).filter((k) => !seen.has(k));
  assert.deepEqual(stale, [], `ALLOW entries whose handler no longer reads the body raw — remove them:\n  ${stale.join('\n  ')}`);
});
