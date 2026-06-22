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

const tools = {

  READ_FILE: readFileTool,

  WRITE_FILE: writeFileTool,

  LIST_FILES: listFilesTool,

  SEARCH_CODE: searchCodeTool,

  RUN_TERMINAL: runTerminalTool,
  
  APPLY_PATCH: applyPatchTool,

	SEARCH_SYMBOL:
	  searchSymbolTool,

  VALIDATE_PATCH:
    validatePatchTool,

};

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

    const result = await tool({
      ...args,
      activeFiles: normalizedContext.activeFiles || [],
      workspaceRoot: normalizedContext.workspaceRoot
    });

    return result;

  } catch (error) {

    return {
      success: false,
      error: error.message,
    };

  }

}
