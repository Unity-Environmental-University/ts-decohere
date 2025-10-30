/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DECOHEREFUZZGENERATOR: Generate multiple valid instances from heuristics
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Problem: Property-based testing needs many valid samples, but calling
 * Decohere<T>() repeatedly = repeated LLM calls = expensive.
 *
 * Solution: Capture heuristics from ONE Decohere<T>() synthesis, then
 * generate variations using those learned heuristics (no more AI calls).
 *
 * Usage:
 * const gen = decohereFuzzGenerator<MyType>();
 * const samples = gen.generateN(100);  // Fast, cheap, valid
 */

export type FuzzGeneratorOptions = {
  seed?: number;  // For reproducibility
  maxAttempts?: number;  // How many to try before giving up on a constraint
};

/**
 * A generator that creates valid instances of T using learned heuristics.
 * After the initial Decohere<T>() call captures heuristics, this generates
 * many variations without additional LLM calls.
 */
export interface FuzzGenerator<T> {
  /**
   * Generate a single instance using heuristics.
   * No LLM call. Fast.
   */
  generate(): T;

  /**
   * Generate N instances.
   * Useful for property-based testing.
   */
  generateN(count: number): T[];

  /**
   * Get the heuristics learned during synthesis.
   * Useful for understanding what constraints were applied.
   */
  getHeuristics(): HeuristicDefinition[];
}

export type HeuristicDefinition = {
  name: string;
  description: string;
  predicate: string;  // JavaScript that returns boolean
};

/**
 * Create a fuzz generator for type T.
 * 
 * Behind the scenes:
 * 1. Look up the cached heuristics from Decohere<T>()
 * 2. Initialize a pseudo-random generator with optional seed
 * 3. Each generate() call uses heuristics to create valid instances
 *
 * Q: How do we load heuristics? From the .decohered.ts cache?
 * Q: How do we serialize heuristics into a form we can execute?
 * Q: Should we use Chance.js or another fuzzing library for generation?
 */
export function decohereFuzzGenerator<T>(
  options?: FuzzGeneratorOptions
): FuzzGenerator<T> {
  throw new Error(
    `decohereFuzzGenerator<T>: Create a generator that: ` +
    `1. Loads heuristics from cache (ConversationEntry_xyz.heuristics.ts) ` +
    `2. Seeds a PRNG with options.seed ` +
    `3. Generates valid T instances using those heuristics ` +
    `4. Returns generate() and generateN(n) methods.`
  );
}
