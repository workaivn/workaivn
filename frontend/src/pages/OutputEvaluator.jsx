import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./OutputEvaluator.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const evaluationChecklist = [
  { key: "completeness", label: "Completeness" },
  { key: "correctness", label: "Correctness" },
  { key: "codeQuality", label: "Code quality" },
  { key: "tests", label: "Tests / validation" },
  { key: "safety", label: "Safety / risk" },
  { key: "conciseness", label: "Conciseness" }
];

const quickSignals = [
  { key: "tests", terms: ["test", "spec", "assert", "jest", "vitest", "pytest"] },
  { key: "validation", terms: ["build", "lint", "validate", "verify", "compile"] },
  { key: "files", terms: ["file", "path", ".js", ".jsx", ".ts", ".tsx", ".py"] },
  { key: "safety", terms: ["backup", "rollback", "minimal", "risk", "breaking"] },
  { key: "steps", terms: ["step", "1.", "2.", "3.", "plan", "phase"] }
];

function normalizeText(value = "") {
  return String(value || "").trim();
}

function scoreOutput(text, criteria) {
  const normalized = normalizeText(text).toLowerCase();
  const length = normalized.length;
  const wordCount = normalized ? normalized.split(/\s+/).length : 0;
  const lineCount = normalized ? normalized.split(/\r?\n/).length : 0;

  let score = 50;
  const strengths = [];
  const issues = [];

  if (wordCount >= 120) {
    score += 10;
    strengths.push("Has enough detail to be actionable.");
  } else {
    issues.push("Output is short and may be missing implementation detail.");
  }

  if (lineCount >= 8) {
    score += 5;
    strengths.push("Has structured formatting.");
  }

  const hasTests = quickSignals.tests.some(term => normalized.includes(term));
  const hasValidation = quickSignals.validation.some(term => normalized.includes(term));
  const hasFiles = quickSignals.files.some(term => normalized.includes(term));
  const hasSafety = quickSignals.safety.some(term => normalized.includes(term));
  const hasSteps = quickSignals.steps.some(term => normalized.includes(term));

  if (criteria.tests && hasTests) {
    score += 12;
    strengths.push("Mentions tests or test strategy.");
  } else if (criteria.tests) {
    issues.push("Does not mention tests or validation.");
  }

  if (criteria.correctness && hasValidation) {
    score += 10;
    strengths.push("Includes validation / verification language.");
  } else if (criteria.correctness) {
    issues.push("No clear validation or verification step.");
  }

  if (criteria.completeness && hasFiles) {
    score += 8;
    strengths.push("References specific files or implementation targets.");
  } else if (criteria.completeness) {
    issues.push("Missing file-level implementation guidance.");
  }

  if (criteria.safety && hasSafety) {
    score += 8;
    strengths.push("Mentions safety or minimal-risk changes.");
  } else if (criteria.safety) {
    issues.push("No explicit safety or rollback consideration.");
  }

  if (criteria.codeQuality && hasSteps) {
    score += 6;
    strengths.push("Provides a stepwise structure.");
  } else if (criteria.codeQuality) {
    issues.push("Lacks a clear stepwise implementation flow.");
  }

  if (criteria.conciseness && length > 3000) {
    score -= 8;
    issues.push("Output is quite long and may be verbose.");
  }

  if (/TODO|FIXME/.test(text)) {
    score -= 10;
    issues.push("Contains TODO/FIXME markers.");
  }

  if (/\b(error|fail|broken)\b/i.test(text) && !/fix|resolve|prevent/i.test(text)) {
    score -= 4;
    issues.push("Mentions problems without a clear fix path.");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D",
    strengths,
    issues,
    metrics: {
      length,
      wordCount,
      lineCount,
      hasTests,
      hasValidation,
      hasFiles,
      hasSafety,
      hasSteps
    }
  };
}

function normalizeChecklistState() {
  return evaluationChecklist.reduce((acc, item) => {
    acc[item.key] = true;
    return acc;
  }, {});
}

export default function OutputEvaluator() {
  const [tasks, setTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskRuns, setTaskRuns] = useState([]);
  const [selectedRunIds, setSelectedRunIds] = useState([]);
  const [manualOutput, setManualOutput] = useState("");
  const [manualLabel, setManualLabel] = useState("Manual output");
  const [criteria, setCriteria] = useState(normalizeChecklistState());
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/api/ai/tasks?limit=40`);
      setTasks(res.data.data || []);
      if ((res.data.data || []).length > 0) {
        setSelectedTaskId(res.data.data[0]._id);
        await loadTaskRuns(res.data.data[0]._id);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTaskRuns(taskId) {
    try {
      const res = await axios.get(`${API_URL}/api/ai/tasks/${taskId}/runs`);
      setTaskRuns(res.data.data || []);
      setSelectedRunIds([]);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }

  function toggleCriteria(key) {
    setCriteria(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleRun(runId) {
    setSelectedRunIds(prev =>
      prev.includes(runId) ? prev.filter(id => id !== runId) : [...prev, runId]
    );
  }

  function evaluateOutputs(items) {
    const evaluated = items.map(item => ({
      ...item,
      evaluation: scoreOutput(item.outputText, criteria)
    }));
    evaluated.sort((left, right) => right.evaluation.score - left.evaluation.score);
    setResults(evaluated);
  }

  function evaluateSelectedRuns() {
    const chosenRuns = taskRuns.filter(run => selectedRunIds.includes(run._id));
    if (chosenRuns.length < 1) {
      setError("Select at least one run to evaluate.");
      return;
    }

    const items = chosenRuns.map(run => ({
      id: run._id,
      label: `${run.agentId?.name || "Agent"} • ${run.modelName}`,
      outputText: run.outputText || "",
      status: run.status
    }));

    evaluateOutputs(items);
    setError("");
  }

  function evaluateManualOutput() {
    if (!manualOutput.trim()) {
      setError("Paste output text before evaluating.");
      return;
    }

    evaluateOutputs([
      {
        id: "manual",
        label: manualLabel || "Manual output",
        outputText: manualOutput,
        status: "manual"
      }
    ]);
    setError("");
  }

  const selectedTask = useMemo(() => tasks.find(task => task._id === selectedTaskId), [tasks, selectedTaskId]);

  return (
    <div className="evaluator-page">
      <header className="evaluator-header">
        <div>
          <h1>Output Evaluator</h1>
          <p>Score agent outputs, compare runs, and review quality gaps quickly.</p>
        </div>
        <div className="evaluator-pill-row">
          <span>{tasks.length} tasks</span>
          <span>{taskRuns.length} runs</span>
        </div>
      </header>

      {error && <div className="evaluator-alert">{error}</div>}

      <div className="evaluator-layout">
        <aside className="evaluator-panel">
          <h3>Source</h3>
          <label>Task</label>
          <select
            value={selectedTaskId}
            onChange={async e => {
              const taskId = e.target.value;
              setSelectedTaskId(taskId);
              await loadTaskRuns(taskId);
            }}
          >
            {tasks.map(task => (
              <option key={task._id} value={task._id}>{task.title}</option>
            ))}
          </select>

          <div className="mini-meta">
            <span>Task type: {selectedTask?.taskType || "-"}</span>
            <span>Status: {selectedTask?.status || "-"}</span>
          </div>

          <div className="run-list">
            {taskRuns.map(run => (
              <button
                key={run._id}
                type="button"
                className={`run-choice ${selectedRunIds.includes(run._id) ? "active" : ""}`}
                onClick={() => toggleRun(run._id)}
              >
                <strong>{run.agentId?.name || "Agent"}</strong>
                <span>{run.status}</span>
              </button>
            ))}
          </div>

          <div className="panel-actions">
            <button type="button" className="btn-primary" disabled={loading || !taskRuns.length} onClick={evaluateSelectedRuns}>
              Evaluate selected runs
            </button>
          </div>
        </aside>

        <main className="evaluator-panel">
          <h3>Criteria</h3>
          <div className="criteria-grid">
            {evaluationChecklist.map(item => (
              <label key={item.key} className="criteria-item">
                <input type="checkbox" checked={criteria[item.key]} onChange={() => toggleCriteria(item.key)} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>

          <h3>Manual Output</h3>
          <input
            value={manualLabel}
            onChange={e => setManualLabel(e.target.value)}
            placeholder="Label for manual output"
          />
          <textarea
            rows={12}
            value={manualOutput}
            onChange={e => setManualOutput(e.target.value)}
            placeholder="Paste a run output, patch summary, or workflow result here..."
          />
          <div className="panel-actions">
            <button type="button" className="btn-secondary" onClick={evaluateManualOutput}>
              Evaluate manual output
            </button>
          </div>

          <section className="result-list">
            <h3>Results</h3>
            {results.length === 0 ? (
              <div className="empty-state">No evaluation yet.</div>
            ) : (
              results.map(result => (
                <article key={result.id} className="result-card">
                  <div className="result-head">
                    <div>
                      <strong>{result.label}</strong>
                      <p>{result.status}</p>
                    </div>
                    <div className="grade-badge">
                      <span>{result.evaluation.grade}</span>
                      <strong>{result.evaluation.score}/100</strong>
                    </div>
                  </div>

                  <div className="metric-row">
                    <span>{result.evaluation.metrics.wordCount} words</span>
                    <span>{result.evaluation.metrics.lineCount} lines</span>
                    <span>{result.evaluation.metrics.length} chars</span>
                  </div>

                  <div className="result-columns">
                    <div>
                      <h4>Strengths</h4>
                      <ul>
                        {result.evaluation.strengths.length ? result.evaluation.strengths.map((item, index) => <li key={index}>{item}</li>) : <li>No strong signals found.</li>}
                      </ul>
                    </div>
                    <div>
                      <h4>Issues</h4>
                      <ul>
                        {result.evaluation.issues.length ? result.evaluation.issues.map((item, index) => <li key={index}>{item}</li>) : <li>No obvious issues flagged.</li>}
                      </ul>
                    </div>
                  </div>
                </article>
              ))
            )}
          </section>
        </main>

        <aside className="evaluator-panel">
          <h3>Preview</h3>
          {selectedTask ? (
            <div className="preview-block">
              <strong>{selectedTask.title}</strong>
              <pre>{selectedTask.inputPrompt}</pre>
            </div>
          ) : (
            <div className="empty-state">Select a task to inspect its prompt.</div>
          )}

          <div className="preview-block subtle">
            <h4>How scoring works</h4>
            <p>
              The evaluator uses lightweight heuristics to detect tests, validation, file references, step-by-step structure, and safety language. It is designed for quick review, not as a replacement for human judgment.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
