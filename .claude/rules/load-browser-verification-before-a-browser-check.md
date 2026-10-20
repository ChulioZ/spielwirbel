# Load the `browser-verification` skill before any browser check

<!-- scope: global — the trap surfaces through a verification tool (the Browser pane, headless Chrome or Playwright, the WebKit probe), not through editing any file -->

Before you verify anything in a browser — the Browser pane, headless Chrome over
CDP, headless Playwright or the WKWebView probe — invoke the
**`browser-verification`** skill (`.claude/skills/browser-verification/SKILL.md`).
Those instruments misreport in ways that look exactly like app bugs (blank
captures, swallowed Escape, no blur events, dead observers, a Chromium-only
engine), and the skill maps each symptom to the probe that tells them apart.

**Why a skill and not rules:** the nine write-ups used to be global rules, about
a fifth of what every session loaded, including sessions that never open a
browser (#1551). They stay global in *trigger* — no file path can predict a
browser check — so only this pointer loads always.
