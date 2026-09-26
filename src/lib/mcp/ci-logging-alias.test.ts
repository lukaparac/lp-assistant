import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script has no type declarations
import { scanText } from "../../../scripts/check-mcp-logging.mjs";

/**
 * Fixture tests: the CI check must catch aliased and destructured copies of
 * console / process loggers in every protected module family — calling a
 * forbidden logger under another name is still a redaction bypass.
 */

const MODULES = [
  ["MCP", "src/lib/mcp/tools/fixture-tool.ts"],
  ["chat", "src/lib/chat.server.ts"],
  ["desk", "src/lib/desk.functions.ts"],
  ["sign-in", "src/lib/desk-owner.server.ts"],
  ["HTTP", "src/routes/api/public/fixture.ts"],
] as const;

const ALIASED = [
  ["destructured console.log", 'const { log } = console;\nlog("turn", token);'],
  ["destructured console.warn", 'const { warn } = console;\nwarn("turn");'],
  ["destructured with rename", 'const { info: tell } = console;\ntell("turn");'],
  ["destructured multiple", 'const { log, debug } = console;\ndebug("turn");'],
  ["aliased console.log", 'const say = console.log;\nsay("turn");'],
  ["aliased console.trace", 'const trace2 = console.trace;\ntrace2("turn");'],
  ["destructured stdout.write", 'const { write } = process.stdout;\nwrite("turn");'],
  ["aliased stderr.write", 'const emit = process.stderr.write;\nemit("turn");'],
] as const;

describe("CI check catches aliased/destructured logging in every module family", () => {
  for (const [family, path] of MODULES) {
    for (const [pattern, src] of ALIASED) {
      it(`${family}: catches ${pattern}`, () => {
        const findings = scanText(path, `${src}\n`);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings[0].label).toMatch(/aliased/);
      });
    }
  }
});

describe("CI check does not over-flag aliases", () => {
  it("ignores the binding line itself", () => {
    const findings = scanText(MODULES[0][1], "const { log } = console;\n");
    expect(findings).toHaveLength(0);
  });

  it("ignores destructured console.error (the sanctioned path)", () => {
    const src = "const { error } = console;\nerror(describeError(err));\n";
    expect(scanText(MODULES[0][1], src)).toHaveLength(0);
  });

  it("ignores unrelated same-name functions on objects", () => {
    const src = "const log = (s: string) => s;\nobj.log('fine');\n";
    expect(scanText(MODULES[0][1], src)).toHaveLength(0);
  });

  it("aliases do not leak across files", () => {
    const withAlias = "const say = console.log;\n";
    const other = 'say("turn");\n';
    expect(scanText(MODULES[0][1], withAlias)).toHaveLength(0);
    expect(scanText(MODULES[1][1], other)).toHaveLength(0);
  });
});
