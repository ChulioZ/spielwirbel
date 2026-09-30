/* Spielwirbel – the top-bar design menu (#1429): a palette button beside the
   language picker that opens a small radio list of the offered designs.

   Its own file rather than a section of design-picker.js: that file is the
   Konto/chooser CARD list with a branch per design, this is chrome outside every
   view, and the two share only what already lives in one place — offeredDesigns
   (which designs exist), designTile (the swatch) and saveAccountDesign (how an
   account stores one).

   A POPOVER at every width, never a sheet: it is a list of choices with no text
   input, the exception .claude/rules/popover-vs-sheet-editors.md names, with the
   account menu and the „…" menu as precedents.

   Two stores, one question — who is asking:
   - a logged-in account → PATCH /me, exactly as Konto does;
   - anyone else (logged out, or accounts off) → the device key, with NO request.
     That is the #1186 fallback's first production writer; before this, nothing
     could set it.

   No module.exports: everything here touches `document`
   (.claude/rules/frontend-helper-modules-and-coverage.md). The specs reach it
   through the jsdom harness (test/support/dom.js). */

'use strict';

// Persist and wear a pick. A refused account save has already reverted the
// paint and toasted inside saveAccountDesign; the menu is closed by then, so
// there is nothing left to put back here.
function chooseDesign(id) {
  if (accountsActive() && isLoggedIn()) {
    saveAccountDesign(id).catch(() => {});
    return;
  }
  storeDesign(id);
  applyDesign(id);
}

/* The menu. Two ways through it, and they differ on purpose:

   - a TAP answers: the pick is stored and worn, and the menu closes;
   - the ARROW KEYS only preview. They repaint (applyDesign's `preview`, which
     re-renders nothing) and store nothing; Enter or Space answers, and every
     other exit — Escape, a click outside, a scroll — puts the design back.

   Committing on each arrow step cannot work here: a committed design change
   re-renders the screen, every render passes through syncUrl(), and syncUrl()
   closes any open popover (router.js) — so a keyboard walk would end at its
   first step, with focus thrown back to the button. It is also the shape a
   menu is expected to have: moving through it is not choosing.

   A tap is told from an arrow step by the click's `detail`: a mouse or touch
   click carries >= 1, the click an arrow key synthesises on a radio carries 0.
   The label's click runs before the radio's `change` whichever of the two was
   hit, so the flag is set by the time the change handler reads it. */
function openDesignMenu(btn, cfg) {
  const worn = activeDesign().id;
  let answered = false;
  openPopover(btn, (el, close) => {
    el.classList.add('design-menu');
    const group = h(`<div class="design-menu__list" role="radiogroup" aria-label="${esc(t('design.pick.label'))}"></div>`);
    const answer = (id) => {
      answered = true;
      // Closed BEFORE the pick commits, so the re-render it triggers happens
      // with focus already back on the button.
      close();
      if (id !== worn) chooseDesign(id);
    };
    let pointer = false;
    for (const design of offeredDesigns(cfg)) {
      const on = design.id === worn;
      const row = h(`<label class="design-menu__opt${on ? ' is-on' : ''}">
          <input type="radio" name="designMenu" value="${esc(design.id)}"${on ? ' checked' : ''}>
          <span class="design-menu__name">${esc(t(design.labelKey))}${
  design.id === CLASSIC_DESIGN ? `<span class="design-card__badge">${esc(t('design.klassisch.badge'))}</span>` : ''}</span>
        </label>`);
      // designTile's colours, under a class of the menu's own: the design sheets
      // resize `.design-tile` for their Konto cards (Der Tisch's is 96px tall),
      // which in a 44px row drew each swatch as a column.
      const swatch = designTile(design);
      swatch.className = 'design-menu__swatch';
      row.insertBefore(swatch, row.querySelector('.design-menu__name'));
      row.addEventListener('click', (e) => {
        if (e.detail < 1) return;
        const input = row.querySelector('input');
        // A checked radio fires no `change` when tapped again — the worn row, or
        // one the arrow keys are previewing — so a tap on it answers here.
        if (input.checked) answer(input.value);
        else pointer = true;
      });
      row.querySelector('input').addEventListener('change', () => {
        for (const other of group.querySelectorAll('.design-menu__opt')) other.classList.toggle('is-on', other === row);
        const viaPointer = pointer;
        pointer = false;
        if (viaPointer) answer(design.id);
        else applyDesign(design.id, { preview: true });
      });
      group.appendChild(row);
    }
    group.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const checked = group.querySelector('input:checked');
      if (checked) answer(checked.value);
    });
    el.appendChild(group);
    // Focus lands on the checked radio once the popover is live — a focus()
    // on the detached node build() runs on is a silent no-op (popover.js).
    return () => {
      const target = group.querySelector('input:checked') || group.querySelector('input');
      if (target) target.focus();
    };
  }, () => {
    btn.setAttribute('aria-expanded', 'false');
    // Any exit that did not answer takes the preview back off.
    if (!answered && activeDesign().id !== worn) applyDesign(worn, { preview: true });
  });
  btn.setAttribute('aria-expanded', 'true');
}

// Revealed only once GET /api/config says there is a choice: one design is not
// one, the bar buildDesignSection and the landing's design strip already set.
// On a failed config request the button simply stays hidden.
function setupDesignMenu() {
  const btn = document.getElementById('designBtn');
  if (!btn) return;
  withAppConfig((cfg) => {
    if (offeredDesigns(cfg).length < 2) return;
    btn.hidden = false;
    btn.onclick = () => {
      // A toggle: the popover ignores clicks on its own anchor, so without this
      // a second press would close-and-reopen instead of closing.
      if (btn.getAttribute('aria-expanded') === 'true') { closePopover(); return; }
      openDesignMenu(btn, cfg);
    };
  });
}
