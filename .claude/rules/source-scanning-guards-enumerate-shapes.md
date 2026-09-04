# A guard that greps the source enumerates CALL SHAPES — the shape it misses is invisible

<!-- scope: global — the trap surfaces when writing or extending ANY test that regexes over source files, including ones that do not exist yet, so no `paths:` list can name the file whose editing would surface it. -->

`test/count-plurals.test.js` ends with a scan that asserts a set of i18n keys is
never reached through the non-plural `t()`. It is a good guard and it caught real
regressions — but it only ever saw **one call shape**, and nothing said so.

```js
// #833's nine sites, all written as a direct call
t('sessions.ratedOne', { … })
const bad = new RegExp(`\\bt\\(\\s*'${rx(key)}'`);   // matches — key follows the paren
```

#838 converted four *older* sites that pick the key with a ternary instead:

```js
t(names.length === 1 ? 'result.titleWonOne' : 'result.titleWonMany', { … })
```

Here the key does **not** follow `t(` — a condition sits between them — so the
pattern matched nothing at all. Extending the scan's key list, which is what the
issue specified and what looks like the whole job, produced a test that **could
not fail**: measured, with all four sites reverted on purpose, it stayed green
five times out of five.

## The rule

When you add a key/name/class to a source-scanning test, **do not assume the
existing pattern covers the new call site.** Revert that specific site and watch
the scan go red *for it*. A scan that already passes over nine other sites tells
you nothing about the tenth, because the thing that varies is the **syntax around
the token**, not the token.

The widened form, and why each half is load-bearing:

```js
const bad = new RegExp(`\\bt\\(\\s*[^)\\n]*'${rx(key)}'`);
```

- `[^)…]` — the key may sit anywhere in the call, but the match may not cross a
  closing paren, so `foo(t('x'), 'keyOne')` is correctly not a hit.
- `…\\n]` — nor a newline, so it cannot wander out of the call it started in.
- `\\bt\\(` still cannot match `tn(` — `n` is a word character.

## Why this class of test invites the mistake

A source scan reads as though it asks a *semantic* question ("is this key ever
passed to `t()`?"). It does not — it asks a lexical one, and its coverage is
whatever its regex happens to accept. That gap is invisible from a green run in
both directions: the test does not report which files or shapes it matched, and
its anti-vacuous floor (`assert.ok(checked > 100)`) counts **attempts**, not
hits, so it stays satisfied while every attempt matches nothing.

If you write one of these, prefer a floor that counts something a broken pattern
would lose — or accept that the deliberate revert is the only evidence, and do
it. This is the general case of the family in
`.claude/rules/break-the-code-on-purpose.md`: Route 1 cannot reach it either,
since a test-first author writing the scan alongside the conversion sees the same
green.

**Related:** `.claude/rules/break-the-code-on-purpose.md` (the discipline this is
an instance of, and the "name the failing test, don't count failures" habit that
made the five green runs legible),
`.claude/rules/tabler-icon-codepoints.md` (`test/tabler-icons-declared.test.js`
is the same technique — and the third spelling this file predicted turned up:
#890 found the five `ti-mood-*` faces had only ever been reached through an
array (`MOODS[n - 1]`), so neither of the scan's two patterns had ever seen the
app's most-pressed glyphs. Measured the way this file prescribes — with
`.ti-mood-cry::before` deleted, the two-pattern scan stayed **green** and the
widened one went red naming the file. A bare quoted `'ti-foo'` is now the third
pattern).
