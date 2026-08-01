---
paths:
  - "lib/faq.js"
  - "lib/legal.js"
  - "public/kontakt.html"
  - "public/login.html"
  - "public/index.html"
  - "test/standalone-page-brand.test.js"
---
# A public page carrying instance-specific claims must be SERVER-rendered (#489)

The FAQ (#489) had to answer things that are true of the operator's instance and
false of a self-hosted one: whether donations exist, whether accounts are on,
whether there is a privacy policy to link. The obvious shape was a standalone
document under `public/` in the `public/kontakt.html` mould, gating those answers
client-side from `GET /api/config` — the way `kontakt.js` hides its form and
`initFooter` hides the footer links.

**That shape cannot make an honest page.** A crawler and a JS-off visitor never
run the gate, so the untrue sentence ships in the served bytes regardless — the
same failure as `.claude/rules/hidden-attribute-vs-display-rule.md` (where a
`display` rule beat the `hidden` attribute and published „EU-Hosting" on a
non-EU box) and the reason
`.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md` §4 forbids any
config-gated claim in the static landing hero.

So `/faq` is server-rendered (`lib/faq.js` + `lib/routes/faq.js`): each answer
carries an optional `gate`, resolved from env per request, and an answer the
instance cannot honestly give is **never in the document at all**.

**The rule:** a public page whose content depends on how the instance is
configured gets server-rendered. Client-side gating is fine for an *affordance*
(a button that would 404, a form with no channel) and wrong for a *claim*.

Note the page is deliberately **not** gated the way `lib/routes/legal.js` is — an
FAQ has no legal precondition, so it answers 200 everywhere and merely renders
fewer questions. Only the answers that point at `/datenschutz`, `/impressum` or
`/kontakt.html` hang off `legal.legalConfigured()`, because those routes 404
until it is configured and a link into a 404 is its own defect.

## Trap 1: hoisting the CSS into a `const` silently disarms the token-parity test

`test/standalone-page-brand.test.js` licenses the design-token copy these pages
carry, and it reads the file as **text**, pulling the rules out of
`<style>…</style>`. `lib/faq.js` is in its `PAGES` list — a `lib/` module beside
two `.html` documents, which works because the assertions do not care what kind
of file the block sits in.

They do care that the block holds **real declarations**. Write the CSS into a
constant and interpolate it —

```js
const STYLE = `:root { … }`;          // ← disarms the third assertion
…
`<style>${STYLE}</style>`
```

— and the third assertion ("declares no palette hex outside its `:root` copy")
scans the seven characters `${STYLE}` instead of the stylesheet, finds no hex,
and passes **vacuously**. Measured: with the CSS hoisted and a stray `#b83280`
left in the file, it goes green. So the CSS stays inline in the template, and
both ends say why.

The other two assertions keep working either way (they scan the whole file for
`:root` and `@font-face`), which is what makes this one hard to notice — the
suite still reports three passing tests for the file.

## Trap 2: one document, two languages → every id is emitted twice

`renderFaq` renders the same question list in German and again in English, so
each `<section id="faq-…">` appeared **twice**: invalid HTML, and `#faq-app`
becomes an ambiguous anchor. The English half now takes a `-en` suffix and the
German half keeps the bare id (it is the stable, linkable one).

`lib/legal.js` does not have this problem and it is worth knowing why, because it
looks like the same shape: it renders each document's DE and EN halves as
*different prose*, and its one id that both halves could collide on — the terms
changelog — already picks `aenderungen` / `changes-en` by language, on purpose.
The duplication only appears once a **list is rendered per language from one
source**, which is what this page introduced.

No test saw it; a browser probe did (`[...document.querySelectorAll('[id]')]`,
filtered for repeats). `test/faq.test.js` now asserts id uniqueness over the
served HTML — cheap, and it generalizes to any future bilingual single-document
page.

**Related:** `.claude/rules/shared-constants-across-the-stack.md` (§"when sharing
the file is not available at all" — why these pages copy the tokens and what
licenses it), `.claude/rules/hidden-attribute-vs-display-rule.md` and
`.claude/rules/noindex-vs-disallow-and-the-crawler-surface.md` §4 (the two
client-side-gating failures this shape avoids),
`.claude/rules/keep-legal-docs-current.md` (why the data answers link the policy
instead of restating it).
