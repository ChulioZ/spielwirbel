/* Spielwirbel – the one empty-state component (#869).

   Before this, "there is nothing here yet" was said in three different visual
   languages on sibling screens of the same round: `.empty` (a centred sentence
   in a near-invisible dashed box) on five screens, a bare `<div class="muted">`
   in the Chronik, and nothing at all on the Start tab from 1280px up. A young
   round is every round's first weeks, so this is the state a new user judges
   the app by.

   The treatment is `.lobby-cta`'s (#358), which the app already ships and which
   is the quality bar: a `--brand-tint` medallion, a display title, a sub-line
   and a `--brand-edge` border. Their shared rules are literally shared — see
   `.lobby-cta__icon` in styles.css, which names both. Only the box differs,
   because `.lobby-cta` is a clickable card and this is a notice.

   `title` is OPTIONAL on purpose. The five `suggest.empty.*` strings are one
   explanatory thought each ("This instance has no game database, so there is
   nothing to recommend from."), and inventing a headline for those produces
   filler; they render as sub-only. Everything else splits into two beats,
   written deliberately per locale rather than by cutting the old sentence at
   its em-dash.

   Not dependency-free: it builds DOM through `h`/`esc`, so it loads after
   core.js. Both are called at render time, never at load time, so it is clear
   of the load-order trap (`.claude/rules/frontend-script-load-order.md`). */

'use strict';

/* One empty state. `icon` is a Tabler class from the bundled subset (all of the
   glyphs the call sites use are already declared — see
   `.claude/rules/tabler-icon-codepoints.md` before introducing a new one).

   Returns the node so the caller can add a modifier; the Start tab's stand-in
   is `.empty--rail-gap`, which is this component plus a visibility rule. */
function emptyState({ icon, title, text }) {
  return h(`<div class="empty">
       <span class="empty__icon"><i class="ti ${esc(icon)}" aria-hidden="true"></i></span>
       ${title ? `<strong class="empty__title">${esc(title)}</strong>` : ''}
       <p class="empty__text">${esc(text)}</p>
     </div>`);
}

/* One ACTION on an empty state (#1216, Ocean O7.1): „ein leerer Zustand zeigt
   eine Handlung, höchstens eine zweite als Nebenweg". Appended into the same
   `.empty__actions` row the empty table (#1269) uses, so every design already
   lays it out; only Ocean's call sites add one today, and Klassisch's empty
   states stay notices.

   A real <button> with the app's own label — the empty state never invents a
   string, it lends the screen's existing action a second, nearer place. */
function emptyStateAction(node, { icon, label, primary = false, onClick }) {
  let row = node.querySelector(':scope > .empty__actions');
  if (!row) row = node.appendChild(h('<div class="empty__actions"></div>'));
  const btn = h(`<button type="button" class="btn${primary ? ' btn--primary' : ''}"><i class="ti ${esc(icon)}" aria-hidden="true"></i> ${esc(label)}</button>`);
  btn.addEventListener('click', onClick);
  row.appendChild(btn);
  return btn;
}
