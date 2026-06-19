import express from "express";
import { isAdmin } from "../middleware/isAdmin.js";
import SystemSetting from "../models/SystemSetting.js";
import { invalidateCache } from "../services/ConfigResolverService.js";
import AiProvider from "../models/AiProvider.js";
import AiAgent from "../models/AiAgent.js";
import AgentTask from "../models/AgentTask.js";
import AgentRun from "../models/AgentRun.js";
import AgentPromptTemplate from "../models/AgentPromptTemplate.js";
import ProjectMemory from "../models/ProjectMemory.js";
import User from "../modules/auth/auth.model.js";
import Payment from "../models/Payment.js";

const router = express.Router();

/* -------------------------------------------------------
   DASHBOARD
------------------------------------------------------- */
router.get("/admin/dashboard", isAdmin, async (req, res) => {
  try {
    const [
      totalUsers, proUsers, businessUsers,
      totalProviders, activeProviders,
      totalAgents, totalTasks,
      completedRuns, failedRuns,
      totalTemplates, totalMemories
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ plan: "pro" }),
      User.countDocuments({ plan: "business" }),
      AiProvider.countDocuments(),
      AiProvider.countDocuments({ isActive: true }),
      AiAgent.countDocuments(),
      AgentTask.countDocuments(),
      AgentRun.countDocuments({ status: "completed" }),
      AgentRun.countDocuments({ status: "failed" }),
      AgentPromptTemplate.countDocuments(),
      ProjectMemory.countDocuments()
    ]);

    let revenue = 0;
    try {
      const payments = await Payment.find({ status: "approved" });
      payments.forEach(p => { revenue += p.amount || 0; });
    } catch {}

    const recentTasks = await AgentTask.find()
      .sort({ createdAt: -1 }).limit(5)
      .select("title taskType status createdAt");

    const recentRuns = await AgentRun.find()
      .sort({ createdAt: -1 }).limit(5)
      .populate("agentId", "name")
      .select("status createdAt agentId");

    // default provider from settings or first active
    const defaultProvider = await AiProvider.findOne({ isActive: true })
      .select("name code").lean();

    // free plan limit from SystemSetting or fallback
    const freeLimitSetting = await SystemSetting.findOne({ key: "FREE_PLAN_CHAT_LIMIT" });
    const freePlanLimit = freeLimitSetting?.value || "10";

    return res.json({
      success: true,
      data: {
        users: { total: totalUsers, pro: proUsers, business: businessUsers },
        providers: { total: totalProviders, active: activeProviders },
        agents: totalAgents,
        tasks: totalTasks,
        runs: { completed: completedRuns, failed: failedRuns },
        templates: totalTemplates,
        memories: totalMemories,
        revenue,
        recentTasks,
        recentRuns,
        defaultProvider: defaultProvider?.name || "—",
        freePlanLimit
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* -------------------------------------------------------
   CONFIG — GET ALL
------------------------------------------------------- */
router.get("/admin/config", isAdmin, async (req, res) => {
  try {
    const settings = await SystemSetting.find().sort({ group: 1, key: 1 });
    return res.json({
      success: true,
      data: settings.map(s => s.toSafeObject())
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* -------------------------------------------------------
   CONFIG — GET BY GROUP
------------------------------------------------------- */
router.get("/admin/config/:group", isAdmin, async (req, res) => {
  try {
    const settings = await SystemSetting.find({ group: req.params.group }).sort({ key: 1 });
    return res.json({
      success: true,
      data: settings.map(s => s.toSafeObject())
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* -------------------------------------------------------
   CONFIG — PATCH SINGLE KEY
------------------------------------------------------- */
router.patch("/admin/config", isAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ success: false, message: "key required" });

    const setting = await SystemSetting.findOne({ key });
    if (!setting) return res.status(404).json({ success: false, message: "Setting not found" });

    if (setting.isReadOnly) {
      return res.status(403).json({ success: false, message: "This setting is read-only" });
    }

    // if secret and empty string → keep old value
    if (setting.isSecret && (value === "" || value === undefined)) {
      return res.json({ success: true, data: setting.toSafeObject() });
    }

    setting.value = String(value ?? "");
    await setting.save();
    invalidateCache();

    return res.json({ success: true, data: setting.toSafeObject() });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* -------------------------------------------------------
   CONFIG — PATCH GROUP
------------------------------------------------------- */
router.patch("/admin/config/:group", isAdmin, async (req, res) => {
  try {
    const { updates } = req.body; // [{ key, value }]
    if (!Array.isArray(updates)) {
      return res.status(400).json({ success: false, message: "updates array required" });
    }

    const results = [];
    for (const { key, value } of updates) {
      const setting = await SystemSetting.findOne({ key, group: req.params.group });
      if (!setting || setting.isReadOnly) continue;
      if (setting.isSecret && (value === "" || value === undefined)) continue;
      setting.value = String(value ?? "");
      await setting.save();
      results.push(setting.toSafeObject());
    }

    invalidateCache();
    return res.json({ success: true, data: results });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* -------------------------------------------------------
   PUBLIC APP CONFIG (branding/landing safe keys)
------------------------------------------------------- */
router.get("/app/config", async (req, res) => {
  try {
    const settings = await SystemSetting.find({ isPublic: true }).sort({ group: 1, key: 1 });
    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });
    return res.json({ success: true, data: map });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* -------------------------------------------------------
   PUBLIC PLANS
------------------------------------------------------- */
router.get("/app/plans", async (req, res) => {
  try {
    const settings = await SystemSetting.find({ group: "plans" }).sort({ key: 1 });
    if (!settings.length) {
      // fallback from plans.js constants
      const { PLANS } = await import("../config/plans.js");
      return res.json({ success: true, data: PLANS, source: "constant" });
    }

    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });

    const plans = {
      free: {
        name: map.FREE_PLAN_NAME || "Free",
        price: Number(map.FREE_PLAN_PRICE || 0),
        limits: {
          chatPerDay: Number(map.FREE_PLAN_CHAT_LIMIT || 10),
          filePerDay: Number(map.FREE_PLAN_FILE_LIMIT || 3),
          imagePerDay: Number(map.FREE_PLAN_IMAGE_LIMIT || 2),
          toolPerDay: Number(map.FREE_PLAN_TOOL_LIMIT || 5)
        }
      },
      pro: {
        name: map.PRO_PLAN_NAME || "Pro",
        price: Number(map.PRO_PLAN_PRICE || 99000),
        limits: {
          chatPerDay: Number(map.PRO_PLAN_CHAT_LIMIT || 200),
          filePerDay: Number(map.PRO_PLAN_FILE_LIMIT || 30),
          imagePerDay: Number(map.PRO_PLAN_IMAGE_LIMIT || 20),
          toolPerDay: Number(map.PRO_PLAN_TOOL_LIMIT || 100)
        }
      },
      business: {
        name: map.BUSINESS_PLAN_NAME || "Business",
        price: Number(map.BUSINESS_PLAN_PRICE || 499000),
        limits: {
          chatPerDay: 999999,
          filePerDay: 999999,
          imagePerDay: 999999,
          toolPerDay: 999999
        }
      }
    };

    return res.json({ success: true, data: plans, source: "db" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
