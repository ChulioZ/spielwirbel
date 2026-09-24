'use strict';

/*
 * A ~40-line Chrome DevTools Protocol client for the two image scripts
 * (capture-landing-shots.js, render-design-marks.js) — shared since #1199, when
 * the second one needed it and a copy would have been the one to rot.
 *
 * Instead of a dependency: Node has a global WebSocket, and headless Chrome
 * speaks CDP over one. Not optional convenience — `chrome --screenshot` FLOORS
 * the CSS viewport at 500px regardless of --window-size, so a "390px" capture is
 * really a 390-wide crop of a 500-wide layout with every phone breakpoint
 * unfired, and a 32px favicon is a crop of a 500px page.
 * Emulation.setDeviceMetricsOverride is the only way to set the viewport exactly
 * (.claude/rules/landing-product-screenshots.md §1).
 *
 * Teardown is the caller's: `onCleanup` receives each function to run, so a
 * script whose failure path calls process.exit (which skips `finally`) can still
 * kill Chrome and remove its profile through its own registry.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectCdp({ port, extraArgs = [], onCleanup }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const chrome = execFile(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', ...extraArgs,
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ]);
  // Chrome may still be flushing its profile as it dies; a leftover temp dir
  // is harmless, a cleanup that throws would hide the real error.
  onCleanup(() => {
    chrome.kill();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* best effort */ }
  });

  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
    if (!target) await sleep(100);
  }
  if (!target) throw new Error('Chrome did not expose a CDP page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || '')})`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of [...listeners]) fn(msg);
    }
  });

  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  const once = (method) => new Promise((resolve) => {
    const fn = (msg) => { if (msg.method === method) { listeners.delete(fn); resolve(msg.params); } };
    listeners.add(fn);
  });

  onCleanup(() => ws.close());
  await send('Page.enable');
  await send('Runtime.enable');
  return { send, once };
}

module.exports = { connectCdp, CHROME };
