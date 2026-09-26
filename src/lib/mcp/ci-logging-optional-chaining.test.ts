import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script has no type declarations
import { scanText } from "../../../scripts/check-mcp-logging.mjs";

/**
 * Fixture tests: the CI check must catch optional-chaining console and
 * process logging calls in every protected module family — `console?.log`
 * bypasses redaction exactly like `console.log`.
 */

const MODULES = [
  ["MCP", "src/lib/mcp/tools/fixture-tool.ts"],
  ["chat", "src/lib/chat.server.ts"],
  ["desk", "src/lib/desk.functions.ts"],
  ["sign-in", "src/lib/desk-owner.server.ts"],
  ["HTTP", "src/routes/api/public/fixture.ts"],
] as const;

const OPTIONAL_CHAINED = [
  ["console?.log", "console?.log('turn', token);"],
  ["console?.warn", "console?.warn('turn');"],
  ["console?.debug", "console?.debug('turn');"],
  ["console?.trace", "console?.trace('turn');"],
  ["console?.['info']", "console?.['info']('turn');"],
  ['console?.["log"]', 'console?.["log"]("turn");'],
  ["console?.[m] computed", 'const m = "log";\nconsole?.[m]("turn");'],
  ["process.stdout?.write", "process.stdout?.write('turn');"],
  ["process?.stdout?.write", "process?.stdout?.write('turn');"],
  ["process.stderr?.['write']", "process.stderr?.['write']('turn');"],
] as const;

describe("CI check catches optional-chaining logging in every module family", () => {
  for (const [family, path] of MODULES) {
    for (const [pattern, src] of OPTIONAL_CHAINED) {
      it(`${family}: catches ${pattern}`, () => {
        expect(scanText(path, `${src}\n`).length).toBeGreaterThan(0);
      });
    }
  }
});

describe("CI check optional-chaining edge cases", () => {
  it("still allows console?.error (the redacted path)", () => {
    for (const [, path] of MODULES) {
      expect(scanText(path, "console?.error(describeError(err));\n")).toHaveLength(0);
    }
  });

  it("does not flag optional chaining on unrelated objects", () => {
    const src = "logger?.log('fine');\nstream?.write('fine');\n";
    for (const [, path] of MODULES) {
      expect(scanText(path, src)).toHaveLength(0);
    }
  });
});
