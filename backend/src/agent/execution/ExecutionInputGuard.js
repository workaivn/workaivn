import { isExecutableAuthoritySource, normalizeAuthoritySource } from '../../planner/authority/AuthoritySource.js';

function normalize(value = "") {
  return String(value || "").replace(/\\/g, "/").trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => normalize(value)).filter(Boolean))];
}

function getCanonicalUniverse(unit = {}, context = {}) {
  const fromContext = Array.isArray(context?.canonicalFileUniverse) ? context.canonicalFileUniverse : [];
  const fromContract = Array.isArray(unit?.executionContract?.requiredContext?.canonicalFileUniverse)
    ? unit.executionContract.requiredContext.canonicalFileUniverse
    : Array.isArray(unit?.executionContract?.canonicalFileUniverse)
      ? unit.executionContract.canonicalFileUniverse
      : [];
  const fromUnit = Array.isArray(unit?.canonicalFileUniverse)
    ? unit.canonicalFileUniverse
    : Array.isArray(unit?.canonicalTargets)
      ? unit.canonicalTargets
      : [];
  return unique([...(fromContext || []), ...(fromContract || []), ...(fromUnit || [])]);
}

function isCanonicalSensitiveTool(toolName = "") {
  return ["READ_FILE", "WRITE_FILE", "APPLY_PATCH", "VALIDATE_PATCH", "CREATE_FILE", "DELETE_FILE"].includes(String(toolName || "").toUpperCase());
}

function collectTargets(unit = {}) {
  return unique([
    ...(Array.isArray(unit?.targetFiles) ? unit.targetFiles : []),
    ...(Array.isArray(unit?.requiredReads) ? unit.requiredReads : []),
    ...(Array.isArray(unit?.requiredWrites) ? unit.requiredWrites : []),
    unit?.inputs?.path,
    unit?.inputs?.file,
    unit?.inputs?.target,
    unit?.outputs?.path,
    unit?.outputs?.file,
    unit?.outputs?.target,
    unit?.toolArgs?.path,
    unit?.toolArgs?.file,
    unit?.toolArgs?.target
  ]);
}

function isExecutableMarkerPresent(unit = {}) {
  return unit?.approvalId || unit?.approvedByFirewall === true || String(unit?.authorityState || "").toLowerCase() === "approved";
}

function hasExecutionMetadata(unit = {}) {
  if (unit?.executionMetadata && typeof unit.executionMetadata === "object") return true;
  if (unit?.metadata && typeof unit.metadata === "object") return Object.keys(unit.metadata).length > 0;
  if (unit?.inputs && typeof unit.inputs === "object" && Object.keys(unit.inputs).length > 0) return true;
  if (unit?.outputs && typeof unit.outputs === "object" && Object.keys(unit.outputs).length > 0) return true;
  if (unit?.toolArgs && typeof unit.toolArgs === "object" && Object.keys(unit.toolArgs).length > 0) return true;
  return false;
}

function getOperationKind(unit = {}) {
  return String(unit?.operationKind || unit?.type || unit?.tool || unit?.kind || "").trim();
}

function getAuthoritySource(unit = {}) {
  return normalizeAuthoritySource(
    unit?.authoritySource ||
    unit?.authority?.source ||
    unit?.metadata?.authoritySource ||
    unit?.metadata?.authority?.source ||
    ''
  );
}

function isRejectedUnit(unit = {}) {
  return unit?.recommendationOnly === true ||
    unit?.executable === false ||
    unit?.blocked === true ||
    unit?.rejected === true ||
    unit?.templateSource != null ||
    unit?.metadata?.recommendationOnly === true ||
    unit?.metadata?.blocked === true ||
    unit?.metadata?.rejected === true ||
    unit?.metadata?.templateSource != null ||
    unit?.metadata?.template === true;
}

function pathMatchesUnit(pathValue = "", unit = {}) {
  const normalized = normalize(pathValue).toLowerCase();
  if (!normalized) return true;
  const targets = collectTargets(unit).map(value => value.toLowerCase());
  if (targets.length === 0) return false;
  return targets.includes(normalized);
}

function createError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

export function assertExecutableUnit(unit, context = {}) {
  console.log("[EXECUTION_INPUT_GUARD_ENTER]", {
    unitId: unit?.id || null,
    unitType: unit?.type || unit?.tool || null,
    path: context.path || null,
    toolName: context.toolName || null
  });

  if (!unit || typeof unit !== "object") {
    console.log("[EXECUTION_INPUT_REJECTED]", {
      reason: "execution unit missing",
      path: context.path || null,
      toolName: context.toolName || null
    });
    throw createError("EXECUTION_INPUT_REJECTED", "Execution unit is required", {
      reason: "execution unit missing",
      path: context.path || null,
      toolName: context.toolName || null
    });
  }

  const rejectedReason = isRejectedUnit(unit)
    ? "rejected, blocked, template, or recommendation unit"
    : (!isExecutableMarkerPresent(unit) ? "approval metadata missing" : null);

  if (rejectedReason) {
    console.log("[EXECUTION_INPUT_REJECTED]", {
      unitId: unit.id || null,
      reason: rejectedReason,
      path: context.path || null,
      toolName: context.toolName || null
    });
    throw createError("EXECUTION_INPUT_REJECTED", "Execution unit is not executable", {
      reason: rejectedReason,
      unitId: unit.id || null,
      path: context.path || null,
      toolName: context.toolName || null
    });
  }

  const operationKind = getOperationKind(unit);
  if (!operationKind) {
    console.log("[EXECUTION_INPUT_REJECTED]", {
      unitId: unit.id || null,
      reason: "operation kind missing",
      path: context.path || null,
      toolName: context.toolName || null
    });
    throw createError("EXECUTION_INPUT_REJECTED", "Execution unit is missing an operation kind", {
      reason: "operation kind missing",
      unitId: unit.id || null,
      path: context.path || null,
      toolName: context.toolName || null
    });
  }

  if (!hasExecutionMetadata(unit)) {
    console.log("[EXECUTION_INPUT_REJECTED]", {
      unitId: unit.id || null,
      reason: "execution metadata missing",
      path: context.path || null,
      toolName: context.toolName || null
    });
    throw createError("EXECUTION_INPUT_REJECTED", "Execution unit is missing execution metadata", {
      reason: "execution metadata missing",
      unitId: unit.id || null,
      path: context.path || null,
      toolName: context.toolName || null
    });
  }

  const authoritySource = getAuthoritySource(unit);
  if (authoritySource && !isExecutableAuthoritySource(authoritySource)) {
    console.log("[AUTHORITY_SOURCE_REJECTED]", {
      unitId: unit.id || null,
      authoritySource,
      reason: "unit authority source is not executable"
    });
    throw createError("AUTHORITY_SOURCE_REJECTED", "Execution unit authority source is not executable", {
      reason: "unit authority source is not executable",
      unitId: unit.id || null,
      authoritySource
    });
  }

  if (context.path && isCanonicalSensitiveTool(context.toolName || unit.tool || unit.type || "")) {
    const canonicalUniverse = getCanonicalUniverse(unit, context);
    const normalizedPath = normalize(context.path).toLowerCase();
    if (canonicalUniverse.length > 0 && !canonicalUniverse.map(value => value.toLowerCase()).includes(normalizedPath)) {
      console.log("[NON_CANONICAL_FILE_BLOCKED]", {
        path: normalize(context.path),
        toolName: context.toolName || unit.tool || unit.type || null,
        unitId: unit.id || null,
        canonicalUniverseSize: canonicalUniverse.length,
        reason: "path not present in canonical file universe"
      });
      throw createError("NON_CANONICAL_FILE_BLOCKED", "Path does not belong to the canonical file universe", {
        path: normalize(context.path),
        reason: "path not present in canonical file universe",
        toolName: context.toolName || unit.tool || unit.type || null,
        unitId: unit.id || null
      });
    }
  }

  if (context.path && !pathMatchesUnit(context.path, unit)) {
    console.log("[NON_EXECUTABLE_PATH_BLOCKED]", {
      path: normalize(context.path),
      reason: "path not present on approved execution unit",
      source: context.toolName || unit.tool || unit.type || null
    });
    throw createError("NON_EXECUTABLE_PATH_REJECTED", "Path does not belong to an approved execution unit", {
      path: normalize(context.path),
      reason: "path not present on approved execution unit",
      source: context.toolName || unit.tool || unit.type || null,
      unitId: unit.id || null
    });
  }

  console.log("[EXECUTION_INPUT_ACCEPTED]", {
    unitId: unit.id || null,
    unitType: unit.type || unit.tool || null,
    path: context.path || null,
    toolName: context.toolName || null
  });
  return unit;
}

export function filterExecutableUnits(units = []) {
  const executableUnits = [];
  const rejectedUnits = [];

  for (const unit of Array.isArray(units) ? units : []) {
    try {
      executableUnits.push(assertExecutableUnit(unit));
    } catch (error) {
      rejectedUnits.push({
        unit,
        error: error?.code || error?.message || "EXECUTION_INPUT_REJECTED"
      });
    }
  }

  return { executableUnits, rejectedUnits };
}

export function assertExecutionGraphClean(graph = {}) {
  const units = Array.isArray(graph?.approvedUnits)
    ? graph.approvedUnits
    : typeof graph?.allUnits === "function"
      ? graph.allUnits()
      : Array.isArray(graph?.nodes)
        ? graph.nodes
        : [];
  const { executableUnits, rejectedUnits } = filterExecutableUnits(units);
  if (rejectedUnits.length > 0) {
    console.log("[PIPELINE_LEAK_DETECTED]", {
      unitCount: units.length,
      rejectedCount: rejectedUnits.length,
      rejectedUnitIds: rejectedUnits.map(entry => entry.unit?.id).filter(Boolean)
    });
    throw createError("EXECUTION_GRAPH_NOT_CLEAN", "Execution graph contains non-executable units", {
      rejectedUnits
    });
  }
  console.log("[EXECUTION_GRAPH_CLEAN]", { unitCount: executableUnits.length });
  return {
    clean: true,
    executableUnits
  };
}
