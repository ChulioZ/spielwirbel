'use strict';

/* The contributor-facing files under `.github/` must route a reader to the
   `docs/` file that holds the material, never to `README.md`.

   On 2026-07-30 the README stopped being the reference manual and became a
   ~130-line landing page, with its content split into `docs/features.md`,
   `docs/architecture.md` and `docs/configuration.md`
   (`.claude/rules/keep-readme-current.md`). Every pointer into the old README
   survived that move intact and still *read* correctly — which is the whole
   problem: "see the README" is never wrong-looking, it just sends someone to a
   page that no longer contains the answer.

   Three had rotted by the 2026-08-04 claude-file audit, and the third was found
   only while fixing the first two (#635):

   - `PULL_REQUEST_TEMPLATE.md` told every contributor to update `README.md` for
     features, the file tree, routes, scripts and env vars — contradicting
     `CONTRIBUTING.md`, which the template's own header declares authoritative.
   - `ISSUE_TEMPLATE/bug_report.yml` sent bug reporters to the README for the
     `ACCOUNTS_ENABLED`/`AUTH_PASSWORD` explanation.
   - `FUNDING.yml` cited "README's 'Support link' paragraph", which does not
     exist in the README at all any more.

   Nothing could catch these: no test reads `.github/`, and the three files are
   nobody's idea of code. So this is the mechanized version — fixing the
   instances without it just resets the clock on the same class.

   Deliberately a blanket ban rather than a check that the README still contains
   the cited text. The README's job now is to route onward, so pointing a
   contributor at it *for something specific* is the defect regardless of what
   it currently happens to say. Naming the `docs/` file is always available and
   always more precise. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GH = path.join(ROOT, '.github');

/* Contributor-facing files only: everything directly under `.github/` plus the
   issue forms. `workflows/` is excluded — it is CI configuration that routes no
   human to documentation, so a README mention there would be a different (and
   not obviously wrong) thing. */
const routedFiles = () => {
  const entries = [
    ...fs.readdirSync(GH, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join('.github', e.name)),
    ...fs.readdirSync(path.join(GH, 'ISSUE_TEMPLATE'), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join('.github', 'ISSUE_TEMPLATE', e.name)),
  ];
  // Anti-vacuous floor: an empty or near-empty sweep must fail loudly rather
  // than pass by scanning nothing (a rename of ISSUE_TEMPLATE/ would do it).
  assert.ok(entries.length >= 4,
    `expected at least 4 contributor-facing files under .github/, found ${entries.length}`);
  return entries;
};

/* Case-sensitive on purpose, and it is load-bearing: the template legitimately
   cites `.claude/rules/keep-readme-current.md`, whose filename is lower-case.
   Making this `/readme/i` to be thorough turns that citation into a failure. */
test('no .github/ file points a reader at README.md', () => {
  for (const rel of routedFiles()) {
    const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/README/.test(body),
      `${rel} mentions README. Since the 2026-07-30 split the README is a landing page — `
      + 'name the docs/ file that actually holds the material (features / architecture / '
      + 'configuration) instead.');
  }
});

/* The ban above is an *absence* check, so on its own it is satisfied just as
   well by a template that dropped the doc-routing line altogether — the
   vacuous-pass shape `.claude/rules/break-the-code-on-purpose.md` warns about.
   Pin the positive half too: the checklist must still route, and to all three. */
test('the PR template routes doc updates to all three docs/ files', () => {
  const tpl = fs.readFileSync(path.join(GH, 'PULL_REQUEST_TEMPLATE.md'), 'utf8');
  for (const doc of ['docs/features.md', 'docs/architecture.md', 'docs/configuration.md']) {
    assert.ok(tpl.includes(doc),
      `.github/PULL_REQUEST_TEMPLATE.md no longer names ${doc} in its docs checklist item `
      + '(CONTRIBUTING.md routes all three, and the template mirrors it).');
  }
});
