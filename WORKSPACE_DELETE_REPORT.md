# Workspace Delete Feature Report

## Problem
Users could not delete workspaces. Stale workspaces with `status: "error"` (e.g., "src - zip - error") remained in the dropdown and the frontend kept calling `GET /api/workspaces/:id/tree` for them, returning 400 errors.

---

## Backend Changes

### New API Endpoint

| Method | Path | Controller | Action |
|--------|------|------------|--------|
| DELETE | `/api/workspaces/:id` | `deleteWorkspace` | Deletes workspace folder from disk (if exists) + removes DB record |

### Controller: `deleteWorkspace` (`workspace.controller.js`)

```javascript
export async function deleteWorkspace(req, res) {
  // 1. Find workspace by id
  // 2. Try to rm -rf the rootPath folder (ignore if missing)
  // 3. Delete DB record via findByIdAndDelete
  // 4. Return { success: true }
}
```

Key behaviors:
- Does **not** fail if the disk folder does not exist — uses `try/catch` around `fs.rm` with `force: true`
- Works for any workspace status (`ready`, `error`, `creating`)
- Logs `[WorkspaceCleanup] Deleted workspace <id> (<name>)`

### Route (`workspace.routes.js`)

```javascript
router.delete("/:id", controller.deleteWorkspace);
```

---

## Frontend Changes

### AgentWorkspace.jsx

#### New function: `deleteSelectedWorkspace()`
- Called when the 🗑 button is clicked
- Shows `window.confirm` dialog with workspace name
- Calls `DELETE /api/workspaces/:id`
- Marks workspace ID in `staleWorkspaceIdsRef` (prevents re-selection)
- Clears `sessionStorage("lastAgentRunId")`
- Removes workspace from local `workspaces` state
- Clears `selectedWorkspaceId`
- Shows error message: "Workspace deleted. Please upload or select another workspace."

#### Tree polling fixes
1. **Effect skip for error status** — Before calling `loadTree`, checks if `ws.status === "error"`. If so, marks as stale and clears selection.
2. **Effect skip for missing workspace** — Already handled by previous fix (`!ws` check).
3. **Initial load skip** — `loadInitialData` now filters auto-selection to `w.status !== "error"` in addition to `!staleWorkspaceIdsRef.current.has(w.id)`.
4. **400/404 in loadTree** — Already handled by previous fix (marks stale + clears selection).

### AgentHub.jsx

- Added 🗑 button in workspace selector row with same delete logic inline
- Disabled when no workspace selected
- Shows `window.confirm` before delete
- Removes workspace from local state, clears selection, shows success message

### AgentWorkspace.css / AgentHub.css

| Class | Purpose |
|-------|---------|
| `.workspace-selector-row` | Flex row containing select + delete button |
| `.btn-delete-workspace` | Icon button with red hover state |
| `.btn-delete-workspace:disabled` | Reduced opacity, not-allowed cursor |

---

## Files Changed

| File | Change |
|------|--------|
| `backend/src/modules/workspace/workspace.controller.js` | Added `deleteWorkspace` export |
| `backend/src/modules/workspace/workspace.routes.js` | Added `DELETE /:id` route |
| `frontend/src/pages/AgentWorkspace.jsx` | Added `deleteSelectedWorkspace` function, 🗑 button in workspace picker, `status === "error"` guard in tree effect + initial load |
| `frontend/src/pages/AgentWorkspace.css` | Added `.workspace-selector-row`, `.btn-delete-workspace` |
| `frontend/src/pages/AgentHub.jsx` | Added 🗑 button in workspace selector with inline delete logic |

---

## Test Steps

### 1. Delete a ready workspace
1. Open AgentWorkspace or AgentHub
2. Select a workspace from the dropdown
3. Click the 🗑 delete button
4. Confirm in the dialog
5. ✅ Workspace removed from dropdown
6. ✅ Selected workspace cleared
7. ✅ Disk folder deleted (check storage/workspaces/<id>/)
8. ✅ DB record deleted

### 2. Delete an error workspace (e.g., "src - zip - error")
1. A workspace with `status: "error"` appears in the dropdown
2. Select it (or it auto-appears)
3. Click 🗑 delete button
4. ✅ Workspace removed
5. ✅ No /tree call is made for it (effect guard intercepts before loadTree)

### 3. Delete workspace with missing disk folder
1. Manually delete a workspace's folder from disk
2. Delete it via the frontend
3. ✅ Backend `fs.rm` silently fails (no crash), DB record deleted

### 4. Tree does not poll deleted IDs
1. Delete a workspace
2. It is added to `staleWorkspaceIdsRef`
3. On next load or re-render, auto-selection skips it
4. ✅ No repeated 400/404 calls

### 5. AgentHub delete button
1. Go to AgentHub
2. Select a workspace
3. Click 🗑 beside the selector
4. ✅ Same behavior as AgentWorkspace — workspace removed, selection cleared
