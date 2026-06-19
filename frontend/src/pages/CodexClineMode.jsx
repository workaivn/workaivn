import React, { useMemo, useState } from "react";
import "./CodexClineMode.css";

const TOOL_PRESETS = {
  cline: {
    label: "Cline",
    title: "Cline IDE handoff",
    intro: "Use this when you want a local IDE agent to edit files directly.",
    focus: "read the project first, keep changes minimal, preserve behavior"
  },
  codex: {
    label: "Codex",
    title: "Codex / GPT handoff",
    intro: "Use this when you want a code-generation oriented assistant to produce clean patches.",
    focus: "produce production-ready code, include edge cases, provide tests"
  },
  cursor: {
    label: "Cursor",
    title: "Cursor IDE handoff",
    intro: "Use this when you want a fast editor-native change flow with context awareness.",
    focus: "scan the current workspace, avoid broad rewrites, update only touched files"
  },
  claudeWeb: {
    label: "Claude Web",
    title: "Claude Web handoff",
    intro: "Use this when you want a broader reasoning pass before editing.",
    focus: "explain root cause, propose a narrow fix, verify with build or logic"
  }
};

const MODE_HINTS = {
  code: "coding / implementation",
  review: "review / critique",
  fix: "bug fix",
  plan: "task planning / phase breakdown",
  file: "file-context analysis"
};

function buildPrompt({ toolKey, objective, filesToTouch, filesToAvoid, constraints, outputStyle, mode }) {
  const preset = TOOL_PRESETS[toolKey];

  return `You are ${preset.label}.

GOAL:
${objective}

MODE:
${MODE_HINTS[mode]}

TOOL FOCUS:
${preset.focus}

FILES TO TOUCH:
${filesToTouch || "N/A"}

FILES TO AVOID:
${filesToAvoid || "N/A"}

CONSTRAINTS:
${constraints || "Keep changes minimal and consistent with existing code."}

OUTPUT STYLE:
${outputStyle}

IMPORTANT RULES:
- Read the relevant code before changing anything.
- Do not rewrite unrelated files.
- Preserve existing behavior.
- Validate your changes before finishing.
- If a build/test fails, fix the root cause.
- Return a concise final summary.
`.trim();
}

export default function CodexClineMode() {
  const [toolKey, setToolKey] = useState("cline");
  const [mode, setMode] = useState("code");
  const [objective, setObjective] = useState("");
  const [filesToTouch, setFilesToTouch] = useState("");
  const [filesToAvoid, setFilesToAvoid] = useState("");
  const [constraints, setConstraints] = useState("");
  const [outputStyle, setOutputStyle] = useState("Patch first, then explain briefly.");
  const [copied, setCopied] = useState("");

  const prompt = useMemo(
    () => buildPrompt({ toolKey, objective, filesToTouch, filesToAvoid, constraints, outputStyle, mode }),
    [toolKey, objective, filesToTouch, filesToAvoid, constraints, outputStyle, mode]
  );

  async function copyText(value, key) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  }

  const preset = TOOL_PRESETS[toolKey];

  return (
    <div className="codex-mode-page">
      <header className="codex-mode-header">
        <div>
          <h1>Codex / Cline Mode</h1>
          <p>Fast handoff mode for external coding tools and local IDE agents.</p>
        </div>
        <div className="codex-mode-badges">
          <span>{preset.label}</span>
          <span>{MODE_HINTS[mode]}</span>
        </div>
      </header>

      <div className="codex-mode-layout">
        <section className="codex-panel">
          <h3>Tool Selection</h3>
          <div className="tool-grid">
            {Object.entries(TOOL_PRESETS).map(([key, item]) => (
              <button
                key={key}
                type="button"
                className={`tool-card ${toolKey === key ? "active" : ""}`}
                onClick={() => setToolKey(key)}
              >
                <strong>{item.label}</strong>
                <span>{item.title}</span>
              </button>
            ))}
          </div>

          <h3>Mode</h3>
          <div className="mode-chip-row">
            {Object.entries(MODE_HINTS).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`mode-chip ${mode === key ? "active" : ""}`}
                onClick={() => setMode(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <label>Objective</label>
          <textarea value={objective} onChange={e => setObjective(e.target.value)} rows={5} placeholder="Describe the change you want the tool to make..." />

          <label>Files to Touch</label>
          <textarea value={filesToTouch} onChange={e => setFilesToTouch(e.target.value)} rows={3} placeholder="src/pages/..., src/services/..." />

          <label>Files to Avoid</label>
          <textarea value={filesToAvoid} onChange={e => setFilesToAvoid(e.target.value)} rows={3} placeholder=".env, generated files, untouched modules" />

          <label>Constraints</label>
          <textarea value={constraints} onChange={e => setConstraints(e.target.value)} rows={4} placeholder="Keep backward compatibility, preserve UI, etc." />

          <label>Output Style</label>
          <input value={outputStyle} onChange={e => setOutputStyle(e.target.value)} />
        </section>

        <section className="codex-panel codex-preview-panel">
          <div className="panel-head">
            <div>
              <h3>{preset.title}</h3>
              <p>{preset.intro}</p>
            </div>
            <div className="preview-actions">
              <button type="button" className="btn-soft" onClick={() => copyText(prompt, "prompt")}>{copied === "prompt" ? "Copied" : "Copy prompt"}</button>
              <button type="button" className="btn-soft" onClick={() => copyText(JSON.stringify({ tool: preset.label, mode, objective, filesToTouch, filesToAvoid, constraints, outputStyle }, null, 2), "json")}>{copied === "json" ? "Copied" : "Copy JSON"}</button>
            </div>
          </div>

          <div className="preview-block">
            <h4>Prompt</h4>
            <pre>{prompt}</pre>
          </div>

          <div className="preview-block subtle">
            <h4>Suggested flow</h4>
            <ol>
              <li>Paste the prompt into the selected tool.</li>
              <li>Ask it to inspect the repository before patching.</li>
              <li>Request a minimal diff and validation step.</li>
              <li>Bring the result back into WorkAIVN if you want comparison or review.</li>
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
