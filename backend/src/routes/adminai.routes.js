import express from "express";
import axios from "axios";
import { isAdmin } from "../middleware/isAdmin.js";
import AiProvider from "../models/AiProvider.js";
import AiAgent from "../models/AiAgent.js";
import AgentTask from "../models/AgentTask.js";
import AgentRun from "../models/AgentRun.js";
import AgentPromptTemplate from "../models/AgentPromptTemplate.js";

const router = express.Router();

/* =====================================================
   SEED AGENT HUB (admin trigger)
===================================================== */
router.post("/admin/seed-agents", isAdmin, async (req, res) => {
  try {
    const existingProviders = await AiProvider.countDocuments();
    const existingAgents = await AiAgent.countDocuments();

    const providers = [
      { name: "OpenAI", code: "openai", type: "api", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY", isActive: true },
      { name: "Google Gemini", code: "gemini", type: "api", baseUrl: "https://generativelanguage.googleapis.com", apiKeyEnv: "GEMINI_API_KEY", isActive: true },
      { name: "Anthropic Claude", code: "anthropic", type: "api", baseUrl: "https://api.anthropic.com/v1", apiKeyEnv: "ANTHROPIC_API_KEY", isActive: true },
      { name: "OpenRouter", code: "openrouter", type: "api", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", isActive: true },
      { name: "Manual External Tools", code: "manual_external", type: "manual", apiKeyEnv: null, isActive: true }
    ];

    // Upsert providers
    let providerMap = new Map();
    for (const p of providers) {
      const doc = await AiProvider.findOneAndUpdate(
        { code: p.code }, p, { upsert: true, new: true }
      );
      providerMap.set(p.code, doc._id);
    }

    const agents = [
      {
        providerId: providerMap.get("openai"), name: "GPT Coding Agent", code: "gpt_coding",
        description: "Advanced coding with GPT-4o", modelName: "gpt-4o-mini",
        agentType: "coding", capabilityTags: ["code", "refactor", "debugging", "testing"],
        systemPrompt: "You are an expert software engineer. Analyze problems carefully, write clean maintainable code, consider edge cases.",
        temperature: 0.5, maxTokens: 4000, isActive: true
      },
      {
        providerId: providerMap.get("gemini"), name: "Gemini Large Context Agent", code: "gemini_large",
        description: "Large context analysis with Gemini 1.5 Flash", modelName: "gemini-1.5-flash",
        agentType: "coding", capabilityTags: ["large_context", "analysis", "documentation"],
        systemPrompt: "You are a senior technical architect. Analyze large codebases, design system architecture, provide comprehensive documentation.",
        temperature: 0.4, maxTokens: 8000, isActive: true
      },
      {
        providerId: providerMap.get("anthropic"), name: "Claude Refactor Agent", code: "claude_refactor",
        description: "Specialized in UI/UX and refactoring", modelName: "claude-3-haiku-20240307",
        agentType: "refactoring", capabilityTags: ["ui", "ux", "react", "frontend"],
        systemPrompt: "You are a UI/UX expert. Improve user experience, refactor React components, optimize performance.",
        temperature: 0.6, maxTokens: 3000, isActive: true
      },
      {
        providerId: providerMap.get("openrouter"), name: "OpenRouter Agent", code: "openrouter_agent",
        description: "Cost-effective analysis via OpenRouter", modelName: "mistralai/mistral-7b-instruct",
        agentType: "coding", capabilityTags: ["cost_effective", "quick_analysis"],
        systemPrompt: "You are a practical software developer. Provide quick, actionable solutions.",
        temperature: 0.7, maxTokens: 2000, isActive: true
      },
      {
        providerId: providerMap.get("manual_external"), name: "Cline Manual Agent", code: "cline_manual",
        description: "Use Cline IDE extension manually", modelName: "manual",
        agentType: "manual", capabilityTags: ["manual", "cline", "local"],
        systemPrompt: "Copy the prompt below into your Cline IDE extension and run it manually.",
        temperature: 0.7, maxTokens: 2000, isActive: true
      },
      {
        providerId: providerMap.get("manual_external"), name: "Cursor Manual Agent", code: "cursor_manual",
        description: "Use Cursor IDE manually", modelName: "manual",
        agentType: "manual", capabilityTags: ["manual", "cursor", "local"],
        systemPrompt: "Copy the prompt below into your Cursor IDE and run it manually.",
        temperature: 0.7, maxTokens: 2000, isActive: true
      }
    ];

    let createdAgents = 0;
    for (const a of agents) {
      const exists = await AiAgent.findOne({ code: a.code });
      if (!exists) {
        await AiAgent.create(a);
        createdAgents++;
      }
    }

    return res.json({
      success: true,
      message: `Seed xong: ${providerMap.size} providers, ${createdAgents} agents mới (đã có ${existingProviders} providers, ${existingAgents} agents trước đó)`
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* =====================================================
   PROVIDERS
===================================================== */
router.get("/admin/providers", isAdmin, async (req, res) => {
  try {
    const list = await AiProvider.find().sort({ code: 1 });
    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/admin/providers", isAdmin, async (req, res) => {
  try {
    const provider = await AiProvider.create(req.body);
    return res.json({ success: true, data: provider });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.get("/admin/providers/:id", isAdmin, async (req, res) => {
  try {
    const p = await AiProvider.findById(req.params.id);
    if (!p) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: p });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/admin/providers/:id", isAdmin, async (req, res) => {
  try {
    const p = await AiProvider.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!p) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: p });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/admin/providers/:id", isAdmin, async (req, res) => {
  try {
    const usedByAgent = await AiAgent.findOne({ providerId: req.params.id });
    if (usedByAgent) {
      return res.status(400).json({ success: false, message: "Provider đang được dùng bởi agent, không thể xóa." });
    }
    await AiProvider.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/admin/providers/:id/test", isAdmin, async (req, res) => {
  try {
    const p = await AiProvider.findById(req.params.id);
    if (!p) return res.status(404).json({ success: false, message: "Not found" });

    if (p.type === "manual") {
      return res.json({ success: true, message: "Provider thủ công — không cần kết nối." });
    }

    if (p.code === "ollama") {
      const baseUrl = p.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
      const rootUrl = baseUrl.replace(/\/v1\/?$/, "");
      try {
        const resp = await axios.get(`${rootUrl}/api/tags`, { timeout: 3000 });
        const models = resp.data?.models || [];
        return res.json({
          success: true,
          message: `Ollama đang chạy tại ${rootUrl}. Số model: ${models.length}.`
        });
      } catch (e) {
        return res.json({
          success: false,
          message: `Không thể kết nối Ollama tại ${rootUrl}. Chạy: ollama serve (${e.message})`
        });
      }
    }

    const apiKey = process.env[p.apiKeyEnv || ""] || "";
    if (!apiKey && p.code !== "ollama") {
      return res.json({ success: false, message: `API key chưa được cấu hình (env: ${p.apiKeyEnv || "N/A"})` });
    }

    if (p.baseUrl) {
      try {
        await axios.get(`${p.baseUrl.replace(/\/v1\/?$/, "")}/v1/models`, {
          timeout: 3000,
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
        });
      } catch (e) {
        if (e.response?.status === 401 || e.response?.status === 403) {
          return res.json({ success: false, message: `API key không hợp lệ cho ${p.name}` });
        }
        return res.json({
          success: true,
          message: `${p.name} — API key OK (${apiKey ? "có key" : "không key"}), không thể verify baseUrl: ${e.message}`
        });
      }
    }

    return res.json({ success: true, message: `Provider "${p.name}" OK.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* =====================================================
   AGENTS
===================================================== */
router.get("/admin/agents", isAdmin, async (req, res) => {
  try {
    const list = await AiAgent.find().populate("providerId", "name code").sort({ name: 1 });
    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/admin/agents", isAdmin, async (req, res) => {
  try {
    const agent = await AiAgent.create(req.body);
    return res.json({ success: true, data: agent });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.get("/admin/agents/:id", isAdmin, async (req, res) => {
  try {
    const a = await AiAgent.findById(req.params.id).populate("providerId", "name code");
    if (!a) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: a });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/admin/agents/:id", isAdmin, async (req, res) => {
  try {
    const a = await AiAgent.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate("providerId", "name code");
    if (!a) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: a });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/admin/agents/:id", isAdmin, async (req, res) => {
  try {
    await AiAgent.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/admin/agents/:id/duplicate", isAdmin, async (req, res) => {
  try {
    const original = await AiAgent.findById(req.params.id).lean();
    if (!original) return res.status(404).json({ success: false, message: "Not found" });
    delete original._id;
    original.name = original.name + " (Copy)";
    original.code = original.code + "_copy_" + Date.now();
    const copy = await AiAgent.create(original);
    return res.json({ success: true, data: copy });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

/* =====================================================
   PROMPT TEMPLATES
===================================================== */
router.get("/admin/templates", isAdmin, async (req, res) => {
  try {
    const list = await AgentPromptTemplate.find().sort({ title: 1 });
    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/admin/templates", isAdmin, async (req, res) => {
  try {
    const t = await AgentPromptTemplate.create(req.body);
    return res.json({ success: true, data: t });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.patch("/admin/templates/:id", isAdmin, async (req, res) => {
  try {
    const t = await AgentPromptTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!t) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: t });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/admin/templates/:id", isAdmin, async (req, res) => {
  try {
    await AgentPromptTemplate.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
