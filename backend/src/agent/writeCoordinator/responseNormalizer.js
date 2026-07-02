const CONTENT_KEYS = ["content", "text", "code", "source"];
const PATH_KEYS = ["path", "file", "target"];
const PATCH_KEYS = ["changes", "patches", "replace", "diff", "edits", "operations"];

function isPresent(value) {
  return value !== undefined && value !== null;
}

function toContentString(value) {
  if (Array.isArray(value)) {
    return value.map(item => toContentString(item)).join("\n");
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

function firstNonEmptyString(values = []) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function getPathValue(entry) {
  if (!entry || typeof entry !== "object") return "";
  return firstNonEmptyString(PATH_KEYS.map(key => entry[key]));
}

function getContentValue(entry) {
  if (!entry || typeof entry !== "object") return "";
  for (const key of CONTENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(entry, key) && isPresent(entry[key])) {
      const content = toContentString(entry[key]);
      if (String(content).trim()) {
        return content;
      }
    }
  }
  return "";
}

function detectEntrySchema(entry) {
  if (!entry || typeof entry !== "object") return "unknown";
  for (const key of CONTENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(entry, key) && String(entry[key] ?? "").trim()) {
      return key;
    }
  }
  for (const key of PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(entry, key) && isPresent(entry[key])) {
      return key;
    }
  }
  if (Object.prototype.hasOwnProperty.call(entry, "content")) return "content";
  return "unknown";
}

function isPatchOnlyEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const hasContent = CONTENT_KEYS.some(key => String(entry[key] ?? "").trim().length > 0);
  if (hasContent) return false;
  return PATCH_KEYS.some(key => Object.prototype.hasOwnProperty.call(entry, key) && isPresent(entry[key]));
}

function normalizeFileEntry(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const path = getPathValue(entry);
    const content = getContentValue(entry);
    const originalSchema = detectEntrySchema(entry);
    const patchOnly = isPatchOnlyEntry(entry);
    if (patchOnly) {
      return {
        success: false,
        protocolError: true,
        reason: "PATCH_ONLY_RESPONSE",
        originalSchema
      };
    }
    if (!path) {
      return {
        success: false,
        protocolError: true,
        reason: "MISSING_PATH",
        originalSchema
      };
    }
    if (!String(content).trim()) {
      return {
        success: false,
        protocolError: true,
        reason: "EMPTY_CONTENT",
        originalSchema: originalSchema === "unknown" ? "content" : originalSchema
      };
    }
    return {
      success: true,
      originalSchema: originalSchema === "unknown" ? "content" : originalSchema,
      file: {
        path,
        content
      }
    };
  }

  if (typeof entry === "string" || Array.isArray(entry)) {
    const content = toContentString(entry);
    if (!String(content).trim()) {
      return {
        success: false,
        protocolError: true,
        reason: "EMPTY_CONTENT",
        originalSchema: "content"
      };
    }
    return {
      success: true,
      originalSchema: "content",
      file: { path: "", content }
    };
  }

  return {
    success: false,
    protocolError: true,
    reason: "UNSUPPORTED_RESPONSE_SHAPE",
    originalSchema: "unknown"
  };
}

function collectCandidateEntries(response) {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];
  for (const key of ["toolResult", "result", "response", "output", "legacy"]) {
    if (isPresent(response[key])) {
      const nested = collectCandidateEntries(response[key]);
      if (nested.length > 0) return nested;
    }
  }
  if (isPresent(response.args) && typeof response.args === "object") {
    const nestedArgs = collectCandidateEntries(response.args);
    if (nestedArgs.length > 0) return nestedArgs;
  }
  if (isPresent(response.files)) return Array.isArray(response.files) ? response.files : [response.files];
  if (isPresent(response.operations)) return Array.isArray(response.operations) ? response.operations : [response.operations];
  if (Array.isArray(response.changes) || Array.isArray(response.patches) || Array.isArray(response.edits)) {
    return [];
  }
  if (PATH_KEYS.some(key => isPresent(response[key])) || CONTENT_KEYS.some(key => isPresent(response[key]))) {
    return [response];
  }
  return [];
}

export function normalizeCoordinatorResponse(response) {
  const entries = collectCandidateEntries(response);
  if (entries.length === 0) {
    if (response && typeof response === "object") {
      for (const key of PATCH_KEYS) {
        if (Object.prototype.hasOwnProperty.call(response, key) && isPresent(response[key])) {
          console.log("[WRITE_PROTOCOL_ERROR]", {
            schema: key,
            reason: "PATCH_ONLY_RESPONSE"
          });
          return {
            success: false,
            protocolError: true,
            reason: "PATCH_ONLY_RESPONSE",
            originalSchema: key,
            files: []
          };
        }
      }
    }
    return {
      success: false,
      protocolError: true,
      reason: "MISSING_FILES",
      originalSchema: "unknown",
      files: []
    };
  }

  const files = [];
  const schemas = [];

  for (const entry of entries) {
    const result = normalizeFileEntry(entry);
    if (!result.success) {
      if (result.reason === "PATCH_ONLY_RESPONSE") {
        console.log("[WRITE_PROTOCOL_ERROR]", {
          schema: result.originalSchema || "unknown",
          reason: result.reason
        });
      }
      return {
        success: false,
        protocolError: true,
        reason: result.reason || "WRITE_COORDINATOR_PROTOCOL_ERROR",
        originalSchema: result.originalSchema || "unknown",
        files: []
      };
    }
    files.push(result.file);
    schemas.push(result.originalSchema || "content");
  }

  const originalSchema = schemas.length > 0
    ? (schemas.every(schema => schema === schemas[0]) ? schemas[0] : "mixed")
    : "content";
  console.log("[WRITE_RESPONSE_NORMALIZED]", {
    originalSchema
  });
  return {
    success: true,
    protocolError: false,
    reason: null,
    originalSchema,
    files
  };
}

export default normalizeCoordinatorResponse;
