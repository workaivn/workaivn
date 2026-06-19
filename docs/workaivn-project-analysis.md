# WorkAIVN - Project Analysis Report

**Report Date:** June 19, 2026  
**Project Name:** WorkAIVN (AI SaaS Platform)  
**Repository:** `g:\langtuvn\ai_local`

---

## 1. Tổng Quan Kiến Trúc Hiện Tại

### 1.1 Stack Công Nghệ

**Frontend:**
- **Framework:** React 18.2.0
- **Build Tool:** Vite 5.4.0
- **Routing:** React Router DOM 7.14.2
- **Markdown:** React Markdown, Marked, Highlight.js
- **Real-time:** Socket.io-client 4.8.3

**Backend:**
- **Runtime:** Node.js (ES Modules)
- **Framework:** Express.js 4.18.2
- **Database:** MongoDB (Mongoose 8.0.0) - Local `mongodb://127.0.0.1:27017/ai_saas`
- **Real-time:** Socket.io 4.8.3
- **Authentication:** JWT (jsonwebtoken 9.0.0)
- **Multer:** File upload

**AI & External Services:**
- **LLMs:** OpenAI, Google Gemini, Groq, OpenRouter
- **Vision/Image:** OpenAI Vision API
- **Image Generation:** OpenAI DALL-E
- **Search:** SERP API
- **OCR:** Tesseract.js, Poppler, PDF parsing
- **Face Recognition:** Face++ API

**Document Processing:**
- **PDF:** pdf-parse, pdf2json, pdfjs-dist, pdf-poppler
- **Excel:** ExcelJS, xlsx
- **Word:** Mammoth, word-extractor
- **Image:** Sharp, pdf2pic

**Infrastructure:**
- **Cloud Storage:** Cloudinary
- **Email:** Brevo SMTP (nodemailer)
- **Payment Gateway:** Sepay (Bank Webhook)

### 1.2 Kiến Trúc Tổng Thể

```
workaivn/
├── frontend/                 # React + Vite frontend
│   ├── src/
│   │   ├── pages/           # Page components
│   │   ├── components/      # Reusable components
│   │   ├── services/        # API clients
│   │   └── utils/           # Helper functions
│   ├── vite.config.js
│   ├── package.json
│   └── .env                 # Frontend env
│
├── backend/                  # Node.js + Express backend
│   ├── src/
│   │   ├── routes/          # Route definitions
│   │   ├── modules/         # Business logic (auth, chat, payment)
│   │   ├── agent/           # AI Agent framework
│   │   ├── services/        # AI & utility services
│   │   ├── controllers/     # Route handlers
│   │   ├── middleware/      # Express middleware
│   │   ├── models/          # Data models (Payment, Usage)
│   │   ├── config/          # Configuration (db, plans)
│   │   ├── app.js           # Express app setup
│   │   └── routes.js        # Legacy route file
│   ├── server.js            # Entry point
│   ├── package.json
│   ├── .env                 # Backend env (⚠️ Contains real API keys)
│   ├── uploads/             # User uploaded files (2000+ files)
│   ├── generated/           # Generated output files
│   └── fonts/               # Font files for PDF generation
│
└── docs/                    # Documentation
    └── workaivn-project-analysis.md (this file)
```

---

## 2. Danh Sách Thư Mục & File Quan Trọng

### 2.1 Backend Routes

| Route | Method | Purpose | Auth | Limits |
|-------|--------|---------|------|--------|
| `POST /chat` | POST | Stream chat response | JWT | usageLimit |
| `GET /chats` | GET | List user chats | - | - |
| `GET /chat/:id` | GET | Get chat details | - | - |
| `PUT /chat/:id/rename` | PUT | Rename chat | JWT | - |
| `POST /register` | POST | User registration | - | - |
| `POST /login` | POST | User login | - | - |
| `POST /forgot-password` | POST | Request password reset | - | - |
| `POST /reset-password` | POST | Reset password | - | - |
| `GET /me` | GET | Get current user | JWT | - |
| `PUT /me` | PUT | Update user profile | JWT | - |
| `PUT /me/password` | PUT | Change password | JWT | - |
| `POST /image` | POST | Generate image | JWT | usageLimit |
| `POST /bank/webhook` | POST | Sepay payment webhook | - | - |
| `GET /my/billings` | GET | Get user payment history | JWT | - |
| `GET /admin/users` | GET | List all users | isAdmin | - |
| `GET /admin/analytics` | GET | Analytics dashboard | isAdmin | - |

### 2.2 Backend Middleware Stack

```javascript
// Order matters!
app.use(express.json({ limit: "50mb" }));
app.use(cors(...));

// Per route:
router.post("/chat", usageLimit("chat"), incrementUsage, chat.chat);
```

**Key Middleware:**

1. **auth.js** - JWT verification (extracts userId from token)
2. **usageLimit.js** - Check daily limits based on plan
3. **incrementUsage.js** - Increment usage counter
4. **isAdmin.js** - Check admin role
5. **planGuard.js** - Feature gate by plan

### 2.3 Backend Modules Structure

```
modules/
├── auth/
│   ├── auth.controller.js      # Login, register, password reset
│   ├── auth.model.js           # User schema (Mongoose)
│   └── auth.service.js         # Auth logic
│
├── chat/
│   ├── chat.controller.js      # Chat handler (streams responses)
│   ├── chat.model.js           # Chat document schema
│   └── chat.service.js         # Stream & save chat logic
│
└── payment/
    ├── payment.controller.js    # Payment endpoints
    └── payment.webhook.js       # Sepay webhook handler
```

### 2.4 AI Agent Framework

**Location:** `backend/src/agent/`

```
agent/
├── runAgentLoop.js              # Main loop: think → plan → execute → reflect
├── agent.service.js             # Agent initialization & memory
├── toolExecutor.js              # Tool execution engine
└── tools/
    ├── applyPatch.js            # Apply code patches
    ├── listFiles.js             # List repository files
    ├── readFile.js              # Read file contents
    ├── runTerminal.js           # Execute shell commands
    ├── searchCode.js            # Full-text code search
    ├── searchSymbol.js          # Semantic symbol search
    └── writeFile.js             # Write/create files
```

**Agent Features:**
- Iterative loop (max 8 steps)
- Memory tracking (objective, discoveries, patches)
- Tool execution (search, read, write, apply)
- Patch validation

### 2.5 Service Layer

**Location:** `backend/src/services/`

Key services for AI/Code analysis:

- **aiRouter.js** - Route to OpenAI/Gemini/Groq with fallback
- **chunker.js** - Text chunking for large files
- **detectIntent.js** - Parse user intent (chat, code, bug, etc.)
- **buildSymbolIndex.js** - Index function/class symbols
- **buildImportGraph.js** - Map module dependencies
- **buildCallGraph.js** - Map function calls
- **buildFileMeta.js** - Extract file metadata
- **buildFunctionMeta.js** - Extract function metadata
- **buildFlowMap.js** - Map program flow
- **retrieveCodeContext.js** - Get relevant code for queries
- **retrieveLocateContext.js** - Locate symbols
- **retrieveBugContext.js** - Find potential bugs
- **retrieveExplainContext.js** - Prepare explanation context
- **parsePatches.js** - Parse code patches
- **applyPatch.js** - Apply patches to files

### 2.6 Frontend Pages

| Page | Route | Purpose | Auth |
|------|-------|---------|------|
| Login | `/login` | User login | - |
| Register | `/register` | User registration | - |
| Landing | `/` (workaivn.com) | Marketing page | - |
| Chat | `/` | Main chat interface | JWT |
| Image | `/image` | Image generation | JWT |
| Tools | `/tools` | Code analysis tools | JWT |
| Profile | `/profile` | User settings | JWT |
| Admin | `/admin` | Admin dashboard | isAdmin |
| Admin Dashboard | `/admin-dashboard` | Analytics | isAdmin |
| Users | `/users` | User management | isAdmin |
| Forgot Password | `/forgot-password` | Password reset | - |
| Payment Success | `/payment-success` | Payment confirmation | - |
| Payment Cancel | `/payment-cancel` | Payment cancel page | - |

### 2.7 Data Models

**User** (in auth.model.js)
```javascript
{
  email: String,
  password: String (hashed with bcryptjs),
  plan: String (free|pro|business),
  planExpireAt: Date,
  createdAt: Date,
  // Additional fields for profile
}
```

**Chat** (in chat.model.js)
```javascript
{
  userId: ObjectId,
  title: String,
  messages: [{
    role: String,
    content: String,
    timestamp: Date
  }],
  createdAt: Date
}
```

**Payment** (in models/Payment.js)
```javascript
{
  userId: ObjectId,
  amount: Number,
  status: String,
  gateway: String (sepay|...),
  transactionId: String,
  createdAt: Date
}
```

**Usage** (in models/Usage.js)
```javascript
{
  userId: ObjectId,
  dateKey: String (YYYY-MM-DD),
  chat: Number,
  file: Number,
  image: Number,
  tool: Number
}
```

---

## 3. Những Phần Có Thể Tái Sử Dụng

### ✅ Có thể mở rộng/tái sử dụng:

1. **AI Agent Framework**
   - Well-structured loop + memory system
   - Tool abstraction (easy to add new tools)
   - Patch validation mechanism
   - Code analysis services

2. **Service Layer**
   - Code parsing & analysis (symbols, imports, calls)
   - Context retrieval (bug, code, location)
   - AI routing with fallback
   - PDF/Document processing

3. **Auth System**
   - JWT-based auth
   - Email verification
   - Password reset flow
   - Role-based access (isAdmin)

4. **Usage Tracking**
   - Daily limit enforcement
   - Plan-based quotas
   - Usage logging per type (chat, file, image, tool)

5. **Payment Integration**
   - Webhook handler structure
   - Payment tracking

6. **Middleware Architecture**
   - Composable middleware patterns
   - Auth + usage tracking pipeline

---

## 4. Những Phần ⚠️ Không Nên Đụng Vào

### 🔴 Critical - Don't Touch:

1. **`backend/src/routes.js`** - Legacy file mixing business logic with routes
   - Status: DEPRECATED (modern routes are in `/routes` folder)
   - Risk: Extremely complex, 500+ lines mixed logic
   - Impact: Breaking this will break payment, OCR, PDF parsing

2. **`backend/src/models/Payment.js`** - Payment data model
   - Status: In production, used by billing system
   - Risk: Data loss, billing mismatch
   - Impact: Users lose transaction history

3. **`backend/src/middleware/auth.js`** - JWT validation
   - Status: Core auth
   - Risk: Security bypass
   - Impact: Unauthorized access to all protected routes

4. **`backend/src/middleware/usageLimit.js`** - Quota enforcement
   - Status: In production (billing system)
   - Risk: Quota bypass, lost revenue
   - Impact: Free users can access pro features

5. **`backend/src/config/db.js`** - MongoDB connection
   - Status: Critical infrastructure
   - Risk: DB connection failure
   - Impact: Application cannot start

6. **`backend/server.js`** - Server entry point
   - Status: Core bootstrap
   - Risk: Server won't start
   - Impact: Application down

### 🟡 Caution - Modify Carefully:

1. **`backend/src/routes/auth.routes.js`** - Auth endpoints
   - Risk: User locked out, password reset broken
   - Mitigation: Test thoroughly

2. **`backend/src/routes/payment.routes.js`** - Payment endpoints
   - Risk: Payment processing broken
   - Mitigation: Test with Sepay webhook

3. **`backend/src/modules/auth/auth.model.js`** - User schema
   - Risk: Existing users can't login
   - Mitigation: Migration strategy needed

4. **Frontend Socket.io** - Real-time connections
   - Located in server.js
   - Risk: Streaming broken
   - Mitigation: Test streaming chat

---

## 5. Đề Xuất Kiến Trúc AI Agent Hub

Dựa vào cấu trúc hiện tại, đây là đề xuất kiến trúc cho Agent Hub:

### 5.1 Current Agent Capabilities

```
Current Scope:
├── Code Analysis Agents
│   ├── Search symbols (functions, classes)
│   ├── Find bugs (pattern matching)
│   ├── Explain code
│   ├── Generate patches
│   └── Validate patches
│
├── File Operations
│   ├── List files
│   ├── Read files
│   ├── Write files
│   └── Apply patches
│
└── Terminal Operations (Limited)
    └── Execute shell commands
```

### 5.2 Proposed Hub Architecture

```
Agent Hub (New Structure):
├── Core Agent Engine
│   ├── runAgentLoop.js (existing - keep as is)
│   ├── agent.service.js (existing - keep as is)
│   └── agentRegistry.js (NEW - register available agents)
│
├── Specialized Agents (NEW)
│   ├── codeAnalysisAgent.js (code → bug/optimize)
│   ├── documentationAgent.js (code → docs)
│   ├── testingAgent.js (code → tests)
│   ├── performanceAgent.js (code → optimize)
│   └── securityAgent.js (code → vulnerabilities)
│
├── Tool System (Existing)
│   ├── tools/
│   │   ├── existing tools (keep)
│   │   └── NEW: astAnalyzer.js (AST-based analysis)
│   └── toolExecutor.js (existing - keep)
│
├── Context Services (Enhance)
│   ├── retrieveCodeContext.js (enhance with RAG)
│   ├── semanticSearch.js (NEW - vector embeddings)
│   └── codeGraph.js (NEW - build graph DB)
│
└── Evaluation & Safety
    ├── patchValidator.js (existing)
    ├── riskAssessment.js (NEW)
    └── auditLog.js (NEW - track agent actions)
```

### 5.3 Recommended Next Phase

**Phase 1 - Documentation**
- Automated docstring generation from code
- API documentation from endpoints
- README generation from structure

**Phase 2 - Testing**
- Unit test generation from functions
- Integration test suggestions
- Test coverage analysis

**Phase 3 - Performance**
- Code optimization suggestions
- Database query analysis
- Memory leak detection

**Phase 4 - Security**
- Dependency vulnerability scanning
- SQL injection detection
- Authentication/authorization audit

---

## 6. Rủi Ro Khi Sửa Code

### 🔴 High Risk Changes

1. **Removing/Refactoring `routes.js`**
   - Risk Level: CRITICAL
   - Impact: Breaks payment, OCR, PDF, file uploads
   - Mitigation: Understand all 500+ lines first, test every endpoint

2. **Changing JWT Secret or Algorithm**
   - Risk Level: CRITICAL
   - Impact: All existing tokens become invalid, users locked out
   - Mitigation: Migration strategy needed, grace period

3. **Modifying Database Schema**
   - Risk Level: HIGH
   - Impact: Existing data corrupted
   - Mitigation: Run MongoDB migration scripts first

4. **Changing API Response Format**
   - Risk Level: HIGH
   - Impact: Frontend breaks, mobile apps fail
   - Mitigation: Version API endpoints, support multiple versions

5. **Modifying Middleware Order**
   - Risk Level: HIGH
   - Impact: Auth bypass, usage bypass, CORS issues
   - Mitigation: Test all route combinations

### 🟡 Medium Risk Changes

1. **Adding new AI providers**
   - Risk: Fallback logic gets complex
   - Mitigation: Test all three providers (OpenAI, Gemini, Groq)

2. **Changing file upload limits**
   - Risk: Large files crash server
   - Mitigation: Test with actual file sizes (PDFs, Images)

3. **Modifying payment webhook**
   - Risk: Double-charging or missed charges
   - Mitigation: Idempotency keys, test with Sepay sandbox

4. **Adding new routes to payment**
   - Risk: Unauthorized payment creation
   - Mitigation: Always check auth + admin role

### 🟢 Low Risk Changes

1. ✅ Adding new chat models
2. ✅ Adding UI/UX improvements
3. ✅ Optimizing existing queries
4. ✅ Adding new admin features

---

## 7. Kế Hoạch Phase Tiếp Theo

### Phase 1: Code Consolidation (Current: Phase 0)
- ✅ Analyze project structure
- ⏭️ Create unified documentation
- ⏭️ Identify legacy code to deprecate
- ⏭️ Plan migration strategy

### Phase 2: Refactor Routes (Recommended)
**Goal:** Consolidate `routes.js` into `/routes/` folder structure

**Tasks:**
```
1. Extract payment routes from routes.js → routes/file-process.routes.js
2. Extract OCR routes from routes.js → routes/ocr.routes.js
3. Extract PDF routes from routes.js → routes/pdf.routes.js
4. Test each route after extraction
5. Delete routes.js once confirmed working
6. Update imports in app.js
```

**Risk:** MEDIUM (need extensive testing)

### Phase 3: Add Agent Hub Features
**Goal:** Expand agent capabilities

**Roadmap:**
```
Sprint 1: Documentation Agent
  - Generate docstrings automatically
  - Create API docs from routes

Sprint 2: Testing Agent
  - Generate unit tests
  - Coverage analysis

Sprint 3: Security Agent
  - Dependency audit
  - Vulnerability scanning

Sprint 4: Performance Agent
  - Query optimization
  - Memory profiling
```

### Phase 4: Scale & Optimize
**Goal:** Prepare for production scale

**Tasks:**
```
1. Add Redis for caching
2. Implement job queue (Bull) for async tasks
3. Add request rate limiting
4. Database indexing optimization
5. CDN integration for static files
6. Monitoring & alerting (Winston/ELK)
```

### Phase 5: Frontend Modernization
**Goal:** Improve UX and code quality

**Tasks:**
```
1. Refactor Chat page (complex, 500+ lines)
2. Extract reusable components
3. Add loading states & error handling
4. Implement streaming UI improvements
5. Add offline support
```

---

## 8. Current Issues Found

### 🔴 Critical Issues

1. **API Keys Exposed in .env**
   - Located: `backend/.env`
   - Keys: OpenAI, Gemini, Groq, OpenRouter, Face++, etc.
   - Impact: Rate limit abuse, API bill charges
   - **Action:** Rotate all keys immediately, use environment variables only
   - **Link:** See `.env` file (DO NOT COMMIT)

2. **Routes.js Too Complex**
   - Size: 500+ lines mixing business logic with routes
   - Impact: Hard to maintain, high risk of bugs
   - **Action:** Refactor into smaller modules (Phase 2)

3. **No Error Handling in Chat Stream**
   - Located: `backend/src/modules/chat/chat.service.js`
   - Impact: Stream might hang on error
   - **Action:** Add try-catch in stream service

### 🟡 Medium Issues

1. **Inconsistent Middleware Application**
   - Some routes use `usageLimit`, some don't
   - Impact: Usage not tracked consistently
   - **Action:** Audit all routes and apply middleware consistently

2. **No Input Validation**
   - No request validation library (like Joi, Zod)
   - Impact: Invalid requests might crash server
   - **Action:** Add validation middleware

3. **No Logging System**
   - No centralized logging
   - Impact: Hard to debug production issues
   - **Action:** Add Winston or Pino logger

4. **Socket.io Auth Not Implemented**
   - Located: `backend/server.js`
   - Impact: Anyone can listen to user streams
   - **Action:** Add JWT verification to Socket.io connections

5. **Frontend env Configuration**
   - Frontend has `.env` but not properly versioned
   - Impact: Different deploys might hit wrong API
   - **Action:** Use `vite.config.js` to properly configure env

---

## 9. Tech Debt Observations

### Code Organization
- ❌ Mixed concerns in `routes.js`
- ✅ Good module separation in `/modules`
- ⚠️ Service layer needs better documentation
- ✅ Agent framework is well-structured

### Type Safety
- ❌ No TypeScript
- ❌ No JSDoc type annotations
- Impact: Hard to catch errors early

### Testing
- ❌ No unit tests
- ❌ No integration tests
- Impact: Risky to refactor

### Performance
- ⚠️ No caching layer (Redis)
- ⚠️ No database indexing documented
- ⚠️ No async job queue

### Security
- ⚠️ No rate limiting
- ⚠️ No input validation
- ⚠️ CORS configured but could be more strict
- ✅ JWT auth implemented
- ✅ Password hashing implemented

---

## 10. Quick Reference

### Environment Variables

**Backend (.env):**
```
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=AIzaSy...
GROQ_API_KEY=gsk_...
OPENROUTER_API_KEY=sk-or-...
JWT_SECRET=9f3c1b2a...
MONGO_URI=mongodb://127.0.0.1:27017/ai_saas
CLOUDINARY_CLOUD_NAME=dx8jt0pws
CLOUDINARY_API_KEY=794354885386716
SMTP_HOST=smtp-relay.brevo.com
SEPAY_API_KEY=221182250915020417280889
PORT=3000
```

**Frontend (.env):**
```
VITE_API_URL=https://api.workaivn.com
```

### Start Dev Server

**Backend:**
```bash
cd backend
npm install
npm run dev
# Listens on http://localhost:5000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Listens on http://localhost:5173
```

### Database Connection
```javascript
// Location: backend/src/config/db.js
// MongoDB local: mongodb://127.0.0.1:27017/ai_saas
// Requires MongoDB running locally
```

### Deploy Info

**Frontend:** Vercel deployment configured (`vercel.json`)
- Domain: https://workaivn.vercel.app
- Domain aliases: workaivn.com, app.workaivn.com

**Backend:** Not configured for Vercel (serverless not suitable)
- Likely deployed on VPS or Docker
- Requires persistent MongoDB
- Requires 24/7 Socket.io connections

---

## Summary

WorkAIVN is a well-architected AI SaaS platform with:
- ✅ Modern stack (React + Node.js)
- ✅ Good module separation
- ✅ Agent framework for code analysis
- ✅ Multiple AI providers with fallback
- ✅ Complete auth & payment system
- ⚠️ Some technical debt (routes.js, no tests, no logging)
- ⚠️ API keys exposed in .env (security risk)

**Recommendation:** Proceed with Phase 1 (documentation), then Phase 2 (route consolidation) before adding new features.

---

**Report End**
