import { createHash } from "node:crypto";

/**
 * JSON with object keys sorted, so the same values always produce the same
 * string regardless of how the parser happened to build the object.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Hash of the EXTRACTED values, never of the response body.
 *
 * These are ASP.NET pages carrying per-request viewstate, so a whole-page hash
 * changes on every fetch and phase 5's nightly reconciliation would flag all
 * seven days every night.
 */
export function contentHash(extracted: unknown): string {
  return createHash("sha256").update(canonical(extracted)).digest("hex");
}
