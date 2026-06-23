# Phase 1 + Phase 2 Gap Analysis

**Date:** 2026-06-23
**Auditor:** WorkAI VN Codebase Audit
**Scope:** Backend + Frontend full codebase

---

## Phase 1: Async Agent Run with Polling

### R1.1 — POST /api/agents/run returns immediately with runId

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `backend/src/modules/aiagent/aiagent.controller.js` (`runAgentPrompt`, `runTask`, `executeAgentRun`) |
| **Relevant functions** | `runAgentPrompt()` (line 608), `runTask()` (line 309), `executeAgentRun()` (line 10) |
| **What exists** | All three functions currently await `executeAgentRun()` synchronously inside the HTTP handler. The response is sent only after `runAgentLoop()` finishes (potentially 20+ steps, 5+ minutes). |
| **What is missing** | 1. No immediate return of `{ runId, status }`. 2. No separation between "dispatch" and "execute". 3. The `runAgentPrompt` function at line 608 creates a task, creates a run, then awaits the full loop — the entire HTTP request hangs until completion. |
| **Estimated complexity** | Medium (3-4 files, ~80-120 lines new) |

### R1.2 — Background execution with live AgentRun updates

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `backend/src/modules/aiagent/aiagent.controller.js` (`executeAgentRun`) |
| **Relevant functions** | `executeAgentRun()` (line 10) |
| **What exists** | The function currently calls `runAgentLoop()` with no concurrency wrapper. The run's `status`, `executionEvents`, `toolCalls`, `changedFiles` are only persisted once at the end (lines 84-111). |
| **What is missing** | 1. No `setImmediate()` or queue-based background dispatch. 2. The `onEvent` callback passed to `runAgentLoop` is unused — events are never saved incrementally. 3. No mechanism to detect cancellation mid-run. |
| **Estimated complexity** | Medium (2 files, ~50-70 lines) |

### R1.3 — GET /api/agent-runs/:runId status endpoint

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `backend/src/modules/aiagent/aiagent.routes.js`, `aiagent.controller.js` |
| **What exists** | No route for `/api/agent-runs/:runId`. The only run-fetching route is `GET /api/ai/tasks/:taskId/runs` (which returns all runs for a task, not a single run). The `AgentRun` model at `backend/src/models/AgentRun.js` already stores all needed fields. |
| **What is missing** | 1. New route `GET /api/agent-runs/:runId`. 2. Controller to return run status, currentStep, executionEvents, changedFiles, etc. 3. No existing endpoint returns a single run by its ID. |
| **Estimated complexity** | Low (1 new route + 1 controller, ~30 lines) |

### R1.4 — POST /api/agent-runs/:runId/cancel endpoint

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `backend/src/modules/aiagent/aiagent.routes.js`, `aiagent.controller.js`, `backend/src/agent/runAgentLoop.js` |
| **What exists** | No cancel logic exists anywhere. The `AgentRun` model has no `cancelled` status in its enum. |
| **What is missing** | 1. New route `POST /api/agent-runs/:runId/cancel`. 2. Controller to set run status to `cancelled`. 3. Add `"cancelled"` to `AgentRun` schema status enum. 4. Background loop must check a cancel flag periodically. 5. An in-memory `Map<runId, AbortController>` or similar mechanism. |
| **Estimated complexity** | Medium (3 files, ~60 lines) |

### R1.5 — Frontend polling after Run Agent

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `frontend/src/pages/AgentWorkspace.jsx` (`runAgent`, lines 306-334) |
| **What exists** | `runAgent()` at line 306 calls `POST /api/agents/run` and awaits the full response. On completion it sets `setRun(response.data.data.run)`. No `setInterval`/polling exists. No early return handling. |
| **What is missing** | 1. After POST, immediately setRun with `{ runId, status: "running" }`. 2. Start `setInterval` of 1500ms to poll `GET /api/agent-runs/:runId`. 3. Stop polling when status is terminal. 4. Handle page refresh by restoring polling for existing running runs. 5. No `useRef` for interval cleanup. |
| **Estimated complexity** | Medium (1 file, ~60-80 lines) |

### R1.6 — UI progress display while running

**Status: PARTIALLY_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `frontend/src/pages/AgentWorkspace.jsx` (`ExecutionSummary`, lines 50-133) |
| **What exists** | `ExecutionSummary` component renders toolCalls, changedFiles, patches, errors, quality gate, and final summary. But it only renders the FINAL state, not incremental updates. |
| **What is missing** | 1. The component must accept partial/incremental data from polling. 2. Add a "current step" / "current tool" indicator. 3. Show a spinner while status is "running". 4. Append events live as they arrive from polling. 5. The component currently expects a complete `run` object — needs to handle partial `{ status, currentStep, toolCalls, executionEvents }` objects. |
| **Estimated complexity** | Medium (1 file, ~50-70 lines) |

### R1.7 — No "Request timed out" for in-progress runs

**Status: PARTIALLY_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `frontend/src/pages/AgentWorkspace.jsx` (lines 327-332), `backend/src/modules/aiagent/aiagent.controller.js` |
| **What exists** | Frontend catches errors in the `catch` block and displays `err.response?.data?.message || err.message`. If the request times out or the backend dies mid-request, this will show as an error. There is no distinction between "POST failed before creating run" vs "backend is still running". |
| **What is missing** | 1. POST must return immediately with `runId`. 2. Only if POST itself fails (no `runId` received) should timeout be shown. 3. After receiving `runId`, all progress is from polling, not from the original request. |
| **Estimated complexity** | Low (implicit in R1.1 + R1.5) |

### R1.8 — Acceptance: long runs work, events visible, refresh recovers

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **What is missing** | All sub-requirements depend on R1.1 through R1.6 being implemented. No mechanism exists to recover polling state after page refresh (no `runId` persisted in URL/state). |
| **Estimated complexity** | Low (additional ~20 lines for URL sync) |

---

## Phase 2: Ollama Local Provider

### R2.1 — Create backend/src/services/adapters/OllamaProviderAdapter.js

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | Does not exist |
| **What exists** | The pattern is well-established: `OpenAIProviderAdapter.js` (67 lines), `GeminiProviderAdapter.js`, `OpenRouterProviderAdapter.js` all follow `AiProviderAdapter.js` base class. |
| **What is missing** | 1. Create `OllamaProviderAdapter.js` extending `AiProviderAdapter`. 2. Use OpenAI-compatible client (`openai` npm package with custom `baseURL`). 3. Read `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`), `OLLAMA_API_KEY` (default `"ollama"`), model from `params.modelName`. 4. For agent mode, enforce JSON-only response via system prompt. 5. Return clean errors if Ollama is unreachable. |
| **Estimated complexity** | Low (1 new file, ~60-80 lines, follows existing pattern) |

### R2.2 — Register "ollama" in provider registry and aiRouter

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `backend/src/services/adapters/index.js` (line 91), `backend/src/services/aiRouter.js` |
| **What exists** | `providerRegistry` in `adapters/index.js` registers 5 adapters: openai, gemini, anthropic, openrouter, manual_external. No "ollama" entry. `aiRouter.js` has hardcoded fallback chain: OpenAI → Gemini → Groq → "Hệ thống AI đang bận". |
| **What is missing** | 1. Import and register `OllamaProviderAdapter` in `adapters/index.js`. 2. `aiRouter.js` should include Ollama in the fallback chain (or accept provider routing from the adapter system). |
| **Estimated complexity** | Low (2 files, ~10-15 lines) |

### R2.3 — Seed provider and agent for Ollama

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `backend/src/scripts/seed-agent-hub.js`, `backend/src/routes/adminai.routes.js` |
| **What exists** | Seed script (line 19-62) and admin seed endpoint (line 14-97) both define 5 providers: openai, gemini, anthropic, openrouter, manual_external. No "ollama" entry. |
| **What is missing** | 1. Add provider: `{ name: "Ollama Local", code: "ollama", type: "api", baseUrl: "http://localhost:11434/v1", apiKeyEnv: "OLLAMA_API_KEY", isActive: true }`. 2. Add a coding agent using Ollama provider: e.g., `{ name: "Ollama Coder", code: "ollama_coder", modelName: "qwen2.5-coder:7b", agentType: "coding" }`. |
| **Estimated complexity** | Low (2 files, ~20 lines) |

### R2.4 — Admin UI for Ollama configuration

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `frontend/src/pages/AdminDashboard.jsx` (`ProvidersTab`, line 208) |
| **What exists** | AdminDashboard has a `ProvidersTab` component that lists providers, allows editing name/code/baseUrl/apiKeyEnv, and has a "Test connection" button. However, the "Test connection" endpoint (`/admin/providers/:id/test`) at `adminai.routes.js:153` only checks if the API key env var exists — it does NOT actually test connectivity. For Ollama (which doesn't need an API key), this would incorrectly fail. |
| **What is missing** | 1. The test endpoint needs to actually call the provider to verify connectivity. For Ollama, it should fetch `{baseUrl}/models`. 2. The admin form needs a note/toggle for "local-only" providers. 3. Base URL field should be editable (currently only name/code/type/apiKeyEnv are exposed in the form). |
| **Estimated complexity** | Medium (2 files, ~40-60 lines) |

### R2.5 — Agent fallback chain with Ollama as last resort

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `backend/src/services/aiRouter.js` (lines 20-58), `backend/src/services/adapters/index.js` |
| **What exists** | `aiRouter.js` has a hardcoded fallback chain: OpenAI (if not free) → Gemini (free) → Groq (emergency). Provider adapters are used by the agent system (`executeAgentRun` at `aiagent.controller.js:68` calls `adapter.run()` directly, not through `aiRouter`). |
| **What is missing** | 1. The agent system (`aiagent.controller.js`) selects the adapter based on `agent.providerId.code` — there is no fallback mechanism if the selected provider fails. 2. To implement "try OpenAI, fallback to Ollama", the `executeAgentRun` function needs to be extended to try multiple adapters in priority order. 3. A provider priority list config or env var would be needed. |
| **Estimated complexity** | Medium-High (2-3 files, ~60-100 lines) |

### R2.6 — Local-only warning when on Render

**Status: NOT_IMPLEMENTED**

| Aspect | Detail |
|--------|--------|
| **Relevant files** | `backend/src/agent/workspace.js` (`isRemoteWorkspaceMode`, line 67), `backend/src/modules/aiagent/aiagent.controller.js` |
| **What exists** | `isRemoteWorkspaceMode()` is available. No warning about Ollama being unavailable on Render exists anywhere. |
| **What is missing** | 1. When `isRemoteWorkspaceMode()` is true and the selected provider is "ollama", the agent run should be rejected with an appropriate message. 2. The frontend AgentWorkspace should show a warning when Ollama is selected in remote mode. |
| **Estimated complexity** | Low (2 files, ~20 lines) |

### R2.7 — Acceptance test (manual verification)

**Status: NOT_IMPLEMENTED**

All manual steps (start Ollama, run model, select provider, run agent, verify changedFiles, confirm no paid quota used) are pending until R2.1-R2.6 are implemented.

---

## Summary

### Phase 1 Completion: **5%**
- R1.1: 0% — NOT_IMPLEMENTED
- R1.2: 0% — NOT_IMPLEMENTED
- R1.3: 0% — NOT_IMPLEMENTED
- R1.4: 0% — NOT_IMPLEMENTED
- R1.5: 0% — NOT_IMPLEMENTED
- R1.6: 15% — ExecutionSummary component exists but only renders final state
- R1.7: 10% — Error handling exists but doesn't distinguish timeout types
- R1.8: 0% — NOT_IMPLEMENTED

### Phase 2 Completion: **3%**
- R2.1: 0% — NOT_IMPLEMENTED
- R2.2: 0% — NOT_IMPLEMENTED
- R2.3: 0% — NOT_IMPLEMENTED
- R2.4: 10% — Admin UI exists but test endpoint doesn't actually test, missing fields
- R2.5: 0% — NOT_IMPLEMENTED
- R2.6: 0% — NOT_IMPLEMENTED
- R2.7: 0% — Acceptance not possible yet

---

## Files Requiring Modification

### Phase 1

| # | File | Reason | Touches |
|---|------|--------|---------|
| 1 | `backend/src/modules/aiagent/aiagent.controller.js` | Rewrite `runAgentPrompt`, `runTask`, `executeAgentRun` for async + add status/cancel endpoints | ~200 lines modified |
| 2 | `backend/src/modules/aiagent/aiagent.routes.js` | Add `GET /agent-runs/:runId`, `POST /agent-runs/:runId/cancel` | ~5 lines added |
| 3 | `backend/src/agent/runAgentLoop.js` | Add cancel-check during tool execution loop, improve `onEvent` callback usage | ~20 lines modified |
| 4 | `backend/src/models/AgentRun.js` | Add `"cancelled"` to status enum | ~1 line modified |
| 5 | `frontend/src/pages/AgentWorkspace.jsx` | Rewrite `runAgent` for polling, update `ExecutionSummary` for live progress | ~100 lines modified |
| 6 | `frontend/src/pages/AgentWorkspace.css` | Optional: spinner animation, pulse effects | ~20 lines added |
| 7 | `frontend/src/services/api.js` | Optional: add `apiGet` helper if not already present for polling | ~5 lines |

### Phase 2

| # | File | Reason | Touches |
|---|------|--------|---------|
| 1 | `backend/src/services/adapters/OllamaProviderAdapter.js` | **NEW** — implement adapter | ~70 lines new |
| 2 | `backend/src/services/adapters/index.js` | Register Ollama adapter | ~3 lines added |
| 3 | `backend/src/services/aiRouter.js` | Add Ollama to fallback chain | ~15 lines added |
| 4 | `backend/src/scripts/seed-agent-hub.js` | Add Ollama provider + coding agent | ~20 lines added |
| 5 | `backend/src/routes/adminai.routes.js` | Update test endpoint to actually test connection, add Ollama to seed | ~30 lines modified |
| 6 | `backend/src/modules/aiagent/aiagent.controller.js` | Add fallback logic in `executeAgentRun`, add local-only guard | ~50 lines modified |
| 7 | `frontend/src/pages/AdminDashboard.jsx` | Expose baseUrl field, add Ollama-specific notes | ~30 lines modified |
| 8 | `frontend/src/pages/AgentWorkspace.jsx` | Show local-only warning when Ollama selected in remote mode | ~15 lines added |

---

## Recommended Implementation Order

### Priority 1 — Phase 1 (Core usability fix)

| Step | Task | Depends On | Est. Time |
|------|------|-----------|-----------|
| 1 | Add `"cancelled"` to AgentRun status enum | Nothing | 5 min |
| 2 | Add in-memory run state map + background dispatch in `aiagent.controller.js` | Step 1 | 2-3 hrs |
| 3 | Add `GET /api/agent-runs/:runId` and `POST /api/agent-runs/:runId/cancel` routes | Step 1 | 1 hr |
| 4 | Add cancel-check in `runAgentLoop.js` | Step 3 | 30 min |
| 5 | Rewrite frontend `runAgent()` for polling + live progress | Steps 2-3 | 2-3 hrs |
| 6 | Update `ExecutionSummary` for incremental display | Step 5 | 1 hr |
| 7 | Persist runId in URL for refresh recovery | Step 5 | 30 min |

### Priority 2 — Phase 2 (Ollama support)

| Step | Task | Depends On | Est. Time |
|------|------|-----------|-----------|
| 1 | Create `OllamaProviderAdapter.js` | Nothing | 1-2 hrs |
| 2 | Register in `adapters/index.js` | Step 1 | 10 min |
| 3 | Add Ollama to seed scripts | Step 2 | 15 min |
| 4 | Update admin test endpoint to actually test connection | Nothing | 30 min |
| 5 | Add Ollama to `aiRouter.js` fallback chain | Step 2 | 20 min |
| 6 | Add provider fallback in `executeAgentRun` | Step 1 | 1-2 hrs |
| 7 | Add local-only guard + frontend warning | Step 1 | 30 min |

---

## Risks and Breaking Changes

### Phase 1 Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Race condition**: Two agents running on the same workspace simultaneously could corrupt files | Data loss, contradictory edits | Require exclusive workspace lock or queue per workspace. Show warning if user tries to run a second agent while one is active. |
| **Memory leak**: Abandoned background runs after server restart | Zombie runs stuck in "running" status | On startup, mark all stale "running"/"queued" runs as "error". Use TTL or timeout for runs. |
| **Polling overhead**: Many clients polling simultaneously | Increased DB load | Add `Cache-Control` headers, consider SSE/WebSocket instead of polling for real-time. For Phase 1, 1500ms interval is fine for <50 concurrent users. |
| **URL-based runId recovery**: Run IDs exposed in URL | Information disclosure if user shares URL | Run IDs are MongoDB ObjectIds + UUIDs in `workspaceId` — non-guessable. Acceptable risk. |
| **Backward compatibility**: Existing clients that expect synchronous POST /api/agents/run | Broken integrations | Keep the synchronous behavior as a fallback if `?sync=true` query param is set, or add a new endpoint and deprecate the old one. |

### Phase 2 Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Ollama not running**: User selects Ollama but hasn't started it | Confusing "provider error" | The adapter should detect connection failure early and return a clear, user-friendly message. Add a "Test connection" button in admin UI. |
| **Model mismatch**: Specified model not pulled in Ollama | Runtime error | The adapter should catch 404 model errors and suggest running `ollama pull <model>`. |
| **JSON mode enforcement**: Ollama models may not always return valid JSON in agent mode | Broken agent loops | Add retry logic in `runAgentLoop.js` (already exists for JSON parse failures). Use a stricter system prompt for Ollama. |
| **Performance**: Local Ollama on low-end hardware may be very slow | Timeouts, frustrated users | Document recommended specs (8GB+ RAM). Add a configurable timeout. |
| **Security**: Exposing Ollama's API (port 11434) if OLLAMA_BASE_URL points to a remote instance | Potential SSRF if user configures a malicious URL | Add URL validation. Only allow `localhost` or `127.0.0.1` by default in remote mode. |
| **Seed duplication**: Running seed script again creates duplicate Ollama entries | UI confusion | Use `findOneAndUpdate` with upsert (already the pattern in `adminai.routes.js` line 30). |
| **Provider fallback complexity**: Provider priority chain requires significant refactoring of `executeAgentRun` | Introduction of bugs in existing provider flow | Phase 2, Step 6 should be done carefully with tests. Consider a simpler approach: just allow user to manually select Ollama, deferring automatic fallback to a future phase. |
