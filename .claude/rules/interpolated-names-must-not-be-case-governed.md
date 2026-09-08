---
paths:
  - "lib/demo-seed.js"
  - "public/js/lang/*.js"
  - "public/js/views-member.js"
---

# A display name gets interpolated into sentences — so never seed one as a PRONOUN

The guest demo used to seat the visitor's own place as „Du" (`You` · `Tú` ·
`Toi` · `Tu` · `Jij` · `Você`). It reads perfectly everywhere a name stands alone
— the avatar's title, „Es bewertet: Du", „Du und Ben haben gewonnen" — and then
#973's member heading put it after a preposition:

```
„4 Spiele von Du"      de — needs „dir"
"4 juegos de Tú"       es — needs "ti"
"4 giochi di Tu"       it — needs "te"
"4 spellen van Jij"    nl — needs "jou"
```

Four languages at once, on the public demo — the surface an anonymous visitor
sees first (#427). `en`, `fr` and `pt` were fine by luck: English marks no case
there, and « de toi » / "de você" already use the form a preposition governs.

## The rule

**A seeded or generated display name is an ordinary name.** A pronoun inflects
where a name does not, and there is no single form that is right in both
positions — German needs „Du" nominative and „dir" after `von` — so the name is
the end that has to give, not the sentence. `lib/demo-seed.js`'s `ownerSeat` is
now `Max` / `Marta` / `Manon` / `Paolo` / `Roos` / `Miguel`.

Two things to keep when changing one:

- **Distinct two-letter initials** from every member and guest of that locale's
  rounds — the avatar circles render initials, and a clash reads as one person
  appearing twice (the same reasoning the `guests` note gives).
- **A name that reads naturally in that language**, per the existing `DEMO_TEXT`
  note; a German round full of Italian names is the half-translated impression
  the demo exists to avoid.

## Why the fix went here and not into the sentence

The obvious repair is to rephrase the four keys as an apposition
(„{name}: {n} Spiele"). It works, and it was rejected: it changes the wording of
a shipped heading in four languages to accommodate one seeded value, and it
leaves the trap armed for the *next* key that takes `{name}` — of which there
will be more. Fixing the value fixes every sentence at once, including the ones
not written yet.

The corollary still binds the other end, though: **if a name ever legitimately
IS a pronoun** — a user is free to name a member seat „Du" — the sentence is
what breaks, and no test can see it. That is a cosmetic defect in one round's own
data rather than a shipped one, which is the reason this is filed as "don't seed
a pronoun" rather than "never use a preposition".

## Why no test guards it

The invariant is per-language grammar, so a check would need a table of
case-governing prepositions per locale — and `en`, `fr` and `pt` are *correct*
with theirs, so a blunt ban flags three right answers. That is
`.claude/rules/source-scanning-guards-enumerate-shapes.md`'s "banned word with an
allowed sense", with no cheap strip-first form: the allowed sense is the whole
construction. What *is* pinned is the value — `test/seed-dev.test.js` asserts the
English seat is `Max`, so restoring „You" goes red.

**Related:** `.claude/rules/locale-set-is-data.md` (the locale set and what adding
one costs), `.claude/rules/guest-demo-accounts.md` (why the demo's copy is a
public surface, not a fixture).
