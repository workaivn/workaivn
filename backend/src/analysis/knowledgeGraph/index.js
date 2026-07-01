export {
  buildKnowledgeGraph,
  loadKnowledgeGraph,
  updateKnowledgeGraph,
  queryKnowledgeGraph as queryKnowledgeGraphFromBuilder,
  findEntity as findEntityFromBuilder,
  findRelations as findRelationsFromBuilder,
  serializeKnowledgeGraph
} from "./builder.js";

export {
  queryKnowledgeGraph,
  findEntity,
  findRelations,
  findFeatureLocation,
  findImpacts,
  findTestsForChange,
  findCommandsForValidation,
  findFailurePattern,
  summarizeProjectKnowledge
} from "./queryEngine.js";

export {
  loadKnowledgeGraph as loadKnowledgeGraphFromCache,
  saveKnowledgeGraph,
  resolveGraphPath
} from "./serializer.js";

export { validateKnowledgeGraph } from "./validator.js";

export {
  KNOWLEDGE_GRAPH_FILE,
  KNOWLEDGE_GRAPH_VERSION,
  KG_LOG_EVENTS,
  KG_NODE_TYPES,
  KG_EDGE_TYPES,
  CONFIDENCE_LEVELS,
  CONFIDENCE_SCORES
} from "./types.js";
