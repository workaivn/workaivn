import React, { useMemo, useRef, useState } from "react";
import "./FileContextManager.css";

const API_URL = import.meta.env.VITE_API_URL || "https://api.workaivn.com/api";

function parseSseChunk(buffer, onEvent) {
  const events = buffer.split(/\r?\n\r?\n/);
  const remainder = events.pop() || "";

  for (const event of events) {
    const line = event.split("\n").find(item => item.startsWith("data:"));
    if (!line) continue;

    const raw = line.replace("data:", "").trim();
    if (!raw || raw === "[DONE]") continue;

    try {
      onEvent(JSON.parse(raw));
    } catch {
      // ignore malformed stream chunks
    }
  }

  return remainder;
}

export default function FileContextManager() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [streamText, setStreamText] = useState("");
  const [finalAnswer, setFinalAnswer] = useState("");
  const [chatId, setChatId] = useState("");
  const inputRef = useRef(null);

  const fileCards = useMemo(
    () => selectedFiles.map((file, index) => ({
      id: `${file.name}-${index}`,
      name: file.name,
      size: file.size,
      type: file.type || "unknown"
    })),
    [selectedFiles]
  );

  function handlePickFiles(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setSelectedFiles(prev => [...prev, ...files]);
    event.target.value = "";
  }

  function removeFile(index) {
    setSelectedFiles(prev => prev.filter((_, currentIndex) => currentIndex !== index));
  }

  function clearAll() {
    setSelectedFiles([]);
    setPrompt("");
    setStreamText("");
    setFinalAnswer("");
    setChatId("");
    setError("");
  }

  async function uploadFiles() {
    if (!selectedFiles.length) {
      setError("Chọn ít nhất 1 file trước khi upload");
      return;
    }

    try {
      setUploading(true);
      setError("");
      setStreamText("");
      setFinalAnswer("");
      setChatId("");

      const formData = new FormData();
      selectedFiles.forEach(file => formData.append("files", file));
      formData.append("prompt", prompt);
      formData.append("chatId", "");

      const token = localStorage.getItem("token") || "";
      const response = await fetch(`${API_URL}/upload-file`, {
        method: "POST",
        headers: {
          authorization: token
        },
        body: formData
      });

      if (!response.ok || !response.body) {
        throw new Error("Upload failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, payload => {
          if (payload.type === "token") {
            setStreamText(prev => prev + (payload.delta || ""));
          }

          if (payload.type === "done") {
            setFinalAnswer(payload.final || "");
            setChatId(payload.chatId || "");
          }

          if (payload.type === "error") {
            setError(payload.error || "Upload failed");
          }
        });
      }
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="file-context-page">
      <header className="file-context-header">
        <div>
          <h1>File Context Manager</h1>
          <p>Upload source files and keep the extracted context ready for chat or tasks.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
            Add Files
          </button>
          <button type="button" className="btn-secondary" onClick={clearAll}>
            Clear
          </button>
        </div>
      </header>

      {error && <div className="file-context-alert">{error}</div>}

      <div className="file-context-layout">
        <section className="file-context-panel">
          <h3>Selected Files</h3>
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple
            onChange={handlePickFiles}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.js,.jsx,.ts,.tsx,.json,.css,.html,.md,.csv,.yml,.yaml,.sql"
          />

          <div className="file-drop-zone" onClick={() => inputRef.current?.click()}>
            Click to select files, or drop them here after the browser supports drag and drop.
          </div>

          <div className="file-card-list">
            {fileCards.length ? fileCards.map((file, index) => (
              <div key={file.id} className="file-card">
                <div>
                  <strong>{file.name}</strong>
                  <p>{file.type}</p>
                  <p>{Math.round(file.size / 1024)} KB</p>
                </div>
                <button type="button" className="mini-btn" onClick={() => removeFile(index)}>
                  Remove
                </button>
              </div>
            )) : <div className="empty-state">No files selected yet</div>}
          </div>
        </section>

        <section className="file-context-panel">
          <h3>Upload Prompt</h3>
          <textarea
            rows={8}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe what you want the file context to focus on..."
          />
          <button type="button" className="btn-primary upload-btn" disabled={uploading} onClick={uploadFiles}>
            {uploading ? "Uploading..." : "Upload & Extract Context"}
          </button>

          <div className="context-meta">
            <span>Files: {selectedFiles.length}</span>
            <span>Chat ID: {chatId || "-"}</span>
          </div>

          <div className="stream-box">
            <h4>Live Extraction</h4>
            <pre>{streamText || "No stream yet"}</pre>
          </div>
        </section>

        <section className="file-context-panel">
          <h3>Context Result</h3>
          <div className="result-box">
            <pre>{finalAnswer || "Upload files to generate a context summary."}</pre>
          </div>
        </section>
      </div>
    </div>
  );
}
