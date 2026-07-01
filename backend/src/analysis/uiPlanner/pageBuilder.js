import { makeId, mergeLabels, unique } from "./shared.js";

function pickLayoutForPage(pageNode, componentTree = null) {
  const byId = new Map((Array.isArray(componentTree?.components) ? componentTree.components : []).map(node => [node.id, node]));
  let current = pageNode;
  while (current?.parent && byId.has(current.parent)) {
    const parent = byId.get(current.parent);
    if (parent?.layout) return parent;
    current = parent;
  }
  return null;
}

function pageDisplayTitle(pageNode, analyses = []) {
  const analysis = analyses.find(item => item.file === pageNode.path);
  if (analysis?.title && !/^(page|index)$/i.test(analysis.title)) return analysis.title;
  return pageNode.name;
}

function collectDescendants(node, byId, collected = new Set()) {
  for (const childId of node?.children || []) {
    if (!byId.has(childId) || collected.has(childId)) continue;
    collected.add(childId);
    collectDescendants(byId.get(childId), byId, collected);
  }
  return collected;
}

function labelWidgets(componentNodes = []) {
  return componentNodes
    .filter(node => {
      const text = `${node.name}\n${node.path}`.toLowerCase();
      return /header|toolbar|search|notification|avatar|sidebar|menu|content|card|chart|footer|button|input|select|checkbox|radio|switch|datepicker|upload|table|calendar|tree|timeline|editor|map|video|pdf|markdown|canvas|dialog|modal|drawer|tabs|wizard|grid|flex/.test(text);
    })
    .map(node => node.name);
}

export function buildPages({ analyses = [], componentTree = null, summary = {} } = {}) {
  const nodes = Array.isArray(componentTree?.components) ? componentTree.components : [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const pages = [];
  const seen = new Set();

  const pageNodes = nodes.filter(node => node.route || node.type === "page" || node.layout === false);
  for (const node of pageNodes) {
    const key = node.path || node.route || node.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const analysis = analyses.find(item => item.file === node.path) || null;
    const layoutNode = pickLayoutForPage(node, componentTree);
    const descendantIds = collectDescendants(node, byId);
    const descendantNodes = [...descendantIds].map(id => byId.get(id)).filter(Boolean);
    const labels = mergeLabels(
      labelWidgets(descendantNodes),
      (analysis?.widgetLabels || [])
    );
    pages.push({
      id: node.id || makeId(node.name, node.path, node.route),
      title: pageDisplayTitle(node, analyses),
      path: node.path,
      route: node.route || null,
      layout: layoutNode ? (analyses.find(item => item.file === layoutNode.path)?.title || layoutNode.name) : null,
      widgets: unique(labels),
      forms: unique(descendantNodes.filter(item => /form/i.test(`${item.name}\n${item.path}`)).map(item => item.name)),
      tables: unique(descendantNodes.filter(item => /table|grid/i.test(`${item.name}\n${item.path}`)).map(item => item.name)),
      charts: unique(descendantNodes.filter(item => /chart|graph/i.test(`${item.name}\n${item.path}`)).map(item => item.name)),
      dialogs: unique(descendantNodes.filter(item => /dialog|modal/i.test(`${item.name}\n${item.path}`)).map(item => item.name)),
      drawers: unique(descendantNodes.filter(item => /drawer/i.test(`${item.name}\n${item.path}`)).map(item => item.name)),
      tabs: unique(descendantNodes.filter(item => /tabs?/i.test(`${item.name}\n${item.path}`)).map(item => item.name)),
      responsive: unique((analyses.find(item => item.file === node.path)?.responsiveLabels || [])),
      navigation: unique((analyses.find(item => item.file === node.path)?.navigationLabels || []).concat(
        descendantNodes.filter(item => /sidebar|navbar|menu|breadcrumb|tabs|wizard|router|redirect/i.test(`${item.name}\n${item.path}`)).map(item => item.name)
      )),
      providers: unique(descendantNodes.filter(item => /provider|context|store|signal/i.test(`${item.name}\n${item.path}`)).map(item => item.name)),
      stores: unique(descendantNodes.filter(item => /store|redux|vuex|pinia|ngrx|mobx|context|signal/i.test(`${item.name}\n${item.path}`)).map(item => item.name)),
      permissions: unique(descendantNodes.filter(item => /permission|protected|auth/i.test(`${item.name}\n${item.path}`)).map(item => item.name)),
      dependencies: unique(descendantNodes.map(item => item.name)),
      componentTree: {
        componentId: node.id,
        rootCount: 1 + descendantNodes.length,
        summary
      }
    });
  }

  if (pages.length === 0) {
    for (const analysis of analyses.filter(item => item.pageLike)) {
      const key = analysis.file;
      if (seen.has(key)) continue;
      seen.add(key);
      pages.push({
        id: makeId(analysis.file, analysis.route || analysis.title),
        title: analysis.title,
        path: analysis.file,
        route: analysis.route || null,
        layout: analysis.layout ? analysis.title : null,
        widgets: unique(analysis.widgetLabels),
        forms: analysis.forms ? [analysis.title] : [],
        tables: analysis.tables ? [analysis.title] : [],
        charts: analysis.charts ? [analysis.title] : [],
        dialogs: analysis.dialogs ? [analysis.title] : [],
        drawers: analysis.drawers ? [analysis.title] : [],
        tabs: analysis.tabs ? [analysis.title] : [],
        responsive: unique(analysis.responsiveLabels),
        navigation: unique(analysis.navigationLabels),
        providers: analysis.providers ? [analysis.title] : [],
        stores: analysis.providers ? [analysis.title] : [],
        permissions: analysis.permissions ? [analysis.title] : [],
        dependencies: unique(analysis.dependencies),
        componentTree: { componentId: null, rootCount: 0, summary }
      });
    }
  }

  return pages;
}
