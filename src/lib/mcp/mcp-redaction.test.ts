import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "../redact";
import { describeError } from "../error-capture";

/**
 * Redaction tests: the central log pipeline must strip tokens, user ids
 * (UUIDs), and API keys from anything it writes — error messages, stacks,
 * cause chains, and plain console.error arguments.
 */

const USER_ID = "3f8a1c2e-9b4d-4e5f-a6b7-c8d9e0f1a2b3";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIzZjhhMWMyZS05YjRkLTRlNWYtYTZiNy1jOGQ5ZTBmMWEyYjMifQ.signature";
const API_KEY = "sb_secret_abc123def456";

describe("redactText", () => {
  it("redacts Bearer tokens", () => {
    expect(redactText(`Authorization: Bearer ${JWT}`)).not.toContain(JWT);
    expect(redactText(`Bearer attacker-token-value`)).toBe("[redacted]");
  });

  it("redacts JWTs wherever they appear", () => {
    expect(redactText(`token was ${JWT} ok`)).not.toMatch(/eyJ/);
  });

  it("redacts Supabase-style keys", () => {
    expect(redactText(`key: ${API_KEY}`)).toBe("key: [redacted]");
  });

  it("redacts UUIDs (user ids)", () => {
    expect(redactText(`user ${USER_ID} failed`)).toBe("user [redacted] failed");
  });

  it("leaves ordinary text untouched", () => {
    expect(redactText("Not signed in.")).toBe("Not signed in.");
    expect(redactText("Request failed with status 500")).toBe("Request failed with status 500");
  });
});

describe("redactValue", () => {
  it("redacts strings, errors, and objects", () => {
    expect(redactValue(`Bearer ${JWT}`)).not.toMatch(/eyJ/);
    expect(redactValue(new Error(`user ${USER_ID}`))).not.toContain(USER_ID);
    expect(redactValue({ userId: USER_ID, token: JWT })).not.toMatch(/eyJ|3f8a1c2e/);
  });

  it("returns a safe placeholder for unstringifiable values", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(redactValue(circular)).toBe("[redacted]");
  });
});

describe("the log pipeline redacts end to end", () => {
  it("describeError strips secrets from message, stack, and cause chain", () => {
    const cause = new Error(`db lookup for ${USER_ID} failed`);
    const err = new Error(`request with Bearer ${JWT} failed`, { cause });
    const logged = describeError(err);
    expect(logged).not.toMatch(/eyJ/);
    expect(logged).not.toContain(USER_ID);
    expect(logged).toContain("[redacted]");
  });

  it("secrets embedded in a JSON blob in the message are redacted", () => {
    const err = new Error(JSON.stringify({ sub: USER_ID, key: API_KEY }));
    const logged = describeError(err);
    expect(logged).not.toContain(USER_ID);
    expect(logged).not.toContain(API_KEY);
  });
});
