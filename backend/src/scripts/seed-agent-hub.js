import "dotenv/config";
import dns from "node:dns";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
import mongoose from "mongoose";
import AiProvider from "../models/AiProvider.js";
import AiAgent from "../models/AiAgent.js";
import AgentPromptTemplate from "../models/AgentPromptTemplate.js";

// Connect to MongoDB
async function connect() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

// Seed providers
async function seedProviders() {
  console.log("\n📦 Seeding AI Providers...");

  const providers = [
    {
      name: "OpenAI",
      code: "openai",
      type: "api",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      isActive: true
    },
    {
      name: "Google Gemini",
      code: "gemini",
      type: "api",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKeyEnv: "GEMINI_API_KEY",
      isActive: true
    },
    {
      name: "Anthropic Claude",
      code: "anthropic",
      type: "api",
      baseUrl: "https://api.anthropic.com/v1",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      isActive: true
    },
    {
      name: "OpenRouter",
      code: "openrouter",
      type: "api",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      isActive: true
    },
    {
      name: "Manual External Tools",
      code: "manual_external",
      type: "manual",
      apiKeyEnv: null,
      isActive: true
    },
    {
      name: "Ollama Local",
      code: "ollama",
      type: "api",
      baseUrl: "http://localhost:11434/v1",
      apiKeyEnv: "OLLAMA_API_KEY",
      isActive: true
    },
    {
      name: "Groq",
      code: "groq",
      type: "api",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKeyEnv: "GROQ_API_KEY",
      isActive: true
    },
    {
      name: "DeepSeek",
      code: "deepseek",
      type: "api",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      isActive: true
    },
    {
      name: "Together AI",
      code: "together",
      type: "api",
      baseUrl: "https://api.together.xyz/v1",
      apiKeyEnv: "TOGETHER_API_KEY",
      isActive: true
    },
    {
      name: "Fireworks AI",
      code: "fireworks",
      type: "api",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      apiKeyEnv: "FIREWORKS_API_KEY",
      isActive: true
    },
    {
      name: "Mistral AI",
      code: "mistral",
      type: "api",
      baseUrl: "https://api.mistral.ai/v1",
      apiKeyEnv: "MISTRAL_API_KEY",
      isActive: true
    },
    {
      name: "Cerebras",
      code: "cerebras",
      type: "api",
      baseUrl: "https://api.cerebras.ai/v1",
      apiKeyEnv: "CEREBRAS_API_KEY",
      isActive: true
    },
    {
      name: "Perplexity",
      code: "perplexity",
      type: "api",
      baseUrl: "https://api.perplexity.ai",
      apiKeyEnv: "PERPLEXITY_API_KEY",
      isActive: true
    },
    {
      name: "xAI",
      code: "xai",
      type: "api",
      baseUrl: "https://api.x.ai/v1",
      apiKeyEnv: "XAI_API_KEY",
      isActive: true
    },
    {
      name: "OpenAI Compatible Custom",
      code: "openai_compatible",
      type: "api",
      baseUrl: "",
      apiKeyEnv: "CUSTOM_OPENAI_API_KEY",
      isActive: true
    }
  ];

  let upsertedCount = 0;
  for (const provider of providers) {
    await AiProvider.findOneAndUpdate(
      { code: provider.code },
      { $setOnInsert: provider },
      { upsert: true, new: true }
    );
    upsertedCount++;
  }

  const allProviders = await AiProvider.find({});
  console.log(`✅ Upserted ${upsertedCount} providers (${allProviders.length} total)`);

  return new Map(allProviders.map(p => [p.code, p._id]));
}

// Seed agents
async function seedAgents(providerMap) {
  console.log("\n🤖 Seeding AI Agents...");

  const agents = [
    {
      providerId: providerMap.get("openai"),
      name: "GPT Coding Agent",
      code: "gpt_coding",
      description: "Advanced coding with GPT-4o Mini",
      modelName: process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini",
      agentType: "coding",
      priority: 20,
      capabilityTags: ["code", "refactor", "debugging", "testing"],
      systemPrompt: `You are an expert software engineer. Your task is to help write, refactor, debug, and test code. Always:
1. Analyze the problem carefully
2. Provide clear explanations
3. Write clean, maintainable code
4. Consider edge cases
5. Test your solutions`,
      temperature: 0.5,
      maxTokens: 4000,
      isActive: true
    },
    {
      providerId: providerMap.get("gemini"),
      name: "Gemini Coding Agent",
      code: "gemini_coding",
      description: "Coding with Gemini 2.0 Flash",
      modelName: process.env.GEMINI_DEFAULT_MODEL || "gemini-2.0-flash",
      agentType: "coding",
      priority: 30,
      capabilityTags: ["coding", "analysis"],
      systemPrompt: `You are an expert software engineer. Analyze, modify, and improve code using available tools (READ_FILE, WRITE_FILE, APPLY_PATCH, LIST_FILES, RUN_TERMINAL). Always return valid JSON.`,
      temperature: 0.5,
      maxTokens: 8000,
      isActive: true
    },
    {
      providerId: providerMap.get("anthropic"),
      name: "Claude UI Refactor Agent",
      code: "claude_ui",
      description: "Specialized in UI/UX improvements",
      modelName: "claude-3-opus-20240229",
      agentType: "refactoring",
      capabilityTags: ["ui", "ux", "react", "frontend"],
      systemPrompt: `You are a UI/UX expert. Your focus is on:
1. Improving user experience
2. Refactoring React components
3. Accessibility (a11y) improvements
4. Performance optimization
5. Design system consistency`,
      temperature: 0.6,
      maxTokens: 3000,
      isActive: true
    },
    {
      providerId: providerMap.get("openrouter"),
      name: "OpenRouter Cheap Agent",
      code: "openrouter_cheap",
      description: "Cost-effective analysis with OpenRouter",
      modelName: "gpt-3.5-turbo",
      agentType: "coding",
      priority: 10,
      capabilityTags: ["cost_effective", "quick_analysis"],
      systemPrompt: `You are a practical software developer. Your goal is to:
1. Provide quick, actionable solutions
2. Focus on cost efficiency
3. Suggest pragmatic approaches
4. Identify quick wins`,
      temperature: 0.7,
      maxTokens: 2000,
      isActive: true
    },
    {
      providerId: providerMap.get("manual_external"),
      name: "Cline Manual Agent",
      code: "cline_manual",
      description: "Use Cline IDE extension manually",
      modelName: "manual",
      agentType: "manual",
      capabilityTags: ["manual", "cline", "local"],
      systemPrompt: "Copy the prompt below into your Cline IDE extension and run it manually.",
      temperature: 0.7,
      maxTokens: 2000,
      isActive: true
    },
    {
      providerId: providerMap.get("manual_external"),
      name: "Cursor Manual Agent",
      code: "cursor_manual",
      description: "Use Cursor IDE manually",
      modelName: "manual",
      agentType: "manual",
      capabilityTags: ["manual", "cursor", "local"],
      systemPrompt: "Copy the prompt below into your Cursor IDE and run it manually.",
      temperature: 0.7,
      maxTokens: 2000,
      isActive: true
    },
    {
      providerId: providerMap.get("manual_external"),
      name: "Claude Web Manual Agent",
      code: "claude_web_manual",
      description: "Use Claude.ai web interface manually",
      modelName: "manual",
      agentType: "manual",
      capabilityTags: ["manual", "claude_web", "browser"],
      systemPrompt: "Copy the prompt below into Claude.ai and run it manually.",
      temperature: 0.7,
      maxTokens: 2000,
      isActive: true
    },
    {
      providerId: providerMap.get("ollama"),
      name: "Ollama Coding Agent",
      code: "ollama_coder",
      description: "Local coding with Ollama (qwen2.5-coder:7b)",
      modelName: "qwen2.5-coder:7b",
      agentType: "coding",
      priority: 40,
      capabilityTags: ["local", "coding", "offline"],
      systemPrompt: `You are an expert software engineer running locally via Ollama.
1. Analyze the problem carefully
2. Provide clear explanations
3. Write clean, maintainable code
4. Consider edge cases
5. Always return valid JSON when using agent tools`,
      temperature: 0.5,
      maxTokens: 4096,
      isActive: true
    },
    {
      providerId: providerMap.get("openai"),
      name: "Auto Coding Agent",
      code: "auto_coding",
      description: "Automatically tries coding agents in priority order with fallback",
      modelName: "auto",
      agentType: "coding",
      priority: 0,
      capabilityTags: ["auto", "fallback", "coding"],
      systemPrompt: `You are an expert software engineer. Analyze, modify, and improve code using available tools (READ_FILE, WRITE_FILE, APPLY_PATCH, LIST_FILES, RUN_TERMINAL). Always return valid JSON.`,
      temperature: 0.5,
      maxTokens: 4000,
      isActive: true
    },
    {
      providerId: providerMap.get("groq"),
      name: "Groq Coding Agent",
      code: "groq_coding",
      description: "Fast coding with Groq (llama-3.1-8b-instant)",
      modelName: "llama-3.1-8b-instant",
      agentType: "coding",
      priority: 50,
      capabilityTags: ["fast", "coding", "groq"],
      systemPrompt: `You are an expert software engineer. Analyze, modify, and improve code using available tools (READ_FILE, WRITE_FILE, APPLY_PATCH, LIST_FILES, RUN_TERMINAL). Always return valid JSON.`,
      temperature: 0.5,
      maxTokens: 4000,
      isActive: true
    },
    {
      providerId: providerMap.get("deepseek"),
      name: "DeepSeek Coding Agent",
      code: "deepseek_coding",
      description: "Advanced coding with DeepSeek",
      modelName: "deepseek-chat",
      agentType: "coding",
      priority: 50,
      capabilityTags: ["coding", "deepseek"],
      systemPrompt: `You are an expert software engineer. Analyze, modify, and improve code using available tools (READ_FILE, WRITE_FILE, APPLY_PATCH, LIST_FILES, RUN_TERMINAL). Always return valid JSON.`,
      temperature: 0.5,
      maxTokens: 4000,
      isActive: true
    },
    {
      providerId: providerMap.get("together"),
      name: "Together Coding Agent",
      code: "together_coding",
      description: "Cost-effective coding with Together AI",
      modelName: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      agentType: "coding",
      priority: 50,
      capabilityTags: ["coding", "together"],
      systemPrompt: `You are an expert software engineer. Analyze, modify, and improve code using available tools (READ_FILE, WRITE_FILE, APPLY_PATCH, LIST_FILES, RUN_TERMINAL). Always return valid JSON.`,
      temperature: 0.5,
      maxTokens: 4000,
      isActive: true
    },
    {
      providerId: providerMap.get("fireworks"),
      name: "Fireworks Coding Agent",
      code: "fireworks_coding",
      description: "Fast inference with Fireworks AI",
      modelName: "accounts/fireworks/models/llama-v3p1-8b-instruct",
      agentType: "coding",
      priority: 50,
      capabilityTags: ["coding", "fireworks"],
      systemPrompt: `You are an expert software engineer. Analyze, modify, and improve code using available tools (READ_FILE, WRITE_FILE, APPLY_PATCH, LIST_FILES, RUN_TERMINAL). Always return valid JSON.`,
      temperature: 0.5,
      maxTokens: 4000,
      isActive: true
    },
    {
      providerId: providerMap.get("mistral"),
      name: "Mistral Coding Agent",
      code: "mistral_coding",
      description: "Efficient coding with Mistral AI",
      modelName: "mistral-small-latest",
      agentType: "coding",
      priority: 50,
      capabilityTags: ["coding", "mistral"],
      systemPrompt: `You are an expert software engineer. Analyze, modify, and improve code using available tools (READ_FILE, WRITE_FILE, APPLY_PATCH, LIST_FILES, RUN_TERMINAL). Always return valid JSON.`,
      temperature: 0.5,
      maxTokens: 4000,
      isActive: true
    },
    {
      providerId: providerMap.get("cerebras"),
      name: "Cerebras Coding Agent",
      code: "cerebras_coding",
      description: "Fast coding with Cerebras",
      modelName: "llama3.1-8b",
      agentType: "coding",
      priority: 50,
      capabilityTags: ["coding", "cerebras"],
      systemPrompt: `You are an expert software engineer. Analyze, modify, and improve code using available tools (READ_FILE, WRITE_FILE, APPLY_PATCH, LIST_FILES, RUN_TERMINAL). Always return valid JSON.`,
      temperature: 0.5,
      maxTokens: 4000,
      isActive: true
    },
    {
      providerId: providerMap.get("perplexity"),
      name: "Perplexity Research Agent",
      code: "perplexity_research",
      description: "Research and documentation with Perplexity",
      modelName: "sonar",
      agentType: "documentation",
      priority: 50,
      capabilityTags: ["research", "documentation", "perplexity"],
      systemPrompt: `You are a research assistant. Analyze codebases, provide documentation, and research best practices. Always return valid JSON.`,
      temperature: 0.4,
      maxTokens: 4000,
      isActive: true
    },
    {
      providerId: providerMap.get("xai"),
      name: "xAI Coding Agent",
      code: "xai_coding",
      description: "Coding with xAI Grok",
      modelName: "grok-2-latest",
      agentType: "coding",
      priority: 50,
      capabilityTags: ["coding", "xai"],
      systemPrompt: `You are an expert software engineer. Analyze, modify, and improve code using available tools (READ_FILE, WRITE_FILE, APPLY_PATCH, LIST_FILES, RUN_TERMINAL). Always return valid JSON.`,
      temperature: 0.5,
      maxTokens: 4000,
      isActive: true
    },
    {
      providerId: providerMap.get("openai_compatible"),
      name: "Custom OpenAI Compatible Agent",
      code: "custom_openai_compatible",
      description: "Use any OpenAI-compatible API endpoint",
      modelName: process.env.CUSTOM_OPENAI_MODEL || "gpt-4o-mini",
      agentType: "coding",
      priority: 50,
      capabilityTags: ["custom", "openai_compatible", "coding"],
      systemPrompt: `You are an expert software engineer. Analyze, modify, and improve code using available tools (READ_FILE, WRITE_FILE, APPLY_PATCH, LIST_FILES, RUN_TERMINAL). Always return valid JSON.`,
      temperature: 0.5,
      maxTokens: 4000,
      isActive: true
    }
  ];

  let upsertedCount = 0;
  for (const agent of agents) {
    await AiAgent.findOneAndUpdate(
      { code: agent.code },
      { $set: agent },
      { upsert: true, new: true }
    );
    upsertedCount++;
  }
  // Migrate old agent codes to new model names
  await AiAgent.findOneAndUpdate(
    { code: "gemini_large" },
    { $set: { modelName: process.env.GEMINI_DEFAULT_MODEL || "gemini-2.0-flash", name: "Gemini Coding Agent", description: "Coding with Gemini 2.0 Flash" } }
  );
  await AiAgent.findOneAndUpdate(
    { code: "gpt_coding", modelName: "gpt-4-turbo" },
    { $set: { modelName: process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini" } }
  );
  const allAgents = await AiAgent.find({});
  console.log(`✅ Upserted ${upsertedCount} agents (${allAgents.length} total)`);
}

// Seed prompt templates
async function seedPromptTemplates() {
  console.log("\n📝 Seeding Prompt Templates...");

  const templates = [
    {
      title: "Build New Feature",
      description: "Template for building new features",
      taskType: "build_feature",
      content: `Task: Build a new feature

Requirements:
- Feature name: {{feature_name}}
- Description: {{description}}
- User story: {{user_story}}
- Acceptance criteria: {{acceptance_criteria}}

Context:
- Current stack: {{current_stack}}
- Related files: {{related_files}}

Please:
1. Design the feature architecture
2. Write implementation code
3. Include tests
4. Update documentation`,
      variables: ["feature_name", "description", "user_story", "acceptance_criteria", "current_stack", "related_files"],
      isActive: true
    },
    {
      title: "Fix Bug",
      description: "Template for debugging and fixing bugs",
      taskType: "fix_bug",
      content: `Task: Fix a bug

Bug Details:
- Title: {{bug_title}}
- Description: {{description}}
- Steps to reproduce: {{steps_to_reproduce}}
- Expected behavior: {{expected_behavior}}
- Actual behavior: {{actual_behavior}}

Context:
- Affected files: {{affected_files}}
- Error message: {{error_message}}

Please:
1. Analyze the root cause
2. Provide a fix
3. Explain the fix
4. Suggest prevention measures`,
      variables: ["bug_title", "description", "steps_to_reproduce", "expected_behavior", "actual_behavior", "affected_files", "error_message"],
      isActive: true
    },
    {
      title: "Refactor Code",
      description: "Template for refactoring existing code",
      taskType: "refactor",
      content: `Task: Refactor code

Refactoring Goal:
- Target: {{target}}
- Current issues: {{current_issues}}
- Desired outcome: {{desired_outcome}}

Code Context:
- Files involved: {{files_involved}}
- Current approach: {{current_approach}}

Please:
1. Analyze current implementation
2. Identify improvements
3. Provide refactored code
4. Ensure backward compatibility
5. Update tests if needed`,
      variables: ["target", "current_issues", "desired_outcome", "files_involved", "current_approach"],
      isActive: true
    },
    {
      title: "Review Code",
      description: "Template for code review",
      taskType: "review",
      content: `Task: Review code

Code to review:
{{code_snippet}}

Review focus:
- Check: {{review_focus}}
- Performance concerns: {{performance_concerns}}
- Security issues: {{security_issues}}

Please provide:
1. Best practice violations
2. Performance improvements
3. Security concerns
4. Code style issues
5. Suggestions for improvements`,
      variables: ["code_snippet", "review_focus", "performance_concerns", "security_issues"],
      isActive: true
    },
    {
      title: "Generate Documentation",
      description: "Template for auto-generating documentation",
      taskType: "documentation",
      content: `Task: Generate documentation

Code/Module: {{code_module}}
Purpose: {{purpose}}
Audience: {{audience}}

Please generate:
1. Module overview
2. API documentation
3. Usage examples
4. Configuration options
5. Troubleshooting guide`,
      variables: ["code_module", "purpose", "audience"],
      isActive: true
    },
    {
      title: "Split into Phases",
      description: "Template for breaking down project into phases",
      taskType: "phase_plan",
      content: `Task: Create a project plan

Project: {{project_name}}
Goal: {{project_goal}}
Constraints: {{constraints}}
Team size: {{team_size}}

Please provide:
1. Phase breakdown
2. Deliverables per phase
3. Time estimates
4. Dependencies
5. Risk assessment
6. Success metrics`,
      variables: ["project_name", "project_goal", "constraints", "team_size"],
      isActive: true
    }
  ];

  let upsertedCount = 0;
  for (const template of templates) {
    await AgentPromptTemplate.findOneAndUpdate(
      { title: template.title, taskType: template.taskType },
      { $setOnInsert: template },
      { upsert: true, new: true }
    );
    upsertedCount++;
  }
  const allTemplates = await AgentPromptTemplate.find({});
  console.log(`✅ Upserted ${upsertedCount} prompt templates (${allTemplates.length} total)`);
}

// Main seed function
async function seed() {
  try {
    console.log("🌱 Starting seed...\n");

    await connect();

    const providerMap = await seedProviders();
    await seedAgents(providerMap);
    await seedPromptTemplates();

    console.log("\n✅ Seed completed successfully!");

    await mongoose.disconnect();
    console.log("✅ Disconnected from MongoDB\n");
  } catch (error) {
    console.error("❌ Seed failed:", error.message);
    process.exit(1);
  }
}

seed();
