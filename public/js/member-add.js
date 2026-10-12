'use strict';

/* The „+" seat in a round's member strips (#563): the Start tab's hero below
   1280px and the desktop rail above it. Its own file since #1618 — it is the
   round's member STRIP, not the member page, and neither caller is
   views-member.js. Called only from inside click/render paths, so its place in
   the load order is free (.claude/rules/frontend-script-load-order.md). */

// The "+" trigger for the member strips, built in one place so the hero and the
// rail cannot drift apart on markup or labelling. Icon-only, so it carries an
// aria-label — the title alone is not an accessible name for a screen reader.
function addMemberBtn(round) {
  const btn = h(`<button class="avatar avatar--add" title="${esc(t('member.add'))}" aria-label="${esc(t('member.add'))}"><i class="ti ti-plus" aria-hidden="true"></i></button>`);
  btn.addEventListener('click', () => openAddMember(btn, round));
  return btn;
}

// The "+" seat in a round's member strip (#563). Lives here rather than in either
// caller because the SAME strip is rendered twice — the Start tab's hero below
// 1280px and the desktop rail above it — and both need this entry point for it to
// be reachable at every width.
//
// It goes through openEditor, never openPopover directly: it holds a text input,
// and an anchored popover cannot hold one on a phone — focusing the field makes
// the browser scroll the page, and openPopover's own scroll teardown then closes
// it before the keyboard finishes opening
// (.claude/rules/popover-vs-sheet-editors.md). openEditor gives the sheet
// presentation below 860px, and with it the focus trap (#145) and Back-dismissal
// (#333). The whole path stays synchronous from the click handler so iOS raises
// the keyboard, which is why the focus happens in the returned callback.
function openAddMember(anchor, round) {
  openEditor(anchor, 'add-member', t('member.add'), (el, close) => {
    // No maxlength: no member-name input in the app has one (the rename field and
    // the new-round form both omit it) and the route sets no ceiling either, so a
    // cap here alone would be cosmetic and asymmetric.
    const input = h(`<input class="input" placeholder="${esc(t('member.addPlaceholder'))}" autocorrect="off" spellcheck="false" />`);
    const okBtn = h(`<button class="btn btn--primary">${esc(t('common.add'))}</button>`);
    const save = async () => {
      const name = input.value.trim();
      // Client-side first so a blank name never round-trips; the route validates
      // the same shape as the backstop.
      if (!name) return toast(t('member.toast.needName'));
      close();
      try {
        await api('POST', `/api/rounds/${round.id}/members`, { name });
        toast(t('member.toast.added', { name }));
        // Re-render whatever screen we are on. currentView() rather than a fixed
        // showRound(): the rail carries this strip on every round screen, so the
        // "+" can be clicked from the Regal, the Chronik or a sub-screen too.
        currentView();
      } catch (e) {
        toast(e.message === 'quota_members' ? t('member.toast.quota') : e.message, { tone: 'error' });
      }
    };
    okBtn.addEventListener('click', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    const row = h('<div class="pp-row"></div>');
    row.appendChild(input);
    row.appendChild(okBtn);
    el.appendChild(row);
    return () => input.focus();
  });
}
