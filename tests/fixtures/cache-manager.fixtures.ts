/**
 * Test fixtures for CacheManager tests
 * Reduces boilerplate and decouples tests from implementation details
 */

import { CandidateScore } from "../../tooling/lib/candidate-selector";

/**
 * Create a mock CandidateScore with sensible defaults
 */
export function createMockCandidate(
  overrides?: Partial<CandidateScore>
): CandidateScore {
  const baseScore = overrides?.totalScore ?? 0.75;
  return {
    candidate: {
      name: overrides?.candidate?.name ?? "MockCandidate",
      description: overrides?.candidate?.description ?? "test",
      predicate: overrides?.candidate?.predicate ?? "x > 0",
    },
    totalScore: baseScore,
    complexityScore: overrides?.complexityScore ?? baseScore,
    coverageScore: overrides?.coverageScore ?? baseScore,
    reusabilityScore: overrides?.reusabilityScore ?? baseScore,
    reasoning: overrides?.reasoning ?? ["test"],
  };
}

/**
 * Create a high-confidence candidate (>= 0.9)
 */
export function createHighConfidenceCandidate(
  name: string = "HighConfidence"
): CandidateScore {
  return createMockCandidate({
    candidate: { name, description: "high confidence", predicate: "x > 0" },
    totalScore: 0.95,
    complexityScore: 0.95,
    coverageScore: 0.95,
    reusabilityScore: 0.95,
  });
}

/**
 * Create a good confidence candidate (0.85-0.95)
 */
export function createGoodConfidenceCandidate(
  name: string = "GoodConfidence"
): CandidateScore {
  return createMockCandidate({
    candidate: { name, description: "good confidence", predicate: "x > 0" },
    totalScore: 0.87,
    complexityScore: 0.87,
    coverageScore: 0.87,
    reusabilityScore: 0.87,
  });
}

/**
 * Create an acceptable confidence candidate (0.75-0.85)
 */
export function createAcceptableConfidenceCandidate(
  name: string = "AcceptableConfidence"
): CandidateScore {
  return createMockCandidate({
    candidate: { name, description: "acceptable confidence", predicate: "x > 0" },
    totalScore: 0.8,
    complexityScore: 0.8,
    coverageScore: 0.8,
    reusabilityScore: 0.8,
  });
}

/**
 * Create a low-confidence candidate (< 0.75)
 */
export function createLowConfidenceCandidate(
  name: string = "LowConfidence"
): CandidateScore {
  return createMockCandidate({
    candidate: { name, description: "low confidence", predicate: "x > 0" },
    totalScore: 0.5,
    complexityScore: 0.5,
    coverageScore: 0.5,
    reusabilityScore: 0.5,
  });
}

/**
 * Mock cache entry data
 */
export interface MockCacheEntry {
  typeText: string;
  fingerprint?: string;
}

/**
 * Create mock cache entry
 */
export function createMockCacheEntry(
  typeText: string,
  fingerprint: string = "hash1"
): MockCacheEntry {
  return {
    typeText,
    fingerprint,
  };
}
