const MODEL_FAILURE_CODES = new Set([
  "MODEL_FORMAT_ERROR",
  "MODEL_SCHEMA_ERROR",
  "MODEL_PARTIAL_OUTPUT",
  "MODEL_PROTOCOL_ERROR"
]);

function isPresent(value) {
  return value !== undefined && value !== null;
}

function toText(value) {
  if (Array.isArray(value)) {
    return value.map(item => toText(item)).join("\n");
  }
  if (!isPresent(value)) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stripCodeFences(text = "") {
  const raw = String(text || "").trim();
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  return raw;
}

function stripJsonComments(text = "") {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const cleaned = [];
  let inBlockComment = false;

  for (const line of lines) {
    let next = String(line || "");
    if (inBlockComment) {
      const endIndex = next.indexOf("*/");
      if (endIndex === -1) continue;
      next = next.slice(endIndex + 2);
      inBlockComment = false;
    }

    while (true) {
      const blockStart = next.indexOf("/*");
      if (blockStart === -1) break;
      const blockEnd = next.indexOf("*/", blockStart + 2);
      if (blockEnd === -1) {
        next = next.slice(0, blockStart);
        inBlockComment = true;
        break;
      }
      next = `${next.slice(0, blockStart)}${next.slice(blockEnd + 2)}`;
    }

    if (/^\s*\/\//.test(next)) continue;
    next = next.replace(/\s+\/\/.*$/, "");
    cleaned.push(next);
  }

  return cleaned.join("\n");
}

function repairJsonText(text = "") {
  const noComments = stripJsonComments(String(text || ""));
  return noComments
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/^\s*[\s\S]*?(?=[{\[])/, match => (/[{\[]/.test(match) ? match : ""));
}

function extractTextCandidates(rawResponse) {
  const rawText = String(rawResponse || "").trim();
  if (!rawText) return [];

  const candidates = new Set([rawText]);
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) candidates.add(fenceMatch[1].trim());

  const firstObject = rawText.indexOf("{");
  const lastObject = rawText.lastIndexOf("}");
  if (firstObject !== -1 && lastObject > firstObject) {
    candidates.add(rawText.slice(firstObject, lastObject + 1).trim());
  }

  const firstArray = rawText.indexOf("[");
  const lastArray = rawText.lastIndexOf("]");
  if (firstArray !== -1 && lastArray > firstArray) {
    candidates.add(rawText.slice(firstArray, lastArray + 1).trim());
  }

  return [...candidates].filter(Boolean);
}

function isJsonLike(value) {
  return value && typeof value === "object";
}

function detectSchema(value) {
  if (Array.isArray(value)) return "array";
  if (!isJsonLike(value)) return typeof value;
  if (Array.isArray(value.files)) return "files";
  if (Array.isArray(value.patches)) return "patches";
  if (Array.isArray(value.toolCalls) || Array.isArray(value.tool_calls) || Array.isArray(value.actions)) return "tool_calls";
  if (value.tool || value.args) return "tool";
  if (value.content !== undefined || value.text !== undefined || value.code !== undefined || value.source !== undefined) return "content";
  if (value.result || value.response || value.output) return "legacy";
  return "object";
}

function buildNormalizedShape(parsed, schema, { mode = "tool" } = {}) {
  if (mode === "content") {
    return {
      content: extractCanonicalContent(parsed),
      schema,
      parsed
    };
  }
  return {
    schema,
    parsed
  };
}

function tryParseCandidate(candidate) {
  const trimmed = String(candidate || "").trim();
  if (!trimmed) return null;

  const repairAttempts = [trimmed, repairJsonText(trimmed)];
  for (const attempt of repairAttempts) {
    if (!attempt.trim()) continue;
    try {
      const parsed = JSON.parse(attempt);
      return {
        parsed,
        repaired: attempt !== trimmed,
        schema: detectSchema(parsed)
      };
    } catch {}
  }
  return null;
}

export function extractCanonicalContent(parsed = null) {
  if (typeof parsed === "string") return parsed.trim();
  if (Array.isArray(parsed)) {
    return parsed
      .map(item => extractCanonicalContent(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (!parsed || typeof parsed !== "object") return "";
  for (const key of ["content", "text", "code", "source", "final"]) {
    if (typeof parsed[key] === "string" && parsed[key].trim()) {
      return parsed[key].trim();
    }
  }
  if (Array.isArray(parsed.files) && parsed.files.length > 0) {
    return extractCanonicalContent(parsed.files[0]);
  }
  if (parsed.result !== undefined) return extractCanonicalContent(parsed.result);
  if (parsed.response !== undefined) return extractCanonicalContent(parsed.response);
  if (parsed.output !== undefined) return extractCanonicalContent(parsed.output);
  if (parsed.toolResult !== undefined) return extractCanonicalContent(parsed.toolResult);
  if (parsed.args !== undefined) return extractCanonicalContent(parsed.args);
  return "";
}

export function extractCanonicalToolPayload(parsed = null) {
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const normalized = extractCanonicalToolPayload(entry);
      if (normalized) return normalized;
    }
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.tool && parsed.args && typeof parsed.args === "object") {
    return { tool: String(parsed.tool || "").trim(), args: { ...parsed.args } };
  }

  if (parsed.tool) {
    return {
      tool: String(parsed.tool || "").trim(),
      args: {
        ...(parsed.args && typeof parsed.args === "object" ? parsed.args : {}),
        path: parsed.path ?? parsed.file ?? parsed.target ?? parsed.args?.path ?? parsed.args?.file ?? parsed.args?.target,
        content: parsed.content ?? parsed.text ?? parsed.code ?? parsed.source ?? parsed.args?.content ?? parsed.args?.text ?? parsed.args?.code ?? parsed.args?.source,
        command: parsed.command ?? parsed.args?.command
      }
    };
  }

  if (parsed.toolResult) return extractCanonicalToolPayload(parsed.toolResult);
  if (parsed.result) return extractCanonicalToolPayload(parsed.result);
  return null;
}

export function normalizeModelResponse(rawResponse, { mode = "tool" } = {}) {
  const rawText = typeof rawResponse === "string" ? rawResponse : toText(rawResponse);
  const trimmed = String(rawResponse || "").trim();

  if (Array.isArray(rawResponse)) {
    const parsed = rawResponse;
    const schema = detectSchema(parsed);
    console.log("[MODEL_RESPONSE_NORMALIZED]", { schema, mode, source: "array" });
    return {
      success: true,
      parsed,
      schema,
      repaired: false,
      canonical: buildNormalizedShape(parsed, schema, { mode }),
      raw: rawResponse
    };
  }

  if (isJsonLike(rawResponse)) {
    const parsed = rawResponse;
    const schema = detectSchema(parsed);
    console.log("[MODEL_RESPONSE_NORMALIZED]", { schema, mode, source: "object" });
    return {
      success: true,
      parsed,
      schema,
      repaired: false,
      canonical: buildNormalizedShape(parsed, schema, { mode }),
      raw: rawResponse
    };
  }

  const candidates = extractTextCandidates(rawResponse);
  for (const candidate of candidates) {
    const parsed = tryParseCandidate(candidate);
    if (!parsed) continue;
    const { schema, repaired, parsed: value } = parsed;
    console.log("[MODEL_RESPONSE_NORMALIZED]", { schema, mode, source: "text" });
    if (candidate !== trimmed || repaired) {
      console.log("[MODEL_SCHEMA_REPAIRED]", {
        schema,
        mode,
        source: candidate !== trimmed ? "embedded" : "repaired"
      });
      console.log("[PARSER_RECOVERED]", {
        schema,
        mode,
        source: candidate !== trimmed ? "embedded_json" : "repaired_json"
      });
    }
    return {
      success: true,
      parsed: value,
      schema,
      repaired,
      canonical: buildNormalizedShape(value, schema, { mode }),
      raw: rawResponse
    };
  }

  if (mode === "content") {
    const fenced = stripCodeFences(rawText).trim();
    if (fenced) {
      console.log("[MODEL_RESPONSE_NORMALIZED]", { schema: "content_text", mode, source: "plain_text" });
      if (fenced !== rawText) {
        console.log("[MODEL_SCHEMA_REPAIRED]", { schema: "content_text", mode, source: "fence_removed" });
        console.log("[PARSER_RECOVERED]", { schema: "content_text", mode, source: "fence_removed" });
      }
      return {
        success: true,
        parsed: { content: fenced },
        schema: "content_text",
        repaired: fenced !== rawText,
        canonical: { content: fenced, schema: "content_text", parsed: { content: fenced } },
        raw: rawResponse
      };
    }
  }

  const error = {
    success: false,
    code: "MODEL_FORMAT_ERROR",
    message: "Model response could not be normalized",
    schema: "unknown",
    raw: rawResponse,
    canonical: null
  };
  console.log("[MODEL_FORMAT_ERROR]", {
    mode,
    reason: error.message
  });
  return error;
}

export function classifyModelResponseFailure(error = {}) {
  const code = String(error?.code || error?.failureType || error?.type || "").trim().toUpperCase();
  if (MODEL_FAILURE_CODES.has(code)) return code;
  const message = String(error?.message || error?.reason || error || "").toUpperCase();
  for (const candidate of MODEL_FAILURE_CODES) {
    if (message.includes(candidate)) return candidate;
  }
  if (/PARTIAL.*OUTPUT/.test(message)) return "MODEL_PARTIAL_OUTPUT";
  if (/SCHEMA/.test(message)) return "MODEL_SCHEMA_ERROR";
  if (/PROTOCOL/.test(message)) return "MODEL_PROTOCOL_ERROR";
  if (/FORMAT/.test(message) || /JSON/.test(message)) return "MODEL_FORMAT_ERROR";
  return null;
}

export default normalizeModelResponse;
