# Workspace Delete for Error State Fix Report

## Problem
Workspaces with `status: "error"` (e.g., missing disk folder after a server restart) appeared in the workspace dropdown but could not be selected. The frontend `useEffect` immediately cleared the selection when `status === "error"`, making it impossible to keep the workspace selected long enough to click the 🗑 delete button.

## Root Causes

1. **Frontend `useEffect` cleared error workspace selection** — Lines 206–210 in `AgentWorkspace.jsx`: when `ws.status === "error"`, the effect called `setSelectedWorkspaceId("")`, removing the selection the user just made.

2. **Backend `listWorkspaces` filtered out error workspaces in remote mode** — The MongoDB query used `status: "ready"`, so error workspaces never appeared in the dropdown at all (only affected remote mode).

3. **Tree fetch for error workspaces** — Even if selection were kept, the effect would attempt `loadTree()` which would fail with a 400 error since `getWorkspaceByPublicId` rejects non-`"ready"` status.

## Changes Made

### Backend: `workspace.controller.js` — `listWorkspaces`

```diff
- { sourceType: { $in: ["zip", "git"] }, status: "ready" }
+ { sourceType: { $in: ["zip", "git"] }, status: { $in: ["ready", "error"] } }
```

Error workspaces now appear in the listing alongside ready workspaces. Users can see stale/error workspaces and select them for deletion.

### Frontend: `AgentWorkspace.jsx` — `useEffect` (workspace selection)

```diff
 if (ws.status === "error") {
-  staleWorkspaceIdsRef.current.add(selectedWorkspaceId);
-  setSelectedWorkspaceId("");
-  setError("This workspace is in error state. Please delete it and re-upload.");
+  setTree([]);
+  setSelectedFile("");
+  setFileContent("");
+  setError("This workspace is in error state. You can delete it and re-upload.");
   return;
 }
```

Changes:
- **No longer clears `selectedWorkspaceId`** — The workspace stays selected so the user can click 🗑 delete
- **No longer adds to `staleWorkspaceIdsRef`** — Error workspaces should remain selectable (only truly missing/deleted workspaces go in stale)
- **Clears the tree** — Since tree can't be fetched for error workspaces
- **Shows actionable message** — "You can delete it and re-upload" instead of the old "Please delete it and re-upload" (which was less actionable since the user couldn't select it)

### No changes needed to:

- **`deleteSelectedWorkspace`** — Already calls `DELETE /api/workspaces/:id` for any selected workspace regardless of status. The `deleteWorkspace` backend controller works with any status.
- **`loadInitialData` auto-selection** — Still skips `status !== "error"` so a ready workspace is auto-selected by default. User manually selects error workspaces.
- **Backend `deleteWorkspace`** — Already handles missing folders via `try/catch` around `fs.rm` before DB deletion.
- **`getWorkspaceByPublicId`** — Unchanged; still rejects non-`"ready"` workspaces for tree/file operations. Error workspaces are for deletion only.
- **`AgentHub.jsx`** — No frontend change needed; its dropdown and delete button work with any workspace ID.
- **Agent execution logic** — Untouched.

## Behavior After Fix

| Action | Before | After |
|--------|--------|-------|
| Select error workspace in dropdown | Selection immediately cleared, error message shown | Selection stays, tree is empty, "You can delete it" message shown |
| Click 🗑 on error workspace | Not possible (selection was cleared) | Works — `DELETE /api/workspaces/:id` called |
| Delete error workspace | N/A | Workspace removed from dropdown, selection cleared, success message |
| Auto-load on page mount | Skips error workspaces (still correct) | Same — ready workspace selected by default |
| Backend list workspaces (remote mode) | Only `status: "ready"` | `status: "ready"` AND `status: "error"` |
| Delete workspace with missing disk folder | Fails if `getWorkspaceByPublicId` throws before reaching delete | Works — `deleteWorkspace` uses `Workspace.findOne({id})` directly, not `getWorkspaceByPublicId` |

## Files Changed

| File | Change |
|------|--------|
| `backend/src/modules/workspace/workspace.controller.js` | `listWorkspaces` filter: `status: "ready"` → `status: { $in: ["ready", "error"] }` |
| `frontend/src/pages/AgentWorkspace.jsx` | `useEffect`: keep error workspace selected, skip tree fetch, show actionable message |

## Test Steps

1. Create a workspace (e.g., upload ZIP)
2. Manually mark it as error in DB or delete its disk folder
3. Reload the AgentWorkspace page
4. ✅ Error workspace appears in dropdown
5. Select the error workspace
6. ✅ "This workspace is in error state. You can delete it and re-upload." message shown
7. ✅ No `/tree` call is made
8. Click 🗑 delete button
9. ✅ Confirm dialog appears
10. ✅ Workspace removed from dropdown
11. ✅ Selection cleared
12. ✅ Backend DB record deleted (query directly to confirm)
13. ✅ If folder existed on disk, it was deleted; if missing, no crash
