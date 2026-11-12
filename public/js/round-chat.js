/* Spielwirbel – the round chat's shared rules (#1781): how long a message may
   be, how a page is sized, how a typed text is normalised before it is stored,
   and how a stored text is split into plain runs and links for display.

   ONE file because the composer offers what lib/routes/round-messages.js
   validates: a drifted cap would let the composer accept a message the route
   then 400s (.claude/rules/shared-constants-across-the-stack.md). Pure and
   dependency-free, so it is both a shared-scope frontend script and a CommonJS
   module the route and the tests require. Load order: see index.html. */

'use strict';

// The longest message, in UTF-16 code units after normalisation — the unit
// both String#length and the textarea's maxlength count in.
const CHAT_MESSAGE_MAX = 2000;
// One page of the thread; older pages load on request.
const CHAT_PAGE_SIZE = 50;

// What is stored for what was typed: line endings unified and the outer
// whitespace dropped. Inner blank lines are the author's own and are kept.
function normalizeChatText(value) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
}

// http(s) URLs only. Anything else stays text, so `javascript:` can never
// become an href however it is spelled. Trailing punctuation that usually
// closes the sentence rather than the URL is left outside the link.
const CHAT_URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;
const CHAT_URL_TRAIL_RE = /[.,;:!?)\]}'»"]+$/;

// [{ text }] and [{ href, text }] runs, in order. The caller renders each run
// with textContent / an <a> it builds itself — never as HTML.
function chatSegments(text) {
  const out = [];
  const src = String(text == null ? '' : text);
  let last = 0;
  for (const m of src.matchAll(CHAT_URL_RE)) {
    let url = m[0];
    const trail = url.match(CHAT_URL_TRAIL_RE);
    if (trail) url = url.slice(0, -trail[0].length);
    if (!url.replace(/^https?:\/\//i, '')) continue;
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    out.push({ href: url, text: url });
    last = m.index + url.length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

// Whether a round's dot is lit: someone else wrote past the caller's marker.
function chatUnread(head, lastRead) {
  return typeof head === 'number' && head > (Number(lastRead) || 0);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHAT_MESSAGE_MAX, CHAT_PAGE_SIZE, normalizeChatText, chatSegments, chatUnread };
}
