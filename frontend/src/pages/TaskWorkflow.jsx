import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./TaskWorkflow.css";

const API_URL = (import.meta.env.VITE_API_URL || "https://api.workaivn.com/api").replace(/\/api\/api/, "/api").replace(/\/$/, "").replace(/\/api$/, "");

const emptyStep = (order = 1) => ({
  order,
  title: `Step ${order}`,
  agentId: "",
  instruction: ""
});

const defaultForm = {
  title: "",
  description: "",
  sourceTaskId: ""
};

export default function TaskWorkflow() {
  const [workflows, setWorkflows] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [steps, setSteps] = useState([emptyStep(1)]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    try {
      setLoading(true);
      const [workflowRes, taskRes, agentRes] = await Promise.all([
        axios.get(`${API_URL}/api/task-workflows?limit=20`),
        axios.get(`${API_URL}/api/ai/tasks?limit=50`),
        axios.get(`${API_URL}/api/ai/agents`)
      ]);

      setWorkflows(workflowRes.data.data || []);
      setTasks(taskRes.data.data || []);
      setAgents(agentRes.data.data || []);

      if ((workflowRes.data.data || []).length > 0) {
        loadWorkflowDetail(workflowRes.data.data[0]._id);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadWorkflowDetail(workflowId) {
    try {
      const res = await axios.get(`${API_URL}/api/task-workflows/${workflowId}`);
      setSelectedWorkflow(res.data.data);
      setForm({
        title: res.data.data.title || "",
        description: res.data.data.description || "",
        sourceTaskId: res.data.data.sourceTaskId?._id || ""
      });
      setSteps(
        (res.data.data.steps || []).map(step => ({
          _id: step._id,
          order: step.order,
          title: step.title,
          agentId: step.agentId?._id || step.agentId || "",
          instruction: step.instruction || ""
        }))
      );
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }

  function addStep() {
    setSteps(prev => [...prev, emptyStep(prev.length + 1)]);
  }

  function updateStep(index, field, value) {
    setSteps(prev => prev.map((step, currentIndex) => (
      currentIndex === index ? { ...step, [field]: value } : step
    )));
  }

  function removeStep(index) {
    setSteps(prev => prev.filter((_, currentIndex) => currentIndex !== index).map((step, idx) => ({ ...step, order: idx + 1 })));
  }

  async function saveWorkflow() {
    if (!form.title || !form.sourceTaskId || steps.length === 0) {
      setError("Title, source task, and at least one step are required");
      return;
    }

    const payload = {
      title: form.title,
      description: form.description,
      sourceTaskId: form.sourceTaskId,
      steps: steps.map((step, index) => ({
        order: index + 1,
        title: step.title,
        agentId: step.agentId,
        instruction: step.instruction
      }))
    };

    try {
      setLoading(true);
      let res;
      if (selectedWorkflow?._id) {
        res = await axios.put(`${API_URL}/api/task-workflows/${selectedWorkflow._id}`, payload);
      } else {
        res = await axios.post(`${API_URL}/api/task-workflows`, payload);
      }

      await loadInitialData();
      setSelectedWorkflow(res.data.data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function runWorkflow() {
    if (!selectedWorkflow?._id) return;

    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/task-workflows/${selectedWorkflow._id}/run`);
      await loadWorkflowDetail(selectedWorkflow._id);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  const taskOptions = useMemo(() => tasks.map(task => ({ value: task._id, label: task.title })), [tasks]);

  return (
    <div className="workflow-page">
      <header className="workflow-header">
        <div>
          <h1>Task Workflow</h1>
          <p>Chain multiple agents into one sequential delivery flow.</p>
        </div>
        <div className="workflow-actions">
          <button className="btn-secondary" type="button" onClick={addStep}>Add Step</button>
          <button className="btn-primary" type="button" disabled={loading} onClick={saveWorkflow}>
            {loading ? "Saving..." : "Save Workflow"}
          </button>
        </div>
      </header>

      {error && <div className="workflow-alert">{error}</div>}

      <div className="workflow-layout">
        <aside className="workflow-sidebar">
          <h3>Workflows</h3>
          <div className="workflow-list">
            {workflows.map(workflow => (
              <button
                key={workflow._id}
                type="button"
                className={`workflow-item ${selectedWorkflow?._id === workflow._id ? "active" : ""}`}
                onClick={() => loadWorkflowDetail(workflow._id)}
              >
                <strong>{workflow.title}</strong>
                <span>{workflow.status}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="workflow-main">
          <section className="workflow-card">
            <h3>Workflow Builder</h3>
            <div className="form-grid">
              <input placeholder="Workflow title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
              <select value={form.sourceTaskId} onChange={e => setForm({ ...form, sourceTaskId: e.target.value })}>
                <option value="">Select source task</option>
                {taskOptions.map(task => <option key={task.value} value={task.value}>{task.label}</option>)}
              </select>
            </div>
            <textarea rows={4} placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </section>

          <section className="workflow-card">
            <div className="workflow-section-head">
              <h3>Steps</h3>
              <button className="btn-secondary" type="button" onClick={addStep}>+ Step</button>
            </div>

            <div className="step-stack">
              {steps.map((step, index) => (
                <div key={step._id || index} className="step-card">
                  <div className="step-card-head">
                    <strong>Step {index + 1}</strong>
                    <button type="button" className="mini-btn" onClick={() => removeStep(index)}>Remove</button>
                  </div>
                  <input placeholder="Step title" value={step.title} onChange={e => updateStep(index, "title", e.target.value)} />
                  <select value={step.agentId} onChange={e => updateStep(index, "agentId", e.target.value)}>
                    <option value="">Select agent</option>
                    {agents.map(agent => <option key={agent._id} value={agent._id}>{agent.name} ({agent.providerId?.code})</option>)}
                  </select>
                  <textarea rows={5} placeholder="Instruction for this step" value={step.instruction} onChange={e => updateStep(index, "instruction", e.target.value)} />
                </div>
              ))}
            </div>
          </section>
        </main>

        <aside className="workflow-detail">
          <section className="workflow-card">
            <div className="workflow-section-head">
              <h3>Run Result</h3>
              <button className="btn-primary" type="button" disabled={!selectedWorkflow || loading} onClick={runWorkflow}>
                Run
              </button>
            </div>
            <div className="workflow-meta">
              <span>Status: {selectedWorkflow?.status || "draft"}</span>
              <span>Source: {selectedWorkflow?.sourceTaskId?.title || "-"}</span>
            </div>
            <pre className="workflow-output">{selectedWorkflow?.finalOutput || "Run the workflow to see the final output."}</pre>
          </section>

          <section className="workflow-card">
            <h3>Step History</h3>
            <div className="history-list">
              {(selectedWorkflow?.steps || []).map(step => (
                <div key={step._id} className="history-item">
                  <strong>{step.title}</strong>
                  <span>{step.status}</span>
                  {step.outputText && <pre>{step.outputText.slice(0, 160)}</pre>}
                  {step.errorMessage && <p className="error-text">{step.errorMessage}</p>}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}