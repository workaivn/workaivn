import TaskWorkflow from "../../models/TaskWorkflow.js";
import AgentTask from "../../models/AgentTask.js";
import AiAgent from "../../models/AiAgent.js";
import AgentRun from "../../models/AgentRun.js";
import { providerRegistry } from "../../services/adapters/index.js";
import { createProviderRouter } from "../../agent/providers/index.js";
import { normalizePrompt } from "../../services/PromptNormalizer.js";

function sortSteps(steps = []) {
  return [...steps].sort((left, right) => (left.order || 0) - (right.order || 0));
}

function buildStepPrompt(basePrompt, workflow, previousOutput, step) {
  return [
    `WORKFLOW TITLE: ${workflow.title}`,
    workflow.description ? `WORKFLOW DESCRIPTION: ${workflow.description}` : "",
    `SOURCE TASK: ${basePrompt}`,
    previousOutput ? `PREVIOUS STEP OUTPUT:\n${previousOutput}` : "",
    `CURRENT STEP: ${step.title}`,
    `STEP INSTRUCTION:\n${step.instruction}`,
    "Return the next actionable output for this step."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildProviderRequestFromAgent(agent = {}) {
  const providerId = agent.providerId?.code || agent.providerId?.id || agent.providerId || agent.providerCode || null;
  return {
    providerId: providerId ? String(providerId) : null,
    model: agent.modelName || agent.model || null,
    providers: [agent].filter(Boolean)
  };
}

export async function getWorkflows(req, res) {
  try {
    const { status, sourceTaskId, limit = 30 } = req.query;
    const filter = { isActive: true };

    if (status) filter.status = status;
    if (sourceTaskId) filter.sourceTaskId = sourceTaskId;

    const workflows = await TaskWorkflow.find(filter)
      .populate("sourceTaskId", "title taskType status")
      .populate("steps.agentId", "name code modelName")
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit) || 30, 100));

    return res.json({ success: true, data: workflows });
  } catch (error) {
    console.error("getWorkflows error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch workflows", error: error.message });
  }
}

export async function getWorkflowDetail(req, res) {
  try {
    const { workflowId } = req.params;
    const workflow = await TaskWorkflow.findById(workflowId)
      .populate("sourceTaskId", "title inputPrompt normalizedPrompt taskType status")
      .populate("steps.agentId", "name code modelName providerId")
      .populate("steps.agentId.providerId", "code name type");

    if (!workflow || !workflow.isActive) {
      return res.status(404).json({ success: false, message: "Workflow not found" });
    }

    return res.json({ success: true, data: workflow });
  } catch (error) {
    console.error("getWorkflowDetail error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch workflow", error: error.message });
  }
}

export async function createWorkflow(req, res) {
  try {
    const { title, description, sourceTaskId, steps } = req.body;

    if (!title || !sourceTaskId || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ success: false, message: "title, sourceTaskId, and steps are required" });
    }

    const sourceTask = await AgentTask.findById(sourceTaskId);
    if (!sourceTask) {
      return res.status(404).json({ success: false, message: "Source task not found" });
    }

    const normalizedSteps = steps.map((step, index) => ({
      order: Number(step.order || index + 1),
      title: step.title || `Step ${index + 1}`,
      agentId: step.agentId,
      instruction: step.instruction || "",
      status: "pending"
    }));

    for (const step of normalizedSteps) {
      if (!step.agentId || !step.instruction) {
        return res.status(400).json({ success: false, message: "Each step requires agentId and instruction" });
      }
    }

    const workflow = new TaskWorkflow({
      title,
      description,
      sourceTaskId,
      steps: normalizedSteps,
      status: "draft"
    });

    await workflow.save();

    return res.status(201).json({ success: true, data: workflow });
  } catch (error) {
    console.error("createWorkflow error:", error);
    return res.status(500).json({ success: false, message: "Failed to create workflow", error: error.message });
  }
}

export async function updateWorkflow(req, res) {
  try {
    const { workflowId } = req.params;
    const { title, description, sourceTaskId, steps } = req.body;

    const workflow = await TaskWorkflow.findById(workflowId);
    if (!workflow || !workflow.isActive) {
      return res.status(404).json({ success: false, message: "Workflow not found" });
    }

    if (title) workflow.title = title;
    if (description !== undefined) workflow.description = description;
    if (sourceTaskId) workflow.sourceTaskId = sourceTaskId;
    if (Array.isArray(steps)) {
      workflow.steps = steps.map((step, index) => ({
        order: Number(step.order || index + 1),
        title: step.title || `Step ${index + 1}`,
        agentId: step.agentId,
        instruction: step.instruction || "",
        status: step.status || "pending",
        inputPrompt: step.inputPrompt || "",
        outputText: step.outputText || "",
        errorMessage: step.errorMessage || "",
        startedAt: step.startedAt || null,
        completedAt: step.completedAt || null
      }));
    }

    await workflow.save();

    return res.json({ success: true, data: workflow });
  } catch (error) {
    console.error("updateWorkflow error:", error);
    return res.status(500).json({ success: false, message: "Failed to update workflow", error: error.message });
  }
}

export async function runWorkflow(req, res) {
  try {
    const { workflowId } = req.params;

    const workflow = await TaskWorkflow.findById(workflowId)
      .populate("sourceTaskId", "title inputPrompt normalizedPrompt taskType status")
      .populate("steps.agentId", "name code modelName systemPrompt temperature maxTokens providerId")
      .populate("steps.agentId.providerId", "code name type");

    if (!workflow || !workflow.isActive) {
      return res.status(404).json({ success: false, message: "Workflow not found" });
    }

    const sourceTask = await AgentTask.findById(workflow.sourceTaskId._id);
    if (!sourceTask) {
      return res.status(404).json({ success: false, message: "Source task not found" });
    }

    workflow.status = "running";
    workflow.lastRunAt = new Date();
    workflow.errorMessage = "";
    await workflow.save();

    const sortedSteps = sortSteps(workflow.steps);
    const normalizedSource = sourceTask.normalizedPrompt || normalizePrompt(sourceTask.inputPrompt, sourceTask.taskType);
    let previousOutput = "";
    const stepResults = [];
    const providerRouter = createProviderRouter({
      adapterRegistry: providerRegistry,
      allowFallback: false
    });

    for (const step of sortedSteps) {
      const agent = step.agentId;
      const providerCode = agent.providerId.code;
      const adapter = providerRegistry.getAdapter(providerCode);
      const isConfigured = await adapter.isConfigured();

      step.status = "running";
      step.startedAt = new Date();
      step.inputPrompt = buildStepPrompt(normalizedSource, workflow, previousOutput, step);
      await workflow.save();

      const run = new AgentRun({
        taskId: sourceTask._id,
        agentId: agent._id,
        providerCode,
        modelName: agent.modelName,
        inputPrompt: step.inputPrompt,
        status: "pending"
      });

      await run.save();

      if (!isConfigured) {
        const errorMessage = adapter.getConfigError();
        run.status = "error";
        run.errorMessage = errorMessage;
        await run.save();

        step.status = "failed";
        step.errorMessage = errorMessage;
        step.completedAt = new Date();
        workflow.status = "failed";
        workflow.errorMessage = errorMessage;
        await workflow.save();

        return res.status(400).json({ success: false, message: "One of the workflow agents is not configured", error: errorMessage, data: workflow });
      }

      run.status = "running";
      run.startedAt = new Date();
      await run.save();

      const result = await providerRouter.generate({
        ...buildProviderRequestFromAgent(agent),
        messages: [
          { role: "system", content: agent.systemPrompt },
          { role: "user", content: step.inputPrompt }
        ],
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        purpose: "code_generation"
      });

      run.status = result.success ? "completed" : "error";
      run.outputText = result.normalizedText || result.text || "";
      run.rawResponse = result.rawResponse || null;
      run.errorMessage = result.success ? null : (result.error?.message || result.error?.type || null);
      run.completedAt = new Date();
      await run.save();

      step.status = result.success ? "completed" : "failed";
      step.outputText = result.normalizedText || result.text || "";
      step.errorMessage = result.success ? null : (result.error?.message || result.error?.type || null);
      step.completedAt = new Date();
      previousOutput = result.normalizedText || result.text || previousOutput;
      stepResults.push({ stepId: step._id, runId: run._id, status: run.status });

      if (!result.success) {
        workflow.status = "failed";
        workflow.errorMessage = result.error?.message || result.error?.type || "Workflow step failed";
        workflow.finalOutput = previousOutput;
        await workflow.save();

        return res.status(500).json({
          success: false,
          message: "Workflow step failed",
          error: result.error?.message || result.error?.type || "Unknown error",
          data: workflow,
          stepResults
        });
      }
    }

    workflow.status = "completed";
    workflow.finalOutput = previousOutput;
    workflow.errorMessage = "";
    await workflow.save();

    return res.json({ success: true, data: workflow, stepResults });
  } catch (error) {
    console.error("runWorkflow error:", error);
    return res.status(500).json({ success: false, message: "Failed to run workflow", error: error.message });
  }
}

export async function deleteWorkflow(req, res) {
  try {
    const { workflowId } = req.params;
    const workflow = await TaskWorkflow.findByIdAndUpdate(workflowId, { isActive: false }, { new: true });

    if (!workflow) {
      return res.status(404).json({ success: false, message: "Workflow not found" });
    }

    return res.json({ success: true, message: "Workflow deleted successfully" });
  } catch (error) {
    console.error("deleteWorkflow error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete workflow", error: error.message });
  }
}
