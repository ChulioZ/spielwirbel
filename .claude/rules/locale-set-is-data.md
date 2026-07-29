# The locale set is data (#504) — and a test over it is VACUOUS at two locales

`public/js/locales.js` holds one row per shipped UI language (code, native label,
BCP-47 tag). Everything else derives from it: the picker, `Intl.PluralRules` in
`tn()`, `fmtDateTime`/`fmtMonth`, and the feedback-metadata allowlist in
`routes/contact.js`. Adding a language is that row plus a `lang/<code>.js` file,
wired into `index.html`, `sw.js`'s `SHELL` and a `CACHE` bump.

Three things about making it data are non-obvious, and the first one is the trap
that makes the other two matter.

## 1. A loop over the locale list proves NOTHING while two locales ship

This is the whole verification lesson, and it was walked into on #504 itself. The
obvious test for "the allowlist is shared, not copied" is:

```js
for (const locale of SUPPORTED_LOCALES) { /* assert the route keeps it */ }   // VACUOUS
```

`SUPPORTED_LOCALES` is `['en', 'de']`, and the hand-copied literal it replaced
was `['de', 'en']`. **The loop passes identically against the copy** — it is
green against exactly the code it exists to catch, and it stays that way until
somebody adds a language, i.e. long after the drift could have been introduced.
The same applies to a parity test whose locale set is derived, and to any
"derived" check over a one- or two-item list.

**The fix is to register a locale the test invents**, which is precisely what a
translation issue does:

```js
SUPPORTED_LOCALES.push('zx');           // routes/contact.js resolves it per request
try { /* assert the route now accepts 'zx' */ } finally { SUPPORTED_LOCALES.pop(); }
```

That works because the `const` bindings hold a **mutable array and plain
objects** — `const` freezes the binding, not the value — so a test (or a vm
sandbox) can add a locale without touching the file. `test/i18n-locales.test.js`
uses the same move to prove the plural and date paths: it pushes a synthetic
`fr` with its tag and a two-key dictionary, then asserts `0` renders **singular**
(`0 joueur`), which the pre-#504 `n === 1` rule gets wrong.

It only holds if the consumer resolves the list **per call**. `routes/contact.js`
reads it inside the zod `preprocess` closure, so it does; a module-level
`const LOCALES = [...SUPPORTED_LOCALES]` copy taken at require time would refuse
the synthetic locale — which is itself the bug, correctly caught.

## 2. `i18n.js` must NOT redeclare what `locales.js` publishes

Both are classic `<script>`s over one shared global scope, so two top-level
`const SUPPORTED_LOCALES` declarations are a **SyntaxError that kills the entire
app at boot** — not a shadow, not a last-one-wins. So `i18n.js` dropped its own
declarations and only reads the globals, and `locales.js` is listed *before* it
in `index.html`. That is a load-order dependency of the kind
`.claude/rules/frontend-script-load-order.md` describes, except the failure is
total rather than local.

No Node test can see this: the suites load these files through `vm` sandboxes
they wire by hand, so a wrong `<script>` order stays green.
**Verify a change here in a real browser** — read `SUPPORTED_LOCALES`,
`LOCALE_TAGS`, `getLocale()` and one `tn()` call from `javascript_tool` and check
the console is clean. Clear the service worker first
(`.claude/rules/pwa-service-worker.md`); the shell is cache-first, so a stale
bundle will happily serve the old `i18n.js` alongside the new `locales.js` and
manufacture exactly the collision you are checking for.

## 3. `tn()` is a one/other pair, which is a real cap on which languages are addable

`Intl.PluralRules` returns CLDR categories (`zero`/`one`/`two`/`few`/`many`/
`other`), and `tn()` maps `one` → `keyOne` and **everything else** → `keyOther`.
That is exact for the latin-script languages in scope (fr, es, it, nl, pt) and
gains French and Portuguese the thing the old `n === 1` got wrong: both put **0
in the singular**.

It is *not* enough for Polish, Czech or Russian, which need `few`/`many` as
separate keys — those languages need new keys and a wider helper, not just a data
row, which is why they are excluded from #504's scope alongside their
latin-ext/Cyrillic font-subset problem. Don't "just add" one to `LOCALES` and
assume the plurals follow.

## Smaller things

- **`localeTag()` falls back to the English tag, never the raw code.** An unknown
  code reaching an `Intl` constructor throws a `RangeError`, which would take a
  whole screen down over a date label.
- **Codes stay two letters.** `detectLocale()` matches
  `navigator.language.slice(0, 2)`, so a region-tagged `pt-BR` would never be
  auto-detected. Region wording belongs *inside* the file (Brazilian Portuguese
  under `pt`), not in the code.
- **`lib/demo-seed.js`'s locale set is `DEMO_LOCALES`, deliberately a different
  thing** — which locales have seeded round/seat/tag text. A shipped UI locale
  may have no demo text yet and falls back to **English** (it fell back to German
  until #504: reasonable while German was one of two languages, and the
  "half-translated app" impression the per-locale seed exists to avoid once the
  list grows). It is named apart from `SUPPORTED_LOCALES` so the two cannot be
  required interchangeably.
- **`lib/providers/locales.js` is a THIRD list and stays a superset.** It answers
  "is this a language we recognise at all" for the storefront lookup, so a
  not-yet-shipped locale falls back to English rather than the deployment's
  German (`.claude/rules/storefront-lookup-locale.md`). Don't derive it from the
  shipped set — that would re-pin a French user to German store results.

**Related:** `.claude/rules/shared-constants-across-the-stack.md` (why
`routes/contact.js` requires out of `public/js/`),
`.claude/rules/frontend-helper-modules-and-coverage.md` (why `locales.js` is its
own file and the four places a new one must be wired into),
`.claude/rules/frontend-script-load-order.md`,
`.claude/rules/storefront-lookup-locale.md` (the provider-side locale, which is
independent of this one).
