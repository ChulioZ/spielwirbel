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
  // Registry order, not config order: Klassisch is the registry's first row,
  // which is what puts „Klassisch — wie bisher" at the head of the list without
  // a sort key.
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

/* A design's BILL (#1277): the same tile, printed — its wordmark and, on a
   poster, its tagline, in the design's own poster colours. Built only under a
   design that composes the chooser as posters (Der Tisch), so designTile above
   and every Klassisch surface stay byte-for-byte what they were.

   Painted from registry DATA, never from the offered design's stylesheet: the
   chooser shows every design at once while the page wears one, and loading
   seven stylesheets to draw seven posters would also apply them. Every field is
   optional (designs.js lists the fallbacks), so a design added before it ships
   its poster copy still prints a bill with its name on its own page tone.

   aria-hidden like the tile: it is the PICTURE of the material. The name, the
   sentence and the ritual words beside it carry everything it says. */
// `name: true` prints the design's NAME instead of its wordmark — the phone
// row's 58px tile, where a one-word wordmark like „Spielwirbel" only fits by
// breaking mid-word (#1277 review). The name is short by construction.
function designBill(design, { tagline = false, name = false } = {}) {
  const bill = designTile(design);
  bill.classList.add('design-tile--bill');
  const poster = design.poster;
  if (poster) {
    bill.style.setProperty('--poster-top', poster.ground[0]);
    bill.style.setProperty('--poster-foot', poster.ground[1]);
    bill.style.setProperty('--poster-ink', poster.ink);
    bill.style.setProperty('--poster-sub', poster.sub);
  }
  bill.appendChild(h(`<span class="design-tile__word">${esc(t((!name && design.wordmarkKey) || design.labelKey))}</span>`));
  if (tagline && design.taglineKey) {
    bill.appendChild(h(`<span class="design-tile__sub">${esc(t(design.taglineKey))}</span>`));
  }
  return bill;
}

// The words a design says at the table, or '' when it names none.
function designRitualWords(design) {
  return (design.ritualKeys || []).map((key) => t(key)).join(' · ');
}

/* A design's POSTCARD art (#1215, Ocean's O5.3-O5.5): the tile again, painted
   in the design's own poster ground and carrying its SIGN (`glyph`) instead of
   a wordmark — Ocean prints each design as its mark, „kein stiller
   Markenwechsel". Built only while Ocean is worn, so every other surface keeps
   designTile/designBill exactly as they were. Like the bill it paints from
   registry DATA, never from a design's stylesheet (designPosterSheet says why),
   and it is aria-hidden: the name beside it says everything it shows. */
function designGlyphTile(design) {
  const tile = designTile(design);
  tile.classList.add('design-tile--glyph');
  const poster = design.poster;
  if (poster) {
    tile.style.setProperty('--poster-top', poster.ground[0]);
    tile.style.setProperty('--poster-foot', poster.ground[1]);
    tile.style.setProperty('--poster-ink', poster.ink);
  }
  tile.appendChild(h(`<i class="ti ${esc(design.glyph || 'ti-palette')}"></i>`));
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
  // Ocean's O5.5 draws the Konto list as a grid of SIGNS — the design's glyph
  // on its own ground and its name, no sentence: at four across a 700px card a
  // description would wrap into a column of single words.
  const ocean = designIs('ocean');
  for (const design of offeredDesigns(cfg)) {
    const on = design.id === current;
    const card = h(`<label class="design-card${on ? ' is-on' : ''}">
        <input type="radio" name="designPick" value="${esc(design.id)}"${on ? ' checked' : ''}>
        <span class="design-card__body">
          <span class="design-card__name">${esc(t(design.labelKey))}${
  design.id === CLASSIC_DESIGN ? `<span class="design-card__badge">${esc(t('design.klassisch.badge'))}</span>` : ''}</span>
          ${ocean ? '' : `<span class="design-card__desc">${esc(t(design.descKey))}</span>`}
        </span>
      </label>`);
    // Der Tisch prints the Konto cards as T5.2's small bills (wordmark, no
    // tagline), Ocean as O5.5's signs; Klassisch keeps its swatch.
    let art = designTile(design);
    if (designIs('tisch')) art = designBill(design);
    else if (ocean) art = designGlyphTile(design);
    card.insertBefore(art, card.querySelector('.design-card__body'));
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
   front, so an instance offering a single design renders no heading over an
   empty box. A picker with
   one card is not a choice, and a section announcing one is worse than none.

   The pick is saved IMMEDIATELY, with no save button. It is a preference with a
   visible effect and an obvious undo (pick the other card), which is the same
   shape the notify and stats toggles use — a Save button here would leave the
   page already wearing a design the account does not hold.

   A stored pick re-renders the screen HERE rather than through applyDesign's
   central re-render (#1266): the new design may compose Konto differently
   (#1265's dashboard), and the element that held focus is replaced, so focus
   goes back to the radio just chosen. Hence the `{ rendering: true }` commit. */
function buildDesignSection(me) {
  const wrap = h('<div class="konto-design"></div>');
  withAppConfig((cfg) => {
    if (offeredDesigns(cfg).length < 2) return;
    // Ocean (O5.5) sets the hint on the heading's baseline and the closing
    // note in an info box; the words, and their order, are Klassisch's.
    const ocean = designIs('ocean');
    if (ocean) wrap.classList.add('konto-design--card');
    const head = ocean ? wrap.appendChild(h('<div class="konto-design__head"></div>')) : wrap;
    head.appendChild(h(`<h2 class="konto-section__h">${esc(t('konto.design.title'))}</h2>`));
    head.appendChild(h(`<p class="muted">${esc(t('konto.design.hint'))}</p>`));
    wrap.appendChild(renderDesignPicker(cfg, me.design, async (id) => {
      // Applied before the request, so the card the user tapped is what they
      // see while it is in flight. A refusal reverts below — the server is the
      // authority on which designs exist, and it may have retired one since
      // this screen loaded. A PREVIEW until the server agrees: committing here
      // would re-render the page from the not-yet-updated account, with the old
      // card checked. The commit below comes after the account is updated.
      applyDesign(id, { preview: true });
      try {
        const updated = await accountApi('PATCH', '/me', { design: id });
        accountUser = updated;
        me.design = updated.design;
        applyAccountDesign({ rendering: true });
        toast(t('konto.design.saved'));
        if (currentView) {
          await currentView();
          const picked = document.querySelector('.design-picker input:checked');
          if (picked) picked.focus();
        }
      } catch (ex) {
        // Revert the paint, then re-render so the radios agree with what is
        // actually stored — leaving the refused card checked over a reverted
        // page is the one state that tells the user nothing. `auth` has already
        // bounced to login, so it gets no toast (the shape buildPrefToggle uses).
        // The pick was only previewed, so the revert commits nothing and
        // re-renders nothing — hence the explicit currentView() below.
        applyAccountDesign();
        if (ex.message !== 'auth') {
          toast(t(ex.message === 'invalid_design' ? 'konto.design.invalid' : 'auth.error.network'), { tone: 'error' });
          if (currentView) currentView();
        }
      }
    }));
    wrap.appendChild(ocean
      ? h(`<p class="muted konto-design__foot konto-design__note"><i class="ti ti-info-circle" aria-hidden="true"></i><span>${esc(t('konto.design.note'))}</span></p>`)
      : h(`<p class="muted konto-design__foot">${esc(t('konto.design.note'))}</p>`));
  });
  return wrap;
}

/* The one-time chooser (T5.3). Two conditions, both necessary:

   - MORE THAN ONE design is offered. With a single one there is no choice to
     make, and a sheet announcing "pick a design" over one card is worse than
     silence. This is also why nothing fired in production before the flip
     (#1202), when only Klassisch was `enabled`.
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

/* The chooser as POSTERS (#1277, T5.3 at 1440, T5.4 at 390) — Der Tisch's
   composition of the same question, built only while it is worn.

   BOTH presentations are in the DOM and the stylesheet shows one per width
   (the app's own 640px sheet breakpoint), because they are different CONTROLS,
   not one control restyled:

   - from 640, a grid of posters, each with ITS OWN button — one press is the
     answer, so there is nothing to confirm (T5.3);
   - below it, a radio row per design and ONE commit button under them (T5.4),
     because a 76px row is too small to carry a second target beside its
     radio.

   The hidden one is display:none, so it is out of the tab order and the
   accessibility tree rather than merely out of sight. „Später entscheiden"
   likewise exists twice: top right with the posters, under the commit button
   on the phone — each in its own presentation, so DOM order stays visual order.

   NO live preview, unlike the Klassisch chooser: this markup is Der Tisch's,
   styled by Der Tisch's stylesheet, so previewing another design would repaint
   the sheet in rules that do not know it. The bills ARE the preview — that is
   what painting them from the registry is for. */
function designPosterSheet(cfg, current) {
  const designs = offeredDesigns(cfg);
  const badge = (design) => {
    if (design.id === CLASSIC_DESIGN) return `<span class="design-card__badge">${esc(t('design.klassisch.badge'))}</span>`;
    if (design.id === current) return `<span class="design-card__badge">${esc(t('design.poster.picked'))}</span>`;
    return '';
  };
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet design-chooser design-chooser--posters" role="dialog" aria-modal="true" aria-labelledby="designChooserTitle">
        <div class="sheet__head design-chooser__head">
          <div class="design-chooser__intro">
            <p class="design-chooser__kicker">${esc(t('design.chooser.kicker'))}</p>
            <h2 id="designChooserTitle">${esc(t('design.chooser.title'))}</h2>
            <p class="muted design-chooser__body">${esc(t('design.chooser.body'))}</p>
          </div>
          <button type="button" class="btn btn--ghost design-chooser__skip" id="designChooserSkip">${esc(t('design.chooser.skip'))}</button>
        </div>
        <ul class="design-posters"></ul>
        <div class="design-rows" role="radiogroup" aria-labelledby="designChooserTitle"></div>
        <div class="design-chooser__commit">
          <button type="button" class="btn btn--primary btn--lg" id="designChooserGo"></button>
          <button type="button" class="btn btn--ghost" id="designChooserSkipRow">${esc(t('design.chooser.skip'))}</button>
        </div>
      </div>
    </div>`);

  const posters = backdrop.querySelector('.design-posters');
  const rows = backdrop.querySelector('.design-rows');
  for (const design of designs) {
    const on = design.id === current;
    const name = t(design.labelKey);
    const words = designRitualWords(design);
    const poster = h(`<li class="design-poster${on ? ' is-on' : ''}">
        <div class="design-poster__body">
          <h3 class="design-poster__name">${esc(name)}${badge(design)}</h3>
          <p class="design-poster__desc">${esc(t(design.descKey))}</p>
          ${words ? `<p class="design-poster__words">${esc(words)}</p>` : ''}
          <button type="button" class="btn ${on ? 'btn--primary' : 'btn--ghost'} design-poster__pick" data-design="${esc(design.id)}">${
  esc(t(on ? 'design.poster.picked' : 'design.poster.pick'))}<span class="sr-only"> — ${esc(name)}</span></button>
        </div>
      </li>`);
    poster.insertBefore(designBill(design, { tagline: true }), poster.firstChild);
    posters.appendChild(poster);

    const row = h(`<label class="design-row${on ? ' is-on' : ''}">
        <span class="design-row__body">
          <span class="design-row__name">${esc(name)}${badge(design)}</span>
          <span class="design-row__desc">${esc(t(design.shortKey || design.descKey))}</span>
        </span>
        <input type="radio" name="designRow" value="${esc(design.id)}"${on ? ' checked' : ''}>
      </label>`);
    row.insertBefore(designBill(design, { name: true }), row.firstChild);
    rows.appendChild(row);
  }
  // T5.3's closing tile: a promise, not a control — it names no design and
  // offers nothing to press, so it is a list item with text and no button.
  posters.appendChild(h(`<li class="design-poster design-poster--later">
      <i class="ti ti-palette" aria-hidden="true"></i>
      <span class="design-poster__name">${esc(t('design.chooser.moreTitle'))}</span>
      <span class="design-poster__desc">${esc(t('design.chooser.later'))}</span>
    </li>`));
  return backdrop;
}

/* The chooser as POSTCARDS (#1215, O5.3 at 1440, O5.4 at 390) — Ocean's
   composition of the same question, built only while it is worn.

   Unlike Der Tisch's posters, ONE presentation serves both widths, because the
   sheet draws one control at both: every card is a radio that only SELECTS,
   and a single commit button — named after the pick, „Ocean übernehmen" —
   answers. From 640 that button stands in its own column beside the cards
   (O5.3's last cell); on a phone it is the sheet's sticky foot under the
   stacked rows (O5.4). The stylesheet moves one element rather than the DOM
   holding two.

   NO live preview, for designPosterSheet's reason: this markup is Ocean's, and
   previewing another design would repaint it in rules that do not know it. The
   postcards ARE the preview — which is what painting them from the registry is
   for. */
function designCardSheet(cfg, current) {
  const backdrop = h(`<div class="sheet-backdrop">
      <div class="sheet design-chooser design-chooser--cards" role="dialog" aria-modal="true" aria-labelledby="designChooserTitle">
        <div class="sheet__head sheet__head--stacked design-chooser__head">
          <p class="design-chooser__kicker">${esc(t('design.chooser.kicker'))}</p>
          <h2 id="designChooserTitle">${esc(t('design.chooser.title'))}</h2>
          <p class="muted design-chooser__body">${esc(t('design.chooser.body'))}</p>
        </div>
        <div class="design-deck">
          <div class="design-postcards" role="radiogroup" aria-labelledby="designChooserTitle"></div>
          <div class="design-deck__commit">
            <p class="design-deck__picked"></p>
            <button type="button" class="btn btn--primary btn--lg" id="designChooserGo"></button>
            <button type="button" class="btn btn--ghost" id="designChooserSkip">${esc(t('design.chooser.skip'))}</button>
            <p class="muted design-deck__later">${esc(t('design.chooser.later'))}</p>
          </div>
        </div>
      </div>
    </div>`);
  const cards = backdrop.querySelector('.design-postcards');
  for (const design of offeredDesigns(cfg)) {
    const on = design.id === current;
    const card = h(`<label class="design-postcard${on ? ' is-on' : ''}">
        <input type="radio" name="designCard" value="${esc(design.id)}"${on ? ' checked' : ''}>
        <span class="design-postcard__body">
          <span class="design-postcard__name">${esc(t(design.labelKey))}${
  design.id === CLASSIC_DESIGN ? `<span class="design-card__badge">${esc(t('design.klassisch.badge'))}</span>` : ''}</span>
          <span class="design-postcard__desc">${esc(t(design.descKey))}</span>
          ${design.shortKey ? `<span class="design-postcard__tag">${esc(t(design.shortKey))}</span>` : ''}
        </span>
      </label>`);
    const art = designGlyphTile(design);
    // The check sits on the art, as O5.3 draws it; the stylesheet shows it on
    // the picked card only.
    art.appendChild(h('<span class="design-postcard__check"><i class="ti ti-check"></i></span>'));
    card.insertBefore(art, card.querySelector('.design-postcard__body'));
    cards.appendChild(card);
  }
  return backdrop;
}

// The readout over the postcards' commit button: „Du hast Ocean gewählt." The
// name is set in bold, so the sentence is split around a placeholder rather
// than escaped whole.
function labelDesignPicked(el, id) {
  const design = designById(id) || designById(FACE_DESIGN);
  const mark = '\u0001';
  el.innerHTML = esc(t('design.chooser.pickedNamed', { name: mark }))
    .replace(mark, `<strong>${esc(t(design.labelKey))}</strong>`);
}

// The phone's commit button names what it will keep, as T5.4 prints it.
function labelDesignCommit(button, id) {
  const design = designById(id) || designById(FACE_DESIGN);
  button.textContent = t('design.chooser.confirmNamed', { name: t(design.labelKey) });
}

function showDesignChooser(cfg, me, onDone) {
  const before = (me && me.design) || FACE_DESIGN;
  // `chosen` is what gets STORED on the answer.
  let chosen = before;
  const posters = designIs('tisch');
  const postcards = !posters && designIs('ocean');
  let backdrop;
  if (posters) {
    backdrop = designPosterSheet(cfg, before);
  } else if (postcards) {
    backdrop = designCardSheet(cfg, before);
  } else {
    backdrop = h(`<div class="sheet-backdrop sheet-backdrop--center">
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
    // Applied live as the user moves through the cards — what a design IS is
    // what it looks like, and a preview is exactly what a sentence describing
    // one cannot replace.
    backdrop.querySelector('.design-chooser__list')
      .appendChild(renderDesignPicker(cfg, chosen, (id) => { chosen = id; applyDesign(id, { preview: true }); }));
  }
  document.body.appendChild(backdrop);

  // `settled` guards a genuinely multi-path exit: the buttons call finish()
  // directly, while Escape and the history Back arrive through closeSheet's
  // onClose. It is set BEFORE closeSheet() so finish's own call cannot re-enter
  // through that callback and fire the request twice.
  let settled = false;
  function finish(keep) {
    if (settled) return;
    settled = true;
    // Revert first when declining, so „Später entscheiden" leaves the account
    // exactly as it was rather than silently keeping the last card previewed.
    // The posters preview nothing, so a kept poster is painted HERE instead —
    // at once, rather than one round trip later.
    if (!keep) applyDesign(before);
    else if (posters || postcards) applyDesign(chosen, { preview: true });
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
  const go = backdrop.querySelector('#designChooserGo');
  backdrop.querySelector('#designChooserSkip').addEventListener('click', () => finish(false));
  go.addEventListener('click', () => finish(true));
  if (postcards) {
    // A card only selects; the one commit button answers, and says what it keeps.
    const picked = backdrop.querySelector('.design-deck__picked');
    const relabel = () => { labelDesignCommit(go, chosen); labelDesignPicked(picked, chosen); };
    relabel();
    for (const radio of backdrop.querySelectorAll('.design-postcard input')) {
      radio.addEventListener('change', () => {
        chosen = radio.value;
        for (const card of backdrop.querySelectorAll('.design-postcard')) {
          card.classList.toggle('is-on', card.contains(radio));
        }
        relabel();
      });
    }
    return;
  }
  if (!posters) return;

  // A poster's own button IS the answer (T5.3) — including the one on the
  // design already worn, which keeps it and records the chooser as seen.
  for (const pick of backdrop.querySelectorAll('.design-poster__pick')) {
    pick.addEventListener('click', () => { chosen = pick.dataset.design; finish(true); });
  }
  // A row only selects (T5.4); the commit button under the list answers.
  labelDesignCommit(go, chosen);
  for (const radio of backdrop.querySelectorAll('.design-row input')) {
    radio.addEventListener('change', () => {
      chosen = radio.value;
      for (const row of backdrop.querySelectorAll('.design-row')) {
        row.classList.toggle('is-on', row.contains(radio));
      }
      labelDesignCommit(go, chosen);
    });
  }
  backdrop.querySelector('#designChooserSkipRow').addEventListener('click', () => finish(false));
}
