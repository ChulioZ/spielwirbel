'use strict';

/*
 * How a tenant is classified as a guest demo (#427) — one definition, required
 * by everything that needs it.
 *
 * A demo tenant id is `demo-<16 hex>`; a real one is bare 16 hex, so the two can
 * never collide. That prefix is the whole classifier, deliberately: no call site
 * has to know demo mode exists, and the answer rides on the id itself, so it
 * survives the multi-process deployment (#215) where anything held in memory
 * would classify the same tenant differently depending on which replica
 * answered.
 *
 * This file exists because the prefix has FOUR consumers now — lib/demo.js,
 * lib/observability.js (trackEvent excludes demo traffic from the product
 * counters) and both repo backends (instanceMetrics, #404) — and three of them
 * cannot require lib/demo.js: it pulls in the repo, so the repo requiring it back
 * is a cycle, and observability.js is required by almost everything. It used to
 * carry a hand-copied literal plus a parity assertion; a dependency-free leaf
 * module cannot drift at all, which is the shape
 * .claude/rules/shared-constants-across-the-stack.md prefers over a copy.
 *
 * Keep it dependency-free — that is the only reason it can be required from
 * anywhere.
 */

const DEMO_TENANT_PREFIX = 'demo-';

const isDemoTenant = (tenantId) => String(tenantId || '').startsWith(DEMO_TENANT_PREFIX);

module.exports = { DEMO_TENANT_PREFIX, isDemoTenant };
