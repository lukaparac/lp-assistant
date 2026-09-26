import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";

/**
 * Integration tests: every logging entry point — the console.error wrapper,
 * describeError, and errors thrown by the MCP tools on the identity-failure
 * path — must write redacted output. A spy is installed as console.error
 * BEFORE error-capture loads, so the wrapper binds the spy and we see
 * exactly what would reach the log pipeline.
 */

const USER_ID = "3f8a1c2e-9b4d-4e5f-a6b7-c8d9e0f1a2b3";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIzZjhhMWMyZS05YjRkLTRlNWYtYTZiNy1jOGQ5ZTBmMWEyYjMifQ.signature";
const API_KEY = "sb_secret_abc123def456";
const SECRETS = [USER_ID, JWT, API_KEY, "attacker-token", "private-brief"];

let logged: string[] = [];

async function loadPipeline() {
  vi.resetModules();
  logged = [];
  const spy = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };
  console.error = spy; // error-capture binds this as its "original"
  const capture = await import("../error-capture");
  const redact = await import("../redact");
  return { capture, redact };
}

vi.mock("./supabase", () => ({
  supabaseForUser: (ctx: ToolContext) => {
    const token = ctx.getToken();
    if (!token || !token.trim()) throw new Error("Not signed in.");
    return {
      from: () => ({
        select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      }),
    };
  },
}));

const { default: listRecentTurns } = await import("./tools/recent-turns");
const { default: searchDesk } = await import("./tools/search-desk");

const anonymousCtx = {
  isAuthenticated: () => false,
  getToken: () => undefined,
  getUserId: () => undefined,
  getClaims: () => undefined,
} as unknown as ToolContext;

afterEach(() => {
  vi.restoreAllMocks();
});

function allLoggedText() {
  return logged.join("\n");
}

describe("every logging entry point redacts secrets", () => {
  it("console.error with a secret-bearing string is redacted", async () => {
    await loadPipeline();
    console.error(`request failed for user ${USER_ID} with Bearer ${JWT}`);
    expect(allLoggedText()).not.toContain(USER_ID);
    expect(allLoggedText()).not.toMatch(/eyJ/);
    expect(allLoggedText()).toContain("[redacted]");
  });

  it("console.error with a secret-bearing Error is redacted", async () => {
    await loadPipeline();
    console.error(new Error(`lookup ${USER_ID} key ${API_KEY}`));
    expect(allLoggedText()).not.toContain(USER_ID);
    expect(allLoggedText()).not.toContain(API_KEY);
  });

  it("console.error with a secret-bearing object is redacted", async () => {
    await loadPipeline();
    console.error({ sub: USER_ID, authorization: `Bearer ${JWT}` });
    expect(allLoggedText()).not.toContain(USER_ID);
    expect(allLoggedText()).not.toMatch(/eyJ/);
  });

  it("describeError output for a secret-bearing cause chain is redacted", async () => {
    const { capture } = await loadPipeline();
    const cause = new Error(`db row for ${USER_ID}`);
    const err = new Error(`call with Bearer ${JWT} failed`, { cause });
    const out = capture.describeError(err);
    expect(out).not.toContain(USER_ID);
    expect(out).not.toMatch(/eyJ/);
  });

  it("tool identity failures logged through the pipeline stay clean", async () => {
    const { capture } = await loadPipeline();
    for (const call of [
      listRecentTurns.handler({ limit: 10 }, anonymousCtx),
      searchDesk.handler({ query: "SECRET", limit: 10 }, anonymousCtx),
    ]) {
      try {
        await call;
        throw new Error("expected failure");
      } catch (err) {
        console.error(capture.describeError(err));
      }
    }
    for (const secret of SECRETS) {
      expect(allLoggedText()).not.toContain(secret);
    }
    expect(allLoggedText()).toContain("Not signed in.");
  });
});
