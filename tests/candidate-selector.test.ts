/**
 * Test suite for candidate selector module
 */

import { describe, it, expect } from "@jest/globals";
import {
  calculateComplexityScore,
  calculateCoverageScore,
  calculateReusabilityScore,
  scoreCandidate,
  rankCandidates,
  selectBestCandidate,
  formatCandidateScore,
  isConfidentCandidate,
  combineAndRankCandidates,
} from "../tooling/lib/candidate-selector";
import { HeuristicDefinition, Constraint } from "../tooling/lib/types";

describe("Candidate Selector", () => {
  describe("calculateComplexityScore", () => {
    it("should score short predicates as simple", () => {
      const score = calculateComplexityScore("(x) => x > 100");
      expect(score).toBeGreaterThan(0.8);
    });

    it("should score long predicates as complex", () => {
      const longPredicate = "(x) => { " + "test".repeat(100) + " }";
      const score = calculateComplexityScore(longPredicate);
      expect(score).toBeLessThan(0.5);
    });

    it("should cap at 1.0 for very short predicates", () => {
      const score = calculateComplexityScore("x > 10");
      expect(score).toBe(1.0);
    });

    it("should floor at 0.1 for very long predicates", () => {
      const longPredicate = "x => {" + "return ".repeat(100) + "}";
      const score = calculateComplexityScore(longPredicate);
      expect(score).toBeLessThanOrEqual(0.2);
    });
  });

  describe("calculateReusabilityScore", () => {
    it("should score single-line numeric patterns highly", () => {
      expect(calculateReusabilityScore("x > 100")).toBeGreaterThan(0.8);
      expect(calculateReusabilityScore("x % 2 === 0")).toBeGreaterThan(0.7);
    });

    it("should score type checks highly", () => {
      const score = calculateReusabilityScore("typeof x === 'number'");
      expect(score).toBeGreaterThan(0.8);
    });

    it("should score complex predicates low", () => {
      const score = calculateReusabilityScore("(x) => x > 0 && x < 100 && x % 2 === 0 && x !== 50");
      expect(score).toBeLessThan(0.6);
    });

    it("should score very long predicates low", () => {
      const longPredicate = "(x) => {" + " test.method().result()".repeat(50) + "}";
      const score = calculateReusabilityScore(longPredicate);
      expect(score).toBeLessThan(0.4);
    });
  });

  describe("scoreCandidate", () => {
    it("should score simple, reusable candidates highly", () => {
      const candidate: HeuristicDefinition = {
        name: "isEven",
        description: "Check if even",
        predicate: "x % 2 === 0",
      };

      const score = scoreCandidate(candidate, []);

      expect(score.totalScore).toBeGreaterThan(0.6);
      expect(score.complexityScore).toBeGreaterThan(0.8);
      expect(score.reusabilityScore).toBeGreaterThan(0.7);
    });

    it("should include reasoning", () => {
      const candidate: HeuristicDefinition = {
        name: "simple",
        description: "Simple check",
        predicate: "x > 0",
      };

      const score = scoreCandidate(candidate, []);

      expect(score.reasoning.length).toBeGreaterThan(0);
      expect(score.reasoning[0]).toContain("simple");
    });

    it("should respect custom weights", () => {
      const candidate: HeuristicDefinition = {
        name: "test",
        description: "test",
        predicate: "(x) => x % 2 === 0",
      };

      const score1 = scoreCandidate(candidate, [], [], {
        complexity: 0.8,
        coverage: 0.1,
        reusability: 0.1,
      });

      const score2 = scoreCandidate(candidate, [], [], {
        complexity: 0.1,
        coverage: 0.8,
        reusability: 0.1,
      });

      expect(score1.totalScore).toBeGreaterThan(score2.totalScore);
    });
  });

  describe("rankCandidates", () => {
    it("should rank candidates by score", () => {
      const candidates: HeuristicDefinition[] = [
        {
          name: "simple",
          description: "Simple predicate",
          predicate: "x > 0",
        },
        {
          name: "complex",
          description: "Complex predicate",
          predicate: "(x) => { let result = x > 0; return result && x < 100 && x % 2 === 0; }",
        },
      ];

      const ranked = rankCandidates(candidates, []);

      expect(ranked[0].candidate.name).toBe("simple");
      expect(ranked[1].candidate.name).toBe("complex");
    });

    it("should maintain score information", () => {
      const candidates: HeuristicDefinition[] = [
        {
          name: "test",
          description: "test",
          predicate: "x > 0",
        },
      ];

      const ranked = rankCandidates(candidates, []);

      expect(ranked[0].totalScore).toBeGreaterThan(0);
      expect(ranked[0].complexityScore).toBeGreaterThan(0);
      expect(ranked[0].reusabilityScore).toBeGreaterThan(0);
    });
  });

  describe("selectBestCandidate", () => {
    it("should select highest-scoring candidate", () => {
      const candidates: HeuristicDefinition[] = [
        {
          name: "mediocre",
          description: "Mediocre predicate",
          predicate: "(x) => { return x > 0 && x < 100 && x % 2 === 0; }",
        },
        {
          name: "excellent",
          description: "Excellent predicate",
          predicate: "x % 2 === 0",
        },
      ];

      const { candidate, alternatives } = selectBestCandidate(candidates, []);

      expect(candidate.candidate.name).toBe("excellent");
      expect(alternatives).toHaveLength(1);
    });

    it("should return alternatives", () => {
      const candidates: HeuristicDefinition[] = [
        { name: "c1", description: "1", predicate: "x > 0" },
        { name: "c2", description: "2", predicate: "x > 1" },
        { name: "c3", description: "3", predicate: "x > 100" },
      ];

      const { candidate, alternatives } = selectBestCandidate(candidates, []);

      expect(candidate).toBeDefined();
      expect(alternatives).toHaveLength(2);
    });

    it("should throw on empty candidates", () => {
      expect(() => selectBestCandidate([], [])).toThrow("No candidates to select from");
    });
  });

  describe("isConfidentCandidate", () => {
    it("should identify confident candidates", () => {
      const score = {
        candidate: { name: "test", description: "test", predicate: "x > 0" },
        complexityScore: 0.9,
        coverageScore: 0.8,
        reusabilityScore: 0.8,
        totalScore: 0.85,
        reasoning: [],
      };

      expect(isConfidentCandidate(score, 0.6)).toBe(true);
      expect(isConfidentCandidate(score, 0.9)).toBe(false);
    });

    it("should respect confidence threshold", () => {
      const score = {
        candidate: { name: "test", description: "test", predicate: "x > 0" },
        complexityScore: 0.7,
        coverageScore: 0.7,
        reusabilityScore: 0.7,
        totalScore: 0.7,
        reasoning: [],
      };

      expect(isConfidentCandidate(score, 0.5)).toBe(true);
      expect(isConfidentCandidate(score, 0.8)).toBe(false);
    });
  });

  describe("formatCandidateScore", () => {
    it("should format score for display", () => {
      const score = {
        candidate: { name: "test", description: "test", predicate: "x > 0" },
        complexityScore: 0.9,
        coverageScore: 0.8,
        reusabilityScore: 0.8,
        totalScore: 0.85,
        reasoning: ["Very simple", "Good coverage"],
      };

      const formatted = formatCandidateScore(score, 0);

      expect(formatted).toContain("Candidate 1");
      expect(formatted).toContain("test");
      expect(formatted).toContain("85.");
      expect(formatted).toContain("Complexity");
      expect(formatted).toContain("Coverage");
      expect(formatted).toContain("Reusability");
      expect(formatted).toContain("Very simple");
    });
  });

  describe("combineAndRankCandidates", () => {
    it("should combine multiple candidate lists", () => {
      const list1: HeuristicDefinition[] = [
        { name: "c1", description: "1", predicate: "x > 0" },
      ];

      const list2: HeuristicDefinition[] = [
        { name: "c2", description: "2", predicate: "x < 100" },
      ];

      const combined = combineAndRankCandidates([list1, list2], []);

      expect(combined).toHaveLength(2);
    });

    it("should deduplicate identical candidates", () => {
      const list1: HeuristicDefinition[] = [
        { name: "c1", description: "1", predicate: "x > 0" },
      ];

      const list2: HeuristicDefinition[] = [
        { name: "c1", description: "1", predicate: "x > 0" },
        { name: "c2", description: "2", predicate: "x < 100" },
      ];

      const combined = combineAndRankCandidates([list1, list2], []);

      expect(combined).toHaveLength(2);
    });

    it("should return empty on no candidates", () => {
      const combined = combineAndRankCandidates([], []);
      expect(combined).toHaveLength(0);
    });
  });

  describe("coverage calculation", () => {
    it("should score candidates by constraint coverage", () => {
      const constraints: Constraint[] = [
        {
          name: "even",
          description: "Even number",
          test: (x) => typeof x === "number" && x % 2 === 0,
          source: "inferred",
        },
      ];

      const testValues = [2, 4, 6];

      const score1 = calculateCoverageScore("x % 2 === 0", constraints, testValues);
      const score2 = calculateCoverageScore("x > 0", constraints, testValues);

      // score1 should be at least as good as score2
      expect(score1).toBeGreaterThanOrEqual(score2);
    });

    it("should return neutral score for empty constraints", () => {
      const score = calculateCoverageScore("x > 0", [], [1, 2, 3]);
      expect(score).toBe(0.5);
    });

    it("should return neutral score for empty test values", () => {
      const constraints: Constraint[] = [
        {
          name: "even",
          description: "Even",
          test: (x) => typeof x === "number" && x % 2 === 0,
          source: "inferred",
        },
      ];
      const score = calculateCoverageScore("x > 0", constraints, []);
      expect(score).toBe(0.5);
    });

    it("should handle invalid predicates gracefully", () => {
      const constraints: Constraint[] = [
        {
          name: "test",
          description: "test",
          test: (x) => true,
          source: "inferred",
        },
      ];
      const score = calculateCoverageScore("this is not valid code", constraints, [1, 2, 3]);
      // Should return a low score but not crash
      expect(score).toBeLessThan(0.5);
    });
  });
});
