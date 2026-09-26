import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script has no type declarations
import { scanText } from "../../../scripts/check-mcp-logging.mjs";

/**
 * Fixture tests: the CI check must catch computed-property and
 * bracket-notation logging aliases in every protected module family, and
 * must handle shadowed console/process bindings without false positives
 * or missed real logging calls.
 */

const MODULES = [
  ["MCP", "src/lib/mcp/tools/fixture-tool.ts"],
  ["chat", "src/lib/chat.server.ts"],
  ["desk", "src/lib/desk.functions.ts"],
  ["sign-in", "src/lib/desk-owner.server.ts"],
  ["HTTP", "src/routes/api/public/fixture.ts"],
] as const;

const BRACKET = [
  ["direct console['log'] call", "console['log']('turn', token);"],
  ["direct console[\"warn\"] call", 'console["warn"]("turn");'],
  ["computed console[m] call", 'const m = "log";\nconsole[m]("turn");'],
  ["aliased console['info']", "const tell = console['info'];\ntell('turn');"],
  ["aliased console[\"debug\"]", 'const dbg = console["debug"];\ndbg("turn");'],
  ["direct stdout['write'] call", "process.stdout['write']('turn');"],
  ["computed stderr[w] call", 'const w = "write";\nprocess.stderr[w]("turn");'],
  ["aliased stdout[\"write\"]", 'const emit = process.stdout["write"];\nemit("turn");'],
] as const;

describe("CI check catches bracket-notation logging in every module family", () => {
  for (const [family, path] of MODULES) {
    for (const [pattern, src] of BRACKET) {
      it(`${family}: catches ${pattern}`, () => {
        expect(scanText(path, `${src}\n`).length).toBeGreaterThan(0);
      });
    }
  }
});

describe("CI check handles shadowed console/process bindings", () => {
  it("no false positive when console is a function parameter", () => {
    const src = "function render(console) {\n  console.log('local object method');\n}\n";
    for (const [, path] of MODULES) {
      expect(scanText(path, src)).toHaveLength(0);
    }
  });

  it("no false positive when console is a local variable", () => {
    const src = "const console = makeFakeConsole();\nconsole.warn('not the global');\n";
    for (const [, path] of MODULES) {
      expect(scanText(path, src)).toHaveLength(0);
    }
  });

  it("no false positive when process is a local variable", () => {
    const src = "const process = { stdout: { write: (s) => s } };\nprocess.stdout.write('fake');\n";
    for (const [, path] of MODULES) {
      expect(scanText(path, src)).toHaveLength(0);
    }
  });

  it("no false positive for aliases of a shadowed console", () => {
    const src = "const console = makeFake();\nconst say = console.log;\nsay('not the global');\n";
    for (const [, path] of MODULES) {
      expect(scanText(path, src)).toHaveLength(0);
    }
  });

  it("still catches real logging elsewhere in a file that shadows console", () => {
    const src =
      "function render(console) {\n  console.log('local');\n}\nprocess.stdout.write('real bypass');\n";
    for (const [, path] of MODULES) {
      const findings = scanText(path, src);
      expect(findings).toHaveLength(1);
      expect(findings[0].line).toBe(4);
      expect(findings[0].label).toMatch(/process/);
    }
  });

  it("still catches real console logging when only process is shadowed", () => {
    const src = "const process = makeFake();\nconsole.log('real bypass');\n";
    for (const [, path] of MODULES) {
      const findings = scanText(path, src);
      expect(findings).toHaveLength(1);
      expect(findings[0].label).toMatch(/console/);
    }
  });
});
