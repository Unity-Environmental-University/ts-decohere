/**
 * LLM Integration Module
 * Handles prompt construction, LLM communication, and response parsing
 * Supports helper registry context and predicate pattern suggestions
 */

import { Constraint, HeuristicDefinition, LLMResponse, HelperRegistryEntry } from "./types";

export interface PromptContext {
  typeText: string;
  context: string;
  summary: string;
  mustConstraints: Constraint[];
  suggestedPatterns: Constraint[];
  heuristicsLibrary: string;
  attempt: number;
  feedback: string;
  availableHelpers?: HelperRegistryEntry[];
  availablePredicatePatterns?: string[];
}

/**
 * Builds the system prompt that defines LLM behavior and output format
 */
export function buildSystemPrompt(includeHelpers: boolean = false): string {
  const lines = [
    "You generate JSON describing candidate values and reusable validation predicates for TypeScript types.",
    "Respond with JSON matching {\"value\": <literal>, \"heuristics\": [ { \"name\": string, \"description\": string, \"predicate\": string } ], \"candidateValidators\": [ { \"name\"?: string, \"description\"?: string, \"predicate\": string } ]?, \"explanation\": string }.",
    "All strings must use standard JSON string syntax with escaped newlines (\\n); never use backticks or template literals.",
    "Each predicate may be a multi-line arrow function of the form (value) => { ... } expressed within a JSON string.",
    "You must satisfy all MUST constraints; suggested patterns are optional but desirable heuristics.",
    "Provide at least three distinct candidate validators capturing different perspectives of the pattern.",
  ];

  if (includeHelpers) {
    lines.push(
      "You may also suggest using helper functions from the available helpers library for complex patterns.",
      "Suggested helpers should appear in heuristics as compositions, e.g., (value) => helpers.isEven(value) && helpers.isPositive(value)"
    );
  }

  return lines.join(" ");
}

/**
 * Formats helper registry entries into LLM context
 */
export function buildHelperContext(helpers: HelperRegistryEntry[]): string {
  if (helpers.length === 0) {
    return "";
  }

  const lines = ["Available helper functions:"];
  for (const helper of helpers) {
    lines.push(`- ${helper.name} (${helper.category}): ${helper.description}`);
    lines.push(`  Input: ${helper.inputTypes.join(" | ")}`);
    lines.push(`  Output: ${helper.outputType}`);
  }

  return lines.join("\n");
}

/**
 * Formats available predicate patterns into suggestions
 */
export function buildPredicateSuggestions(patterns: string[]): string {
  const lines = [
    "Available single-line predicate patterns:",
    "- Comparisons: x > N, x < N, x >= N, x <= N",
    "- Modulo: x % N === M (for even/odd, divisibility)",
    "- Type checks: typeof x === \"type\", Array.isArray(x)",
    "- Literals: x === \"value\"",
  ];

  if (patterns.length > 0) {
    lines.push("Previously discovered patterns:");
    for (const pattern of patterns) {
      lines.push(`- ${pattern}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format constraint summary from list of constraints
 */
export function formatConstraintSummary(constraints: Constraint[]): string {
  if (constraints.length === 0) {
    return "(no explicit heuristics available)";
  }
  const base = constraints.map((c) => c.description).join(" | ");
  return `${base} | Treat example sets as illustrative patterns to extrapolate from.`;
}

/**
 * Build constraint descriptions for the prompt
 */
export function buildConstraintSections(
  mustConstraints: Constraint[],
  suggestedPatterns: Constraint[]
): { must: string; suggested: string } {
  const mustSummary =
    mustConstraints.length > 0
      ? mustConstraints.map((c) => `- ${c.description}`).join("\n")
      : "(none)";

  const suggestionSummary =
    suggestedPatterns.length > 0
      ? suggestedPatterns.map((c) => `- ${c.description}`).join("\n")
      : "(none)";

  return { must: mustSummary, suggested: suggestionSummary };
}

/**
 * Build complete user message for LLM
 */
export function buildUserMessage(context: PromptContext): string {
  const { must, suggested } = buildConstraintSections(
    context.mustConstraints,
    context.suggestedPatterns
  );

  const sections: string[] = [
    `Attempt: ${context.attempt}`,
    `Type expression: ${context.typeText}`,
    `Must constraints:\n${must}`,
    `Suggested patterns:\n${suggested}`,
    context.summary ? `Derived guard summary: ${context.summary}` : "Derived guard summary: (none)",
    context.heuristicsLibrary
      ? `Existing heuristics:\n${context.heuristicsLibrary}`
      : "Existing heuristics: (none)",
  ];

  if (context.availableHelpers && context.availableHelpers.length > 0) {
    sections.push(buildHelperContext(context.availableHelpers));
  }

  if (context.availablePredicatePatterns && context.availablePredicatePatterns.length > 0) {
    sections.push(buildPredicateSuggestions(context.availablePredicatePatterns));
  }

  sections.push("Context snippets:", context.context);

  if (context.feedback) {
    sections.push(`Previous feedback: ${context.feedback}`);
  }

  sections.push("Respond with JSON only.");

  return sections.filter(Boolean).join("\n");
}

/**
 * Build heuristics library snippet for LLM context
 */
export function buildHeuristicLibrarySnippet(defs: HeuristicDefinition[]): string {
  if (defs.length === 0) {
    return "";
  }

  const lines = ["// Previously discovered heuristics:"];
  for (const def of defs) {
    lines.push(`// ${def.name}: ${def.description}`);
    lines.push(`const ${def.name} = ${def.predicate};\n`);
  }

  return lines.join("\n");
}

/**
 * Parse LLM JSON response, handling various formats
 */
export function parseLLMResponse(content: string): LLMResponse {
  let cleaned = content.trim();

  // Remove markdown code blocks if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  }

  try {
    return JSON.parse(cleaned) as LLMResponse;
  } catch (error) {
    throw new Error(
      `Failed to parse LLM JSON response: ${(error as Error).message}. Content: ${cleaned.substring(0, 200)}`
    );
  }
}

/**
 * Format LLM response for logging/debugging
 */
export function formatLLMResponse(response: LLMResponse): string {
  const parts: string[] = [
    `Value: ${JSON.stringify(response.value)}`,
    `Heuristics: ${response.heuristics?.length || 0}`,
    `Candidates: ${response.candidateValidators?.length || 0}`,
  ];

  if (response.explanation) {
    parts.push(`Explanation: ${response.explanation.substring(0, 100)}`);
  }

  return parts.join(" | ");
}

/**
 * Validate LLM response structure
 */
export function validateLLMResponse(response: LLMResponse): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (response.value === undefined) {
    errors.push("Response missing required 'value' field");
  }

  if (response.heuristics) {
    for (const h of response.heuristics) {
      if (!h.name || !h.description || !h.predicate) {
        errors.push("Heuristic missing required fields (name, description, predicate)");
      }
    }
  }

  if (response.candidateValidators) {
    for (const c of response.candidateValidators) {
      if (!c.predicate) {
        errors.push("Candidate validator missing required 'predicate' field");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
