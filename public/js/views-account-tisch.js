/* Spielwirbel – Konto as Der Tisch composes it (#1265, T5.2 at 1440, T5.4 at 390).

   A dashboard of cards rather than today's single column of stacked forms:
   a „Du" card (who you are, then every setting as a row), the Design card beside
   it from the rail breakpoint, then the BoardGameGeek row card and the danger
   card. Below 1280 the same cards stack in the same DOM order, so the reading
   order is the visual order at every width (WCAG 2.4.3).

   What this file does NOT do is fork a single form. Every setting is the builder
   views-account.js already uses — same fields, same validation, same error keys,
   same toasts — placed inside a row's disclosure panel. A setting therefore
   takes one more activation to reach than in Klassisch (the issue's Operator
   question 1), and that is the whole behavioural difference.

   The order of the rows is the APP's, not the sheet's: T5.2 draws the passkey
   above the password, and the operator's ruling on #1265 names exactly that as
   an incidental reordering not to copy.

   Its own file rather than a branch inside views-account.js: that file is on the
   token budget's allowlist already (.claude/rules/token-friendly-source-files.md),
   and a design's composition of the screen is a concern of its own. Loaded after
   views-account.js, whose builders it calls only at render time. */

'use strict';

// After a design pick is stored: re-render if the screen's COMPOSITION changed.
// Picking Klassisch on the dashboard (or Der Tisch on the plain column) would
// otherwise leave one design's markup under the other's paint until the next
// navigation. Focus goes back to the radio just chosen, since the re-render
// replaced the element that held it.
async function kontoRestructure(wasTisch) {
  if (designIs('tisch') === wasTisch || !currentView) return;
  await currentView();
  const picked = document.querySelector('.design-picker input:checked');
  if (picked) picked.focus();
}

function renderKontoDashboard(me) {
  const dash = h('<div class="konto-dash"></div>');
  dash.appendChild(buildKontoDuCard(me));

  // The Design card IS the section: buildDesignSection fills it only when the
  // instance offers a choice, and an empty card is hidden by tisch.css rather
  // than framing nothing.
  const design = buildDesignSection(me, () => kontoRestructure(true));
  design.classList.add('konto-card', 'konto-card--design');
  dash.appendChild(design);

  dash.appendChild(buildKontoBggCard(me));

  // A demo stops here, for the reasons the Klassisch column gives at its own
  // demo return: no install nudge for an account on a TTL, and its erasure is
  // „Demo beenden" in the account menu.
  if (!me.demo) {
    const install = buildInstallSection();
    if (install) dash.appendChild(install);
    const danger = buildDeleteSection(me);
    danger.classList.add('konto-card', 'konto-card--danger');
    danger.prepend(h(`<h2 class="konto-card__h konto-section__h--danger">${iconText('ti-alert-triangle', t('konto.delete.title'))}</h2>`));
    dash.appendChild(danger);
  }
  app.appendChild(dash);
}

/* The „Du" card: who you are, then one row per setting. */
function buildKontoDuCard(me) {
  const card = h(`<section class="konto-card konto-card--du" aria-labelledby="kontoDuTitle">
      <h2 class="konto-card__h" id="kontoDuTitle">${esc(t('konto.du.title'))}</h2>
    </section>`);

  // The handle is the profile's address, so it is the link to it (#1089) —
  // exactly as the Klassisch facts row makes it. An account mid-erasure has no
  // handle and gets a dash rather than an anchor with nowhere to go.
  const who = h(`<div class="konto-du__who">
      ${me.username ? '<a class="konto-du__name"></a>' : '<span class="konto-du__name">—</span>'}
      <span class="konto-du__meta"></span>
    </div>`);
  if (me.username) {
    const name = who.querySelector('.konto-du__name');
    name.textContent = me.username;
    navLink(name, profilePath(me.username), () => showProfile(me.username));
  }
  // A demo's stored address is a synthetic placeholder (see showAccount), so it
  // is not shown at all rather than shown as a dash beside the member-since.
  const meta = [me.demo ? '' : me.email, me.createdAt ? t('konto.du.since', { date: fmtMonth(me.createdAt) }) : '']
    .filter(Boolean).join(' · ');
  who.querySelector('.konto-du__meta').textContent = meta;

  if (me.demo) {
    // No picture form for a demo (the route answers 403), so the head carries
    // the initials disc the form would have shown, and nothing to press.
    const head = h('<div class="konto-avatar"></div>');
    const color = MEMBER_COLORS[gameHue(me.username || '?') % MEMBER_COLORS.length];
    head.appendChild(h(`<span class="avatar konto-avatar__preview" style="background:${color}" aria-hidden="true">${
      avatarFace(initials(me.username || '?'), { src: null })
    }</span>`));
    head.appendChild(who);
    card.appendChild(head);
  } else {
    card.appendChild(buildAvatarForm(me, who));
  }

  const rows = h('<div class="konto-rows"></div>');
  rows.appendChild(kontoRow('profile', 'ti-user-circle', t('konto.profile.title'), buildProfileStatsForm(me), kontoToggleValue));
  rows.appendChild(kontoRow('bgstats', 'ti-activity', t('konto.bgstats.title'), buildBgStatsForm(me), kontoToggleValue));
  if (me.demo) {
    card.appendChild(rows);
    card.appendChild(h(`<p class="muted konto-du__demo"><strong>${esc(t('konto.demo.title'))}</strong> — ${esc(t('konto.demo.note'))}</p>`));
    return card;
  }
  rows.appendChild(kontoRow('notify', 'ti-mail', t('konto.notify.title'), buildNotifyForm(me), kontoToggleValue));
  rows.appendChild(kontoRow('email', 'ti-mail-check', t('konto.email.title'), buildEmailForm(me),
    (panel) => (panel.querySelector('.konto-email__pending') ? t('konto.row.pending') : '')));
  // Password ABOVE passkey — the app's order, not T5.2's (see the header).
  rows.appendChild(kontoRow('pw', 'ti-lock', t('konto.pw.title'), buildPasswordForm()));
  rows.appendChild(kontoRow('passkey', 'ti-fingerprint', t('konto.passkey.title'), buildPasskeySection()));
  card.appendChild(rows);
  return card;
}

// A toggle group's current value, read off its own checkboxes so the row can
// never disagree with the controls it opens.
function kontoToggleValue(panel) {
  const boxes = [...panel.querySelectorAll('input[type=checkbox]')];
  const on = boxes.filter((b) => b.checked).length;
  if (!boxes.length) return '';
  if (on === boxes.length) return t('konto.row.on');
  return on ? t('konto.row.partly') : t('konto.row.off');
}

/* One setting row: a disclosure button — label, current value, chevron — over a
   panel holding the setting's existing form.

   A button with aria-expanded inside a heading, i.e. the APG accordion: the
   heading keeps each setting reachable by heading navigation, which is how a
   screen-reader user moved through the Klassisch column's h2s. The panel is
   built eagerly and only HIDDEN, so every builder runs exactly once, as it does
   in Klassisch (the passkey list is fetched on render either way). */
function kontoRow(key, icon, label, panel, valueOf) {
  const id = `kontoPanel-${key}`;
  const row = h(`<div class="konto-row">
      <h3 class="konto-row__h">
        <button type="button" class="konto-row__btn" aria-expanded="false" aria-controls="${id}">
          <i class="ti ${icon} konto-row__icon" aria-hidden="true"></i>
          <span class="konto-row__label">${esc(label)}</span>
          <span class="konto-row__value"></span>
          <i class="ti ti-chevron-right konto-row__chev" aria-hidden="true"></i>
        </button>
      </h3>
      <div class="konto-row__panel" id="${id}" hidden></div>
    </div>`);
  const btn = row.querySelector('.konto-row__btn');
  const value = row.querySelector('.konto-row__value');
  const box = row.querySelector('.konto-row__panel');
  box.appendChild(panel);

  const refresh = () => { value.textContent = valueOf ? valueOf(box) : ''; };
  refresh();
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    box.hidden = !open;
    refresh();
  });
  // A toggle saves on change; the row's value follows it at once. A refused
  // save puts the box back without a second change event, so the value is
  // re-read on every open/close too.
  box.addEventListener('change', refresh);
  return row;
}

/* The BoardGameGeek row card — T5.2's single line: what it is on the left, the
   field and its button on the right. The form is buildBggForm unchanged. */
function buildKontoBggCard(me) {
  const card = h(`<section class="konto-card konto-card--bgg" aria-labelledby="kontoBggTitle">
      <h2 class="konto-card__h" id="kontoBggTitle">${iconText('ti-cards', t('konto.bgg.title'))}</h2>
    </section>`);
  card.appendChild(buildBggForm(me.bggUsername));
  return card;
}
