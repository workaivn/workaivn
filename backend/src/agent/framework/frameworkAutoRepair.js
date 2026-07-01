import { parse as parseJavaScript } from "@babel/parser";

function parseSource(content) {
  try {
    return parseJavaScript(String(content || ""), {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "dynamicImport",
        "importMeta",
        "topLevelAwait"
      ]
    });
  } catch {
    return null;
  }
}

function walkAST(nodes, callback) {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    callback(node);
    for (const key of Object.keys(node)) {
      if (["type", "start", "end", "loc", "leadingComments", "trailingComments", "comments", "extra"].includes(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) walkAST(child, callback);
      else if (child && typeof child.type === "string") walkAST([child], callback);
    }
  }
}

function extractLocals(ast) {
  const locals = new Set();
  for (const node of ast.program.body) {
    if (node.type === "FunctionDeclaration" && node.id?.name) locals.add(node.id.name);
    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (decl.id?.type === "Identifier") locals.add(decl.id.name);
        else if (decl.id?.type === "ObjectPattern") {
          for (const prop of decl.id.properties) {
            if (prop.type === "RestElement") continue;
            if (prop.key?.name) locals.add(prop.key.name);
            else if (prop.value?.name) locals.add(prop.value.name);
          }
        }
      }
    }
    if (node.type === "ClassDeclaration" && node.id?.name) locals.add(node.id.name);
  }
  return locals;
}

function repairNodeTestImports(content, ast, transforms) {
  const hasNodeAssert = ast.program.body.some(
    n => n.type === "ImportDeclaration" && n.source.value === "node:assert/strict"
  );
  const needsAssert = ast.program.body.some(
    n => n.type === "ImportDeclaration" && n.source.value === "node:test" &&
      n.specifiers.some(s => {
        if (s.type === "ImportSpecifier") return s.imported.name === "expect";
        return false;
      })
  );

  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    if (node.source.value !== "node:test") continue;

    const validSpecifiers = [];
    const invalidSpecifiers = [];
    for (const spec of node.specifiers) {
      const name = spec.type === "ImportDefaultSpecifier"
        ? spec.local.name
        : spec.type === "ImportSpecifier"
          ? spec.imported.name
          : null;
      if (name === "test" || (spec.type === "ImportDefaultSpecifier" && spec.local.name === "test")) {
        validSpecifiers.push(spec);
      } else {
        invalidSpecifiers.push(spec);
      }
    }

    if (invalidSpecifiers.length === 0) continue;

    const hasValidSpecifiers = validSpecifiers.length > 0;
    let replacement = "";

    if (hasValidSpecifiers) {
      const specTexts = validSpecifiers.map(s => content.slice(s.start, s.end));
      const isDefault = validSpecifiers.some(s => s.type === "ImportDefaultSpecifier");
      if (isDefault) {
        const defaultSpec = validSpecifiers.find(s => s.type === "ImportDefaultSpecifier");
        replacement = `import ${content.slice(defaultSpec.start, defaultSpec.end)} from "node:test";\n`;
        const namedSpecs = validSpecifiers.filter(s => s.type === "ImportSpecifier");
        if (namedSpecs.length > 0) {
          replacement = `import ${defaultSpec ? content.slice(defaultSpec.start, defaultSpec.end) + ", " : ""}{ ${namedSpecs.map(s => content.slice(s.start, s.end)).join(", ")} } from "node:test";\n`;
        }
      } else {
        replacement = `import { ${specTexts.join(", ")} } from "node:test";\n`;
      }
    }

    if (needsAssert && !hasNodeAssert) {
      replacement += 'import assert from "node:assert/strict";\n';
    }

    const invalidNames = invalidSpecifiers
      .filter(s => s.type === "ImportSpecifier")
      .map(s => s.imported.name)
      .filter(Boolean);

    transforms.push({
      start: node.start,
      end: node.end,
      replacement,
      description: `Replace import ${content.slice(node.start, node.end)}`
    });
  }
}

function findExpectCalls(content, ast, transforms) {
  const expectNodes = [];
  walkAST(ast.program.body, (node) => {
    if (node.type !== "CallExpression") return;
    if (node.callee?.type !== "MemberExpression") return;
    if (node.callee?.object?.type !== "CallExpression") return;
    if (node.callee?.object?.callee?.type !== "Identifier") return;
    if (node.callee?.object?.callee?.name !== "expect") return;

    const matcher = node.callee?.property?.name;
    if (!matcher || !["toBe", "toEqual", "toThrow", "toBeTruthy", "toBeFalsy"].includes(matcher)) return;

    expectNodes.push(node);
  });

  for (const call of expectNodes) {
    const matcher = call.callee.property.name;
    const expectArgs = call.callee.object.arguments
      .map(a => content.slice(a.start, a.end))
      .join(", ");
    const matcherArgs = call.arguments
      .map(a => content.slice(a.start, a.end))
      .join(", ");

    let replacement;
    switch (matcher) {
      case "toBe":
        replacement = `assert.equal(${expectArgs}, ${matcherArgs})`;
        break;
      case "toEqual":
        replacement = `assert.deepEqual(${expectArgs}, ${matcherArgs})`;
        break;
      case "toThrow": {
        const fnArg = /^\s*(?:\([^)]*\)\s*|[a-zA-Z_$]\w*\s*)=>\s*/.test(expectArgs)
          ? expectArgs
          : `() => ${expectArgs}`;
        const errorArg = matcherArgs
          ? matcherArgs.replace(/^(["'])(.+)\1$/, '/$2/')
          : '';
        replacement = errorArg
          ? `assert.throws(${fnArg}, ${errorArg})`
          : `assert.throws(${fnArg})`;
        break;
      }
      case "toBeTruthy":
        replacement = `assert.ok(${expectArgs})`;
        break;
      case "toBeFalsy":
        replacement = `assert.ok(!${expectArgs})`;
        break;
      default:
        continue;
    }

    transforms.push({
      start: call.start,
      end: call.end,
      replacement,
      description: `Replace expect().${matcher}() with ${replacement}`
    });
  }
}

function findDescribeItCalls(ast, locals, transforms) {
  walkAST(ast.program.body, (node) => {
    if (node.type !== "CallExpression") return;
    if (node.callee?.type !== "Identifier") return;
    if (node.callee?.name !== "describe" && node.callee?.name !== "it") return;
    if (locals.has(node.callee.name)) return;

    transforms.push({
      start: node.callee.start,
      end: node.callee.end,
      replacement: "test",
      description: `Replace ${node.callee.name}() with test()`
    });
  });
}

function repairNodeTest(content, validation) {
  const ast = parseSource(content);
  if (!ast) {
    return { repairedContent: content, appliedRepairs: [], success: false };
  }

  const transforms = [];
  const locals = extractLocals(ast);

  repairNodeTestImports(content, ast, transforms);
  findExpectCalls(content, ast, transforms);
  findDescribeItCalls(ast, locals, transforms);

  if (transforms.length === 0) {
    return { repairedContent: content, appliedRepairs: [], success: false };
  }

  transforms.sort((a, b) => b.start - a.start);

  const deduped = [];
  const seen = new Set();
  for (const t of transforms) {
    const key = `${t.start}:${t.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }

  let result = content;
  const appliedRepairs = [];
  for (const t of deduped) {
    result = result.slice(0, t.start) + t.replacement + result.slice(t.end);
    appliedRepairs.push(t.description);
  }

  if (appliedRepairs.length === 0) {
    return { repairedContent: content, appliedRepairs: [], success: false };
  }

  return { repairedContent: result, appliedRepairs: [...new Set(appliedRepairs)], success: true };
}

export function repairFramework(content, framework, frameworkValidation) {
  if (framework === "node:test") {
    return repairNodeTest(content, frameworkValidation);
  }
  return { repairedContent: content, appliedRepairs: [], success: false };
}
