/**
 * Test suite for predicate compilation and management
 */

import { describe, it, expect } from "@jest/globals";
import {
  compileSingleLinePredicate,
  registerSingleLinePredicate,
  compilePredicate,
  extractPredicatePattern,
} from "../tooling/lib/predicates";
import { PredicateRegistry } from "../tooling/lib/types";

describe("Predicate Functions", () => {
  describe("compileSingleLinePredicate", () => {
    it("should compile x > N pattern", () => {
      const pred = compileSingleLinePredicate("x > 100");
      expect(pred).toBeDefined();
      expect(pred!(50)).toBe(false);
      expect(pred!(100)).toBe(false);
      expect(pred!(101)).toBe(true);
    });

    it("should compile x < N pattern", () => {
      const pred = compileSingleLinePredicate("x < 50");
      expect(pred).toBeDefined();
      expect(pred!(49)).toBe(true);
      expect(pred!(50)).toBe(false);
      expect(pred!(51)).toBe(false);
    });

    it("should compile x >= N pattern", () => {
      const pred = compileSingleLinePredicate("x >= 0");
      expect(pred).toBeDefined();
      expect(pred!(-1)).toBe(false);
      expect(pred!(0)).toBe(true);
      expect(pred!(1)).toBe(true);
    });

    it("should compile x <= N pattern", () => {
      const pred = compileSingleLinePredicate("x <= 1000");
      expect(pred).toBeDefined();
      expect(pred!(999)).toBe(true);
      expect(pred!(1000)).toBe(true);
      expect(pred!(1001)).toBe(false);
    });

    it("should compile x % N === M pattern (even)", () => {
      const pred = compileSingleLinePredicate("x % 2 === 0");
      expect(pred).toBeDefined();
      expect(pred!(2)).toBe(true);
      expect(pred!(4)).toBe(true);
      expect(pred!(3)).toBe(false);
      expect(pred!(5)).toBe(false);
    });

    it("should compile x % N === M pattern (odd)", () => {
      const pred = compileSingleLinePredicate("x % 2 === 1");
      expect(pred).toBeDefined();
      expect(pred!(1)).toBe(true);
      expect(pred!(3)).toBe(true);
      expect(pred!(2)).toBe(false);
    });

    it("should compile typeof x === 'string' pattern", () => {
      const pred = compileSingleLinePredicate('typeof x === "string"');
      expect(pred).toBeDefined();
      expect(pred!("hello")).toBe(true);
      expect(pred!(42)).toBe(false);
    });

    it("should compile typeof x === 'number' pattern", () => {
      const pred = compileSingleLinePredicate('typeof x === "number"');
      expect(pred).toBeDefined();
      expect(pred!(42)).toBe(true);
      expect(pred!("42")).toBe(false);
    });

    it("should compile Array.isArray(x) pattern", () => {
      const pred = compileSingleLinePredicate("Array.isArray(x)");
      expect(pred).toBeDefined();
      expect(pred!([])).toBe(true);
      expect(pred!([1, 2, 3])).toBe(true);
      expect(pred!({})).toBe(false);
    });

    it("should compile x === 'literal' pattern", () => {
      const pred = compileSingleLinePredicate('x === "value"');
      expect(pred).toBeDefined();
      expect(pred!("value")).toBe(true);
      expect(pred!("other")).toBe(false);
    });

    it("should handle whitespace in expressions", () => {
      const pred = compileSingleLinePredicate("  x  >  100  ");
      expect(pred).toBeDefined();
      expect(pred!(101)).toBe(true);
    });

    it("should return undefined for unsupported patterns", () => {
      expect(compileSingleLinePredicate("x && y > 10")).toBeUndefined();
      expect(compileSingleLinePredicate("Math.floor(x) > 5")).toBeUndefined();
    });

    it("should handle negative numbers", () => {
      const pred = compileSingleLinePredicate("x > -100");
      expect(pred).toBeDefined();
      expect(pred!(-99)).toBe(true);
      expect(pred!(-100)).toBe(false);
    });

    it("should handle decimal numbers", () => {
      const pred = compileSingleLinePredicate("x > 3.14");
      expect(pred).toBeDefined();
      expect(pred!(3.15)).toBe(true);
      expect(pred!(3.14)).toBe(false);
    });
  });

  describe("registerSingleLinePredicate", () => {
    it("should register predicate in registry", () => {
      const registry: PredicateRegistry = {};
      const id = registerSingleLinePredicate("isEven", "Check if even", "x % 2 === 0", registry);

      expect(id).toBeDefined();
      expect(registry[id!]).toBeDefined();
      expect(registry[id!].name).toBe("isEven");
    });

    it("should return undefined for invalid expression", () => {
      const registry: PredicateRegistry = {};
      const id = registerSingleLinePredicate("invalid", "Invalid predicate", "x && y", registry);

      expect(id).toBeUndefined();
    });

    it("should generate consistent IDs for same source", () => {
      const registry: PredicateRegistry = {};
      const id1 = registerSingleLinePredicate("pred1", "Predicate 1", "x > 100", registry);
      const id2 = registerSingleLinePredicate("pred2", "Predicate 2", "x > 100", registry);

      // Same source should generate same ID (hash is based on predicateSource)
      expect(id1).toBe(id2);
    });
  });

  describe("compilePredicate", () => {
    it("should compile single-line predicates", () => {
      const pred = compilePredicate("x > 100");
      expect(pred(101)).toBe(true);
      expect(pred(99)).toBe(false);
    });

    it("should compile complex predicates via Function constructor", () => {
      const pred = compilePredicate("typeof value === 'number' && value > 0");
      expect(pred(5)).toBe(true);
      expect(pred(-5)).toBe(false);
      expect(pred("5")).toBe(false);
    });

    it("should handle compilation errors gracefully", () => {
      const pred = compilePredicate("this will not compile }{");
      expect(pred(5)).toBe(false); // Should return false instead of throwing
    });
  });

  describe("extractPredicatePattern", () => {
    it("should identify greaterThan pattern", () => {
      expect(extractPredicatePattern("x > 100")).toBe("greaterThan");
    });

    it("should identify lessThan pattern", () => {
      expect(extractPredicatePattern("x < 50")).toBe("lessThan");
    });

    it("should identify greaterThanOrEqual pattern", () => {
      expect(extractPredicatePattern("x >= 0")).toBe("greaterThanOrEqual");
    });

    it("should identify lessThanOrEqual pattern", () => {
      expect(extractPredicatePattern("x <= 1000")).toBe("lessThanOrEqual");
    });

    it("should identify modulo pattern", () => {
      expect(extractPredicatePattern("x % 2 === 0")).toBe("modulo");
    });

    it("should identify typeCheck pattern", () => {
      expect(extractPredicatePattern('typeof x === "number"')).toBe("typeCheck");
    });

    it("should identify arrayCheck pattern", () => {
      expect(extractPredicatePattern("Array.isArray(x)")).toBe("arrayCheck");
    });

    it("should identify stringLiteral pattern", () => {
      expect(extractPredicatePattern('x === "value"')).toBe("stringLiteral");
    });

    it("should return undefined for unknown pattern", () => {
      expect(extractPredicatePattern("x && y")).toBeUndefined();
    });
  });
});
