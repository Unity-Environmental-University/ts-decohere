/**
 * Test suite for utility functions
 */

import { describe, it, expect } from "@jest/globals";
import {
  hashText,
  normalize,
  escapeRegExp,
  sanitizeIdentifier,
  isPlainObject,
  stableStringify,
  isPrimeCandidate,
  dedupeNumberList,
  dedupeObjectList,
  normalizeForDedup,
  sanitizeGeneratedObject,
} from "../tooling/lib/utils";

describe("Utility Functions", () => {
  describe("hashText", () => {
    it("should generate consistent hash", () => {
      const hash1 = hashText("test");
      const hash2 = hashText("test");
      expect(hash1).toBe(hash2);
    });

    it("should generate different hashes for different inputs", () => {
      const hash1 = hashText("test1");
      const hash2 = hashText("test2");
      expect(hash1).not.toBe(hash2);
    });

    it("should generate SHA256 hash (64 hex characters)", () => {
      const hash = hashText("test");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("normalize", () => {
    it("should trim whitespace", () => {
      expect(normalize("  test  ")).toBe("test");
    });

    it("should collapse multiple spaces", () => {
      expect(normalize("test   string")).toBe("test string");
    });

    it("should handle tabs and newlines", () => {
      expect(normalize("test\t\nstring")).toBe("test string");
    });
  });

  describe("escapeRegExp", () => {
    it("should escape special regex characters", () => {
      const escaped = escapeRegExp("test.string*with[special]+chars");
      expect(escaped).toBe("test\\.string\\*with\\[special\\]\\+chars");
    });

    it("should handle parentheses", () => {
      expect(escapeRegExp("(test)")).toBe("\\(test\\)");
    });
  });

  describe("sanitizeIdentifier", () => {
    it("should replace non-alphanumeric characters with underscore", () => {
      expect(sanitizeIdentifier("my-identifier")).toBe("my_identifier");
    });

    it("should handle leading digits", () => {
      expect(sanitizeIdentifier("123test")).toBe("_123test");
    });

    it("should limit length to 100 characters", () => {
      const long = "a".repeat(150);
      expect(sanitizeIdentifier(long).length).toBeLessThanOrEqual(100);
    });
  });

  describe("isPlainObject", () => {
    it("should return true for plain objects", () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ key: "value" })).toBe(true);
    });

    it("should return false for null", () => {
      expect(isPlainObject(null)).toBe(false);
    });

    it("should return false for arrays", () => {
      expect(isPlainObject([])).toBe(false);
    });

    it("should return false for primitives", () => {
      expect(isPlainObject("string")).toBe(false);
      expect(isPlainObject(42)).toBe(false);
      expect(isPlainObject(true)).toBe(false);
    });
  });

  describe("stableStringify", () => {
    it("should produce consistent output for objects with different key orders", () => {
      const obj1 = { b: 2, a: 1 };
      const obj2 = { a: 1, b: 2 };
      expect(stableStringify(obj1)).toBe(stableStringify(obj2));
    });

    it("should handle nested objects", () => {
      const obj1 = { outer: { b: 2, a: 1 } };
      const obj2 = { outer: { a: 1, b: 2 } };
      expect(stableStringify(obj1)).toBe(stableStringify(obj2));
    });
  });

  describe("isPrimeCandidate", () => {
    it("should identify prime numbers", () => {
      expect(isPrimeCandidate(2)).toBe(true);
      expect(isPrimeCandidate(3)).toBe(true);
      expect(isPrimeCandidate(5)).toBe(true);
      expect(isPrimeCandidate(7)).toBe(true);
      expect(isPrimeCandidate(11)).toBe(true);
    });

    it("should identify non-prime numbers", () => {
      expect(isPrimeCandidate(0)).toBe(false);
      expect(isPrimeCandidate(1)).toBe(false);
      expect(isPrimeCandidate(4)).toBe(false);
      expect(isPrimeCandidate(6)).toBe(false);
      expect(isPrimeCandidate(9)).toBe(false);
    });

    it("should handle negative numbers", () => {
      expect(isPrimeCandidate(-5)).toBe(false);
    });
  });

  describe("dedupeNumberList", () => {
    it("should remove duplicates while preserving order", () => {
      expect(dedupeNumberList([1, 2, 2, 3, 1, 4])).toEqual([1, 2, 3, 4]);
    });

    it("should handle empty array", () => {
      expect(dedupeNumberList([])).toEqual([]);
    });
  });

  describe("dedupeObjectList", () => {
    it("should remove duplicate objects", () => {
      const objs = [
        { a: 1, b: 2 },
        { a: 1, b: 2 },
        { a: 2, b: 3 },
      ];
      expect(dedupeObjectList(objs)).toHaveLength(2);
    });

    it("should consider object key order as same", () => {
      const objs = [{ b: 2, a: 1 }, { a: 1, b: 2 }];
      expect(dedupeObjectList(objs)).toHaveLength(1);
    });
  });

  describe("normalizeForDedup", () => {
    it("should trim strings", () => {
      expect(normalizeForDedup("  test  ")).toBe("test");
    });

    it("should handle nested objects", () => {
      const obj = { key: "  value  " };
      const normalized = normalizeForDedup(obj) as Record<string, unknown>;
      expect(normalized.key).toBe("value");
    });

    it("should convert non-finite numbers to null", () => {
      expect(normalizeForDedup(Infinity)).toBeNull();
      expect(normalizeForDedup(NaN)).toBeNull();
    });
  });

  describe("sanitizeGeneratedObject", () => {
    it("should sanitize object keys", () => {
      const obj = { "my-key": 1, "another.key": 2 };
      const sanitized = sanitizeGeneratedObject(obj);
      expect(sanitized).toBeDefined();
      expect(Object.keys(sanitized!)).toContain("my_key");
    });

    it("should remove non-primitive values", () => {
      const obj = { str: "text", num: 42, bool: true, func: () => {} };
      const sanitized = sanitizeGeneratedObject(obj);
      expect(sanitized).toBeDefined();
      expect(Object.keys(sanitized!)).not.toContain("func");
    });

    it("should return undefined for non-objects", () => {
      expect(sanitizeGeneratedObject("string")).toBeUndefined();
      expect(sanitizeGeneratedObject(42)).toBeUndefined();
    });
  });
});
