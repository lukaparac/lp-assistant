import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";

/**
 * Error-safety tests: when identity verification fails, every tool must
 * return the same bland refusal — no tokens, user ids, claims, stack
 * details, or anything from the desk may appear in the error, and the
 * message must be identical across tools and failure modes so an attacker
 * can't tell one failure from another.
 */

const SENSITIVE = /SECRET|private-brief|owner-id|attacker-token|acquisition|Bearer|supabase|database|claim/i;

vi.mock("./supabase", () => ({
  supabaseForUser: (ctx: ToolContext) => {
    const token = ctx.getToken();
    if (!token || !token.trim()) {
      throw new Error("supabaseForUser requires a verified OAuth token");
    }
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
  ["authenticated but no token", ctxFor({ authenticated: true, userId: "owner-id" })],
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

describe("refusal errors are safe and consistent", () => {
  it.each(failureModes)("list_recent_turns: %s leaks nothing", async (_label, ctx) => {
    const err = await errorOf(Promise.resolve(listRecentTurns.handler({ limit: 10 }, ctx)));
    expect(err.message).not.toMatch(SENSITIVE);
    expect(JSON.stringify(err)).not.toMatch(SENSITIVE);
  });

  it.each(failureModes)("search_desk: %s leaks nothing", async (_label, ctx) => {
    const err = await errorOf(
      Promise.resolve(searchDesk.handler({ query: "SECRET", limit: 10 }, ctx)),
    );
    expect(err.message).not.toMatch(SENSITIVE);
    expect(JSON.stringify(err)).not.toMatch(SENSITIVE);
  });

  it("both tools return the identical message for the same failure", async () => {
    for (const [_label, ctx] of failureModes) {
      const a = await errorOf(Promise.resolve(listRecentTurns.handler({ limit: 10 }, ctx)));
      const b = await errorOf(
        Promise.resolve(searchDesk.handler({ query: "x", limit: 10 }, ctx)),
      );
      expect(a.message).toBe(b.message);
    }
  });

  it("the refusal does not echo back anything the caller sent", async () => {
    const ctx = ctxFor({});
    const err = await errorOf(
      Promise.resolve(
        searchDesk.handler({ query: "attacker-chosen-probe-string-9182", limit: 10 }, ctx),
      ),
    );
    expect(err.message).not.toContain("attacker-chosen-probe-string-9182");
  });

  it("the refusal message is a short, human sentence", async () => {
    const err = await errorOf(
      Promise.resolve(listRecentTurns.handler({ limit: 10 }, ctxFor({}))),
    );
    expect(err.message.length).toBeLessThan(80);
    expect(err.message).toMatch(/not signed in/i);
  });
});
