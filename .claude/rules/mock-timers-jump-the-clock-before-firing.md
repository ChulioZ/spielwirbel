# `mock.timers` jumps the clock to the END of a tick before firing anything

<!-- scope: global — a property of node:test's mock timer tool, not of any file it is used on; the vacuous assertion it produces reads as correct in whichever spec reaches for it -->

Node's `t.mock.timers` (with `apis: ['setTimeout', 'Date']`) advances the mocked
clock to the tick's **end** and only then runs every callback the tick uncovered.
So `Date.now()` read from *inside* a timer callback reports the end of the tick,
never the moment that timer was due:

```js
t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
const start = Date.now();
const seen = [];
setTimeout(() => seen.push(['a', Date.now() - start]), 8000);
setTimeout(() => seen.push(['b', Date.now() - start]), 30000);
t.mock.timers.tick(31000);
// measured: [["a",31000],["b",31000]]   — not 8000 / 30000
```

## Why that is worse than a wrong number

The natural way to assert a timeout is "how long did it take to fire", and this
makes that probe **agree with every implementation**. Written against #774's two
request deadlines, it reported `31000` for both the 8 s lookup budget and the 30 s
corpus budget — the same value the *correct* code produces, the *broken* code
produces, and a build with no timer at all produces. It fails the
`.claude/rules/break-the-code-on-purpose.md` test in the nastiest way: it goes
red at first (`31000 !== 8000`) so it looks like a healthy test-first red, while
being incapable of ever going green for the right reason.

## The shape that works: step the clock, ask WHETHER it fired

Never read a timestamp inside the callback. Set a flag there — listeners run
synchronously within `tick()` — and step the clock across the boundary:

```js
t.mock.timers.tick(29999);
assert.equal(state.fired, false, 'still inside the deadline');
t.mock.timers.tick(1);
assert.equal(state.fired, true, 'fired at 30 s');
```

The two-step is the whole assertion: only the `false` before and the `true` after
together pin the boundary. A single `tick(31000)` + `assert(fired)` passes against
any deadline shorter than 31 s, which is exactly the 8 s bug it would be guarding.

**Mock both APIs together.** Code that computes a deadline (`Date.now() + budget`)
and arms it (`setTimeout`) reads two clocks; mocking one leaves the arithmetic on
the real clock and the timer on the frozen one, and the disagreement presents as
a timer that never fires.

**Related:** `.claude/rules/break-the-code-on-purpose.md` (a red you have not
earned is still not evidence), `.claude/rules/automated-tests.md`.
