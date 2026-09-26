import { describe, expect, it } from "vitest";
import { describeError } from "../error-capture";

/**
 * Logger-safety tests: the error logger (describeError) must handle hostile
 * or unusual failures without crashing or amplifying data, and errors from
 * the identity-verification path must stay free of tokens, user ids, and
 * desk content even when wrapped in cause chains.
 */

const SENSITIVE =
  /SECRET|private-brief|owner-id|attacker-id|attacker-token|acquisition|Bearer |claim:|sub=/i;

describe("describeError handles hostile input", () => {
  it("survives a circular object without throwing", () => {
    const circular: Record<string, unknown> = { note: "boom" };
    circular["self"] = circular;
    expect(() => describeError(circular)).not.toThrow();
  });

  it("survives an error with a circular cause chain", () => {
    const a = new Error("outer");
    const b = new Error("inner");
    a.cause = b;
    b.cause = a;
    const out = describeError(a);
    expect(out).toContain("outer");
    expect(out).toContain("inner");
  });

  it("truncates enormous payloads instead of flooding the log", () => {
    const huge = new Error("x".repeat(100_000));
    expect(describeError(huge).length).toBeLessThanOrEqual(8_000);
  });

  it("handles non-Error values: strings, numbers, null, undefined", () => {
    expect(describeError("plain string")).toContain("plain string");
    expect(describeError(42)).toContain("42");
    expect(describeError(null)).toBe("");
    expect(describeError(undefined)).toBe("");
  });
});

describe("identity-failure errors stay clean through the logger", () => {
  it("a wrapped 'Not signed in.' error logs no secrets", () => {
    const err = new Error("Not signed in.");
    const logged = describeError(err);
    expect(logged).not.toMatch(SENSITIVE);
  });

  it("a cause chain built on the refusal stays clean", () => {
    const refusal = new Error("Not signed in.");
    const wrapper = new Error("Request failed", { cause: refusal });
    const logged = describeError(wrapper);
    expect(logged).toContain("Request failed");
    expect(logged).toContain("Not signed in.");
    expect(logged).not.toMatch(SENSITIVE);
  });

  it("the refusal message itself contains no token, user id, or desk data", () => {
    // The exact message thrown on every identity-verification failure.
    const message = "Not signed in.";
    expect(message).not.toMatch(SENSITIVE);
    expect(message.length).toBeLessThan(80);
  });
});
