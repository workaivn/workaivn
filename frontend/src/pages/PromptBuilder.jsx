import React, { useState } from "react";
import "./PromptBuilder.css";

export default function PromptBuilder() {
  const [form, setForm] = useState({
    projectType: "web",
    featureName: "",
    currentProblem: "",
    filesTouches: "",
    filesNotTouch: "",
    backendReq: "",
    frontendReq: "",
    databaseReq: "",
    uiReq: "",
    testReq: "",
    outputFormat: "code"
  });

  const [showOutputs, setShowOutputs] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(null);

  function copyPrompt(key) {
    const prompts = generatePrompts();
    navigator.clipboard.writeText(prompts[key]);
    setCopiedPrompt(key);
    setTimeout(() => setCopiedPrompt(null), 2000);
  }

  function generatePrompts() {
    const base = buildBasePrompt();

    return {
      cline: buildClinePrompt(base),
      cursor: buildCursorPrompt(base),
      codex: buildCodexPrompt(base),
      gemini: buildGeminiPrompt(base),
      claude: buildClaudePrompt(base)
    };
  }

  function buildBasePrompt() {
    return `
Project Type: ${form.projectType}
Feature Name: ${form.featureName}

Current Problem:
${form.currentProblem}

Files to Touch:
${form.filesTouches || "N/A"}

Files NOT to Touch:
${form.filesNotTouch || "N/A"}

Backend Requirement:
${form.backendReq || "N/A"}

Frontend Requirement:
${form.frontendReq || "N/A"}

Database Requirement:
${form.databaseReq || "N/A"}

UI Requirement:
${form.uiReq || "N/A"}

Test Requirement:
${form.testReq || "N/A"}

Output Format: ${form.outputFormat}
    `.trim();
  }

  function buildClinePrompt(base) {
    return `You are Cline IDE Extension. Your task:

${base}

CRITICAL RULES:
1. Read the project structure first
2. Do NOT rewrite entire files
3. Do NOT delete existing features
4. Modify ONLY necessary files
5. Keep backup of original files
6. Run build after changes
7. List all changed files
8. Provide test steps
9. Check for side effects
10. Follow existing code patterns

Task:
${form.featureName} - ${form.currentProblem}

Constraints:
- Preserve all existing functionality
- Minimal changes only
- Update tests
- Check for breaking changes

After implementing:
1. List files changed
2. Explain what changed
3. Provide build commands
4. Provide test steps
5. Ask for manual review`;
  }

  function buildCursorPrompt(base) {
    return `You are Cursor IDE. Complete this task:

${base}

APPROACH:
1. Understand existing code first
2. Follow project conventions
3. Make minimal, focused changes
4. Test thoroughly
5. Document changes

Please:
- Implement the feature
- Maintain code quality
- Keep backwards compatibility
- Update relevant documentation
- Suggest tests`;
  }

  function buildCodexPrompt(base) {
    return `Generate code for:

${base}

REQUIREMENTS:
- Production-quality code
- Proper error handling
- Performance optimized
- Security considered
- Documented thoroughly
- Follow best practices
- Include tests

Output:
- Code implementation
- Usage examples
- Edge cases handled
- Performance notes`;
  }

  function buildGeminiPrompt(base) {
    return `Task: ${form.featureName}

Context:
${base}

Please analyze and implement:
1. Architecture design
2. Code implementation
3. Testing strategy
4. Documentation
5. Performance optimization

Provide comprehensive guidance with code examples.`;
  }

  function buildClaudePrompt(base) {
    return `I need help with: ${form.featureName}

Context:
${base}

Please:
1. Understand the requirements
2. Suggest implementation approach
3. Provide production-ready code
4. Include error handling
5. Add comprehensive tests
6. Document thoroughly

Focus on code quality and maintainability.`;
  }

  const prompts = generatePrompts();

  return (
    <div className="prompt-builder-container">
      <header className="prompt-builder-header">
        <h1>⚙️ Prompt Builder</h1>
        <p>Transform your idea into detailed prompts for AI coding agents</p>
      </header>

      <div className="prompt-builder-layout">
        {/* LEFT: FORM */}
        <div className="builder-form-section">
          <h2>Build Your Prompt</h2>

          <div className="form-group">
            <label>Project Type:</label>
            <select
              value={form.projectType}
              onChange={e => setForm({ ...form, projectType: e.target.value })}
            >
              <option value="web">Web App (React, Vue, etc)</option>
              <option value="backend">Backend (Node, Python, etc)</option>
              <option value="fullstack">Full Stack</option>
              <option value="mobile">Mobile (React Native, Flutter)</option>
              <option value="library">Library / Package</option>
              <option value="cli">CLI Tool</option>
            </select>
          </div>

          <div className="form-group">
            <label>Feature Name:</label>
            <input
              type="text"
              value={form.featureName}
              onChange={e => setForm({ ...form, featureName: e.target.value })}
              placeholder="e.g., User Authentication, Payment Gateway"
            />
          </div>

          <div className="form-group">
            <label>Current Problem / Task:</label>
            <textarea
              value={form.currentProblem}
              onChange={e => setForm({ ...form, currentProblem: e.target.value })}
              placeholder="Describe what you want to build or fix..."
              rows={4}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Files to Touch:</label>
              <textarea
                value={form.filesTouches}
                onChange={e => setForm({ ...form, filesTouches: e.target.value })}
                placeholder="e.g., src/components/Auth.jsx, src/api/auth.js"
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Files NOT to Touch:</label>
              <textarea
                value={form.filesNotTouch}
                onChange={e => setForm({ ...form, filesNotTouch: e.target.value })}
                placeholder="e.g., src/utils/config.js, .env, package.json"
                rows={3}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Backend Requirement:</label>
            <textarea
              value={form.backendReq}
              onChange={e => setForm({ ...form, backendReq: e.target.value })}
              placeholder="Database schema, API endpoints, etc."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Frontend Requirement:</label>
            <textarea
              value={form.frontendReq}
              onChange={e => setForm({ ...form, frontendReq: e.target.value })}
              placeholder="UI components, forms, validations, etc."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Database Requirement:</label>
            <textarea
              value={form.databaseReq}
              onChange={e => setForm({ ...form, databaseReq: e.target.value })}
              placeholder="Schema changes, migrations, etc."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>UI Requirement:</label>
            <textarea
              value={form.uiReq}
              onChange={e => setForm({ ...form, uiReq: e.target.value })}
              placeholder="Design, layout, responsive behavior, etc."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Test Requirement:</label>
            <textarea
              value={form.testReq}
              onChange={e => setForm({ ...form, testReq: e.target.value })}
              placeholder="Test cases, coverage expectations, etc."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Output Format:</label>
            <select
              value={form.outputFormat}
              onChange={e => setForm({ ...form, outputFormat: e.target.value })}
            >
              <option value="code">Code Only</option>
              <option value="code+tests">Code + Tests</option>
              <option value="code+docs">Code + Documentation</option>
              <option value="all">Code + Tests + Docs</option>
            </select>
          </div>

          <button
            className="btn btn-primary btn-large"
            onClick={() => setShowOutputs(!showOutputs)}
          >
            {showOutputs ? "↑ Hide Prompts" : "↓ Generate Prompts"}
          </button>
        </div>

        {/* RIGHT: OUTPUTS */}
        {showOutputs && (
          <div className="builder-output-section">
            <h2>Generated Prompts</h2>

            {/* CLINE */}
            <div className="prompt-card">
              <div className="prompt-header">
                <h3>🧵 Cline IDE</h3>
                <button
                  className={`btn-copy ${copiedPrompt === "cline" ? "copied" : ""}`}
                  onClick={() => copyPrompt("cline")}
                >
                  {copiedPrompt === "cline" ? "✓ Copied!" : "📋 Copy"}
                </button>
              </div>
              <pre className="prompt-content">{prompts.cline}</pre>
            </div>

            {/* CURSOR */}
            <div className="prompt-card">
              <div className="prompt-header">
                <h3>🖱️ Cursor IDE</h3>
                <button
                  className={`btn-copy ${copiedPrompt === "cursor" ? "copied" : ""}`}
                  onClick={() => copyPrompt("cursor")}
                >
                  {copiedPrompt === "cursor" ? "✓ Copied!" : "📋 Copy"}
                </button>
              </div>
              <pre className="prompt-content">{prompts.cursor}</pre>
            </div>

            {/* CODEX */}
            <div className="prompt-card">
              <div className="prompt-header">
                <h3>⚡ Codex / GPT</h3>
                <button
                  className={`btn-copy ${copiedPrompt === "codex" ? "copied" : ""}`}
                  onClick={() => copyPrompt("codex")}
                >
                  {copiedPrompt === "codex" ? "✓ Copied!" : "📋 Copy"}
                </button>
              </div>
              <pre className="prompt-content">{prompts.codex}</pre>
            </div>

            {/* GEMINI */}
            <div className="prompt-card">
              <div className="prompt-header">
                <h3>🔮 Google Gemini</h3>
                <button
                  className={`btn-copy ${copiedPrompt === "gemini" ? "copied" : ""}`}
                  onClick={() => copyPrompt("gemini")}
                >
                  {copiedPrompt === "gemini" ? "✓ Copied!" : "📋 Copy"}
                </button>
              </div>
              <pre className="prompt-content">{prompts.gemini}</pre>
            </div>

            {/* CLAUDE */}
            <div className="prompt-card">
              <div className="prompt-header">
                <h3>💫 Claude</h3>
                <button
                  className={`btn-copy ${copiedPrompt === "claude" ? "copied" : ""}`}
                  onClick={() => copyPrompt("claude")}
                >
                  {copiedPrompt === "claude" ? "✓ Copied!" : "📋 Copy"}
                </button>
              </div>
              <pre className="prompt-content">{prompts.claude}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
