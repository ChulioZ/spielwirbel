# A HIDDEN Browser pane throttles `setTimeout` — a probe that sleeps between steps hangs

<!-- scope: global — the trap surfaces through the Browser pane tool, not through any file being edited -->

Measured on #1327. With the pane not displayed (another builder's tab in front,
or the pane collapsed), a `javascript_tool` probe that walked three winner-chip
taps with `await new Promise(r => setTimeout(r, 700))` between them **timed out
at 45 s** — while the same shape had finished in ~2 s minutes earlier. Chrome's
background-tab timer throttling (and, after a few minutes hidden, its intensive
throttling) stretches chained timers to seconds or a minute each.

It fails badly in two ways:

- **It reads as the app hanging**, on exactly the async path under test.
- **The timed-out script keeps running.** Its timers fire later and click things
  underneath the next probe, which then reports impossible states (chips pressed
  that the probe never tapped). Re-`navigate` before re-probing — a navigation is
  the only thing that kills it.

## The probe shape that works

Wait for the CONDITION, and yield through a `MessageChannel`, which is not
timer-throttled:

```js
const yieldTask = () => new Promise((r) => {
  const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0);
});
const until = async (fn, max = 400000) => {
  for (let i = 0; i < max; i++) { if (fn()) return true; await yieldTask(); }
  return false;
};
const before = chip; chip.click();
await until(() => row()[i] && row()[i] !== before);   // the re-render landed
```

Condition-waiting is better anyway: a fixed sleep either wastes time or races the
request. Screenshots are unavailable while the pane is hidden ("not compositing
frames"), so a hidden-pane check is DOM probes only — say so in the PR.

**Related:** `.claude/rules/preview-pane-paint-artifacts.md` (the pane's other
falsehoods, including the paint-driven animation clock),
`.claude/rules/blur-events-never-fire-in-the-preview-pane.md`.
