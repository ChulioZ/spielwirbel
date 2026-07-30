# The Browser pane fires NO blur event — a commit-on-blur editor looks completely inert

The app's inline editors (the game title, the member name, and the round name
since #562) all save on **blur**: `keydown` Enter calls `input.blur()`, and a
`blur` listener does the work. Verifying one of those in the Claude Code Browser
pane produces a perfect false negative — the editor opens, you type, you press
Enter, and **nothing happens at all**: no request, no toast, no error, the input
still sitting in the DOM. That reads exactly like the listener never having been
attached.

## The mechanism

The pane's document never holds system focus:

```js
document.hasFocus()   // false, always
```

`input.focus()` still works — `document.activeElement` really does become the
input, and probing it says so. But in a document without system focus Chrome
treats `element.blur()` as a bare unfocus: **`activeElement` moves to `<body>`
and neither `blur` nor `focusout` is dispatched.** Measured on #562:

```js
input.addEventListener('blur',     () => fired.push('blur'));
input.addEventListener('focusout', () => fired.push('focusout'));
input.blur();
// activeElement: input -> BODY   ✅  (so it *looks* like blur happened)
// fired: []                      ❌  (no event, so no handler ever runs)
```

So every signal you would naturally check agrees that focus left the field, and
the one thing that actually drives the feature did not occur.

## Probing it: dispatch the event, don't chase the focus

Don't try to give the pane focus, and don't rewrite the editor to commit on
`keydown` instead — the blur commit is what makes clicking elsewhere save, which
is real behaviour the app wants. Drive the listener directly:

```js
input.value = 'Freitagsrunde';
input.dispatchEvent(new FocusEvent('blur'));   // what Enter -> blur() does in a focused document
```

That exercises the entire real path — the commit closure, its blank/unchanged
guards, `api()`, the toast and the `currentView()` re-render — and is what
verified #562 end to end. What it does *not* prove is that Chrome dispatches
`blur` on a genuine Enter keypress; that is platform behaviour the game-detail
and member editors have relied on in production since #424, so it needs no
re-proof per feature.

**Do the whole interaction in ONE `javascript_tool` call.** Focus does not
survive between evaluations — a probe that clicks the trigger in one call and
dispatches in the next finds `activeElement` already back on `<body>`, which
adds a second, unrelated reason for the same "nothing happened" symptom and
makes the first one much harder to see.

## The neighbouring trap: stale editors accumulate

Because the commit never fires, a failed attempt leaves the `<input>` in place
where the trigger used to be. The next probe's `document.querySelector('input…')`
then finds **that** one rather than the editor it just opened, and you end up
typing into a detached previous attempt — a second layer of confusing results on
top of the first. Re-`navigate` between attempts rather than re-running against a
page you have already poked, and assert the editor count (`querySelectorAll(…)
.length`) before and after opening one.

**Related:** `.claude/rules/preview-pane-paint-artifacts.md` (blank captures and
wedged input — the same "the pane is lying to you" family),
`.claude/rules/accessibility-contrast-and-modals.md` ("`el.focus()` from a script
does not set `:focus-visible`" — the other focus-related pane falsehood, and note
`.claude/rules/native-button-vs-focusable-span.md`'s corollary that one real
`Tab` keypress switches Chrome into keyboard modality),
`.claude/rules/hidden-attribute-vs-display-rule.md` (`el.hidden` answering about
the DOM while the pixels disagree),
`.claude/rules/popover-vs-sheet-editors.md` (the pane's split brain about width,
and why these editors present as sheets on a phone).
