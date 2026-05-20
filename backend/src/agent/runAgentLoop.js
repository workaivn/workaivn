import { askAI }
  from "../services/aiRouter.js";

import { executeTool }
  from "./toolExecutor.js";

export async function runAgentLoop({

  messages = [],

  plan = "free",

  maxSteps = 10

}) {

  const history = [];

  for (
    let step = 0;
    step < maxSteps;
    step++
  ) {

    const system = `

You are WorkAI Agent.

AVAILABLE TOOLS:

- READ_FILE
- WRITE_FILE
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
4. WRITE_FILE
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

          ...messages,

          {
            role: "system",
            content:
              JSON.stringify(
                history,
                null,
                2
              )
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

    }

  }

  return {
    success: false,
    error:
      "Agent max steps reached"
  };

}