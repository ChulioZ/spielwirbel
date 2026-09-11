---
paths:
  - "public/styles.css"
  - "public/js/filter-panel.js"
---

# A wrapping row breaks between ITEMS — so a label and its control must be one

A wrapping flex row has no idea which of its children belong together. It breaks
wherever it runs out of width. So a row of labelled controls built as flat
siblings —

```html
<span class="mfilter__range">          <!-- flex-wrap: wrap -->
  <span>mindestens</span><select>…</select>
  <span>höchstens</span><select>…</select>
</span>
```

— is correct at every width that fits, and wrong at the first one that does not.

Measured on #1001 at 375px: the break fell between „höchstens" and **its own**
select, leaving that word on the line above, beside the *other* bound's value.
The filter then read „mindestens [120 Min.] höchstens" over „[Egal]" — which
states the opposite of what is set. The visible direction word had been added in
that very change precisely to stop the row being ambiguous, so the bug undid the
feature while looking like it had shipped.

**The fix is a wrapper per pair** (`.mfilter__pair`), so the row can only break
between whole bounds:

```css
.mfilter__pair { display: flex; align-items: center; gap: 6px; }
```

Generally: **a wrapping row holding N controls each with its own label has N
items, not 2N.** The same applies to an icon plus its text, a value plus its
unit, or a chip plus its ×.

## Why nothing catches it

- **jsdom sees no stylesheet**, so a view spec cannot observe a wrap at all
  (`.claude/rules/testing-views-under-jsdom.md`).
- **Desktop width hides it.** The row fits, nothing wraps, and every check is
  green. It appears only below some width that depends on the option text *and*
  on the locale's word lengths — so it can be absent in the language you tested
  and present in another.
- **The markup reads fine.** Label, control, label, control is the obvious
  order; nothing on the page says the row is allowed to break in the middle.

What a spec *can* assert is the **structure** — that the label and its control
share a parent — which is the half that makes the layout safe. `test/filter-panel.test.js`
does that, and it goes red when the wrapper is removed. The pixels need a real
browser at a narrow width; clear the service worker first, because the shell is
served cache-first (`.claude/rules/pwa-service-worker.md`), and re-point the
`<link>` at a cache-busted URL after every `navigate` and `resize_window`.

**Related:** `.claude/rules/flex-none-cancels-flex-wrap.md` (the other way a
wrapping row misleads — a declaration that stops it wrapping at all),
`.claude/rules/flex-none-item-makes-the-row-data-dependent.md` (an item whose
own content decides where the row breaks),
`.claude/rules/provider-metadata-is-a-filter-not-a-tag.md` (the filter panel
this was found in), `.claude/rules/label-rows-lose-to-field-label.md` (the other
label-in-a-row trap in the same panel).
