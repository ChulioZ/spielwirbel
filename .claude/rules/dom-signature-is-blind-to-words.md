---
paths:
  - "test/support/dom-signature.js"
  - "test/*-states.test.js"
  - "test/forest-*.test.js"
  - "test/programmheft-*.test.js"
---

# A Klassisch DOM-signature pin cannot see a changed LABEL — pin the words separately

Every design slice proves "Klassisch unchanged" by comparing
`domSignature(dom.app)` against a fixture captured before the slice. That
signature is tag, classes and a few attributes, and **no text** — deliberately,
because relative dates („vor 5 Tagen") move with the clock
(`test/support/dom-signature.js`).

So the commonest way a design branch leaks into Klassisch is invisible to it:
a shared condition widened the wrong way. Measured on #1471 by breaking
`(tisch || ph || forest) && roundIsYoung(round)` into `(tisch || ph || !forest)`:
Klassisch's hub button read „Erste Session wirbeln" instead of „Session
wirbeln", and the signature test stayed **green** — same `<button>`, same
classes. Only the Forest assertion went red, for the other half of the break.

**Rule:** when a slice changes a STRING under its design (a CTA label, an
empty-state title, a sub-line), add a small Klassisch test that asserts those
exact words on the same screens, beside the signature pin — and break the
condition on purpose to watch THAT test go red
(`.claude/rules/break-the-code-on-purpose.md`). `test/forest-states.test.js`
„Klassisch: the young states keep their words" is the shape.

Don't "fix" this by adding text to the signature: the clock-dependent lines
are exactly why it was left out, and a fixture that drifts daily gets
regenerated blindly, which is worse than no pin.
