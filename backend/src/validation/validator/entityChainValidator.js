function log(event, data) {
  console.log(`[${event}]`, data);
}

export function validateEntityChains({
  executionPlan = null,
  knowledgeGraph = null,
  dependencyGraph = null,
  componentTree = null,
  uiPlan = null,
  workspaceState = {}
} = {}) {
  log('VALIDATOR_ENTITY_CHAIN_CHECK', {});

  const passed = [];
  const failed = [];
  const warnings = [];
  const requiredFixes = [];

  const plannedEntities = extractPlannedEntities(executionPlan);

  if (plannedEntities.length === 0) {
    passed.push({ message: 'No planned entities to validate against entity chains' });
    return { passed, failed, warnings, requiredFixes };
  }

  const graphNodes = buildEntityIndex(knowledgeGraph, dependencyGraph, componentTree);
  const hasGraphEvidence = graphNodes.length > 0;

  if (!hasGraphEvidence) {
    warnings.push({ message: 'No graph evidence available; entity chain verification limited' });
  }

  for (const entity of plannedEntities) {
    const entityName = (entity.name || '').toLowerCase();
    const entityPath = (entity.path || '').toLowerCase();

    if (entity.required) {
      const foundInGraph = graphNodes.some(n => {
        const nodeName = (n.name || n.id || '').toLowerCase();
        const nodePath = (n.file || n.path || n.source || '').toLowerCase();
        return nodeName === entityName || (entityPath && nodePath === entityPath) || (entityPath && nodePath.includes(entityPath));
      });

      if (foundInGraph) {
        passed.push({ entity: entity.name, message: `Required entity '${entity.name}' exists in graph evidence` });
      } else if (hasGraphEvidence) {
        failed.push({ entity: entity.name, message: `Required entity '${entity.name}' not found in knowledge graph, dependency graph, or component tree` });
        requiredFixes.push(`Required entity '${entity.name}' is missing from workspace`);
      } else {
        warnings.push({ entity: entity.name, message: `Required entity '${entity.name}' could not be verified: no graph evidence available` });
      }
    } else {
      const foundInGraph = graphNodes.some(n => {
        const nodeName = (n.name || n.id || '').toLowerCase();
        return nodeName === entityName;
      });

      if (!foundInGraph) {
        warnings.push({ entity: entity.name, message: `Optional entity '${entity.name}' planned but not found in graph evidence` });
      }
    }

    if (entity.relations && entity.relations.length > 0 && knowledgeGraph?.edges) {
      for (const rel of entity.relations) {
        const hasRelation = knowledgeGraph.edges.some(e => {
          const edgeSource = (e.source || e.from || '').toLowerCase();
          const edgeTarget = (e.target || e.to || '').toLowerCase();
          const relTarget = (rel.target || '').toLowerCase();
          const relType = rel.type || '';

          const sourceMatch = edgeSource === entityName || edgeSource === entityPath;
          const targetMatch = edgeTarget === relTarget || edgeTarget === (rel.path || '').toLowerCase();
          return sourceMatch && targetMatch && (!relType || (e.type || '').toLowerCase() === relType.toLowerCase());
        });

        if (hasRelation) {
          passed.push({ entity: entity.name, relation: rel.type, target: rel.target, message: `Relation '${rel.type}' from '${entity.name}' to '${rel.target}' verified` });
        } else {
          warnings.push({ entity: entity.name, relation: rel.type, target: rel.target, message: `Planned relation '${rel.type}' from '${entity.name}' to '${rel.target}' not found in graph evidence` });
        }
      }
    }
  }

  if (dependencyGraph) {
    const unresolved = findUnresolvedDependencies(dependencyGraph, plannedEntities);
    for (const item of unresolved) {
      failed.push({ entity: item.entity, message: `Dependent entity '${item.dependency}' required by '${item.entity}' is unresolved` });
      requiredFixes.push(`Dependency '${item.dependency}' required by '${item.entity}' is missing`);
    }
  }

  return { passed, failed, warnings, requiredFixes };
}

function extractPlannedEntities(executionPlan) {
  if (!executionPlan?.tasks) return [];

  const entities = [];
  const seen = new Set();

  for (const task of executionPlan.tasks) {
    const goal = task.goal || '';
    const filePath = task.toolArgs?.path || task.toolArgs?.file || '';

    const entityMatches = goal.match(/\b(create|implement|build|add|generate|write)\s+(?:a|an|the)?\s*([A-Z][a-zA-Z]+)/gi);
    if (entityMatches) {
      for (const match of entityMatches) {
        const name = match.replace(/^(create|implement|build|add|generate|write)\s+(?:a|an|the)?\s*/i, '').trim();
        if (name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          entities.push({ name, path: filePath, required: task.kind === 'CODING' || task.tool === 'WRITE_FILE', relations: [] });
        }
      }
    }

    if (filePath && !seen.has(filePath.toLowerCase())) {
      seen.add(filePath.toLowerCase());
      const name = filePath.split(/[/\\]/).pop() || filePath;
      entities.push({ name, path: filePath, required: task.kind === 'CODING' || task.tool === 'WRITE_FILE', relations: [] });
    }
  }

  return entities;
}

function buildEntityIndex(...sources) {
  const nodes = [];
  for (const source of sources) {
    if (!source) continue;
    if (source.nodes) {
      for (const n of source.nodes) nodes.push(n);
    }
    if (source.components) {
      for (const n of source.components) nodes.push(n);
    }
  }
  return nodes;
}

function findUnresolvedDependencies(dependencyGraph, plannedEntities) {
  const results = [];
  if (!dependencyGraph?.nodes) return results;

  const graphNodeIds = new Set();
  for (const node of dependencyGraph.nodes) {
    const nodeId = node.id || node.file || node.path || '';
    if (nodeId) graphNodeIds.add(nodeId.toLowerCase());
  }

  const graphEdges = dependencyGraph.edges || [];

  for (const entity of plannedEntities) {
    if (!entity.required) continue;
    const entityId = (entity.path || entity.name || '').toLowerCase();
    if (!entityId) continue;

    const dependencies = graphEdges
      .filter(e => {
        const edgeSource = (e.source || e.from || '').toLowerCase();
        const edgeTarget = (e.target || e.to || '').toLowerCase();
        return (edgeSource === entityId) && e.type === 'dependsOn';
      })
      .map(e => e.target || e.to || '');

    for (const dep of dependencies) {
      if (dep && !graphNodeIds.has(dep.toLowerCase())) {
        results.push({ entity: entity.name, dependency: dep });
      }
    }
  }

  return results;
}
