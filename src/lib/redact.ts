/**
 * Centralized log redaction. Everything the log pipeline writes — error
 * descriptions, console.error arguments — passes through redactText so a
 * token, user id, or piece of desk content can never reach the logs even if
 * some layer accidentally puts it in an error message.
 */

// Bearer tokens and JWTs (three base64url segments).
const TOKEN_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  // Supabase-style publishable/secret keys.
  /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/g,
];

// User ids are UUIDs (auth.users.id, claims.sub).
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const REDACTED = "[redacted]";

export function redactText(input: string): string {
  let out = input;
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED);
  out = out.replace(UUID_PATTERN, REDACTED);
  return out;
}

/** Redacts any loggable value: strings, Errors (message + stack), objects. */
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) return redactText(value.stack ?? `${value.name}: ${value.message}`);
  if (value == null) return value;
  try {
    return redactText(JSON.stringify(value));
  } catch {
    return REDACTED;
  }
}
