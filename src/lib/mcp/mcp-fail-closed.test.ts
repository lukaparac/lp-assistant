import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";

/**
 * Fail-closed tests: every tool must refuse when the caller's identity is
 * missing or invalid — no token, an empty token, a token with no user id,
 * or claims that don't identify anyone. A tool that only checks
 * isAuthenticated() but forwards an empty token to the database fails here.
 */

vi.mock("./supabase", () => ({
  supabaseForUser: (ctx: ToolContext) => {
    const token = ctx.getToken();
    if (!token || !token.trim()) {
      throw new Error("supabaseForUser requires a verified OAuth token");
    }
    return { from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
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

const brokenIdentities: Array<[string, ToolContext]> = [
  ["no session at all", ctxFor({})],
  ["authenticated=false with a token", ctxFor({ authenticated: false, token: "tok", userId: "u", claims: { sub: "u" } })],
  ["authenticated=true but token missing", ctxFor({ authenticated: true })],
  ["authenticated=true but token is empty", ctxFor({ authenticated: true, token: "" })],
  ["authenticated=true but token is whitespace", ctxFor({ authenticated: true, token: "   " })],
];

describe("list_recent_turns fails closed", () => {
  it.each(brokenIdentities)("refuses when %s", async (_label, ctx) => {
    await expect(Promise.resolve(listRecentTurns.handler({ limit: 10 }, ctx))).rejects.toThrow();
  });
});

describe("search_desk fails closed", () => {
  it.each(brokenIdentities)("refuses when %s", async (_label, ctx) => {
    await expect(
      Promise.resolve(searchDesk.handler({ query: "SECRET", limit: 10 }, ctx)),
    ).rejects.toThrow();
  });
});

describe("supabaseForUser itself", () => {
  it("refuses an empty token even if a tool forgot to check", async () => {
    const { supabaseForUser } = await import("./supabase");
    expect(() => supabaseForUser(ctxFor({ authenticated: true, token: "" }))).toThrow(
      /verified OAuth token/i,
    );
    expect(() => supabaseForUser(ctxFor({ authenticated: true }))).toThrow(
      /verified OAuth token/i,
    );
  });
});
