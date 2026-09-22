/* Spielwirbel – choosing a design (#1186): the card list the Konto screen and
   the first-start chooser both render, and the chooser sheet itself.

   ONE renderer for both surfaces on purpose. They ask the same question in two
   places and differ only in framing, so a second copy would be the shape
   .claude/rules/shared-constants-across-the-stack.md warns about — the copy
   nobody remembers is the one that rots, and here it would rot into a chooser
   offering a design the Konto screen no longer does.

   The material tile is built from the design's OWN registry colours (page +
   accent), so a design added later gets a tile for free. Klassisch declares no
   colours — it IS the :root default (designs.js's header says why restating
   them would drift) — so its tile carries no inline properties and styles.css's
   `.design-tile` defaults paint it. Those two values are a licensed copy,
   guarded by test/design-picker.test.js against :root.

   The Konto SECTION lives here too rather than in views-account.js, for the
   reason above plus one of its own: that file holds a dozen independently
   editable concerns already and is the repo's standing example of a view
   regrowing past its budget (.claude/rules/token-friendly-source-files.md).
   Design is a whole concern with its own async gate, so it arrives as its own
   file rather than as the section that pushes that one over.

   No module.exports: everything here touches `document`, so requiring it from
   Node would enter the coverage report almost entirely unreachable and drag
   coverage:ci under its floor
   (.claude/rules/frontend-helper-modules-and-coverage.md). The specs reach it
   through the jsdom harness (test/support/dom.js). */

'use strict';

// Which designs this instance actually offers. The server resolved `enabled`
// against NODE_ENV and reported the result on GET /api/config, so the client
// never re-derives it — in production that list holds only live designs. `cfg`
// is passed in rather than read from a module global, because the config
// arrives asynchronously (withAppConfig) and a synchronous read at boot would
// see null and silently offer the face alone.
function offeredDesigns(cfg) {
  const ids = (cfg && Array.isArray(cfg.designs)) ? cfg.designs : [FACE_DESIGN];
  // Registry order, not config order: the face comes first, which is what puts
  // „Klassisch — wie bisher" at the head of the list without a sort key.
  return DESIGN_REGISTRY.filter((d) => ids.indexOf(d.id) !== -1);
}

// A design's swatch. The two inline properties are set ONLY when the design
// declares them, because setting them from a fallback would restate Klassisch's
// colours in JS — the exact duplication designs.js exists to avoid.
function designTile(design) {
  const tile = h('<span class="design-tile" aria-hidden="true"></span>');
  if (design.page) tile.style.setProperty('--tile-page', design.page);
  if (design.accent) tile.style.setProperty('--tile-accent', design.accent);
  return tile;
}

/* The card list. `current` is the design in force, `onPick` is handed the id of
   whatever the user chose — the caller owns persisting it, because the Konto
   screen and the chooser sheet write it through different endpoints.

   Radios rather than buttons: this is a single choice among a known set, which
   is what a radio group IS — so arrow keys move within it, the group takes one
   tab stop, and a screen reader announces the position without any aria
   bookkeeping (.claude/rules/accessibility-contrast-and-modals.md). */
function renderDesignPicker(cfg, current, onPick) {
  const list = h(`<div class="design-picker" role="radiogroup" aria-label="${esc(t('design.pick.label'))}"></div>`);
  for (const design of offeredDesigns(cfg)) {
    const on = design.id === current;
    const card = h(`<label class="design-card${on ? ' is-on' : ''}">
        <input type="radio" name="designPick" value="${esc(design.id)}"${on ? ' checked' : ''}>
        <span class="design-card__body">
          <span class="design-card__name">${esc(t(design.labelKey))}${
  design.id === FACE_DESIGN ? `<span class="design-card__badge">${esc(t('design.klassisch.badge'))}</span>` : ''}</span>
          <span class="design-card__desc">${esc(t(design.descKey))}</span>
        </span>
      </label>`);
    card.insertBefore(designTile(design), card.querySelector('.design-card__body'));
    card.querySelector('input').addEventListener('change', () => {
      for (const other of list.querySelectorAll('.design-card')) other.classList.remove('is-on');
      card.classList.add('is-on');
      onPick(design.id);
    });
    list.appendChild(card);
  }
  return list;
}

/* The design picker section (#1186).

   Built EMPTY and filled from withAppConfig, because which designs exist is the
   server's answer (`enabled` resolved against NODE_ENV) and it arrives
   asynchronously. The heading is appended in the same callback rather than up
   front, so an instance offering a single design — which is production today,
   before the flip (#1202) — renders no heading over an empty box. A picker with
   one card is not a choice, and a section announcing one is worse than none.

   The pick is saved IMMEDIATELY, with no save button. It is a preference with a
   visible effect and an obvious undo (pick the other card), which is the same
   shape the notify and stats toggles use — a Save button here would leave the
   page already wearing a design the account does not hold. */
function buildDesignSection(me) {
  const wrap = h('<div class="konto-design"></div>');
  withAppConfig((cfg) => {
    if (offeredDesigns(cfg).length < 2) return;
    wrap.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.design.title'))}</h2>`));
    wrap.appendChild(h(`<p class="muted">${esc(t('konto.design.hint'))}</p>`));
    wrap.appendChild(renderDesignPicker(cfg, me.design, async (id) => {
      // Applied before the request, so the card the user tapped is what they
      // see while it is in flight. A refusal reverts below — the server is the
      // authority on which designs exist, and it may have retired one since
      // this screen loaded.
      applyDesign(id);
      try {
        const updated = await accountApi('PATCH', '/me', { design: id });
        accountUser = updated;
        me.design = updated.design;
        applyAccountDesign();
        toast(t('konto.design.saved'));
      } catch (ex) {
        // Revert the paint, then re-render so the radios agree with what is
        // actually stored — leaving the refused card checked over a reverted
        // page is the one state that tells the user nothing. `auth` has already
        // bounced to login, so it gets no toast (the shape buildPrefToggle uses).
        applyAccountDesign();
        if (ex.message !== 'auth') {
          toast(t(ex.message === 'invalid_design' ? 'konto.design.invalid' : 'auth.error.network'));
          if (currentView) currentView();
        }
      }
    }));
    wrap.appendChild(h(`<p class="muted konto-design__foot">${esc(t('konto.design.note'))}</p>`));
  });
  return wrap;
}

/* The one-time chooser (T5.3). Two conditions, both necessary:

   - MORE THAN ONE design is offered. With a single one there is no choice to
     make, and a sheet announcing "pick a design" over one card is worse than
     silence. This is also why nothing fires in production before the flip
     (#1202) — only Klassisch is `enabled` there today.
   - the account has not seen THIS run of it (designChooserSeen). A revision
     rather than a boolean so a later design can ask once more; designs.js has
     the reasoning.

   Marked seen by BOTH answers, including „Später entscheiden" and a dismissal:
   the copy promises it appears once, and a sheet that returns on the next load
   because the user declined it is the thing that teaches people to dismiss
   notices unread (lib/legal.js's own comment about the terms banner). */
function maybeShowDesignChooser(me, onDone) {
  if (!me || me.designChooserSeen === DESIGN_CHOOSER_REVISION) return;
  withAppConfig((cfg) => {
    if (offeredDesigns(cfg).length < 2) return;
    showDesignChooser(cfg, me, onDone);
  });
}

function showDesignChooser(cfg, me, onDone) {
  const backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
      <div class="sheet sheet--dialog design-chooser" role="dialog" aria-modal="true" aria-labelledby="designChooserTitle">
        <div class="sheet__head sheet__head--stacked">
          <p class="design-chooser__kicker">${esc(t('design.chooser.kicker'))}</p>
          <h2 id="designChooserTitle">${esc(t('design.chooser.title'))}</h2>
        </div>
        <p class="muted">${esc(t('design.chooser.body'))}</p>
        <div class="design-chooser__list"></div>
        <p class="muted design-chooser__foot">${esc(t('design.chooser.later'))}</p>
        <div class="sheet__actions">
          <button type="button" class="btn btn--ghost" id="designChooserSkip">${esc(t('design.chooser.skip'))}</button>
          <button type="button" class="btn btn--primary" id="designChooserGo">${esc(t('design.chooser.confirm'))}</button>
        </div>
      </div>
    </div>`);
  // Applied live as the user moves through the cards — what a design IS is what
  // it looks like, and a preview is exactly what a sentence describing one
  // cannot replace. `chosen` is what gets STORED on confirm.
  const before = (me && me.design) || FACE_DESIGN;
  let chosen = before;
  backdrop.querySelector('.design-chooser__list')
    .appendChild(renderDesignPicker(cfg, chosen, (id) => { chosen = id; applyDesign(id); }));
  document.body.appendChild(backdrop);

  // `settled` guards a genuinely multi-path exit: the two buttons call finish()
  // directly, while Escape and the history Back arrive through closeSheet's
  // onClose. It is set BEFORE closeSheet() so finish's own call cannot re-enter
  // through that callback and fire the request twice.
  let settled = false;
  function finish(keep) {
    if (settled) return;
    settled = true;
    // Revert first when declining, so „Später entscheiden" leaves the account
    // exactly as it was rather than silently keeping the last card previewed.
    if (!keep) applyDesign(before);
    closeSheet();
    // ONE request either way. Storing the pick and the seen-stamp separately
    // would leave a window in which the chooser has been answered and not
    // recorded — a reload there shows it again over the design it just set.
    accountApi('POST', '/design-chooser-seen', keep ? { design: chosen } : {})
      .then((updated) => {
        accountUser = updated;
        applyAccountDesign();
        if (onDone) onDone(updated);
      })
      .catch(() => { /* accountApi has already handled a dead session */ });
  }

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey, true);
  openSheet(backdrop, onKey, () => finish(false));
  backdrop.querySelector('#designChooserSkip').addEventListener('click', () => finish(false));
  backdrop.querySelector('#designChooserGo').addEventListener('click', () => finish(true));
}
