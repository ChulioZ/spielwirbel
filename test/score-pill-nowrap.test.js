'use strict';

/*
 * The average-rating pill never breaks across two rows (#849).
 *
 * `.score-pill` is `position: absolute` over a game cover, but in five places it
 * is reset to `position: static` and becomes a flex item beside a title that can
 * overflow: `.ticket__meta`, `.session-card__title`, `.game-card__badges`,
 * `.tables-card__meta`, `.ds-row__meta`. A flex item shrinks to its min-content
 * width, and the pill's content ("Ø 3,5") carries a space — a legal break
 * opportunity — so a long game title beside it squeezed the pill down to the
 * width of "3,5" and stranded the Ø on its own row.
 *
 * A CSS-text assertion is the only layer that can hold this: jsdom applies no
 * external stylesheet, so no view spec can see it, and it is invisible to every
 * DOM probe (`.claude/rules/label-rows-lose-to-field-label.md`).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { bodyOf, bodyOfIn } = require('./support/css');

test('.score-pill declares white-space: nowrap, so its space is not a break opportunity', () => {
  const body = bodyOf('.score-pill') || bodyOfIn('.score-pill');
  assert.ok(body, 'no .score-pill rule found in styles.css');
  assert.match(
    body,
    /white-space:\s*nowrap/,
    'without this the pill breaks after the Ø whenever the title beside it overflows'
  );
});
