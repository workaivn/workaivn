export const KNOWLEDGE_GRAPH_VERSION = 2;

export const KNOWLEDGE_GRAPH_FILE = "knowledge-graph.json";

export const KG_LOG_EVENTS = {
  START: "KNOWLEDGE_GRAPH_START",
  SOURCE_SCANNED: "KG_SOURCE_SCANNED",
  ENTITY_FOUND: "KG_ENTITY_FOUND",
  RELATION_FOUND: "KG_RELATION_FOUND",
  DOMAIN_INFERRED: "KG_DOMAIN_ENTITY_INFERRED",
  ROUTE_MAPPED: "KG_ROUTE_MAPPED",
  API_MAPPED: "KG_API_MAPPED",
  UI_MAPPED: "KG_UI_MAPPED",
  DATA_MAPPED: "KG_DATA_MAPPED",
  TEST_MAPPED: "KG_TEST_MAPPED",
  COMMAND_MAPPED: "KG_COMMAND_MAPPED",
  CONFIG_MAPPED: "KG_CONFIG_MAPPED",
  DOC_MAPPED: "KG_DOC_MAPPED",
  HISTORY_MAPPED: "KG_HISTORY_MAPPED",
  FAILURE_STORED: "KG_FAILURE_PATTERN_STORED",
  IMPACT_RESOLVED: "KG_IMPACT_RESOLVED",
  QUERY_EXECUTED: "KG_QUERY_EXECUTED",
  CONFIDENCE_ASSIGNED: "KG_CONFIDENCE_ASSIGNED",
  STALE_INVALIDATED: "KG_STALE_NODE_INVALIDATED",
  COMPLETE: "KNOWLEDGE_GRAPH_COMPLETE"
};

export const KG_NODE_TYPES = {
  PROJECT: "project",
  PACKAGE: "package",
  FOLDER: "folder",
  FILE: "file",
  MODULE: "module",
  ROUTE: "route",
  UI: "ui",
  API: "api",
  DATA: "data",
  CONFIG: "config",
  COMMAND: "command",
  TEST: "test",
  ASSET: "asset",
  DOCUMENTATION: "documentation",
  DOMAIN: "domain",
  HISTORY: "history",
  UNKNOWN: "unknown"
};

export const KG_EDGE_TYPES = {
  CONTAINS: "contains",
  IMPORTS: "imports",
  EXPORTS: "exports",
  CALLS: "calls",
  RENDERS: "renders",
  READS: "reads",
  WRITES: "writes",
  CONFIGURES: "configures",
  VALIDATES: "validates",
  TESTS: "tests",
  DOCUMENTS: "documents",
  DEPENDS_ON: "dependsOn",
  AFFECTS: "affects",
  ROUTES_TO: "routesTo",
  HANDLES: "handles",
  QUERIES: "queries",
  MUTATES: "mutates",
  OWNS: "owns",
  BELONGS_TO: "belongsTo",
  UNKNOWN: "unknown"
};

export const CONFIDENCE_LEVELS = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low"
};

export const CONFIDENCE_SCORES = {
  HIGH: 0.9,
  MEDIUM: 0.6,
  LOW: 0.3,
  MIN: 0.1
};
