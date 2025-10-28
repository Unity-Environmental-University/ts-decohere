# Step 1: Helper Registry & Single-Line Predicates

## Completed

### 1. Helper Registry Infrastructure

#### Types
```typescript
type HelperCategory = "humanizer" | "validator" | "generator" | "transformer";

type HelperRegistryEntry = {
  id: string;                    // SHA256 hash of source
  name: string;                  // Human-readable name
  description: string;           // Purpose and usage
  category: HelperCategory;      // Helper classification
  source: string;                // Source code string
  signature: string;             // Type signature for LLM
  inputTypes: string[];          // Input parameter types
  outputType: string;            // Return type
};

type HelperRegistry = Record<string, HelperRegistryEntry>;
```

#### Path Constants
- `HELPER_REGISTRY_DIR`: `generated/helpers/`
- `HELPER_REGISTRY_PATH`: `generated/helpers/registry.json`
- `HELPER_INDEX_PATH`: `generated/helpers/index.ts`

#### Functions
- `loadHelperRegistry()` - Load registry from JSON
- `writeHelperRegistryFile()` - Persist registry entries
- `writeHelperIndex()` - Generate TypeScript index module
- `registerHelper()` - Register new helper with deduplication
- `persistHelperRegistry()` - Write both registry and index

#### Generated Files
```
generated/helpers/
├── registry.json          # Persistent store of helper metadata
└── index.ts              # TypeScript interface + invocation API
```

#### Generated API (index.ts)
```typescript
export type HelperEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  execute: (...args: any[]) => any;
};

export const helperEntries: Record<string, HelperEntry> = { ... };

export function getHelperEntry(id: string): HelperEntry | undefined
export function invokeHelper(id: string, ...args: any[]): any
```

---

### 2. Single-Line Predicates

#### Supported Patterns

| Pattern | Example | Description |
|---------|---------|-------------|
| Greater Than | `x > 100` | Numeric value greater than threshold |
| Less Than | `x < 50` | Numeric value less than threshold |
| Greater or Equal | `x >= 0` | Numeric value >= threshold |
| Less or Equal | `x <= 1000` | Numeric value <= threshold |
| Modulo Check | `x % 2 === 0` | Numeric divisibility/remainder |
| Type Check | `typeof x === "number"` | Runtime type validation |
| Array Check | `Array.isArray(x)` | Array type validation |
| String Literal | `x === "value"` | Exact string match |

#### Compiler Function

```typescript
function compileSingleLinePredicate(expression: string):
  ((value: unknown) => boolean) | undefined
```

Parses shorthand expressions and returns executable predicates.

#### Registration Function

```typescript
function registerSingleLinePredicate(
  name: string,
  description: string,
  expression: string
): string | undefined
```

Compiles expression, registers in predicate registry, returns predicate ID.

---

### 3. Integration Points

#### Build Process
- Helper registry is initialized on startup if missing
- Both registries persisted at end of build via `persistHelperRegistry()` and `persistPredicateRegistry()`
- No breaking changes to existing predicate or constraint systems

#### Future Usage
- LLM prompts can include available helpers in context
- Single-line predicates reduce boilerplate for common patterns
- Helpers enable composition of utility functions across types
- Registries enable cross-build discovery and reuse

---

## Architecture Notes

### Helpers vs. Predicates

| Aspect | Predicates | Helpers |
|--------|-----------|---------|
| Purpose | Validation (boolean return) | Utility functions (any return) |
| Usage | Constraint checking via `testIsType<T>()` | Generated code composition |
| Pattern | `(value) => value > 100` | `(input) => computeResult(input)` |
| Storage | Single registry per predicate type | Categorized by helper type |
| Registration | During constraint derivation | During synthesis or manually |

### Caching Strategy
- Both registries use SHA256 hash of source code as ID
- Deduplication prevents duplicate entries
- Dirty flag (`helperRegistryDirty`) tracks changes
- Persistence only occurs if changes detected

### Extensibility
Single-line predicates can be extended by:
1. Adding new regex patterns in `compileSingleLinePredicate()`
2. Registering via `registerSingleLinePredicate()`
3. Helpers are pluggable via `registerHelper()`

---

## Next Steps

- **Step 2**: Prompt updates & multi-candidate validator selection
  - Integrate helper suggestions into LLM prompts
  - Implement candidate validator ranking and selection
  - Add single-line predicate suggestions to LLM

- **Step 3**: Restructure predicate storage and logging
  - Organize helpers by category
  - Add audit trail for helper/predicate decisions
  - Create predicate versioning system

- **Step 4**: Selective cache regeneration & predicate audit workflow
  - Regenerate only affected cache entries
  - Audit trail for which predicates solved which types
  - Feedback loop for improving constraint derivation
