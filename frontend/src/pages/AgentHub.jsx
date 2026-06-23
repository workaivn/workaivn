import React, { useEffect, useState } from "react";
import axios from "axios";
import "./AgentHub.css";
import { API_BASE_URL } from "../services/api.js";

const API_URL = API_BASE_URL;

export default function AgentHub() {
  const [tab, setTab] = useState("tasks");
  const [providers, setProviders] = useState([]);
  const [agents, setAgents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");

  // Form state
  const [newTaskForm, setNewTaskForm] = useState({
    title: "",
    inputPrompt: "",
    taskType: "build_feature"
  });

  useEffect(() => {
    loadInitialData();
  }, []);



  async function loadInitialData() {
    try {
      setLoading(true);
      setError("");

      const [providersRes, agentsRes, tasksRes, templatesRes, workspacesRes] = await Promise.all([
        axios.get(`${API_URL}/api/ai/providers`),
        axios.get(`${API_URL}/api/ai/agents`),
        axios.get(`${API_URL}/api/ai/tasks?limit=20`),
        axios.get(`${API_URL}/api/ai/prompt-templates`),
        axios.get(`${API_URL}/api/workspaces`)
      ]);

      setProviders(providersRes.data.data || []);
      setAgents(agentsRes.data.data || []);
      setTasks(tasksRes.data.data || []);
      setTemplates(templatesRes.data.data || []);
      const loadedWorkspaces = workspacesRes.data.data || [];
      setWorkspaces(loadedWorkspaces);
      if (loadedWorkspaces[0]) setSelectedWorkspaceId(loadedWorkspaces[0].id);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function createTask() {
    if (!newTaskForm.title || !newTaskForm.inputPrompt) {
      setError("Title and prompt are required");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post(`${API_URL}/api/ai/tasks`, newTaskForm);

      setTasks([res.data.data, ...tasks]);
      setNewTaskForm({ title: "", inputPrompt: "", taskType: "build_feature" });
      setError("");

      // Switch to tasks tab
      setTab("tasks");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function runTask(taskId, agentId) {
    if (!selectedWorkspaceId) {
      setError("Please create or select a workspace first.");
      return;
    }
    try {
      setLoading(true);
      const res = await axios.post(`${API_URL}/api/ai/tasks/${taskId}/run`, {
        agentId,
        workspaceId: selectedWorkspaceId
      });

      if (res.data.success) {
        // Refresh task detail
        await loadTaskDetail(taskId);
        setError("");
      } else {
        setError(res.data.message || "Failed to run task");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function runTaskWithMultipleAgents(taskId) {
    if (selectedAgents.length === 0) {
      setError("Select at least one agent");
      return;
    }
    if (!selectedWorkspaceId) {
      setError("Please create or select a workspace first.");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post(`${API_URL}/api/ai/tasks/${taskId}/run-multiple`, {
        agentIds: selectedAgents,
        workspaceId: selectedWorkspaceId
      });

      if (res.data.success) {
        await loadTaskDetail(taskId);
        setSelectedAgents([]);
        setError("");
      } else {
        setError(res.data.message || "Failed to run agents");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function cancelTask(taskId) {
    if (!window.confirm("Cancel all active runs for this task?")) return;
    try {
      const task = tasks.find(t => t._id === taskId);
      if (!task) return;
      const runs = selectedTask?.runs?.filter(r => r.status === "running") || [];
      for (const run of runs) {
        await axios.post(`${API_URL}/api/ai/agent-runs/${run._id}/cancel`);
      }
      await loadTaskDetail(taskId);
      setSuccessMsg("Task runs cancelled");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }

  async function deleteTask(taskId) {
    if (!window.confirm("Delete this task and all its runs? This cannot be undone.")) return;
    try {
      await axios.delete(`${API_URL}/api/ai/tasks/${taskId}`);
      setTasks(prev => prev.filter(t => t._id !== taskId));
      if (selectedTask?.task._id === taskId) setSelectedTask(null);
      setSuccessMsg("Task deleted");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }

  async function deleteRun(runId) {
    if (!window.confirm("Delete this run?")) return;
    try {
      await axios.delete(`${API_URL}/api/ai/runs/${runId}`);
      if (selectedTask) {
        await loadTaskDetail(selectedTask.task._id);
      }
      setSuccessMsg("Run deleted");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }

  async function compareSelectedRuns(taskId) {
    if (selectedRunIds.length < 2) {
      setError("Select at least 2 runs to compare");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post(`${API_URL}/api/ai/tasks/${taskId}/compare`, {
        runIds: selectedRunIds
      });

      if (res.data.success) {
        setComparison(res.data.data);
        setError("");
      } else {
        setError(res.data.message || "Comparison failed");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTaskDetail(taskId) {
    try {
      const res = await axios.get(`${API_URL}/api/ai/tasks/${taskId}`);
      setSelectedTask(res.data.data);
    } catch (err) {
      console.error("Failed to load task detail:", err);
    }
  }

  function toggleAgentSelection(agentId) {
    setSelectedAgents(prev =>
      prev.includes(agentId)
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    );
  }

  function toggleRunSelection(runId) {
    setSelectedRunIds(prev =>
      prev.includes(runId)
        ? prev.filter(id => id !== runId)
        : [...prev, runId]
    );
  }

  function useTemplate(templateId) {
    const template = templates.find(t => t._id === templateId);
    if (template) {
      setNewTaskForm({
        title: template.title,
        inputPrompt: template.content,
        taskType: template.taskType
      });
      setTab("create");
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    setError("Copied to clipboard!");
    setTimeout(() => setError(""), 2000);
  }



  return (
    <div className="agent-hub-container">
      <header className="agent-hub-header">
        <h1>🤖 AI Agent Hub</h1>
        <p>Run tasks with multiple AI agents and compare results</p>
      </header>

      <nav className="agent-hub-nav">
        <button
          className={`nav-btn ${tab === "tasks" ? "active" : ""}`}
          onClick={() => setTab("tasks")}
        >
          📋 Tasks
        </button>
        <button
          className={`nav-btn ${tab === "create" ? "active" : ""}`}
          onClick={() => setTab("create")}
        >
          ➕ New Task
        </button>
        <button
          className={`nav-btn ${tab === "agents" ? "active" : ""}`}
          onClick={() => setTab("agents")}
        >
          🤖 Agents
        </button>
        <button
          className={`nav-btn ${tab === "templates" ? "active" : ""}`}
          onClick={() => setTab("templates")}
        >
          📝 Templates
        </button>
        <button
          className={`nav-btn ${tab === "providers" ? "active" : ""}`}
          onClick={() => setTab("providers")}
        >
          🔌 Providers
        </button>
      </nav>

      <div className="multi-agent-selector">
        <h4>Project Workspace</h4>
        <div className="workspace-selector-row">
          <select
            value={selectedWorkspaceId}
            onChange={event => setSelectedWorkspaceId(event.target.value)}
          >
            <option value="">-- Select project workspace --</option>
            {workspaces.map(workspace => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name} — {workspace.sourceType || "local"}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-delete-workspace"
            onClick={async () => {
              if (!selectedWorkspaceId) return;
              const ws = workspaces.find(w => w.id === selectedWorkspaceId);
              if (!ws) return;
              if (!window.confirm(`Delete workspace "${ws.name}"? This will remove its files from disk.`)) return;
              try {
                await axios.delete(`${API_URL}/api/workspaces/${selectedWorkspaceId}`);
                setWorkspaces(prev => prev.filter(w => w.id !== selectedWorkspaceId));
                setSelectedWorkspaceId("");
                setSuccessMsg("Workspace deleted");
                setTimeout(() => setSuccessMsg(""), 3000);
              } catch (err) {
                setError(err.response?.data?.message || err.message);
              }
            }}
            disabled={!selectedWorkspaceId}
            title="Delete workspace"
          >
            🗑
          </button>
        </div>
      </div>

      {successMsg && <div className="alert alert-success">{successMsg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="agent-hub-content">
        {/* TASKS TAB */}
        {tab === "tasks" && (
          <div className="tab-content">
            <h2>Tasks</h2>
            {tasks.length === 0 ? (
              <p className="empty-state">No tasks yet. Create one!</p>
            ) : (
              <div className="task-list">
                {tasks.map(task => {
                  const isRunning = task.status === "running";
                  const isOrphaned = task.workspaceId && !workspaces.some(w => w.id === task.workspaceId);
                  return (
                    <div
                      key={task._id}
                      className={`task-item ${selectedTask?.task._id === task._id ? "active" : ""} ${isOrphaned ? "orphaned" : ""}`}
                      onClick={() => {
                        loadTaskDetail(task._id);
                        setCompareMode(false);
                        setComparison(null);
                        setSelectedRunIds([]);
                      }}
                    >
                      <div className="task-item-header">
                        <h3>{task.title}</h3>
                        <div className="task-item-actions">
                          {isRunning && (
                            <button
                              className="btn-icon btn-cancel-icon"
                              title="Cancel task"
                              onClick={event => {
                                event.stopPropagation();
                                cancelTask(task._id);
                              }}
                            >
                              ⏹
                            </button>
                          )}
                          <button
                            className="btn-icon btn-delete-icon"
                            title="Delete task"
                            onClick={event => {
                              event.stopPropagation();
                              deleteTask(task._id);
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                      <p className="task-type">{task.taskType}</p>
                      {isOrphaned ? (
                        <p className="task-status orphaned-status">Workspace deleted</p>
                      ) : (
                        <p className="task-status">Status: {task.status}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {selectedTask && (
              <div className="task-detail">
                <div className="task-detail-header">
                  <div>
                    <h3>{selectedTask.task.title}</h3>
                    <div className="task-meta">
                      <span>Type: {selectedTask.task.taskType}</span>
                      <span>Status: {selectedTask.task.status}</span>
                    </div>
                  </div>
                  <div className="task-detail-actions">
                    {selectedTask.task.status === "running" && (
                      <button
                        className="btn btn-cancel"
                        onClick={() => cancelTask(selectedTask.task._id)}
                      >
                        ⏹ Cancel
                      </button>
                    )}
                    <button
                      className="btn btn-delete"
                      onClick={() => deleteTask(selectedTask.task._id)}
                    >
                      🗑 Delete
                    </button>
                    <button
                      className={`btn btn-toggle ${compareMode ? "active" : ""}`}
                      onClick={() => {
                        setCompareMode(!compareMode);
                        setComparison(null);
                      }}
                    >
                      ⚖️ Compare Mode
                    </button>
                  </div>
                </div>

                {!compareMode && (
                  <>
                    <div className="task-prompt">
                      <h4>Input Prompt:</h4>
                      <div className="prompt-box">{selectedTask.task.inputPrompt}</div>
                      <button
                        className="btn-small"
                        onClick={() => copyToClipboard(selectedTask.task.inputPrompt)}
                      >
                        📋 Copy
                      </button>
                    </div>

                    <div className="multi-agent-selector">
                      <h4>Select Agents to Run:</h4>
                      <div className="agent-checkboxes">
                        {agents.filter(a => a.code !== "auto_coding").map(agent => (
                          <label key={agent._id} className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={selectedAgents.includes(agent._id)}
                              onChange={() => toggleAgentSelection(agent._id)}
                            />
                            {agent.name}
                          </label>
                        ))}
                      </div>
                      <div className="button-group">
                        <button
                          className="btn btn-primary"
                          onClick={() => runTaskWithMultipleAgents(selectedTask.task._id)}
                          disabled={selectedAgents.length === 0 || loading}
                        >
                          {loading ? "Running..." : "▶ Run Selected Agents"}
                        </button>
                      </div>
                    </div>

                    {selectedTask.runs.length > 0 && (
                      <div className="runs-history">
                        <h4>Run History ({selectedTask.runs.length}):</h4>
                        {selectedTask.runs.map(run => (
                          <div key={run._id} className={`run-item status-${run.status}`}>
                            <div className="run-header">
                              <span className="run-agent">{run.agentId?.name}</span>
                              <span className={`status status-${run.status}`}>{run.status}</span>
                              <div className="run-actions">
                                {run.status === "running" && (
                                  <button
                                    className="btn-icon btn-cancel-icon"
                                    title="Cancel run"
                                    onClick={event => {
                                      event.stopPropagation();
                                      (async () => {
                                        try {
                                          await axios.post(`${API_URL}/api/ai/agent-runs/${run._id}/cancel`);
                                          await loadTaskDetail(selectedTask.task._id);
                                          setSuccessMsg("Run cancelled");
                                          setTimeout(() => setSuccessMsg(""), 3000);
                                        } catch (err) {
                                          setError(err.response?.data?.message || err.message);
                                        }
                                      })();
                                    }}
                                  >
                                    ⏹
                                  </button>
                                )}
                                <button
                                  className="btn-icon btn-delete-icon"
                                  title="Delete run"
                                  onClick={event => {
                                    event.stopPropagation();
                                    deleteRun(run._id);
                                  }}
                                >
                                  🗑
                                </button>
                              </div>
                            </div>
                            {run.outputText && (
                              <div className="run-output">
                                <p className="output-length">Output: {run.outputText.length} chars</p>
                                <pre>{run.outputText.substring(0, 300)}...</pre>
                                <button
                                  className="btn-small"
                                  onClick={() => copyToClipboard(run.outputText)}
                                >
                                  📋 Copy Full Output
                                </button>
                              </div>
                            )}
                            {run.errorMessage && (
                              <div className="run-error">
                                <p>Error: {run.errorMessage}</p>
                              </div>
                            )}
                            {(run.changedFiles?.length > 0 || run.toolCalls?.length > 0) && (
                              <div className="run-output">
                                <p><strong>Changed files:</strong> {run.changedFiles?.length || 0}</p>
                                {run.changedFiles?.length > 0 && (
                                  <ul>
                                    {run.changedFiles.map(file => <li key={file}><code>{file}</code></li>)}
                                  </ul>
                                )}
                                <p><strong>Tool calls:</strong> {run.toolCalls?.length || 0}</p>
                                {run.diffSummary?.stat && <pre>{run.diffSummary.stat}</pre>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {compareMode && selectedTask.runs.length >= 2 && (
                  <div className="compare-section">
                    <h4>Select Runs to Compare:</h4>
                    <div className="compare-selection">
                      {selectedTask.runs.filter(r => r.status === "completed").map(run => (
                        <label key={run._id} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={selectedRunIds.includes(run._id)}
                            onChange={() => toggleRunSelection(run._id)}
                          />
                          {run.agentId?.name} ({run.status})
                        </label>
                      ))}
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={() => compareSelectedRuns(selectedTask.task._id)}
                      disabled={selectedRunIds.length < 2 || loading}
                    >
                      ⚖️ Compare {selectedRunIds.length} Runs
                    </button>

                    {comparison && (
                      <div className="comparison-result">
                        <h5>Comparison Results:</h5>
                        <table className="comparison-table">
                          <thead>
                            <tr>
                              <th>Agent</th>
                              <th>Status</th>
                              <th>Output Length</th>
                              <th>Completed At</th>
                              <th>Preview</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comparison.runs.map((run, idx) => (
                              <tr key={idx}>
                                <td>{run.agentName}</td>
                                <td className={`status-${run.status}`}>{run.status}</td>
                                <td>{run.outputLength} chars</td>
                                <td>{run.completedAt ? new Date(run.completedAt).toLocaleTimeString() : "N/A"}</td>
                                <td className="preview-cell">{run.outputPreview}...</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* CREATE TASK TAB */}
        {tab === "create" && (
          <div className="tab-content">
            <h2>Create New Task</h2>
            <form className="create-task-form">
              <div className="form-group">
                <label>Task Title:</label>
                <input
                  type="text"
                  value={newTaskForm.title}
                  onChange={e => setNewTaskForm({ ...newTaskForm, title: e.target.value })}
                  placeholder="e.g., Build login page"
                />
              </div>

              <div className="form-group">
                <label>Task Type:</label>
                <select
                  value={newTaskForm.taskType}
                  onChange={e => setNewTaskForm({ ...newTaskForm, taskType: e.target.value })}
                >
                  <option value="build_feature">Build Feature</option>
                  <option value="fix_bug">Fix Bug</option>
                  <option value="refactor">Refactor</option>
                  <option value="review">Code Review</option>
                  <option value="documentation">Documentation</option>
                  <option value="phase_plan">Phase Plan</option>
                </select>
              </div>

              <div className="form-group">
                <label>Prompt:</label>
                <textarea
                  value={newTaskForm.inputPrompt}
                  onChange={e => setNewTaskForm({ ...newTaskForm, inputPrompt: e.target.value })}
                  placeholder="Describe your task in detail..."
                  rows={8}
                />
              </div>

              <div className="button-group">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={createTask}
                  disabled={loading}
                >
                  {loading ? "Creating..." : "✨ Create Task"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* AGENTS TAB */}
        {tab === "agents" && (
          <div className="tab-content">
            <h2>Available Agents</h2>
            <div className="agents-grid">
              {agents.map(agent => (
                <div key={agent._id} className="agent-card">
                  <h3>{agent.name}</h3>
                  <p className="agent-code">{agent.code}</p>
                  <p className="agent-desc">{agent.description}</p>
                  <div className="agent-tags">
                    {agent.capabilityTags.map(tag => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="agent-model">
                    Model: <strong>{agent.modelName}</strong>
                  </p>
                  <p className="agent-provider">
                    Provider: <strong>{agent.providerId?.code}</strong>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TEMPLATES TAB */}
        {tab === "templates" && (
          <div className="tab-content">
            <h2>Prompt Templates</h2>
            <div className="templates-grid">
              {templates.map(template => (
                <div key={template._id} className="template-card">
                  <h3>{template.title}</h3>
                  <p>{template.description}</p>
                  <p className="template-type">{template.taskType}</p>
                  <button
                    className="btn btn-secondary"
                    onClick={() => useTemplate(template._id)}
                  >
                    Use Template
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PROVIDERS TAB */}
        {tab === "providers" && (
          <div className="tab-content">
            <h2>AI Providers Status</h2>
            <div className="providers-list">
              {providers.map(provider => (
                <div
                  key={provider._id}
                  className={`provider-item ${provider.isConfigured ? "configured" : "not-configured"}`}
                >
                  <h3>{provider.name}</h3>
                  <p className="provider-code">{provider.code}</p>
                  <div className={`status-badge ${provider.isConfigured ? "active" : "inactive"}`}>
                    {provider.isConfigured ? "✅ Configured" : "❌ Not Configured"}
                  </div>
                  {provider.configError && <p className="error-msg">{provider.configError}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
