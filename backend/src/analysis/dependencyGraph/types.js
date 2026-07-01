export const DEPENDENCY_GRAPH_VERSION = 1;

export const DEPENDENCY_GRAPH_FILE = "dependency-graph.json";

export const DEPENDENCY_LOG_EVENTS = {
  START: "DEPENDENCY_GRAPH_START",
  FILE: "FILE_DEPENDENCY_FOUND",
  MODULE: "MODULE_DEPENDENCY_FOUND",
  COMPONENT: "COMPONENT_DEPENDENCY_FOUND",
  API: "API_DEPENDENCY_FOUND",
  DATABASE: "DATABASE_DEPENDENCY_FOUND",
  STATE: "STATE_DEPENDENCY_FOUND",
  RUNTIME: "RUNTIME_DEPENDENCY_FOUND",
  BUILD: "BUILD_DEPENDENCY_FOUND",
  CYCLE: "CYCLE_FOUND",
  IMPACT: "IMPACT_ANALYZED",
  COMPLETE: "DEPENDENCY_GRAPH_COMPLETE"
};

export const DEPENDENCY_NODE_TYPES = {
  FILE: "file",
  MODULE: "module",
  PACKAGE: "package",
  COMPONENT: "component",
  SERVICE: "service",
  API: "api",
  DATABASE: "database",
  RUNTIME: "runtime",
  BUILD: "build",
  TEST: "test",
  STATE: "state",
  ASSET: "asset",
  CONFIG: "config",
  ROUTE: "route",
  MODEL: "model",
  REPOSITORY: "repository",
  CONTROLLER: "controller",
  UNKNOWN: "unknown"
};

export const DEPENDENCY_EDGE_TYPES = {
  FILE: "file",
  MODULE: "module",
  COMPONENT: "component",
  ROUTE: "route",
  API: "api",
  DATABASE: "database",
  STATE: "state",
  RUNTIME: "runtime",
  BUILD: "build",
  TEST: "test",
  ASSET: "asset",
  IMPACT: "impact"
};

