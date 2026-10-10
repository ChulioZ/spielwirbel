'use strict';

// Every input holding a name, title, identifier or search term must opt out of
// keyboard autocorrect and spellcheck (#1620): on a phone, „Dobble" typed into
// the shelf search became „Double" and matched nothing. Every input in the app
// is created from a markup literal (no createElement('input') anywhere), so the
// guard scans those literals — in the SPA scripts and the standalone pages.
//
// The scan is lexical (.claude/rules/source-scanning-guards-enumerate-shapes.md):
// a tag runs from `<input`/`<textarea` to its closing `>`, across newlines and
// past any `>` inside a `${…}` interpolation. The floor counts tags actually
// CHECKED, not files read, so a pattern that stops matching goes red.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['public/login.html', 'public/kontakt.html', 'public/admin.html'];

// Free prose keeps autocorrect and spellcheck. Each entry must still exist.
const PROSE = [
  'public/kontakt.html#subject',
  'public/kontakt.html#message',
  'public/admin.html#takedownReason',
  'public/admin.html#statementText',
];
// The contact form's honeypot: no human types into it.
const HONEYPOT = ['public/kontakt.html#website'];

const NO_TEXT_TYPES = new Set(['password', 'email', 'checkbox', 'radio', 'file',
  'range', 'color', 'hidden', 'date', 'time', 'number', 'submit', 'button']);

function jsFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return jsFiles(rel);
    return e.name.endsWith('.js') ? [rel] : [];
  });
}

// Comment lines can name a tag (`<input type="date">` in played-on.js) without
// creating one; blank them so the scan sees only markup.
function stripCommentLines(src) {
  return src.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n');
}

function scanTags(src) {
  const tags = [];
  const re = /<(input|textarea)\b/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      if (src[i] === '$' && src[i + 1] === '{') { depth++; i++; continue; }
      if (depth && src[i] === '{') depth++;
      else if (depth && src[i] === '}') depth--;
      else if (!depth && src[i] === '>') break;
    }
    tags.push({ tag: m[1], text: src.slice(m.index, i + 1),
      line: src.slice(0, m.index).split('\n').length });
  }
  return tags;
}

const attr = (text, name) => {
  const m = text.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};

function collect() {
  const files = [...jsFiles('public/js'), ...PAGES];
  const checked = [];
  const skippedProse = new Set();
  for (const file of files) {
    for (const t of scanTags(stripCommentLines(fs.readFileSync(path.join(ROOT, file), 'utf8')))) {
      const key = `${file}#${attr(t.text, 'id')}`;
      const type = (attr(t.text, 'type') || 'text').toLowerCase();
      if (t.tag === 'input' && NO_TEXT_TYPES.has(type)) continue;
      if (/\sreadonly\b/.test(t.text)) continue;
      if (/^(numeric|decimal)$/.test(attr(t.text, 'inputmode') || '')) continue;
      if (HONEYPOT.includes(key)) continue;
      if (PROSE.includes(key)) { skippedProse.add(key); continue; }
      checked.push({ file, ...t });
    }
  }
  return { checked, skippedProse };
}

test('every name/search input opts out of autocorrect and spellcheck', () => {
  const { checked } = collect();
  // Hits, not attempts: 38 text inputs exist today (#1620).
  assert.ok(checked.length >= 38, `only ${checked.length} text inputs found — the scan stopped matching`);
  const missing = checked
    .filter((t) => attr(t.text, 'autocorrect') !== 'off' || attr(t.text, 'spellcheck') !== 'false')
    .map((t) => `${t.file}:${t.line} ${t.text.replace(/\s+/g, ' ').slice(0, 90)}`);
  assert.deepStrictEqual(missing, [], 'add autocorrect="off" spellcheck="false" to these');
});

test('the prose fields keep autocorrect, and every allowlisted one still exists', () => {
  const { skippedProse } = collect();
  assert.deepStrictEqual([...skippedProse].sort(), [...PROSE].sort());
  for (const key of [...PROSE, ...HONEYPOT]) {
    const [file, id] = key.split('#');
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(src, new RegExp(`id="${id}"`), `${key} is gone — drop it from the list`);
  }
});

test('the prose fields do not opt out', () => {
  for (const key of PROSE) {
    const [file, id] = key.split('#');
    const t = scanTags(fs.readFileSync(path.join(ROOT, file), 'utf8'))
      .find((x) => attr(x.text, 'id') === id);
    assert.ok(t, key);
    assert.equal(attr(t.text, 'autocorrect'), null, key);
    assert.equal(attr(t.text, 'spellcheck'), null, key);
  }
});

test('the scanner reads multi-line tags and skips `>` inside interpolations', () => {
  const tags = scanTags('h(`<input id="a"\n  value="${n > 1 ? x : y}"\n  autocorrect="off" />`)');
  assert.equal(tags.length, 1);
  assert.equal(attr(tags[0].text, 'autocorrect'), 'off');
});
