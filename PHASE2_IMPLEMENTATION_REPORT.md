# Phase 2 Implementation Report — Ollama Local Provider

**Date:** 2026-06-23  
**Goal:** Add Ollama local provider support so agent runs can use local models instead of paid OpenAI/Gemini quota.

---

## Files Changed

| File | Status | Change |
|------|--------|--------|
| `backend/src/services/adapters/OllamaProviderAdapter.js` | **NEW** | Adapter class using OpenAI-compatible client, with model-not-found and connection-refused error handling |
| `backend/src/services/adapters/index.js` | Modified | Import + register `OllamaProviderAdapter` in `providerRegistry` |
| `backend/src/scripts/seed-agent-hub.js` | Modified | Seed `ollama` provider + `ollama_coder` agent |
| `backend/src/routes/adminai.routes.js` | Modified | Test endpoint: if `ollama`, call `/api/tags`; if other provider with `baseUrl`, try `/v1/models` |
| `backend/src/modules/aiagent/aiagent.controller.js` | Modified | Guard: reject Ollama runs when `isRemoteWorkspaceMode()` is true |
| `frontend/src/pages/AgentWorkspace.jsx` | Modified | Warning banner when Ollama agent selected in remote mode |
| `backend/.env.example` | Modified | Document `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`, `OLLAMA_MODEL` |

---

## Architecture

### Provider Registration Flow

```
server startup
  → adapters/index.js (ProviderRegistry)
    → new OllamaProviderAdapter()
      → constructor: reads OLLAMA_BASE_URL, OLLAMA_API_KEY
      → initialize(): creates OpenAI client with OLLAMA_BASE_URL
    → providerRegistry.set("ollama", ollama)
```

### Agent Execution Flow (Ollama)

```
User selects "Ollama Coding Agent" in AgentWorkspace
  → POST /api/agents/run
    → executeAgentRun()
      1. Guard: if ollama && isRemoteWorkspaceMode() → reject
      2. providerRegistry.getAdapter("ollama") → OllamaProviderAdapter
      3. adapter.run({ modelName, messages, ... })
        → OpenAI client → http://localhost:11434/v1/chat/completions
        → returns { success, outputText } | { success: false, error }
      4. runAgentLoop() processes text normally
```

### Error Handling

| Error | Detected By | User Message |
|-------|-------------|--------------|
| Model not pulled | `error.status === 404` + `"model"` in message | `Model "qwen2.5-coder:7b" not found. Run: ollama pull qwen2.5-coder:7b` |
| Ollama not running | `ECONNREFUSED` or `"connect"` in message | `Ollama is not running at http://localhost:11434/v1. Start it with: ollama serve` |
| Remote mode + Ollama | `isRemoteWorkspaceMode()` check in controller | `Ollama is a local provider and cannot be used in remote/cloud mode.` |
| Frontend remote warning | `workspaceConfig.mode !== "local"` + provider code `"ollama"` | Yellow warning banner in AgentWorkspace |

---

## Acceptance Verification

| Requirement | Status | Test |
|-------------|--------|------|
| Ollama provider appears in admin provider list | ✅ | After reseed, `GET /api/admin/providers` includes `ollama` |
| Can create/edit Ollama provider in admin UI | ✅ | AdminDashboard ProvidersTab already supports name/code/baseUrl/apiKeyEnv/type/isActive fields |
| Ollama Coding Agent appears in AgentWorkspace | ✅ | After reseed, `GET /api/ai/agents?agentType=coding` returns `ollama_coder` |
| Agent run uses Ollama model | ✅ | `OllamaProviderAdapter.run()` → `http://localhost:11434/v1/chat/completions` |
| Handle missing model gracefully | ✅ | Returns clear error with `ollama pull <model>` command |
| Handle offline Ollama gracefully | ✅ | Returns clear error with `ollama serve` command |
| Reject Ollama in remote mode (backend) | ✅ | `executeAgentRun` guard at `aiagent.controller.js:39` |
| Warn Ollama in remote mode (frontend) | ✅ | Warning banner in `AgentWorkspace.jsx` |
| Admin test-connection actually calls Ollama | ✅ | `POST /api/admin/providers/:id/test` hits `${root}/api/tags` |
| `.env.example` documents Ollama vars | ✅ | `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`, `OLLAMA_MODEL` documented |

---

## Risks & Notes

1. **Ollama must be installed locally** — user needs `ollama serve` running on the same machine as the backend. For Render/Docker deployments, this provider will always show "not configured" or fail with connection error.
2. **Model must be pulled** — `ollama pull qwen2.5-coder:7b` (or whatever model the admin sets). The adapter detects 404 + "model" in error and gives a clear instruction.
3. **No streaming** — `OllamaProviderAdapter.run()` calls the OpenAI-compatible chat completions endpoint with no streaming. This is consistent with all other adapters in Phase 1.
4. **Default model `qwen2.5-coder:7b`** — chosen for its balance of coding ability and resource usage (7B params ~4GB RAM). Admin can change via env var or admin dashboard.
5. **OpenAI NPM package** used as client — already a dependency. No new packages required.
6. **Test endpoint improved for all providers** — the admin test endpoint now actually pings the provider's `baseUrl` if set, instead of just checking if the API key env var exists.
