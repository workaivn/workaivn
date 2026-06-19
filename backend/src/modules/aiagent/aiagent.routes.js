import express from "express";
import * as controller from "./aiagent.controller.js";

const router = express.Router();

// Providers
router.get("/providers", controller.getProviders);

// Agents
router.get("/agents", controller.getAgents);

// Tasks
router.get("/tasks", controller.getTasks);
router.post("/tasks", controller.createTask);
router.get("/tasks/:taskId", controller.getTaskDetail);
router.put("/tasks/:taskId", controller.updateTask);
router.post("/tasks/:taskId/run", controller.runTask);
router.post("/tasks/:taskId/run-multiple", controller.runTaskMultiple);
router.get("/tasks/:taskId/runs", controller.getTaskRuns);
router.post("/tasks/:taskId/compare", controller.compareRuns);

// Prompt Templates
router.get("/prompt-templates", controller.getPromptTemplates);
router.post("/prompt-templates", controller.createPromptTemplate);

export default router;
