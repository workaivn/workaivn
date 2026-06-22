import express from "express";
import multer from "multer";
import * as controller from "./workspace.controller.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

router.get("/", controller.listWorkspaces);
router.post("/", controller.createWorkspace);
router.post("/upload-zip", upload.single("file"), controller.uploadZipWorkspace);
router.get("/:id/tree", controller.getWorkspaceTree);
router.get("/:id/file", controller.getWorkspaceFile);
router.put("/:id/file", controller.putWorkspaceFile);
router.post("/:id/run-terminal", controller.runWorkspaceTerminal);
router.post("/:id/apply-patch", controller.applyWorkspacePatch);
router.get("/:id/download-zip", controller.downloadWorkspaceZip);

export default router;
