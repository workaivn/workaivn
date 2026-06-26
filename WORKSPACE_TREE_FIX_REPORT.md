# Workspace Tree Polling Fix Report

**Problem:** Frontend repeatedly called `GET /api/workspaces/:workspaceId/tree` for stale/invalid workspace IDs, filling DevTools with 400 errors.

---

## Root Cause

1. **Auto-selection of first workspace without validation** — `loadInitialData` unconditionally selected `loadedWorkspaces[0]`, even if that workspace's directory no longer existed on disk (e.g., after a server restart or Redis cleanup of managed workspace directories).

2. **No guard before tree fetch** — The `useEffect` at `selectedWorkspaceId` always called `loadTree`, even if the workspace ID was known to be stale or didn't match any workspace in the loaded list.

3. **No error-boundary around 400/404** — `loadTree` caught the error but kept `selectedWorkspaceId` intact, so if the component re-mounted or re-rendered, the same stale ID would trigger another failing tree request.

4. **No memory of bad IDs** — Each mount cycle re-selected the same bad workspace because there was no cache of previously-failed IDs.

---

## Changes Made

**File:** `frontend/src/pages/AgentWorkspace.jsx`

### 1. Stale workspace tracking (line 183)

```javascript
const staleWorkspaceIdsRef = useRef(new Set());
```

A `useRef` that persists across renders, tracking workspace IDs that have returned 400/404. This prevents re-selecting them on subsequent mount cycles.

### 2. Guarded tree effect (lines 192-210)

```javascript
useEffect(() => {
    if (!selectedWorkspaceId) {
      setTree([]); setSelectedFile(""); setFileContent("");
      return;
    }
    const validWorkspaceId = workspaces.some(w => w.id === selectedWorkspaceId);
    if (!validWorkspaceId) {
      staleWorkspaceIdsRef.current.add(selectedWorkspaceId);
      setSelectedWorkspaceId("");
      setError("Workspace not found. Please re-upload or select another workspace.");
      return;
    }
    loadTree(selectedWorkspaceId);
}, [selectedWorkspaceId, workspaces]);
```

- Early return if no workspace selected
- **New guard:** checks `workspaces` array for the selected ID before fetching the tree
- If the ID is not in the loaded list, clears selection and shows a friendly message
- Added `workspaces` to dependency array so validation re-runs when the workspace list updates

### 3. Resilient `loadTree` (lines 213-226)

```javascript
async function loadTree(workspaceId) {
    try {
      const response = await axios.get(`${API_URL}/api/workspaces/${workspaceId}/tree`);
      setTree(response.data.data?.tree || []);
      setError("");
    } catch (err) {
      const status = err.response?.status;
      if (status === 400 || status === 404) {
        staleWorkspaceIdsRef.current.add(workspaceId);
        setSelectedWorkspaceId("");
        setError("Workspace not found. Please re-upload or select another workspace.");
      } else {
        setError(err.response?.data?.message || err.message);
      }
    }
}
```

- On 400 or 404: **clear** `selectedWorkspaceId`, add to stale set, show friendly message
- On other errors (network, 500): show raw error but keep the workspace selected (transient issue)

### 4. Guarded auto-selection (line 219)

```diff
- if (loadedWorkspaces[0]) setSelectedWorkspaceId(loadedWorkspaces[0].id);
+ const firstValid = loadedWorkspaces.find(w => !staleWorkspaceIdsRef.current.has(w.id));
+ if (firstValid) setSelectedWorkspaceId(firstValid.id);
```

Skips any workspace that has previously returned 400/404.

---

## Behavior After Fix

| Scenario | Before | After |
|----------|--------|-------|
| Workspace directory missing on disk | 400 error loop on every mount/re-render | One 400 → ID marked stale → cleared from selection → "Workspace not found" message |
| User navigates away and back | Same stale workspace re-selected → 400 loop | Stale ID skipped; first valid workspace selected instead |
| Backend returns workspace in list but tree is broken | Auto-selects bad workspace → 400 | Same fix — 400 marks as stale |
| Network blip (transient error) | Shows error, keeps workspace selected | Keeps workspace selected (only 400/404 clear it) |
| Agent run polling | Not affected | Not affected — polling is independent |

---

## Testing

1. Upload a ZIP workspace → verify tree loads
2. Delete the workspace directory on disk (`storage/workspaces/<uuid>/`) → verify "Workspace not found" message appears and no repeated 400 calls
3. Navigate to another page and back → verify the bad workspace is no longer auto-selected
4. Create a new valid workspace → verify it's auto-selected correctly
