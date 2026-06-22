import express from "express";

import authRoutes from "./auth.routes.js";
import chatRoutes from "./chat.routes.js";
import imageRoutes from "./image.routes.js";
import adminRoutes from "./admin.routes.js";
import configRoutes from "./config.routes.js";
import adminAiRoutes from "./adminai.routes.js";
import aiagentRoutes from "../modules/aiagent/aiagent.routes.js";
import projectMemoryRoutes from "../modules/projectmemory/projectmemory.routes.js";
import taskWorkflowRoutes from "../modules/taskworkflow/taskworkflow.routes.js";
import workspaceRoutes from "../modules/workspace/workspace.routes.js";
import { runAgentPrompt } from "../modules/aiagent/aiagent.controller.js";

import usageRoutes from "./usage.js";
import paymentRoutes from "./payment.routes.js";
import legacyRoutes from "../routes.js";

const router = express.Router();

router.use("/", usageRoutes);
router.use("/", paymentRoutes);

router.use("/", authRoutes);
router.use("/", chatRoutes);
router.use("/", imageRoutes);
router.use("/", adminRoutes);
router.use("/", configRoutes);
router.use("/", adminAiRoutes);
router.use("/ai", aiagentRoutes);
router.use("/project-memory", projectMemoryRoutes);
router.use("/task-workflows", taskWorkflowRoutes);
router.use("/workspaces", workspaceRoutes);
router.post("/agents/run", runAgentPrompt);
router.use("/", legacyRoutes);

export default router;
