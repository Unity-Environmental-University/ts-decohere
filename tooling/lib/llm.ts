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
    "Think through the problem in pseudocode, then respond with valid JSON.",
    "",
    "PSEUDOCODE REASONING:",
    "```",
    "// 1. Decompose: for each constraint component (separated by &):",
    "//    a. Understand its pattern or rule independently",
    "//    b. If it has examples, identify the mathematical/logical rule",
    "// 2. Synthesize: find a value satisfying ALL component patterns simultaneously",
    "value = <concrete value satisfying each component's pattern>",
    "",
    "// 3. Infer predicates for each component's pattern",
    "heuristics = [",
    "  // One heuristic per major component pattern",
    "  { name: 'componentPattern1', description: 'Why this pattern from component 1', predicate: (x) => <test> },",
    "  { name: 'componentPattern2', description: 'Why this pattern from component 2', predicate: (x) => <test> }",
    "]",
    "",
    "// 4. Provide 3+ candidate validators from different angles",
    "// Each captures a different aspect or implementation, but all respect EVERY component pattern",
    "candidateValidators = [",
    "  { name: 'approach1', description: '...', predicate: (x) => <alternative test 1> },",
    "  { name: 'approach2', description: '...', predicate: (x) => <alternative test 2> },",
    "  { name: 'approach3', description: '...', predicate: (x) => <alternative test 3> }",
    "]",
    "",
    "// 5. Explain why this value and these predicates work together",
    "explanation = 'Clear narrative of how value satisfies constraints via the predicates'",
    "```",
    "",
    "PHILOSOPHY:",
    "- Prefer SIMPLE, direct predicates. Complexity is scaffolding.",
    "- If a predicate stops generalizing on new data, that's a refining signal, not failure.",
    "- Respond with valid JSON that matches your pseudocode reasoning.",
    "",
    "OUTPUT FORMAT:",
    "All strings use standard JSON syntax with escaped newlines (\\\\n); never backticks.",
    "Each predicate is a multi-line arrow function (value) => { ... } as a JSON string.",
    "You must satisfy all MUST constraints; suggested patterns are optional but desirable.",
    "Provide at least three distinct candidate validators.",
  ];

  if (includeHelpers) {
    lines.push(
      "HELPERS: You may suggest helper functions from the available library for composition.",
      "Example: (value) => helpers.isEven(value) && helpers.isPositive(value)"
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
    ``,
    `TASK: Synthesize a single concrete value AND generate reusable predicates that explain why it satisfies the type.`,
    ``,
    `CONSTRAINTS TO SATISFY:`,
    `Must constraints:\n${must}`,
    `Suggested patterns:\n${suggested}`,
    ``,
    `CRITICAL: For any constraint based on example sets, discover the underlying mathematical or logical pattern that connects them. These patterns become heuristics.`,
    `Patterns to discover:`,
    `- Mathematical: sequences, series, arithmetic/geometric progressions, number properties`,
    `- Logical: categorical membership, string properties, structural relationships, enumerations`,
    ``,
    `REASONING PSEUDOCODE FOR THIS TYPE:`,
    `// 1. For each component constraint (separated by &), understand its pattern independently`,
    `//    - If it has examples, discover the mathematical or logical rule`,
    `//    - If it's a simple constraint (like GreaterThanX<100>), understand it directly`,
    `// 2. Synthesize a value that satisfies the pattern of EACH component simultaneously`,
    `// 3. Infer predicates for each component pattern`,
    `// 4. Compose heuristics that cover all component patterns`,
    `// 5. If a predicate stops working on new data, that's a signal to refine—not failure`,
    `// 6. Generate 3+ alternative validators from different angles`,
    ``,
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

  sections.push("Code context:", context.context);

  if (context.feedback) {
    sections.push(`Previous attempt feedback (use to refine): ${context.feedback}`);
  }

  sections.push("Respond with valid JSON only. No markdown, no explanation outside the JSON.");

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

/**
 * Build prompt for generating test value generator functions
 */
export function buildGeneratorPrompt(typeText: string, selectedValidator: string, explanation: string): string {
  return `
You are a test data generator expert. Given a type and its validation logic, generate a generator function that produces diverse valid test values for property-based testing and fuzzing.

Type: ${typeText}
Selected Validator: ${selectedValidator}
Type Explanation: ${explanation}

PSEUDOCODE REASONING:
\`\`\`
// 1. Understand the constraint: ${explanation}
// 2. Implement the validator logic directly in the generator
// 3. Generate 100+ diverse values that all pass the validator
// 4. Vary outputs: edge cases, boundaries, random valid values, patterns
// 5. Each yielded value must satisfy the validator

function* generate${typeText}() {
  const validator = (value) => { /* ${selectedValidator} */ };

  // Strategy: Generate values from different distributions
  // - Edge cases (boundaries, 0, -1, MAX, MIN)
  // - Common patterns (incrementing, exponential, random)
  // - Verify each passes the validator before yielding

  for (let i = 0; i < 100; i++) {
    let candidate = /* pick/generate a candidate */;
    // Only yield if it passes validation
    if (validator(candidate)) {
      yield candidate;
    }
  }
}
\`\`\`

Respond with ONLY valid JavaScript code (no markdown, no explanation). The code must:
1. Be a working generator function that can be executed immediately
2. Start with 'function* generate${typeText}()'
3. Produce 100+ diverse valid values satisfying the constraint
4. Include the validator logic or validation checks
5. Handle edge cases and varied distributions
`;
}

export interface GeneratorFunction {
  name: string;
  source: string;
}
