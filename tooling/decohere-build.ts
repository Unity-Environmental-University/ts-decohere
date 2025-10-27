import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import vm from "node:vm";
import { Node, Project, SyntaxKind, TypeChecker, Symbol as MorphSymbol } from "ts-morph";
import { config as loadEnv } from "dotenv";
import OpenAI from "openai";

type Config = {
  envSearchPaths?: string[];
  factoryCacheDir?: string;
  maxLLMAttempts?: number;
};

type DeclarationFingerprint = {
  name: string;
  sourceFile: string;
  hash: string;
  text: string;
};

type CacheEntry = {
  typeText: string;
  fingerprint: string;
  dependencies: DeclarationFingerprint[];
  model?: string;
  value: unknown;
  createdAt: string;
  attempts: Array<{
    attempt: number;
    model: string;
    feedback: string;
    explanation?: string;
  }>;
  factoryPath: string;
  heuristicsPath?: string;
  heuristics?: HeuristicDefinition[];
};

type MaterializeSuccess = {
  value: unknown;
  model: string;
  attempts: CacheEntry["attempts"];
  heuristics: HeuristicDefinition[];
  constraints: Constraint[];
};

type CachedMaterialization = {
  entry: CacheEntry;
  heuristics: HeuristicDefinition[];
  heuristicConstraints: Constraint[];
};

type HeuristicDefinition = {
  name: string;
  description: string;
  predicate: string;
};

type LLMResponse = {
  value: unknown;
  heuristics?: HeuristicDefinition[];
  explanation?: string;
};

const PROJECT_ROOT = join(__dirname, "..");
const CONFIG_PATH = join(PROJECT_ROOT, "decohere.config.json");

const defaultEnvSearchPaths = [".env", "~/Documents/repos/tools/.env"];
const defaultFactoryCacheDir = "generated/decohere-cache";
const defaultMaxAttempts = 5;

function readConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return { envSearchPaths: defaultEnvSearchPaths };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Config;
    return parsed;
  } catch {
    return { envSearchPaths: defaultEnvSearchPaths };
  }
}

function expandPath(rawPath: string): string {
  if (rawPath.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) {
      return rawPath.slice(2);
    }
    return join(home, rawPath.slice(2));
  }

  if (isAbsolute(rawPath)) {
    return rawPath;
  }

  return join(PROJECT_ROOT, rawPath);
}

const config = readConfig();
const envSearchPaths = config.envSearchPaths ?? defaultEnvSearchPaths;
const factoryCacheDir = config.factoryCacheDir ?? defaultFactoryCacheDir;
const maxLLMAttempts = config.maxLLMAttempts ?? defaultMaxAttempts;

for (const candidate of envSearchPaths) {
  if (process.env.OPENAI_API_KEY) {
    break;
  }
  const expanded = expandPath(candidate);
  if (!expanded || !existsSync(expanded)) {
    continue;
  }
  loadEnv({ path: expanded, override: false });
}

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_KEY ? new OpenAI({ apiKey: OPENAI_KEY }) : null;

const project = new Project({
  tsConfigFilePath: join(PROJECT_ROOT, "tsconfig.json"),
});

const OUTPUT_FILE = "examples/playground.decohered.ts";
const CACHE_DIR = join(PROJECT_ROOT, factoryCacheDir);
mkdirSync(CACHE_DIR, { recursive: true });

const normalize = (key: string): string => key.replace(/\s+/g, " ").trim();

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function makeCacheKey(typeText: string): string {
  const base = typeText.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const suffix = hashText(typeText).slice(0, 12);
  const truncated = base.length > 40 ? base.slice(0, 40) : base || "type";
  return `${truncated}_${suffix}`;
}

function loadCacheEntry(path: string): CacheEntry | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return undefined;
  }
}

function saveCacheEntry(path: string, entry: CacheEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entry, null, 2), "utf8");
}

function collectDeclarationFingerprints(
  node: Node,
  typeChecker: TypeChecker
): DeclarationFingerprint[] {
  const seen = new Set<string>();
  const fingerprints: DeclarationFingerprint[] = [];

  const addSymbol = (symbol: MorphSymbol | undefined) => {
    if (!symbol) return;
    const name = symbol.getName();
    const declarations = symbol.getDeclarations();
    for (const decl of declarations) {
      const sourceFile = decl.getSourceFile().getFilePath();
      const key = `${name}@${sourceFile}:${decl.getStart()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = decl.getText();
      fingerprints.push({
        name,
        sourceFile,
        hash: hashText(text),
        text,
      });
    }
  };

  addSymbol(typeChecker.getSymbolAtLocation(node));

  node.forEachDescendant((desc) => {
    if (Node.isIdentifier(desc) || Node.isTypeReference(desc)) {
      addSymbol(typeChecker.getSymbolAtLocation(desc));
    }
  });

  return fingerprints.sort((a, b) => a.name.localeCompare(b.name));
}

function computeTypeFingerprint(typeText: string, dependencies: DeclarationFingerprint[]): string {
  const hash = createHash("sha256");
  hash.update(typeText);
  dependencies
    .map((d) => `${d.name}:${d.sourceFile}:${d.hash}`)
    .sort()
    .forEach((line) => hash.update(line));
  return hash.digest("hex");
}

function buildContextSnippet(typeText: string, dependencies: DeclarationFingerprint[]): string {
  if (dependencies.length === 0) {
    return typeText;
  }
  const combined = dependencies.map((dep) => dep.text).join("\n\n");
  return combined.length > 4000 ? combined.slice(0, 4000) : combined;
}

function splitIntersections(typeText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < typeText.length; i += 1) {
    const char = typeText[i];
    if (char === "<") {
      depth += 1;
    } else if (char === ">") {
      depth = Math.max(0, depth - 1);
    }
    if (char === "&" && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

type Constraint = {
  name: string;
  description: string;
  test: (value: unknown) => boolean;
  code?: string;
  predicateSource?: string;
  source: "inferred" | "heuristic";
};

function isPrimeCandidate(value: number): boolean {
  if (!Number.isInteger(value) || value < 2) return false;
  for (let factor = 2; factor <= Math.sqrt(value); factor += 1) {
    if (value % factor === 0) {
      return false;
    }
  }
  return true;
}

function parseExampleNumbers(component: string): number[] | undefined {
  const match = component.match(/^(?:InferFromMeasurments|CohereFromExamples)<(.+)>$/);
  if (!match) {
    return undefined;
  }

  let inner = match[1].trim();
  if (inner.startsWith("[")) {
    inner = inner.slice(1, -1);
  }

  const tokens = inner
    .split(/[,|]/)
    .map((token) => token.trim())
    .filter(Boolean);

  const numbers: number[] = [];
  for (const token of tokens) {
    const value = Number(token);
    if (!Number.isNaN(value)) {
      numbers.push(value);
    }
  }
  return numbers.length > 0 ? numbers : undefined;
}

function sanitizeIdentifier(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  const noLeadingDigit = cleaned.replace(/^([0-9])/, "_$1");
  return noLeadingDigit || "constraint";
}

function deriveConstraintsForComponent(component: string): Constraint[] {
  const constraints: Constraint[] = [];

  const greaterMatch = component.match(/^GreaterThanX<\s*(-?\d+(?:\.\d+)?)\s*>$/);
  if (greaterMatch) {
    const minimum = Number(greaterMatch[1]);
    const name = sanitizeIdentifier(`greaterThan_${minimum}`);
    constraints.push({
      name,
      description: `Value must be a number strictly greater than ${minimum}`,
      test: (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > minimum,
      code: `export const ${name} = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > ${minimum};`,
      source: "inferred",
    });
    return constraints;
  }

  const numbers = parseExampleNumbers(component);
  if (numbers && numbers.length > 0) {
    constraints.push({
      name: "isFiniteNumber",
      description: "Value must be a finite number",
      test: (value: unknown) => typeof value === "number" && Number.isFinite(value),
      code: "export const isFiniteNumber = (value: unknown): value is number => typeof value === \"number\" && Number.isFinite(value);",
      source: "inferred",
    });

    if (numbers.every((n) => Number.isInteger(n))) {
      constraints.push({
        name: "isIntegerNumber",
        description: "Value must be an integer",
        test: (value: unknown) => typeof value === "number" && Number.isInteger(value),
        code: "export const isIntegerNumber = (value: unknown): value is number => typeof value === \"number\" && Number.isInteger(value);",
        source: "inferred",
      });
    }

    if (numbers.every((n) => n >= 0)) {
      constraints.push({
        name: "isNonNegativeNumber",
        description: "Value must be non-negative",
        test: (value: unknown) => typeof value === "number" && value >= 0,
        code: "export const isNonNegativeNumber = (value: unknown): value is number => typeof value === \"number\" && value >= 0;",
        source: "inferred",
      });
    }

    const allEven = numbers.every((n) => Number.isInteger(n) && n % 2 === 0);
    const allOdd = numbers.every((n) => Number.isInteger(n) && Math.abs(n % 2) === 1);
    if (allEven) {
      constraints.push({
        name: "isEvenNumber",
        description: "Value must be even",
        test: (value: unknown) => typeof value === "number" && Number.isInteger(value) && value % 2 === 0,
        code: "export const isEvenNumber = (value: unknown): value is number => typeof value === \"number\" && Number.isInteger(value) && value % 2 === 0;",
        source: "inferred",
      });
    } else if (allOdd) {
      constraints.push({
        name: "isOddNumber",
        description: "Value must be odd",
        test: (value: unknown) => typeof value === "number" && Number.isInteger(value) && Math.abs(value % 2) === 1,
        code: "export const isOddNumber = (value: unknown): value is number => typeof value === \"number\" && Number.isInteger(value) && Math.abs(value % 2) === 1;",
        source: "inferred",
      });
    }

    if (numbers.every((n) => isPrimeCandidate(n))) {
      constraints.push({
        name: "isPrimeNumber",
        description: "Value must be prime",
        test: (value: unknown) => typeof value === "number" && isPrimeCandidate(value),
        code: "export const isPrimeNumber = (value: unknown): value is number => { if (typeof value !== \"number\" || !Number.isInteger(value) || value < 2) return false; for (let factor = 2; factor <= Math.sqrt(value); factor += 1) { if (value % factor === 0) { return false; } } return true; };",
        source: "inferred",
      });
    }
  }

  return constraints;
}

function compilePredicate(predicateSource: string): (value: unknown) => boolean {
  const source = predicateSource.trim();
  try {
    const script = new vm.Script(`(${source})`);
    const fn = script.runInNewContext({});
    if (typeof fn !== "function") {
      throw new Error("predicate did not evaluate to a function");
    }
    return (value: unknown) => {
      try {
        return !!fn(value);
      } catch {
        return false;
      }
    };
  } catch (error) {
    throw new Error(`Failed to compile predicate: ${(error as Error).message}`);
  }
}

function compileHeuristics(
  definitions: HeuristicDefinition[] | undefined
): { constraints: Constraint[]; normalized: HeuristicDefinition[] } {
  if (!definitions || definitions.length === 0) {
    return { constraints: [], normalized: [] };
  }

  const constraints: Constraint[] = [];
  const normalized: HeuristicDefinition[] = [];
  for (const def of definitions) {
    const name = sanitizeIdentifier(def.name || "heuristic");
    const predicateSource = (def.predicate || "(value) => Boolean(value)").trim();
    const predicate = compilePredicate(predicateSource);
    constraints.push({
      name,
      description: def.description || "Heuristic predicate",
      test: predicate,
      predicateSource,
      code: `export const ${name} = ${predicateSource};`,
      source: "heuristic",
    });
    normalized.push({
      name,
      description: def.description || "Heuristic predicate",
      predicate: predicateSource,
    });
  }

  return { constraints, normalized };
}

function mergeHeuristicDefs(
  existing: HeuristicDefinition[],
  additions: HeuristicDefinition[]
): HeuristicDefinition[] {
  const map = new Map<string, HeuristicDefinition>();
  for (const def of existing) {
    map.set(def.name, def);
  }
  for (const def of additions) {
    map.set(def.name, def);
  }
  return Array.from(map.values());
}

function mergeConstraintSets(existing: Constraint[], additions: Constraint[]): Constraint[] {
  const map = new Map<string, Constraint>();
  for (const constraint of existing) {
    map.set(constraint.name, constraint);
  }
  for (const constraint of additions) {
    map.set(constraint.name, constraint);
  }
  return Array.from(map.values());
}

function buildHeuristicLibrarySnippet(defs: HeuristicDefinition[]): string {
  if (defs.length === 0) {
    return "";
  }
  return defs
    .map((def) => `const ${def.name} = ${def.predicate}; // ${def.description}`)
    .join("\n");
}

function writeHeuristicsModule(cacheKey: string, heuristics: HeuristicDefinition[]): string | undefined {
  if (heuristics.length === 0) {
    return undefined;
  }

  const fileName = `${cacheKey}.heuristics.ts`;
  const filePath = join(CACHE_DIR, fileName);
  const body = heuristics
    .map((def) => `export const ${def.name} = ${def.predicate}; // ${def.description}`)
    .join("\n");
  const source = `// Generated heuristics for ${cacheKey}.\n${body}\n`;
  writeFileSync(filePath, source, "utf8");
  return filePath;
}

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

function collectConstraints(typeText: string): Constraint[] {
  const unique = new Map<string, Constraint>();
  for (const component of splitIntersections(typeText)) {
    for (const constraint of deriveConstraintsForComponent(component)) {
      if (!unique.has(constraint.name)) {
        unique.set(constraint.name, constraint);
      }
    }
  }
  return Array.from(unique.values());
}

function buildConstraintSummary(constraints: Constraint[]): string {
  if (constraints.length === 0) {
    return "(no explicit heuristics available)";
  }
  const base = constraints.map((c) => c.description).join(" | ");
  return `${base} | Treat example sets as illustrative patterns to extrapolate from.`;
}

function validateValue(constraints: Constraint[], value: unknown): ValidationResult {
  const errors: string[] = [];
  for (const constraint of constraints) {
    if (!constraint.test(value)) {
      errors.push(constraint.description);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

async function callLLM(
  typeText: string,
  context: string,
  summary: string,
  heuristicsLibrary: string,
  attempt: number,
  feedback: string
): Promise<LLMResponse> {
  if (!openai) {
    throw new Error(
      `No local factory registered for "${typeText}" and OPENAI_API_KEY not set. Cannot synthesize value.`
    );
  }

  const systemPrompt = [
    "You generate JSON objects that describe candidate values and reusable heuristics for TypeScript types.",
    "Respond with JSON matching {\"value\": <literal>, \"heuristics\": [ { \"name\": string, \"description\": string, \"predicate\": string } ], \"explanation\": string }.",
    "Each heuristic predicate must be a valid JavaScript arrow function of the form (value) => boolean and should be reusable.",
    "The 'value' must be JSON-serializable, satisfy all described constraints, and be consistent with supplied heuristics.",
    "CRITICAL: Look for patterns and signal in example sets. Analyze the examples deeply for underlying structure.",
    "Study relationships between consecutive terms, ratios, differences, growth patterns, and mathematical properties.",
    "The generated value must respect ALL patterns you discover in the examples, not just explicit constraints like parity or range.",
    "Always include heuristics that capture the discovered pattern, not just basic properties.",
    "Treat measurement/example unions as patterns to generalize from, not exhaustive enumerations, unless the type explicitly requires literal equality.",
    "If the constraints are impossible, set explanation to \"__INFEASIBLE__\" and return a null value.",
  ].join(" ");

  const messages = [
    { role: "system" as const, content: systemPrompt },
    {
      role: "user" as const,
      content: [
        `Attempt: ${attempt}`,
        `Type expression: ${typeText}`,
        summary ? `Known guards: ${summary}` : "Known guards: (none)",
        heuristicsLibrary ? "Existing heuristics:\n" + heuristicsLibrary : "Existing heuristics: (none)",
        "Context snippets:",
        context,
        feedback ? `Previous feedback: ${feedback}` : "",
        "Respond with JSON only.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const completion = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: messages,
  });

  let content = completion.output_text?.trim();
  if (!content) {
    throw new Error(`LLM returned empty response for "${typeText}"`);
  }

  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  }

  try {
    const parsed = JSON.parse(content) as LLMResponse;
    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to parse LLM JSON for "${typeText}": ${(error as Error).message}. Raw response: ${content}`
    );
  }
}

async function synthesizeValue(
  typeText: string,
  context: string,
  baseConstraints: Constraint[],
  existingHeuristics: HeuristicDefinition[]
): Promise<MaterializeSuccess> {
  const attempts: CacheEntry["attempts"] = [];
  let feedback = "";
  let accumulatedConstraints = [...baseConstraints];
  let accumulatedHeuristics = [...existingHeuristics];

  for (let attempt = 1; attempt <= maxLLMAttempts; attempt += 1) {
    const summary = buildConstraintSummary(accumulatedConstraints);
    const heuristicsLibrary = buildHeuristicLibrarySnippet(accumulatedHeuristics);
    const response = await callLLM(typeText, context, summary, heuristicsLibrary, attempt, feedback);
    const model = openai?.apiKey ? "gpt-4.1-mini" : "unknown";

    if (response.explanation === "__INFEASIBLE__") {
      attempts.push({ attempt, model, feedback, explanation: response.explanation });
      feedback =
        "The constraint set is satisfiable. Please generalize beyond given examples and try another candidate.";
      continue;
    }

    const { constraints: heuristicConstraints, normalized } = compileHeuristics(response.heuristics);
    accumulatedConstraints = mergeConstraintSets(accumulatedConstraints, heuristicConstraints);
    accumulatedHeuristics = mergeHeuristicDefs(accumulatedHeuristics, normalized);
    const validation = validateValue(accumulatedConstraints, response.value);
    if (validation.ok) {
      attempts.push({ attempt, model, feedback, explanation: response.explanation });
      return {
        value: response.value,
        model,
        attempts,
        heuristics: accumulatedHeuristics,
        constraints: accumulatedConstraints,
      };
    }

    attempts.push({ attempt, model, feedback, explanation: response.explanation });
    const errorSummary = validation.errors.join("; ");
    console.log(`Attempt ${attempt} for ${typeText} rejected: ${errorSummary}`);
    feedback =
      `Validation failed: ${errorSummary}. Produce an even number greater than any thresholds while respecting inferred patterns; do not restrict to the literal sample values.`;
  }

  throw new Error(`Failed to satisfy type "${typeText}" after ${maxLLMAttempts} attempt(s).`);
}

function materializeFromCache(
  cachePath: string,
  fingerprint: string,
  baseConstraints: Constraint[],
  typeText: string
): CachedMaterialization | undefined {
  const cached = loadCacheEntry(cachePath);
  if (!cached || cached.fingerprint !== fingerprint) {
    return undefined;
  }

  let heuristicConstraints: Constraint[] = [];
  try {
    heuristicConstraints = compileHeuristics(cached.heuristics).constraints;
  } catch (error) {
    console.log(
      `Failed to compile cached heuristics for "${typeText}": ${(error as Error).message}. Will regenerate.`
    );
    return undefined;
  }

  const combinedConstraints = [...baseConstraints, ...heuristicConstraints];
  const validation = validateValue(combinedConstraints, cached.value);
  if (!validation.ok) {
    console.log(
      `Cached value for "${typeText}" failed validation: ${validation.errors.join("; ")}. Will regenerate.`
    );
    return undefined;
  }

  return {
    entry: cached,
    heuristics: cached.heuristics ?? [],
    heuristicConstraints,
  };
}

function writeFactoryModule(cacheKey: string, literal: string): string {
  const fileName = `${cacheKey}.decohered.ts`;
  const filePath = join(CACHE_DIR, fileName);
  const source = `// Generated by decohere-build. Edit with caution.\n` +
    `export const value = ${literal};\n` +
    `export function build() {\n  return value;\n}\n`;
  writeFileSync(filePath, source, "utf8");
  return filePath;
}

async function processFile(entryPath: string): Promise<void> {
  const sourceFile = project.getSourceFile(entryPath) ?? project.addSourceFileAtPath(entryPath);
  const typeChecker = project.getTypeChecker();
  let mutations = 0;

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "Decohere") {
      continue;
    }

    const typeArgument = call.getTypeArguments()[0];
    if (!typeArgument) {
      throw new Error("Decohere<T>() requires a type argument");
    }

    const typeText = normalize(typeArgument.getText());
    const dependencies = collectDeclarationFingerprints(typeArgument, typeChecker);
    const fingerprint = computeTypeFingerprint(typeText, dependencies);
    const cacheKey = makeCacheKey(typeText);
    const cachePath = join(CACHE_DIR, `${cacheKey}.json`);

    const derivedConstraints = collectConstraints(typeText);
    let heuristicDefs: HeuristicDefinition[] = [];
    let heuristicConstraints: Constraint[] = [];

    const cachedResult = materializeFromCache(cachePath, fingerprint, derivedConstraints, typeText);
    let value: unknown;
    let model = "cache";
    let attempts: CacheEntry["attempts"] = [];

    if (cachedResult) {
      value = cachedResult.entry.value;
      model = cachedResult.entry.model ?? "cache";
      heuristicDefs = cachedResult.entry.heuristics ?? [];
      heuristicConstraints = cachedResult.heuristicConstraints;
    } else {
      const contextSnippet = buildContextSnippet(typeText, dependencies);
      const existingConstraints = mergeConstraintSets(derivedConstraints, heuristicConstraints);

      const synthesized = await synthesizeValue(
        typeText,
        contextSnippet,
        existingConstraints,
        heuristicDefs
      );
      value = synthesized.value;
      model = synthesized.model;
      attempts = synthesized.attempts;

      heuristicDefs = synthesized.heuristics;
      heuristicConstraints = synthesized.constraints.filter((constraint) => constraint.source === "heuristic");

      const combinedConstraints = mergeConstraintSets(derivedConstraints, heuristicConstraints);
      const validation = validateValue(combinedConstraints, value);
      if (!validation.ok) {
        throw new Error(
          `Synthesized value for "${typeText}" failed validation: ${validation.errors.join("; ")}`
        );
      }

      const literal = JSON.stringify(value);
      const factoryPath = writeFactoryModule(cacheKey, literal);
      const heuristicsModulePath = writeHeuristicsModule(cacheKey, heuristicDefs);

      const entry: CacheEntry = {
        typeText,
        fingerprint,
        dependencies,
        model,
        value,
        createdAt: new Date().toISOString(),
        attempts,
        factoryPath: relative(PROJECT_ROOT, factoryPath),
        heuristicsPath: heuristicsModulePath ? relative(PROJECT_ROOT, heuristicsModulePath) : undefined,
        heuristics: heuristicDefs,
      };
      saveCacheEntry(cachePath, entry);
      console.log(`Cached decoherence for "${typeText}" at ${cachePath}`);
    }

    const literal = JSON.stringify(value);
    const replacement = `(${literal} as unknown as ${typeArgument.getText()})`;
    call.replaceWithText(replacement);
    mutations += 1;
    console.log(`Decohere<${typeText}> -> ${literal} (model: ${model})`);
  }

  if (mutations === 0) {
    console.warn("No Decohere<T>() calls found. Nothing to do.");
  }

  const outputPath = join(PROJECT_ROOT, OUTPUT_FILE);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, sourceFile.getFullText(), "utf8");
  console.log(`Wrote ${OUTPUT_FILE} with ${mutations} materialized value(s).`);
}

async function main(): Promise<void> {
  await processFile("examples/playground.ts");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
