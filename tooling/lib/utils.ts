/**
 * Utility functions used across the decohere system
 */

import { createHash } from "crypto";

/**
 * Generate SHA256 hash of text
 */
export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Normalize whitespace in a string
 */
export function normalize(key: string): string {
  return key.replace(/\s+/g, " ").trim();
}

/**
 * Escape special regex characters
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitize identifier for use as variable/function name
 */
export function sanitizeIdentifier(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1")
    .substring(0, 100);
}

/**
 * Check if value is a plain object (not null, not array)
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Stable JSON stringification for consistent output
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (key, val) => {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((result, k) => {
          result[k] = (val as Record<string, unknown>)[k];
          return result;
        }, {} as Record<string, unknown>);
    }
    return val;
  });
}

/**
 * Test if a number is prime
 */
export function isPrimeCandidate(value: number): boolean {
  if (!Number.isInteger(value) || value < 2) return false;
  for (let factor = 2; factor <= Math.sqrt(value); factor += 1) {
    if (value % factor === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Deduplicate a numeric array while preserving order
 */
export function dedupeNumberList(values: number[]): number[] {
  const seen = new Set<number>();
  return values.filter((v) => {
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

/**
 * Deduplicate an object array by stable stringification
 */
export function dedupeObjectList(
  values: Record<string, unknown>[]
): Record<string, unknown>[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const sig = stableStringify(v);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

/**
 * Normalize value for deduplication
 */
export function normalizeForDedup(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      normalized[k] = normalizeForDedup(v);
    }
    return normalized;
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeForDedup(v));
  }
  return value;
}

/**
 * Sanitize object for code generation
 */
export function sanitizeGeneratedObject(
  obj: unknown
): Record<string, unknown> | undefined {
  if (!isPlainObject(obj)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const sanitized = sanitizeIdentifier(key);
    if (sanitized.length === 0) continue;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[sanitized] = value;
    } else if (isPlainObject(value)) {
      const nested = sanitizeGeneratedObject(value);
      if (nested) {
        result[sanitized] = nested;
      }
    } else if (Array.isArray(value)) {
      result[sanitized] = value.filter(
        (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean"
      );
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
