/**
 * Shared type definitions for the decohere build system
 */

export type Config = {
  envSearchPaths?: string[];
  factoryCacheDir?: string;
  maxLLMAttempts?: number;
};

export type DeclarationFingerprint = {
  name: string;
  text: string;
};

export type CacheEntry = {
  typeText: string;
  fingerprint: string;
  dependencies: DeclarationFingerprint[];
  model: string;
  value: unknown;
  attempts: number;
  heuristics?: HeuristicDefinition[];
  constraints?: string[];
};

export type MaterializeSuccess = {
  value: unknown;
  model: string;
  attempts: number;
  heuristics: HeuristicDefinition[];
  constraints: Constraint[];
};

export type CachedMaterialization = {
  success: MaterializeSuccess;
};

export type HeuristicDefinition = {
  name: string;
  description: string;
  predicate: string;
};

export type LLMResponse = {
  value: unknown;
  heuristics?: HeuristicDefinition[];
  explanation?: string;
  candidateValidators?: {
    name?: string;
    description?: string;
    predicate: string;
  }[];
};

export type HelperCategory = "humanizer" | "validator" | "generator" | "transformer";

export type HelperRegistryEntry = {
  id: string;
  name: string;
  description: string;
  category: HelperCategory;
  source: string;
  signature: string;
  inputTypes: string[];
  outputType: string;
};

export type HelperRegistry = Record<string, HelperRegistryEntry>;

export type SingleLinePredicateExpression =
  | `x > ${string | number}`
  | `x < ${string | number}`
  | `x >= ${string | number}`
  | `x <= ${string | number}`
  | `x === ${string}`
  | `x % ${string | number} === ${string | number}`
  | `typeof x === "${string}"`
  | `Array.isArray(x)`
  | `(x) => ${string}`;

export type PredicateRegistryEntry = {
  id: string;
  name: string;
  description: string;
  predicateSource: string;
};

export type PredicateRegistry = Record<string, PredicateRegistryEntry>;

export type Constraint = {
  name: string;
  description: string;
  test: (value: unknown) => boolean;
  code?: string;
  predicateSource?: string;
  predicateId?: string;
  source: "inferred" | "heuristic";
};

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type ComponentContext = {
  name: string;
  text: string;
  isNumericExample: boolean;
  isUsageExample: boolean;
  numberExamples?: number[];
  usageExamples?: Record<string, unknown>[];
};

export type AugmentedExamples = {
  originalExamples: number[] | Record<string, unknown>[];
  derivedExamples: number[] | Record<string, unknown>[];
  deduped: number[] | Record<string, unknown>[];
};
