/**
 * Predicate compilation and management
 * Handles single-line predicates and runtime compilation
 */

import { hashText } from "./utils";
import { PredicateRegistry, PredicateRegistryEntry } from "./types";

export type PredicateCompiler = (expression: string) => ((value: unknown) => boolean) | undefined;

/**
 * Compile a single-line predicate expression into an executable function
 *
 * Supported patterns:
 * - x > number
 * - x < number
 * - x >= number
 * - x <= number
 * - x % n === m (modulo check)
 * - typeof x === "string"|"number"|etc
 * - Array.isArray(x)
 * - x === "literal"
 */
export function compileSingleLinePredicate(expression: string): ((value: unknown) => boolean) | undefined {
  const trimmed = expression.trim();

  // Pattern: x > number
  if (trimmed.match(/^x\s*>\s*-?\d+(\.\d+)?$/)) {
    const match = trimmed.match(/x\s*>\s*(-?\d+(?:\.\d+)?)/);
    if (match) {
      const threshold = parseFloat(match[1]);
      return (value) => typeof value === "number" && value > threshold;
    }
  }

  // Pattern: x < number
  if (trimmed.match(/^x\s*<\s*-?\d+(\.\d+)?$/)) {
    const match = trimmed.match(/x\s*<\s*(-?\d+(?:\.\d+)?)/);
    if (match) {
      const threshold = parseFloat(match[1]);
      return (value) => typeof value === "number" && value < threshold;
    }
  }

  // Pattern: x >= number
  if (trimmed.match(/^x\s*>=\s*-?\d+(\.\d+)?$/)) {
    const match = trimmed.match(/x\s*>=\s*(-?\d+(?:\.\d+)?)/);
    if (match) {
      const threshold = parseFloat(match[1]);
      return (value) => typeof value === "number" && value >= threshold;
    }
  }

  // Pattern: x <= number
  if (trimmed.match(/^x\s*<=\s*-?\d+(\.\d+)?$/)) {
    const match = trimmed.match(/x\s*<=\s*(-?\d+(?:\.\d+)?)/);
    if (match) {
      const threshold = parseFloat(match[1]);
      return (value) => typeof value === "number" && value <= threshold;
    }
  }

  // Pattern: x % n === m (modulo check)
  if (trimmed.match(/^x\s*%\s*\d+\s*===\s*\d+$/)) {
    const match = trimmed.match(/x\s*%\s*(\d+)\s*===\s*(\d+)/);
    if (match) {
      const divisor = parseInt(match[1], 10);
      const remainder = parseInt(match[2], 10);
      return (value) => typeof value === "number" && value % divisor === remainder;
    }
  }

  // Pattern: typeof x === "string"|"number"|etc
  if (trimmed.match(/^typeof\s+x\s*===\s*"(string|number|boolean|object|undefined|symbol|function)"$/)) {
    const match = trimmed.match(/typeof\s+x\s*===\s*"([^"]+)"/);
    if (match) {
      const typeString = match[1];
      return (value) => typeof value === typeString;
    }
  }

  // Pattern: Array.isArray(x)
  if (trimmed === "Array.isArray(x)") {
    return (value) => Array.isArray(value);
  }

  // Pattern: x === "literal"
  if (trimmed.match(/^x\s*===\s*"[^"]*"$/)) {
    const match = trimmed.match(/x\s*===\s*"([^"]*)"/);
    if (match) {
      const literal = match[1];
      return (value) => value === literal;
    }
  }

  return undefined;
}

/**
 * Register a single-line predicate in the predicate registry
 */
export function registerSingleLinePredicate(
  name: string,
  description: string,
  expression: string,
  registry: PredicateRegistry
): string | undefined {
  const fn = compileSingleLinePredicate(expression);
  if (!fn) {
    return undefined;
  }

  // Generate the source code string for the predicate
  const predicateSource = `(value) => {
  ${expression.replace(/\bx\b/g, "value")}
}`;

  const id = hashText(predicateSource);
  const existing = registry[id];

  if (!existing) {
    registry[id] = {
      id,
      name,
      description,
      predicateSource,
    };
  }

  return id;
}

/**
 * Compile predicate source code string into executable function
 * Used when loading from cache or registry
 */
export function compilePredicate(predicateSource: string): (value: unknown) => boolean {
  // Try single-line compilation first
  const singleLineResult = compileSingleLinePredicate(predicateSource);
  if (singleLineResult) {
    return singleLineResult;
  }

  // Fall back to dynamic compilation for complex predicates
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("value", `return ${predicateSource}`);
    return (value: unknown) => {
      try {
        return Boolean(fn(value));
      } catch {
        return false;
      }
    };
  } catch {
    // If compilation fails, return a predicate that always returns false
    return () => false;
  }
}

/**
 * Extract pattern name from single-line predicate
 * Useful for generating human-readable predicate names
 */
export function extractPredicatePattern(expression: string): string | undefined {
  const trimmed = expression.trim();

  if (trimmed.match(/^x\s*>\s*-?\d+(\.\d+)?$/)) return "greaterThan";
  if (trimmed.match(/^x\s*<\s*-?\d+(\.\d+)?$/)) return "lessThan";
  if (trimmed.match(/^x\s*>=\s*-?\d+(\.\d+)?$/)) return "greaterThanOrEqual";
  if (trimmed.match(/^x\s*<=\s*-?\d+(\.\d+)?$/)) return "lessThanOrEqual";
  if (trimmed.match(/^x\s*%\s*\d+\s*===\s*\d+$/)) return "modulo";
  if (trimmed.match(/^typeof\s+x\s*===\s*"[^"]+"$/)) return "typeCheck";
  if (trimmed === "Array.isArray(x)") return "arrayCheck";
  if (trimmed.match(/^x\s*===\s*"[^"]*"$/)) return "stringLiteral";

  return undefined;
}
