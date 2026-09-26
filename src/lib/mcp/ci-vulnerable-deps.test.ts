import { describe, expect, it } from "vitest";
import {
  actionableVulns,
  parseLockfile,
  queryOsv,
  resolvedPackages,
  runCheck,
  // @ts-expect-error plain .mjs script has no type declarations
} from "../../../scripts/check-vulnerable-deps.mjs";

/**
 * Fixture tests for the lockfile vulnerability CI check: it must parse the
 * bun.lock JSONC format, query the advisory database, and fail only when a
 * fix is actually available.
 */

const LOCK_FIXTURE = `{
  "lockfileVersion": 1,
  "packages": {
    "js-yaml": ["js-yaml@4.3.0", "", {}, "sha512-x",],
    "esbuild": ["esbuild@0.25.12", "", {}, "sha512-y",],
    "@scope/pkg": ["@scope/pkg@1.2.3", "", {}, "sha512-z",],
    "local-thing": ["local-thing@workspace:.", "", {}, "sha512-w",],
  },
}`;

describe("lockfile parsing", () => {
  it("parses bun.lock JSONC with trailing commas", () => {
    const lock = parseLockfile(LOCK_FIXTURE);
    expect(lock.packages["js-yaml"][0]).toBe("js-yaml@4.3.0");
  });

  it("extracts name and version for every resolved package", () => {
    const pkgs = resolvedPackages(parseLockfile(LOCK_FIXTURE));
    expect(pkgs).toContainEqual(expect.objectContaining({ name: "js-yaml", version: "4.3.0" }));
    expect(pkgs).toContainEqual(expect.objectContaining({ name: "@scope/pkg", version: "1.2.3" }));
  });

  it("skips non-semver entries like workspace references", () => {
    const pkgs = resolvedPackages(parseLockfile(LOCK_FIXTURE));
    expect(
      pkgs.find((p: { name: string }) => p.name === "local-thing"),
    ).toBeUndefined();
  });
});

const VULN_WITH_FIX = {
  vulns: [
    {
      id: "GHSA-2883-xcg3-v3hh",
      summary: "js-yaml prototype pollution",
      affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "4.3.2" }] }] }],
    },
  ],
};
const VULN_WITHOUT_FIX = {
  vulns: [
    {
      id: "GHSA-0000-nofix",
      summary: "unpatched issue",
      affected: [{ ranges: [{ events: [{ introduced: "0" }] }] }],
    },
  ],
};

describe("actionable vulnerability detection", () => {
  const pkgs = [{ name: "js-yaml", version: "4.3.0", key: "js-yaml" }];

  it("flags a vulnerability when a fixed version exists", () => {
    const findings = actionableVulns([VULN_WITH_FIX], pkgs);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ name: "js-yaml", version: "4.3.0", id: "GHSA-2883-xcg3-v3hh" });
    expect(findings[0].fixed).toContain("4.3.2");
  });

  it("does not flag vulnerabilities with no fix available", () => {
    expect(actionableVulns([VULN_WITHOUT_FIX], pkgs)).toHaveLength(0);
  });

  it("passes clean results through as no findings", () => {
    expect(actionableVulns([{ vulns: [] }, {}], pkgs)).toHaveLength(0);
  });
});

describe("OSV querying", () => {
  it("sends one query per package with the npm ecosystem", async () => {
    const calls: { queries: unknown[] }[] = [];
    const fakeFetch = async (_url: string, opts: { body: string }) => {
      calls.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ results: [{ vulns: [] }] }) };
    };
    await queryOsv([{ name: "js-yaml", version: "4.3.0" }], fakeFetch);
    expect(calls[0]?.queries).toEqual([
      { package: { name: "js-yaml", ecosystem: "npm" }, version: "4.3.0" },
    ]);
  });

  it("throws when the advisory service errors", async () => {
    const fakeFetch = async () => ({ ok: false, status: 500 });
    await expect(queryOsv([{ name: "x", version: "1.0.0" }], fakeFetch)).rejects.toThrow("HTTP 500");
  });
});

describe("runCheck end to end (mocked advisories)", () => {
  it("reports findings for a vulnerable lockfile", async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ results: [VULN_WITH_FIX, {}, {}, {}] }),
    });
    // Write the fixture to a temp file for runCheck to read.
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = mkdtempSync("/tmp/vuln-check-");
    const lockPath = join(dir, "bun.lock");
    writeFileSync(lockPath, LOCK_FIXTURE);
    const { scanned, findings } = await runCheck(lockPath, fakeFetch);
    expect(scanned).toBe(3);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe("js-yaml");
  });
});
