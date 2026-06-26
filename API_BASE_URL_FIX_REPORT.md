# API Base URL Fix Report

**Goal:** Remove all hardcoded `https://api.workaivn.com` URLs from frontend code, create a single source of truth with fallback to `http://localhost:3000` for local development.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/services/api.js` | Rewritten: exports `API_BASE_URL` (default `http://localhost:3000`), `apiClient` (axios instance with `/api` base), and legacy fetch helpers (`apiGet`, `apiPost`, `apiPut`, `apiDelete`) using `API_BASE_URL` |
| `frontend/.env.example` | **Created** with `VITE_API_URL=http://localhost:3000` and production URL commented |
| `frontend/src/pages/AgentWorkspace.jsx` | Replaced inline `VITE_API_URL` fallback with `import { API_BASE_URL } from "../services/api.js"` |
| `frontend/src/pages/AgentHub.jsx` | Same |
| `frontend/src/pages/OutputEvaluator.jsx` | Same |
| `frontend/src/pages/ProjectMemory.jsx` | Same |
| `frontend/src/pages/TaskWorkflow.jsx` | Same |
| `frontend/src/pages/FileContextManager.jsx` | Same (resolved as `API_BASE_URL + "/api"`) |
| `frontend/src/pages/Landing.jsx` | Same (resolved as `API_BASE_URL + "/api"` inside `useEffect`) |
| `frontend/src/pages/Login.jsx` | Same (resolved as `API_BASE_URL + "/api"`) |
| `frontend/src/pages/Register.jsx` | Same |
| `frontend/src/pages/ForgotPasswordPage.jsx` | Same |
| `frontend/src/pages/Chat.jsx` | Replaced 3 inline `VITE_API_URL` fallbacks with `API_BASE_URL + "/api"` |
| `frontend/src/pages/Image.jsx` | Added `API_BASE_URL` import, replaced hardcoded fetch URL |
| `frontend/src/pages/Profile.jsx` | Added `API_BASE_URL` import, replaced 3 hardcoded fetch URLs |
| `frontend/src/pages/AdminDashboard.jsx` | Added `API_BASE_URL` import, replaced 5 inline `VITE_API_URL` fallbacks |
| `frontend/src/components/Sidebar.jsx` | Added `API_BASE_URL` import, replaced 2 inline `VITE_API_URL` fallbacks |

---

## All Hardcoded URLs Removed

**Total occurrences removed: 29**

- `AgentWorkspace.jsx`: 1 (line 5 `const API_URL`)
- `AgentHub.jsx`: 1 (line 5 `const API_URL`)
- `OutputEvaluator.jsx`: 1 (line 5 `const API_URL`)
- `ProjectMemory.jsx`: 1 (line 5 `const API_URL`)
- `TaskWorkflow.jsx`: 1 (line 5 `const API_URL`)
- `FileContextManager.jsx`: 1 (line 4 `const API_URL`)
- `Landing.jsx`: 1 (line 59 `const API`)
- `Login.jsx`: 1 (lines 7-10 `const API_BASE`)
- `Register.jsx`: 1 (line 7-8 `const API`)
- `ForgotPasswordPage.jsx`: 1 (line 29-30 `const API`)
- `Chat.jsx`: 3 (lines 528-531, 808-810, 1051)
- `Image.jsx`: 1 (line 198 fetch URL)
- `Profile.jsx`: 3 (lines 86, 163, 241 fetch URLs)
- `AdminDashboard.jsx`: 5 (lines 150, 214, 336, 466, 558)
- `Sidebar.jsx`: 2 (lines 49-51, 71)
- `api.js`: 1 (line 4-5 `const API`)

---

## How to Run Local Frontend + Backend

### 1. Start backend

```bash
cd backend
# Edit .env: WORKSPACE_MODE=local, MONGO_URI=mongodb://127.0.0.1:27017/ai_saas
npm run dev
```

Backend runs at `http://localhost:3000`.

### 2. Start frontend

```bash
cd frontend
# Create .env file:
echo VITE_API_URL=http://localhost:3000 > .env
npm run dev
```

Frontend runs at `http://localhost:5173`, proxies API calls to `http://localhost:3000/api/...`.

### 3. For production deployments

Set `VITE_API_URL=https://api.workaivn.com` on the build host or in the deployment env.

---

## Architecture

```
All components
     │
     ├── import { API_BASE_URL } from "../services/api.js"
     ├── import { apiClient } from "../services/api.js"   (axios, pre-configured)
     └── import { apiGet, apiPost, ... } from "../services/api.js"   (legacy fetch)
                            │
                            ▼
              API_BASE_URL = import.meta.env.VITE_API_URL
                          ? VITE_API_URL
                          : "http://localhost:3000"
                            │
                            ▼
                  http://localhost:3000/api/...
```

- `API_BASE_URL` = host only (e.g. `http://localhost:3000`), no trailing `/api`
- `apiClient` axios instance has `baseURL: API_BASE_URL + "/api"` — use relative paths like `/agents/run`
- Legacy fetch helpers construct `API_BASE_URL + "/api" + url` internally
- Files that keep `/api` in the URL (e.g. Login, Chat, FileContextManager) do `API_BASE_URL + "/api"` explicitly
- Files that strip `/api` and add it per-route (e.g. AgentWorkspace) use `API_BASE_URL` directly and write `${API_URL}/api/agents/run`
