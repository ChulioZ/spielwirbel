/* Spielwirbel – "also change it in your other rounds" (#1843).
 *
 * After the game page saves a title, player range, playing time or pitch, this
 * asks `GET /api/game-twins` which of the caller's OTHER writable rounds hold
 * the same BGG game, and offers to make the same change there. Each row shows
 * that round's current value → the new one.
 *
 * Pre-ticked only where the twin held the PRE-edit value of this round, i.e. it
 * was in sync; a twin that differs is listed unticked, so the user sees it and
 * opts in. A twin already holding the new value is left out — there is nothing
 * to change, and a row saying so would only be noise.
 *
 * Applying sends the same patch to each ticked round's own
 * `PATCH …/games/:gid`, one at a time, so every write meets that round's grant
 * and role check exactly as a hand edit would. The original save never waits
 * on any of this: it has already happened when `offerTwinEdit` is called.
 *
 * Not loaded by Node: the specs drive it through the jsdom harness
 * (test/support/dom.js), so it stays out of the coverage report.
 *
 * Part of the frontend; all files share one global script scope (load order: see
 * index.html). */

// The four fields the prompt offers. `touches` asks whether a PATCH body edits
// it, `value` reads it off a game (or a twin row, which carries the same keys),
// `text` renders a value for the row. One edit on the game page touches exactly
// one of these, so the first match decides.
const TWIN_FIELDS = [
  {
    key: 'title',
    touches: (p) => 'title' in p,
    value: (g) => String(g.title || ''),
    text: (v) => v,
    patch: (p) => ({ title: p.title }),
  },
  {
    key: 'players',
    touches: (p) => 'minPlayers' in p || 'maxPlayers' in p,
    value: (g) => ({ min: g.minPlayers ?? null, max: g.maxPlayers ?? null }),
    text: (v) => (v.min == null && v.max == null ? '' : playersText(v.min, v.max)),
    patch: (p) => ({ minPlayers: p.minPlayers, maxPlayers: p.maxPlayers }),
  },
  {
    key: 'playtime',
    touches: (p) => 'playtimeOverride' in p,
    // The override alone is what the round stored; a cleared one is the
    // provider's figure, which is the same BGG game on both sides.
    value: (g) => (g.playtimeOverride ? { min: g.playtimeOverride.min, max: g.playtimeOverride.max } : null),
    text: (v, g) => playtimeRangeText(gamePlaytime({ ...g, playtimeOverride: v })) || '',
    patch: (p) => ({ playtimeOverride: p.playtimeOverride }),
  },
  {
    key: 'pitch',
    touches: (p) => 'pitch' in p,
    value: (g) => (typeof g.pitch === 'string' && g.pitch ? g.pitch : null),
    text: (v) => v || '',
    patch: (p) => ({ pitch: p.pitch }),
  },
];

const twinSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Pure: which twins to offer for `patch`, given this round's game BEFORE the
// edit. Each row: { twin, from, to, checked }. Null when the patch touches none
// of the four fields.
function twinOffers(before, patch, twins) {
  const field = TWIN_FIELDS.find((f) => f.touches(patch));
  if (!field) return null;
  const was = field.value(before);
  const now = field.value({ ...before, ...patch });
  const rows = [];
  (twins || []).forEach((twin) => {
    const cur = field.value(twin);
    if (twinSame(cur, now)) return;
    rows.push({
      twin,
      from: field.text(cur, twin) || t('twins.empty'),
      to: field.text(now, twin) || t('twins.empty'),
      checked: twinSame(cur, was),
    });
  });
  return { field, rows };
}

// Called by the game page after a successful save. Fire-and-forget: a failed
// lookup means no prompt, never an error for an edit that already worked.
async function offerTwinEdit(rid, before, patch) {
  const bggId = before && before.source && before.source.provider === 'bgg'
    ? String(before.source.externalId == null ? '' : before.source.externalId) : '';
  if (!/^[0-9]+$/.test(bggId)) return;
  if (!TWIN_FIELDS.some((f) => f.touches(patch))) return;
  let res;
  try {
    res = await api('GET', `/api/game-twins?bggId=${encodeURIComponent(bggId)}&excludeRoundId=${encodeURIComponent(rid)}`);
  } catch {
    // The server logged its own side of a failed request; the edit is saved.
    return;
  }
  try {
    const offer = twinOffers(before, patch, res && res.twins);
    if (offer && offer.rows.length) showTwinSheet(before, offer, patch);
  } catch (e) {
    // Client-only code with no server involvement — say so to the operator
    // (.claude/rules/caught-client-faults-are-invisible.md). Nothing for the
    // user to do: their edit is already saved.
    reportClientError('game_twins', e);
  }
}

function showTwinSheet(before, offer, patch) {
  const { field, rows } = offer;
  openEditor(null, 'twins', t('twins.title'), (el, close) => {
    el.appendChild(h(`<p class="muted twin-intro">${esc(t('twins.intro.' + field.key, { title: before.title }))}</p>`));
    const listEl = h('<div class="twin-list"></div>');
    rows.forEach((r) => {
      // A <label> row, so the whole line toggles its box — and never inside a
      // `.field` (.claude/rules/label-rows-lose-to-field-label.md).
      const row = h(`<label class="ds-row twin-row${r.checked ? ' ds-row--picked' : ''}">
          <span class="ds-row__main">
            <span class="ds-row__title">${esc(r.twin.roundName)}${r.twin.shared ? ` <span class="muted">· ${esc(t('twins.shared'))}</span>` : ''}</span>
            <span class="muted twin-row__change">${esc(t('twins.change', { from: r.from, to: r.to }))}</span>
          </span>
          <span class="ds-row__meta"><input type="checkbox"${r.checked ? ' checked' : ''} /></span>
        </label>`);
      row.querySelector('input').addEventListener('change', (ev) => {
        r.checked = ev.target.checked;
        row.classList.toggle('ds-row--picked', r.checked);
        paint();
      });
      listEl.appendChild(row);
    });
    el.appendChild(listEl);

    const skip = h(`<button type="button" class="btn btn--ghost">${esc(t('twins.skip'))}</button>`);
    const ok = h(`<button type="button" class="btn btn--primary"></button>`);
    const paint = () => {
      const n = rows.filter((r) => r.checked).length;
      ok.textContent = n ? tn(n, 'twins.applyOne', 'twins.applyMany') : t('twins.applyNone');
      ok.disabled = !n;
    };
    skip.addEventListener('click', () => close());
    ok.addEventListener('click', () => {
      const picked = rows.filter((r) => r.checked);
      close();
      applyTwinEdit(picked, field.patch(patch));
    });
    const bar = h('<div class="toolbar sheet__actions twin-bar"></div>');
    bar.append(skip, ok);
    el.appendChild(bar);
    paint();
    return null;
  }, undefined, { list: true });
}

// One PATCH per ticked round, in order, each through that round's own route. A
// refusal for one round (a grant revoked since the sheet opened) does not stop
// the others; the toast says how many went through.
async function applyTwinEdit(picked, body) {
  let done = 0;
  for (const r of picked) {
    try {
      await api('PATCH', `/api/rounds/${r.twin.roundId}/games/${r.twin.gameId}`, body);
      done += 1;
    } catch {
      // Counted below; the server logged its own side.
    }
  }
  const failed = picked.length - done;
  if (!failed) toast(tn(done, 'twins.toast.doneOne', 'twins.toast.doneMany'));
  else toast(t('twins.toast.partial', { done, failed }), { tone: 'error' });
}
