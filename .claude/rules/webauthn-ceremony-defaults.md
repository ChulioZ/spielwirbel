---
paths:
  - "lib/webauthn.js"
  - "lib/routes/passkeys.js"
  - "public/js/passkey.js"
  - "public/js/account.js"
  - "public/js/views-account.js"
  - "test/passkeys.test.js"
  - "test/webauthn.test.js"
---

# Passkeys (#418): four defaults that are wrong for us, and all four fail silently

WebAuthn's failure mode is uniquely unhelpful — a mismatched RP ID, origin,
challenge or credential type does not produce an error the user can read. The OS
sheet simply reports **"no passkey found"**, or the ceremony completes and the
server rejects it as an invalid signature. So every item below produces a
*plausible, finished-looking* feature that does not work.

## 1. A STRING challenge is UTF-8 text to @simplewebauthn — pass bytes

`generateRegistrationOptions({ challenge })` accepts `string | Uint8Array`, and
the two are not the same value:

```js
if (typeof _challenge === 'string') _challenge = isoUint8Array.fromUTF8String(_challenge);
options.challenge = isoBase64URL.fromBuffer(_challenge);
```

So handing it an **already base64url-encoded** string — the obvious move, since
that is what we sign into the challenge token — makes `options.challenge` the
encoding *of the encoding*. The client then signs a different value than the one
we stored, and `expectedChallenge` never matches.

`lib/webauthn.js` therefore mints raw bytes (`newChallenge()`) and owns the
encoding (`encodeChallenge()`), passing the **Uint8Array** in. That makes
`options.challenge` exactly the string the token carries.

**`test/webauthn.test.js` pins this against the REAL library**, in the one test
in that file that does not stub it. That matters because `test/passkeys.test.js`
stubs the boundary: a stub encoding the challenge its own way would make every
route test in that file self-consistent and wrong together.

## 2. `residentKey: 'required'` is what makes usernameless login exist at all

The login side sends `allowCredentials: []`, so the authenticator has to answer
"which credentials do you hold for this RP?" entirely on its own — which only a
**discoverable (resident)** credential can.

Without it, an authenticator may legitimately create a **non-discoverable**
credential. Registration succeeds, the passkey appears in the Konto list, and
"Mit Passkey anmelden" then never offers it. Nothing errors, on either side.

Set **both** spellings (`residentKey: 'required'` and `requireResidentKey: true`
— the CTAP2 and legacy forms), and set **no `authenticatorAttachment` at all**:
`'platform'` excludes hardware keys and the cross-device QR flow, and
`'cross-platform'` excludes Touch ID. Any value there silently drops a device
class. `test/passkeys.test.js` asserts on the options the route **passed in**,
not on the response — the response is the stub echoing itself.

## 3. `requireUserVerification` DEFAULTS TO TRUE on both verifies

`verifyRegistrationResponse` and `verifyAuthenticationResponse` default it to
`true`, which silently contradicts an options-time policy of
`userVerification: 'preferred'`. The combination registers a hardware key with no
PIN configured and then refuses its assertions — a passkey that works once and
never again.

Both routes pass `requireUserVerification: false` explicitly. If the options-time
policy is ever raised to `'required'`, these must move with it: the two halves
are one decision written in two places.

## 4. A second router on the same mount runs the rate limiter TWICE

The issue sketched the login pair at `/api/account/passkey-login`, which needs a
second `app.use('/api/account/…', authLimiter, …)`. Express runs the middleware
of **every** matching mount, so an ordinary `/api/account/login` request would
spend **two** from `AUTH_RATE_LIMIT_MAX` instead of one — silently halving the
brute-force ceiling for login, register and refresh.

Hence one mount, with the login pair under `/api/account/passkeys/login`. The
same trap applies to any future account sub-router: put it on its own path
prefix, never on a second `/api/account` mount. (A router-level `router.use()`
gate is the other half of this — mounted at `/api/account` it would field
*every* account path, so `accounts_disabled` would start 404ing `/login`.)

## 5. `accountApi(method, path, null)` sends the literal `null` — and 400s

Not passkey-specific, but this is where it bit. `accountApi`
(`public/js/account.js`) serializes anything that is not **`undefined`**:

```js
if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
```

So a bodyless request written as `accountApi('DELETE', path, null)` sends the
four bytes `null`, and `express.json()` runs in **strict mode** — it accepts only
an object or an array at the top level. The request dies at the body parser with
`400 entity.parse.failed` before any route runs, so the handler's own 404/200
logic is never reached and the UI shows a generic failure.

Every *other* DELETE call site in the app omits the argument entirely, which is
why this had never surfaced. It appears the moment someone writes a shared
`call(method, body, …)` helper and needs a placeholder for "no body" — pass
`undefined`, never `null`.

**Two things about how this was caught are worth copying.** The route tests could
not see it (supertest's `.delete()` sends no body, so they exercised the correct
shape all along), and neither could a DOM assertion — the row disappearing proves
nothing, because a failed call leaves the list untouched *and* a successful one
re-renders it. What discriminated was asking the **server** afterwards
(`GET /passkeys`) rather than reading the DOM, and comparing the two request
shapes directly against a live route: `body: 'null'` → **400**, no body → **404**.

And the first two attempts to verify it measured the **cached pre-fix script** —
the service worker re-registers on every load, so clearing it once at the start
of a session is not enough after a server restart and a re-navigate. Clear it
again immediately before the probe that matters
(`.claude/rules/pwa-service-worker.md`).

## The RP ID is effectively permanent once anyone has registered

A passkey is bound to one RP ID for life. Changing `WEBAUTHN_RP_ID` does not
migrate anything and does not error — every existing passkey simply stops being
offered, with "no passkey found" as the only symptom. It defaults to
`canonicalHost()`, which the `.de`/`.com` domains already 301 to, so the
single-origin convergence WebAuthn needs is one the app already had (#230).

The **origin** is a separate value and must carry the scheme and port:
`https://<rp-id>` everywhere except localhost, which browsers treat as a secure
context over plain http and which therefore needs `http://localhost:<PORT>`.
That is why `.claude/launch.json`'s `dev-temp-data` sets
`WEBAUTHN_RP_ID=localhost` — without it a local ceremony binds to
`spielwirbel.app` and cannot complete.

## What could not be verified locally, and what stands in for it

There is no authenticator in the test suite or in the Browser pane, so **no
end-to-end ceremony has ever run here**. What is proven: the challenge matrix
(sign/verify/tamper/expiry/cross-scope) against the real HMAC, the encoding
fidelity against the real library (§1), and every route behaviour around the
verification with the library stubbed — including that each of six security
controls reddens exactly its own named test when deliberately broken
(`.claude/rules/break-the-code-on-purpose.md`).

What is **not** proven and needs a human with a real device: that a platform
authenticator, a hardware key and the cross-device QR flow each complete against
this RP ID and origin. Treat a green suite here as evidence about our code, never
about the ceremony.

**Related:** `.claude/rules/user-accounts.md` (the `identities` seam this extends
and the anti-enumeration invariants the login pair must not regress),
`.claude/rules/accounts-mode-gate.md` (why the login response must set the access
cookie, or every cover image 401s),
`.claude/rules/tabler-icon-codepoints.md` (`ti-fingerprint` is `\ebd1` in this
bundle — read from its own cmap, and confirmed by eye),
`.claude/rules/blur-events-never-fire-in-the-preview-pane.md` (how the inline
rename editor was verified).
