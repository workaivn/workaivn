import ProjectMemory from "../../models/ProjectMemory.js";
import AgentTask from "../../models/AgentTask.js";

/**
 * Get all project memories
 */
export async function getMemories(req, res) {
  try {
    const { category, tags, importance, limit = 50, skip = 0 } = req.query;

    const query = { isActive: true };

    if (category) query.category = category;
    if (importance) query.importance = importance;
    if (tags) {
      const tagArray = tags.split(",").map(t => t.trim().toLowerCase());
      query.tags = { $in: tagArray };
    }

    const memories = await ProjectMemory.find(query)
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .sort({ importance: -1, lastUsed: -1 })
      .populate("linkedTasks", "title taskType status")
      .populate("linkedAgents", "name code");

    const total = await ProjectMemory.countDocuments(query);

    return res.json({
      success: true,
      data: memories,
      pagination: { total, limit: parseInt(limit), skip: parseInt(skip) }
    });
  } catch (error) {
    console.error("getMemories error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch memories",
      error: error.message
    });
  }
}

/**
 * Get memory by ID
 */
export async function getMemoryDetail(req, res) {
  try {
    const { memoryId } = req.params;

    const memory = await ProjectMemory.findByIdAndUpdate(
      memoryId,
      { lastUsed: new Date(), $inc: { viewCount: 1 } },
      { new: true }
    )
      .populate("linkedTasks", "title taskType status")
      .populate("linkedAgents", "name code");

    if (!memory) {
      return res.status(404).json({
        success: false,
        message: "Memory not found"
      });
    }

    return res.json({
      success: true,
      data: memory
    });
  } catch (error) {
    console.error("getMemoryDetail error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch memory",
      error: error.message
    });
  }
}

/**
 * Create new project memory
 */
export async function createMemory(req, res) {
  try {
    const { title, category, content, tags, relatedFiles, importance, linkedTasks, linkedAgents } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: "Title and content are required"
      });
    }

    const memory = new ProjectMemory({
      title,
      category: category || "project_context",
      content,
      tags: tags || [],
      relatedFiles: relatedFiles || [],
      importance: importance || "normal",
      linkedTasks: linkedTasks || [],
      linkedAgents: linkedAgents || [],
      isActive: true
    });

    await memory.save();

    return res.status(201).json({
      success: true,
      data: memory,
      message: "Memory created successfully"
    });
  } catch (error) {
    console.error("createMemory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create memory",
      error: error.message
    });
  }
}

/**
 * Update project memory
 */
export async function updateMemory(req, res) {
  try {
    const { memoryId } = req.params;
    const { title, category, content, tags, relatedFiles, importance, linkedTasks, linkedAgents } = req.body;

    const memory = await ProjectMemory.findById(memoryId);
    if (!memory) {
      return res.status(404).json({
        success: false,
        message: "Memory not found"
      });
    }

    if (title) memory.title = title;
    if (category) memory.category = category;
    if (content) memory.content = content;
    if (tags) memory.tags = tags;
    if (relatedFiles) memory.relatedFiles = relatedFiles;
    if (importance) memory.importance = importance;
    if (linkedTasks) memory.linkedTasks = linkedTasks;
    if (linkedAgents) memory.linkedAgents = linkedAgents;

    await memory.save();

    return res.json({
      success: true,
      data: memory,
      message: "Memory updated successfully"
    });
  } catch (error) {
    console.error("updateMemory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update memory",
      error: error.message
    });
  }
}

/**
 * Delete project memory
 */
export async function deleteMemory(req, res) {
  try {
    const { memoryId } = req.params;

    const memory = await ProjectMemory.findByIdAndUpdate(
      memoryId,
      { isActive: false },
      { new: true }
    );

    if (!memory) {
      return res.status(404).json({
        success: false,
        message: "Memory not found"
      });
    }

    return res.json({
      success: true,
      message: "Memory deleted successfully"
    });
  } catch (error) {
    console.error("deleteMemory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete memory",
      error: error.message
    });
  }
}

/**
 * Search memories by content
 */
export async function searchMemories(req, res) {
  try {
    const { query } = req.query;

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Query must be at least 2 characters"
      });
    }

    const memories = await ProjectMemory.find({
      isActive: true,
      $or: [
        { title: { $regex: query, $options: "i" } },
        { content: { $regex: query, $options: "i" } },
        { tags: { $regex: query, $options: "i" } }
      ]
    })
      .limit(20)
      .sort({ importance: -1, viewCount: -1 })
      .populate("linkedTasks", "title")
      .populate("linkedAgents", "name");

    return res.json({
      success: true,
      data: memories
    });
  } catch (error) {
    console.error("searchMemories error:", error);
    return res.status(500).json({
      success: false,
      message: "Search failed",
      error: error.message
    });
  }
}

/**
 * Link memory to task
 */
export async function linkMemoryToTask(req, res) {
  try {
    const { memoryId, taskId } = req.params;

    const memory = await ProjectMemory.findById(memoryId);
    const task = await AgentTask.findById(taskId);

    if (!memory || !task) {
      return res.status(404).json({
        success: false,
        message: "Memory or task not found"
      });
    }

    if (!memory.linkedTasks.includes(taskId)) {
      memory.linkedTasks.push(taskId);
      await memory.save();
    }

    return res.json({
      success: true,
      data: memory,
      message: "Memory linked to task"
    });
  } catch (error) {
    console.error("linkMemoryToTask error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to link memory",
      error: error.message
    });
  }
}

/**
 * Get memories for a specific task
 */
export async function getTaskMemories(req, res) {
  try {
    const { taskId } = req.params;

    const memories = await ProjectMemory.find({
      isActive: true,
      linkedTasks: taskId
    }).sort({ importance: -1 });

    return res.json({
      success: true,
      data: memories
    });
  } catch (error) {
    console.error("getTaskMemories error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch task memories",
      error: error.message
    });
  }
}
