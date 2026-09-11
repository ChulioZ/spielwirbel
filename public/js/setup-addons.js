/* Spielwirbel – the session setup screen's add-on row (#1015): the rarely used
   session options as a row of chips, with the control that one of them opens
   unfolding in a single body BELOW the row.

   Shared by the two screens that start a session, exactly like the guest and
   team pickers it usually holds: the draw setup (views-session.js) and the
   direct-play sheet (direct-session.js). Frontend shared-scope script; load
   order: see index.html (after guest-picker.js/team-picker.js, before the views
   that mount it).

   Why the body is a SIBLING of the row and never a child of a chip: a
   disclosure that unfolds inside its own `flex-wrap` row has to claim the whole
   line to hold its content, and the flex algorithm then moves the TRIGGER onto
   the next line with it — one click moving two things the user never touched
   (.claude/rules/an-inline-disclosure-moves-its-own-trigger.md). With the body
   outside the row there is nothing in the row for any rule to widen, so the
   chips cannot move by construction.

   It is an inline disclosure rather than the overlay that file prescribes for
   the filter panel, and the difference is what the body pushes: the filter
   panel sat directly above the pool preview it shapes, so growing in flow moved
   the very feedback the user was watching. These bodies sit at the end of their
   column, above nothing — so `aria-expanded` on a real button, which is the
   platform pattern for a disclosure, is enough and focus stays on the trigger. */

'use strict';

// Unique per row, because the id is what `aria-controls` points at and two setup
// surfaces can be in the document at once (the direct-play sheet opens over a
// screen that may itself be the setup form).
let addonBodySeq = 0;

// Build the whole row plus its body host, ready to drop in wherever the caller
// mounted a placeholder. Chips are added afterwards through `addAddon`, because
// the bodies they open are built by the caller and some of them (the shelf
// chips) do not exist on every round.
//
// One chip spec is either
//   { key, icon, label(), on(), el }          – a disclosure: clicking unfolds `el`
//   { key, icon, label(), on(), onToggle() }  – a plain toggle, no body
//
// `key` lands on the chip as `data-addon`, which is how a spec (and a future
// screen wanting to preselect one) names a chip without matching its localised
// label or counting its position in the row.
//
// `label()` and `on()` are read on every repaint rather than captured, so a chip
// states what its option is currently set to: the row is the only thing on
// screen once the body is closed, and an option whose state is invisible reads
// as an option nobody used. The caller drives that through `relabelAddons()`
// from the same change callbacks that already redraw the seats and the pool.
function renderSetupAddons(groupLabel) {
  const bodyId = 'addonBody' + ++addonBodySeq;
  const wrap = h(`<div class="setup-addons-wrap">
      <div class="setup-addons" role="group" aria-label="${esc(groupLabel)}"></div>
      <div class="setup-addon-body" id="${bodyId}" hidden></div>
    </div>`);
  const row = wrap.querySelector('.setup-addons');
  const body = wrap.querySelector('.setup-addon-body');
  const items = [];
  let open = null;

  const paint = (item) => {
    item.chip.innerHTML = iconText(item.icon, item.label());
    item.chip.classList.toggle('is-on', !!item.on());
    if (!item.el) item.chip.setAttribute('aria-pressed', String(!!item.on()));
  };

  // One body at a time. Two open at once would put back exactly the height this
  // row exists to reclaim, and the second one would open below the first rather
  // than below its own chip.
  const close = () => {
    // `replaceChildren` DETACHES the body element; it does not destroy it, so
    // the picker's listeners and the user's picks survive being closed and
    // reopened. Same reason the tag section is moved between filter panels
    // rather than rebuilt.
    body.replaceChildren();
    body.hidden = true;
    items.forEach((it) => { if (it.el) it.chip.setAttribute('aria-expanded', 'false'); });
    open = null;
  };

  const show = (item) => {
    const again = open === item;
    close();
    if (again) return; // a second click on the open chip closes it
    open = item;
    item.chip.setAttribute('aria-expanded', 'true');
    body.appendChild(item.el);
    body.hidden = false;
  };

  const add = (spec) => {
    const chip = h(`<button type="button" class="chip setup-addons__chip" data-addon="${esc(spec.key)}"></button>`);
    const item = Object.assign({}, spec, { chip });
    if (item.el) {
      chip.setAttribute('aria-expanded', 'false');
      chip.setAttribute('aria-controls', bodyId);
      chip.addEventListener('click', () => show(item));
    } else {
      chip.addEventListener('click', () => {
        item.onToggle();
        paint(item);
      });
    }
    items.push(item);
    paint(item);
    row.appendChild(chip);
    return chip;
  };

  // The element-with-methods shape renderSeatPicker and renderGuestPicker use,
  // so a caller holds one node and drives it back through its own callbacks.
  wrap.addAddon = add;
  wrap.relabelAddons = () => items.forEach(paint);
  wrap.closeAddon = close;
  return wrap;
}
