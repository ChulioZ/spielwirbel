# A caught fault with NO SERVER INVOLVEMENT is invisible — the catch is the end of the story

<!-- scope: global — the trap is a discipline applied while WRITING any client-side catch, anywhere under public/js/**, not only at the sites that report today; a scoped rule that fails to load loses its protection silently. -->

`.claude/rules/client-errors-are-not-instance-faults.md` is about the server
recording too much. This is the mirror: the client recording nothing.

`public/js/` holds ~217 catch blocks. The ones wrapping an `api()` call are fine
— the server logs its own side, so the fault is in the request log whatever the
client does with it. The ones touching **no server at all** are a blind spot by
construction:

```js
// public/js/views-chronik.js, before #1149 (views-period-recap.js since #1345)
} catch {                                // the error was not even bound
  toast(t('periodRecap.toast.failed'));  // and this is the only trace anywhere
  return;
}
```

That one was the WebKit canvas-taint bug
(`.claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md`): `canvas.toBlob()`
threw for **every** round on a world design, on Safari and every iOS browser —
roughly half the app's traffic — and nothing reached the operator. It shipped
believing itself safe, and three properties kept it that way:

- **The catch is CORRECT.** It exists so as not to scold a user who dismissed
  the share sheet. Deleting it would be a regression; the defect is that it is
  silent in the other direction too.
- **The Browser pane is Chromium**, so the pre-merge check could not reproduce
  it (`.claude/rules/browser-pane-is-chromium-only.md`).
- **The user sees a plausible failure**, so nobody reports it as a bug. A toast
  saying "that didn't work" reads as the feature being flaky.

## The rule

**When you write or edit a `catch` in `public/js/`, ask whether the server will
hear about it.** If the answer is no, add a `reportClientError(kind, err)` call
beside the existing toast — `public/js/error-report.js`, wired at six sites
today. Keep the toast exactly as it is: this adds a report, it does not change
what the user sees.

Adding a kind means adding it to `CLIENT_ERROR_KINDS`, which the route validates
against (the eighteenth entry in
`.claude/rules/shared-constants-inventory.md`) — a hand-copied server list would
400 the report and restore the blind spot through the mechanism built to remove
it.

**A kind names the SITE, so an explicit report needs no source.** Only
`uncaught` and `unhandled_rejection` carry a filename and line, because only
those two get one from the browser. Don't hard-code `'js/foo.js:461'` at a call
site — the number is wrong by the next edit and nothing goes red.

## Three things about the reporter that each fail silently if undone

- **Send the route SHAPE, never `location.pathname`.** A client path carries
  round, game and member ids, and `/vote/<token>` carries a **live credential** —
  the one secret in this app that rides in a path
  (`.claude/rules/secrets-in-paths-reach-the-logs.md`). `clientErrorPathShape`
  maps the pathname onto an allowlist mirroring `resolveRoute`, so anything
  unrecognised folds to `/other` rather than to itself. The server validates with
  **that same function** — a shape is exactly a string that is its own shape — so
  there is no second pattern to drift.
- **A `SyntaxError`'s message quotes the input it was parsing.** On the client
  that input is a *response body*, i.e. round data, so that one class reports its
  name only (`CLIENT_ERROR_OPAQUE`). This is
  `.claude/rules/logging-a-caught-fault.md` §1 pointed the other way: there the
  parsed bytes are `data.json`, here they are the API response.
- **The reporter must never make things worse.** One try/catch around
  everything, a swallowed `fetch` rejection, a per-load cap and de-duplication by
  kind+message+source. Without the last two a throw inside a render loop hammers
  the endpoint; without the first two the reporter's own failure fires the very
  handler that called it.

## Report it, but do not report a RESOURCE 404

`window`'s `error` event also fires for a failed `<img>`/`<script>` load, without
a message. That is the server's business and it already has its own log line, so
the handler checks `e.message` — otherwise the operator's card fills with
404s on hotlinked covers, which is the eviction problem this endpoint was
carefully kept out of.

## Why this needs a discipline rather than a test

Nothing can detect a catch that *should* report and does not: the code is correct
by its own lights, the feature works, the user sees the message the author
intended, and every test is green. It is the
`.claude/rules/ops-only-changes-still-stale-the-docs.md` shape — an absence that
is invisible from every direction — so it rides on the question above, asked
while the catch is being written.

**Related:** `.claude/rules/client-errors-are-not-instance-faults.md` (why the
report gets its OWN ring buffer and must never reach the instance one),
`.claude/rules/logging-a-caught-fault.md` (#1148, the server-side half of the
same audit, and the message-carries-the-payload trap),
`.claude/rules/webkit-taints-a-canvas-on-an-svg-pattern.md` (the fault this is
written from), `.claude/rules/browser-pane-is-chromium-only.md` (why it could not
be reproduced before release),
`.claude/rules/admin-moderation-surface.md` (the panel that renders the card, and
why every field is `textContent`).
