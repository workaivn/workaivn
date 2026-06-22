import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./AgentWorkspace.css";

const API_URL = (import.meta.env.VITE_API_URL || "https://api.workaivn.com/api")
  .replace(/\/api\/api/, "/api")
  .replace(/\/$/, "")
  .replace(/\/api$/, "");

function TreeNode({ node, selectedPath, onSelect }) {
  const [expanded, setExpanded] = useState(false);

  if (node.type === "folder") {
    return (
      <div className="tree-node">
        <button
          type="button"
          className="tree-row folder"
          onClick={() => setExpanded(value => !value)}
        >
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

function ExecutionSummary({ run }) {
  if (!run) return null;

  const toolCalls = run.toolCalls || [];
  const filesRead = [...new Set(
    toolCalls
      .filter(call => call.tool === "READ_FILE" && call.success)
      .map(call => call.result?.file || call.args?.path)
      .filter(Boolean)
  )];
  const patches = toolCalls.filter(call => call.tool === "APPLY_PATCH");
  const terminalCommands = toolCalls.filter(call => call.tool === "RUN_TERMINAL");
  const errors = [
    run.errorMessage,
    ...(run.executionEvents || [])
      .filter(event => event.type === "error" || event.type === "failed")
      .map(event => event.message)
  ].filter(Boolean);

  return (
    <section className="execution-summary">
      <div className="summary-heading">
        <h3>Kết quả Agent</h3>
        <span className={`run-badge status-${run.status}`}>{run.status}</span>
      </div>

      <div className="summary-grid">
        <div>
          <h4>Files read</h4>
          {filesRead.length ? filesRead.map(file => <code key={file}>{file}</code>) : <span className="muted">Không có</span>}
        </div>
        <div>
          <h4>Files changed</h4>
          {run.changedFiles?.length ? run.changedFiles.map(file => <code key={file}>{file}</code>) : <span className="muted">Không có</span>}
        </div>
        <div>
          <h4>Patches applied</h4>
          {patches.length ? patches.map((call, index) => (
            <code key={`${call.step}-${index}`}>{call.args?.file} · {call.success ? "OK" : "Failed"}</code>
          )) : <span className="muted">Không có</span>}
        </div>
        <div>
          <h4>Terminal commands</h4>
          {terminalCommands.length ? terminalCommands.map((call, index) => (
            <code key={`${call.step}-${index}`}>{call.args?.command}</code>
          )) : <span className="muted">Không có</span>}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="summary-errors">
          <h4>Errors</h4>
          {errors.map((error, index) => <div key={`${error}-${index}`}>{error}</div>)}
        </div>
      )}

      <div className="summary-final">
        <h4>Final summary</h4>
        <pre>{run.outputText || run.executionSummary?.final || "Không có tóm tắt."}</pre>
        {run.diffSummary?.stat && <pre className="diff-stat">{run.diffSummary.stat}</pre>}
      </div>
    </section>
  );
}

export default function AgentWorkspace() {
  const [workspaces, setWorkspaces] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [tree, setTree] = useState([]);
  const [fileSearch, setFileSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [workspaceForm, setWorkspaceForm] = useState({ name: "", rootPath: "" });
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedWorkspace = workspaces.find(item => item.id === selectedWorkspaceId) || null;

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedWorkspaceId) loadTree(selectedWorkspaceId);
    else {
      setTree([]);
      setSelectedFile("");
      setFileContent("");
    }
  }, [selectedWorkspaceId]);

  async function loadInitialData() {
    try {
      setLoading(true);
      const [workspaceResponse, agentResponse] = await Promise.all([
        axios.get(`${API_URL}/api/workspaces`),
        axios.get(`${API_URL}/api/ai/agents?agentType=coding`)
      ]);
      const loadedWorkspaces = workspaceResponse.data.data || [];
      const loadedAgents = (agentResponse.data.data || [])
        .filter(agent => agent.providerId?.type !== "manual");
      setWorkspaces(loadedWorkspaces);
      setAgents(loadedAgents);
      if (loadedWorkspaces[0]) setSelectedWorkspaceId(loadedWorkspaces[0].id);
      if (loadedAgents[0]) setSelectedAgentId(loadedAgents[0]._id);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTree(workspaceId) {
    try {
      const response = await axios.get(`${API_URL}/api/workspaces/${workspaceId}/tree`);
      setTree(response.data.data?.tree || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }

  async function createWorkspace() {
    if (!workspaceForm.rootPath.trim()) {
      setError("Nhập đường dẫn project trước.");
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

  async function runAgent() {
    if (!selectedWorkspaceId) {
      setError("Please select a project workspace first.");
      return;
    }
    if (!selectedAgentId || !prompt.trim()) {
      setError("Chọn agent và nhập yêu cầu trước.");
      return;
    }

    try {
      setLoading(true);
      setRun(null);
      const response = await axios.post(`${API_URL}/api/agents/run`, {
        workspaceId: selectedWorkspaceId,
        agentId: selectedAgentId,
        prompt: prompt.trim()
      });
      setRun(response.data.data.run);
      await loadTree(selectedWorkspaceId);
      if (selectedFile) await openFile(selectedFile);
      setError("");
    } catch (err) {
      const failedRun = err.response?.data?.data?.run;
      if (failedRun) setRun(failedRun);
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
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
          <h2>{selectedWorkspace?.name || "Chưa chọn project"}</h2>
          <p>{selectedWorkspace?.rootPath || "Chọn một thư mục project để Agent có thể đọc và sửa code."}</p>
        </div>
        <div className="project-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setShowProjectForm(value => !value)}>
            Chọn project
          </button>
          <label className="btn btn-secondary zip-button">
            Upload ZIP
            <input type="file" accept=".zip,application/zip" onChange={uploadZip} />
          </label>
          {selectedWorkspace && (
            <a className="btn btn-secondary" href={`${API_URL}/api/workspaces/${selectedWorkspace.id}/download-zip`}>
              Download ZIP
            </a>
          )}
        </div>
      </header>

      {showProjectForm && (
        <section className="project-picker">
          <select value={selectedWorkspaceId} onChange={event => setSelectedWorkspaceId(event.target.value)}>
            <option value="">-- Chọn workspace đã lưu --</option>
            {workspaces.map(workspace => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name} — {workspace.rootPath}
              </option>
            ))}
          </select>
          <input
            value={workspaceForm.name}
            onChange={event => setWorkspaceForm(current => ({ ...current, name: event.target.value }))}
            placeholder="Tên project"
          />
          <input
            value={workspaceForm.rootPath}
            onChange={event => setWorkspaceForm(current => ({ ...current, rootPath: event.target.value }))}
            placeholder="G:\langtuvn\workaivn"
          />
          <button type="button" className="btn btn-primary" onClick={createWorkspace} disabled={loading}>
            Lưu workspace
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
            placeholder="Tìm file..."
          />
          <div className="file-tree">
            {filteredTree.length ? filteredTree.map(node => (
              <TreeNode
                key={`${node.type}:${node.path}`}
                node={node}
                selectedPath={selectedFile}
                onSelect={openFile}
              />
            )) : <div className="muted">Chưa có file tree.</div>}
          </div>
        </aside>

        <main className="agent-main">
          <div className="agent-controls">
            <select value={selectedAgentId} onChange={event => setSelectedAgentId(event.target.value)}>
              <option value="">-- Chọn Coding Agent --</option>
              {agents.map(agent => (
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
              {loading ? "Agent đang chạy..." : "▶ Run Agent"}
            </button>
          </div>

          <textarea
            className="agent-prompt"
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            placeholder="Ví dụ: Đọc package.json, kiểm tra cấu trúc project và sửa test đang lỗi..."
          />

          <ExecutionSummary run={run} />
        </main>

        <aside className="file-preview-panel">
          <div className="preview-heading">
            <div>
              <span className="eyebrow">FILE PREVIEW</span>
              <h3>{selectedFile || "Chọn một file"}</h3>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveFile}
              disabled={!selectedFile || loading}
            >
              Save
            </button>
          </div>
          <textarea
            className="file-editor"
            value={fileContent}
            onChange={event => setFileContent(event.target.value)}
            disabled={!selectedFile}
            placeholder="Nội dung file sẽ hiển thị tại đây."
            spellCheck={false}
          />
        </aside>
      </div>
    </div>
  );
}
