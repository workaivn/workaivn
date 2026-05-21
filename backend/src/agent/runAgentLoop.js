import { askAI }
  from "../services/aiRouter.js";

import { executeTool }
  from "./toolExecutor.js";

function emitStatus(

  history,

  text

) {

  history.push({

    type: "status",

    text,

    time:
      Date.now()

  });

}

function limitMemory(

  arr,

  max = 20

) {

  return arr.slice(-max);

}

export async function runAgentLoop({

  messages = [],

  plan = "free",

  activeFiles = [],

  maxSteps = 10

}) {

  const history = [];
	const memory = {
	  objective: "",
	  discoveredFiles: [],
	  discoveredFunctions: [],
	  searchedQueries: [],
	  bugsFound: [],
	  hypotheses: [],
	  fixesAttempted: [],
	  successfulFixes: [],
	  failedFixes: [],
	  currentPlan: [],
	  reasoning: [],
	  patches: [],
	  modifiedFiles: [],
	  terminalOutputs: []
	};
	memory.objective =

	  messages
		?.slice(-1)?.[0]
		?.content || "";
  let emptySearchCount = 0;
  for (
    let step = 0;
    step < maxSteps;
    step++
  ) {

    const system = `

DO NOT TEACH THE USER.
DO NOT EXPLAIN.
DO NOT SHOW CODE EXAMPLES.
YOU MUST EXECUTE USING TOOLS.

You are WorkAI Agent.

AVAILABLE TOOLS:

- READ_FILE
- APPLY_PATCH
- LIST_FILES
- SEARCH_CODE
- RUN_TERMINAL

CRITICAL RULES:

- You MUST use tools.
- NEVER answer directly without tools.
- ALWAYS inspect code before fixing.
- ALWAYS search relevant files first.
- Search semantically, not literally.
- If user mentions "preview image", also inspect upload, multer, image routes, file URLs, frontend rendering, response JSON, and image paths.
- Infer related code concepts from the bug description.
- Do not rely only on exact keyword matches.
- Think like a senior software engineer debugging a real app.
- NEVER invent file contents.
- NEVER skip tool usage.
- Think step-by-step.
- Think like a senior software engineer debugging a real production app.
- Search semantically, not literally.
- Infer related concepts from the bug description.
- If user mentions image preview, also inspect:
  - upload handlers
  - multer config
  - image URLs
  - response JSON
  - frontend rendering
  - static file serving
  - cloudinary
  - image src paths
- Do not rely only on exact keyword matches.
- Follow code flow across related files.
- Use reasoning before generating patches.
- NEVER conclude "code not found" only because an exact keyword does not exist.

WORKFLOW:

1. SEARCH_CODE
2. READ_FILE
3. ANALYZE
4. APPLY_PATCH
5. RUN_TERMINAL
6. REFLECT
7. DONE

IMPORTANT:

Return ONLY valid JSON.

TOOL FORMAT:

{
  "tool": "SEARCH_CODE",
  "args": {
    "query": "upload"
  }
}

DONE FORMAT:

{
  "done": true,
  "final": "Task completed"
}

NO markdown.
NO explanation.
NO extra text.
JSON only.

`;
	if (
	  emptySearchCount >= 3
	) {

	  return {

		final:
	`Không tìm thấy đoạn code liên quan trong project.`,

		history

	  };

	}
    const aiResponse =
      await askAI({

        messages: [

		  {
			role: "system",
			content: system
		  },

		  {
			role: "system",
			content:
		`AGENT MEMORY:

		${JSON.stringify(
		  memory,
		  null,
		  2
		)}`
		  },

		  ...messages,

		  {
			role: "system",
			content:
		`TOOL HISTORY:

		${JSON.stringify(
		  history,
		  null,
		  2
		)}`
		  }

		],

        mode: "agent",

        plan

      });
	  
	  
	  console.log(
		  "\n=== AGENT STEP ===",
		  step
		);

		console.log(
		  "RAW AI RESPONSE:\n",
		  aiResponse
		);

    let parsed = null;

    try {

      parsed =
        JSON.parse(aiResponse);

    } catch {

      return {
        success: false,
        error:
          "AI returned invalid JSON",
        raw: aiResponse
      };

    }

    /* =====================
       DONE
    ===================== */
	const lastTool =
	  history[
		history.length - 1
	  ];

	if (

	  parsed.done &&

	  lastTool?.result?.success === false

	) {

	  continue;

	}
	
	if (

	  parsed.PATCH?.length ||

	  parsed.patch?.length

	) {

	  return {

		success: true,

		final:
		  JSON.stringify(
			parsed,
			null,
			2
		  ),

		history

	  };

	}
	
    if (parsed.done) {

      return {
        success: true,
        final:
          parsed.final,
        history
      };

    }
	
	if (

	  parsed.final &&

	  !parsed.tool

	) {

	  return {

		success: false,

		final:
		  parsed.final,

		history

	  };

	}

    /* =====================
       TOOL
    ===================== */

    if (parsed.tool) {
		
		if (

		  parsed.tool ===
		  "SEARCH_CODE"

		) {

		  const q =
			parsed.args?.query;

		  if (

			  q &&

			  memory.searchedQueries.includes(q)

			) {

			  emptySearchCount++;

			  continue;

			}

		}
		
	const result =
        await executeTool(

		  parsed.tool,

		  parsed.args || {},

		  activeFiles || []

		);
		
		console.log(
		  "TOOL RESULT:\n",
		  JSON.stringify(
			result,
			null,
			2
		  )
		);

      history.push({

        step,

        tool:
          parsed.tool,

        args:
          parsed.args,

        result

      });
	  
	  if (

	  parsed.tool ===
		"SEARCH_CODE"

	  &&

	  result?.success

	  &&

	  Array.isArray(
		result.results
	  )

	  &&

	  result.results.length === 0

	) {

	  emptySearchCount++;

	} else {

	  emptySearchCount = 0;

	}
	  
	  /* =====================
	   MEMORY UPDATE
	===================== */
	if (
	  parsed.tool ===
	  "SEARCH_CODE"
	) {

	  if (
		parsed.args?.query &&
		!memory.searchedQueries.includes(
		  parsed.args.query
		)
	  ) {

		memory.searchedQueries.push(
		  parsed.args.query
		);

	  }

	  memory.reasoning.push(
		`Searched codebase for: ${parsed.args.query}`
	  );

	}

	if (
	  parsed.tool ===
	  "READ_FILE"
	) {

	  if (
		parsed.args?.path &&
		!memory.discoveredFiles.includes(
		  parsed.args.path
		)
	  ) {

		memory.discoveredFiles.push(
		  parsed.args.path
		);

	  }

	  memory.reasoning.push(
		`Read file: ${parsed.args.path}`
	  );

	}

	if (
	  parsed.tool ===
	  "APPLY_PATCH"
	) {

		const alreadyPatched =

			  memory.modifiedFiles.some(

				x =>

				  x.file ===
					parsed.args?.file

				  &&

				  x.find ===
					parsed.args?.find

			  );

			if (
			  alreadyPatched
			) {

			  continue;

			}


	  memory.patches.push(
		parsed.args
	  );
	memory.modifiedFiles.push({

	  file:
		parsed.args?.file,

	  find:
		parsed.args?.find,

	  replace:
		parsed.args?.replace,

	  time:
		Date.now()

	});
	  memory.successfulFixes.push(
		parsed.args?.file ||
		"unknown"
	  );

	  memory.reasoning.push(
		`Generated patch for ${parsed.args?.file}`
	  );

	}

	if (
	  parsed.tool ===
	  "RUN_TERMINAL"
	) {

	  memory.terminalOutputs.push(

		String(
		  result?.output || ""
		).slice(0, 2000)

	  );

	}
		  memory.reasoning =
	  limitMemory(
		memory.reasoning,
		30
	  );

	memory.discoveredFiles =
	  limitMemory(
		memory.discoveredFiles,
		30
	  );

	memory.searchedQueries =
	  limitMemory(
		memory.searchedQueries,
		20
	  );

	memory.patches =
	  limitMemory(
		memory.patches,
		10
	  );
	  memory.modifiedFiles =
	  limitMemory(
		memory.modifiedFiles,
		20
	  );

	memory.terminalOutputs =
	  limitMemory(
		memory.terminalOutputs,
		10
	  );
  
	  console.log(
		  "HISTORY LENGTH:",
		  history.length
		);
		console.log(
		  "MODIFIED FILES:",
		  JSON.stringify(
			memory.modifiedFiles,
			null,
			2
		  )
		);
		if (
		  parsed.tool ===
		  "APPLY_PATCH"
		) {

		  return {

			success: true,

			final:
			  JSON.stringify(
				{
				  PATCH: [
					parsed.args
				  ]
				},
				null,
				2
			  ),

			patch:
			  parsed.args,

			history

		  };

		} 

    }
	
  }

  return {

  success: false,

  final:
    "Agent không tìm thấy kết quả phù hợp.",

  history

};

}