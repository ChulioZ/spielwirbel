---
paths:
  - "public/js/pages/kontakt.js"
  - "public/js/account.js"
  - "public/js/news.js"
  - "public/js/i18n.js"
  - "public/js/locales.js"
  - "lib/demo-seed.js"
  - "lib/legal.js"
---
# When one language must be picked, branch on `de` — never on `en` (#822)

The natural way to write a two-language selection here is the wrong way round:

```js
getLocale() === 'en' ? englishThing : germanThing   // "not English" -> German
```

It reads as correct because the app ships exactly two languages *today*, so the
two branches are exhaustive and every test passes. It is already wrong for a
visitor whose system language is French, Spanish or Italian — they are handed
German — and it silently mis-serves every locale of #534–#538 the moment one
lands. Nothing errors, nothing 400s, no screen is blank: the reader simply gets
prose they cannot read, which is indistinguishable from the feature working.

**The rule:** German is the *exception*, English is the fallback. Test for `de`
and let everything else fall through.

```js
getLocale() === 'de' ? germanThing : englishThing
```

Two sites had it backwards until #822 — `resolveLang()` on `kontakt.html` (which
additionally discarded a saved `fr`/`es`/`it` choice via a
`saved === 'de' || saved === 'en'` guard) and the terms-notice anchor in
`setupTermsBanner()`.

**"The German text is authoritative" is not a counter-argument**, and it is the
reasoning that produced both bugs. Which version *governs* is a legal fact about
the document; which version a *reader is shown* is a comprehension question, and
a German paragraph nobody in the room can read governs nothing. `public/js/news.js`
already draws that line explicitly — legal text whose German version is
authoritative stays German, product copy and UI fall back to English.

**Not every language conditional is a selection.** `lib/faq.js`, `lib/legal.js`
and `lib/notify.js` render German *and* English in one document, taking `lang`
as a literal argument per half. There is no reader-facing choice there to get
wrong — leave them alone. The trap is only where a locale resolves to **one**
of two outputs.

**Related:** `.claude/rules/locale-set-is-data.md` (the shipped-locale list this
falls off the end of, and why a loop over it proves nothing at two locales),
`test/locale-fallback.test.js` (both sites, taken red first).
