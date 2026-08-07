---
paths:
  - "test/**"
  - "public/styles.css"
---

# Strip comments before matching selectors in a CSS-text test

Several tests assert against `public/styles.css` as a **string** rather than a
parsed stylesheet (`a11y-contrast.test.js`, `cover.test.js`, and since #324
`dock-footer-clearance.test.js`). That is the right tool at this size — but a
selector regex written the obvious way will silently match **inside a CSS
comment**, because a comment is brace-free text and every practical selector
pattern is built out of `[^{}]*`.

Concretely, a rule-matching regex like

```js
/(?:^|})\s*([^{}]*\.dock[^{}]*\.site-footer[^{}]*)\s*{([^}]*)}/m
```

happily spans a comment that merely *mentions* `.dock` in prose and then binds
to whatever unrelated rule opens next — in #324 that was the comment above the
fix plus the neighbouring `.site-footer__links {` selector.

**Why this is worse than a normal flaky regex:** the false match makes the test
pass against a stylesheet where the thing it guards has been **deleted**. Caught
only because the fix was removed on purpose to watch the probe fail (the
discipline `.claude/rules/break-the-code-on-purpose.md` prescribes) — one
assertion stayed green against the broken file. A test whose whole job is to
catch a silent visual regression, silently not catching it, is the worst
possible outcome.

**Rule:** strip comments first, then match:

```js
const CSS = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
```

Two follow-on habits from the same bug:

- **Tokenize into `[selector, body]` pairs once** and look rules up by exact
  selector, instead of writing a bespoke regex per assertion. One parse, no
  per-test escaping mistakes.
- **Match a class as a whole class.** `.site-footer` naively also matches
  `.site-footer__links` and `.site-footer__bgg`; this codebase's BEM-ish naming
  makes that collision the norm, not the exception. Use a trailing guard:
  `/\.site-footer(?![\w-])/`.

## In HTML strip too — in JS, assert UNIQUENESS instead (#637)

The trap is the *first match*, not CSS, so it follows the same regex into any
file read as text. Two of them were found matching source that is not CSS:

- **HTML — use the PARSER, do not strip.** `test/theme-color.test.js` read
  `index.html` for `<meta name="theme-color">`. The failure that hides is the
  nasty direction: a commented-out tag carrying the *right* value above a live
  tag that drifted, so the test passes while the app's mobile chrome is wrong.
  Measured — with the live tag at `#000000` under a commented-out `#c2410c`, the
  raw-text assertion was **green**.

  The obvious fix, `.replace(/<!--[\s\S]*?-->/g, '')`, works and **costs a
  high-severity CodeQL alert**: `js/incomplete-multi-character-sanitization`
  fires on it, in a *test file*, because one pass over `<!<!-- -->--` leaves
  `<!--` behind. That is a fair call on a sanitizer and irrelevant here — but it
  is a red `CodeQL` check and a HIGH entry on the security tab, which is too much
  noise to accept for a regex. `jsdom` is already a devDependency, so parse:

  ```js
  const tags = new JSDOM(html).window.document.querySelectorAll('meta[name="theme-color"]');
  ```

  A comment is not an element, so the mistake is unrepresentable, and it answers
  the question the test is actually asking — what the *browser* sees. Parse a
  bare `JSDOM` of the file rather than reusing the harness's document, or the
  assertion stops being about the markup and starts including whatever the
  scripts did to the tag after load.

  **The second HTML instance detonated for real (#525).** `test/landing-copy.test.js`
  extracted the static hero with `/<main id="app"[\s\S]*?<\/main>/`, and #525's
  `<noscript>` ships a comment explaining *why* it sits outside `<main
  id="app">` — so the block began inside that comment, several lines early, and
  swallowed the demo and terms banners. Their `<button>`s failed
  `doesNotMatch(main[0], /<button/)` against markup that was entirely correct.

  Two things generalise. **A block-extraction regex is the dangerous shape, not
  the leaf assertion**: `test/seo.test.js` matches the same `<main>` and was
  unharmed, because its inner assertions are element-scoped `[^<]*` patterns that
  a comment cannot satisfy — which is the defence its own comment claims. And
  **this one failed loudly rather than silently**, the opposite of the
  `theme-color` case above: correct source, red test. That is the *lucky*
  direction and not a reason to leave the shape in place — the identical regex
  goes green over a hero that has genuinely regressed the moment a comment
  further up the file happens to name the tag.

  **Reading this rule is not enough to avoid it — the same PR did both halves.**
  #525 fixed `landing-copy.test.js` with the parser exactly as prescribed above,
  and in the same commit shipped `.replace(/<!--[\s\S]*?-->/g, '')` in the new
  `test/noscript.test.js`, which reddened `CodeQL` on PR #689 with the predicted
  HIGH `js/incomplete-multi-character-sanitization`. The strip is what you reach
  for once the comment trap has bitten, so the two failures arrive in that order
  and the second feels like the fix for the first. **Reach for `JSDOM` directly
  when a test needs a region of HTML** — never the strip, not even as a step on
  the way. It costs one `require` and there is no third option.

  Bonus, for a spec about markup a JS-off browser renders: jsdom runs no
  scripts, so its parser builds `<noscript>` contents as real **elements** —
  where a scripting-enabled browser stores them as a single text node. Parsing
  therefore gives you the exact DOM under test rather than a string to match.
- **JS — do NOT strip, the remedy is wrong here.** `test/faq.test.js`
  (`LANDING_REPO_URL`) and `test/phone-width-overflow.test.js` (`MOODS`) match
  declarations out of `public/js/*.js`. A line-comment strip would eat the `//`
  in `'https://github.com/…'`, i.e. destroy the value being read — the fix
  breaking the test worse than the bug. Match with a **global** regex and assert
  exactly one hit instead:

  ```js
  const found = [...src.matchAll(/const LANDING_REPO_URL = '([^']+)'/g)];
  assert.equal(found.length, 1, `declared ${found.length} times, expected 1`);
  ```

  It is strictly stronger than stripping: a second *live* declaration is caught
  too, and there is no parser to get wrong. Prefer it wherever the value cannot
  legally repeat.

And always break the production code on purpose once to confirm the assertion
actually goes red — a CSS-text test gives you no other signal that it is wired
to anything real.

**Back the files up before that loop — not with `git checkout`.** The obvious
"revert my deliberate break" is `git checkout <file>`, and it restores from the
**index**: with nothing staged, that is the HEAD version, so it silently discards
the *whole* uncommitted fix along with the break. It cost a full re-implementation
of #424's three source files, and the tell is easy to misread — the suite reports
*more* failures than the one you engineered, which looks like a cascade rather
than a wiped working tree. Copy the files to the scratchpad first (or `git stash`
/ commit before breaking), and revert from that copy.
