# The Browser pane cannot hyphenate — `hyphens: auto` looks broken there and works everywhere else

<!-- scope: global — the trap surfaces through the Browser pane, not through editing a file -->

Found verifying the Tisch rail's round name (#1197): with
`overflow-wrap: break-word; hyphens: auto` on a `lang="de"` page, the pane split
„Donnerstagsrund / e" with no hyphen, i.e. exactly the mid-word break the rule
was added to prevent. `getComputedStyle` reported `hyphens: auto`, so the rule
was applying; the pane simply has **no hyphenation dictionaries** and
`break-word` took over.

Real engines do hyphenate. The same minimal page (a 221px `<h1>`,
„Donnerstagsspielerunde", with and without `hyphens`) gave:

| Engine | with `hyphens: auto` | control, `break-word` only |
|---|---|---|
| Browser pane | mid-word split | mid-word split |
| Google Chrome, headless | „Donnerstags- / spielerunde" | „Donnerstagssp / ielerunde" |
| WebKit (WKWebView probe) | „Donnerstags- / spielerunde" | „Donnerstagsspi / elerunde" |

**Rule:** judge hyphenation in real Chrome (`--headless=new --screenshot`) or
WebKit (the probe in `.claude/rules/browser-pane-is-chromium-only.md`), never in
the pane, and run the control without `hyphens` beside it. Hyphenation also
needs `<html lang>`, which `public/js/i18n.js` keeps on the active locale.

**WebKit's Range rects lie at a hyphen break.** Grouping characters by
`getBoundingClientRect().top` reported line 1 as „Donnerstagss": the first
character after the break came back at `left 0, top 0` with a 193px width. The
character before the break was 27px wide because it carries the hyphen glyph.
Read per-character left, top and width around the break before trusting a
line split measured this way (`.claude/rules/measure-text-ink-not-its-box.md`
has the grouping recipe).

**Related:** `.claude/rules/browser-pane-is-chromium-only.md`,
`.claude/rules/preview-pane-paint-artifacts.md` (the pane's other falsehoods).
