/* Spielwirbel – views: the round hub's Chat tab (#1781).

   One plain-text thread per round for everyone with access to it — accounts
   mode only, so the tab is offered only to a signed-in account
   (chatAvailable). The thread pages backwards from the newest message, polls
   lightly while the tab is the current screen, and marks read exactly what it
   has SHOWN (the route deliberately marks nothing on post — see
   lib/routes/round-messages.js).

   A message is user-authored text shown to OTHER accounts, so it never touches
   innerHTML: every run goes in through textContent, and a link is an <a> this
   file builds from chatSegments() (round-chat.js), http(s) only, with
   rel="noopener nofollow ugc".

   Part of the frontend; shares one global script scope. Loaded after
   views-round.js and views-friends.js, whose functions it calls at RENDER time
   only (.claude/rules/frontend-script-load-order.md). */

// How often an open thread asks for new messages. "A light poll while the
// screen is open is enough" (#1781) — live updates are out of scope.
const CHAT_POLL_MS = 20000;

// The chat needs an account to post AS, so it exists only for one.
function chatAvailable() {
  return accountsActive() && isLoggedIn();
}

function chatErrorText(err) {
  const code = err && err.message;
  if (code === 'rate_limited') return t('chat.toast.rateLimited');
  if (code === 'quota_messages') return t('chat.toast.quota');
  if (code === 'quota_messages_author') return t('chat.toast.quotaAuthor');
  return t('chat.toast.failed');
}

// Bring the newest message into view. Guarded: a failed scroll must never stop
// the thread from being marked read, which runs right after it.
function chatScrollToNewest(list) {
  const last = list.lastElementChild;
  if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'nearest' });
}

// One message's text as DOM: plain runs and links, never HTML.
function chatTextNode(text) {
  const p = document.createElement('p');
  p.className = 'chat-msg__text';
  for (const seg of chatSegments(text)) {
    if (seg.href) {
      const a = document.createElement('a');
      a.href = seg.href;
      a.target = '_blank';
      a.rel = 'noopener nofollow ugc';
      a.textContent = seg.text;
      p.appendChild(a);
    } else {
      p.appendChild(document.createTextNode(seg.text));
    }
  }
  return p;
}

async function renderChatTab(round) {
  const rid = round.id;
  const base = `/api/rounds/${rid}/messages`;
  const moderator = roundCan(round, 'chat.moderate');
  const state = { messages: [], hasMore: false, lastRead: 0, timer: null };

  const wrap = h(`<section class="chat" aria-labelledby="chatTitle">
      <div class="section-head"><h1 id="chatTitle">${esc(t('hub.tab.chat'))}</h1></div>
      <p class="muted chat__note">${esc(t('chat.note'))}</p>
      <button type="button" class="link-btn chat__older" hidden>${esc(t('chat.older'))}</button>
      <ol class="chat__list" aria-live="polite"></ol>
      <p class="muted chat__empty" hidden>${esc(t('chat.empty'))}</p>
      <form class="chat__compose">
        <label class="sr-only" for="chatInput">${esc(t('chat.inputLabel'))}</label>
        <textarea id="chatInput" class="input chat__input" rows="2" maxlength="${CHAT_MESSAGE_MAX}"
          placeholder="${esc(t('chat.placeholder'))}"></textarea>
        <button type="submit" class="btn chat__send"><i class="ti ti-send" aria-hidden="true"></i>${esc(t('chat.send'))}</button>
      </form>
    </section>`);
  app.appendChild(wrap);
  const list = wrap.querySelector('.chat__list');
  const older = wrap.querySelector('.chat__older');
  const empty = wrap.querySelector('.chat__empty');
  const form = wrap.querySelector('.chat__compose');
  const input = wrap.querySelector('.chat__input');

  function messageRow(m) {
    const name = m.author && m.author.username;
    const li = h(`<li class="chat-msg${m.own ? ' chat-msg--own' : ''}" data-id="${esc(m.id)}">
        ${friendAvatar(name, m.author && m.author.avatar, 'chat-msg__avatar')}
        <div class="chat-msg__body">
          <div class="chat-msg__meta">
            <span class="chat-msg__author">${esc(name || t('chat.deletedAccount'))}</span>
            <time class="muted" datetime="${esc(m.createdAt)}">${esc(fmtDateTime(m.createdAt))}</time>
            ${m.editedAt ? `<span class="muted chat-msg__edited">${esc(t('chat.edited'))}</span>` : ''}
          </div>
        </div>
        <div class="chat-msg__actions"></div>
      </li>`);
    li.querySelector('.chat-msg__body').appendChild(chatTextNode(m.text));
    const actions = li.querySelector('.chat-msg__actions');
    const action = (icon, label, run) => {
      const b = h(`<button type="button" class="chat-msg__act" aria-label="${esc(label)}" title="${esc(label)}"><i class="ti ${icon}" aria-hidden="true"></i></button>`);
      b.addEventListener('click', run);
      actions.appendChild(b);
    };
    if (m.own) action('ti-pencil', t('chat.edit'), () => editMessage(li, m));
    if (m.own || moderator) action('ti-trash', t('chat.delete'), () => deleteMessage(m));
    // The flood clean-up: every message by this person in this round.
    if (!m.own && moderator) action('ti-user-x', t('chat.purge', { name: name || t('chat.deletedAccount') }), () => purgeAuthor(m, name));
    if (!m.own) {
      // The in-context notice channel (#559), with the message id in the
      // subject so the operator can look it up in the panel.
      const href = feedReportUrl({ username: name, subject: t('chat.reportSubject', { id: m.id }) });
      if (href) {
        actions.appendChild(h(`<a class="chat-msg__act" href="${esc(href)}" target="_blank" rel="noopener"
            aria-label="${esc(t('chat.report'))}" title="${esc(t('chat.report'))}"><i class="ti ti-flag" aria-hidden="true"></i></a>`));
      }
    }
    return li;
  }

  function paint() {
    list.replaceChildren(...state.messages.map(messageRow));
    older.hidden = !state.hasMore;
    empty.hidden = state.messages.length > 0;
  }

  // Mark read up to the newest message on screen, once it IS on screen, and
  // put out the dots this view knows about.
  async function markShown() {
    const newest = state.messages.length ? state.messages[state.messages.length - 1].seq : 0;
    if (newest <= state.lastRead) return;
    try {
      const out = await api('POST', `${base}/read`, { seq: newest });
      state.lastRead = out.lastRead;
      round.chatUnread = false;
      document.querySelectorAll('.hub-chat-dot').forEach((d) => d.remove());
    } catch { /* the dot simply stays; the server is the record */ }
  }

  async function load() {
    const page = await api('GET', base);
    state.messages = page.messages;
    state.hasMore = page.hasMore;
    state.lastRead = page.lastRead;
    paint();
    chatScrollToNewest(list);
    await markShown();
  }

  // The newest page replaces the newest window; older pages the reader loaded
  // stay. Repaints only on a real difference, so a quiet thread never moves.
  const chatSig = (ms) => ms.map((m) => `${m.id}:${m.editedAt || ''}`).join('|');
  async function poll() {
    if (!document.body.contains(wrap)) { clearInterval(state.timer); return; }
    if (document.hidden) return;
    try {
      const page = await api('GET', base);
      const from = page.messages.length ? page.messages[0].seq : Infinity;
      const next = [...state.messages.filter((m) => m.seq < from), ...page.messages];
      if (chatSig(next) === chatSig(state.messages)) return;
      state.messages = next;
      paint();
      await markShown();
    } catch { /* a missed poll is retried by the next one */ }
  }

  // One editor at a time: repainting first closes any other, which is also
  // what keeps the textarea's id unique on the page.
  async function editMessage(_li, m) {
    paint();
    const li = list.querySelector(`.chat-msg[data-id="${CSS.escape(m.id)}"]`);
    if (!li) return;
    const body = li.querySelector('.chat-msg__body');
    const editor = h(`<form class="chat-edit">
        <textarea id="chatEditInput" class="input" rows="2" maxlength="${CHAT_MESSAGE_MAX}" aria-label="${esc(t('chat.edit'))}"></textarea>
        <div class="chat-edit__actions">
          <button type="button" class="btn btn--ghost btn--sm">${esc(t('common.cancel'))}</button>
          <button type="submit" class="btn btn--sm">${esc(t('chat.save'))}</button>
        </div>
      </form>`);
    const area = editor.querySelector('textarea');
    area.value = m.text;
    body.querySelector('.chat-msg__text').replaceWith(editor);
    area.focus();
    editor.querySelector('button[type=button]').addEventListener('click', paint);
    editor.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const updated = await api('PATCH', `${base}/${m.id}`, { text: area.value });
        state.messages = state.messages.map((x) => (x.id === m.id ? updated : x));
        paint();
      } catch (err) { toast(chatErrorText(err), { tone: 'error' }); }
    });
  }

  async function deleteMessage(m) {
    if (!await confirmDialog({ body: t('chat.deleteConfirm'), confirmLabel: t('chat.delete'), icon: 'ti-trash' })) return;
    try {
      await api('DELETE', `${base}/${m.id}`);
      state.messages = state.messages.filter((x) => x.id !== m.id);
      paint();
    } catch (err) { toast(chatErrorText(err), { tone: 'error' }); }
  }

  async function purgeAuthor(m, name) {
    const who = name || t('chat.deletedAccount');
    if (!await confirmDialog({ body: t('chat.purgeConfirm', { name: who }), confirmLabel: t('chat.delete'), icon: 'ti-user-x' })) return;
    try {
      await api('DELETE', `${base}/by-author/${m.id}`);
      const author = m.author && m.author.username;
      state.messages = state.messages.filter((x) => (x.author && x.author.username) !== author);
      paint();
      toast(t('chat.purged', { name: who }));
    } catch (err) { toast(chatErrorText(err), { tone: 'error' }); }
  }

  older.addEventListener('click', async () => {
    if (!state.messages.length) return;
    try {
      const page = await api('GET', `${base}?before=${state.messages[0].seq}`);
      state.messages = [...page.messages, ...state.messages];
      state.hasMore = page.hasMore;
      paint();
    } catch (err) { toast(chatErrorText(err), { tone: 'error' }); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = normalizeChatText(input.value);
    if (!text) return;
    const send = form.querySelector('.chat__send');
    send.disabled = true;
    try {
      const msg = await api('POST', base, { text });
      state.messages = [...state.messages, msg];
      input.value = '';
      paint();
      chatScrollToNewest(list);
    } catch (err) {
      toast(chatErrorText(err), { tone: 'error' });
    } finally {
      send.disabled = false;
    }
  });
  // Ctrl/Cmd+Enter sends; a plain Enter is a line break, as in every
  // multi-line message field.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  try { await load(); } catch (err) { toast(chatErrorText(err), { tone: 'error' }); }
  state.timer = setInterval(poll, CHAT_POLL_MS);
}

// The unread mark beside a nav label. A present/absent element with its own
// accessible name, never colour alone (accessibility-contrast-and-modals.md §3).
function hubChatDot() {
  return `<span class="hub-chat-dot inbox-row__dot" role="img" aria-label="${esc(t('chat.unread'))}"></span>`;
}
