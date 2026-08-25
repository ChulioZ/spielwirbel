---
paths:
  - "public/js/locales.js"
  - "public/js/i18n.js"
  - "public/js/lang/**"
  - "lib/routes/contact.js"
  - "test/i18n-locales.test.js"
  - "test/demo.test.js"
  - "lib/demo-seed.js"
  - "test/support/dom.js"
---
# The locale set is data (#504) — and a test over it is VACUOUS at two locales

`public/js/locales.js` holds one row per shipped UI language (code, native label,
BCP-47 tag). Everything else derives from it: the picker, `Intl.PluralRules` in
`tn()`, `fmtDateTime`/`fmtMonth`, and the feedback-metadata allowlist in
`lib/routes/contact.js`. Adding a language is that row plus a `lang/<code>.js` file,
wired into `index.html`, `sw.js`'s `SHELL` and a `CACHE` bump — **and a set of
three landing screenshots for the new locale** (#457), which
`test/landing-shots.test.js` requires for every `SUPPORTED_LOCALES` entry. That
last step is the one this checklist used to omit: skip it and the suite goes red
pointing at a missing `.webp`, with nothing saying that shooting it is a manual
job (`.claude/rules/landing-product-screenshots.md` is the recipe).

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
SUPPORTED_LOCALES.push('zx');           // lib/routes/contact.js resolves it per request
try { /* assert the route now accepts 'zx' */ } finally { SUPPORTED_LOCALES.pop(); }
```

That works because the `const` bindings hold a **mutable array and plain
objects** — `const` freezes the binding, not the value — so a test (or a vm
sandbox) can add a locale without touching the file. `test/i18n-locales.test.js`
uses the same move to prove the plural and date paths: it pushes a synthetic
locale carrying the **French** tag `fr-FR` plus a two-key dictionary, then
asserts `0` renders **singular** (`0 joueur`), which the pre-#504 `n === 1` rule
gets wrong.

**The synthetic code must be one the app does NOT ship, and shipping a language
silently takes that away.** Those three tests pushed `'fr'` until French shipped
(#534) — from that day the push duplicated a real row and the two-key dictionary
**overwrote the real 1,029-key one** in the sandbox, so a test named "registered
at runtime" registered nothing. Nothing goes red; the assertions pass for the
wrong reason, and they are the ones guarding locale-count-agnosticism — §1's trap
re-entering through the fix for §1. They now use `'zx'` (unassigned in ISO 639-1)
with the `fr-FR` **tag**, so French plurals and months stay under test while the
registration stays synthetic. **Grep the suite for a language's code before
writing its lang file.**

It only holds if the consumer resolves the list **per call**. `lib/routes/contact.js`
reads it inside the zod `preprocess` closure, so it does; a module-level
`const LOCALES = [...SUPPORTED_LOCALES]` copy taken at require time would refuse
the synthetic locale — which is itself the bug, correctly caught.

**It is not only the locale-registering tests — #536 found a second site, and a
narrow grep misses it.** `test/demo.test.js` stood in for "a UI locale that has
no demo text yet" with `'it'`, and named Italian and Dutch in its comment as the
examples. Shipping Italian made `textFor('it')` return the Italian seed, so the
assertion named *falls back to English* asserted the opposite. Here it went
**red**, which is the lucky direction — the `'fr'` case above went silently green
— but the cause is one step more general than §1 states: **any** test using a
real language code to mean "unshipped" is armed, whether or not it registers a
locale. Stand in with `'zx'`, never with a code some open issue is about to ship.

The grep is the part that needs care. `grep "locale.*'it'"` finds nothing here,
because the call is `seed.textFor('it')` — search for the **bare quoted code**
across `test/` and read the hits:

```bash
grep -rn "'it'" test/ lib/ public/js/ scripts/
```

**The synthetic locale does not reach a copy in the TEST HARNESS, and that is
where one was hiding** (#535). `loadI18n()` in `test/support/dom.js` listed
`['lang/en.js', 'lang/de.js']` by hand while its sibling `loadApp()` parses the
script tags out of `index.html` — so the moment a third language shipped, one
half of the harness knew about it and the other did not, and every spec
comparing a rendered view against `translator(locale)` read a Spanish DOM
against an English `t()`. It presents as a broken view, not as a stale fixture.
Derive the lang files from `SUPPORTED_LOCALES` there too.

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

### The sandbox's `I18N` is NOT the one the lang tables register into

Worth knowing before writing another spec against `loadI18n()`: `i18n.js` declares
`const I18N = {}`, and a **`const` in a script run through `vm.runInContext` is a
lexical binding that never lands on the context object**. So the `I18N: {}` seeded
into the sandbox stays empty forever, while the lang files register into the
lexical one. Reading a dictionary from the *outside* —

```js
ctx.I18N.en['app.tabTitle']        // undefined -> TypeError
vm.runInContext("I18N['en']['app.tabTitle']", ctx)   // the real table
```

— is the difference between a spec and a `Cannot read properties of undefined`
that reads like the lang file failed to load. (The existing tests never hit it
because they mutate `I18N` from *inside* `vm.runInContext`, where the name
resolves correctly, and otherwise go through `ctx.t()`.) Note `let locale` has the
same property, while the `function` declarations — `setLocale`, `tn`, `initLocale`
— *are* exposed, which is why `ctx.setLocale(...)` works and hides the asymmetry.

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
  required interchangeably. Two *other* sites still fell back to German until
  #822 — `.claude/rules/not-english-is-not-german.md` generalises the direction.
- **There used to be a THIRD list**, a locale table under `lib/providers/`
  answering "is this a language we recognise at all", which went with those
  providers in #744 (BGG takes no locale). If a localizing provider is ever
  added, give it its own superset again — deriving one from the shipped set
  would re-pin a French user to German store results.

**Related:** `.claude/rules/shared-constants-across-the-stack.md` (why
`lib/routes/contact.js` requires out of `public/js/`),
`.claude/rules/frontend-helper-modules-and-coverage.md` (why `locales.js` is its
own file and the four places a new one must be wired into),
`.claude/rules/frontend-script-load-order.md`,
`.claude/rules/allowlist-request-values-that-reach-a-url.md` (the allowlist shape any
provider-side locale mapping has to follow — a different list from this one).
