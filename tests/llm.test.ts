/**
 * Test suite for LLM module
 */

import { describe, it, expect } from "@jest/globals";
import {
  buildSystemPrompt,
  buildHelperContext,
  buildPredicateSuggestions,
  formatConstraintSummary,
  buildConstraintSections,
  buildUserMessage,
  buildHeuristicLibrarySnippet,
  parseLLMResponse,
  formatLLMResponse,
  validateLLMResponse,
  PromptContext,
} from "../tooling/lib/llm";
import { Constraint, HelperRegistryEntry, HeuristicDefinition, LLMResponse } from "../tooling/lib/types";

describe("LLM Module", () => {
  describe("buildSystemPrompt", () => {
    it("should build base system prompt", () => {
      const prompt = buildSystemPrompt();

      expect(prompt).toContain("JSON describing candidate values");
      expect(prompt).toContain("validation predicates");
      expect(prompt).toContain("multi-line arrow function");
      expect(prompt).toContain("three distinct candidate validators");
    });

    it("should include helper context when requested", () => {
      const prompt = buildSystemPrompt(true);

      expect(prompt).toContain("helper functions");
      expect(prompt).toContain("helpers library");
    });

    it("should be single line format", () => {
      const prompt = buildSystemPrompt();
      const lines = prompt.split("\n");
      expect(lines.length).toBeLessThanOrEqual(1);
    });
  });

  describe("buildHelperContext", () => {
    it("should format empty helpers list", () => {
      const context = buildHelperContext([]);
      expect(context).toBe("");
    });

    it("should format helper registry entries", () => {
      const helpers: HelperRegistryEntry[] = [
        {
          id: "h1",
          name: "isEven",
          description: "Check if even",
          category: "validator",
          source: "(x) => x % 2 === 0",
          signature: "(value: number) => boolean",
          inputTypes: ["number"],
          outputType: "boolean",
        },
      ];

      const context = buildHelperContext(helpers);

      expect(context).toContain("Available helper functions");
      expect(context).toContain("isEven");
      expect(context).toContain("validator");
      expect(context).toContain("Check if even");
    });

    it("should format multiple helpers", () => {
      const helpers: HelperRegistryEntry[] = [
        {
          id: "h1",
          name: "isEven",
          description: "Check if even",
          category: "validator",
          source: "(x) => x % 2 === 0",
          signature: "(value: number) => boolean",
          inputTypes: ["number"],
          outputType: "boolean",
        },
        {
          id: "h2",
          name: "isPositive",
          description: "Check if positive",
          category: "validator",
          source: "(x) => x > 0",
          signature: "(value: number) => boolean",
          inputTypes: ["number"],
          outputType: "boolean",
        },
      ];

      const context = buildHelperContext(helpers);

      expect(context).toContain("isEven");
      expect(context).toContain("isPositive");
    });
  });

  describe("buildPredicateSuggestions", () => {
    it("should format empty patterns", () => {
      const suggestions = buildPredicateSuggestions([]);

      expect(suggestions).toContain("Available single-line predicate patterns");
      expect(suggestions).toContain("Comparisons");
      expect(suggestions).toContain("Modulo");
      expect(suggestions).toContain("Type checks");
    });

    it("should include previously discovered patterns", () => {
      const patterns = ["x > 100", "x % 2 === 0"];
      const suggestions = buildPredicateSuggestions(patterns);

      expect(suggestions).toContain("Previously discovered patterns");
      expect(suggestions).toContain("x > 100");
      expect(suggestions).toContain("x % 2 === 0");
    });
  });

  describe("formatConstraintSummary", () => {
    it("should handle empty constraints", () => {
      const summary = formatConstraintSummary([]);
      expect(summary).toContain("no explicit heuristics");
    });

    it("should format constraint descriptions", () => {
      const constraints: Constraint[] = [
        {
          name: "even",
          description: "Must be even",
          test: (x) => typeof x === "number" && x % 2 === 0,
          source: "inferred",
        },
        {
          name: "positive",
          description: "Must be positive",
          test: (x) => typeof x === "number" && x > 0,
          source: "inferred",
        },
      ];

      const summary = formatConstraintSummary(constraints);

      expect(summary).toContain("Must be even");
      expect(summary).toContain("Must be positive");
      expect(summary).toContain("Treat example sets");
    });
  });

  describe("buildConstraintSections", () => {
    it("should format must and suggested constraints", () => {
      const mustConstraints: Constraint[] = [
        {
          name: "even",
          description: "Even number",
          test: (x) => typeof x === "number" && x % 2 === 0,
          source: "inferred",
        },
      ];

      const suggestedPatterns: Constraint[] = [
        {
          name: "positive",
          description: "Positive number",
          test: (x) => typeof x === "number" && x > 0,
          source: "heuristic",
        },
      ];

      const { must, suggested } = buildConstraintSections(mustConstraints, suggestedPatterns);

      expect(must).toContain("Even number");
      expect(suggested).toContain("Positive number");
    });

    it("should handle empty constraint lists", () => {
      const { must, suggested } = buildConstraintSections([], []);

      expect(must).toBe("(none)");
      expect(suggested).toBe("(none)");
    });
  });

  describe("buildUserMessage", () => {
    it("should construct complete user message", () => {
      const context: PromptContext = {
        typeText: "EvenNumber",
        context: "Example: 2, 4, 6",
        summary: "Even number constraint",
        mustConstraints: [],
        suggestedPatterns: [],
        heuristicsLibrary: "",
        attempt: 1,
        feedback: "",
      };

      const message = buildUserMessage(context);

      expect(message).toContain("Attempt: 1");
      expect(message).toContain("Type expression: EvenNumber");
      expect(message).toContain("Must constraints");
      expect(message).toContain("Suggested patterns");
      expect(message).toContain("Example: 2, 4, 6");
      expect(message).toContain("Respond with JSON only");
    });

    it("should include helpers context when provided", () => {
      const helpers: HelperRegistryEntry[] = [
        {
          id: "h1",
          name: "isEven",
          description: "Check if even",
          category: "validator",
          source: "(x) => x % 2 === 0",
          signature: "(value: number) => boolean",
          inputTypes: ["number"],
          outputType: "boolean",
        },
      ];

      const context: PromptContext = {
        typeText: "EvenNumber",
        context: "Example: 2, 4, 6",
        summary: "",
        mustConstraints: [],
        suggestedPatterns: [],
        heuristicsLibrary: "",
        attempt: 1,
        feedback: "",
        availableHelpers: helpers,
      };

      const message = buildUserMessage(context);

      expect(message).toContain("Available helper functions");
      expect(message).toContain("isEven");
    });

    it("should include predicate patterns when provided", () => {
      const context: PromptContext = {
        typeText: "BigNumber",
        context: "Example: 100, 200, 300",
        summary: "",
        mustConstraints: [],
        suggestedPatterns: [],
        heuristicsLibrary: "",
        attempt: 1,
        feedback: "",
        availablePredicatePatterns: ["x > 100", "x < 1000"],
      };

      const message = buildUserMessage(context);

      expect(message).toContain("Available single-line predicate patterns");
      expect(message).toContain("x > 100");
    });
  });

  describe("buildHeuristicLibrarySnippet", () => {
    it("should format empty heuristics", () => {
      const snippet = buildHeuristicLibrarySnippet([]);
      expect(snippet).toBe("");
    });

    it("should format heuristics as code", () => {
      const heuristics: HeuristicDefinition[] = [
        {
          name: "isEven",
          description: "Check if even",
          predicate: "(x) => x % 2 === 0",
        },
      ];

      const snippet = buildHeuristicLibrarySnippet(heuristics);

      expect(snippet).toContain("Previously discovered heuristics");
      expect(snippet).toContain("isEven");
      expect(snippet).toContain("Check if even");
      expect(snippet).toContain("const isEven");
    });
  });

  describe("parseLLMResponse", () => {
    it("should parse valid JSON", () => {
      const json = JSON.stringify({ value: 42 });
      const response = parseLLMResponse(json);

      expect(response.value).toBe(42);
    });

    it("should handle markdown code blocks", () => {
      const json = '```json\n{"value": 42}\n```';
      const response = parseLLMResponse(json);

      expect(response.value).toBe(42);
    });

    it("should handle whitespace", () => {
      const json = '  {"value": 42}  ';
      const response = parseLLMResponse(json);

      expect(response.value).toBe(42);
    });

    it("should throw on invalid JSON", () => {
      expect(() => parseLLMResponse("not json")).toThrow("Failed to parse LLM JSON response");
    });
  });

  describe("formatLLMResponse", () => {
    it("should format response summary", () => {
      const response: LLMResponse = {
        value: 42,
        heuristics: [{ name: "test", description: "test", predicate: "(x) => x > 0" }],
        candidateValidators: [{ predicate: "(x) => x % 2 === 0" }],
      };

      const formatted = formatLLMResponse(response);

      expect(formatted).toContain("Value: 42");
      expect(formatted).toContain("Heuristics: 1");
      expect(formatted).toContain("Candidates: 1");
    });
  });

  describe("validateLLMResponse", () => {
    it("should validate complete response", () => {
      const response: LLMResponse = {
        value: 42,
        heuristics: [{ name: "test", description: "test heuristic", predicate: "(x) => x > 0" }],
      };

      const validation = validateLLMResponse(response);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should detect missing value", () => {
      const response = { heuristics: [] } as any;

      const validation = validateLLMResponse(response);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Response missing required 'value' field");
    });

    it("should detect incomplete heuristics", () => {
      const response: LLMResponse = {
        value: 42,
        heuristics: [{ name: "test", description: "", predicate: "" } as any],
      };

      const validation = validateLLMResponse(response);

      expect(validation.valid).toBe(false);
    });

    it("should detect missing candidate predicates", () => {
      const response: LLMResponse = {
        value: 42,
        candidateValidators: [{ predicate: "" } as any],
      };

      const validation = validateLLMResponse(response);

      expect(validation.valid).toBe(false);
    });
  });
});
