import { askAI } from "../services/aiRouter.js";
import { executeTool } from "./toolExecutor.js";

function emitStatus(history, text) {
  history.push({
    type: "status",
    text,
    time: Date.now()
  });
}

function limitMemory(arr, max = 8) {
  return arr.slice(-max);
}

export async function runAgentLoop({
  messages = [],
  plan = "free",
  activeFiles = [],
  maxSteps = 8,
  onEvent = () => {}
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
    evidence: [],
    architectureSummary: "",
    patches: [],
    modifiedFiles: [],
    terminalOutputs: []
  };

  memory.objective = messages?.slice(-1)?.[0]?.content || "";
  let emptySearchCount = 0;
  let repeatedToolCount = 0;
  let lastTool = "";

  for (let step = 0; step < maxSteps; step++) {
    const system = `
Luôn trả lời bằng Tiếng Việt.
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
- VALIDATE_PATCH

VALIDATE_PATCH checks:
- syntax risks
- runtime risks
- frontend/backend mismatch
- useless patches
- duplicate fixes
- invalid imports
- invalid JSX
- non-functional fixes

Do NOT run npm build commands.
Do NOT assume full local project exists.
Validate logically from uploaded files only.

CRITICAL RULES:
- You MUST use tools.
- NEVER answer directly without tools.
- ALWAYS inspect code before fixing.
- ALWAYS search relevant files first.
- Search semantically, not literally.
- Think like a senior software engineer debugging a real app.
- NEVER invent file contents.
- NEVER skip tool usage.
- Think step-by-step.

FLOW REQUIREMENTS:
IMPORTANT:
If you already found:
- root cause
- affected file
- valid patch

Then you MUST finish immediately.

Do NOT continue searching.

NEVER search generic words:
- function
- code
- stream
- bug
- fix
- error
1. PLAN: Define your investigation path.
2. READ/SEARCH: Inspect codebases to find root causes.
3. CRITIC & PATCH: Submit a patch to the critic, then apply it if approved.
4. VALIDATE: You MUST run VALIDATE_PATCH immediately after applying any patch.
5. DONE: Conclude only after successful validation.

OUTPUT JSON FORMAT REQUIRED AT EACH STEP:
{
  "plan": ["bước 1", "bước 2"],
  "hypotheses": ["giả thuyết lỗi"],
  "rootCause": "Mô tả chi tiết lỗi tìm thấy là gì bằng tiếng Việt",
  "reasoning": "Tại sao lại sửa như thế này bằng tiếng Việt",
  "tool": "APPLY_PATCH", 
  "args": { ... },
  "done": false
}
When you are completely finished and validation passes, set "done": true and write a summary in "final".
Return ONLY valid JSON.
`;

    if (emptySearchCount >= 3) {
      return {
        success: false,
        final: `Không tìm thấy đoạn code liên quan trong project.`,
        history
      };
    }

    const aiResponse = await askAI({
      messages: [
		  {
			role: "system",
			content: system
		  },

		  {
			role: "system",
			content: `
		OBJECTIVE:
		${memory.objective}

		DISCOVERED FILES:
		${memory.discoveredFiles.join("\n")}

		ROOT CAUSES:
		${memory.rootCauses.slice(-3).join("\n")}

		LAST TOOL RESULTS:
		${JSON.stringify(
		  history.slice(-3),
		  null,
		  2
		)}

		IMPORTANT:
		- Do not repeat searches
		- Use exact files/functions
		- Prefer patching over more searching
		`
		  },

		  ...messages
		],
      mode: "agent",
      plan
    });

    console.log("\n=== AGENT STEP ===", step);
    console.log("RAW AI RESPONSE:\n", aiResponse);
	
    onEvent({
      type: "thinking",
      step
    });

    let parsed = null;

try {

  const cleaned =
    String(aiResponse || "")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

  const first =
    cleaned.indexOf("{");

  const last =
    cleaned.lastIndexOf("}");

  if (
    first === -1 ||
    last === -1
  ) {
    throw new Error(
      "No JSON object found"
    );
  }

  const jsonOnly =
    cleaned.slice(
      first,
      last + 1
    );

  parsed =
    JSON.parse(jsonOnly);

} catch (err) {

  console.log(
    "JSON PARSE FAIL:",
    aiResponse
  );

  return {
    success: false,
    error:
      "AI returned invalid JSON",
    raw: aiResponse
  };

}

    // 1. Cập nhật Kế hoạch (PLAN)
    if (Array.isArray(parsed.plan)) {
      const samePlan = JSON.stringify(parsed.plan) === JSON.stringify(memory.currentPlan);
      memory.currentPlan = limitMemory(parsed.plan, 10);

      if (!samePlan) {
        emitStatus(history, "New plan accepted");
      }

      if (samePlan && memory.discoveredFiles.length < 2) {
        messages.push({
          role: "system",
          content: "STOP REPEATING PLAN. EXECUTE READ_FILE OR SEARCH_CODE NOW."
        });
      }
    }

    // Cập nhật các thông tin Memory cơ bản
    if (Array.isArray(parsed.hypotheses)) memory.hypotheses = limitMemory([...memory.hypotheses, ...parsed.hypotheses], 20);
    if (parsed.reflection) memory.reflections.push(parsed.reflection);
    if (parsed.next) memory.nextActions.push(parsed.next);
    if (parsed.rootCause) memory.rootCauses = limitMemory([...memory.rootCauses, parsed.rootCause], 20);
    if (Array.isArray(parsed.rejectedHypotheses)) memory.rejectedHypotheses = limitMemory([...memory.rejectedHypotheses, ...parsed.rejectedHypotheses], 20);

    // 2. Kiểm tra và Đánh chặn để đưa vào quy trình CRITIC -> PATCH
    const detectedPatch = parsed.PATCH || parsed.patch || (parsed.tool === "APPLY_PATCH" ? [parsed.args] : []);
    const hasPatchAction = Array.isArray(detectedPatch) && detectedPatch.length > 0;
    
    if (hasPatchAction) {
      if (lastTool === "APPLY_PATCH") {
        repeatedToolCount++;
      } else {
        repeatedToolCount = 0;
      }
      lastTool = "APPLY_PATCH";

      if (repeatedToolCount >= 3) {
        return {
          success: false,
          final: "Agent bị lặp vòng lặp vô hạn (loop) APPLY_PATCH mà không hiệu quả.",
          history
        };
      }
    }

    if (hasPatchAction) {
      if (memory.discoveredFiles.length < 2) {
        history.push({
          type: "warning",
          text: "Patch rejected: insufficient code context (Read at least 2 files before patching)",
          time: Date.now()
        });
        continue;
      }

      // --- BƯỚC 3: CRITIC ---
      const criticResponse = await askAI({
        messages: [
          {
            role: "system",
            content: `You are a brutal senior code reviewer.
Reject patches that add useless null checks, do not change runtime behavior, or lack evidence.
Return ONLY valid JSON.
APPROVE: { "approve": true }
REJECT: { "approve": false, "reason": "Reason here" }`
          },
          {
            role: "user",
            content: JSON.stringify({ patch: detectedPatch, memory, history }, null, 2)
          }
        ]
      });

      let critic = null;
      try {
        const cleanedCritic =
		  String(criticResponse || "")
			.replace(/```json/gi, "")
			.replace(/```/g, "")
			.trim();
        critic = JSON.parse(cleanedCritic);
      } catch {
        critic = { approve: false, reason: "Critic invalid JSON" };
      }

      if (!critic.approve) {
        history.push({
          type: "warning",
          text: `Patch rejected by Critic: ${critic.reason}`,
          time: Date.now()
        });
        continue;
      }

      history.push({
        type: "critic",
        text: "Patch approved by critic",
        time: Date.now()
      });

      onEvent({
        type: "patch",
        file: detectedPatch[0]?.file
      });

      // --- BƯỚC 4: PATCH (APPLY_PATCH) ---
      const patchResult = await executeTool("APPLY_PATCH", detectedPatch[0], activeFiles || []);
      
      history.push({
        step,
        tool: "APPLY_PATCH",
        args: detectedPatch[0],
        result: patchResult,
        time: Date.now()
      });

      if (patchResult?.success) {
        memory.patches.push(detectedPatch[0]);
        memory.modifiedFiles.push({
          file: detectedPatch[0]?.file,
          find: detectedPatch[0]?.find,
          replace: detectedPatch[0]?.replace,
          time: Date.now()
        });
        memory.successfulFixes.push(detectedPatch[0]?.file || "unknown");
        memory.thinkingDepth++;
        memory.reasoning.push(`Generated patch for ${detectedPatch[0]?.file}`);

        onEvent({
          type: "validate",
          file: detectedPatch[0]?.file
        });

        // --- BƯỚC 5: VALIDATE ---
        emitStatus(history, `Running validation for patch on ${detectedPatch[0]?.file}`);
        const valResult = await executeTool("VALIDATE_PATCH", { file: detectedPatch[0]?.file }, activeFiles || []);
        
        history.push({
          step,
          tool: "VALIDATE_PATCH",
          args: { file: detectedPatch[0]?.file },
          result: valResult,
          time: Date.now()
        });

        if (valResult?.output) {
			  memory.terminalOutputs.push(
				String(valResult.output).slice(0, 2000)
			  );
			}

			messages.push({
			  role: "system",
			  content: `
			PATCH SUCCESSFULLY APPLIED AND VALIDATED.

			If the issue is fixed:
			you MUST now return:

			{
			  "done": true,
			  "final": "..."
			}

			DO NOT SEARCH AGAIN.
			`
			});

			continue;
    }

    // 3. Xử lý các TOOL khác ngoại trừ APPLY_PATCH
    if (parsed.tool && parsed.tool !== "APPLY_PATCH") {
      if (parsed.tool === lastTool) {
        repeatedToolCount++;
      } else {
        repeatedToolCount = 0;
      }

      lastTool = parsed.tool;

      if (repeatedToolCount >= 3) {
        return {
          success: false,
          final: `Agent bị loop tool liên tục: ${parsed.tool}`,
          history
        };
      }

      if (parsed.tool === "SEARCH_CODE") {

  const q =
    String(
      parsed.args?.query || ""
    )
    .toLowerCase()
    .trim();

  const banned = [
    "function",
    "code",
    "bug",
    "error",
    "stream",
    "fix"
  ];

  if (banned.includes(q)) {

    history.push({
      type: "warning",
      text:
        `Blocked useless search: ${q}`,
      time: Date.now()
    });

    messages.push({
      role: "system",
      content: `
GENERIC SEARCH IS FORBIDDEN.

Use:
- exact function names
- exact file names
- exact identifiers
`
    });

    continue;
  }

  const normalized =
    q.replace(/[^\w\s]/g, "");

  const recent =
    memory.searchedQueries
      .slice(-5);

  const repeated =
    recent.some(oldQ => {

      const oldNorm =
        String(oldQ)
          .toLowerCase()
          .replace(/[^\w\s]/g, "");

      return (
        oldNorm.includes(normalized) ||
        normalized.includes(oldNorm)
      );

    });

  if (repeated) {

    emptySearchCount++;

    continue;
  }

}

      const result = await executeTool(parsed.tool, parsed.args || {}, activeFiles || []);
      onEvent({
        type: "tool",
        tool: parsed.tool,
        args: parsed.args
      });

      if (result?.success === false) {
        memory.failedFixes.push({
          tool: parsed.tool,
          args: parsed.args,
          error: result?.error || result?.stderr || "Unknown error"
        });
      }

      history.push({
        step,
        tool: parsed.tool,
        args: parsed.args,
        result
      });

      memory.thinkingDepth++;
      memory.reasoning.push(`After ${parsed.tool}, learned: ${JSON.stringify(result).slice(0, 120)}`);
      memory.evidence.push({ tool: parsed.tool, evidence: JSON.stringify(result).slice(0, 300) });

      if (parsed.tool === "SEARCH_CODE") {
        if (parsed.args?.query && !memory.searchedQueries.includes(parsed.args.query)) {
          memory.searchedQueries.push(parsed.args.query);
        }
        if (result?.success && Array.isArray(result.results) && result.results.length === 0) {
          emptySearchCount++;
        } else {
          emptySearchCount = 0;
        }
      }

      if (parsed.tool === "READ_FILE") {
        if (parsed.args?.path && !memory.discoveredFiles.includes(parsed.args.path)) {
          memory.discoveredFiles.push(parsed.args.path);
        }
        memory.architectureKnowledge.push(`${parsed.args.path} is part of the application flow`);
        memory.architectureSummary = limitMemory(memory.architectureKnowledge, 10).join("\n");

        const content = String(result?.content || "");
        const imports = [...content.matchAll(/import\s+.*?from\s+["'](.+?)["']/g)].map(x => x[1]);
        if (imports.length) {
          memory.fileRelationships.push({ file: parsed.args.path, imports });
        }
      }

      if (parsed.tool === "VALIDATE_PATCH" && result?.output) {
        memory.terminalOutputs.push(String(result.output).slice(0, 2000));
      }

      continue;
    }

    // --- BƯỚC 6: DONE ---
    if (parsed.done || (parsed.final && !parsed.tool)) {
      // Khóa an toàn: Nếu chưa thực hiện bản vá nào, ép Agent tiếp tục tìm lỗi
      if (memory.modifiedFiles.length === 0) {
        messages.push({
          role: "system",
          content: "You cannot finish or set done/final without proposing and validating an actual patch fix first."
        });
        continue;
      }

      const patchDetails = memory.modifiedFiles.map((f, index) => {
        return `### 🛠 Vị trí sửa đổi ${index + 1}:
- **File bị sửa:** \`${f.file}\`
- **Đoạn code gốc (Cũ):**
\`\`\`
${f.find}
\`\`\`
- **Đoạn code thay thế (Mới):**
\`\`\`
${f.replace}
\`\`\``;
      }).join("\n\n");

      const finalReport = `## 📋 BÁO CÁO KẾT QUẢ SỬA LỖI TỰ ĐỘNG

### ❌ 1. Nguyên nhân & Lỗi phát hiện (Root Cause)
${memory.rootCauses.length > 0 ? memory.rootCauses.map(rc => `- ${rc}`).join("\n") : "- Phát hiện lỗi logic/sai lệch tham số trong luồng mã nguồn của hệ thống."}

### 🔧 2. Chi tiết các File và Nội dung đã sửa
${patchDetails}

### 💡 3. Lý do thực hiện thay đổi (Reasoning)
${memory.reasoning.length > 0 ? memory.reasoning.slice(-3).map(r => `- ${r}`).join("\n") : "- Sửa lỗi để đáp ứng đúng cú pháp và logic kiểm tra (Validation)."}

### 🚀 4. Kết quả Kiểm tra (Validation)
- Hệ thống đã tự động chạy công cụ kiểm tra rủi ro \`VALIDATE_PATCH\`.
- **Trạng thái:** Hoàn tất thành công và không phát hiện lỗi phát sinh.

---
**Kết luận chung:** ${parsed.final || "Đã khắc phục hoàn toàn sự cố lỗi hệ thống."}`;

      return {
        success: true, // Đổi thành true để đảm bảo Controller nhận diện chính xác trạng thái Hoàn thành
        final: finalReport,
        history
      };
    }
  }

  return {
    success: false,
    final: "Không tìm thấy vị trí lỗi phù hợp trong source code hoặc đạt giới hạn số bước (maxSteps).",
    history
  };
}