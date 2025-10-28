# Rhizome CLI Guide

The rhizome CLI provides distributed, interconnected course design—clear, small, reversible steps for managing personas, flight plans, and project workflows.

## Quick Reference

Run `rhizome -h` to see all available commands.

## Core Commands

### Flight Plans
- `rhizome flight` — Flight Plan (lightweight planning)

### Personas
- `rhizome persona` — Show rhizomeUNA persona (one clear page)
- `rhizome persona-list` — List all available personas (user + repo)
- `rhizome persona-show` — Show persona details
- `rhizome persona-sprout` — Create a new repo-level persona
- `rhizome persona-init` — Create a course-specific persona scaffold
- `rhizome persona-adopt` — Seed UNA memories with core lessons
- `rhizome persona-merge` — Compile effective persona (capsule + course + overlays)
- `rhizome persona-commands` — Show commands stewarded by a persona

### Memory & Notes
- `rhizome memory-load` — Print rhizomeUNA memory (kitchen notes)
- `rhizome memory-append` — Append a note to rhizomeUNA memory (quick jot)

### Queries & Dispatch
- `rhizome query` — Query with optional persona context
- `rhizome run` — Natural language dispatcher - delegates to persona experts

### Registry & Config
- `rhizome registry` — Manage central rhizome registry
- `rhizome config` — Manage rhizome configuration

### Action Tracking
- `rhizome record` — Record an action (leave a breadcrumb)
- `rhizome link-commit` — Link the latest commit into action log
- `rhizome watch` — Watch edits; log actions. Optional story hints.

### Graph & Export
- `rhizome graph-config` — Show graph logging config (where links go)
- `rhizome graph-mirror` — Set graph mirror path (repo-tracked)

### Utilities
- `rhizome init` — Lay out .rhizome/ and discovery — safe to rerun
- `rhizome export` — Export persona/actions/graph/plan (leave a tidy trail)
- `rhizome brand` — Show public UNA brand links (shareable)
- `rhizome policy` — Show/accept UNA policy (plain words)
- `rhizome context` — Manage legacy .local_context backups (external)
- `rhizome web` — Open a small local planning page

## Project Structure

```
.rhizome/
├── flight_plans/          # Flight plan definitions and state
│   ├── active.json        # Pointer to active flight plan
│   └── fp-*.json          # Individual flight plan files
├── @hallie/               # User-specific rhizome data
├── una/                   # UNA persona memories
└── RHIZOME_CLI_GUIDE.md   # This file
```

## Common Workflows

### Check Active Flight Plan
```bash
rhizome flight --show
```

### View Flight Plan Status
The active flight plan is tracked in `.rhizome/flight_plans/active.json` and contains:
- Steps with status (pending, in_progress, completed)
- Personas involved (una, bro, root, etc.)
- Approval state
- Project phase and transitions

### Add a Note to Memory
```bash
rhizome memory-append "Your note here"
```

### Export Current State
```bash
rhizome export
```

## Notes for Developers

- `.rhizome/` is git-tracked to maintain project continuity
- Flight plans use JSON format for easy parsing and version control
- Personas can be repo-specific or user-specific (under `@hallie/`)
- Use `rhizome init` safely to reinitialize or update structure
