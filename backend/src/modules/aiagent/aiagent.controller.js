import AiProvider from "../../models/AiProvider.js";
import AiAgent from "../../models/AiAgent.js";
import AgentTask from "../../models/AgentTask.js";
import AgentRun from "../../models/AgentRun.js";
import AgentPromptTemplate from "../../models/AgentPromptTemplate.js";
import { providerRegistry } from "../../services/adapters/index.js";

/**
 * Get all AI Providers with configuration status
 */
export async function getProviders(req, res) {
  try {
    const providers = await AiProvider.find({ isActive: true });

    const result = await Promise.all(
      providers.map(async (p) => ({
        _id: p._id,
        name: p.name,
        code: p.code,
        type: p.type,
        isActive: p.isActive,
        isConfigured: await providerRegistry.isConfigured(p.code),
        configError: providerRegistry.getConfigError(p.code),
        createdAt: p.createdAt
      }))
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("getProviders error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch providers",
      error: error.message
    });
  }
}

/**
 * Get all AI Agents
 */
export async function getAgents(req, res) {
  try {
    const { agentType, providerCode } = req.query;

    const filter = { isActive: true };

    if (agentType) {
      filter.agentType = agentType;
    }

    if (providerCode) {
      const provider = await AiProvider.findOne({ code: providerCode });
      if (provider) {
        filter.providerId = provider._id;
      }
    }

    const agents = await AiAgent.find(filter)
      .populate("providerId", "code name type")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: agents
    });
  } catch (error) {
    console.error("getAgents error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch agents",
      error: error.message
    });
  }
}

/**
 * Get all Agent Tasks
 */
export async function getTasks(req, res) {
  try {
    const { status, taskType } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const filter = {};
    if (status) filter.status = status;
    if (taskType) filter.taskType = taskType;

    const tasks = await AgentTask.find(filter)
      .populate("selectedAgentId", "name code modelName")
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json({
      success: true,
      data: tasks
    });
  } catch (error) {
    console.error("getTasks error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tasks",
      error: error.message
    });
  }
}

/**
 * Get task detail with runs
 */
export async function getTaskDetail(req, res) {
  try {
    const { taskId } = req.params;

    const task = await AgentTask.findById(taskId)
      .populate("selectedAgentId", "name code modelName")
      .populate("createdBy", "email");

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    const runs = await AgentRun.find({ taskId })
      .populate("agentId", "name code modelName")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: {
        task,
        runs
      }
    });
  } catch (error) {
    console.error("getTaskDetail error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch task detail",
      error: error.message
    });
  }
}

/**
 * Create new Agent Task
 */
export async function createTask(req, res) {
  try {
    const { title, inputPrompt, taskType, normalizedPrompt } = req.body;

    if (!title || !inputPrompt || !taskType) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: title, inputPrompt, taskType"
      });
    }

    const task = new AgentTask({
      title,
      inputPrompt,
      normalizedPrompt: normalizedPrompt || inputPrompt,
      taskType,
      status: "draft"
    });

    await task.save();

    return res.status(201).json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error("createTask error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create task",
      error: error.message
    });
  }
}

/**
 * Run Agent Task with selected agent
 */
export async function runTask(req, res) {
  try {
    const { taskId } = req.params;
    const { agentId } = req.body;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: agentId"
      });
    }

    // Get task
    const task = await AgentTask.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    // Get agent
    const agent = await AiAgent.findById(agentId).populate("providerId");
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found"
      });
    }

    // Create run
    const run = new AgentRun({
      taskId,
      agentId,
      providerCode: agent.providerId.code,
      modelName: agent.modelName,
      inputPrompt: task.normalizedPrompt || task.inputPrompt,
      status: "pending"
    });

    await run.save();

    // Get provider adapter
    const adapter = providerRegistry.getAdapter(agent.providerId.code);

    // Check if configured
    const isConfigured = await adapter.isConfigured();
    if (!isConfigured) {
      run.status = "error";
      run.errorMessage = adapter.getConfigError();
      await run.save();

      return res.status(400).json({
        success: false,
        message: "Provider not configured",
        error: adapter.getConfigError(),
        runId: run._id
      });
    }

    // Run adapter
    run.status = "running";
    run.startedAt = new Date();
    await run.save();

    const result = await adapter.run({
      modelName: agent.modelName,
      messages: [
        {
          role: "system",
          content: agent.systemPrompt
        },
        {
          role: "user",
          content: run.inputPrompt
        }
      ],
      temperature: agent.temperature,
      maxTokens: agent.maxTokens
    });

    run.status = result.success ? "completed" : "error";
    run.outputText = result.outputText || "";
    run.rawResponse = result.rawResponse || null;
    run.errorMessage = result.error || null;
    run.completedAt = new Date();
    await run.save();

    return res.json({
      success: result.success,
      data: run,
      message: result.success ? "Task completed" : result.error
    });
  } catch (error) {
    console.error("runTask error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to run task",
      error: error.message
    });
  }
}

/**
 * Get Agent Runs for a task
 */
export async function getTaskRuns(req, res) {
  try {
    const { taskId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const runs = await AgentRun.find({ taskId })
      .populate("agentId", "name code modelName")
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json({
      success: true,
      data: runs
    });
  } catch (error) {
    console.error("getTaskRuns error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch runs",
      error: error.message
    });
  }
}

/**
 * Get all Prompt Templates
 */
export async function getPromptTemplates(req, res) {
  try {
    const { taskType } = req.query;

    const filter = { isActive: true };
    if (taskType) {
      filter.taskType = taskType;
    }

    const templates = await AgentPromptTemplate.find(filter).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error("getPromptTemplates error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch templates",
      error: error.message
    });
  }
}

/**
 * Create new Prompt Template
 */
export async function createPromptTemplate(req, res) {
  try {
    const { title, description, taskType, content, variables } = req.body;

    if (!title || !taskType || !content) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: title, taskType, content"
      });
    }

    const template = new AgentPromptTemplate({
      title,
      description,
      taskType,
      content,
      variables: variables || [],
      isActive: true
    });

    await template.save();

    return res.status(201).json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error("createPromptTemplate error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create template",
      error: error.message
    });
  }
}

/**
 * Run task with multiple agents in parallel
 */
export async function runTaskMultiple(req, res) {
  try {
    const { taskId } = req.params;
    const { agentIds } = req.body;

    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: agentIds (non-empty array)"
      });
    }

    if (agentIds.length > 5) {
      return res.status(400).json({
        success: false,
        message: "Maximum 5 agents can run at once"
      });
    }

    // Get task
    const task = await AgentTask.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    // Update task status
    task.status = "running";
    await task.save();

    // Create runs for all agents
    const runs = [];
    for (const agentId of agentIds) {
      const agent = await AiAgent.findById(agentId).populate("providerId");
      if (!agent) continue;

      const run = new AgentRun({
        taskId,
        agentId,
        providerCode: agent.providerId.code,
        modelName: agent.modelName,
        inputPrompt: task.normalizedPrompt || task.inputPrompt,
        status: "pending"
      });

      await run.save();
      runs.push(run);
    }

    // Run all agents in parallel
    const runPromises = runs.map(async (run) => {
      try {
        const agent = await AiAgent.findById(run.agentId).populate("providerId");
        const adapter = providerRegistry.getAdapter(agent.providerId.code);

        const isConfigured = await adapter.isConfigured();
        if (!isConfigured) {
          run.status = "error";
          run.errorMessage = adapter.getConfigError();
          await run.save();
          return run;
        }

        run.status = "running";
        run.startedAt = new Date();
        await run.save();

        const result = await adapter.run({
          modelName: agent.modelName,
          messages: [
            {
              role: "system",
              content: agent.systemPrompt
            },
            {
              role: "user",
              content: run.inputPrompt
            }
          ],
          temperature: agent.temperature,
          maxTokens: agent.maxTokens
        });

        run.status = result.success ? "completed" : "error";
        run.outputText = result.outputText || "";
        run.rawResponse = result.rawResponse || null;
        run.errorMessage = result.error || null;
        run.completedAt = new Date();
        await run.save();

        return run;
      } catch (error) {
        run.status = "error";
        run.errorMessage = error.message;
        await run.save();
        return run;
      }
    });

    const completedRuns = await Promise.all(runPromises);

    // Update task status based on results
    const allCompleted = completedRuns.every(r => r.status !== "pending" && r.status !== "running");
    if (allCompleted) {
      const hasError = completedRuns.some(r => r.status === "error");
      task.status = hasError ? "completed" : "completed";
    }
    await task.save();

    return res.json({
      success: true,
      data: {
        task,
        runs: completedRuns
      },
      message: `Executed ${completedRuns.length} agents`
    });
  } catch (error) {
    console.error("runTaskMultiple error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to run task with multiple agents",
      error: error.message
    });
  }
}

/**
 * Compare outputs from multiple runs
 */
export async function compareRuns(req, res) {
  try {
    const { taskId } = req.params;
    const { runIds } = req.body;

    if (!runIds || !Array.isArray(runIds) || runIds.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Need at least 2 runIds to compare"
      });
    }

    const runs = await AgentRun.find({ _id: { $in: runIds }, taskId })
      .populate("agentId", "name code modelName");

    if (runs.length < 2) {
      return res.status(400).json({
        success: false,
        message: "At least 2 valid runs required for comparison"
      });
    }

    const comparison = {
      taskId,
      runs: runs.map(r => ({
        runId: r._id,
        agentName: r.agentId.name,
        agentCode: r.agentId.code,
        modelName: r.modelName,
        status: r.status,
        outputLength: r.outputText?.length || 0,
        outputPreview: r.outputText?.substring(0, 200) || "",
        completedAt: r.completedAt,
        errorMessage: r.errorMessage
      })),
      completedAt: new Date()
    };

    return res.json({
      success: true,
      data: comparison
    });
  } catch (error) {
    console.error("compareRuns error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to compare runs",
      error: error.message
    });
  }
}

/**
 * Update task details
 */
export async function updateTask(req, res) {
  try {
    const { taskId } = req.params;
    const { title, inputPrompt, taskType, normalizedPrompt } = req.body;

    const task = await AgentTask.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    // Update fields if provided
    if (title) task.title = title;
    if (inputPrompt) task.inputPrompt = inputPrompt;
    if (taskType) task.taskType = taskType;
    if (normalizedPrompt) task.normalizedPrompt = normalizedPrompt;

    await task.save();

    return res.json({
      success: true,
      data: task,
      message: "Task updated successfully"
    });
  } catch (error) {
    console.error("updateTask error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update task",
      error: error.message
    });
  }
}
