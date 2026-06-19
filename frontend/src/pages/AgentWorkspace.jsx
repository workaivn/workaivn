import React, { useEffect, useState } from "react";
import axios from "axios";
import "./AgentWorkspace.css";

const API_URL = (import.meta.env.VITE_API_URL || "https://api.workaivn.com/api").replace(/\/api\/api/, "/api").replace(/\/$/, "").replace(/\/api$/, "");

export default function AgentWorkspace() {
  const [tasks, setTasks] = useState([]);
  const [agents, setAgents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [promptText, setPromptText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedTask) {
      setPromptText(selectedTask.task?.inputPrompt || "");
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

      const loadedTasks = tasksRes.data.data || [];
      setTasks(loadedTasks);
      setAgents(agentsRes.data.data || []);
      setTemplates(templatesRes.data.data || []);

      if (loadedTasks.length > 0) {
        loadTaskDetail(loadedTasks[0]._id);
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
      setError(err.response?.data?.message || err.message);
    }
  }

  async function runSelectedAgent() {
    if (!selectedTask || !selectedAgent) {
      setError("Select an agent first");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post(`${API_URL}/api/ai/tasks/${selectedTask.task._id}/run`, {
        agentId: selectedAgent._id
      });

      if (res.data.success) {
        await loadTaskDetail(selectedTask.task._id);
        setError("");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  function useTemplate(template) {
    setPromptText(template.content || "");
  }

  return (
    <div className="workspace-container">
      <aside className="workspace-left">
        <div className="panel-header">
          <h3>Tasks</h3>
        </div>
        <div className="workspace-list">
          {tasks.map(task => (
            <button
              key={task._id}
              className={`workspace-item ${selectedTask?.task?._id === task._id ? "active" : ""}`}
              onClick={() => loadTaskDetail(task._id)}
              type="button"
            >
              <strong>{task.title}</strong>
              <span>{task.taskType} • {task.status}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="workspace-center">
        <div className="panel-header workspace-center-header">
          <div>
            <h3>Prompt / Editor</h3>
            <p>Three-panel workspace for editing, running, and comparing work.</p>
          </div>
        </div>

        <div className="agent-selector-bar">
          <label className="agent-selector-label">🤖 Chọn Agent:</label>
          <select
            className="agent-selector-select"
            value={selectedAgent?._id || ""}
            onChange={e => {
              const agent = agents.find(a => a._id === e.target.value) || null;
              setSelectedAgent(agent);
            }}
          >
            <option value="">-- Chọn agent để chạy --</option>
            {agents.map(agent => (
              <option key={agent._id} value={agent._id}>
                {agent.name} ({agent.providerId?.code || "?"} · {agent.modelName})
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" type="button" onClick={() => setPromptText(selectedTask?.task?.inputPrompt || "")}>Reset</button>
          <button className="btn btn-primary" type="button" onClick={runSelectedAgent} disabled={loading || !selectedAgent}>
            {loading ? "Running..." : "▶ Run"}
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <textarea
          className="workspace-editor"
          value={promptText}
          onChange={e => setPromptText(e.target.value)}
          placeholder="Edit the selected task prompt here"
        />

        <div className="workspace-preview">
          <h4>Current Prompt</h4>
          <pre>{promptText || "No prompt loaded"}</pre>
        </div>
      </main>

      <aside className="workspace-right">
        <section className="panel-block">
          <h4>Agents</h4>
          <div className="workspace-list compact">
            {agents.map(agent => (
              <button
                key={agent._id}
                className={`workspace-item ${selectedAgent?._id === agent._id ? "active" : ""}`}
                type="button"
                onClick={() => setSelectedAgent(agent)}
              >
                <strong>{agent.name}</strong>
                <span>{agent.providerId?.code} • {agent.modelName}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel-block">
          <h4>Templates</h4>
          <div className="workspace-list compact">
            {templates.map(template => (
              <button
                key={template._id}
                className="workspace-item"
                type="button"
                onClick={() => useTemplate(template)}
              >
                <strong>{template.title}</strong>
                <span>{template.taskType}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel-block">
          <h4>Runs</h4>
          <div className="workspace-runs">
            {selectedTask?.runs?.length ? (
              selectedTask.runs.map(run => (
                <div key={run._id} className="run-card">
                  <div className="run-card-title">{run.agentId?.name || "Agent"}</div>
                  <div className={`run-badge status-${run.status}`}>{run.status}</div>
                </div>
              ))
            ) : (
              <div className="muted">No runs yet</div>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
