import path from "node:path";
import { basename, classifyDependencyKind, normalizePath, resolveDependencyTarget, unique } from "./fileGraph.js";
import { DEPENDENCY_NODE_TYPES } from "./types.js";

function readPackageNameFromPath(file = "") {
  const normalized = normalizePath(file);
  if (/package\.json$/i.test(path.posix.basename(normalized))) return path.posix.dirname(normalized) || ".";
  return null;
}

function extractPackageDependencies(packageJson = {}) {
  const deps = new Set([
    ...Object.keys(packageJson?.dependencies || {}),
    ...Object.keys(packageJson?.devDependencies || {}),
    ...Object.keys(packageJson?.peerDependencies || {})
  ]);
  return [...deps];
}

function buildModuleDependencyEdges(file = "", content = "", context = {}) {
  const refs = unique(context.fileDependencies || []);
  const edges = [];
  for (const ref of refs) {
    const kind = classifyDependencyKind(ref);
    const target = resolveDependencyTarget(ref, file, context);
    if (!target) continue;
    edges.push({
      from: normalizePath(file),
      to: target,
      type: kind === "file" ? "file" : "module",
      reason: ref,
      raw: ref
    });
  }
  return edges;
}

function buildPackageNodes(workspaceFiles = [], packageJsonByFile = {}) {
  const nodes = [];
  for (const file of workspaceFiles) {
    if (!/package\.json$/i.test(path.posix.basename(normalizePath(file)))) continue;
    const pkg = packageJsonByFile[normalizePath(file)] || {};
    const id = `package:${pkg.name || path.posix.dirname(normalizePath(file)) || "workspace"}`;
    nodes.push({
      id,
      name: pkg.name || basename(path.posix.dirname(normalizePath(file))) || "workspace",
      path: normalizePath(file),
      framework: "package",
      type: DEPENDENCY_NODE_TYPES.PACKAGE,
      packageName: pkg.name || null,
      dependencies: extractPackageDependencies(pkg).map(dep => `package:${dep}`),
      dependents: [],
      dependencyCount: extractPackageDependencies(pkg).length,
      dependentCount: 0,
      fanIn: 0,
      fanOut: extractPackageDependencies(pkg).length,
      criticalScore: 0,
      impactScore: 0,
      reuseScore: 0,
      changeFrequency: 0,
      unused: false,
      circular: false,
      build: true,
      asset: false,
      config: true
    });
  }
  return nodes;
}

export {
  buildModuleDependencyEdges,
  buildPackageNodes,
  extractPackageDependencies,
  readPackageNameFromPath
};

