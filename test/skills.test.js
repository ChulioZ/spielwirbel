'use strict';

/* The agent-facing files in `.claude/skills/` are instructions to future
   sessions, and nothing else in CI reads a word of them. Two failure modes are
   both silent and both expensive:

   - A skill whose frontmatter `name` no longer matches its directory, or whose
     `description` is empty, simply never triggers. There is no error — the skill
     is just quietly unreachable, and you find out by wondering why nothing
     happened.
   - A skill that cites `.claude/rules/<x>.md` or `test/<x>.js` after that file was
     renamed sends the next session looking for something that isn't there. Rules
     and skills cross-reference each other heavily, so one rename strands several
     pointers at once.

   Both are mechanical, so they are checked here rather than left to the
   `claude-file-audit` skill (criteria C-001/C-003/C-007) — a check that runs in CI
   forever beats one that runs when someone remembers to audit. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, '.claude', 'skills');

const dirs = fs.readdirSync(SKILLS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

// Every markdown file under .claude/skills/, as [repo-relative path, text].
const docs = dirs.flatMap((d) => fs.readdirSync(path.join(SKILLS, d))
  .filter((f) => f.endsWith('.md'))
  .map((f) => [`.claude/skills/${d}/${f}`, fs.readFileSync(path.join(SKILLS, d, f), 'utf8')]));

// The rule files and the root docs cite paths just as heavily as the skills do,
// and drift the same way — so the reference check below covers all of them.
const read = (rel) => [rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')];
const ruleDocs = fs.readdirSync(path.join(ROOT, '.claude', 'rules'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => read(`.claude/rules/${f}`));
const rootDocs = ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md'].map(read);

// The user-facing docs under docs/ (not docs/legal/, which cites no code paths).
// They joined on 2026-07-30, when the README's reference material moved into them:
// docs/architecture.md alone names ~90 source files, so after that move the majority
// of the repo's cited paths lived in files this check could not see.
const userDocs = fs.readdirSync(path.join(ROOT, 'docs'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => read(`docs/${f}`));

// The YAML-ish frontmatter block, or null when the file opens without one.
const frontmatter = (text) => {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return m ? m[1] : null;
};

// A scalar frontmatter field, supporting YAML's `>-` folded-block form.
const field = (fm, key) => {
  const m = new RegExp(`^${key}:\\s*(>-|\\|-?)?[ \\t]*(.*(?:\\n(?:[ \\t]+.*|))*)`, 'm').exec(fm);
  return m ? m[2].replace(/\s+/g, ' ').trim() : null;
};

test('every skill directory holds a SKILL.md', () => {
  assert.ok(dirs.length > 0, 'no skills found');
  for (const d of dirs) {
    assert.ok(fs.existsSync(path.join(SKILLS, d, 'SKILL.md')), `.claude/skills/${d}/SKILL.md is missing`);
  }
});

test('each SKILL.md declares a name matching its directory and a real description', () => {
  for (const d of dirs) {
    const fm = frontmatter(fs.readFileSync(path.join(SKILLS, d, 'SKILL.md'), 'utf8'));
    assert.ok(fm, `${d}: SKILL.md has no frontmatter block`);

    assert.equal(field(fm, 'name'), d, `${d}: frontmatter name must equal the directory name`);

    // The description is the whole triggering mechanism: it must say what the
    // skill does AND when to reach for it, so a bare label is a defect.
    const desc = field(fm, 'description') || '';
    assert.ok(desc.length >= 40, `${d}: description is too thin to trigger on ("${desc}")`);
    assert.match(desc, /\bUse (when(ever)?|for|to)\b/i, `${d}: description must say when to use the skill`);
  }
});

// References that name a file which was deliberately DELETED, kept as history.
// `.claude/rules/` is allowed to say "the removed X" — that is the documented
// remedy in criteria C-012 (a rule whose mechanism is gone gets deleted, and the
// rules that pointed at it explain where the reasoning went). Each entry here is
// a conscious exemption, not a TODO; adding one should take an argument.
const DELETED_ON_PURPOSE = new Set([
  '.claude/rules/retenant-rls-escape.md', // removed with the cross-tenant write escape (#405)
]);

test('every repo path a rule, skill or root doc cites actually exists', () => {
  // Deliberately literal: only concrete paths, never globs. `lib/repo/{json,
  // postgres}.js` and `public/js/*.js` contain characters outside the class, so
  // they simply don't match rather than failing — the check trades completeness
  // for zero false positives. Paths under data/ and dist/ are excluded too:
  // neither is committed, so asserting on them would fail in CI while the
  // reference is perfectly fine.
  const P = '[A-Za-z0-9_./-]+';
  const PATH_RE = new RegExp(
    `(?:\\.claude/(?:rules|skills)/${P}\\.md`
    + `|(?:test|lib|routes|scripts)/${P}\\.js`
    + `|public/${P}\\.(?:js|css|html)`
    + `|\\.github/${P}\\.(?:yml|yaml|md)`
    + `|docs/${P}\\.md)`,
    'g',
  );

  const missing = [];
  for (const [file, text] of [...docs, ...ruleDocs, ...rootDocs, ...userDocs]) {
    for (const ref of new Set(text.match(PATH_RE) || [])) {
      if (DELETED_ON_PURPOSE.has(ref)) continue;
      if (!fs.existsSync(path.join(ROOT, ref))) missing.push(`${file} -> ${ref}`);
    }
  }
  assert.deepEqual(missing, [], `dangling references:\n  ${missing.join('\n  ')}`);
});

test('every audit skill carries a criteria file the loop can read', () => {
  // The loop in .claude/skills/audit/audit-loop.md gates its research phase on
  // these two header fields. A malformed header does not throw — research would
  // just silently never run (or run every time), so pin the shape.
  const audits = dirs.filter((d) => d.endsWith('-audit'));
  assert.ok(audits.length >= 3, 'expected the accessibility, legal and claude-file audits');

  for (const d of audits) {
    const p = path.join(SKILLS, d, 'criteria.md');
    assert.ok(fs.existsSync(p), `${d}: criteria.md is missing`);

    const text = fs.readFileSync(p, 'utf8');
    assert.match(text, /^- \*\*last-researched:\*\* (never|\d{4}-\d{2}-\d{2})$/m,
      `${d}: criteria.md needs a last-researched date (or "never")`);
    assert.match(text, /^- \*\*cadence:\*\* \d+ days$/m,
      `${d}: criteria.md needs a research cadence in days`);

    // Rejected entries are the ledger that stops a rejected criterion being
    // re-litigated every run — losing the section quietly loses that memory.
    assert.match(text, /^## Rejected/m, `${d}: criteria.md must keep its Rejected section`);
  }

  // The shared loop the three domain skills all delegate to.
  assert.ok(fs.existsSync(path.join(SKILLS, 'audit', 'audit-loop.md')),
    '.claude/skills/audit/audit-loop.md is missing');
});

test("a criterion's Status matches the section it sits in", () => {
  // Found on 2026-07-30: two ADOPTED criteria (C-014, C-015) had been appended
  // under the "## Rejected — settled, do not re-litigate" header. Nothing renders
  // wrong, and both entries still read correctly on their own — but a run that
  // trusts the section header (which is the whole point of having one) skips
  // exactly the checks filed there. The inverse is just as bad: a rejected entry
  // above the line gets audited against as if it were a live belief.
  const problems = [];
  for (const d of dirs.filter((x) => x.endsWith('-audit'))) {
    const rel = `.claude/skills/${d}/criteria.md`;
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const cut = text.search(/^## Rejected/m);
    if (cut < 0) continue; // the section's existence is asserted above

    // Split on entry headings, keeping each entry's offset so its side is known.
    for (const m of text.matchAll(/^### (\S+)[^\n]*\n([\s\S]*?)(?=^### |^## |$)/gm)) {
      const [, id, body] = m;
      const status = /\*\*Status:\*\*\s*(\w+)/.exec(body);
      if (!status) { problems.push(`${rel}: ${id} has no Status line`); continue; }
      const rejected = status[1] === 'rejected';
      const belowCut = m.index > cut;
      if (rejected !== belowCut) {
        problems.push(`${rel}: ${id} is "${status[1]}" but sits `
          + `${belowCut ? 'below' : 'above'} the Rejected header`);
      }
    }
  }
  assert.deepEqual(problems, [], `misfiled criteria:\n  ${problems.join('\n  ')}`);
});

/*
 * The shipped locale set is DATA (`public/js/locales.js`, #504) and has been
 * five languages since then — but #504 fixed only the *code* copies. Seven
 * prose and YAML sites went on naming `lang/en.js` and `lang/de.js` as the
 * closed pair a contributor must edit, including a REQUIRED field in the bug
 * report form that an es/fr/it reporter could only answer wrongly, and
 * `audit-loop.md`'s repo description, which every one of the six domain audits
 * tests candidate findings against.
 *
 * `.claude/rules/locale-set-is-data.md` already said "don't reintroduce a
 * hardcoded ['de', 'en'] anywhere". The rule was right and got skipped, so the
 * remedy is a check rather than a rewording (criterion C-017 case a).
 */
test('no agent- or contributor-facing file names en.js and de.js as the closed locale pair', () => {
  const scanned = [
    ...docs, ...ruleDocs, ...rootDocs,
    ...['.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/bug_report.yml',
        '.github/ISSUE_TEMPLATE/config.yml'].map(read),
  ];
  // Anti-vacuous: a glob that silently stopped matching would assert nothing.
  assert.ok(scanned.length > 50, `scanned ${scanned.length} files, expected the full doc set`);

  /* The rule file that documents this very bug quotes the bad pair AS the bug,
     and must keep doing so. It is the only legitimate mention. */
  const ALLOWED = new Set(['.claude/rules/locale-set-is-data.md']);

  /* Matches the pair named together within one sentence — `en.js` … `de.js` in
     either order, at most 80 characters apart so it cannot span a paragraph.
     Deliberately NOT a bare `de.js`: naming one locale for an example is fine,
     naming exactly the two as the set to edit is what went stale. */
  const PAIR = /\ben\.js\b[\s\S]{0,80}?\bde\.js\b|\bde\.js\b[\s\S]{0,80}?\ben\.js\b/;

  const bad = scanned
    .filter(([rel]) => !ALLOWED.has(rel))
    .filter(([, text]) => PAIR.test(text))
    .map(([rel, text]) => `${rel}: ${text.match(PAIR)[0].replace(/\s+/g, ' ').slice(0, 70)}`);

  assert.deepEqual(bad, [],
    `these name en.js/de.js as the complete locale set — it is five languages, derived from public/js/locales.js:\n  ${bad.join('\n  ')}`);
});
