#!/usr/bin/env node
/**
 * CI check: every logging call in modules that handle MCP or desk data must
 * go through the centralized redaction pipeline (the console.error wrapper
 * installed by src/lib/error-capture.ts). Raw console.log/warn/info/debug,
 * direct process.stdout/stderr writes, third-party loggers, or aliased /
 * destructured copies of any of those would bypass redaction and could leak
 * tokens, user IDs, or owner data.
 *
 * Scope: src/lib/mcp (the MCP server), the rest of src/lib (chat, desk
 * functions, owner verification), and src/routes/api (HTTP endpoints) —
 * every module that can touch MCP request or error data.
 *
 * Exit 0 = clean, exit 1 = a bypassing logging path was found.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN_DIRS = ["src/lib", "src/routes/api"];

// error-capture.ts IS the pipeline: its console.error wrapper is the one
// sanctioned logging call. Test files never run in the app.
const EXEMPT_FILES = new Set(["src/lib/error-capture.ts"]);
const EXEMPT_RE = [/\.test\.ts$/, /\/__tests__\//];

// console.error is the sanctioned path: error-capture.ts wraps it with the
// redactor at import time. Everything else that emits output is a bypass.
const FORBIDDEN = [
  { re: /console\.(log|warn|info|debug|trace|group)\s*\(/, label: "raw console.$1 call (only console.error is redacted)" },
  { re: /console\[["'](log|warn|info|debug|trace|group)["']\]\s*\(/, label: "bracket-notation console.$1 call" },
  { re: /console\[[A-Za-z_$][\w$]*\]\s*\(/, label: "computed console[...] call" },
  { re: /process\.std(out|err)\.write\s*\(/, label: "direct process.$1 write" },
  { re: /process\.std(?:out|err)\[(?:["']write["']|[A-Za-z_$][\w$]*)\]\s*\(/, label: "computed process std stream write" },
  { re: /from\s+["'](pino|winston|bunyan|log4js|debug)["']/, label: "third-party logger import" },
];

// Aliasing or destructuring a forbidden logger and calling it under another
// name is still a bypass. Bindings are collected first, then their calls.
const CONSOLE_METHODS = new Set(["log", "warn", "info", "debug", "trace", "group"]);
const ALIAS_BINDINGS = [
  /\{\s*([^}]*?)\s*\}\s*=\s*console\b/, // const { log } = console
  /\{\s*([^}]*?)\s*\}\s*=\s*process\.std(?:out|err)\b/, // const { write } = process.stdout
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*console\.(log|warn|info|debug|trace|group)\b/,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*console\[["'](log|warn|info|debug|trace|group)["']\]/, // const l = console["log"]
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*process\.std(?:out|err)\.write\b/,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*process\.std(?:out|err)\[["']write["']\]/, // const w = process.stdout["write"]
];

function collectAliases(line, aliases) {
  let m = line.match(ALIAS_BINDINGS[0]);
  if (m) {
    for (const part of m[1].split(",")) {
      const [original, renamed] = part.trim().split(/\s*:\s*|\s*=\s*/);
      const name = (renamed ?? original)?.trim();
      if (name && CONSOLE_METHODS.has(original?.trim())) aliases.set(name, "console");
    }
    return;
  }
  m = line.match(ALIAS_BINDINGS[1]);
  if (m) {
    for (const part of m[1].split(",")) {
      const [, renamed] = part.trim().split(/\s*:\s*|\s*=\s*/);
      const name = (renamed ?? part.trim())?.trim();
      if (name) aliases.set(name, "process std stream");
    }
    return;
  }
  for (const idx of [2, 3]) {
    m = line.match(ALIAS_BINDINGS[idx]);
    if (m) {
      aliases.set(m[1], `console.${m[2]}`);
      return;
    }
  }
  for (const idx of [4, 5]) {
    m = line.match(ALIAS_BINDINGS[idx]);
    if (m) {
      aliases.set(m[1], "process std stream write");
      return;
    }
  }
}

// A module that binds its own "console" or "process" (parameter, local
// variable, or import) shadows the global: its console.x / process.x calls
// are not the real logging paths and must not be flagged.
const SHADOW_RE = [
  { name: "console", re: /(?:function[^(]*\([^)]*\bconsole\b|(?:const|let|var)\s+console\s*=|import\s+.*\bconsole\b.*from|=>.*\bconsole\b\s*=>|\(\s*console\s*[,)])/ },
  { name: "process", re: /(?:function[^(]*\([^)]*\bprocess\b|(?:const|let|var)\s+process\s*=|import\s+.*\bprocess\b.*from|\(\s*process\s*[,)])/ },
];

function shadowedGlobals(lines) {
  const shadowed = new Set();
  for (const line of lines) {
    for (const { name, re } of SHADOW_RE) {
      if (re.test(line)) shadowed.add(name);
    }
  }
  return shadowed;
}

/** True when rel points at a file the check must skip. */
export function isExempt(rel) {
  return EXEMPT_FILES.has(rel) || EXEMPT_RE.some((re) => re.test(rel));
}

/**
 * Scan one file's source text. rel is the project-relative path (used for
 * exemption and reporting). Returns a list of { line, label, source }.
 */
export function scanText(rel, text) {
  if (isExempt(rel)) return [];
  const findings = [];
  const lines = text.split("\n");
  const aliases = new Map();
  for (const line of lines) {
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    collectAliases(line, aliases);
  }
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // skip comments
    for (const { re, label } of FORBIDDEN) {
      const m = line.match(re);
      if (m) {
        findings.push({ line: i + 1, label: label.replace("$1", m[1]), source: line.trim() });
      }
    }
    if (ALIAS_BINDINGS.some((re) => re.test(line))) return; // binding line, not a call
    for (const [name, source] of aliases) {
      const callRe = new RegExp(`(?<![.\\w$])${name}\\s*\\(`);
      if (callRe.test(line)) {
        findings.push({ line: i + 1, label: `aliased ${source} call via "${name}"`, source: line.trim() });
      }
    }
  });
  return findings;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(entry)) yield path;
  }
}

export function runCheck() {
  let scanned = 0;
  const all = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      if (isExempt(rel)) continue;
      scanned++;
      for (const f of scanText(rel, readFileSync(file, "utf8"))) {
        all.push({ rel, ...f });
      }
    }
  }
  return { scanned, findings: all };
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (isMain) {
  const { scanned, findings } = runCheck();
  for (const f of findings) {
    console.error(`BYPASS ${f.rel}:${f.line}: ${f.label}\n  ${f.source}`);
  }
  if (findings.length > 0) {
    console.error(`\n${findings.length} logging path(s) bypass the redaction pipeline.`);
    process.exit(1);
  }
  console.log(`Logging check passed: ${scanned} modules scanned, all logging goes through the redaction pipeline.`);
}
