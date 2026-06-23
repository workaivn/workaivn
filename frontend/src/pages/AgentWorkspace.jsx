import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./AgentWorkspace.css";
import { API_BASE_URL } from "../services/api.js";

const API_URL = API_BASE_URL;

function TreeNode({ node, selectedPath, onSelect }) {
  const [expanded, setExpanded] = useState(false);

  if (node.type === "folder") {
    return (
      <div className="tree-node">
        <button type="button" className="tree-row folder" onClick={() => setExpanded(value => !value)}>
          <span>{expanded ? "▾" : "▸"}</span>
          <span>📁</span>
          <span>{node.name}</span>
        </button>
        {expanded && (
          <div className="tree-children">
            {(node.children || []).map(child => (
              <TreeNode
                key={`${child.type}:${child.path}`}
                node={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`tree-row file ${selectedPath === node.path ? "active" : ""}`}
      onClick={() => onSelect(node.path)}
    >
      <span className="tree-spacer" />
      <span>📄</span>
      <span>{node.name}</span>
    </button>
  );
}

function ExecutionSummary({ run, onCancel }) {
  if (!run) return null;

  const isRunning = run.status === "running" || run.status === "queued" || run.status === "pending";
  const isTerminal = ["completed", "error", "needs_revision", "cancelled"].includes(run.status);
  const toolCalls = run.toolCalls || [];
  const executionEvents = run.executionEvents || [];
  const filesRead = [...new Set(
    toolCalls
      .filter(call => call.tool === "READ_FILE" && call.success !== false)
      .map(call => call.args?.path || call.result?.file)
      .filter(Boolean)
  )];
  const patches = toolCalls.filter(call => call.tool === "APPLY_PATCH");
  const terminalCommands = toolCalls.filter(call => call.tool === "RUN_TERMINAL");
  const errors = [
    run.errorMessage,
    ...executionEvents
      .filter(event => event.type === "error" || event.type === "failed")
      .map(event => event.message)
  ].filter(Boolean);

  const isCancellable = isRunning && !isTerminal;

  return (
    <section className="execution-summary">
      <div className="summary-heading">
        <h3>Agent result</h3>
        <div className="summary-heading-actions">
          <span className={`run-badge status-${run.status}`}>{run.status}</span>
          {isCancellable && (
            <button type="button" className="btn btn-cancel" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {isRunning && (
        <div className="running-indicator">
          <span className="spinner" />
          <span>
            {run.currentStep > 0 ? `Step ${run.currentStep}` : "Starting..."}
            {run.currentTool ? ` · ${run.currentTool}` : ""}
          </span>
        </div>
      )}

      <div className="summary-grid">
        <div>
          <h4>Files read</h4>
          {filesRead.length
            ? filesRead.map(file => <code key={file}>{file}</code>)
            : <span className="muted">{isRunning ? "Reading files..." : "None"}</span>}
        </div>
        <div>
          <h4>Files changed</h4>
          {run.changedFiles?.length
            ? run.changedFiles.map(file => <code key={file}>{file}</code>)
            : <span className="muted">{isRunning ? "No changes yet" : "None"}</span>}
        </div>
        <div>
          <h4>Patches applied</h4>
          {patches.length
            ? patches.map((call, index) => (
                <code key={`${call.step}-${index}`}>
                  {call.args?.file} · {call.success ? "OK" : "Failed"}
                </code>
              ))
            : <span className="muted">{isRunning ? "Waiting..." : "None"}</span>}
        </div>
        <div>
          <h4>Terminal commands</h4>
          {terminalCommands.length
            ? terminalCommands.map((call, index) => (
                <code key={`${call.step}-${index}`}>{call.args?.command}</code>
              ))
            : <span className="muted">{isRunning ? "Waiting..." : "None"}</span>}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="summary-errors">
          <h4>Errors</h4>
          {errors.map((error, index) => <div key={`${error}-${index}`}>{error}</div>)}
        </div>
      )}

      {run.qualityGate && Object.keys(run.qualityGate).length > 0 && (
        <div className={run.qualityGate.passed ? "summary-final" : "summary-errors"}>
          <h4>Quality gate · {run.qualityGate.score ?? 0}/100</h4>
          {run.qualityGate.failures?.length
            ? run.qualityGate.failures.map((failure, index) => (
                <div key={`${failure}-${index}`}>{failure}</div>
              ))
            : <div>All acceptance criteria passed.</div>}
        </div>
      )}

      {isTerminal && (
        <div className="summary-final">
          <h4>Final summary</h4>
          <pre>{run.outputText || run.executionSummary?.final || "No summary."}</pre>
          {run.diffSummary?.stat && <pre className="diff-stat">{run.diffSummary.stat}</pre>}
        </div>
      )}
    </section>
  );
}

export default function AgentWorkspace() {
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceConfig, setWorkspaceConfig] = useState({
    mode: "local",
    allowLocalPath: true,
    message: ""
  });
  const [agents, setAgents] = useState([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [tree, setTree] = useState([]);
  const [fileSearch, setFileSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [workspaceForm, setWorkspaceForm] = useState({ name: "", rootPath: "" });
  const [gitForm, setGitForm] = useState({ repoUrl: "", branch: "main" });
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showGitForm, setShowGitForm] = useState(false);
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const pollIntervalRef = useRef(null);
  const pollingRunIdRef = useRef(null);
  const selectedWorkspace = workspaces.find(item => item.id === selectedWorkspaceId) || null;

  const staleWorkspaceIdsRef = useRef(new Set());

  useEffect(() => {
    loadInitialData();
    return () => stopPolling();
  }, []);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setTree([]);
      setSelectedFile("");
      setFileContent("");
      return;
    }
    const ws = workspaces.find(w => w.id === selectedWorkspaceId);
    if (!ws) {
      staleWorkspaceIdsRef.current.add(selectedWorkspaceId);
      setSelectedWorkspaceId("");
      setError("Workspace not found. Please re-upload or select another workspace.");
      return;
    }
    if (ws.status === "error") {
      setTree([]);
      setSelectedFile("");
      setFileContent("");
      setError("This workspace is in error state. You can delete it and re-upload.");
      return;
    }
    loadTree(selectedWorkspaceId);
  }, [selectedWorkspaceId, workspaces]);

  async function loadInitialData() {
    try {
      setLoading(true);
      const [workspaceResponse, configResponse, agentResponse] = await Promise.all([
        axios.get(`${API_URL}/api/workspaces`),
        axios.get(`${API_URL}/api/workspaces/config`),
        axios.get(`${API_URL}/api/ai/agents?agentType=coding`)
      ]);
      const loadedWorkspaces = workspaceResponse.data.data || [];
      const loadedAgents = (agentResponse.data.data || [])
        .filter(agent => agent.providerId?.type !== "manual");
      setWorkspaces(loadedWorkspaces);
      setWorkspaceConfig(configResponse.data.data || {
        mode: "local",
        allowLocalPath: true,
        message: ""
      });
      setAgents(loadedAgents);
      const firstValid = loadedWorkspaces.find(w =>
        !staleWorkspaceIdsRef.current.has(w.id) && w.status !== "error"
      );
      if (firstValid) setSelectedWorkspaceId(firstValid.id);
      if (loadedAgents[0]) setSelectedAgentId(loadedAgents[0]._id);

      const lastRunId = sessionStorage.getItem("lastAgentRunId");
      if (lastRunId) {
        startPolling(lastRunId);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelectedWorkspace() {
    if (!selectedWorkspace) return;
    if (!window.confirm(`Delete workspace "${selectedWorkspace.name}"? This will remove its files from disk.`)) return;
    try {
      await axios.delete(`${API_URL}/api/workspaces/${selectedWorkspace.id}`);
      staleWorkspaceIdsRef.current.add(selectedWorkspace.id);
      sessionStorage.removeItem("lastAgentRunId");
      setWorkspaces(prev => prev.filter(w => w.id !== selectedWorkspace.id));
      setSelectedWorkspaceId("");
      setError("Workspace deleted. Please upload or select another workspace.");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }

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

  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    pollingRunIdRef.current = null;
    sessionStorage.removeItem("lastAgentRunId");
  }

  function startPolling(runId) {
    stopPolling();
    pollingRunIdRef.current = runId;
    sessionStorage.setItem("lastAgentRunId", runId);

    async function pollRun() {
      try {
        const response = await axios.get(`${API_URL}/api/ai/agent-runs/${runId}`);
        const data = response.data.data;
        setRun(data);
        if (["completed", "error", "needs_revision", "cancelled"].includes(data.status)) {
          stopPolling();
          setLoading(false);
          await loadTree(selectedWorkspaceId);
          if (selectedFile) await openFile(selectedFile);
        }
      } catch (pollErr) {
        stopPolling();
        setLoading(false);
        setError(pollErr.response?.data?.message || pollErr.message);
      }
    }

    pollRun();
    pollIntervalRef.current = setInterval(pollRun, 1500);
  }

  async function createWorkspace() {
    if (!workspaceForm.rootPath.trim()) {
      setError("Enter a project path first.");
      return;
    }
    try {
      setLoading(true);
      const response = await axios.post(`${API_URL}/api/workspaces`, workspaceForm);
      const workspace = response.data.data;
      setWorkspaces(current => [workspace, ...current]);
      setSelectedWorkspaceId(workspace.id);
      setWorkspaceForm({ name: "", rootPath: "" });
      setShowProjectForm(false);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function uploadZip(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setLoading(true);
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name.replace(/\.zip$/i, ""));
      const response = await axios.post(`${API_URL}/api/workspaces/upload-zip`, form);
      const workspace = response.data.data;
      setWorkspaces(current => [workspace, ...current]);
      setSelectedWorkspaceId(workspace.id);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      event.target.value = "";
      setLoading(false);
    }
  }

  async function cloneGitWorkspace() {
    if (!gitForm.repoUrl.trim()) {
      setError("Enter a Git repository URL first.");
      return;
    }
    try {
      setLoading(true);
      const response = await axios.post(`${API_URL}/api/workspaces/clone-git`, {
        repoUrl: gitForm.repoUrl.trim(),
        branch: gitForm.branch.trim() || "main"
      });
      const workspace = response.data.data;
      setWorkspaces(current => [workspace, ...current]);
      setSelectedWorkspaceId(workspace.id);
      setGitForm({ repoUrl: "", branch: "main" });
      setShowGitForm(false);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function openFile(filePath) {
    try {
      const response = await axios.get(
        `${API_URL}/api/workspaces/${selectedWorkspaceId}/file`,
        { params: { path: filePath } }
      );
      setSelectedFile(filePath);
      setFileContent(response.data.data.content || "");
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }

  async function saveFile() {
    try {
      setLoading(true);
      await axios.put(`${API_URL}/api/workspaces/${selectedWorkspaceId}/file`, {
        path: selectedFile,
        content: fileContent
      });
      setError("");
      await loadTree(selectedWorkspaceId);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function cancelRun() {
    if (!pollingRunIdRef.current) return;
    try {
      await axios.post(`${API_URL}/api/ai/agent-runs/${pollingRunIdRef.current}/cancel`);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }

  async function runAgent() {
    if (!selectedWorkspaceId) {
      setError("Please create or select a workspace first.");
      return;
    }
    if (!selectedAgentId || !prompt.trim()) {
      setError("Select an agent and enter a task first.");
      return;
    }
    try {
      setLoading(true);
      setRun({ status: "queued" });
      setError("");

      const response = await axios.post(`${API_URL}/api/agents/run`, {
        workspaceId: selectedWorkspaceId,
        agentId: selectedAgentId,
        prompt: prompt.trim()
      });

      const runId = response.data.data.runId;
      startPolling(runId);
    } catch (err) {
      setLoading(false);
      setRun(null);
      setError(err.response?.data?.message || err.message);
    }
  }

  const filteredTree = useMemo(() => {
    const query = fileSearch.trim().toLowerCase();
    if (!query) return tree;
    function filterNodes(nodes) {
      return nodes.flatMap(node => {
        if (node.type === "file") {
          return node.name.toLowerCase().includes(query) ? [node] : [];
        }
        const children = filterNodes(node.children || []);
        return children.length ? [{ ...node, children }] : [];
      });
    }
    return filterNodes(tree);
  }, [tree, fileSearch]);

  return (
    <div className="agent-workspace-page">
      <header className="project-header">
        <div>
          <span className="eyebrow">CURRENT PROJECT</span>
          <h2>{selectedWorkspace?.name || "No workspace selected"}</h2>
          <p>
            {selectedWorkspace
              ? workspaceConfig.mode === "remote"
                ? `${selectedWorkspace.sourceType?.toUpperCase()} workspace · ${selectedWorkspace.status}`
                : selectedWorkspace.rootPath
              : workspaceConfig.message || "Create or select a workspace for the Coding Agent."}
          </p>
        </div>
        <div className="project-actions">
          <label className="btn btn-secondary zip-button">
            {workspaceConfig.mode === "remote" ? "Upload project ZIP" : "Upload ZIP"}
            <input type="file" accept=".zip,application/zip" onChange={uploadZip} />
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => setShowGitForm(value => !value)}>
            Clone Git repository
          </button>
          {workspaceConfig.allowLocalPath && (
            <button type="button" className="btn btn-secondary" onClick={() => setShowProjectForm(value => !value)}>
              Select local project
            </button>
          )}
          {selectedWorkspace && (
            <a className="btn btn-secondary" href={`${API_URL}/api/workspaces/${selectedWorkspace.id}/download-zip`}>
              Download patched ZIP
            </a>
          )}
        </div>
      </header>

      {workspaceConfig.mode === "remote" && (
        <div className="remote-workspace-notice">{workspaceConfig.message}</div>
      )}

      <section className="managed-workspace-picker">
        <label>Managed workspaces</label>
        <div className="workspace-selector-row">
          <select value={selectedWorkspaceId} onChange={event => setSelectedWorkspaceId(event.target.value)}>
            <option value="">-- Create or select a workspace --</option>
            {workspaces.map(workspace => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name} · {workspace.sourceType} · {workspace.status}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-delete-workspace"
            onClick={deleteSelectedWorkspace}
            disabled={!selectedWorkspace}
            title="Delete workspace"
          >
            🗑
          </button>
        </div>
      </section>

      {showProjectForm && workspaceConfig.allowLocalPath && (
        <section className="project-picker">
          <input
            value={workspaceForm.name}
            onChange={event => setWorkspaceForm(current => ({ ...current, name: event.target.value }))}
            placeholder="Project name"
          />
          <input
            value={workspaceForm.rootPath}
            onChange={event => setWorkspaceForm(current => ({ ...current, rootPath: event.target.value }))}
            placeholder="/home/user/projects/my-project"
          />
          <button type="button" className="btn btn-primary" onClick={createWorkspace} disabled={loading}>
            Save workspace
          </button>
        </section>
      )}

      {showGitForm && (
        <section className="git-clone-form">
          <input
            value={gitForm.repoUrl}
            onChange={event => setGitForm(current => ({ ...current, repoUrl: event.target.value }))}
            placeholder="https://github.com/owner/repository.git"
          />
          <input
            value={gitForm.branch}
            onChange={event => setGitForm(current => ({ ...current, branch: event.target.value }))}
            placeholder="main"
          />
          <button type="button" className="btn btn-primary" onClick={cloneGitWorkspace} disabled={loading}>
            Clone repository
          </button>
        </section>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="agent-workspace-layout">
        <aside className="file-explorer">
          <div className="explorer-heading">
            <h3>Explorer</h3>
            <button type="button" onClick={() => selectedWorkspaceId && loadTree(selectedWorkspaceId)}>↻</button>
          </div>
          <input
            className="file-search"
            value={fileSearch}
            onChange={event => setFileSearch(event.target.value)}
            placeholder="Search files..."
          />
          <div className="file-tree">
            {filteredTree.length
              ? filteredTree.map(node => (
                  <TreeNode
                    key={`${node.type}:${node.path}`}
                    node={node}
                    selectedPath={selectedFile}
                    onSelect={openFile}
                  />
                ))
              : <div className="muted">No files yet.</div>}
          </div>
        </aside>

        <main className="agent-main">
          <div className="agent-controls">
            <select value={selectedAgentId} onChange={event => setSelectedAgentId(event.target.value)}>
              <option value="">-- Select Coding Agent --</option>
              {(() => {
                const autoAgent = agents.find(a => a.code === "auto_coding");
                return autoAgent ? (
                  <option key={autoAgent._id} value={autoAgent._id}>
                    🤖 Auto Coding Agent · fallback priority
                  </option>
                ) : null;
              })()}
              {agents.filter(a => a.code !== "auto_coding").map(agent => (
                <option key={agent._id} value={agent._id}>
                  {agent.name} · {agent.modelName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runAgent}
              disabled={loading || !selectedWorkspaceId || !selectedAgentId || !prompt.trim()}
            >
              {loading ? "Agent is running..." : "▶ Run Agent"}
            </button>
          </div>


          <textarea
            className="agent-prompt"
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            placeholder="Example: inspect package.json, understand the stack, and fix the failing test..."
          />
          <ExecutionSummary run={run} onCancel={cancelRun} />
        </main>

        <aside className="file-preview-panel">
          <div className="preview-heading">
            <div>
              <span className="eyebrow">FILE PREVIEW</span>
              <h3>{selectedFile || "Select a file"}</h3>
            </div>
            <button type="button" className="btn btn-primary" onClick={saveFile} disabled={!selectedFile || loading}>
              Save
            </button>
          </div>
          <textarea
            className="file-editor"
            value={fileContent}
            onChange={event => setFileContent(event.target.value)}
            disabled={!selectedFile}
            placeholder="File content appears here."
            spellCheck={false}
          />
        </aside>
      </div>
    </div>
  );
}
