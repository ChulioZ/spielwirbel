---
paths:
  - "public/styles.css"
  - "public/js/lang/**"
  - "public/js/locales.js"
---
# Korean wraps per SYLLABLE, and the fix has a wrong obvious value (#1047)

Hangul carries no inter-word break opportunities of its own, so a browser may
end a line in the middle of a word. In running prose that is merely unusual; in
a chip, a pill, a tab or a button label it reads as a typo. One rule on the root
fixes it for every surface at once, because both properties inherit:

```css
:lang(ko) { word-break: keep-all; overflow-wrap: break-word; }
```

`:lang(ko)` matches the bare `ko` that `setLocale` writes onto `<html>`
(`public/js/i18n.js`) — never write `:lang(ko-KR)`, which would match nothing.
It is the stylesheet's only `:lang()` rule, and `test/hangul-line-breaking.test.js`
asserts that, so a second one arrives as a red test rather than as a quiet
divergence.

## `break-word`, NOT `anywhere` — and this is the whole cost of getting it wrong

The issue specified `overflow-wrap: anywhere`, and that is also the value the
rest of this sheet uses (eight sites, all user-authored titles). It is wrong
here, and the reason is intrinsic sizing rather than wrapping: **only `anywhere`
counts toward a box's min-content size**, so it lowers the `min-width: auto`
floor of every flex item to a single syllable — and a flex item may then shrink
below its own word, because it now can.

Measured at 390px on the bottom dock, whose four labels are 시작 / 선반 / 기록 /
트로피:

| `overflow-wrap` | „트로피" label | dock width |
|---|---|---|
| `anywhere` | 26.7 × **32px** — two lines | 250px |
| `break-word` | 31.1 × **16px** — one line | 263px |

The dock had 127px of viewport to spare either way. The symptom is therefore
*maximally* misleading: it looks like a label that is too long for its box, and
the box is not full.

The escape hatch still works, which is the control that makes `break-word` the
right answer rather than merely the quieter one. In a 60px box with a
nine-syllable word:

| | width | box height | overhang |
|---|---|---|---|
| `keep-all` alone | 109px | 16px | **+49px** |
| `keep-all` + `break-word` | 48.5px | 48px | none |

So `keep-all` on its own is not shippable — it removes the syllable breaks and
puts nothing in their place — and `break-word` restores exactly the breaking
that a too-narrow box needs, with none of `anywhere`'s sizing side effect.

Both tables come from a headless Chrome probe over a synthetic page that
`<link>`s the real `public/styles.css`, the shape
`.claude/rules/browser-pane-is-chromium-only.md` describes. Re-measure the same
way if this rule is ever retuned; jsdom applies no external stylesheet, so no
view spec can see any of it.

## No Hangul webfont — the system face carries it, deliberately

Every `@font-face` in this sheet is a **latin subset** (Nunito's four weights
are 64 KB together; the largest display face is 38 KB). Korean therefore falls
through the stack to `-apple-system` / `Segoe UI` / `Roboto` / `sans-serif`,
which resolve to Apple SD Gothic Neo, Malgun Gothic and Noto Sans CJK KR — a
good Hangul face on every platform the app targets.

Shipping one is not a near-miss decision: a single Noto Sans KR weight is around
a megabyte, against ~16 KB for a Latin weight, and the app uses four body
weights plus several display faces. That is multiple MB downloaded by everyone to
serve one locale, for a face the reader's own device already has.

The visible consequence is that a **design's Latin display face does not apply to
Korean** — `--font-display` falls back per glyph, so Der Tisch's Bricolage
headings render in the system face under `ko` (the round worlds, retired at
#1202, behaved the same). Checked at 390px: it reads as intended rather than as a
bug. Don't "fix" it by adding a CJK webfont.

## The particle convention: „을(를)", „이(가)", „은(는)"

Korean postpositions inflect on whether the preceding syllable ends in a
consonant, and an interpolated `{title}` / `{name}` is not known at translation
time. `lang/ko.js` therefore uses the paired form throughout — „{title}"을(를)
정리할까요? — which is the standard convention in Korean software and is applied
**consistently**: mixing it with a guessed single particle is what reads as a
bug.

It is a deliberate trade, not an oversight: the alternative that removes the
parentheses is to append the honorific 님 (always consonant-final, so the
particle becomes determinate), and that cannot be used for the non-person
fallbacks the same templates take — `log.someone` („누군가") would become
„누군가님이". Rewriting every affected key into a particle-free shape would
change the register of the whole file for one punctuation mark.

**Related:** `.claude/rules/locale-set-is-data.md` (what adding a language
costs, and why `tn()` bounds which languages are addable at all),
`.claude/rules/landing-product-screenshots.md` §3b (the per-locale seed — Korean
is the first locale to override the seat names, because a seat name is read back
out as an avatar), `.claude/rules/css-text-assertions-strip-comments.md` (how
the guarding spec parses the sheet).
