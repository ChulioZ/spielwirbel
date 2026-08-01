# A red `gitleaks` check can be a transient license-probe flake, not a leaked secret

<!-- scope: global — a CI situation — a red check with no diff to explain it -->

<!-- scope: global — a CI situation — a red check with no diff to explain it -->

`gitleaks/gitleaks-action@v3` (the `gitleaks` required check, `.github/workflows/`)
is **free for personal-account repos**, and it decides "personal vs org" at
runtime by calling `https://api.github.com/users/<owner>`. When that probe hits a
transient network error, the action does **not** fail open — it defaults to
*enforcing* license-key validation and then fails because no `GITLEAKS_LICENSE`
secret is set:

```
##[warning]Get user [ChulioZ] failed with error [HttpError: ... socket hang up]. License key validation will be enforced 🤷.
##[error]🛑 missing gitleaks license. Go grab one at gitleaks.io ...
```

So a **red `gitleaks` check with no secret-scanning output at all** is almost
certainly this flake, not a real finding. The tell: the log shows the `Get user`
`socket hang up` / license-enforcement message instead of any `Finding:` /
leak report. It is independent of the diff — it flaked once on a Dependabot
**lockfile-only** bump (#378) that had passed `gitleaks` on its own earlier run,
while the six sibling bumps in the same sweep all passed.

**Fix: just re-run the job** — the retried `Get user` call succeeds, confirms the
free personal tier, and the scan passes:

```bash
gh run rerun <gitleaks-run-id> --failed
```

Don't hunt for a leaked credential, and don't `blocked`-label the PR, on a
`gitleaks` red until you've read the log and ruled this out. A genuine finding
prints the offending file/rule; this flake prints the license message and nothing
about the code.

**Why the confusion is costly:** on a dependency bump the reflex is "did the new
package smuggle a secret / did the regenerated lockfile trip a scanner?" — so the
red check is read as a security signal when it is really an `api.github.com`
hiccup. Discovered clearing the 2026-07-24 Dependabot sweep (all 7 merged).
