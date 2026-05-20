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

RULES:

- Always think step-by-step
- Use tools when needed
- Return ONLY valid JSON
- No markdown
- No explanation

FORMAT:

Tool usage:

{
  "tool": "READ_FILE",
  "args": {
    "path": "src/App.jsx"
  }
}

Done:

{
  "done": true,
  "final": "Task completed"
}

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