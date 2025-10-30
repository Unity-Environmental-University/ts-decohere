import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import vm from "node:vm";
import { Node, Project, SyntaxKind, TypeChecker, Symbol as MorphSymbol, SourceFile } from "ts-morph";
import { config as loadEnv } from "dotenv";
import OpenAI from "openai";
import {
  buildUserMessage,
  buildSystemPrompt,
  parseLLMResponse,
  validateLLMResponse,
  PromptContext,
} from "./lib/llm";
import {
  rankCandidates,
  selectBestCandidate,
  isConfidentCandidate,
} from "./lib/candidate-selector";
import {
  globalAuditLog,
  AuditLog,
} from "./lib/audit";
import {
  globalLogger,
  Logger,
} from "./lib/logger";

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
  resolvedType?: string;
  // Audit information for candidate selection and ranking
  candidateSelectionAudit?: {
    attempt: number;
    selectedCandidateIndex: number;
    selectedCandidateName: string;
    candidateScores?: Array<{
      name: string;
      totalScore: number;
      complexityScore: number;
      coverageScore: number;
      reusabilityScore: number;
    }>;
    confidence?: number;
    selectionReason?: string;
  };
};

type MaterializeSuccess = {
  value: unknown;
  model: string;
  attempts: CacheEntry["attempts"];
  heuristics: HeuristicDefinition[];
  constraints: Constraint[];
  resolvedType?: string;
  candidateValidators?: HeuristicDefinition[][];
  candidateSelectionAudit?: CacheEntry["candidateSelectionAudit"];
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
  candidateValidators?: {
    name?: string;
    description?: string;
    predicate: string;
  }[];
};

type HelperCategory = "humanizer" | "validator" | "generator" | "transformer";

type HelperRegistryEntry = {
  id: string;
  name: string;
  description: string;
  category: HelperCategory;
  source: string;
  signature: string;
  inputTypes: string[];
  outputType: string;
};

type HelperRegistry = Record<string, HelperRegistryEntry>;

type SingleLinePredicateExpression =
  | `x > ${string | number}`
  | `x < ${string | number}`
  | `x >= ${string | number}`
  | `x <= ${string | number}`
  | `x === ${string}`
  | `x % ${string | number} === ${string | number}`
  | `typeof x === "${string}"`
  | `Array.isArray(x)`
  | `(x) => ${string}`;

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

let OUTPUT_FILE = "examples/playground.decohered.ts";  // Will be set dynamically in main()
const CACHE_DIR = join(PROJECT_ROOT, factoryCacheDir);
mkdirSync(CACHE_DIR, { recursive: true });
const PREDICATE_REGISTRY_DIR = join(PROJECT_ROOT, "generated", "predicates");
const PREDICATE_REGISTRY_PATH = join(PREDICATE_REGISTRY_DIR, "registry.json");
const PREDICATE_INDEX_PATH = join(PREDICATE_REGISTRY_DIR, "index.ts");
mkdirSync(PREDICATE_REGISTRY_DIR, { recursive: true });

const HELPER_REGISTRY_DIR = join(PROJECT_ROOT, "generated", "helpers");
const HELPER_REGISTRY_PATH = join(HELPER_REGISTRY_DIR, "registry.json");
const HELPER_INDEX_PATH = join(HELPER_REGISTRY_DIR, "index.ts");
mkdirSync(HELPER_REGISTRY_DIR, { recursive: true });

const normalize = (key: string): string => key.replace(/\s+/g, " ").trim();

const numberExampleCache = new Map<string, number[]>();
const usageExampleCache = new Map<string, Record<string, unknown>[]>();

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

function analyzeExampleProperties(numbers: number[], constraints: Constraint[]): string {
  if (numbers.length === 0) {
    return "";
  }

  const satisfiedConstraints: string[] = [];
  for (const constraint of constraints) {
    if (numbers.every((n) => constraint.test(n))) {
      satisfiedConstraints.push(constraint.description);
    }
  }

  if (satisfiedConstraints.length === 0) {
    return `Example values: ${numbers.join(", ")}\nPattern analysis needed: What structure connects these specific values?`;
  }

  return [
    `Example values: ${numbers.join(", ")}`,
    `Common properties already captured: ${satisfiedConstraints.join(", ")}`,
    `Pattern analysis needed: What additional structure or relationship connects these specific values beyond the common properties?`,
  ].join("\n");
}

function analyzeUsageExamples(examples: Record<string, unknown>[]): string {
  if (examples.length === 0) {
    return "";
  }

  const sample = examples.slice(0, 3).map((example) => JSON.stringify(example));
  const propertyMap = new Map<string, Set<string>>();
  for (const example of examples) {
    for (const [key, value] of Object.entries(example)) {
      if (!propertyMap.has(key)) {
        propertyMap.set(key, new Set());
      }
      propertyMap.get(key)!.add(JSON.stringify(value ?? null));
    }
  }

  const propertySummaries = Array.from(propertyMap.entries())
    .map(([key, values]) => `${key}: ${Array.from(values).join(" | ")}`)
    .join("; ");

  return [
    `Usage examples (${examples.length}):`,
    sample.join("\n"),
    propertySummaries ? `Observed property patterns: ${propertySummaries}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildContextSnippet(
  typeText: string,
  dependencies: DeclarationFingerprint[],
  exampleNumbers: number[],
  usageExamples: Record<string, unknown>[],
  constraints: Constraint[]
): string {
  const parts: string[] = [];

  if (exampleNumbers.length > 0) {
    parts.push(analyzeExampleProperties(exampleNumbers, constraints));
  }

  if (usageExamples.length > 0) {
    parts.push(analyzeUsageExamples(usageExamples));
  }

  if (dependencies.length > 0) {
    const combined = dependencies.map((dep) => dep.text).join("\n\n");
    const truncated = combined.length > 4000 ? combined.slice(0, 4000) : combined;
    parts.push("Type definitions:", truncated);
  }

  return parts.length > 0 ? parts.join("\n\n") : typeText;
}

function collectPredicateIds(constraints: Constraint[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const constraint of constraints) {
    if (!constraint.predicateId) {
      continue;
    }
    if (seen.has(constraint.predicateId)) {
      continue;
    }
    seen.add(constraint.predicateId);
    ids.push(constraint.predicateId);
  }
  return ids;
}

function ensurePredicateImport(sourceFile: SourceFile): void {
  const sourceFilePath = sourceFile.getFilePath();
  let moduleSpecifier = relative(dirname(sourceFilePath), PREDICATE_INDEX_PATH).replace(/\\/g, "/");
  moduleSpecifier = moduleSpecifier.replace(/\.ts$/, "");
  if (!moduleSpecifier.startsWith(".")) {
    moduleSpecifier = `./${moduleSpecifier}`;
  }

  const existing = sourceFile
    .getImportDeclarations()
    .find((decl) => decl.getModuleSpecifier().getLiteralText() === moduleSpecifier);

  if (existing) {
    const hasEvaluate = existing.getNamedImports().some((named) => named.getName() === "evaluatePredicates");
    if (!hasEvaluate) {
      existing.addNamedImport("evaluatePredicates");
    }
    return;
  }

  sourceFile.addImportDeclaration({
    moduleSpecifier,
    namedImports: ["evaluatePredicates"],
  });
}

function removeNamedImport(sourceFile: SourceFile, name: string, moduleSpecifier?: string): void {
  const declarations = sourceFile
    .getImportDeclarations()
    .filter((decl) => {
      const spec = decl.getModuleSpecifier().getLiteralText();
      return moduleSpecifier ? spec === moduleSpecifier : true;
    });
  if (declarations.length === 0) {
    return;
  }
  for (const declaration of declarations) {
    const namedImports = declaration.getNamedImports();
    const target = namedImports.find((named) => named.getName() === name);
    if (!target) {
      continue;
    }
    target.remove();
    if (
      declaration.getNamedImports().length === 0 &&
      !declaration.getDefaultImport() &&
      !declaration.getNamespaceImport()
    ) {
      declaration.remove();
    }
  }
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
  predicateId?: string;
  source: "inferred" | "heuristic";
};

type PredicateRegistryEntry = {
  id: string;
  name: string;
  description: string;
  predicateSource: string;
};

type PredicateRegistry = Record<string, PredicateRegistryEntry>;

function loadPredicateRegistry(): PredicateRegistry {
  if (!existsSync(PREDICATE_REGISTRY_PATH)) {
    return {};
  }
  try {
    const raw = readFileSync(PREDICATE_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw) as PredicateRegistryEntry[];
    const map: PredicateRegistry = {};
    for (const entry of parsed) {
      if (entry && entry.id && entry.predicateSource) {
        map[entry.id] = entry;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function writePredicateRegistryFile(registry: PredicateRegistry): void {
  const entries = Object.values(registry).sort((a, b) => a.id.localeCompare(b.id));
  const json = JSON.stringify(entries, null, 2);
  writeFileSync(PREDICATE_REGISTRY_PATH, json, "utf8");
}

function writePredicateIndex(registry: PredicateRegistry): void {
  const lines: string[] = [];
  lines.push("export type PredicateEntry = {");
  lines.push("  id: string;");
  lines.push("  name: string;");
  lines.push("  description: string;");
  lines.push("  test: (value: unknown) => boolean;");
  lines.push("};");
  lines.push("");
  lines.push("export const predicateEntries: Record<string, PredicateEntry> = {");
  const entries = Object.values(registry).sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const comma = i === entries.length - 1 ? "" : ",";
    lines.push(`  "${entry.id}": {`);
    lines.push(`    id: ${JSON.stringify(entry.id)},`);
    lines.push(`    name: ${JSON.stringify(entry.name)},`);
    lines.push(`    description: ${JSON.stringify(entry.description)},`);
    lines.push(`    test: ${entry.predicateSource}`);
    lines.push(`  }${comma}`);
  }
  lines.push("};");
  lines.push("");
  lines.push("export function evaluatePredicates(ids: readonly string[], value: unknown): boolean {");
  lines.push("  for (const id of ids) {");
  lines.push("    const entry = predicateEntries[id];");
  lines.push("    if (!entry || !entry.test(value)) {");
  lines.push("      return false;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return true;");
  lines.push("}");
  lines.push("");
  lines.push("export function getPredicateEntry(id: string): PredicateEntry | undefined {");
  lines.push("  return predicateEntries[id];");
  lines.push("}");
  const source = lines.join("\n");
  writeFileSync(PREDICATE_INDEX_PATH, source, "utf8");
}

const predicateRegistry = loadPredicateRegistry();
let predicateRegistryDirty = false;
const builtInPredicateSeeds: Array<{ name: string; description: string; predicateSource: string }> = [
  {
    name: "isStringValue",
    description: "Value must be a string",
    predicateSource: '(value) => typeof value === "string"',
  },
  {
    name: "isNumberValue",
    description: "Value must be a finite number",
    predicateSource: '(value) => typeof value === "number" && Number.isFinite(value)',
  },
];
for (const seed of builtInPredicateSeeds) {
  const source = seed.predicateSource.trim();
  const id = hashText(source);
  if (!predicateRegistry[id]) {
    predicateRegistry[id] = {
      id,
      name: seed.name,
      description: seed.description,
      predicateSource: source,
    };
    predicateRegistryDirty = true;
  }
}
if (!existsSync(PREDICATE_INDEX_PATH)) {
  writePredicateIndex(predicateRegistry);
}

function registerConstraintPredicate(constraint: Constraint): string | undefined {
  const source = constraint.predicateSource?.trim();
  if (!source) {
    return undefined;
  }
  const id = hashText(source);
  const existing = predicateRegistry[id];
  if (!existing) {
    predicateRegistry[id] = {
      id,
      name: constraint.name,
      description: constraint.description,
      predicateSource: source,
    };
    predicateRegistryDirty = true;
  }
  if (
    existing &&
    (existing.name !== constraint.name || existing.description !== constraint.description || existing.predicateSource !== source)
  ) {
    predicateRegistry[id] = {
      id,
      name: constraint.name,
      description: constraint.description,
      predicateSource: source,
    };
    predicateRegistryDirty = true;
  }
  constraint.predicateId = id;
  return id;
}

function persistPredicateRegistry(): void {
  if (!predicateRegistryDirty) {
    return;
  }
  mkdirSync(PREDICATE_REGISTRY_DIR, { recursive: true });
  writePredicateRegistryFile(predicateRegistry);
  writePredicateIndex(predicateRegistry);
  predicateRegistryDirty = false;
}

function loadHelperRegistry(): HelperRegistry {
  if (!existsSync(HELPER_REGISTRY_PATH)) {
    return {};
  }
  try {
    const raw = readFileSync(HELPER_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw) as HelperRegistryEntry[];
    const map: HelperRegistry = {};
    for (const entry of parsed) {
      if (entry && entry.id && entry.source) {
        map[entry.id] = entry;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function writeHelperRegistryFile(registry: HelperRegistry): void {
  const entries = Object.values(registry).sort((a, b) => a.id.localeCompare(b.id));
  const json = JSON.stringify(entries, null, 2);
  writeFileSync(HELPER_REGISTRY_PATH, json, "utf8");
}

function writeHelperIndex(registry: HelperRegistry): void {
  const lines: string[] = [];
  lines.push("export type HelperEntry = {");
  lines.push("  id: string;");
  lines.push("  name: string;");
  lines.push("  description: string;");
  lines.push("  category: string;");
  lines.push("  execute: (...args: any[]) => any;");
  lines.push("};");
  lines.push("");
  lines.push("export const helperEntries: Record<string, HelperEntry> = {");
  const entries = Object.values(registry).sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const comma = i === entries.length - 1 ? "" : ",";
    lines.push(`  "${entry.id}": {`);
    lines.push(`    id: ${JSON.stringify(entry.id)},`);
    lines.push(`    name: ${JSON.stringify(entry.name)},`);
    lines.push(`    description: ${JSON.stringify(entry.description)},`);
    lines.push(`    category: ${JSON.stringify(entry.category)},`);
    lines.push(`    execute: ${entry.source}`);
    lines.push(`  }${comma}`);
  }
  lines.push("};");
  lines.push("");
  lines.push("export function getHelperEntry(id: string): HelperEntry | undefined {");
  lines.push("  return helperEntries[id];");
  lines.push("}");
  lines.push("");
  lines.push("export function invokeHelper(id: string, ...args: any[]): any {");
  lines.push("  const entry = helperEntries[id];");
  lines.push("  if (!entry) {");
  lines.push("    throw new Error(`Helper not found: ${id}`);");
  lines.push("  }");
  lines.push("  return entry.execute(...args);");
  lines.push("}");
  const source = lines.join("\n");
  writeFileSync(HELPER_INDEX_PATH, source, "utf8");
}

const helperRegistry = loadHelperRegistry();
let helperRegistryDirty = false;

// Initialize helper index on startup if it doesn't exist
if (!existsSync(HELPER_INDEX_PATH)) {
  writeHelperIndex(helperRegistry);
}

function registerHelper(helper: HelperRegistryEntry): void {
  const source = helper.source?.trim();
  if (!source) {
    return;
  }
  const id = hashText(source);
  const existing = helperRegistry[id];
  if (!existing) {
    helperRegistry[id] = {
      ...helper,
      id,
    };
    helperRegistryDirty = true;
  }
  if (
    existing &&
    (existing.name !== helper.name ||
      existing.description !== helper.description ||
      existing.source !== source ||
      existing.category !== helper.category)
  ) {
    helperRegistry[id] = {
      ...helper,
      id,
    };
    helperRegistryDirty = true;
  }
}

function persistHelperRegistry(): void {
  if (!helperRegistryDirty) {
    return;
  }
  mkdirSync(HELPER_REGISTRY_DIR, { recursive: true });
  writeHelperRegistryFile(helperRegistry);
  writeHelperIndex(helperRegistry);
  helperRegistryDirty = false;
}

function compileSingleLinePredicate(expression: string): ((value: unknown) => boolean) | undefined {
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

function registerSingleLinePredicate(
  name: string,
  description: string,
  expression: string
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
  const existing = predicateRegistry[id];

  if (!existing) {
    predicateRegistry[id] = {
      id,
      name,
      description,
      predicateSource,
    };
    predicateRegistryDirty = true;
  }

  return id;
}

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
  const cached = numberExampleCache.get(component);
  if (cached) {
    return cached;
  }
  const match = component.match(/^(?:InferFromMeasurments|CohereFromExamples)<(.+)>$/);
  if (!match) {
    return undefined;
  }

  // 🔴 TODO: CRITICAL - Constraint Value Propagation
  // When InferFromMeasurments/CohereFromExamples constraints are composed with others (e.g., & GreaterThanX<100>),
  // the actual example values extracted here MUST be included in the constraint description sent to the LLM.
  // Currently, the LLM may only see "InferFromMeasurments" without the actual [1, 2, 3, 5, 8, 13] values,
  // making it impossible to discover the underlying pattern (Fibonacci, prime sequence, etc.).
  // This is why MysteryType & GreaterThanX<100> & Even returns 102 instead of 144.
  // Fix: Ensure buildConstraintSections() or buildUserMessage() receives complete example values in descriptions.

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
  if (numbers.length > 0) {
    numberExampleCache.set(component, numbers);
    return numbers;
  }
  return undefined;
}

function convertTypeNodeToValue(node: Node): unknown {
  if (Node.isLiteralTypeNode(node)) {
    const literal = node.getLiteral();
    if (Node.isStringLiteral(literal) || Node.isNoSubstitutionTemplateLiteral(literal)) {
      return literal.getLiteralValue();
    }
    if (Node.isNumericLiteral(literal)) {
      return Number(literal.getText());
    }
    if (literal.getKind() === SyntaxKind.TrueKeyword) {
      return true;
    }
    if (literal.getKind() === SyntaxKind.FalseKeyword) {
      return false;
    }
    if (literal.getKind() === SyntaxKind.NullKeyword) {
      return null;
    }
  }

  if (Node.isTupleTypeNode(node)) {
    const values: unknown[] = [];
    for (const element of node.getElements()) {
      const inner = Node.isNamedTupleMember(element) ? element.getTypeNode() : element;
      if (!inner) {
        return undefined;
      }
      const value = convertTypeNodeToValue(inner);
      if (typeof value === "undefined") {
        return undefined;
      }
      values.push(value);
    }
    return values;
  }

  if (Node.isUnionTypeNode(node)) {
    const literals: unknown[] = [];
    for (const typeNode of node.getTypeNodes()) {
      const value = convertTypeNodeToValue(typeNode);
      if (typeof value === "undefined") {
        return undefined;
      }
      literals.push(value);
    }
    return literals;
  }

  if (Node.isTypeLiteral(node)) {
    const example: Record<string, unknown> = {};
    let populated = false;
    for (const member of node.getMembers()) {
      if (!Node.isPropertySignature(member)) {
        continue;
      }
      const name = member.getName();
      const typeNode = member.getTypeNode();
      if (!typeNode) {
        continue;
      }
      const value = convertTypeNodeToValue(typeNode);
      if (typeof value === "undefined") {
        continue;
      }
      example[name] = value;
      populated = true;
    }
    return populated ? example : undefined;
  }

  return undefined;
}

function extractUsageExamplesFromTypeNode(node: Node): Record<string, unknown>[] {
  if (Node.isTupleTypeNode(node)) {
    const results: Record<string, unknown>[] = [];
    for (const element of node.getElements()) {
      const inner = Node.isNamedTupleMember(element) ? element.getTypeNode() : element;
      if (!inner) {
        continue;
      }
      results.push(...extractUsageExamplesFromTypeNode(inner));
    }
    return results;
  }
  if (Node.isUnionTypeNode(node)) {
    const results: Record<string, unknown>[] = [];
    for (const part of node.getTypeNodes()) {
      results.push(...extractUsageExamplesFromTypeNode(part));
    }
    return results;
  }
  if (Node.isTypeLiteral(node)) {
    const value = convertTypeNodeToValue(node);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return [value as Record<string, unknown>];
    }
  }
  return [];
}

function makeUsageCacheKey(component: string, contextAlias?: string): string {
  return `${component}::${contextAlias ?? ""}`;
}

function parseUsageExamples(component: string, contextAlias?: string): Record<string, unknown>[] | undefined {
  const cacheKey = makeUsageCacheKey(component, contextAlias);
  const cached = usageExampleCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const match = component.match(/^InferFromUsage<([\s\S]+)>$/);
  if (!match) {
    return undefined;
  }

  const inner = match[1].trim();
  const literalExamples = parseUsageExamplesFromTypeString(inner);

  const identifiers: string[] = [];
  const identifierMatch = inner.match(/^[A-Za-z_][A-Za-z0-9_]*$/);
  if (identifierMatch) {
    identifiers.push(identifierMatch[0]);
  }
  const typeofMatch = inner.match(/^typeof\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[\s*number\s*\])?$/);
  if (typeofMatch) {
    identifiers.push(typeofMatch[1]);
  }
  if (contextAlias) {
    identifiers.push(contextAlias);
  }

  const usageExamples: Record<string, unknown>[] = [];
  const seenIdentifiers = new Set<string>();
  for (const identifier of identifiers) {
    if (!identifier || seenIdentifiers.has(identifier)) {
      continue;
    }
    seenIdentifiers.add(identifier);
    usageExamples.push(...collectUsageExamplesFromAlias(identifier));
  }

  const combined = [...literalExamples, ...usageExamples];
  if (combined.length === 0) {
    return undefined;
  }
  console.log("parseUsageExamples", component, "->", combined);
  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];
  for (const example of combined) {
    const key = JSON.stringify(example);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(example);
    }
  }
  if (deduped.length > 0) {
    usageExampleCache.set(cacheKey, deduped);
  }
  return deduped;
}

function parseUsageExamplesFromTypeString(typeText: string): Record<string, unknown>[] {
  if (!typeText || typeText === "unknown") {
    return [];
  }
  const tempFileName = `__decohere_infer_usage_${hashText(typeText).slice(0, 8)}.ts`;
  const tempSource = project.createSourceFile(tempFileName, `type __Temp = ${typeText};`, {
    overwrite: true,
  });
  try {
    const typeAlias = tempSource.getTypeAlias("__Temp");
    const typeNode = typeAlias?.getTypeNode();
    if (!typeNode) {
      return [];
    }
    return extractUsageExamplesFromTypeNode(typeNode);
  } catch {
    return [];
  } finally {
    tempSource.delete();
  }
}

const usageExamplesCache = new Map<string, Record<string, unknown>[]>();

function collectUsageExamplesFromAlias(aliasName: string): Record<string, unknown>[] {
  if (usageExamplesCache.has(aliasName)) {
    return usageExamplesCache.get(aliasName)!;
  }

  const examples: Record<string, unknown>[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      if (declaration.getName() !== aliasName) {
        continue;
      }
      const initializer = declaration.getInitializer();
      if (!initializer) {
        continue;
      }
      const value = convertExpressionToValue(initializer);
      if (Array.isArray(value)) {
        for (const element of value) {
          if (element && typeof element === "object" && !Array.isArray(element)) {
            examples.push(element as Record<string, unknown>);
          }
        }
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        examples.push(value as Record<string, unknown>);
      }
    }
  }

  usageExamplesCache.set(aliasName, examples);
  return examples;
}

function convertExpressionToValue(node: Node): unknown {
  if (Node.isAsExpression(node) || Node.isTypeAssertion(node)) {
    return convertExpressionToValue(node.getExpression());
  }
  if (Node.isObjectLiteralExpression(node)) {
    const record: Record<string, unknown> = {};
    let populated = false;
    for (const property of node.getProperties()) {
      if (!Node.isPropertyAssignment(property)) {
        continue;
      }
      const nameNode = property.getNameNode();
      if (!nameNode) {
        continue;
      }
      let key: string | undefined;
      if (Node.isIdentifier(nameNode)) {
        key = nameNode.getText();
      } else if (
        Node.isStringLiteral(nameNode) ||
        Node.isNoSubstitutionTemplateLiteral(nameNode)
      ) {
        key = nameNode.getLiteralText();
      }
      if (!key) {
        continue;
      }
      const initializer = property.getInitializer();
      if (!initializer) {
        continue;
      }
      const value = convertExpressionToValue(initializer);
      if (typeof value === "undefined") {
        continue;
      }
      record[key] = value;
      populated = true;
    }
    return populated ? record : undefined;
  }

  if (Node.isArrayLiteralExpression(node)) {
    const values: unknown[] = [];
    for (const element of node.getElements()) {
      const value = convertExpressionToValue(element);
      if (typeof value === "undefined") {
        return undefined;
      }
      values.push(value);
    }
    return values;
  }

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }

  if (Node.isNumericLiteral(node)) {
    return Number(node.getText());
  }

  if (node.getKind() === SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.getKind() === SyntaxKind.FalseKeyword) {
    return false;
  }

  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeForDedup(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForDedup(item));
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    const normalized: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      normalized[key] = normalizeForDedup(val);
    }
    return normalized;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForDedup(value));
}

function dedupeNumberList(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => typeof value === "number" && Number.isFinite(value)))).sort(
    (a, b) => a - b
  );
}

function sanitizeGeneratedObject(obj: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(obj)) {
    return undefined;
  }
  try {
    const normalized = JSON.parse(JSON.stringify(obj)) as unknown;
    if (!isPlainObject(normalized)) {
      return undefined;
    }
    return normalized;
  } catch {
    return undefined;
  }
}

function dedupeObjectList(values: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];
  for (const value of values) {
    const key = stableStringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(value);
    }
  }
  return deduped;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseTypeExpression(typeText: string, replacements: Map<string, string>): string {
  let result = typeText;
  const entries = Array.from(replacements.entries()).sort((a, b) => b[0].length - a[0].length);
  for (const [component, replacement] of entries) {
    if (!replacement) {
      continue;
    }
    const pattern = new RegExp(escapeRegExp(component), "g");
    result = result.replace(pattern, replacement);
  }
  return result;
}

function resolveComponentType(
  component: string,
  numbers: number[],
  usageExamples: Record<string, unknown>[]
): string | undefined {
  if (/^InferFromMeasurments/.test(component) || /^CohereFromExamples/.test(component)) {
    if (numbers.length === 0) {
      return undefined;
    }
    return resolveNumericType(numbers);
  }
  if (/^InferFromUsage/.test(component)) {
    if (usageExamples.length === 0) {
      return undefined;
    }
    return resolveUsageType(usageExamples);
  }
  return undefined;
}

function resolveNumericType(numbers: number[]): string {
  const unique = dedupeNumberList(numbers);
  if (unique.length === 0) {
    return "number";
  }
  if (unique.length === 1) {
    return JSON.stringify(unique[0]);
  }
  if (unique.length <= 6) {
    return unique.map((value) => JSON.stringify(value)).join(" | ");
  }
  return "number";
}

function resolveUsageType(examples: Record<string, unknown>[]): string {
  const allKeys = new Set<string>();
  for (const example of examples) {
    for (const key of Object.keys(example)) {
      allKeys.add(key);
    }
  }
  const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b));
  const requiredKeys = new Set<string>();
  for (const key of sortedKeys) {
    if (examples.every((example) => Object.prototype.hasOwnProperty.call(example, key))) {
      requiredKeys.add(key);
    }
  }

  const lines: string[] = [];
  lines.push("{");
  for (const key of sortedKeys) {
    const values = examples
      .map((example) => example[key])
      .filter((value): value is unknown => typeof value !== "undefined");
    const typeExpr = deriveValueType(values);
    const optional = requiredKeys.has(key) ? "" : "?";
    const propertyName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
    lines.push(`  ${propertyName}${optional}: ${typeExpr};`);
  }
  lines.push("}");
  return lines.join("\n");
}

function deriveValueType(values: unknown[], depth = 0): string {
  if (values.length === 0) {
    return "unknown";
  }
  if (depth > 2) {
    return "unknown";
  }

  const stringLiterals = new Set<string>();
  const numberLiterals = new Set<number>();
  const boolValues = new Set<boolean>();
  let hasString = false;
  let hasNumber = false;
  let hasBoolean = false;
  let hasNull = false;
  let hasUndefined = false;
  const complexTypes: string[] = [];
  const arrayElementTypes: string[] = [];

  for (const value of values) {
    if (typeof value === "string") {
      hasString = true;
      stringLiterals.add(value);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      hasNumber = true;
      numberLiterals.add(value);
    } else if (typeof value === "boolean") {
      hasBoolean = true;
      boolValues.add(value);
    } else if (value === null) {
      hasNull = true;
    } else if (typeof value === "undefined") {
      hasUndefined = true;
    } else if (Array.isArray(value)) {
      const elementType = deriveValueType(value, depth + 1);
      arrayElementTypes.push(elementType);
    } else if (isPlainObject(value)) {
      complexTypes.push("Record<string, unknown>");
    } else {
      complexTypes.push("unknown");
    }
  }

  const typeParts: string[] = [];

  if (hasString) {
    if (stringLiterals.size > 0 && stringLiterals.size <= 6) {
      typeParts.push(Array.from(stringLiterals).map((lit) => JSON.stringify(lit)).join(" | "));
    } else {
      typeParts.push("string");
    }
  }

  if (hasNumber) {
    if (numberLiterals.size > 0 && numberLiterals.size <= 6) {
      typeParts.push(Array.from(numberLiterals).map((num) => JSON.stringify(num)).join(" | "));
    } else {
      typeParts.push("number");
    }
  }

  if (hasBoolean) {
    if (boolValues.size === 1) {
      typeParts.push(Array.from(boolValues)[0] ? "true" : "false");
    } else {
      typeParts.push("boolean");
    }
  }

  if (hasNull) {
    typeParts.push("null");
  }

  if (hasUndefined) {
    typeParts.push("undefined");
  }

  if (arrayElementTypes.length > 0) {
    const elementType = Array.from(new Set(arrayElementTypes)).join(" | ") || "unknown";
    const bracketed = elementType.includes("|") ? `(${elementType})[]` : `${elementType}[]`;
    typeParts.push(bracketed);
  }

  if (complexTypes.length > 0) {
    typeParts.push(...new Set(complexTypes));
  }

  if (typeParts.length === 0) {
    return "unknown";
  }

  return Array.from(new Set(typeParts)).join(" | ");
}

function valueSignature(value: unknown): string {
  if (Array.isArray(value)) {
    const elementSignatures = Array.from(new Set(value.map((item) => valueSignature(item)))).sort();
    return `array<${elementSignatures.join("|")}>`;
  }
  if (value === null) {
    return "null";
  }
  const type = typeof value;
  if (type === "object") {
    return "object";
  }
  return type;
}

type AugmentedExamples = {
  numbers: number[];
  usage: Record<string, unknown>[];
};

async function augmentExampleSets(
  typeText: string,
  numbers: number[],
  usageExamples: Record<string, unknown>[],
  dependencyTextMap: Map<string, string>
): Promise<AugmentedExamples> {
  const dedupNumbers = dedupeNumberList(numbers);
  const dedupUsage = dedupeObjectList(usageExamples);

  if (!openai || (dedupNumbers.length === 0 && dedupUsage.length === 0)) {
    return { numbers: dedupNumbers, usage: dedupUsage };
  }

  const dependenciesSnippet = Array.from(dependencyTextMap.entries())
    .map(([name, text]) => `type ${name} = ${text}`)
    .join("\n");

  const numberSnippet = dedupNumbers.length > 0 ? dedupNumbers.join(", ") : "(none)";
  const usageSnippet =
    dedupUsage.length > 0 ? dedupUsage.map((example) => JSON.stringify(example)).join("\n") : "(none)";

  const allowedKeys = new Set<string>();
  const requiredKeys = new Set<string>();
  const keyShapes = new Map<string, Set<string>>();

  if (dedupUsage.length > 0) {
    const initialKeys = Object.keys(dedupUsage[0]);
    for (const key of initialKeys) {
      requiredKeys.add(key);
    }
    for (const example of dedupUsage) {
      for (const key of Array.from(requiredKeys)) {
        if (!(key in example)) {
          requiredKeys.delete(key);
        }
      }
      for (const [key, value] of Object.entries(example)) {
        allowedKeys.add(key);
        const signature = valueSignature(value);
        if (!keyShapes.has(key)) {
          keyShapes.set(key, new Set());
        }
        keyShapes.get(key)!.add(signature);
      }
    }
  }

  const messages = [
    {
      role: "system" as const,
      content: [
        "You expand example sets for TypeScript type inference.",
        "Given current examples, propose 1-3 additional items that follow the same structural patterns.",
        "Respond with JSON matching {\"numbers\": number[]?, \"objects\": object[]?}.",
        "Only include fields and values consistent with all provided examples and definitions.",
        "Do not restate existing examples; provide strictly new, consistent instances.",
      ].join(" "),
    },
    {
      role: "user" as const,
      content: [
        `Type expression: ${typeText}`,
        `Existing number examples: ${numberSnippet}`,
        `Existing object examples:\n${usageSnippet}`,
        dependenciesSnippet ? `Type definitions:\n${dependenciesSnippet}` : "Type definitions: (none)",
        "Respond with JSON only.",
      ].join("\n"),
    },
  ];

  try {
    const completion = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
    });

    let content = completion.output_text?.trim();
    if (!content) {
      return { numbers: dedupNumbers, usage: dedupUsage };
    }
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    }

    const parsed = JSON.parse(content) as {
      numbers?: unknown;
      objects?: unknown;
    };

    const additionalNumbers = Array.isArray(parsed.numbers)
      ? parsed.numbers.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)).filter(
          (value): value is number => typeof value === "number"
        )
      : [];

    const additionalObjectsRaw = Array.isArray(parsed.objects)
      ? parsed.objects
          .map((value) => sanitizeGeneratedObject(value))
          .filter((value): value is Record<string, unknown> => Boolean(value))
      : [];

    const additionalObjects = additionalObjectsRaw.filter((object) => {
      if (allowedKeys.size > 0) {
        for (const key of Object.keys(object)) {
          if (!allowedKeys.has(key)) {
            return false;
          }
        }
        for (const key of requiredKeys) {
          if (!(key in object)) {
            return false;
          }
        }
        for (const [key, value] of Object.entries(object)) {
          const signature = valueSignature(value);
          const shapes = keyShapes.get(key);
          if (shapes && !shapes.has(signature)) {
            return false;
          }
        }
      }
      return true;
    });

    return {
      numbers: dedupeNumberList([...dedupNumbers, ...additionalNumbers]),
      usage: dedupeObjectList([...dedupUsage, ...additionalObjects]),
    };
  } catch {
    return { numbers: dedupNumbers, usage: dedupUsage };
  }
}

function sanitizeIdentifier(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  const noLeadingDigit = cleaned.replace(/^([0-9])/, "_$1");
  return noLeadingDigit || "constraint";
}

function deriveConstraintsForComponent(component: string, contextAlias?: string): Constraint[] {
  const constraints: Constraint[] = [];

  const greaterMatch = component.match(/^GreaterThanX<\s*(-?\d+(?:\.\d+)?)\s*>$/);
  if (greaterMatch) {
    const minimum = Number(greaterMatch[1]);
    const name = sanitizeIdentifier(`greaterThan_${minimum}`);
    const constraint: Constraint = {
      name,
      description: `Value must be a number strictly greater than ${minimum}`,
      test: (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > minimum,
      predicateSource:
        `(value) => typeof value === "number" && Number.isFinite(value) && value > ${minimum}`,
      code: `export const ${name} = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > ${minimum};`,
      source: "inferred",
    };
    registerConstraintPredicate(constraint);
    constraints.push(constraint);
    return constraints;
  }

  const usageExamples = parseUsageExamples(component, contextAlias);
  if (usageExamples && usageExamples.length > 0) {
    const name = sanitizeIdentifier(
      `matches_usage_${hashText(JSON.stringify(usageExamples)).slice(0, 8)}`
    );
    const requiredCounts = new Map<string, number>();
    const allowedValues = new Map<string, Set<string>>();

    for (const example of usageExamples) {
      const keys = Object.keys(example);
      for (const key of keys) {
        requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
        const serialized = JSON.stringify(example[key] ?? null);
        if (!allowedValues.has(key)) {
          allowedValues.set(key, new Set());
        }
        allowedValues.get(key)!.add(serialized);
      }
    }

    const requiredKeys = Array.from(requiredCounts.entries())
      .filter(([, count]) => count === usageExamples.length)
      .map(([key]) => key);

    const allowedObject: Record<string, string[]> = {};
    for (const [key, values] of allowedValues.entries()) {
      allowedObject[key] = Array.from(values.values());
    }

    const predicateSourceLines: string[] = [];
    predicateSourceLines.push(`const requiredKeys = ${JSON.stringify(requiredKeys)};`);
    predicateSourceLines.push(`const allowed = ${JSON.stringify(allowedObject)};`);
    predicateSourceLines.push(
      "if (typeof value !== \"object\" || value === null || Array.isArray(value)) { return false; }"
    );
    predicateSourceLines.push("const record = value;");
    predicateSourceLines.push("for (const key of requiredKeys) { if (!(key in record)) { return false; } }");
    predicateSourceLines.push("for (const key of Object.keys(allowed)) {");
    predicateSourceLines.push("  if (key in record) {");
    predicateSourceLines.push(
      "    const serialized = JSON.stringify(record[key] ?? null);"
    );
    predicateSourceLines.push("    if (!allowed[key].includes(serialized)) { return false; }");
    predicateSourceLines.push("  }");
    predicateSourceLines.push("}");
    predicateSourceLines.push("return true;");

    const predicateSource = `(value) => {\n  ${predicateSourceLines.join("\n  ")}\n}`;
    console.log("Usage constraint predicate", predicateSource);

    const constraint: Constraint = {
      name,
      description: `Value must match observed InferFromUsage patterns (required keys: ${requiredKeys.join(
        ", "
      ) || "none"})`,
      test: compilePredicate(predicateSource),
      predicateSource,
      source: "inferred",
    };
    registerConstraintPredicate(constraint);
    constraints.push(constraint);
    return constraints;
  }

  const numbers = parseExampleNumbers(component);
  if (numbers && numbers.length > 0) {
    const finiteConstraint: Constraint = {
      name: "isFiniteNumber",
      description: "Value must be a finite number",
      test: (value: unknown) => typeof value === "number" && Number.isFinite(value),
      predicateSource:
        '(value) => typeof value === "number" && Number.isFinite(value)',
      code: "export const isFiniteNumber = (value: unknown): value is number => typeof value === \"number\" && Number.isFinite(value);",
      source: "inferred",
    };
    registerConstraintPredicate(finiteConstraint);
    constraints.push(finiteConstraint);

    if (numbers.every((n) => Number.isInteger(n))) {
      const integerConstraint: Constraint = {
        name: "isIntegerNumber",
        description: "Value must be an integer",
        test: (value: unknown) => typeof value === "number" && Number.isInteger(value),
        predicateSource:
          '(value) => typeof value === "number" && Number.isInteger(value)',
        code: "export const isIntegerNumber = (value: unknown): value is number => typeof value === \"number\" && Number.isInteger(value);",
        source: "inferred",
      };
      registerConstraintPredicate(integerConstraint);
      constraints.push(integerConstraint);
    }

    if (numbers.every((n) => n >= 0)) {
      const nonNegativeConstraint: Constraint = {
        name: "isNonNegativeNumber",
        description: "Value must be non-negative",
        test: (value: unknown) => typeof value === "number" && value >= 0,
        predicateSource:
          '(value) => typeof value === "number" && value >= 0',
        code: "export const isNonNegativeNumber = (value: unknown): value is number => typeof value === \"number\" && value >= 0;",
        source: "inferred",
      };
      registerConstraintPredicate(nonNegativeConstraint);
      constraints.push(nonNegativeConstraint);
    }

    const allEven = numbers.every((n) => Number.isInteger(n) && n % 2 === 0);
    const allOdd = numbers.every((n) => Number.isInteger(n) && Math.abs(n % 2) === 1);
    if (allEven) {
      const evenConstraint: Constraint = {
        name: "isEvenNumber",
        description: "Value must be even",
        test: (value: unknown) => typeof value === "number" && Number.isInteger(value) && value % 2 === 0,
        predicateSource:
          '(value) => typeof value === "number" && Number.isInteger(value) && value % 2 === 0',
        code: "export const isEvenNumber = (value: unknown): value is number => typeof value === \"number\" && Number.isInteger(value) && value % 2 === 0;",
        source: "inferred",
      };
      registerConstraintPredicate(evenConstraint);
      constraints.push(evenConstraint);
    } else if (allOdd) {
      const oddConstraint: Constraint = {
        name: "isOddNumber",
        description: "Value must be odd",
        test: (value: unknown) => typeof value === "number" && Number.isInteger(value) && Math.abs(value % 2) === 1,
        predicateSource:
          '(value) => typeof value === "number" && Number.isInteger(value) && Math.abs(value % 2) === 1',
        code: "export const isOddNumber = (value: unknown): value is number => typeof value === \"number\" && Number.isInteger(value) && Math.abs(value % 2) === 1;",
        source: "inferred",
      };
      registerConstraintPredicate(oddConstraint);
      constraints.push(oddConstraint);
    }

    if (numbers.every((n) => isPrimeCandidate(n))) {
      const primeConstraint: Constraint = {
        name: "isPrimeNumber",
        description: "Value must be prime",
        test: (value: unknown) => typeof value === "number" && isPrimeCandidate(value),
        predicateSource:
          '(value) => { if (typeof value !== "number" || !Number.isInteger(value) || value < 2) return false; for (let factor = 2; factor <= Math.sqrt(value); factor += 1) { if (value % factor === 0) { return false; } } return true; }',
        code: "export const isPrimeNumber = (value: unknown): value is number => { if (typeof value !== \"number\" || !Number.isInteger(value) || value < 2) return false; for (let factor = 2; factor <= Math.sqrt(value); factor += 1) { if (value % factor === 0) { return false; } } return true; };",
        source: "inferred",
      };
      registerConstraintPredicate(primeConstraint);
      constraints.push(primeConstraint);
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
    const constraint: Constraint = {
      name,
      description: def.description || "Heuristic predicate",
      test: predicate,
      predicateSource,
      code: `export const ${name} = ${predicateSource};`,
      source: "heuristic",
    };
    registerConstraintPredicate(constraint);
    constraints.push(constraint);
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

type ComponentContext = {
  component: string;
  baseNumbers: number[];
  baseUsage: Record<string, unknown>[];
  numbers: number[];
  usage: Record<string, unknown>[];
};

function collectComponentContexts(
  typeText: string,
  dependencyTextMap: Map<string, string>
): ComponentContext[] {
  const contexts = new Map<string, { baseNumbers: number[]; baseUsage: Record<string, unknown>[] }>();
  const visitedComponents = new Set<string>();
  const visitedAliases = new Set<string>();

  const visit = (expression: string) => {
    const normalized = normalize(expression);
    if (visitedComponents.has(normalized)) {
      return;
    }
    visitedComponents.add(normalized);

    const numbers = parseExampleNumbers(normalized);
    if (numbers && numbers.length > 0) {
      const entry = contexts.get(normalized) ?? { baseNumbers: [], baseUsage: [] };
      entry.baseNumbers.push(...numbers);
      contexts.set(normalized, entry);
    }

    const usage = parseUsageExamples(normalized);
    if (usage && usage.length > 0) {
      const entry = contexts.get(normalized) ?? { baseNumbers: [], baseUsage: [] };
      entry.baseUsage.push(...usage);
      contexts.set(normalized, entry);
    }

    const aliasMatch = normalized.match(/^[A-Za-z_][A-Za-z0-9_]*$/);
    if (aliasMatch && dependencyTextMap.has(aliasMatch[0]) && !visitedAliases.has(aliasMatch[0])) {
      visitedAliases.add(aliasMatch[0]);
      const aliasSourceText = dependencyTextMap.get(aliasMatch[0])!;
      const tempFileName = `__decohere_alias_expand_${aliasMatch[0]}_${hashText(aliasSourceText).slice(0, 8)}.ts`;
      const tempSource = project.createSourceFile(tempFileName, aliasSourceText, { overwrite: true });
      try {
        const aliasNode = tempSource.getTypeAlias(aliasMatch[0]);
        const typeNode = aliasNode?.getTypeNode();
        if (typeNode) {
          const aliasTypeText = typeNode.getText();
          visit(aliasTypeText);
        }
      } finally {
        tempSource.delete();
      }
    } else {
      for (const part of splitIntersections(normalized)) {
        if (part !== normalized) {
          visit(part);
        }
      }
    }
  };

  visit(typeText);

  return Array.from(contexts.entries()).map(([component, data]) => ({
    component,
    baseNumbers: dedupeNumberList(data.baseNumbers),
    baseUsage: dedupeObjectList(data.baseUsage),
    numbers: dedupeNumberList(data.baseNumbers),
    usage: dedupeObjectList(data.baseUsage),
  }));
}

function collectConstraints(
  typeText: string,
  dependencyTextMap: Map<string, string>,
  visited: Set<string> = new Set(),
  contextAlias?: string
): Constraint[] {
  const unique = new Map<string, Constraint>();
  for (const component of splitIntersections(typeText)) {
    const aliasMatch = component.match(/^[A-Za-z_][A-Za-z0-9_]*$/);
    if (aliasMatch && dependencyTextMap.has(aliasMatch[0]) && !visited.has(aliasMatch[0])) {
      visited.add(aliasMatch[0]);
      const tempFileName = `__decohere_alias_${aliasMatch[0]}_${hashText(component).slice(0, 8)}.ts`;
      const aliasSource = project.createSourceFile(tempFileName, dependencyTextMap.get(aliasMatch[0])!, {
        overwrite: true,
      });
      try {
        const alias = aliasSource.getTypeAlias(aliasMatch[0]);
        const typeNode = alias?.getTypeNode();
        if (typeNode) {
          const innerText = normalize(typeNode.getText());
          for (const constraint of collectConstraints(innerText, dependencyTextMap, visited, aliasMatch[0])) {
            if (!unique.has(constraint.name)) {
              unique.set(constraint.name, constraint);
            }
          }
        }
      } finally {
        aliasSource.delete();
      }
      visited.delete(aliasMatch[0]);
      continue;
    }

    for (const constraint of deriveConstraintsForComponent(component, contextAlias)) {
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
  systemPrompt: string,
  userMessage: string
): Promise<LLMResponse> {
  if (!openai) {
    throw new Error(
      `No local factory registered for "${typeText}" and OPENAI_API_KEY not set. Cannot synthesize value.`
    );
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
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

  return parseLLMResponse(content);
}

/**
 * Generate a test value generator function for fuzzing
 */
async function generateTestGenerator(
  typeText: string,
  selectedValidator: string,
  explanation: string
): Promise<string | null> {
  try {
    if (!openai) {
      globalLogger.warn(`No OpenAI configured, skipping generator generation`);
      return null;
    }

    globalLogger.debug(`Generating test generator for ${typeText}`);

    const { buildGeneratorPrompt } = require("./lib/llm");
    const prompt = buildGeneratorPrompt(typeText, selectedValidator, explanation);

    const messages = [
      { role: "system" as const, content: "You are an expert test data generator. Generate JavaScript generator functions that produce diverse valid test values. Return ONLY the function code, no markdown or explanation." },
      { role: "user" as const, content: prompt },
    ];

    const completion = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
    });

    let source = completion.output_text?.trim();
    if (!source) {
      globalLogger.warn(`LLM returned empty generator for ${typeText}`);
      return null;
    }

    // Clean up markdown if present
    if (source.startsWith("```")) {
      source = source.replace(/^```(?:javascript|js)?\s*/i, "").replace(/```$/i, "").trim();
    }

    globalLogger.info(`Generated test generator for ${typeText}`, { sourceLength: source.length });
    return source;
  } catch (error) {
    globalLogger.warn(`Failed to generate test generator`, { error: String(error), typeText });
    return null;
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
    const mustConstraints = baseConstraints.filter((constraint) => constraint.source === "inferred");
    const suggestedPatterns = baseConstraints.filter((constraint) => constraint.source !== "inferred");
    const heuristicsLibrary = buildHeuristicLibrarySnippet(accumulatedHeuristics);

    // Load available helpers from registry
    const availableHelpers = Object.values(helperRegistry);
    const availablePredicatePatterns = Object.values(predicateRegistry).map(entry => entry.predicateSource);

    // Set up logging context
    globalLogger.setContext({ typeText, attempt, phase: "synthesis", component: "llm" });
    globalLogger.debug(`Building prompt for type`, {
      mustConstraints: mustConstraints.length,
      suggestedPatterns: suggestedPatterns.length,
      availableHelpers: availableHelpers.length,
      availablePredicates: availablePredicatePatterns.length,
    });

    // Build enhanced prompt context
    const promptContext: PromptContext = {
      typeText,
      context,
      summary,
      mustConstraints,
      suggestedPatterns,
      heuristicsLibrary,
      attempt,
      feedback,
      availableHelpers,
      availablePredicatePatterns,
    };

    // Build system and user prompts using new modules
    const systemPrompt = buildSystemPrompt(true);
    const userMessage = buildUserMessage(promptContext);

    globalLogger.debug(`Calling LLM`);
    const response = await callLLM(typeText, systemPrompt, userMessage);
    const model = openai?.apiKey ? "gpt-4.1-mini" : "unknown";

    if (response.explanation === "__INFEASIBLE__") {
      globalLogger.warn(`LLM returned infeasible`, { explanation: response.explanation });
      attempts.push({ attempt, model, feedback, explanation: response.explanation });
      globalAuditLog.recordValidation(typeText, attempt, false, ["Infeasible"], "Constraint set appears infeasible");
      feedback =
        "The constraint set is satisfiable. Please generalize beyond given examples and try another candidate.";
      continue;
    }

    // Rank candidates using multi-dimensional scoring
    const candidateValidators = response.candidateValidators ?? [];
    let selectedCandidates: HeuristicDefinition[] = [];
    let rankedCandidates: HeuristicDefinition[][] = [];
    let candidateSelectionAudit: CacheEntry["candidateSelectionAudit"] | undefined;

    if (candidateValidators.length > 0) {
      // Convert response candidates to HeuristicDefinition format
      const candidates: HeuristicDefinition[] = candidateValidators.map((candidate, index) => {
        const name = sanitizeIdentifier(candidate.name || `candidate_${index + 1}`);
        return {
          name,
          description: candidate.description || "Candidate validator",
          predicate: candidate.predicate,
        };
      });

      // Rank candidates based on complexity, coverage, and reusability
      globalLogger.debug(`Ranking ${candidates.length} candidates`);
      const ranked = rankCandidates(candidates, accumulatedConstraints, []);

      // Select best candidate(s) with confidence threshold
      if (ranked.length > 0) {
        const best = ranked[0];
        const isConfident = isConfidentCandidate(best, 0.6);

        selectedCandidates = [best.candidate];
        rankedCandidates = ranked.map(score => [score.candidate]);

        // Log ranking details
        globalLogger.info(`Candidate ranking`, {
          total: ranked.length,
          bestName: best.candidate.name,
          bestScore: (best.totalScore * 100).toFixed(1) + "%",
          confident: isConfident,
        });

        // Record audit information
        const selectionReason = isConfident
          ? `High confidence (${(best.totalScore * 100).toFixed(1)}%)`
          : `Best of available (${(best.totalScore * 100).toFixed(1)}% confidence)`;

        globalAuditLog.recordCandidateSelection(typeText, attempt, ranked, 0, best.totalScore, selectionReason);

        // Store audit in cache
        candidateSelectionAudit = {
          attempt,
          selectedCandidateIndex: 0,
          selectedCandidateName: best.candidate.name,
          candidateScores: ranked.map(score => ({
            name: score.candidate.name,
            totalScore: score.totalScore,
            complexityScore: score.complexityScore,
            coverageScore: score.coverageScore,
            reusabilityScore: score.reusabilityScore,
          })),
          confidence: best.totalScore,
          selectionReason,
        };

        if (!isConfident) {
          feedback = `Best candidate only ${(best.totalScore * 100).toFixed(1)}% confident. Try other approaches.`;
        }
      }
    }

    const { constraints: heuristicConstraints, normalized } = compileHeuristics(response.heuristics);
    accumulatedConstraints = mergeConstraintSets(accumulatedConstraints, heuristicConstraints);
    accumulatedHeuristics = mergeHeuristicDefs(accumulatedHeuristics, normalized);
    const candidates: HeuristicDefinition[][] = rankedCandidates.length > 0 ? rankedCandidates : [normalized];

    globalLogger.debug(`Validating synthesized value`);
    const validation = validateValue(accumulatedConstraints, response.value);
    if (validation.ok) {
      globalLogger.info(`Validation passed`, { attempt });
      globalAuditLog.recordValidation(typeText, attempt, true);
      attempts.push({ attempt, model, feedback, explanation: response.explanation });
      return {
        value: response.value,
        model,
        attempts,
        heuristics: accumulatedHeuristics,
        constraints: accumulatedConstraints,
        candidateValidators: candidates,
        candidateSelectionAudit,
      };
    }

    attempts.push({ attempt, model, feedback, explanation: response.explanation });
    const errorSummary = validation.errors.join("; ");
    globalLogger.warn(`Validation failed`, { attempt, errors: errorSummary });
    globalAuditLog.recordValidation(typeText, attempt, false, validation.errors);
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
  const globalComponentResolvedTypes = new Map<string, string>();

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expressionText = call.getExpression().getText();
    if (expressionText !== "Decohere" && expressionText !== "testIsType") {
      continue;
    }

    const typeArgument = call.getTypeArguments()[0];
    if (!typeArgument) {
      throw new Error("Decohere<T>() and testIsType<T>() require a type argument");
    }

    const typeArgumentRaw = typeArgument.getText();
    const typeText = normalize(typeArgumentRaw);
    const dependencies = collectDeclarationFingerprints(typeArgument, typeChecker);
    const fingerprint = computeTypeFingerprint(typeText, dependencies);
    const cacheKey = makeCacheKey(typeText);
    const cachePath = join(CACHE_DIR, `${cacheKey}.json`);

    numberExampleCache.clear();
    usageExampleCache.clear();
    const dependencyTextMap = new Map<string, string>();
    for (const dep of dependencies) {
      dependencyTextMap.set(dep.name, dep.text);
    }

    if (typeText === "Sandwich") {
      console.log("Dependencies for Sandwich", Array.from(dependencyTextMap.entries()));
    }

    const componentContexts = collectComponentContexts(typeText, dependencyTextMap);

    for (const context of componentContexts) {
      if (openai && (context.numbers.length > 0 || context.usage.length > 0)) {
        const augmented = await augmentExampleSets(
          context.component,
          context.numbers,
          context.usage,
          dependencyTextMap
        );
        context.numbers = augmented.numbers;
        context.usage = augmented.usage;
      }
      if (context.numbers.length > 0) {
        numberExampleCache.set(context.component, context.numbers);
      }
      if (context.usage.length > 0) {
        usageExampleCache.set(makeUsageCacheKey(context.component, undefined), context.usage);
      }
    }

    const componentResolvedTypes = new Map<string, string>();
    for (const context of componentContexts) {
      const resolved = resolveComponentType(context.component, context.baseNumbers, context.baseUsage);
      if (resolved) {
        componentResolvedTypes.set(context.component, resolved);
      }
    }

    componentResolvedTypes.forEach((value, key) => {
      globalComponentResolvedTypes.set(key, value);
    });

    const allExampleNumbers = dedupeNumberList(componentContexts.flatMap((ctx) => ctx.numbers));
    const allUsageExamples = dedupeObjectList(componentContexts.flatMap((ctx) => ctx.usage));

    let derivedConstraints: Constraint[] = [];
    let heuristicDefs: HeuristicDefinition[] = [];
    let heuristicConstraints: Constraint[] = [];

    derivedConstraints = collectConstraints(typeText, dependencyTextMap);

    const resolvedTypeExpression = collapseTypeExpression(typeText, componentResolvedTypes);

    const cachedResult = materializeFromCache(cachePath, fingerprint, derivedConstraints, typeText);
    if (cachedResult) {
      heuristicDefs = cachedResult.entry.heuristics ?? [];
      heuristicConstraints = cachedResult.heuristicConstraints;
    }

    if (expressionText === "Decohere") {
      let value: unknown;
      let model = "cache";
      let attempts: CacheEntry["attempts"] = [];

      if (cachedResult) {
        value = cachedResult.entry.value;
        model = cachedResult.entry.model ?? "cache";
        attempts = cachedResult.entry.attempts ?? [];
      } else {
        const contextSnippet = buildContextSnippet(
          typeText,
          dependencies,
          allExampleNumbers,
          allUsageExamples,
          derivedConstraints
        );
        const existingConstraints = mergeConstraintSets(derivedConstraints, heuristicConstraints);

        globalLogger.info(`Synthesizing value for type`);
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
          resolvedType: resolvedTypeExpression,
          candidateSelectionAudit: synthesized.candidateSelectionAudit,
        };
        saveCacheEntry(cachePath, entry);
        globalLogger.info(`Saved cache for type`);
        console.log(`Cached decoherence for "${typeText}" at ${cachePath}`);

        // Generate test generator for Prime type (experimental fuzzing)
        console.log(`[Generator] Checking type: "${typeText}" (resolvedType: "${resolvedTypeExpression}")`);
        if (typeText.includes("Prime") || resolvedTypeExpression === "Prime") {
          console.log(`[Generator] Matched Prime! Attempting generation...`);
          const selectedValidator = synthesized.candidateSelectionAudit?.selectedCandidateName || "unknown";
          const explanation = attempts[0]?.explanation || "Prime number validation";
          const generatorSource = await generateTestGenerator(typeText, selectedValidator, explanation);

          if (generatorSource) {
            const generatorPath = join(CACHE_DIR, `Prime_generator.ts`);
            writeFileSync(generatorPath, `// Auto-generated test generator for Prime type\n${generatorSource}\n`, "utf-8");
            console.log(`✨ Generated test generator for Prime at ${generatorPath}`);
          }
        }
      }

      const literal = JSON.stringify(value);
      const replacement = `(${literal} as unknown as ${typeArgumentRaw})`;
      call.replaceWithText(replacement);
      mutations += 1;
      console.log(`Decohere<${typeText}> -> ${literal} (model: ${model})`);

      continue;
    }

    if (expressionText === "testIsType") {
      const argument = call.getArguments()[0];
      if (!argument) {
        throw new Error("testIsType<T>(value) requires a value argument");
      }

      const combinedConstraints = mergeConstraintSets(derivedConstraints, heuristicConstraints);
      const predicateIds = collectPredicateIds(combinedConstraints);
      let replacement: string;
      if (predicateIds.length === 0) {
        console.warn(`No predicates available for testIsType<${typeText}>. Falling back to truthy check.`);
        replacement = `Boolean(${argument.getText()})`;
      } else {
        ensurePredicateImport(sourceFile);
        removeNamedImport(sourceFile, "testIsType");
        const idList = `[${predicateIds.map((id) => JSON.stringify(id)).join(", ")}]`;
        replacement = `evaluatePredicates(${idList}, ${argument.getText()})`;
      }
      call.replaceWithText(replacement);
      mutations += 1;
      console.log(`testIsType<${typeText}> -> ${predicateIds.length} predicate(s)`);
    }
  }

  if (mutations === 0) {
    console.warn("No Decohere<T>() calls found. Nothing to do.");
  }

  for (const alias of sourceFile.getTypeAliases()) {
    const typeNode = alias.getTypeNode();
    if (!typeNode) {
      continue;
    }
    const currentText = typeNode.getText();
    const collapsed = collapseTypeExpression(currentText, globalComponentResolvedTypes);
    if (normalize(collapsed) === normalize(currentText)) {
      continue;
    }
    typeNode.replaceWithText(collapsed);
  }

  const outputPath = join(PROJECT_ROOT, OUTPUT_FILE);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, sourceFile.getFullText(), "utf8");
  persistPredicateRegistry();
  persistHelperRegistry();
  console.log(`Wrote ${OUTPUT_FILE} with ${mutations} materialized value(s).`);
}

async function main(): Promise<void> {
  // Allow specifying source file via CLI arg or env var
  const sourceFile =
    process.argv[2] ||                              // CLI arg: npm run decohere src/myfile.ts
    process.env.DECOHERE_SOURCE_FILE ||            // Env var
    "examples/playground.ts";                       // Default fallback

  // Compute output file: src/foo.ts → src/foo.decohered.ts
  const ext = sourceFile.lastIndexOf(".");
  OUTPUT_FILE = ext > 0
    ? sourceFile.slice(0, ext) + ".decohered.ts"
    : sourceFile + ".decohered.ts";

  console.log(`[decohere] Processing: ${sourceFile}`);
  console.log(`[decohere] Output: ${OUTPUT_FILE}`);
  await processFile(sourceFile);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
