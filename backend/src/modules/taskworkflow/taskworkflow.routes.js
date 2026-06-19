import express from "express";
import * as controller from "./taskworkflow.controller.js";

const router = express.Router();

router.get("/", controller.getWorkflows);
router.get("/:workflowId", controller.getWorkflowDetail);
router.post("/", controller.createWorkflow);
router.put("/:workflowId", controller.updateWorkflow);
router.post("/:workflowId/run", controller.runWorkflow);
router.delete("/:workflowId", controller.deleteWorkflow);

export default router;