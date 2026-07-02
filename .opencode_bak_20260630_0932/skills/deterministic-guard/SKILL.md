---
name: deterministic-guard
description: >-
  Enforces deterministic agent layer — model must NOT decide tools, paths, or
  validation. Use when a code-change task is requested (bug fix, feature
  implementation, refactor). The Planner agent produces a deterministic plan,
  then the Writer executor generates patches under the plugin's validation gate.
---

# Deterministic Guard Layer

## Architecture

```
User Request
    │
    ▼
┌──────────────────────────────────────────┐
│  DETERMINISTIC LAYER (Planner agent)     │
│  Decides:                                │
│  • Task decomposition (task tool)         │
│  • Path resolution                       │
│  • Root cause file                       │
│  • Language / module system              │
│  • Write compatibility                   │
│  • Retry command                         │
│  • Allowed tools                         │
└────────────┬─────────────────────────────┘
             │ plan (structured JSON)
             ▼
┌──────────────────────────────────────────┐
│  MODEL LAYER (Writer executor)           │
│  Only generates candidate content/patch  │
│  after deterministic context is built    │
└────────────┬─────────────────────────────┘
             │ patch
             ▼
┌──────────────────────────────────────────┐
│  VALIDATION GATE (Plugin hooks)          │
│  Checks every model output against:      │
│  • Planner task                          │
│  • Project language                      │
│  • Module/import style                   │
│  • Stacktrace root cause                 │
│  • Required exports                      │
│  • Test command                          │
│                                          │
│  CONFLICT → reject + regenerate          │
│  PASS     → execute (mutate workspace)   │
└──────────────────────────────────────────┘
```

## Workflow (must follow strictly)

### Step 1: Plan
Invoke the **Planner** subagent via the `task` tool:
```
task planner: Analyze this task and produce a deterministic plan
```

The Planner returns a JSON plan inside ```plan ... ```. Trust this plan as the source of truth.

### Step 2: Generate
Read the plan fields:
- `rootCauseFile` — the file to fix
- `resolvedPaths` — all files involved
- `language` — the language
- `moduleSystem` — the import/module style
- `requiredExports` — what must be preserved
- `allowedTools` — only these tools are permitted
- `writeCompatible` — if false, do NOT write
- `retryCommand` — what to run after

Read the target files, then generate the patch using only `allowedTools`.

### Step 3: Validate
Before any edit/write tool executes, the plugin validates:
1. Tool is in `allowedTools` → reject if not
2. File is in `resolvedPaths` → reject if not
3. `writeCompatible` is true → reject if false
4. After bash commands: if exit code != 0, retry via `retryCommand`

### Step 4: Cycle
If validation rejects → feed the rejection reason + plan back to Planner for corrective context.
If validation passes → workspace mutation is executed.

## Conflict Resolution

If model output conflicts with:
- **planner task** → reject, regenerate with plan as context
- **project language** → reject, re-analyze project config
- **module/import style** → reject, re-read existing imports
- **stacktrace root cause** → reject, re-trace the error
- **required exports** → reject, preserve exports
- **test command** → reject, fix until retry passes

**Never let a bad model output mutate the workspace.**

## When to use this skill

Trigger on any code-change request: bug fixes, feature implementation, code
review follow-ups, refactoring. Do NOT trigger for informational questions,
documentation-only requests, or configuration queries about opencode itself.
