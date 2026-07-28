'use strict';

/*
 * The browser-local demo resume marker (#502).
 *
 * A visitor who leaves a demo without ending it — the banner's register CTA, a
 * closed tab, navigating away — keeps the demo alive on the server, so a return
 * visit must re-enter THAT demo instead of minting a second one and stranding
 * the first for the rest of its TTL. The marker is how the browser remembers
 * which demo is its own: a third localStorage key holding the demo's refresh
 * token, deliberately NOT cleared by clearTokens().
 *
 * It is browser-local on purpose. Resuming by IP would drop two strangers behind
 * the same CGNAT/corporate/mobile NAT into ONE account, each seeing the names and
 * games the other typed — so the address is only ever used as a per-source
 * *bound* (lib/demo.js), never as an identity.
 *
 * This lives in its own tiny file rather than inside account.js for the
 * coverage reason in .claude/rules/frontend-helper-modules-and-coverage.md:
 * requiring a big view file into a test drags its whole (DOM-unreachable) body
 * into the coverage report and fails the coverage:ci floor.
 */

const SA_DEMO = 'sa_demo';

/*
 * Must the marker follow this token rotation?
 *
 * THIS IS THE FRAGILE PART OF THE FEATURE. POST /refresh SPENDS the presented
 * refresh token and issues a replacement, so a marker that is not rewritten on
 * every rotation goes stale after the first silent refresh — and a resume then
 * presents a spent token, fails, and silently mints a SECOND demo, which is the
 * exact bug the marker exists to prevent. It fails invisibly: the demo works
 * fine, the visitor just gets a fresh empty one next time.
 *
 * The test is identity, not "is this account a demo": the marker follows a
 * rotation only when the token being replaced IS the one the marker points at.
 * That is what keeps a real account's rotation from clobbering the marker — a
 * visitor who abandons a demo via the register CTA and then signs up for real
 * still holds the marker, and their own account's refreshes must not overwrite
 * it with their real refresh token.
 *
 * Both arguments must be non-empty: at MINT time the marker is absent and the
 * previous refresh token may be null, and `null === null` would otherwise read
 * as a match. The mint and the resume write the marker explicitly instead.
 */
function demoMarkerFollowsRotation(demoToken, currentRefreshToken) {
  return !!demoToken && !!currentRefreshToken && demoToken === currentRefreshToken;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SA_DEMO, demoMarkerFollowsRotation };
}
