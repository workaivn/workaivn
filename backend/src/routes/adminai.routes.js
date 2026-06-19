import express from "express";
import { isAdmin } from "../middleware/isAdmin.js";
import AiProvider from "../models/AiProvider.js";
import AiAgent from "../models/AiAgent.js";
import AgentTask from "../models/AgentTask.js";
import AgentRun from "../models/AgentRun.js";
import AgentPromptTemplate from "../models/AgentPromptTemplate.js";

const router = express.Router();

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

    const apiKey = process.env[p.apiKeyEnv || ""] || "";
    if (!apiKey && p.type === "api") {
      return res.json({ success: false, message: `API key chưa được cấu hình (env: ${p.apiKeyEnv || "N/A"})` });
    }
    if (p.type === "manual") {
      return res.json({ success: true, message: "Provider thủ công — không cần kết nối." });
    }

    return res.json({ success: true, message: `Provider "${p.name}" có API key. Kiểm tra thực tế khi chạy task.` });
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
