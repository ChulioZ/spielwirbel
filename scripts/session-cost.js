#!/usr/bin/env node
'use strict';

/* Report what a Claude Code session actually cost, so a change to the agent
   workflow can be measured instead of hoped for.

   The bill is context size x request count, not output: a session re-reads its
   whole context on every tool call, and each tool result joins that context for
   every call after it. So the numbers that matter are the context at the FIRST
   request (the fixed preamble — CLAUDE.md, the always-on rules, the loaded
   skills, memory) and the largest tool results (which inflate every later call).

   Usage:
     node scripts/session-cost.js                # the 5 largest sessions of this repo
     node scripts/session-cost.js --limit 10
     node scripts/session-cost.js <path-to.jsonl>

   Reads Claude Code's own transcripts under ~/.claude/projects/<slug>/. It never
   touches the app's data/ directory. */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Claude Code slugifies the project's absolute path by replacing every
// non-alphanumeric run with a dash.
const slug = (dir) => dir.replace(/[^a-zA-Z0-9]/g, '-');
const projectDir = () =>
  path.join(os.homedir(), '.claude', 'projects', slug(path.resolve(__dirname, '..')));

const kb = (n) => `${Math.round(n / 1024)}KB`;
const k = (n) => `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;

/** Walk one transcript, accumulating usage and tool-result sizes. */
function analyze(file) {
  const out = {
    file: path.basename(file), requests: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    fresh: 0, firstCtx: null, lastCtx: null, results: [], toolCounts: {},
  };
  const label = {};

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    const usage = entry.message && entry.message.usage;
    if (usage) {
      const ctx = (usage.input_tokens || 0)
        + (usage.cache_read_input_tokens || 0)
        + (usage.cache_creation_input_tokens || 0);
      out.requests += 1;
      out.output += usage.output_tokens || 0;
      out.fresh += usage.input_tokens || 0;
      out.cacheRead += usage.cache_read_input_tokens || 0;
      out.cacheWrite += usage.cache_creation_input_tokens || 0;
      if (out.firstCtx === null) out.firstCtx = ctx;
      out.lastCtx = ctx;
    }

    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use') {
        out.toolCounts[block.name] = (out.toolCounts[block.name] || 0) + 1;
        const i = block.input || {};
        const detail = block.name === 'Bash'
          ? String(i.command || '').replace(/\s+/g, ' ').slice(0, 68)
          : String(i.file_path || i.pattern || i.url || '').slice(0, 68);
        label[block.id] = `${block.name}${detail ? ` ${detail}` : ''}`;
      }
      if (block.type === 'tool_result') {
        // An image block bills as roughly a fixed ~1.5k tokens however many
        // base64 bytes it is, so counting its length would badly overstate it.
        const blocks = Array.isArray(block.content) ? block.content : [];
        const image = blocks.some((b) => b.type === 'image');
        out.results.push({
          bytes: JSON.stringify(block.content || '').length,
          image,
          label: label[block.tool_use_id] || '?',
        });
      }
    }
  }
  return out;
}

function report(a) {
  const total = a.results.reduce((sum, r) => sum + r.bytes, 0);
  const images = a.results.filter((r) => r.image);
  console.log(`\n=== ${a.file} ===`);
  console.log(`requests ${a.requests}   output ${k(a.output)}   cache-read ${k(a.cacheRead)}`
    + `   cache-write ${k(a.cacheWrite)}   fresh-in ${k(a.fresh)}`);
  console.log(`context: first request ${k(a.firstCtx || 0)}  ->  last ${k(a.lastCtx || 0)}`
    + `   (the first figure is the fixed preamble; it is re-read on all ${a.requests})`);
  console.log(`tool results: ${kb(total)} over ${a.results.length} calls`
    + `, of which ${images.length} images (~${k(images.length * 1500)} tokens, not bytes)`);
  const tools = Object.entries(a.toolCounts).sort((x, y) => y[1] - x[1]).slice(0, 8);
  console.log(`calls: ${tools.map(([n, c]) => `${n}:${c}`).join('  ')}`);

  const top = a.results.filter((r) => !r.image).sort((x, y) => y.bytes - x.bytes).slice(0, 8);
  if (top.length) {
    console.log('largest non-image results (each one taxes every later call):');
    for (const r of top) console.log(`  ${kb(r.bytes).padStart(6)}  ${r.label}`);
  }
}

/** `--limit N` plus any number of explicit transcript paths.
 *  N is consumed by the flag, so it must not fall through as a path — and with
 *  no flag present nothing may be consumed, or the first path is eaten instead. */
function parseArgs(args) {
  const limitArg = args.indexOf('--limit');
  const limit = limitArg === -1 ? 5 : Number(args[limitArg + 1]) || 5;
  const consumed = limitArg === -1 ? -1 : limitArg + 1;
  return { limit, explicit: args.filter((a, i) => !a.startsWith('--') && i !== consumed) };
}

function main() {
  const { limit, explicit } = parseArgs(process.argv.slice(2));

  let files = explicit;
  if (!files.length) {
    const dir = projectDir();
    if (!fs.existsSync(dir)) {
      console.error(`No transcripts found at ${dir}`);
      process.exit(1);
    }
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)
      .slice(0, limit);
    console.log(`${dir}\nthe ${files.length} largest sessions:`);
  }
  files.forEach((f) => report(analyze(f)));
}

if (require.main === module) main();

module.exports = { analyze, parseArgs, projectDir };
