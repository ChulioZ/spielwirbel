<!--
  The checklist mirrors CONTRIBUTING.md's pre-PR list — it is not a second,
  stricter gate. If the two ever disagree, CONTRIBUTING.md is the source of
  truth and this file is stale; please say so in the PR.
-->

## What and why

<!-- What changes, and what problem it solves. Link the issue: "Closes #42". -->

## Checks

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] `npm run check:syntax` passes
- [ ] `npm run coverage:ci` passes — **easy to forget, and it gates the merge**:
      branch protection requires the aggregate `ci-passed` check, which fails on
      a coverage drop even with every test green
- [ ] Tests added or updated for the change (when it's testable)
- [ ] New user-facing strings added to **every** `public/js/lang/*.js` — the
      shipped set is `public/js/locales.js` (key parity is enforced by a test)
- [ ] Docs updated in this PR for what the change touches — `docs/features.md`
      if it adds or renames a user-facing feature, `docs/architecture.md` if it
      alters the file tree (a test enforces that one), `docs/configuration.md`
      if it changes routes, scripts or env vars
      (`.claude/rules/keep-readme-current.md`)
- [ ] Every commit is signed off — `git commit -s` (Developer Certificate of
      Origin, checked by the `DCO` workflow)

## Anything else

<!--
  Screenshots for UI changes, migration notes, follow-ups you deliberately left
  out, or a rule under `.claude/rules/` you added or had to work around.
-->
