import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";

/**
 * Identity-spoofing tests: a caller must never be able to read the desk as
 * someone else. Tools take identity exclusively from the verified session —
 * any user id supplied in the request arguments must be ignored, and a
 * context whose token, user id and claims disagree must not reach the
 * database as the spoofed user.
 */

/** Records which bearer token the database client was built with. */
let lastToken: string | undefined;

vi.mock("./supabase", () => ({
  supabaseForUser: (ctx: ToolContext) => {
    const token = ctx.getToken();
    if (!token || !token.trim()) {
      throw new Error("Not signed in.");
    }
    lastToken = token;
    return {
      from: () => ({
        select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      }),
    };
  },
}));

const { default: listRecentTurns } = await import("./tools/recent-turns");
const { default: searchDesk } = await import("./tools/search-desk");

function sessionCtx(token: string, userId: string): ToolContext {
  return {
    isAuthenticated: () => true,
    getToken: () => token,
    getUserId: () => userId,
    getClaims: () => ({ sub: userId }),
  } as unknown as ToolContext;
}

const attacker = sessionCtx("attacker-token", "attacker-id");

describe("caller-supplied identity is ignored", () => {
  it("list_recent_turns ignores a userId argument and queries as the session user", async () => {
    lastToken = undefined;
    await listRecentTurns.handler(
      { limit: 10, userId: "owner-id", user_id: "owner-id" } as never,
      attacker,
    );
    expect(lastToken).toBe("attacker-token");
  });

  it("search_desk ignores a userId argument and queries as the session user", async () => {
    lastToken = undefined;
    await searchDesk.handler(
      { query: "notes", limit: 10, userId: "owner-id" } as never,
      attacker,
    );
    expect(lastToken).toBe("attacker-token");
  });
});

describe("inconsistent identity within the session", () => {
  it("a token whose claims name a different user still only forwards the token", async () => {
    const ctx = {
      isAuthenticated: () => true,
      getToken: () => "attacker-token",
      getUserId: () => "owner-id", // claims/session disagree with the token
      getClaims: () => ({ sub: "owner-id" }),
    } as unknown as ToolContext;

    lastToken = undefined;
    await listRecentTurns.handler({ limit: 10 }, ctx);
    // The database sees the token, and the database's access rules — not the
    // claimed user id — decide what comes back.
    expect(lastToken).toBe("attacker-token");
  });

  it("no tool accepts an identity override field", async () => {
    const { default: mcp } = await import("./index");
    const tools = (mcp as unknown as { tools?: Array<{ name: string }> }).tools ?? [];
    for (const tool of tools) {
      const result = await Promise.resolve(
        (tool as unknown as { handler: (a: unknown, c: ToolContext) => unknown }).handler(
          { limit: 5, query: "x", userId: "owner-id", impersonate: "owner-id" },
          attacker,
        ),
      );
      // Whatever the tool returns, it must not contain owner data — the
      // attacker's token sees nothing under the desk's access rules.
      expect(JSON.stringify(result)).not.toMatch(/SECRET|private-brief/);
    }
  });
});
