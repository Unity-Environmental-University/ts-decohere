# RHIZOME Memories

- 2025-10-28T11:11:39Z — Step 1 Complete: Helper Registry & Single-Line Predicates

Infrastructure Added:
- HelperRegistry type system (HelperCategory, HelperRegistryEntry, HelperRegistry)
- Helper persistence layer (load/write/index functions)
- Single-line predicate compiler supporting: x > N, x < N, x >= N, x <= N, x % N === M, typeof x === 'type', Array.isArray(x), x === 'literal'
- Generated helpers API: getHelperEntry(), invokeHelper() in generated/helpers/index.ts

Build Integration:
- persistHelperRegistry() called at end of build
- Helper and Predicate registries both operational
