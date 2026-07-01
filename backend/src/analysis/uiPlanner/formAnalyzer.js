import { detectPageKind, mergeLabels, unique } from "./shared.js";

export function analyzeForms({ analyses = [], componentTree = null } = {}) {
  const forms = [];
  const seen = new Set();
  const nodes = Array.isArray(componentTree?.components) ? componentTree.components : [];

  for (const analysis of analyses) {
    if (!analysis.forms) continue;
    const key = analysis.file;
    if (seen.has(key)) continue;
    seen.add(key);
    forms.push({
      id: analysis.file,
      name: analysis.title || detectPageKind("", analysis.file),
      path: analysis.file,
      kind: "form",
      fields: unique((analysis.dependencies || []).map(value => value.replace(/^use/i, ""))),
      validation: true,
      requiredField: /required/i.test(analysis.file),
      submit: /submit/i.test(analysis.file),
      reset: /reset/i.test(analysis.file),
      asyncValidation: /async/i.test(analysis.file),
      wizardForm: /wizard/i.test(analysis.file),
      dynamicForm: /dynamic/i.test(analysis.file),
      nestedForm: /nested/i.test(analysis.file),
      upload: /upload/i.test(analysis.file),
      dependencies: unique(nodes.filter(node => node.route === analysis.route || node.path === analysis.file).map(node => node.name)),
      labels: mergeLabels(["form"], analysis.widgetLabels)
    });
  }

  return forms;
}

