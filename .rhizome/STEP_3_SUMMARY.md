# Step 3: Predicate Audit & Structured Logging

**Status:** ✅ Complete & Tested
**Tests:** 152 total (26 new tests for audit/logger)
**Build:** All 7 examples working
**Audit Trail:** Full recording system implemented

---

## What Was Built

### 1. Audit Log System (tooling/lib/audit.ts)

**Purpose:** Track predicate discovery, candidate selection, and validation decisions for debugging and analysis.

**Key Classes:**

#### AuditLog
```typescript
class AuditLog {
  recordPredicateDiscovery(id, name, discoveredFrom, confidence, context)
  recordCandidateSelection(typeText, attempt, scores, selectedIndex, confidence, reason)
  recordValidation(typeText, attempt, valid, errors?, feedback?)

  getPredicateAudit(id): PredicateAudit | undefined
  getAllPredicateAudits(): PredicateAudit[]
  getCandidateAudits(typeText): CandidateSelectionAudit[]
  getValidationAudits(typeText): ValidationAudit[]
  getSummary(): AuditSummary
  toJSON(): ExportedData
  clear(): void
}
```

**Data Structures:**

1. **PredicateAudit**
   - `predicateId`: Unique ID
   - `name`: Human-readable name
   - `discoveredAt`: ISO timestamp
   - `discoveredFrom`: Type that discovered it
   - `confidence`: 0-1 confidence score
   - `usageCount`: How many times used
   - `lastUsedAt`: Last usage timestamp
   - `context`: Optional constraint context

2. **CandidateSelectionAudit**
   - `attempt`: Attempt number
   - `candidateRankings`: Full ranking with scores
   - `selectedIndex`: Which one was chosen
   - `selectedName`: Name of selected candidate
   - `selectedScore`: Score of selected
   - `confidence`: Overall confidence
   - `selectionReason`: Why it was selected

3. **ValidationAudit**
   - `attempt`: Attempt number
   - `valid`: Whether it passed
   - `errors`: Any validation errors
   - `feedback`: Feedback for next attempt

**Features:**
- Tracks full audit trail of all decisions
- Increments usage count for repeated predicates
- Updates confidence scores when predicates are reused
- Exports complete audit data as JSON
- Provides summary statistics (success rate, predicate count, etc.)

### 2. Structured Logger (tooling/lib/logger.ts)

**Purpose:** Provide contextual, hierarchical logging with multiple levels and filters.

**Key Classes:**

#### Logger
```typescript
class Logger {
  // Configuration
  setLevel(level: LogLevel)
  setContext(context: LogContext)
  clearContext()
  pushContext(context: LogContext)
  popContext(keys: string[])

  // Logging
  debug(message, data?)
  info(message, data?)
  warn(message, data?)
  error(message, data?)

  // Timers
  startTimer(name)
  endTimer(name, message, level?): number

  // Querying
  getEntries(): LogEntry[]
  getEntriesForType(typeText): LogEntry[]
  getEntriesAtLevel(level): LogEntry[]
  toJSON(): LogEntry[]
  getSummary(): LogSummary
  clear(): void
}
```

**Log Levels (hierarchical):**
- `debug` - Detailed diagnostic info
- `info` - General informational messages
- `warn` - Warning messages
- `error` - Error messages

**Context Types:**
```typescript
interface LogContext {
  typeText?: string;      // Type being processed
  attempt?: number;       // Current attempt
  phase?: string;        // Phase (synthesis, validation, etc.)
  component?: string;    // Component (llm, ranking, etc.)
}
```

**Features:**
- Hierarchical log levels with filtering
- Context stacking for nested operations
- Built-in timer support with automatic duration logging
- Query logs by type or level
- Export as JSON for analysis
- Statistics tracking (counts by level)
- Configurable console output

### 3. Integration into Build Pipeline

#### Enhanced synthesizeValue() Function

**Logging Added:**
```typescript
// Phase setup
globalLogger.setContext({ typeText, attempt, phase: "synthesis", component: "llm" });

// Debug info
globalLogger.debug(`Building prompt for type`, {
  mustConstraints: N,
  suggestedPatterns: N,
  availableHelpers: N,
  availablePredicates: N,
});

// Ranking results
globalLogger.info(`Candidate ranking`, {
  total: N,
  bestName: string,
  bestScore: "X%",
  confident: boolean,
});

// Validation
globalLogger.debug(`Validating synthesized value`);
globalLogger.info(`Validation passed`, { attempt });
globalLogger.warn(`Validation failed`, { attempt, errors });
```

**Audit Recording:**
```typescript
// Candidate selection
globalAuditLog.recordCandidateSelection(
  typeText,
  attempt,
  rankedCandidates,
  selectedIndex,
  confidence,
  selectionReason
);

// Validation
globalAuditLog.recordValidation(typeText, attempt, valid, errors, feedback);
```

#### Enhanced CacheEntry Type

Added `candidateSelectionAudit` field to store:
- Which attempt selected the candidate
- Full ranking information
- Scores for each dimension
- Confidence level
- Why it was selected

#### Cache Persistence

Candidate selection audit data is now saved with cache:
```typescript
const entry: CacheEntry = {
  // ... existing fields
  candidateSelectionAudit: synthesized.candidateSelectionAudit,
};
```

### 4. Global Instances

Both audit and logger are exported as singleton globals:
```typescript
export const globalAuditLog = new AuditLog();
export const globalLogger = new Logger("info", true);
```

**Benefits:**
- No need to pass instances around
- Centralized access from anywhere
- Can be queried after build completes

---

## Test Coverage

### Audit Tests (14 tests)
```
✅ recordPredicateDiscovery
   - New predicate recording
   - Usage count increment
   - Timestamp management

✅ recordCandidateSelection
   - Ranking recording
   - Selection tracking

✅ recordValidation
   - Success recording
   - Failure with errors
   - Feedback storage

✅ getSummary
   - Statistics calculation
   - Success rate

✅ toJSON & clear
   - Export functionality
   - Data cleanup
```

### Logger Tests (12 tests)
```
✅ Logging levels
   - Debug, info, warn, error

✅ Level filtering
   - Only log at/above threshold

✅ Context management
   - Set, push, pop, clear

✅ Data attachments
   - Attach structured data

✅ Timers
   - Start, end, duration logging

✅ Entry filtering
   - By type, by level

✅ Summary & export
   - Statistics
   - JSON export

✅ Dynamic configuration
   - Change level at runtime
```

---

## Test Results

```
Test Suites: 8 passed, 8 total
Tests:       152 passed, 152 total
  ├─ config.test.ts:            10 tests ✅
  ├─ predicates.test.ts:        20 tests ✅
  ├─ utils.test.ts:             35 tests ✅
  ├─ registry.test.ts:           9 tests ✅
  ├─ llm.test.ts:               27 tests ✅
  ├─ candidate-selector.test.ts: 25 tests ✅
  ├─ audit.test.ts:             14 tests ✅ (NEW)
  └─ logger.test.ts:            12 tests ✅ (NEW)
```

---

## Build Status

✅ `npm run decohere` - All 7 examples working
✅ `npm test` - All 152 tests passing
✅ No regressions

---

## Files Created

```
tooling/lib/
├── audit.ts                     (220 lines)
│   - AuditLog class
│   - PredicateAudit interface
│   - CandidateSelectionAudit interface
│   - ValidationAudit interface
│   - globalAuditLog singleton
│
└── logger.ts                    (260 lines)
    - Logger class
    - LogContext interface
    - LogEntry interface
    - globalLogger singleton

tests/
├── audit.test.ts               (120 lines, 14 tests)
│   - Predicate discovery tests
│   - Candidate selection tests
│   - Validation tests
│   - Statistics tests
│
└── logger.test.ts              (160 lines, 12 tests)
    - Level filtering tests
    - Context management tests
    - Timer tests
    - Query tests
```

---

## Architecture Benefits

### 1. Debugging Visibility
- Every decision is logged with context
- Can trace why specific candidates were selected
- Can see validation failures and feedback

### 2. Performance Analysis
- Timer support for duration tracking
- Statistics on success rates
- Can identify bottlenecks in synthesis

### 3. Audit Trail
- Full history of predicate discovery
- When and why candidates were chosen
- Validation results per attempt
- Can replay decisions for analysis

### 4. Structured Output
- Logs can be exported as JSON
- Can be ingested into monitoring systems
- Can generate reports on build health

---

## Usage Examples

### Audit System
```typescript
import { globalAuditLog } from "./lib/audit";

// After build completes, query audit data
const audits = globalAuditLog.getAllPredicateAudits();
console.log(`Discovered ${audits.length} predicates`);

const summary = globalAuditLog.getSummary();
console.log(`Success rate: ${(summary.successRate * 100).toFixed(1)}%`);

// Export for analysis
const json = globalAuditLog.toJSON();
fs.writeFileSync("audit.json", JSON.stringify(json, null, 2));
```

### Logger System
```typescript
import { globalLogger } from "./lib/logger";

// Configure for different levels
globalLogger.setLevel("debug");

// Set context for a section
globalLogger.pushContext({ phase: "synthesis" });
globalLogger.info("Starting synthesis phase");

// Use timers
globalLogger.startTimer("llm_call");
const response = await callLLM(...);
globalLogger.endTimer("llm_call", "LLM call completed");

// Get statistics
const summary = globalLogger.getSummary();
console.log(`Logged ${summary.errorCount} errors`);

// Export logs
const logs = globalLogger.toJSON();
```

---

## Commit

```
91e9290 Step 2 Phase 2: Integrate LLM & Candidate Selection Modules
1566802 Mark Step 2 Phase 2 complete in flight plan, add phase summary
[new] Step 3: Predicate Audit & Structured Logging
  - Added AuditLog for decision tracking
  - Added Logger with context support
  - Enhanced synthesizeValue with audit/logging
  - 26 new tests (14 audit, 12 logger)
  - 152 total tests passing
```

---

## Next Steps

### Phase 4: Cache Audit & Reporting (~2 hours)
- Query cached selection audits
- Generate reports on candidate selection decisions
- Create visualization of ranking decisions
- Track confidence trends over time

### Phase 5: Selective Regeneration (~1.5 hours)
- Use audit trail to determine what needs regeneration
- Cache invalidation based on predicate changes
- Preserve high-confidence candidates across rebuilds

---

## Status

**Step 3 is now complete!**

The build system now has:
1. ✅ Full audit trail of all decisions
2. ✅ Structured logging with context
3. ✅ Performance timing support
4. ✅ Exportable logs and audits
5. ✅ Summary statistics

Ready for Phase 4: Cache Audit & Reporting
