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

```bash
npm install
```

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
8. **Materialize**: Replace `Decohere<T>()` with concrete value casts

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
