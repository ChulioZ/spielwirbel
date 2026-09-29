'use strict';

/* A rendered tree as a list of lines — tag, classes and the few attributes that
 * carry structure or state — with NO text, no inline style and no href. Used to
 * pin that a design's markup branch leaves Klassisch's DOM exactly as it was
 * (#1372): text is excluded because it carries relative dates ("vor 5 Tagen")
 * that move with the clock, while the structure a design could disturb does not.
 *
 * One line per element, indented by depth, so a failing deepEqual names the
 * element that moved rather than a hash that changed.
 */

const KEPT = ['role', 'aria-current', 'aria-hidden', 'aria-label', 'aria-expanded', 'hidden', 'disabled', 'tabindex', 'type'];

function domSignature(root) {
  const out = [];
  const walk = (el, depth) => {
    const cls = [...el.classList].sort().join('.');
    const attrs = KEPT.filter((a) => el.hasAttribute(a))
      .map((a) => (a === 'aria-label' ? a : `${a}=${el.getAttribute(a)}`));
    out.push(`${'  '.repeat(depth)}${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${attrs.length ? ` [${attrs.join(' ')}]` : ''}`);
    for (const child of el.children) walk(child, depth + 1);
  };
  for (const child of root.children) walk(child, 0);
  return out;
}

module.exports = { domSignature };
