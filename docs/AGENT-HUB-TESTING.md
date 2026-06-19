# AI Agent Hub - Testing Guide

## Quick Start

### 1. Initialize Seed Data

First, populate the database with providers, agents, and templates:

```bash
cd backend
npm run seed:agents
```

Expected output:
```
🌱 Starting seed...

✅ Connected to MongoDB
📦 Seeding AI Providers...
✅ Created 5 providers
🤖 Seeding AI Agents...
✅ Created 7 agents
📝 Seeding Prompt Templates...
✅ Created 6 prompt templates

✅ Seed completed successfully!
✅ Disconnected from MongoDB
```

### 2. Start Backend Server

```bash
npm run dev
# Should output: Server running...
```

### 3. Start Frontend Server

In another terminal:

```bash
cd frontend
npm run dev
# Should output: VITE v5.x.x ready in XXX ms
# ➜ Local: http://localhost:5173/
```

### 4. Access Agent Hub

Open browser and navigate to:
```
http://localhost:5173/agent-hub
```

---

## Testing Each Feature

### Test 1: Load Providers

**Endpoint:** `GET /api/ai/providers`

**Using curl:**
```bash
curl http://localhost:5000/api/ai/providers
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "xxx",
      "name": "OpenAI",
      "code": "openai",
      "type": "api",
      "isActive": true,
      "isConfigured": true/false,
      "configError": ""
    },
    ...
  ]
}
```

**Frontend Test:**
1. Click "🔌 Providers" tab
2. Should see 5 providers listed
3. Check if ✅/❌ badges match configuration status

---

### Test 2: Load Agents

**Endpoint:** `GET /api/ai/agents`

**Using curl:**
```bash
curl http://localhost:5000/api/ai/agents
```

**Frontend Test:**
1. Click "🤖 Agents" tab
2. Should see 7 agents in grid
3. Each card shows: name, code, description, tags, model, provider

---

### Test 3: Load Prompt Templates

**Endpoint:** `GET /api/ai/prompt-templates`

**Using curl:**
```bash
curl http://localhost:5000/api/ai/prompt-templates
```

**Frontend Test:**
1. Click "📝 Templates" tab
2. Should see 6 templates
3. Try "Use Template" button - should populate form

---

### Test 4: Create New Task

**Endpoint:** `POST /api/ai/tasks`

**Using curl:**
```bash
curl -X POST http://localhost:5000/api/ai/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build Login Page",
    "inputPrompt": "Create a React login component with email and password",
    "taskType": "build_feature"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "_id": "xxx",
    "title": "Build Login Page",
    "inputPrompt": "Create a React login component...",
    "normalizedPrompt": "Create a React login component...",
    "taskType": "build_feature",
    "status": "draft",
    "selectedAgentId": null,
    "createdAt": "2026-06-19T10:00:00Z"
  }
}
```

**Frontend Test:**
1. Click "➕ New Task" tab
2. Fill form:
   - Title: "Test Feature"
   - Type: "build_feature"
   - Prompt: "Create a test component"
3. Click "✨ Create Task"
4. Switch to "📋 Tasks" - new task should appear

---

### Test 5: Run Task with Agent

**Endpoint:** `POST /api/ai/tasks/:taskId/run`

**Using curl (after getting taskId):**
```bash
curl -X POST http://localhost:5000/api/ai/tasks/TASK_ID/run \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "AGENT_ID"
  }'
```

**Note:** Must use an agent with configured API key for success

**Frontend Test:**
1. In "📋 Tasks" tab, click a task
2. Select an agent from dropdown (e.g., "GPT Coding Agent")
3. Click "▶ Run Agent"
4. Monitor status: pending → running → completed/error
5. View output below

---

### Test 6: Test with Manual External Agent

This is the key feature - works without API keys!

**Frontend Test:**
1. Create new task
2. Select "Cline Manual Agent" 
3. Click "▶ Run Agent"
4. Output will show formatted prompt
5. Click "📋 Copy" to copy
6. Paste into Cline IDE and run manually

---

## Expected Behaviors by Provider

### OpenAI (if OPENAI_API_KEY set)
✅ Fully configured - Run will work
- Uses gpt-4-turbo model
- Supports streaming via chunks
- Temperature: 0.5, Max tokens: 4000

### Gemini (if GEMINI_API_KEY set)
✅ Fully configured - Run will work
- Uses gemini-1.5-pro model
- Good for large context analysis
- Temperature: 0.4, Max tokens: 8000

### Anthropic (if ANTHROPIC_API_KEY set)
✅ Configured - Run will work
- Uses claude-3-opus-20240229
- Specialized in UI/UX refactoring
- Temperature: 0.6, Max tokens: 3000

### OpenRouter (if OPENROUTER_API_KEY set)
✅ Configured - Run will work
- Uses gpt-3.5-turbo for cost efficiency
- Temperature: 0.7, Max tokens: 2000

### Manual External (always available)
✅ Always configured - No API key needed
- Formats prompt for manual use
- Works with Cline, Cursor, Claude Web
- Perfect for testing UI/setup

---

## Testing Without API Keys

If you don't have API keys configured:

1. **Use Manual External Agent:**
   ```
   - Create task
   - Select "Cline Manual Agent" / "Cursor Manual Agent"
   - Run will succeed and show formatted prompt
   - Copy prompt and paste into external tool
   ```

2. **Check Provider Status:**
   ```
   Click "🔌 Providers" tab
   - OpenAI: ❌ Not Configured (OPENAI_API_KEY missing)
   - Gemini: ❌ Not Configured (GEMINI_API_KEY missing)
   - Manual External: ✅ Configured (no key needed)
   ```

3. **Add API Keys:**
   ```
   Edit backend/.env:
   OPENAI_API_KEY=sk-...
   GEMINI_API_KEY=AIzaSy...
   
   Restart server: npm run dev
   Providers will now show ✅ Configured
   ```

---

## Error Cases to Test

### Missing API Key Error
**Action:** Try to run with unconfigured provider
**Expected:** 
```json
{
  "success": false,
  "message": "Provider not configured",
  "error": "OPENAI_API_KEY is not set in environment variables"
}
```

### Invalid Task ID
**Endpoint:** `GET /api/ai/tasks/invalid-id`
**Expected:**
```json
{
  "success": false,
  "message": "Task not found"
}
```

### Missing Required Fields
**Endpoint:** `POST /api/ai/tasks` (without title)
**Expected:**
```json
{
  "success": false,
  "message": "Missing required fields: title, inputPrompt, taskType"
}
```

### Agent Not Found
**Endpoint:** `POST /api/ai/tasks/task-id/run` (invalid agent)
**Expected:**
```json
{
  "success": false,
  "message": "Agent not found"
}
```

---

## Database Inspection

### View Providers
```bash
mongo
# In mongo shell:
use ai_saas
db.aiproviders.find().pretty()
```

### View Agents
```bash
db.aiagents.find().pretty()
```

### View Tasks
```bash
db.agenttasks.find().pretty()
```

### View Runs
```bash
db.agentruns.find().pretty()
```

### View Templates
```bash
db.agentprompttemplate.find().pretty()
```

---

## Performance Notes

- Load 20 most recent tasks (paginated)
- Each agent load <100ms
- Provider status check via adapter validation
- No N+1 queries (uses populate for relations)

---

## Troubleshooting

### "Cannot find module" errors

Make sure imports are correct:
- `src/models/` for models
- `src/services/adapters/` for adapters
- `src/modules/aiagent/` for routes/controller

### MongoDB connection failed

```bash
# Check MongoDB is running
mongo --version

# Start MongoDB (if using local)
mongod

# Verify connection string in .env
MONGO_URI=mongodb://127.0.0.1:27017/ai_saas
```

### CORS errors in frontend

Check that backend .env has correct VITE_API_URL:
```
VITE_API_URL=http://localhost:5000
```

### "Provider not configured" despite API key

1. Check .env file has correct key name:
   - `OPENAI_API_KEY` (not OpenAI_Api_Key)
   - Keys are case-sensitive

2. Restart backend server after changing .env

3. Check provider status in "🔌 Providers" tab

---

## API Response Format

All API responses follow this format:

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "message": "User-friendly error",
  "error": "Technical error details"
}
```

---

## Next Steps

1. ✅ Seed data
2. ✅ Start servers
3. ✅ Test all 6 main features
4. ✅ Try manual external agent
5. ⏭️ Add API keys for OpenAI/Gemini
6. ⏭️ Build more specialized agents
7. ⏭️ Add WebSocket for real-time streaming
8. ⏭️ Integrate with existing chat system

