import React, { useEffect, useState } from "react";
import axios from "axios";
import "./AgentWorkspace.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function AgentWorkspace() {
  // DATA STATE
  const [tasks, setTasks] = useState([]);
  const [agents, setAgents] = useState([]);
  const [templates, setTemplates] = useState([]);

  // SELECTION STATE
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);

  // UI STATE
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState("agents");
  const [centerTab, setCenterTab] = useState("prompt");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // FORM STATE
  const [promptText, setPromptText] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskType, setTaskType] = useState("build_feature");

  useEffect(() => {
    loadInitialData();
  }, []);

  // Load selected task's details
  useEffect(() => {
    if (selectedTask) {
      setPromptText(selectedTask.task?.inputPrompt || "");
      setTaskTitle(selectedTask.task?.title || "");
      setTaskType(selectedTask.task?.taskType || "build_feature");
    }
  }, [selectedTask]);

  async function loadInitialData() {
    try {
      setLoading(true);
      const [tasksRes, agentsRes, templatesRes] = await Promise.all([
        axios.get(`${API_URL}/api/ai/tasks?limit=50`),
        axios.get(`${API_URL}/api/ai/agents`),
        axios.get(`${API_URL}/api/ai/prompt-templates`)
      ]);

      setTasks(tasksRes.data.data || []);
      setAgents(agentsRes.data.data || []);
      setTemplates(templatesRes.data.data || []);

      if (tasksRes.data.data?.length > 0) {
        loadTaskDetail(tasksRes.data.data[0]._id);
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

  async function saveTask() {
    if (!selectedTask) return;
    try {
      setLoading(true);
      await axios.put(`${API_URL}/api/ai/tasks/${selectedTask.task._id}`, {
        title: taskTitle,
        inputPrompt: promptText,
        taskType
      });
      setError("Task saved successfully!");
      setTimeout(() => setError(""), 3000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save task");
    } finally {
      setLoading(false);
    }
  }

  async function runTask() {
    if (!selectedTask || !selectedAgent) {
      setError("Select agent first");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post(
        `${API_URL}/api/ai/tasks/${selectedTask.task._id}/run`,
        { agentId: selectedAgent._id }
      );

      if (res.data.success) {
        await loadTaskDetail(selectedTask.task._id);
        setCenterTab("output");
        setError("");
      }
    } catch (err) {
      setError(err.response?.data?.message || "Run failed");
    } finally {
      setLoading(false);
    }
  }

  async function createNewTask() {
    if (!taskTitle || !promptText) {
      setError("Title and prompt required");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post(`${API_URL}/api/ai/tasks`, {
        title: taskTitle,
        inputPrompt: promptText,
        taskType
      });

      setTasks([res.data.data, ...tasks]);
      setSelectedTask({ task: res.data.data, runs: [] });
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create task");
    } finally {
      setLoading(false);
    }
  }

  function useTemplate(templateId) {
    const template = templates.find(t => t._id === templateId);
    if (template) {
      setTaskTitle(template.title);
      setPromptText(template.content);
      setTaskType(template.taskType);
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    setError("Copied!");
    setTimeout(() => setError(""), 2000);
  }

  const filteredTasks = tasks.filter(task =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.taskType.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currentOutput = selectedTask?.runs?.[selectedRunId || 0];

  return (
    <div className="agent-workspace">
      {/* HEADER */}
      <header className="workspace-header">
        <h1>🏢 Agent Workspace</h1>
        <p>Professional environment for AI-assisted development</p>
      </header>

      {/* ERROR ALERT */}
      {error && (
        <div className="workspace-alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>✕</button>
        </div>
      )}

      {/* MAIN LAYOUT */}
      <div className="workspace-container">
        {/* LEFT PANEL - TASKS */}
        <div className={`workspace-panel left-panel ${!leftPanelOpen ? "collapsed" : ""}`}>
          <div className="panel-header">
            <h2>📋 Tasks</h2>
            <button
              className="btn-collapse"
              onClick={() => setLeftPanelOpen(!leftPanelOpen)}
              title="Toggle panel"
            >
              {leftPanelOpen ? "◀" : "▶"}
            </button>
          </div>

          {leftPanelOpen && (
            <>
              <input
                type="text"
                className="search-input"
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />

              <div className="task-list">
                {filteredTasks.length === 0 ? (
                  <p className="empty-state">No tasks found</p>
                ) : (
                  filteredTasks.map(task => (
                    <div
                      key={task._id}
                      className={`task-item ${selectedTask?.task._id === task._id ? "active" : ""}`}
                      onClick={() => loadTaskDetail(task._id)}
                    >
                      <div className="task-title">{task.title}</div>
                      <div className="task-meta">
                        <span className="task-type">{task.taskType}</span>
                        <span className={`task-status status-${task.status}`}>
                          {task.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* CENTER PANEL - EDITOR */}
        <div className="workspace-panel center-panel">
          {/* TAB BUTTONS */}
          <div className="panel-tabs">
            <button
              className={`tab-btn ${centerTab === "prompt" ? "active" : ""}`}
              onClick={() => setCenterTab("prompt")}
            >
              ✏️ Prompt
            </button>
            <button
              className={`tab-btn ${centerTab === "output" ? "active" : ""}`}
              onClick={() => setCenterTab("output")}
            >
              📤 Output
            </button>
            <div className="tab-spacer"></div>
            <button
              className="btn-small"
              onClick={() => saveTask()}
              disabled={!selectedTask || loading}
              title="Save prompt changes"
            >
              💾 Save
            </button>
          </div>

          {/* CONTENT */}
          {centerTab === "prompt" ? (
            <div className="editor-section">
              <div className="form-group">
                <label>Task Title:</label>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  placeholder="Enter task title..."
                />
              </div>

              <div className="form-group">
                <label>Task Type:</label>
                <select
                  value={taskType}
                  onChange={e => setTaskType(e.target.value)}
                >
                  <option value="build_feature">Build Feature</option>
                  <option value="fix_bug">Fix Bug</option>
                  <option value="refactor">Refactor</option>
                  <option value="review">Code Review</option>
                  <option value="documentation">Documentation</option>
                  <option value="phase_plan">Phase Plan</option>
                </select>
              </div>

              <div className="form-group full-height">
                <label>Prompt:</label>
                <textarea
                  className="prompt-editor"
                  value={promptText}
                  onChange={e => setPromptText(e.target.value)}
                  placeholder="Enter your detailed prompt here..."
                />
              </div>

              <div className="button-group">
                {selectedTask?.task._id ? (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={() => saveTask()}
                      disabled={loading}
                    >
                      {loading ? "Saving..." : "💾 Save Changes"}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={() => createNewTask()}
                    disabled={loading}
                  >
                    {loading ? "Creating..." : "✨ Create New Task"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="output-section">
              {!selectedTask?.runs || selectedTask.runs.length === 0 ? (
                <div className="empty-output">
                  <p>No runs yet. Select an agent and click Run.</p>
                </div>
              ) : (
                <>
                  <div className="runs-selector">
                    {selectedTask.runs.map((run, idx) => (
                      <button
                        key={run._id}
                        className={`run-tab ${selectedRunId === idx ? "active" : ""}`}
                        onClick={() => setSelectedRunId(idx)}
                      >
                        <span className={`status status-${run.status}`}></span>
                        {run.agentId?.name || `Run ${idx + 1}`}
                      </button>
                    ))}
                  </div>

                  {currentOutput && (
                    <div className="output-content">
                      {currentOutput.status === "completed" ? (
                        <>
                          <div className="output-header">
                            <span className="agent-name">{currentOutput.agentId?.name}</span>
                            <span className="model-name">{currentOutput.modelName}</span>
                            <span className="completed-time">
                              {new Date(currentOutput.completedAt).toLocaleTimeString()}
                            </span>
                            <button
                              className="btn-small"
                              onClick={() => copyToClipboard(currentOutput.outputText)}
                            >
                              📋 Copy
                            </button>
                          </div>
                          <pre className="output-text">{currentOutput.outputText}</pre>
                        </>
                      ) : currentOutput.status === "error" ? (
                        <div className="output-error">
                          <p>❌ Error</p>
                          <p>{currentOutput.errorMessage}</p>
                        </div>
                      ) : (
                        <div className="output-loading">
                          <p>⏳ {currentOutput.status}</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* RIGHT PANEL - AGENTS/TEMPLATES/RUNS */}
        <div className={`workspace-panel right-panel ${!leftPanelOpen ? "collapsed" : ""}`}>
          <div className="panel-tabs">
            <button
              className={`tab-btn ${rightPanelTab === "agents" ? "active" : ""}`}
              onClick={() => setRightPanelTab("agents")}
            >
              🤖 Agents
            </button>
            <button
              className={`tab-btn ${rightPanelTab === "templates" ? "active" : ""}`}
              onClick={() => setRightPanelTab("templates")}
            >
              📝 Templates
            </button>
            <button
              className={`tab-btn ${rightPanelTab === "runs" ? "active" : ""}`}
              onClick={() => setRightPanelTab("runs")}
            >
              📊 Runs
            </button>
          </div>

          {/* AGENTS TAB */}
          {rightPanelTab === "agents" && (
            <div className="right-panel-content">
              <div className="agents-grid">
                {agents.map(agent => (
                  <div
                    key={agent._id}
                    className={`agent-card ${selectedAgent?._id === agent._id ? "selected" : ""}`}
                    onClick={() => setSelectedAgent(agent)}
                  >
                    <h4>{agent.name}</h4>
                    <p className="agent-model">{agent.modelName}</p>
                    <div className="agent-actions">
                      <button
                        className="btn btn-small btn-primary"
                        onClick={() => {
                          setSelectedAgent(agent);
                          runTask();
                        }}
                      >
                        ▶ Run
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TEMPLATES TAB */}
          {rightPanelTab === "templates" && (
            <div className="right-panel-content">
              <div className="templates-list">
                {templates.map(template => (
                  <div key={template._id} className="template-item">
                    <h4>{template.title}</h4>
                    <p className="template-type">{template.taskType}</p>
                    <button
                      className="btn btn-small"
                      onClick={() => useTemplate(template._id)}
                    >
                      Use
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* RUNS TAB */}
          {rightPanelTab === "runs" && (
            <div className="right-panel-content">
              {!selectedTask?.runs || selectedTask.runs.length === 0 ? (
                <p className="empty-state">No runs yet</p>
              ) : (
                <div className="runs-list">
                  {selectedTask.runs.map((run, idx) => (
                    <div
                      key={run._id}
                      className={`run-item ${selectedRunId === idx ? "active" : ""}`}
                      onClick={() => {
                        setSelectedRunId(idx);
                        setCenterTab("output");
                      }}
                    >
                      <div className="run-header">
                        <span className={`status status-${run.status}`}></span>
                        <span className="run-name">{run.agentId?.name}</span>
                      </div>
                      <div className="run-meta">
                        <span className="run-model">{run.modelName}</span>
                        <span className="run-time">
                          {run.completedAt
                            ? new Date(run.completedAt).toLocaleTimeString()
                            : "..."}
                        </span>
                      </div>
                      {run.outputText && (
                        <div className="run-preview">
                          {run.outputText.substring(0, 100)}...
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
