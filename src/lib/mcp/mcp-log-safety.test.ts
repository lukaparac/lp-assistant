import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";
import { describeError } from "../error-capture";

/**
 * Log-safety tests: when identity verification fails, whatever reaches the
 * application log pipeline (which records full error stacks via
 * describeError) must contain no tokens, user ids, claims, or desk content.
 */

const SENSITIVE =
  /SECRET|private-brief|owner-id|attacker-id|attacker-token|acquisition|Bearer|supabase|claim|sub=/i;

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

function ctxFor(overrides: {
  authenticated?: boolean;
  token?: string;
  userId?: string;
  claims?: Record<string, unknown>;
}): ToolContext {
  return {
    isAuthenticated: () => overrides.authenticated ?? false,
    getToken: () => overrides.token,
    getUserId: () => overrides.userId,
    getClaims: () => overrides.claims,
  } as unknown as ToolContext;
}

const failureModes: Array<[string, ToolContext]> = [
  ["no session", ctxFor({})],
  ["token but not authenticated", ctxFor({ authenticated: false, token: "attacker-token" })],
  [
    "authenticated but no token",
    ctxFor({ authenticated: true, userId: "owner-id", claims: { sub: "owner-id" } }),
  ],
  ["authenticated with empty token", ctxFor({ authenticated: true, token: "" })],
];

async function errorOf(call: Promise<unknown>): Promise<Error> {
  try {
    await call;
  } catch (err) {
    return err as Error;
  }
  throw new Error("Expected the call to fail, but it succeeded.");
}

describe("identity-failure errors are safe to log", () => {
  it.each(failureModes)("list_recent_turns: %s", async (_label, ctx) => {
    const err = await errorOf(Promise.resolve(listRecentTurns.handler({ limit: 10 }, ctx)));
    // describeError is exactly what the log pipeline writes for a thrown error.
    expect(describeError(err)).not.toMatch(SENSITIVE);
  });

  it.each(failureModes)("search_desk: %s", async (_label, ctx) => {
    const err = await errorOf(
      Promise.resolve(searchDesk.handler({ query: "SECRET", limit: 10 }, ctx)),
    );
    expect(describeError(err)).not.toMatch(SENSITIVE);
  });

  it("the logged form carries no caller-controlled input", async () => {
    const err = await errorOf(
      Promise.resolve(
        searchDesk.handler({ query: "attacker-probe-7781", limit: 10 }, ctxFor({})),
      ),
    );
    expect(describeError(err)).not.toContain("attacker-probe-7781");
  });
});
