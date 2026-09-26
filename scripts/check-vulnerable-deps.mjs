#!/usr/bin/env node
/**
 * CI check: scan the lockfile for known vulnerable dependency versions and
 * fail when a fix is available.
 *
 * Reads bun.lock (JSONC), resolves every package@version pair, and queries
 * the OSV vulnerability database (https://osv.dev). Exits 1 if any resolved
 * version is affected by an advisory that has a fixed release — meaning
 * `bun update <pkg>` would remediate it.
 *
 * Usage: node scripts/check-vulnerable-deps.mjs [path-to-lockfile]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const MAX_BATCH = 1000;

/** Strip trailing commas so bun.lock (JSONC) parses as JSON. */
export function parseLockfile(text) {
  const cleaned = text.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(cleaned);
}

/** Extract { name, version } for every resolved package in the lockfile. */
export function resolvedPackages(lock) {
  const out = [];
  const packages = lock.packages ?? {};
  for (const [key, entry] of Object.entries(packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const id = entry[0]; // e.g. "js-yaml@4.3.0" or "@scope/pkg@1.2.3"
    const at = id.lastIndexOf("@");
    if (at <= 0) continue;
    const name = id.slice(0, at);
    const version = id.slice(at + 1);
    if (!/^\d+\.\d+\.\d+/.test(version)) continue; // skip non-semver (workspace, file:)
    out.push({ name, version, key });
  }
  return out;
}

/** Query OSV for vulnerabilities affecting the given packages. */
export async function queryOsv(packages, fetchImpl = fetch) {
  const results = [];
  for (let i = 0; i < packages.length; i += MAX_BATCH) {
    const slice = packages.slice(i, i + MAX_BATCH);
    const res = await fetchImpl(OSV_BATCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        queries: slice.map((p) => ({
          package: { name: p.name, ecosystem: "npm" },
          version: p.version,
        })),
      }),
    });
    if (!res.ok) throw new Error(`OSV query failed: HTTP ${res.status}`);
    const body = await res.json();
    results.push(...(body.results ?? []));
  }
  return results;
}

/**
 * A vulnerability is actionable when any affected range lists a "fixed" event,
 * i.e. an update path exists.
 */
export function actionableVulns(osvResults, packages) {
  const findings = [];
  osvResults.forEach((result, idx) => {
    for (const vuln of result?.vulns ?? []) {
      const fixed = (vuln.affected ?? [])
        .flatMap((a) => a.ranges ?? [])
        .flatMap((r) => r.events ?? [])
        .map((e) => e.fixed)
        .filter(Boolean);
      if (fixed.length === 0) continue; // no fix available yet — nothing to do
      findings.push({
        name: packages[idx].name,
        version: packages[idx].version,
        id: vuln.id,
        summary: vuln.summary ?? "",
        fixed: [...new Set(fixed)].sort(),
      });
    }
  });
  return findings;
}

export async function runCheck(lockfilePath = "bun.lock", fetchImpl = fetch) {
  const lock = parseLockfile(readFileSync(lockfilePath, "utf8"));
  const packages = resolvedPackages(lock);
  const results = await queryOsv(packages, fetchImpl);
  const findings = actionableVulns(results, packages);
  return { scanned: packages.length, findings };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const lockfile = process.argv[2] ?? "bun.lock";
  try {
    const { scanned, findings } = await runCheck(lockfile);
    if (findings.length > 0) {
      console.error(`VULNERABLE DEPENDENCIES (${findings.length}):`);
      for (const f of findings) {
        console.error(
          `  ${f.name}@${f.version} — ${f.id}: ${f.summary} (fixed in ${f.fixed.join(", ")})`,
        );
      }
      console.error("Run `bun update <pkg>` to re-resolve to a fixed version.");
      process.exit(1);
    }
    console.log(`Dependency check passed: ${scanned} packages scanned, no fixable vulnerabilities.`);
  } catch (err) {
    console.error(`Dependency check failed to run: ${err.message}`);
    process.exit(2);
  }
}
