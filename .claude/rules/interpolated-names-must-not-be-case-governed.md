---
paths:
  - "public/js/lang/*.js"
  - "public/js/views-member.js"
  - "lib/demo-seed.js"
---

# A `{name}` in a sentence must not sit after a preposition — the name can be a pronoun

#973's member page heading (PR #989) reads `'{n} Spiele von {name}'`, and the guest demo
seeds the account's own seat as **„Du"** (`lib/demo-seed.js:635`, one per locale:
`You` · `Tú` · `Toi` · `Tu` · `Jij` · `Você`). So the shipped public demo rendered

```
„4 Spiele von Du"      de — needs „dir"
"4 juegos de Tú"       es — needs "ti"
"4 giochi di Tu"       it — needs "te"
"4 spellen van Jij"    nl — needs "jou"
```

Four of the shipped languages, on the surface an anonymous visitor sees first
(#427). `en`, `fr` and `pt` were fine by luck: English marks no case there, and
« de toi » / "de você" already use the form a preposition governs.

## The rule

A member name is arbitrary user text — and in the demo it is deliberately a
**pronoun**, because „Du" is the right label for your own seat everywhere else it
appears („Es bewertet: Du", the avatar's title). Pronouns inflect where names do
not, so a key that interpolates one must not put it anywhere its form depends on
the surrounding words.

Write the name where it governs nothing — an apposition, not a prepositional
phrase:

```js
'member.ownedTitle': '{name}: {n} Spiele',      // de — reads for „Du" and for „Anna"
```

There is no single word to fix it from the other end: German needs „Du"
nominative and „dir" after `von`, so changing the seed's `ownerSeat` only moves
the error to the other site.

## Why no test guards this

The invariant is per-language grammar, so a check would need a table of
case-governing prepositions per locale — and `en`/`fr`/`pt` are *correct* with
their preposition, so a blunt ban would flag three right answers. That is
`.claude/rules/source-scanning-guards-enumerate-shapes.md`'s "banned word with an
allowed sense", with no cheap strip-first form available: the allowed sense is
the whole construction, not a phrase.

So it stays a translator-facing discipline, written here and at the interpolation
site in `public/js/views-member.js`. **When you add a key that takes `{name}`,
read it back with the demo's own seat word substituted** — that one substitution
is the whole check, and it is what nobody did for #989.

## Where this bites next

Any future `{name}` / `{member}` key, and any new locale whose grammar inflects
more than the shipped set does — Polish, Czech and Russian decline the noun itself, so
even an apposition needs care there (`.claude/rules/locale-set-is-data.md`
already flags those three for `tn()`'s one/other pair).

**Related:** `.claude/rules/locale-set-is-data.md` (the locale set and what adding
one costs), `.claude/rules/guest-demo-accounts.md` (why the demo's copy is a
public surface, not a fixture).
