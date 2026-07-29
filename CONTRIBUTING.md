# Contributing

Thanks for your interest in improving this project. Contributions are welcome —
please read this file first, especially the **[Contribution licensing](#contribution-licensing)**
section, because opening a pull request means agreeing to those terms.

Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Where to start

Issues labelled
**[`good first issue`](https://github.com/ChulioZ/spielwirbel/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)**
are the ones scoped small enough to land without a tour of the whole codebase.
If nothing there appeals, anything in the
[open backlog](https://github.com/ChulioZ/spielwirbel/issues) is fair game —
comment on the issue first so two people don't build the same thing.

## How to contribute

This repository is built and maintained with
[Claude Code](https://claude.com/claude-code), and it ships the workflow with it:
**skills** in `.claude/skills/` and **rules** in `.claude/rules/` that encode how
work gets done here. Whether you contribute by prompting Claude Code or by hand,
that is the intended path — start there rather than improvising. The README's
[Contributing](README.md#contributing) section walks through the skill workflow;
`CLAUDE.md` states the constraints you must work within.

In short, before opening a PR:

- Branch off an up-to-date `main` (never commit on `main`); use a descriptive
  name like `feat/session-export` or `fix/vote-tie`.
- Read `CLAUDE.md` and skim the relevant `.claude/rules/` for the area you touch.
- Add or update tests for testable changes, and add any new user-facing string to
  **every** `public/js/lang/*.js` file (key parity is enforced by a test).
- Make `npm test`, `npm run lint`, `npm run check:syntax` and
  `npm run coverage:ci` all pass. The coverage one is easy to forget and it
  **gates the merge**: CI's required `ci-passed` check fails if line coverage
  drops below the floor, even with every test green.
- Update `README.md` in the same PR when the change adds or renames a user-facing
  feature, alters the file tree, or changes routes, scripts, or env vars.

## Translations

The UI ships German and English. **Correcting a translation is a one-line
change**: find the key in `public/js/lang/<code>.js`, fix the wording, open a PR.
Nothing else needs touching — the key already exists in every other language, and
`npm test` checks that the files stay in key parity.

**Adding a language** is a little more, and all of it is data:

1. Add a row to `public/js/locales.js` — the code (two letters, so the browser's
   system language matches it), the name in that language, and its BCP-47 tag.
2. Copy `public/js/lang/en.js` to `public/js/lang/<code>.js` and translate the
   values. Keep every key; the parity test will tell you if one is missing.
3. Register the file in `public/index.html` (next to the other `lang/` scripts),
   add it to `SHELL` in `public/sw.js`, and bump that file's `CACHE` version.

Plural forms, date and month formatting and the language picker all follow from
step 1 — there is no code to change. Translate the product vocabulary
consistently rather than literally, keep the brand name **Spielwirbel**
untranslated, and note that the legal pages (Impressum, privacy policy, terms)
are deliberately German-authoritative with an English courtesy translation and
are **not** part of the UI language files.

Native speakers are very welcome to correct wording — machine-drafted phrasing
that is merely *correct* is exactly what we would like replaced with phrasing
that sounds natural.

## Contribution licensing

This is the important part. The project is **distributed** under the
[PolyForm Noncommercial License 1.0.0](LICENSE) (© 2026 Julian Zenker, the sole
rights holder and licensor). That outbound license is deliberately noncommercial.

To keep the project able to offer a commercial tier in the future without having
to track down past contributors, **inbound contributions are licensed under a
permissive license, not under PolyForm-NC**. Concretely:

> By submitting a contribution (a pull request, patch, or any change) to this
> repository, you license your contribution to the project maintainer under the
> **[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0)**.

You keep the copyright to your contribution — this is a license grant, not an
assignment. The permissive Apache-2.0 grant lets the maintainer distribute your
contribution as part of the project under PolyForm-NC today and under commercial
terms later, which a plain "inbound = same as outbound" arrangement would block
(it would leave the maintainer with only a noncommercial license to your work).

If you cannot agree to this — for example because your employer owns your work
and has not authorized the grant — please do not open a pull request; reach out
to the maintainer first instead.

## Developer Certificate of Origin (sign-off)

Every commit must be **signed off** to certify you have the right to submit it
under the terms above. Add the sign-off automatically with:

```bash
git commit -s        # appends a "Signed-off-by: Your Name <email>" trailer
```

The `Signed-off-by` line certifies your agreement with the **Developer
Certificate of Origin 1.1** (below, also at <https://developercertificate.org/>):

```
Developer Certificate of Origin
Version 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

Sign off with a stable identity and a **reachable email** — your real name or a
consistent GitHub username is both fine; the email must be one that actually
reaches you and that matches the commit's author. Anonymous or throwaway-identity
contributions aren't accepted. (The DCO certifies your right to submit, not a
legal name, which is why a username is enough.) That's it — thanks for
contributing.
