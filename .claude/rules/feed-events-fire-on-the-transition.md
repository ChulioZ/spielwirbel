---
paths:
  - "lib/feed.js"
  - "lib/routes/**"
  - "public/js/views-session.js"
---
# An event emitted per REQUEST announces one evening three times

`emitFeedEvent` (#325) appends a row on every call — it is deliberately not
idempotent, and until #856 nothing said so. Both call sites emitted inside a
plain `if (finished)` / `if (!wish)`, i.e. **on the request**, while the screens
that drive them re-POST the same state as an ordinary save:

```js
// public/js/views-session.js — the results screen has NO save button, by design
async function saveWinners(ids) {
  await api('POST', `…/sessions/${session.id}/finish`, { finished: true, winnerIds: ids });
}
```

So marking a session played and then tapping two winner chips stored **three**
identical `session_played` rows, and every friend read the group as having played
Catan three times. `POST …/games/:gid/wish` had the same shape. It shipped for
five weeks and was found by the operator looking at their own feed.

## The rule

**A route the client re-POSTs as an idempotent save must emit its feed event on
the STATE TRANSITION, not on the request.** The prior state has to be in hand:

- `POST …/sessions/:sid/finish` already reads the session before mutating, so the
  guard is `!session.finished && …` and costs nothing. A reset (`finished:false`)
  followed by a re-finish is a genuine second play and still emits — that falls
  out of the same guard.
- `POST …/games/:gid/wish` had no prior read, so it takes one (`req.repo.getGame`)
  and gates on `before.wish`.

Read the *client* before deciding an emit is safe. The tell is a screen with no
save button: an auto-saving editor, a toggle group, anything that persists on
every interaction. "The route is idempotent" is a property of the **stored state**
and says nothing about its side effects.

## Why the guard is not enough on its own, and the collapse is not belt-and-braces

`collapseFeedEvents` in `lib/feed.js` folds an adjacent run on the way out, at
**both** read sites. It does two things a guard cannot:

- **Rows already written cannot be un-written.** They sit in friends' feeds until
  `MAX_FEED_EVENTS` ages them out — a read-side fix is what repairs production
  without a migration or an admin action.
- **A guard is a read-then-write**, so two overlapping requests can both observe
  the old state and both emit. The window is small; a double-tap is exactly the
  input that produced this bug.

Three properties of the collapse are load-bearing and each fails silently:

- **Adjacent runs only.** The same game announced again with something else in
  between is a real second event. A fixture with one run and nothing else cannot
  tell a collapse from a global de-dupe — `test/feed.test.js` interleaves a third
  event for that reason.
- **Before the `FEED_SHOW` slice**, never after: collapsing after it lets
  duplicates eat the page, so the feed gets *shorter* instead of cleaner.
  Measured — moving the call after the slice reds exactly one named test.
- **The window is measured against the KEPT (newest) event**, not against each
  neighbour. Chained pairwise, a long run of hourly events would swallow one
  arbitrarily far back.

## The read-site count is the part that rots

There are **two** feed read sites — `lib/routes/friends.js` `GET /feed` and
`lib/routes/profile.js` `feedFor()` — and a fix applied to one leaves the other
showing the duplicates, with no error and a screen that still looks finished.
That is why the helper lives in `lib/feed.js`, the single seam, rather than being
written out twice (`.claude/rules/shared-constants-across-the-stack.md`).

## What was deliberately left alone

`trackEvent('session_finished')` and `trackEvent('game_added')` still count
**requests**, so they over-count for the same reason. That is #856's stated scope
boundary, not an oversight: whether a product counter should count requests or
transitions is its own question, and the answer is not obviously the same one.
If you change it, change it on purpose.

**Related:** `.claude/rules/product-event-logging.md` (the sibling allowlist
discipline, and the other emitter with a call-site contract),
`.claude/rules/break-the-code-on-purpose.md` (the emit-guard specs read the
**store**, not the feed route — the collapse would otherwise make them pass
against a route that still emits per request).
