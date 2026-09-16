# A `document.styleSheets` walk that recurses on `r.cssRules` sees NOTHING — CSS nesting broke the idiom

<!-- scope: global — the trap is in a PROBE rather than in a file, so it surfaces whenever a session asks the browser which rules match an element, which can happen while verifying any UI change. -->

The standard way to ask the browser *"which rules match this element?"* — the
question no CSS-text test can answer, because it is about the **cascade** rather
than about the file — is to walk `document.styleSheets` and test each
`selectorText`. The obvious walk descends into `@media` blocks like this:

```js
const walk = (list) => { for (const r of list) {
  if (r.cssRules) { walk(r.cssRules); continue; }   // WRONG since CSS nesting
  if (!r.selectorText) continue;
  …
} };
```

**It reports zero rules.** Measured in the Browser pane on 2026-09-16 against a
stylesheet holding 13 `:focus-visible` rules and 1661 rules in total: the walk
above found **0** of either.

## Why

CSS Nesting made every `CSSStyleRule` a potential container, so Chrome now
exposes `cssRules` on **all** of them — an empty `CSSRuleList`, which is
**truthy**. The first branch therefore swallows every ordinary rule: it recurses
into an empty list and `continue`s past the `selectorText` check that was the
whole point. Only `@media`/`@supports` blocks were ever meant to take that
branch, and the property used to be absent on a style rule, which is why the
idiom worked for years and stopped without anything changing in the page.

```js
const r = document.styleSheets[0].cssRules[0];   // a plain `.foo { … }`
r.cssRules            // CSSRuleList {length: 0}   ← truthy
r.cssRules.length     // 0
```

## The fix: recurse on LENGTH, collect on `selectorText`

```js
const walk = (list, out) => { for (const r of list) {
  if (r.selectorText) out.push(r);
  if (r.cssRules && r.cssRules.length) walk(r.cssRules, out);
  return out;
} };
```

Both halves changed: a rule may now legitimately be *both* a selector-bearing
rule and a container, so the two checks are independent rather than an
if/else.

## Why this one is expensive: the empty answer is PLAUSIBLE

The walk does not throw, does not warn, and returns `[]` — which is exactly what
a correct probe returns when the rule genuinely is missing. On #1136 it reported
that the new person tile had no `:focus-visible` rule. That happened to be
**true at the time**, so the probe "confirmed" a real defect and earned trust it
had not earned; the same probe then reported the *fix* as absent too, which is
what finally exposed it. Had the order been reversed, the fix would have looked
like it did not apply and the next move would have been to escalate the
selector's specificity — chasing a cascade fight that does not exist.

**So run a control whose answer you already know**, in the same call, the way
`.claude/rules/measure-text-ink-not-its-box.md` forces an overlap before
believing a clean one. Pick the control carefully: the first one tried here was
`.friend-row__link`, whose rule is `.friend-row__link:focus-visible
.friend-row__name` — the element under test is the **ancestor**, not the match,
so it legitimately returns `[]` and confirmed nothing. A blunt
`allRules.length > 100` floor is the cheapest honest control, and it is the one
that would have caught this instantly.

## It also affects the repo's own CSS helpers — but they are safe

`test/support/css.js` parses the stylesheet as **text**, so nothing there uses
the CSSOM and nothing there is exposed to this. That is a second reason to keep
preferring the text helpers for what a test can assert, and to reach for the
CSSOM only for the question text cannot answer: *which rule wins*.

**Related:** `.claude/rules/measure-text-ink-not-its-box.md` (the same shape one
instrument over — a probe that answers a different question and agrees with every
implementation), `.claude/rules/preview-pane-paint-artifacts.md` and
`.claude/rules/blur-events-never-fire-in-the-preview-pane.md` (the pane's own
falsehoods; this one is not the pane's fault — it is Chrome, and it would happen
in any browser), `.claude/rules/css-rule-lookup-answers-with-the-media-reset.md`
(the text-side lookup trap, where the match is real but is the wrong rule).
