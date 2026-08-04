---
paths:
  - "public/js/core.js"
  - "public/js/views-*.js"
  - "public/js/round-rail.js"
  - "public/styles.css"
  - "test/back-control.test.js"
---

# Persistent chrome defines the main pages — everything else gets ONE back control, at the top, at every width

A new screen has to answer "does this get a back control?", and the answer is not
a judgement call:

> **Main pages are the ones reachable from chrome the user always has.** The
> brand mark → `/`, the inbox button → `/inbox`, the account menu → `/freunde`
> and `/konto`, the dock/rail → the four round sections. Those get **no** back
> control. **Everything else gets exactly one, as the first element of the
> content column, at every viewport width.**

`backRow(fallback)` (`public/js/core.js`) is the control;
`test/back-control.test.js` renders every screen and pins both halves, so a new
non-main screen that forgets one fails the suite rather than shipping a dead end.

## Why "the rail covers it" is wrong, which is what shipped for four releases

The rail looks like it makes a back control redundant — it carries every section
one click away — so `.app .back-row { display: none }` sat in the ≥1280px block
from #343 until #623. It is wrong because **the rail is "up" and a back control
is "back"**, and those differ for every screen with more than one origin:

| Screen | Reachable from | The rail sends you to |
|---|---|---|
| Game detail | Regal, Chronik, Pokale, session results, in-progress ticket | **Regal**, always |
| Member detail | Start hero avatars, rail avatars, results podium | **Start** |
| Session results | Chronik, finishing a session, a shared link | **Chronik** |

`HUB_TAB_OF` (`public/js/views-round.js`) maps each sub-screen to exactly **one**
owning section, which is correct for what it is for (marking the active tab) and
cannot stand in for history. So opening a game from Pokale and clicking Regal is
not a heavier way back — it is a **different, usually wrong destination**, and
the app offered no control that returned you where you came from.

**Below 860px it is worse than redundant-looking, it is the only navigation
there is**: `.dock--sub { display: none }` hides the hub dock on round
sub-screens, and the rail only exists from 1280px. A phone user on a game detail
has zero navigation chrome.

## No width branch, deliberately

The archives and Einstellungen have their own rail entries, so they are the
tempting exception — "hide it there, where the rail really does reach it". They
keep the control at every width anyway (operator decision, 2026-08-03): the rail
row is still "up", and if you opened Einstellungen from Chronik only *back*
returns you to Chronik. One rule is cheaper to hold than a per-screen table, the
affordance should not change per device, and **this stylesheet has twice had a
width-branched hide fail silently** — `.rail-owned` on specificity, `.dock` on
source order (`.claude/rules/responsive-content-width.md`).

## Two placement constraints that are not cosmetic

- **Top of the content column, not the top bar.** The top bar already carries the
  brand, the context label, the language picker, feedback, support and the
  account button, and has documented overflow trouble at narrow widths. Top of
  content is also where the user arrives.
- **After `renderSubScreenTabs(…)`, which PREPENDS.** `renderHubTabs` does
  `app.prepend(dock)` then `app.prepend(rail)`, so a `backRow` appended straight
  after it becomes the first *content* child while the navigation stays ahead of
  it in the DOM. That is why the test looks for "the first child that is not
  `.rail`/`.dock`" rather than `app.firstChild` — the same assertion then covers
  `/round/new` and `/u/:username`, which render no navigation at all.

## `.back-row` is a dedicated class, and that is load-bearing

A control that matters needs a wrapper only it uses. The results screen's
„Session löschen" used to sit in a **byte-identical** `.section.center` wrapper,
so any rule written against that generic spelling would take a destructive action
off one screen, silently — no error, nothing in the DOM to suggest a control is
missing. `test/content-width.test.js` guards that even though nothing hides
`.back-row` any more, because the trap belongs to the wrapper, not to the back
control.

**#614 moved that wrapper**, and the move is the rule rather than an exception to
it: the session-cancel control joined the delete in a dedicated
`.section.result-footer` row, and `class="section center"` now appears **nowhere**
in `public/js`. So the destructive action finally has its own class, exactly like
`.back-row` — and the guard in `content-width.test.js` is retargeted at
`.result-footer`.

**Its anti-vacuous floor had to change with it, and that is the transferable
part.** The floor asserted that the stylesheet still *declares* `.section` and
`.center`. Both are still declared, for other rules — so when the last screen
using the wrapper stopped using it, the guard went on passing while watching
nothing at all. A floor over a **CSS declaration** cannot see a **view** that
walked away from it; assert against the file that renders the wrapper.

## The branch a `backRow` on the happy path misses

`showProfile` renders an early `user_not_found` screen before its main body. A
typo'd URL is the likeliest way to reach a profile at all, so that branch is the
one that most needs a way out — and it is invisible to a control added further
down. Check a view's early returns before assuming one call site covers it.

**Related:** `.claude/rules/scroll-reset-on-forward-navigation.md` (shipped with
this and the reason it is usable — you arrive at the top rather than part-way
down), `.claude/rules/responsive-hub-tabs.md` (the dock/rail presentations and
`HUB_TAB_OF`), `.claude/rules/responsive-content-width.md` (why navigation moved
out of the content column, and the silent-hide traps),
`.claude/rules/native-button-vs-focusable-span.md` (why the control is a real
`<button>`: it triggers a history action, not a destination),
`.claude/rules/testing-views-under-jsdom.md` (how the coverage test renders every
screen).
