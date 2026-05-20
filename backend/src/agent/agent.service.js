import { executeTool }
  from "./toolExecutor.js";

export async function runAgent({
  messages,
  model,
}) {

  let done = false;
  let attempts = 0;

  const history = [];

  while (!done && attempts < 10) {

    const aiResponse =
      await think({
        messages,
        history,
      });

    if (aiResponse.tool) {

      const result =
        await executeTool(
          aiResponse.tool,
          aiResponse.args
        );

      history.push({
        tool: aiResponse.tool,
        result,
      });
    }

    if (aiResponse.done) {
      done = true;

      return aiResponse.final;
    }

    attempts++;
  }

  return "Agent stopped.";
}