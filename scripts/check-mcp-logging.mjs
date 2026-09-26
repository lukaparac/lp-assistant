#!/usr/bin/env node
/**
 * CI check: every logging call inside src/lib/mcp/ must go through the
 * centralized redaction pipeline (the console.error wrapper installed by
 * src/lib/error-capture.ts). Raw console.log/warn/info/debug, direct
 * process.stdout/stderr writes, or third-party loggers would bypass
 * redaction and could leak tokens, user IDs, or owner data.
 *
 * Exit 0 = clean, exit 1 = a bypassing logging path was found.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MCP_DIR = new URL("../src/lib/mcp", import.meta.url).pathname;
const ROOT = new URL("..", import.meta.url).pathname;

// console.error is the sanctioned path: error-capture.ts wraps it with the
// redactor at import time. Everything else that emits output is a bypass.
const FORBIDDEN = [
  { re: /console\.(log|warn|info|debug|trace|group)\s*\(/, label: "raw console.$1 call (only console.error is redacted)" },
  { re: /process\.std(out|err)\.write\s*\(/, label: "direct process.$1 write" },
  { re: /from\s+["'](pino|winston|bunyan|log4js|debug)["']/, label: "third-party logger import" },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(entry)) yield path;
  }
}

let violations = 0;
for (const file of walk(MCP_DIR)) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // skip comments
    for (const { re, label } of FORBIDDEN) {
      const m = line.match(re);
      if (m) {
        violations++;
        console.error(`BYPASS ${rel}:${i + 1}: ${label.replace("$1", m[1])}\n  ${line.trim()}`);
      }
    }
  });
}

if (violations > 0) {
  console.error(`\n${violations} MCP logging path(s) bypass the redaction pipeline.`);
  process.exit(1);
}
console.log("MCP logging check passed: all logging goes through the redaction pipeline.");
