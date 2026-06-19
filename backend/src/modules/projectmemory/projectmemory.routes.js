import express from "express";
import * as controller from "./projectmemory.controller.js";

const router = express.Router();

router.get("/", controller.getMemories);
router.get("/search", controller.searchMemories);
router.get("/:memoryId", controller.getMemoryDetail);
router.post("/", controller.createMemory);
router.put("/:memoryId", controller.updateMemory);
router.delete("/:memoryId", controller.deleteMemory);
router.post("/:memoryId/link-task/:taskId", controller.linkMemoryToTask);
router.get("/task/:taskId", controller.getTaskMemories);

export default router;