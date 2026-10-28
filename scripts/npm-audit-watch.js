'use strict';

/*
 * The npm-audit leg of the daily security watch (#1742), run by
 * scripts/node-security-watch.js, which owns the reporting path.
 *
 * Dependabot alerts lag `npm audit`: on 2026-10-27 two reviewed high advisories
 * against production dependencies were four days old with no alert and no PR,
 * and only `npm audit` saw them (fixed in #1740). So this runs it daily against
 * the committed lockfile — production dependencies only, high and critical only.
 *
 * `npm audit` reads the lockfile alone, so no `npm ci` is needed (measured
 * 2026-10-28 with npm 10.9.4 in a directory holding only package.json and
 * package-lock.json). Dev dependencies are dropped by `--omit=dev` itself: the
 * report carries no dev flag to filter on afterwards.
 *
 * Same privacy shape as the Node leg: the findings go into a PRIVATE draft
 * advisory, never into the public log. A red run says only "action required",
 * which anyone can already derive by running `npm audit` on the public lockfile.
 */

const { spawnSync } = require('child_process');

const AUDIT_ARGS = ['audit', '--omit=dev', '--json'];
const SEVERITIES = ['high', 'critical'];
// One fixed title, so a pending finding updates its draft rather than adding one a day.
const AUDIT_SUMMARY = 'npm audit: high/critical advisory in a production dependency';

// The report's advisories at high/critical, one per (advisory, package), sorted.
// Entries whose `via` is only a string are a dependent of the vulnerable package;
// the advisory itself is listed under the package it names, so they add nothing.
function auditFindings(report) {
  // Error details stay out of the message: it reaches the public log.
  if (!report || report.error) throw new Error('npm audit reported an error');
  if (report.auditReportVersion !== 2) throw new Error('npm audit printed an unknown report format');
  const seen = new Map();
  for (const entry of Object.values(report.vulnerabilities || {})) {
    for (const via of entry.via || []) {
      if (typeof via !== 'object' || !SEVERITIES.includes(via.severity)) continue;
      const id = (String(via.url || '').match(/GHSA-[\w-]+$/) || [String(via.source)])[0];
      seen.set(`${via.name}\0${id}`, {
        package: via.name, id, severity: via.severity, title: via.title, range: via.range, url: via.url,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.package.localeCompare(b.package) || a.id.localeCompare(b.id));
}

function auditAdvisoryBody(findings) {
  const packages = [...new Set(findings.map((f) => f.package))];
  return {
    summary: AUDIT_SUMMARY,
    severity: findings.some((f) => f.severity === 'critical') ? 'critical' : 'high',
    description: [
      '`npm audit --omit=dev` against the committed lockfile reports:',
      '',
      ...findings.map((f) => `- **${f.package}** (${f.range}) — ${f.severity}: ${f.title} — ${f.url}`),
      '',
      'Bump the package (the `dependabot` skill, or a manual lockfile bump when no PR exists)',
      'and keep any analysis of where it is reachable out of public PR text until the deploy',
      'is verified (.claude/rules/keep-exploit-paths-private-until-deployed.md). This draft is',
      'rewritten on every run while a finding is pending; close it once the bump is live.',
    ].join('\n'),
    // Ranges stay in the description: npm's syntax (">=2.0.0 <2.4.0", "||") is not
    // GitHub's, and a rejected range would fail the run without filing anything.
    vulnerabilities: packages.map((name) => ({
      package: { ecosystem: 'npm', name },
      vulnerable_version_range: null,
      patched_versions: null,
    })),
  };
}

function runAudit(cwd, spawn = spawnSync) {
  // Exit status 1 just means "found something"; the JSON decides.
  const res = spawn('npm', AUDIT_ARGS, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new Error('npm audit could not be run');
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error('npm audit printed no JSON report');
  }
}

module.exports = { AUDIT_ARGS, AUDIT_SUMMARY, auditFindings, auditAdvisoryBody, runAudit };
