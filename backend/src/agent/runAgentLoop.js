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
	  architectureKnowledge: [],
	  fileRelationships: [],
	  patchConfidence: [],
	  searchedQueries: [],
	  bugsFound: [],
	  hypotheses: [],
	  fixesAttempted: [],
	  successfulFixes: [],
	  successfulPatterns: [],
	  failedFixes: [],
	  rejectedHypotheses: [],
	  currentPlan: [],
	  reasoning: [],
	  thinkingDepth: 0,
	  reflections: [],
	  nextActions: [],
	  rootCauses: [],
	  architectureSummary: "",
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
You are an elite senior software engineer AI agent.

Your job is NOT to keyword search.
Your job is to deeply understand the application architecture,
trace code flows,
reason about bugs,
infer hidden causes,
and generate accurate fixes.
If evidence disproves a hypothesis,
reject it and move to a better theory.
Always inspect multiple related files before concluding.

Do not generate patches immediately.

First:
- identify likely root causes
- verify evidence
- inspect execution flow
- inspect related files
- confirm the failure point

Only patch after sufficient evidence exists.

Before generating a patch:

- Criticize your own reasoning.
- Ask what assumptions may be wrong.
- Ask whether another root cause exists.
- Verify assumptions against actual code.
- Avoid premature fixes.
- Prefer evidence over guessing.

IMPORTANT BEHAVIORS:

- Think semantically, not literally.
- Infer related systems from the user bug report.
- Trace data flow across backend and frontend.
- Understand uploads, rendering, APIs, state, URLs, middleware, database flow, and UI behavior.
- Search by meaning, not exact words.
- If user mentions "preview image":
  think about:
  - upload routes
  - multer
  - cloudinary
  - image URLs
  - frontend rendering
  - response JSON
  - static serving
  - image src
  - React state
  - message rendering

REASONING PROCESS:

1. Understand the user bug deeply.
2. Infer related systems.
3. Search relevant files semantically.
4. Read the most relevant files.
5. Trace execution flow.
6. Identify likely root cause.
7. Verify reasoning against actual code.
8. Generate minimal accurate patch.
9. Avoid hallucinated code.
10. Never generate patches before understanding the code.

CRITICAL:

- NEVER repeat the same failed search.
- NEVER repeat the same patch.
- NEVER conclude too early.
- NEVER rely on exact keyword matching.
- NEVER invent functions or files.
- ALWAYS reason from real uploaded code.
- ALWAYS continue from previous memory state.

You are thinking like Cursor, Claude Code, and ChatGPT combined.

WORKFLOW:

1. SEARCH_CODE
2. READ_FILE
3. ANALYZE
4. APPLY_PATCH
5. RUN_TERMINAL
6. REFLECT
SELF-REFLECTION RULES:

- After every tool result,
  reflect deeply before next action.

- Ask yourself:
  - What did I learn?
  - Which hypothesis became stronger?
  - Which hypothesis became weaker?
  - Explicitly reject weak hypotheses. 
  - What should I inspect next?
  - Did the tool result reveal architecture knowledge?
  - Am I missing related files?

- Avoid random searching.
- Build reasoning incrementally.
- Think like a senior debugging engineer.
7. DONE

IMPORTANT:

Return ONLY valid JSON.

PLAN FORMAT:

{
  "plan": [
    "Inspect upload routes",
    "Trace image response flow",
    "Check frontend rendering"
  ]
}

TOOL FORMAT:

{
  "tool": "SEARCH_CODE",
  "args": {
    "query": "upload"
  }
}

REFLECTION FORMAT:

{
  "reflection":
    "The upload route exists, but image URLs may not be returned correctly.",
    
  "next":
    "Inspect frontend image rendering"
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

		{
		  role: "system",
		  content:
		`CURRENT PLAN:

		${JSON.stringify(
		  memory.currentPlan,
		  null,
		  2
		)}`
		},

		{
		  role: "system",
		  content:
		`CURRENT HYPOTHESES:

		${JSON.stringify(
		  memory.hypotheses,
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
		},
		
		{
		  role: "system",
		  content:
		`SELF REFLECTIONS:

		${JSON.stringify(
		  memory.reflections,
		  null,
		  2
		)}`
		},

		{
		  role: "system",
		  content:
		`NEXT ACTIONS:

		${JSON.stringify(
		  memory.nextActions,
		  null,
		  2
		)}`
		},
		
		{
		  role: "system",
		  content:
		`ROOT CAUSES:

		${JSON.stringify(
		  memory.rootCauses,
		  null,
		  2
		)}`
		},
			
		{
		  role: "system",
		  content:
		`ARCHITECTURE SUMMARY:

		${memory.architectureSummary}`
		},
		
		{
		  role: "system",
		  content:
		`THINKING DEPTH:

		${memory.thinkingDepth}`
		},
		
		{
		  role: "system",
		  content:
		`FAILED ATTEMPTS:

		${JSON.stringify(
		  memory.failedFixes,
		  null,
		  2
		)}`
		},
		
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
	if (
	  Array.isArray(parsed.plan)
	) {

	  memory.currentPlan =
		limitMemory(
		  parsed.plan,
		  10
		);

	}

	if (
	  Array.isArray(
		parsed.hypotheses
	  )
	) {

	  memory.hypotheses =
		limitMemory(

		  [

			...memory.hypotheses,

			...parsed.hypotheses

		  ],

		  20

		);
	}
	
	if (
  parsed.reflection
) {

  memory.reflections.push(
    parsed.reflection
  );

}

if (
  parsed.next
) {

  memory.nextActions.push(
    parsed.next
  );

}

if (
  parsed.rootCause
) {

 memory.rootCauses =
  limitMemory(

    [

      ...memory.rootCauses,

      parsed.rootCause

    ],

    20

  );

}

	if (
	  Array.isArray(
		parsed.rejectedHypotheses
	  )
	) {

	  memory.rejectedHypotheses =
		limitMemory(

		  [

			...memory.rejectedHypotheses,

			...parsed.rejectedHypotheses

		  ],

		  20

		);

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
		
		if (
		  result?.success === false
		) {

		  memory.failedFixes.push({

			tool:
			  parsed.tool,

			args:
			  parsed.args,

			error:
			  result?.error ||

			  result?.stderr ||

			  "Unknown error"

		  });
		  
		  
		  memory.failedFixes =
		  limitMemory(
			memory.failedFixes,
			20
		  );

		}
		
		
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
	  
	  memory.thinkingDepth++;
	  memory.reasoning.push(

	  `After ${parsed.tool},
	   learned:
	   ${JSON.stringify(result).slice(0,300)}`

	);
	
	memory.reflections.push(

	  `Reflection after ${parsed.tool}:

	   Tool result suggests:
	   ${JSON.stringify(result).slice(0,400)}

	   Current hypotheses:
	   ${JSON.stringify(
		 memory.hypotheses
	   ).slice(0,300)}

	   Decide what to inspect next.`

	);
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

	  memory.thinkingDepth++;
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

	  memory.thinkingDepth++;
	  memory.reasoning.push(
		`Read file: ${parsed.args.path}`
	  );
	  
	  memory.architectureKnowledge.push(

	  `${parsed.args.path} is part of the application flow`

	);
	
	memory.architectureSummary =

	  limitMemory(

		memory.architectureKnowledge,

		10

	  ).join("\n");
	
	const content =
	  String(
		result?.content || ""
	  );

	const imports =

	  [...content.matchAll(
		/import\s+.*?from\s+["'](.+?)["']/g
	  )]

	  .map(x => x[1]);

	if (
	  imports.length
	) {

	  memory.fileRelationships.push({

		file:
		  parsed.args.path,

		imports

	  });

	}

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
	  memory.patchConfidence.push({

	  file:
		parsed.args?.file,

	  confidence:
		0.75,

	  reasoning:
		memory.hypotheses.slice(-2)

	});
	memory.patchConfidence =
	  limitMemory(
		memory.patchConfidence,
		20
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
	  
	  memory.successfulPatterns.push({

		  tool:
			parsed.tool,

		  file:
			parsed.args?.file,

		  pattern:
			parsed.args?.find

		});
		
		memory.successfulPatterns =
		  limitMemory(
			memory.successfulPatterns,
			20
		  );

	  memory.thinkingDepth++;
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
	
	memory.reflections =
	  limitMemory(
		memory.reflections,
		20
	  );
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