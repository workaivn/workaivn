# Task & Run Cleanup Report

## Changes Summary

Added full task and run lifecycle management: delete endpoints, cancel/delete UI buttons, and orphaned task detection.

---

## Backend Changes

### New DELETE routes (`aiagent.routes.js`)

| Method | Path | Controller | Action |
|--------|------|------------|--------|
| DELETE | `/api/ai/tasks/:taskId` | `deleteTask` | Deletes task + all related AgentRuns (cancels active runs first) |
| DELETE | `/api/ai/runs/:runId` | `deleteRun` | Deletes a single run (cancels if active) |

### Controller: `cancelActiveRun` helper

```javascript
function cancelActiveRun(runId) {
  const controller = activeRuns.get(String(runId));
  if (controller) {
    controller.abort();
    activeRuns.delete(String(runId));
  }
}
```

Called by both `deleteTask` (for all runs of the task) and `deleteRun` (for the single run) to ensure the agent loop is aborted before DB deletion.

### Controller: `deleteTask`

- Finds `AgentTask` by `:taskId`
- Cancels all active runs via `activeRuns` Map
- Deletes all `AgentRun` documents with `{ taskId }`
- Deletes the `AgentTask` document
- Returns `{ deletedRuns: count }`

### Controller: `deleteRun`

- Finds `AgentRun` by `:runId`
- Cancels the run if active
- Deletes the `AgentRun` document

### Model: `AgentTask` — added `workspaceId`

```javascript
workspaceId: { type: String, index: true }
```

Stored when tasks are created via `runAgentPrompt`, `runTask`, or `runTaskMultiple`. Enables frontend orphan detection.

### Updated methods to store `workspaceId`

- `runAgentPrompt` — now sets `workspaceId: workspace.id` on the task
- `runTask` — sets `workspaceId: workspace.id` on the task
- `runTaskMultiple` — sets `workspaceId: workspace.id` on the task

---

## Frontend Changes

### New functions in `AgentHub.jsx`

| Function | Trigger | Action |
|----------|---------|--------|
| `cancelTask(taskId)` | Cancel button on running task card or detail | Cancels all running runs for the task via `POST /api/ai/agent-runs/:runId/cancel` |
| `deleteTask(taskId)` | Delete button on task card or detail | Confirms, calls `DELETE /api/ai/tasks/:taskId`, removes from local state |
| `deleteRun(runId)` | Delete button on run history | Confirms, calls `DELETE /api/ai/runs/:runId`, refreshes task detail |

### UI elements added

| Element | Location | Behavior |
|---------|----------|----------|
| ⏹ Cancel button | Task card (when `status === "running"`) | Stops all active runs |
| 🗑 Delete button | Task card (always visible) | Shows `window.confirm`, deletes task + runs |
| ⏹ Cancel button | Task detail header (when `status === "running"`) | Stops all active runs |
| 🗑 Delete button | Task detail header (always visible) | Deletes the task |
| ⏹ Cancel button | Per-run in run history (when `status === "running"`) | Cancels that specific run |
| 🗑 Delete button | Per-run in run history (always visible) | Deletes that specific run |
| "Workspace deleted" badge | Task card (when `workspaceId` not in loaded workspaces) | Shows italic gray text, card has reduced opacity |

### Orphaned task detection

```javascript
const isOrphaned = task.workspaceId && !workspaces.some(w => w.id === task.workspaceId);
```

Detected on every task card render. The `workspaces` array is loaded in `loadInitialData` alongside tasks.

### CSS additions (`AgentHub.css`)

| Class | Purpose |
|-------|---------|
| `.btn-cancel` | Orange cancel button |
| `.btn-delete` | Red delete button |
| `.btn-icon` | Small icon button (16px, no background) |
| `.btn-cancel-icon` | Orange hover for cancel icon |
| `.btn-delete-icon` | Red hover for delete icon |
| `.task-item-header` | Flex row for title + action buttons |
| `.task-item-actions` | Icon button container |
| `.run-actions` | Per-run icon button container |
| `.task-detail-actions` | Action button row in task detail header |
| `.orphaned` | Reduced opacity + gray left border on orphaned task cards |
| `.orphaned-status` | Gray italic "Workspace deleted" text |

---

## Files Changed

| File | Change |
|------|--------|
| `backend/src/models/AgentTask.js` | Added optional `workspaceId` field |
| `backend/src/modules/aiagent/aiagent.controller.js` | Added `deleteTask`, `deleteRun`, `cancelActiveRun`; updated `getTasks`, `runAgentPrompt`, `runTask`, `runTaskMultiple` to track `workspaceId` |
| `backend/src/modules/aiagent/aiagent.routes.js` | Added `DELETE /tasks/:taskId` and `DELETE /runs/:runId` |
| `frontend/src/pages/AgentHub.jsx` | Added cancel/delete functions, orphan detection, cancel/delete buttons in cards + detail + run history |
| `frontend/src/pages/AgentHub.css` | Added styles for cancel/delete/orphaned UI elements |

---

## Testing

1. **Delete a task**: Click 🗑 on any task card → confirm dialog → task + all runs removed from DB and UI
2. **Cancel running task**: Run a task → click ⏹ on running card → runs marked `cancelled`, agent loop aborted
3. **Delete a single run**: In task detail → click 🗑 on a run → run removed, detail refreshed
4. **Cancel a single run**: In task detail while run is running → click ⏹ on that run → run cancelled
5. **Orphaned detection**: Delete a workspace externally → its tasks show "Workspace deleted" badge → user can delete them
