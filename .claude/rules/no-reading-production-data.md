# Never read the production data directory

The `data/` folder (default location, or wherever `DATA_DIR` points for a live
instance) holds the group's **real, private** data: `data/data.json` (rounds,
sessions, members, ratings) and `data/uploads/` (cover images). It is gitignored
precisely because it must never leave this machine.

**Rule:** agents must **not** read, open, cat, grep, copy, or otherwise inspect
the contents of the production `data/` directory — including `data/data.json`
and `data/uploads/`. Treat it as strictly off-limits. Do not paste its contents
into responses, commits, logs, or anywhere else.

- You may reference the data **schema/shape** from code (`lib/store.js`,
  `lib/routes/*.js`, tests) — never from the live file.
- When you need real-looking data to develop or test against, **generate your
  own** in an isolated `DATA_DIR` temp folder — see the `test-data` skill and
  `automated-tests.md`. Never copy the production file.
- Structural, non-content operations that don't reveal data are fine when needed
  (e.g. checking whether a server is running, confirming the folder exists). If a
  task seems to *require* reading the real data, stop and ask the user instead.

**Running the app for browser/preview verification counts too — never against
the real data.** A bare `npm start` (and the `production-data`
`.claude/launch.json` config) uses the production `data/`, so a screenshot,
`read_page`, `get_page_text`, or console/network dump of that running app
**renders the group's real rounds, members and ratings into the transcript** —
the same leak as reading the file, just laundered through the UI. So when you
launch the app to *see a change work* (preview tools, the `run` skill,
a manual `curl`):

- **Use the committed `dev-temp-data` launch config** — `preview_start {name:
  "dev-temp-data"}`. It runs on port 3100 against a gitignored `.devdata/`
  folder (created on first start), with accounts and the admin panel enabled so
  those surfaces are reachable rather than 404. Seed it with your own generated
  data (`test-data` skill). It is the **first** entry in `launch.json` on
  purpose — see below.
- Equivalently by hand: `DATA_DIR=$(mktemp -d) npm start` — never the default.
  Anything else that would use the real `data/` must get `DATA_DIR` overridden
  to a temp folder first.
- **Never point the Browser pane at the `production-data` config.** It exists
  for the rare case of reproducing something in the user's own data at their
  explicit request (see the last bullet of this section); it is named that way
  so choosing it is a conscious act.
- Only the empty/generated dataset should ever appear in a screenshot or page
  read. If you realize you've already captured real data, say so to the user and
  don't repeat it.
- Verifying against real data is only acceptable if the user explicitly asks you
  to reproduce something in *their* data — then keep it in the running UI and
  don't paste its contents.

## `launch.json` must keep MORE THAN ONE entry — a lone config is a silent fallback

Verified 2026-07-25, and it is the reason `dev-temp-data` is committed rather
than added-and-reverted per session:

- With **two or more** configurations, `preview_start {name: "typo"}` **fails
  loudly**, listing the valid names. Nothing starts.
- With **exactly one** configuration, a name that doesn't match is **silently
  ignored and that single config starts anyway** — the result even reports the
  config's own name back, so it looks like it did what you asked.

That is how a session asking for its own throwaway config got the production one
instead: the throwaway entry had already been reverted, leaving `launch.json`
with a single production entry, and the mistyped name fell through to it. The
old advice here — "add a throwaway config and revert it" — *created* that state
at the exact moment a session was most likely to re-launch.

So: **do not reduce `launch.json` to a single configuration**, and prefer the
committed `dev-temp-data` entry over a per-session throwaway. If you do add a
temporary entry, removing it afterwards must not leave only `production-data`
behind.

**Why:** it is private user data with no authentication guarding it; the
whole point of keeping it out of git is that it stays local and unseen. An agent
reading it — **or screenshotting the running app that's serving it** — and
echoing that into a transcript, screenshot, or commit would leak it. The app
never needs the real data to prove a code change works: a generated dataset in a
temp `DATA_DIR` exercises every view, and the schema is fully described by the
code and tests.
