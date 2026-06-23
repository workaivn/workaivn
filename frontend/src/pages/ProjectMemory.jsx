import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./ProjectMemory.css";
import { API_BASE_URL } from "../services/api.js";

const API_URL = API_BASE_URL;

const defaultForm = {
  title: "",
  category: "project_context",
  content: "",
  tags: "",
  relatedFiles: "",
  importance: "normal",
  linkedTaskId: ""
};

export default function ProjectMemory() {
  const [memories, setMemories] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedMemory, setSelectedMemory] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    try {
      setLoading(true);
      const [memoriesRes, tasksRes] = await Promise.all([
        axios.get(`${API_URL}/api/project-memory`),
        axios.get(`${API_URL}/api/ai/tasks?limit=50`)
      ]);

      setMemories(memoriesRes.data.data || []);
      setTasks(tasksRes.data.data || []);
      if ((memoriesRes.data.data || []).length > 0) {
        setSelectedMemory(memoriesRes.data.data[0]);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMemoryDetail(memoryId) {
    try {
      const res = await axios.get(`${API_URL}/api/project-memory/${memoryId}`);
      setSelectedMemory(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }

  async function searchMemories() {
    try {
      setLoading(true);
      const url = query.trim()
        ? `${API_URL}/api/project-memory/search?query=${encodeURIComponent(query.trim())}`
        : `${API_URL}/api/project-memory${category ? `?category=${encodeURIComponent(category)}` : ""}`;
      const res = await axios.get(url);
      setMemories(res.data.data || []);
      setSelectedMemory((res.data.data || [])[0] || null);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function createMemory() {
    if (!form.title || !form.content) {
      setError("Title and content are required");
      return;
    }

    try {
      setLoading(true);
      const payload = {
        title: form.title,
        category: form.category,
        content: form.content,
        tags: form.tags.split(",").map(tag => tag.trim()).filter(Boolean),
        relatedFiles: form.relatedFiles.split(",").map(file => file.trim()).filter(Boolean),
        importance: form.importance,
        linkedTasks: form.linkedTaskId ? [form.linkedTaskId] : []
      };

      const res = await axios.post(`${API_URL}/api/project-memory`, payload);
      setMemories(prev => [res.data.data, ...prev]);
      setSelectedMemory(res.data.data);
      setForm(defaultForm);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  const taskOptions = useMemo(() => tasks.map(task => ({ value: task._id, label: task.title })), [tasks]);

  return (
    <div className="memory-page">
      <header className="memory-header">
        <div>
          <h1>Project Memory</h1>
          <p>Store project context, architecture notes, and reusable references.</p>
        </div>
        <button className="btn btn-secondary" onClick={loadInitialData} type="button">
          Refresh
        </button>
      </header>

      {error && <div className="memory-alert">{error}</div>}

      <section className="memory-toolbar">
        <input
          type="text"
          placeholder="Search memories"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All categories</option>
          <option value="project_context">Project Context</option>
          <option value="architecture">Architecture</option>
          <option value="api_docs">API Docs</option>
          <option value="database_schema">Database Schema</option>
          <option value="coding_standards">Coding Standards</option>
          <option value="project_structure">Project Structure</option>
          <option value="dependencies">Dependencies</option>
          <option value="configuration">Configuration</option>
          <option value="issue_tracking">Issue Tracking</option>
          <option value="other">Other</option>
        </select>
        <button className="btn btn-primary" onClick={searchMemories} type="button" disabled={loading}>
          Search
        </button>
      </section>

      <div className="memory-layout">
        <aside className="memory-sidebar">
          <h3>Memories</h3>
          {memories.map(memory => (
            <button
              key={memory._id}
              type="button"
              className={`memory-item ${selectedMemory?._id === memory._id ? "active" : ""}`}
              onClick={() => loadMemoryDetail(memory._id)}
            >
              <strong>{memory.title}</strong>
              <span>{memory.category} • {memory.importance}</span>
            </button>
          ))}
        </aside>

        <main className="memory-detail">
          {selectedMemory ? (
            <>
              <h3>{selectedMemory.title}</h3>
              <div className="memory-meta">
                <span>{selectedMemory.category}</span>
                <span>{selectedMemory.importance}</span>
                <span>{selectedMemory.viewCount || 0} views</span>
              </div>
              <pre className="memory-content">{selectedMemory.content}</pre>
              {selectedMemory.tags?.length > 0 && (
                <div className="memory-tags">
                  {selectedMemory.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
                </div>
              )}
              {selectedMemory.relatedFiles?.length > 0 && (
                <div className="memory-files">
                  <strong>Files:</strong>
                  <ul>
                    {selectedMemory.relatedFiles.map(file => <li key={file}>{file}</li>)}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">No memory selected</div>
          )}
        </main>

        <aside className="memory-form-panel">
          <h3>Create Memory</h3>
          <input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            <option value="project_context">Project Context</option>
            <option value="architecture">Architecture</option>
            <option value="api_docs">API Docs</option>
            <option value="database_schema">Database Schema</option>
            <option value="coding_standards">Coding Standards</option>
            <option value="project_structure">Project Structure</option>
            <option value="dependencies">Dependencies</option>
            <option value="configuration">Configuration</option>
            <option value="issue_tracking">Issue Tracking</option>
            <option value="other">Other</option>
          </select>
          <textarea rows={7} placeholder="Content" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
          <input placeholder="Tags comma-separated" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
          <input placeholder="Related files comma-separated" value={form.relatedFiles} onChange={e => setForm({ ...form, relatedFiles: e.target.value })} />
          <select value={form.importance} onChange={e => setForm({ ...form, importance: e.target.value })}>
            <option value="critical">Critical</option>
            <option value="important">Important</option>
            <option value="normal">Normal</option>
            <option value="reference">Reference</option>
          </select>
          <select value={form.linkedTaskId} onChange={e => setForm({ ...form, linkedTaskId: e.target.value })}>
            <option value="">Link to task (optional)</option>
            {taskOptions.map(task => <option key={task.value} value={task.value}>{task.label}</option>)}
          </select>
          <button className="btn btn-primary" onClick={createMemory} type="button" disabled={loading}>
            {loading ? "Saving..." : "Save Memory"}
          </button>
        </aside>
      </div>
    </div>
  );
}