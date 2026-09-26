import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";
import type { DeskRow } from "./desk-text";

/**
 * Access tests for the agent integration (MCP) tools.
 *
 * The desk is owner-only: the database's "Owner reads the desk" rule filters
 * chat_messages down to nothing for any account that is not the desk admin.
 * These tests assert that (a) anonymous callers are refused outright and
 * (b) an authenticated non-owner gets zero desk content from every tool.
 */

const OWNER_ROWS: DeskRow[] = [
  {
    sdk_id: "row-1",
    role: "user",
    content: { parts: [{ type: "text", text: "SECRET margin note about acquisition" }] },
    created_at: "2026-01-01T10:00:00.000Z",
  },
  {
    sdk_id: "row-2",
    role: "assistant",
    content: {
      parts: [
        { type: "text", text: "Answer referencing the SECRET note" },
        { type: "file", filename: "private-brief.txt" },
      ],
    },
    created_at: "2026-01-01T10:00:05.000Z",
  },
];

/** Rows the database would return for this caller: owner sees all, others none. */
let visibleRows: DeskRow[] = [];

/** Minimal stand-in for the filtered chat_messages query chain. */
function fakeClient() {
  const result = { data: visibleRows, error: null };
  const chain = {
    select: () => chain,
    order: () => chain,
    limit: () => Promise.resolve(result),
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return { from: () => chain };
}

vi.mock("./supabase", () => ({
  supabaseForUser: (ctx: ToolContext) => {
    if (!ctx.getToken()) throw new Error("supabaseForUser requires a verified OAuth token");
    return fakeClient();
  },
}));

const { default: listRecentTurns } = await import("./tools/recent-turns");
const { default: searchDesk } = await import("./tools/search-desk");

function ctxFor(token: string | undefined): ToolContext {
  return {
    isAuthenticated: () => Boolean(token),
    getToken: () => token,
    getUserId: () => (token ? "user-id" : undefined),
    getClaims: () => (token ? { sub: "user-id" } : undefined),
  } as unknown as ToolContext;
}

const anonymousCtx = ctxFor(undefined);
const nonOwnerCtx = ctxFor("token-for-a-stranger");
const ownerCtx = ctxFor("token-for-the-owner");

function allText(result: unknown) {
  const r = result as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
  return (
    (r.content ?? []).map((c) => c.text ?? "").join("\n") + JSON.stringify(r.structuredContent)
  );
}

beforeEach(() => {
  visibleRows = [];
});

describe("anonymous callers", () => {
  it("cannot list recent turns", async () => {
    await expect(listRecentTurns.handler({ limit: 20 }, anonymousCtx)).rejects.toThrow(
      /not signed in/i,
    );
  });

  it("cannot search the desk", async () => {
    await expect(searchDesk.handler({ query: "SECRET", limit: 10 }, anonymousCtx)).rejects.toThrow(
      /not signed in/i,
    );
  });
});

describe("authenticated non-owner", () => {
  it("gets no turns and no desk text from list_recent_turns", async () => {
    visibleRows = []; // database hides every row from a non-owner
    const result = await listRecentTurns.handler({ limit: 100 }, nonOwnerCtx);
    expect(result.structuredContent).toEqual({ turns: [] });
    expect(allText(result)).not.toMatch(/SECRET|private-brief/);
  });

  it("gets no matches and no desk text from search_desk", async () => {
    visibleRows = [];
    const result = await searchDesk.handler({ query: "SECRET", limit: 50 }, nonOwnerCtx);
    expect(result.structuredContent).toEqual({ matches: [] });
    expect(allText(result)).not.toMatch(/acquisition|private-brief/);
  });

  it("leaks nothing through any exposed tool", async () => {
    visibleRows = [];
    const calls: Array<Promise<unknown>> = [
      listRecentTurns.handler({ limit: 100 }, nonOwnerCtx),
      searchDesk.handler({ query: "a", limit: 50 }, nonOwnerCtx),
      searchDesk.handler({ query: "e", limit: 50 }, nonOwnerCtx),
    ];
    for (const call of calls) {
      const result = (await call) as Parameters<typeof allText>[0];
      expect(allText(result)).not.toMatch(/SECRET|acquisition|private-brief/);
    }
  });
});

describe("the owner", () => {
  it("still sees their own desk", async () => {
    visibleRows = OWNER_ROWS;
    const listed = await listRecentTurns.handler({ limit: 20 }, ownerCtx);
    expect(allText(listed)).toMatch(/SECRET margin note/);

    const found = await searchDesk.handler({ query: "acquisition", limit: 10 }, ownerCtx);
    expect(allText(found)).toMatch(/acquisition/);
  });
});
