import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script has no type declarations
import { isExempt, runCheck, scanText } from "../../../scripts/check-mcp-logging.mjs";

/**
 * Fixture-based tests for the logging CI check: every prohibited pattern
 * must be caught in every module family that handles MCP/desk data, and
 * the sanctioned paths (console.error, comments, the pipeline itself,
 * test files) must be left alone.
 */

const MODULES = [
  ["MCP", "src/lib/mcp/tools/fixture-tool.ts"],
  ["chat", "src/lib/chat.server.ts"],
  ["desk", "src/lib/desk.functions.ts"],
  ["sign-in", "src/lib/desk-owner.server.ts"],
  ["HTTP", "src/routes/api/public/fixture.ts"],
] as const;

const PROHIBITED = [
  ["console.log", 'console.log("turn", token);'],
  ["console.warn", 'console.warn("turn", token);'],
  ["console.info", 'console.info("turn", token);'],
  ["console.debug", 'console.debug("turn", token);'],
  ["console.trace", 'console.trace("turn");'],
  ["console.group", 'console.group("turn");'],
  ["process.stdout.write", 'process.stdout.write("turn");'],
  ["process.stderr.write", 'process.stderr.write("turn");'],
  ["pino import", 'import pino from "pino";'],
  ["winston import", 'import winston from "winston";'],
  ["bunyan import", 'import bunyan from "bunyan";'],
  ["log4js import", 'import log4js from "log4js";'],
  ["debug import", 'import debug from "debug";'],
] as const;

describe("CI logging check catches every prohibited pattern in every module family", () => {
  for (const [family, path] of MODULES) {
    for (const [pattern, line] of PROHIBITED) {
      it(`${family}: catches ${pattern}`, () => {
        const findings = scanText(path, `const x = 1;\n${line}\n`);
        expect(findings).toHaveLength(1);
        expect(findings[0].line).toBe(2);
        expect(findings[0].source).toBe(line);
      });
    }
  }
});

describe("CI logging check leaves sanctioned paths alone", () => {
  it("allows console.error (the redacted path) in every module family", () => {
    for (const [, path] of MODULES) {
      expect(scanText(path, 'console.error(describeError(err));\n')).toHaveLength(0);
    }
  });

  it("ignores prohibited patterns inside comments", () => {
    const src = '// console.log("off")\n  * console.warn("off")\n';
    for (const [, path] of MODULES) {
      expect(scanText(path, src)).toHaveLength(0);
    }
  });

  it("exempts the redaction pipeline itself", () => {
    expect(isExempt("src/lib/error-capture.ts")).toBe(true);
    expect(scanText("src/lib/error-capture.ts", 'console.error("wrap");\n')).toHaveLength(0);
  });

  it("exempts test files", () => {
    expect(isExempt("src/lib/mcp/mcp-access.test.ts")).toBe(true);
    expect(isExempt("src/lib/mcp/__tests__/fixture.ts")).toBe(true);
  });

  it("does not flag ordinary code mentioning the words", () => {
    const src = 'const msg = "console.log is forbidden";\nconst dbg = debuggerOn;\n';
    for (const [, path] of MODULES) {
      expect(scanText(path, src)).toHaveLength(0);
    }
  });
});

describe("CI logging check against the real tree", () => {
  it("the current codebase passes", () => {
    const { scanned, findings } = runCheck();
    expect(scanned).toBeGreaterThan(10);
    expect(findings).toEqual([]);
  });
});
