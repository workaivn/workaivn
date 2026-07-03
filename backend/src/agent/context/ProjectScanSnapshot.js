import crypto from "node:crypto";
import { normalizeCanonicalPath } from "./canonicalPath.js";

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

function uniqueList(value = []) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => normalizeCanonicalPath(item)).filter(Boolean))];
}

export function createProjectScanSnapshot(scan = {}, { workspaceRoot = scan.workspaceRoot || "", scanId = null, timestamp = null } = {}) {
  const snapshot = {
    ...scan,
    workspaceRoot: workspaceRoot || scan.workspaceRoot || "",
    projectType: scan.projectType || "generic",
    packageJsonFound: scan.packageJsonFound === true,
    packageJsonPath: scan.packageJsonPath || null,
    packageManager: scan.packageManager || null,
    packageManagerVerified: scan.packageManagerVerified === true,
    packageManagerSource: scan.packageManagerSource || null,
    scripts: Array.isArray(scan.scripts) ? [...scan.scripts] : (scan.scripts && typeof scan.scripts === "object" ? { ...scan.scripts } : {}),
    entryFiles: uniqueList(scan.entryFiles),
    styleFiles: uniqueList(scan.styleFiles),
    testCommands: uniqueList(scan.testCommands),
    buildCommands: uniqueList(scan.buildCommands),
    runCommands: uniqueList(scan.runCommands),
    appRoots: uniqueList(scan.appRoots),
    sourceRoots: uniqueList(scan.sourceRoots),
    moduleRoots: uniqueList(scan.moduleRoots),
    testRoots: uniqueList(scan.testRoots),
    existingTopLevelDirs: uniqueList(scan.existingTopLevelDirs),
    discoveredFiles: uniqueList(scan.discoveredFiles || scan.files || []),
    explicitRequestedFiles: uniqueList(scan.explicitRequestedFiles || scan.explicitRequestedNewFiles || []),
    plannerApprovedFiles: uniqueList(scan.plannerApprovedFiles || scan.plannedFiles || scan.plannedNewFiles || []),
    generatedFiles: uniqueList(scan.generatedFiles),
    dependencyReleasedFiles: uniqueList(scan.dependencyReleasedFiles),
    timestamp: timestamp || scan.timestamp || new Date().toISOString(),
    scanId: scanId || scan.scanId || crypto.randomUUID()
  };

  console.log("[PROJECT_SCAN_SNAPSHOT_CREATED]", {
    scanId: snapshot.scanId,
    projectType: snapshot.projectType,
    packageJsonFound: snapshot.packageJsonFound,
    packageManagerVerified: snapshot.packageManagerVerified,
    entryFileCount: snapshot.entryFiles.length,
    buildCommandCount: snapshot.buildCommands.length,
    runCommandCount: snapshot.runCommands.length
  });

  const frozen = deepFreeze(snapshot);
  console.log("[PROJECT_SCAN_SNAPSHOT_FROZEN]", {
    scanId: frozen.scanId,
    projectType: frozen.projectType
  });
  return frozen;
}

export function getCanonicalWorkspaceFiles(projectScanSnapshot = {}) {
  const snapshot = projectScanSnapshot || {};
  const canonical = new Set();
  const sources = [
    ["discoveredFiles", snapshot.discoveredFiles || snapshot.files || []],
    ["explicitRequestedFiles", snapshot.explicitRequestedFiles || snapshot.explicitRequestedNewFiles || []],
    ["plannerApprovedFiles", snapshot.plannerApprovedFiles || snapshot.plannedFiles || snapshot.plannedNewFiles || []],
    ["generatedFiles", snapshot.generatedFiles || []],
    ["dependencyReleasedFiles", snapshot.dependencyReleasedFiles || []],
    ["entryFiles", snapshot.entryFiles || []],
    ["styleFiles", snapshot.styleFiles || []],
    ["configFiles", snapshot.configFiles || []]
  ];

  const add = (path, source) => {
    const normalized = normalizeCanonicalPath(path);
    if (!normalized) return false;
    if (canonical.has(normalized)) return true;
    canonical.add(normalized);
    console.log("[CANONICAL_FILE_INCLUDED]", {
      path: normalized,
      source
    });
    console.log("[CANONICAL_PATH_NORMALIZED]", {
      original: path,
      normalized,
      source
    });
    return true;
  };

  for (const [source, list] of sources) {
    for (const file of Array.isArray(list) ? list : []) {
      add(file, source);
    }
  }

  if (snapshot.packageJsonFound === true) {
    add(snapshot.packageJsonPath || "package.json", "packageJsonPath");
  }

  console.log("[CANONICAL_FILE_UNIVERSE_CREATED]", {
    scanId: snapshot.scanId || null,
    discoveredFiles: uniqueList(snapshot.discoveredFiles || snapshot.files || []),
    explicitRequestedFiles: uniqueList(snapshot.explicitRequestedFiles || snapshot.explicitRequestedNewFiles || []),
    plannerApprovedFiles: uniqueList(snapshot.plannerApprovedFiles || snapshot.plannedFiles || snapshot.plannedNewFiles || []),
    generatedFiles: uniqueList(snapshot.generatedFiles || []),
    dependencyReleasedFiles: uniqueList(snapshot.dependencyReleasedFiles || []),
    totalFiles: canonical.size
  });

  return canonical;
}

export { deepFreeze as freezeProjectScanSnapshot };
