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

	  terminalOutputs: []

	};
	memory.objective =

	  messages
		?.slice(-1)?.[0]
		?.content || "";
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
- NEVER invent file contents.
- NEVER skip tool usage.
- Think step-by-step.

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

    if (parsed.done) {

      return {
        success: true,
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

			emitStatus(

			  history,

			  `⚠️ Skip duplicate search: "${q}"`

			);

			continue;

		  }

		}
		
	const result =
        await executeTool(

          parsed.tool,

          parsed.args || {}

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

	  memory.patches.push(
		parsed.args
	  );

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

	memory.terminalOutputs =
	  limitMemory(
		memory.terminalOutputs,
		10
	  );
  
	  console.log(
		  "HISTORY LENGTH:",
		  history.length
		);
		
		if (
		  parsed.tool ===
		  "APPLY_PATCH"
		) {

		  return {

			success: true,

			final:
				"",

			patch:
			  parsed.args,

			history

		  };

		} 

    }
	
  }

  return {
    success: false,
    error:
      "Agent max steps reached"
  };

}