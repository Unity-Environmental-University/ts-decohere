/**
 * Candidate Validator Selection and Ranking
 * Ranks and selects the best candidate validators based on:
 * - Predicate complexity (shorter = simpler = better)
 * - Constraint coverage (tests against all constraints)
 * - Pattern reusability (can it be generalized?)
 */

import { HeuristicDefinition, Constraint } from "./types";
import { compilePredicate } from "./predicates";

export interface CandidateScore {
  candidate: HeuristicDefinition;
  complexityScore: number;      // 0-1: lower = simpler
  coverageScore: number;         // 0-1: higher = more constraints covered
  reusabilityScore: number;      // 0-1: higher = more reusable pattern
  totalScore: number;            // 0-1: weighted combination
  reasoning: string[];           // Explanation of scores
}

/**
 * Calculate complexity score for a predicate (based on length)
 * Shorter predicates = simpler = higher score (1.0 is simplest)
 */
export function calculateComplexityScore(predicateSource: string): number {
  const length = predicateSource.length;
  // Normalize: < 50 chars = 1.0, > 500 chars = 0.1
  if (length < 50) return 1.0;
  if (length > 500) return 0.1;
  return 1.0 - (length - 50) / 450 * 0.9;
}

/**
 * Calculate coverage score (how many constraints does the predicate help with?)
 * Tests candidate against all constraints, counts how many it helps with
 */
export function calculateCoverageScore(
  predicateSource: string,
  constraints: Constraint[],
  testValues: unknown[]
): number {
  if (constraints.length === 0 || testValues.length === 0) {
    return 0.5; // Neutral if no constraints or test values
  }

  try {
    const predicate = compilePredicate(predicateSource);
    let matchedCount = 0;
    let passedCount = 0;

    for (const testValue of testValues) {
      const predicatePasses = predicate(testValue);
      if (predicatePasses) {
        passedCount++;
      }

      // Check if this helps with any constraints
      for (const constraint of constraints) {
        if (constraint.test(testValue) && predicatePasses) {
          matchedCount++;
        }
      }
    }

    // Score: (matched + passed) / (constraints * testValues)
    const maxScore = constraints.length * testValues.length;
    return matchedCount > 0 ? Math.min(1.0, (matchedCount + passedCount) / (maxScore * 1.5)) : 0.2;
  } catch {
    return 0.1; // Very low score if predicate doesn't compile
  }
}

/**
 * Calculate reusability score (can this pattern be generalized?)
 * Detects if predicate follows common patterns that might be reusable
 */
export function calculateReusabilityScore(predicateSource: string): number {
  const source = predicateSource.toLowerCase();

  // Single-line patterns are highly reusable
  if (source.match(/^[a-z_]\s*[<>=!]+\s*-?\d+(\.\d+)?$/)) return 0.9; // x > 100
  if (source.match(/^(typeof|array\.isarray)/)) return 0.85;
  if (source.match(/^[a-z_]\s*%\s*\d+\s*===/)) return 0.8; // x % 2 === 0

  // Multi-line but follows common pattern
  if (source.match(/value\s*[<>=!]+/) && source.length < 100) return 0.7;

  // Generic predicates (hard to reuse)
  if (source.includes("&&") || source.includes("||")) return 0.5;

  // Complex predicates (low reusability)
  if (source.length > 300) return 0.3;

  return 0.5; // Default neutral score
}

/**
 * Score a single candidate validator
 */
export function scoreCandidate(
  candidate: HeuristicDefinition,
  constraints: Constraint[],
  testValues: unknown[] = [],
  weights: { complexity: number; coverage: number; reusability: number } = {
    complexity: 0.3,
    coverage: 0.4,
    reusability: 0.3,
  }
): CandidateScore {
  const complexityScore = calculateComplexityScore(candidate.predicate);
  const coverageScore = calculateCoverageScore(candidate.predicate, constraints, testValues);
  const reusabilityScore = calculateReusabilityScore(candidate.predicate);

  const totalScore =
    complexityScore * weights.complexity +
    coverageScore * weights.coverage +
    reusabilityScore * weights.reusability;

  const reasoning: string[] = [];

  if (complexityScore > 0.8) {
    reasoning.push("Very simple predicate");
  } else if (complexityScore < 0.3) {
    reasoning.push("Complex predicate");
  }

  if (coverageScore > 0.7) {
    reasoning.push("Good constraint coverage");
  } else if (coverageScore < 0.3) {
    reasoning.push("Limited constraint coverage");
  }

  if (reusabilityScore > 0.7) {
    reasoning.push("Highly reusable pattern");
  } else if (reusabilityScore < 0.4) {
    reasoning.push("Low reusability");
  }

  return {
    candidate,
    complexityScore,
    coverageScore,
    reusabilityScore,
    totalScore,
    reasoning,
  };
}

/**
 * Score multiple candidates and return ranked list
 */
export function rankCandidates(
  candidates: HeuristicDefinition[],
  constraints: Constraint[],
  testValues: unknown[] = []
): CandidateScore[] {
  const scored = candidates.map((c) => scoreCandidate(c, constraints, testValues));
  return scored.sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Select the best candidate from a list
 */
export function selectBestCandidate(
  candidates: HeuristicDefinition[],
  constraints: Constraint[],
  testValues: unknown[] = []
): { candidate: CandidateScore; alternatives: CandidateScore[] } {
  const ranked = rankCandidates(candidates, constraints, testValues);

  if (ranked.length === 0) {
    throw new Error("No candidates to select from");
  }

  return {
    candidate: ranked[0],
    alternatives: ranked.slice(1),
  };
}

/**
 * Format candidate scores for display
 */
export function formatCandidateScore(score: CandidateScore, index: number = 0): string {
  const lines = [
    `Candidate ${index + 1}: ${score.candidate.name || "unnamed"}`,
    `  Score: ${(score.totalScore * 100).toFixed(1)}%`,
    `    Complexity: ${(score.complexityScore * 100).toFixed(0)}%`,
    `    Coverage: ${(score.coverageScore * 100).toFixed(0)}%`,
    `    Reusability: ${(score.reusabilityScore * 100).toFixed(0)}%`,
  ];

  if (score.reasoning.length > 0) {
    lines.push(`  Notes: ${score.reasoning.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Determine if a candidate score is confident enough to use
 */
export function isConfidentCandidate(score: CandidateScore, threshold: number = 0.6): boolean {
  return score.totalScore >= threshold;
}

/**
 * Combine multiple candidate lists into weighted ranking
 */
export function combineAndRankCandidates(
  candidateLists: HeuristicDefinition[][],
  constraints: Constraint[],
  testValues: unknown[] = []
): CandidateScore[] {
  // Flatten all candidates, removing duplicates
  const seen = new Set<string>();
  const unique: HeuristicDefinition[] = [];

  for (const list of candidateLists) {
    for (const candidate of list) {
      const key = JSON.stringify({ name: candidate.name, predicate: candidate.predicate });
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(candidate);
      }
    }
  }

  return rankCandidates(unique, constraints, testValues);
}
