import { AiProviderAdapter } from "./AiProviderAdapter.js";

/**
 * Manual External Provider Adapter
 * Does NOT call external APIs.
 * Instead, formats prompts for manual use in:
 * - Cline
 * - Cursor
 * - GitHub Copilot
 * - Claude Web
 * - Gemini Web
 */
export class ManualExternalProviderAdapter extends AiProviderAdapter {
  constructor() {
    super({
      code: "manual_external",
      name: "Manual External (Cline/Cursor/Claude Web)",
      type: "manual"
    });
  }

  async isConfigured() {
    return true;
  }

  getConfigError() {
    return "";
  }

  async run(params) {
    try {
      const { modelName, messages, temperature = 0.7, maxTokens = 2000 } = params;

      // Format messages for external tools
      const formattedPrompt = this._formatForExternalTool(messages);

      // For manual external, we return the formatted prompt
      // User will copy this and paste it into their external tool (Cline, Cursor, etc.)
      return {
        success: true,
        outputText: formattedPrompt,
        isCopyablePrompt: true,
        modelHint: modelName || "Use your preferred external tool (Cline, Cursor, Claude Web, etc.)",
        instructions: "Copy the prompt above and paste it into your external tool. Then copy the output back here."
      };
    } catch (error) {
      console.error("Manual External adapter error:", error.message);
      return {
        success: false,
        error: error.message || "Manual External adapter error"
      };
    }
  }

  /**
   * Format messages for external tools like Cline, Cursor
   */
  _formatForExternalTool(messages) {
    const parts = [];
    
    parts.push("=".repeat(60));
    parts.push("PROMPT FOR EXTERNAL TOOL (Cline, Cursor, Claude Web, etc.)");
    parts.push("=".repeat(60));
    parts.push("");

    for (const msg of messages) {
      if (msg.role === "user") {
        parts.push("[USER]");
        parts.push(msg.content);
      } else if (msg.role === "assistant") {
        parts.push("[ASSISTANT]");
        parts.push(msg.content);
      } else if (msg.role === "system") {
        parts.push("[SYSTEM]");
        parts.push(msg.content);
      }
      parts.push("");
    }

    parts.push("=".repeat(60));
    parts.push("INSTRUCTIONS:");
    parts.push("1. Copy the above prompt");
    parts.push("2. Paste into: Cline, Cursor, Claude Web, or Gemini Web");
    parts.push("3. Run and get output");
    parts.push("4. Copy output and paste back into AgentRun");
    parts.push("=".repeat(60));

    return parts.join("\n");
  }
}
