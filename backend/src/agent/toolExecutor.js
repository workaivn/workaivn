import { readFileTool }
  from "./tools/readFile.js";

import { writeFileTool }
  from "./tools/writeFile.js";

import { listFilesTool }
  from "./tools/listFiles.js";

import { searchCodeTool }
  from "./tools/searchCode.js";

import { runTerminalTool }
  from "./tools/runTerminal.js";

import { applyPatchTool }
  from "./tools/applyPatch.js";
  
import { searchSymbolTool }
  from "./tools/searchSymbol.js";

import { validatePatchTool }
  from "./tools/validatePatch.js";
import { normalizeWorkspaceRelativePath } from "./workspace.js";

const tools = {

  READ_FILE: readFileTool,

  WRITE_FILE: writeFileTool,

  LIST_FILES: listFilesTool,

  SEARCH_CODE: searchCodeTool,

  RUN_TERMINAL: runTerminalTool,
  
  APPLY_PATCH: applyPatchTool,

  CREATE_FILE: createFileTool,

  DELETE_FILE: deleteFileTool,

	SEARCH_SYMBOL:
	  searchSymbolTool,

  VALIDATE_PATCH:
    validatePatchTool,

};

function normalizeToolArgs(toolName, args = {}, context = {}) {
  const workspaceRoot = String(context?.workspaceRoot || "").trim();
  const normalizedArgs = { ...(args || {}) };

  const pathKeysByTool = {
    READ_FILE: ["path"],
    WRITE_FILE: ["path", "file", "target"],
    APPLY_PATCH: ["path", "file", "target"],
    VALIDATE_PATCH: ["path", "file", "target"],
    CREATE_FILE: ["path", "file", "target"],
    DELETE_FILE: ["path", "file", "target"]
  };

  const keys = pathKeysByTool[toolName] || [];
  for (const key of keys) {
    if (normalizedArgs[key] == null) continue;
    const candidate = normalizeWorkspaceRelativePath(normalizedArgs[key], workspaceRoot);
    if (!candidate) {
      throw new Error("File path escapes selected workspace and must be relative to the selected workspace");
    }
    normalizedArgs[key] = candidate;
  }

  if (normalizedArgs.path == null && normalizedArgs.file != null) {
    normalizedArgs.path = normalizedArgs.file;
  }
  if (normalizedArgs.file == null && normalizedArgs.path != null) {
    normalizedArgs.file = normalizedArgs.path;
  }
  if (normalizedArgs.target == null && normalizedArgs.path != null) {
    normalizedArgs.target = normalizedArgs.path;
  }

  return normalizedArgs;
}

export async function executeTool(
  toolName,
  args,
  context = {}
) {

  const tool = tools[toolName];

  if (!tool) {

    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
    };

  }

  try {

    const normalizedContext = Array.isArray(context)
      ? { activeFiles: context }
      : context;
    const normalizedArgs = normalizeToolArgs(toolName, args, normalizedContext);

    const result = await tool({
      ...normalizedArgs,
      activeFiles: normalizedContext.activeFiles || [],
      workspaceId: normalizedContext.workspaceId,
      workspaceRoot: normalizedContext.workspaceRoot,
      layout: normalizedContext.layout || null
    });

    return result;

  } catch (error) {

    return {
      success: false,
      error: error.message,
    };

  }

}
import { createFileTool }
  from "./tools/createFile.js";

import { deleteFileTool }
  from "./tools/deleteFile.js";
