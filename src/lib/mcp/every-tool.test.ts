import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";

/**
 * Guard for future tools: every tool registered on the agent integration must
 * refuse a caller with no verified sign-in. A new tool that forgets the check
 * fails here.
 */

vi.mock("./supabase", () => ({
  supabaseForUser: () => {
    throw new Error("A tool reached the database without checking the caller.");
  },
}));

const { default: mcp } = await import("./index");

const anonymousCtx = {
  isAuthenticated: () => false,
  getToken: () => undefined,
  getUserId: () => undefined,
  getClaims: () => undefined,
} as unknown as ToolContext;

const tools = (mcp as unknown as { tools: Array<{ name: string; handler: Function }> }).tools ?? [];

describe("every registered tool", () => {
  it("registers at least one tool", () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it.each(tools.map((t) => [t.name, t] as const))("%s refuses anonymous callers", async (_n, t) => {
    await expect(
      Promise.resolve(t.handler({ limit: 1, query: "secret" }, anonymousCtx)),
    ).rejects.toThrow(/not signed in/i);
  });
});
