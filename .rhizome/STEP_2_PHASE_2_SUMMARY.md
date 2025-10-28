# Step 2 Phase 2: LLM & Candidate Selection Integration

**Status:** ✅ Complete & Tested
**Tests:** 126 passing (no regressions)
**Build:** All 7 examples still working
**Integration:** Full pipeline end-to-end

---

## What Was Integrated

### 1. Simplified LLM Call Interface

**Before:**
```typescript
await callLLM(
  typeText,
  context,
  summary,
  mustConstraints,
  suggestedPatterns,
  heuristicsLibrary,
  attempt,
  feedback
)
```

**After:**
```typescript
await callLLM(typeText, systemPrompt, userMessage)
```

The function now:
- Takes pre-built messages as parameters
- Delegates prompt construction to modules
- Focuses only on API communication
- Handles JSON parsing via `parseLLMResponse()`

**Location:** tooling/decohere-build.ts:1949-1979 (31 lines, down from 87)

### 2. Enhanced Prompt Building in `synthesizeValue()`

#### Step 1: Load Registries
```typescript
const availableHelpers = Object.values(helperRegistry);
const availablePredicatePatterns = Object.values(predicateRegistry)
  .map(entry => entry.predicateSource);
```

#### Step 2: Build Context
```typescript
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
```

#### Step 3: Generate Prompts
```typescript
const systemPrompt = buildSystemPrompt(true);  // Include helper context
const userMessage = buildUserMessage(promptContext);
const response = await callLLM(typeText, systemPrompt, userMessage);
```

### 3. Candidate Ranking Pipeline

**New ranking flow:**
```
LLM Response Candidates
  ↓
Convert to HeuristicDefinition[]
  ↓
rankCandidates() - Score all candidates
  ├─ Complexity (simplicity of predicate)
  ├─ Coverage (constraint satisfaction)
  └─ Reusability (pattern generalizability)
  ↓
selectBestCandidate() - Pick top candidate
  ↓
isConfidentCandidate() - Check if > 60% confidence
  ├─ Yes: Use best candidate
  └─ No: Set feedback for retry
```

**Code:**
```typescript
const candidates: HeuristicDefinition[] = candidateValidators.map((candidate, index) => ({
  name: sanitizeIdentifier(candidate.name || `candidate_${index + 1}`),
  description: candidate.description || "Candidate validator",
  predicate: candidate.predicate,
}));

const ranked = rankCandidates(candidates, accumulatedConstraints, []);
if (ranked.length > 0) {
  const best = ranked[0];
  const isConfident = isConfidentCandidate(best, 0.6);

  rankedCandidates = ranked.map(score => [score.candidate]);

  if (!isConfident) {
    feedback = `Best candidate only ${(best.totalScore * 100).toFixed(1)}% confident. Try other approaches.`;
  }
}
```

### 4. Integration Points

#### Module Imports
```typescript
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
```

#### Existing Dependencies
- ✅ Helper registry (already existed, now used)
- ✅ Predicate registry (already existed, now used)
- ✅ `buildConstraintSummary()` (still used for summary)
- ✅ `buildHeuristicLibrarySnippet()` (still used, local copy)
- ✅ `validateValue()` (unchanged validation)

---

## Key Improvements

| Aspect | Before | After |
|--------|--------|-------|
| Prompt Building | Inline in callLLM | Modular via buildUserMessage |
| Helper Context | Not passed to LLM | Full registry available |
| Predicate Patterns | Not shown to LLM | All patterns available |
| Candidate Selection | First-come (no ranking) | Multi-dimensional scoring |
| Confidence Check | None | 60% threshold with feedback |
| Code Complexity | 87 lines in callLLM | 31 lines, cleaner separation |
| Testability | Hard to mock prompts | Direct prompt testing |

---

## Test Results

```
Test Suites: 6 passed, 6 total
Tests:       126 passed, 126 total
  ├─ config.test.ts:             10 tests ✅
  ├─ predicates.test.ts:         20 tests ✅
  ├─ utils.test.ts:              35 tests ✅
  ├─ registry.test.ts:            9 tests ✅
  ├─ llm.test.ts:                27 tests ✅
  └─ candidate-selector.test.ts: 25 tests ✅
```

---

## Build Status

✅ `npm run decohere` - All 7 examples working:
```
Decohere<Even & Prime> -> 2 (model: gpt-4.1-mini)
Decohere<Even> -> 2 (model: gpt-4.1-mini)
Decohere<Prime> -> 2 (model: gpt-4.1-mini)
Decohere<MysteryType & GreaterThanX<100> & Even> -> 102 (model: gpt-4.1-mini)
Decohere<Sandwich> -> {"bread":"rye",...} (model: gpt-4.1-mini)
Decohere<Hotdog> -> {"bread":"hotdog bun",...} (model: gpt-4.1-mini)
Decohere<Pasta> -> {"sauce":"tomato",...} (model: gpt-4.1-mini)
```

---

## Commit

```
91e9290 Step 2 Phase 2: Integrate LLM & Candidate Selection Modules
  - Refactored callLLM to use buildUserMessage()
  - Updated synthesizeValue with PromptContext
  - Added rankCandidates integration
  - Load available helpers and predicates
  - Multi-dimensional candidate scoring
  - Confidence threshold checking
  - All 126 tests passing
```

---

## Architecture Benefits

### 1. Separation of Concerns
- **llm.ts**: Handles prompt construction
- **candidate-selector.ts**: Handles ranking logic
- **decohere-build.ts**: Handles orchestration
- Clear module boundaries

### 2. Extensibility
- Easy to add new scoring dimensions
- Helper registry grows automatically
- Predicate patterns discovered incrementally
- Confidence thresholds configurable per call

### 3. Maintainability
- Shorter, clearer functions
- Prompt building testable in isolation
- Candidate ranking logic reusable elsewhere
- Less code duplication

### 4. Debuggability
- Helper/predicate context visible in logs
- Ranking scores and reasoning attached
- Confidence feedback in retry loop
- Detailed attempt history

---

## Next Steps

### Step 2 Phase 3: Predicate Audit & Logging (~2 hours)
- Add detailed predicate audit trail
- Track candidate selection decisions
- Enhanced logging for debugging
- Store ranking scores in cache

### Step 3: Selective Regeneration (~1.5 hours)
- Implement cache invalidation logic
- Allow regeneration of specific types
- Preserve candidate rankings across builds

### Step 4: Advanced Features (~TBD)
- Machine learning-based ranking weights
- Custom scoring functions per type
- Predicate pattern learning over time
- Cache-based pattern discovery

---

## Status

**Step 2 is now complete!**

Both Phase 1 (module development) and Phase 2 (integration) are done. The pipeline is now using:
1. ✅ Helper registry for context
2. ✅ Predicate pattern suggestions
3. ✅ Multi-candidate ranking
4. ✅ Confidence-based retry logic

Ready for Phase 3: Predicate Audit & Logging
