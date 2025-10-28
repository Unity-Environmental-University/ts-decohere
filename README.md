# ts-decohere

A TypeScript implementation of quantum-inspired type decoherence - synthesizing runtime values from complex type constraints using LLM-powered heuristic inference.

## What is Decoherence?

In quantum mechanics, decoherence is the process where quantum superposition collapses into a definite state. This project applies that metaphor to TypeScript types: given a complex type constraint (a "superposition" of possibilities), the system "decoheres" it into a concrete runtime value.

The system infers constraints from type expressions, uses LLMs to generate candidate values and reusable heuristics, validates them, and caches the results for reproducibility.

## Features

- **Type-driven value synthesis**: Define complex types with intersections, examples, and constraints - get valid runtime values
- **Heuristic inference**: LLM generates reusable predicates that explain why values satisfy constraints
- **Smart caching**: Fingerprints types and their dependencies to reuse values across builds
- **Constraint composition**: Combine example-based inference (`CohereFromExamples`) with explicit constraints (`GreaterThanX`)
- **Build-time materialization**: Types decohere at build time, not runtime

## Installation

### From GitHub (Pre-1.0)

This package is currently in pre-1.0 development and can be installed directly from GitHub:

```bash
npm install github:Unity-Environmental-University/ts-decohere
```

Or with a specific version tag:
```bash
npm install github:Unity-Environmental-University/ts-decohere#v0.0.1-pre.1
```

### Local Development

```bash
npm install
```

### Setup

Set up your OpenAI API key in `.env`:
```bash
OPENAI_API_KEY=your_key_here
```

## Usage

### Basic Example

```typescript
import { Decohere } from "./src/decoherent";
import type { CohereFromExamples, GreaterThanX } from "./src/decobase";

// Define a complex type constraint
type MysteryNumber = CohereFromExamples<2 | 4 | 6> & GreaterThanX<100>;

// Decohere it into a concrete value
const value = Decohere<MysteryNumber>();
// Result: 102 (even number greater than 100)
```

### Running the Build

```bash
npm run build
```

This processes source files, finds all `Decohere<T>()` calls, synthesizes values, and outputs materialized code.

### Example Output

See `examples/playground.ts` for input and `examples/playground.decohered.ts` for the generated output.

## How It Works

1. **Parse**: Extract type arguments from `Decohere<T>()` calls
2. **Fingerprint**: Hash the type expression and its dependencies
3. **Infer constraints**: Analyze type components for patterns (even/odd, prime, ranges, etc.)
4. **Check cache**: If fingerprint matches, reuse cached value
5. **Synthesize**: Use LLM to generate candidate values and heuristics
6. **Validate**: Test candidates against all constraints
7. **Cache**: Store validated values with their heuristics
8. **Generate**: (Experimental) For complex types, optionally generate test value generators for fuzzing
9. **Materialize**: Replace `Decohere<T>()` with concrete value casts

### Experimental: LLM-Generated Test Generators

For types like `Prime`, the system can optionally generate fuzzing functions that produce diverse valid test values:

```typescript
function* generatePrime() {
  function isPrime(n) {
    if (n < 2) return false;
    for (let i = 2; i <= Math.sqrt(n); i++) {
      if (n % i === 0) return false;
    }
    return true;
  }

  for (let i = 0; i < 100; i++) {
    let candidate = Math.floor(Math.random() * 10000) + 2;
    while (!isPrime(candidate)) {
      candidate++;
    }
    yield candidate;
  }
}
```

This enables property-based testing and better cache seeding with representative values.

## Type Primitives

### `CohereFromExamples<T>`
Infer patterns from example values:
```typescript
type EvenNumbers = CohereFromExamples<2 | 4 | 6 | 8>;
type Primes = CohereFromExamples<2 | 3 | 5 | 7 | 11>;
```

### `InferFromUsage<T>`
Capture structural usage hints from example object/tuple literals:
```typescript
type Sandwich = InferFromUsage<
  [
    { bread: "rye"; meat: "cold cuts"; cheese: "cheddar" },
    { bread: ["rye", "pumpernickle"]; meat: "cold cuts"; cheese: "cheddar" }
  ]
>;
```
The build step analyzes the provided shapes to infer required keys and allowable literal combinations.

### `GreaterThanX<N>`
Explicit numeric constraints:
```typescript
type BigNumber = GreaterThanX<1000>;
type BigEvenNumber = CohereFromExamples<2 | 4> & GreaterThanX<1000>;
```

## Simple Types as Scaffolding

Simple decoherence types (like `Prime`, `Even`) are valid building blocks, not limitations. They work great for straightforward patterns. The key insight: **when a type's inferred predicate stops generalizing** — when new values violate it — that's the signal to escalate to more complex constraint composition.

```typescript
// Start simple
type Prime = CohereFromExamples<2 | 3 | 5 | 7>;
const p = Decohere<Prime>(); // Works: generates a prime

// Later, when you need domain-specific constraints:
type LargePrime = Prime & GreaterThanX<1000>;
type PrimeWithPattern = Prime & CohereFromExamples<11 | 13 | 17 | 19 | 23>; // More specific examples

const lp = Decohere<LargePrime>(); // Automatically composes constraints
```

Complexity emerges naturally where it's needed. Predicates that fail become prompts to refine, not signs to abandon the pattern.

## Configuration

Edit `decohere.config.json`:
```json
{
  "envSearchPaths": [".env", "~/Documents/repos/tools/.env"],
  "factoryCacheDir": "generated/decohere-cache",
  "maxLLMAttempts": 5
}
```

## Project Structure

```
ts-decohere/
├── src/              # Core library
│   ├── decobase.ts      # Type primitives
│   └── decoherent.ts    # Decohere function
├── examples/         # Example usage
│   └── playground.ts
├── tooling/          # Build system
│   └── decohere-build.ts
├── generated/        # Build artifacts (gitignored)
│   └── decohere-cache/
└── decohere.config.json
```

## License

MIT

## Future Development

### Pattern Discovery Enhancements
- The system currently tests example values against known constraints and reports which properties are already captured
- This helps the LLM focus on discovering differential signal (e.g., Fibonacci patterns) beyond basic properties
- Heuristics are accumulated in a reusable library across builds

### Planned Features
- **Complex object types**: Extend beyond primitives to support object shapes, nested structures
- **Array patterns**: Support array types with structural constraints (length, element patterns, relationships)
- **Composite types**: Records, tuples, discriminated unions
- **Relational constraints**: Properties that depend on other properties
- **Custom type primitives**: Extensible system for domain-specific patterns

Example future usage:
```typescript
type User = CohereFromExamples<
  { id: 1, name: "Alice", age: 30 } |
  { id: 2, name: "Bob", age: 25 }
>;

type SortedArray = InferFromMeasurements<[1,2,3] | [5,10,15]> & Ascending;
```

### Runtime Checking Helpers
Use `testIsType<T>(value)` to validate candidate values against inferred constraints without materializing a new sample:
```typescript
import { Decohere, InferFromUsage, testIsType } from "./src/decoherent";

const sandwich = Decohere<InferFromUsage<[{ bread: "rye"; meat: "cold cuts" } ]>>();
const maybeHotdox = { bread: "hotdox bun", meat: "hotdox" };

console.log(testIsType<typeof sandwich>(maybeHotdox)); // false
```
The build step rewrites `testIsType` invocations into the synthesized predicate bundle drawn from derived constraints and cached heuristics.

All synthesized predicates are persisted in `generated/predicates/registry.json` and surfaced through `generated/predicates/index.ts`, so reused shapes stay available across builds without touching core library code.

## Contributing

This is an experimental project exploring the intersection of type systems, constraint solving, and LLM-powered synthesis.
