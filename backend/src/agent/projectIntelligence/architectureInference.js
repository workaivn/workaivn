import crypto from "node:crypto";
import path from "node:path";
import { inferPrimaryConcepts, inferSurfaceType, normalizeLower, pascalize, slugify, unique } from "./inference.js";
import { createProposal, createProposalRegistry } from "../planner/proposals/index.js";

function pickFromArray(values = [], fallback = null) {
  const list = unique((Array.isArray(values) ? values : []).filter(Boolean));
  return list.length > 0 ? list[0] : fallback;
}

function inferPackageManager(workspaceState = {}, surfaceType = "static-html") {
  const scan = workspaceState?.scan || {};
  if (scan.packageManager) return scan.packageManager;
  if (workspaceState.hasIndexPhp || workspaceState.hasLaravel) return "composer";
  if (workspaceState.hasCsproj) return "dotnet";
  if (workspaceState.hasFastapi || workspaceState.hasFlask) return "pip";
  if (workspaceState.hasFlutter) return "pub";
  if (surfaceType === "static-html") return "none";
  return null;
}

function inferFramework(surfaceType = "static-html", prompt = "", workspaceState = {}) {
  const lowerPrompt = normalizeLower(prompt);
  const scan = workspaceState?.scan || {};
  if (workspaceState.hasNext || scan.projectType === "next" || /\bnext\.?js\b/.test(lowerPrompt)) return "nextjs-ts";
  if (workspaceState.hasReactVite || scan.projectType === "vite" || /\breact\b|\bvite\b/.test(lowerPrompt) || /\b(?:dashboard|admin|frontend)\b/.test(lowerPrompt)) return "react-vite-ts";
  if (workspaceState.hasNodeExpress || scan.projectType === "express" || /\bapi\b|\bbackend\b|\bserver\b/.test(lowerPrompt)) return "node-express";
  if (workspaceState.hasIndexPhp || workspaceState.hasLaravel || /\bphp\b/.test(lowerPrompt)) return "php-plain";
  if (workspaceState.hasCsproj || /\basp\.?net\b|\baspnet\b|\b\.net\b/.test(lowerPrompt)) return "aspnet-core";
  if (workspaceState.hasFastapi || /\bfastapi\b/.test(lowerPrompt)) return "python-fastapi";
  if (workspaceState.hasFlask || /\bflask\b/.test(lowerPrompt)) return "python-flask";
  if (workspaceState.hasFlutter || /\bflutter\b/.test(lowerPrompt)) return "flutter";
  if (/\b(?:static html|plain html|without framework|landing page|homepage|hero section)\b/.test(lowerPrompt) || surfaceType === "static-html") return "generic-static-html";
  return "generic-static-html";
}

function buildValidationCommands({ framework, workspaceState = {}, targetFiles = [] }) {
  const lowerFiles = new Set((Array.isArray(targetFiles) ? targetFiles : []).map(file => normalizeLower(file)));
  const commands = [];

  if (framework === "react-vite-ts" || framework === "nextjs-ts") {
    const scan = workspaceState?.scan || {};
    if (scan.buildCommands?.length) commands.push(...scan.buildCommands);
    else if (workspaceState?.hasPackageJson || scan.packageManager) commands.push("npm run build");
  } else if (framework === "node-express") {
    if (lowerFiles.has("src/server.js") || lowerFiles.has("server.js")) {
      commands.push(lowerFiles.has("src/server.js") ? "node --check src/server.js" : "node --check server.js");
    }
    if (workspaceState?.scan?.testCommands?.length) commands.push(...workspaceState.scan.testCommands);
  } else if (framework === "php-plain") {
    commands.push("php -l index.php");
  } else if (framework === "aspnet-core") {
    commands.push("dotnet build");
  } else if (framework === "python-fastapi") {
    commands.push("python -m py_compile main.py");
  } else if (framework === "python-flask") {
    commands.push("python -m py_compile app.py");
  } else if (framework === "flutter") {
    commands.push("flutter analyze");
  }

  return unique(commands.filter(Boolean));
}

function buildTargetFiles({ framework, surfaceType, concepts = [], workspaceState = {} }) {
  const existing = new Set((workspaceState?.existingFiles || []).map(file => normalizeLower(file)));
  const concept = slugify(pickFromArray(concepts, "app"));
  const targets = [];

  if (workspaceState.hasIndexPhp || framework === "php-plain") {
    ["index.php", "assets/css/style.css", "assets/js/app.js"].forEach(file => {
      if (!existing.has(normalizeLower(file))) targets.push(file);
    });
    return unique(targets);
  }

  if (workspaceState.hasCsproj || framework === "aspnet-core") {
    ["Program.cs", "appsettings.json"].forEach(file => {
      if (!existing.has(normalizeLower(file))) targets.push(file);
    });
    return unique(targets);
  }

  if (workspaceState.hasFlutter || framework === "flutter") {
    ["pubspec.yaml", "lib/main.dart"].forEach(file => {
      if (!existing.has(normalizeLower(file))) targets.push(file);
    });
    return unique(targets);
  }

  if (workspaceState.hasFastapi || framework === "python-fastapi") {
    ["main.py", "requirements.txt"].forEach(file => {
      if (!existing.has(normalizeLower(file))) targets.push(file);
    });
    return unique(targets);
  }

  if (workspaceState.hasFlask || framework === "python-flask") {
    ["app.py", "requirements.txt"].forEach(file => {
      if (!existing.has(normalizeLower(file))) targets.push(file);
    });
    return unique(targets);
  }

  if (workspaceState.hasNodeExpress || framework === "node-express") {
    ["package.json", "src/server.js"].forEach(file => {
      if (!existing.has(normalizeLower(file))) targets.push(file);
    });
    return unique(targets);
  }

  if (workspaceState.hasNext || framework === "nextjs-ts") {
    ["package.json", "app/page.tsx", "app/layout.tsx"].forEach(file => {
      if (!existing.has(normalizeLower(file))) targets.push(file);
    });
    return unique(targets);
  }

  if (workspaceState.hasReactVite || framework === "react-vite-ts") {
    ["package.json", "index.html", "src/main.tsx", `src/${concept}.tsx`, "src/styles.css"].forEach(file => {
      if (!existing.has(normalizeLower(file))) targets.push(file);
    });
    return unique(targets);
  }

  if (framework === "generic-static-html" || surfaceType === "static-html") {
    ["index.html", "assets/css/style.css", "assets/js/app.js"].forEach(file => {
      if (!existing.has(normalizeLower(file))) targets.push(file);
    });
    return unique(targets);
  }

  ["package.json", `src/${concept}.js`].forEach(file => {
    if (!existing.has(normalizeLower(file))) targets.push(file);
  });
  if (targets.length > 0) return unique(targets);
  ["index.html", "assets/css/style.css", "assets/js/app.js"].forEach(file => {
    if (!existing.has(normalizeLower(file))) targets.push(file);
  });
  return unique(targets);
}

function buildRunCommands({ framework, targetFiles = [], workspaceState = {} }) {
  const commands = [];
  if (framework === "react-vite-ts" || framework === "nextjs-ts") {
    if (workspaceState?.scan?.runCommands?.length) commands.push(...workspaceState.scan.runCommands);
    else if (workspaceState?.hasPackageJson || workspaceState?.scan?.packageManager) commands.push("npm run dev");
  } else if (framework === "node-express") {
    commands.push("node src/server.js");
  } else if (framework === "php-plain") {
    commands.push("php -S localhost:8000");
  } else if (framework === "aspnet-core") {
    commands.push("dotnet run");
  } else if (framework === "python-fastapi") {
    commands.push("python main.py");
  } else if (framework === "python-flask") {
    commands.push("python app.py");
  } else if (framework === "flutter") {
    commands.push("flutter run");
  }

  return unique(commands.filter(Boolean));
}

function buildInstallCommands({ framework, workspaceState = {} }) {
  const commands = [];
  if (framework === "react-vite-ts" || framework === "nextjs-ts" || framework === "node-express") {
    if (!workspaceState.hasPackageJson && workspaceState?.scan?.packageManager) commands.push("npm install");
  } else if (framework === "php-plain" && workspaceState.hasLaravel) {
    commands.push("composer install");
  } else if (framework === "python-fastapi" || framework === "python-flask") {
    commands.push("pip install -r requirements.txt");
  } else if (framework === "flutter") {
    commands.push("flutter pub get");
  }
  return unique(commands.filter(Boolean));
}

function buildBootstrapContent({ file, framework, concepts = [], validationCommands = [] }) {
  const lower = normalizeLower(file);
  const primaryConcept = pickFromArray(concepts, "App");
  const fileBase = pascalize(path.basename(String(file || ""), path.extname(String(file || ""))));
  const pascalName = fileBase && !["Index", "Main"].includes(fileBase)
    ? fileBase
    : pascalize(primaryConcept || "App");

  if (lower === "package.json") {
    const scripts = {};
    const dependencies = {};
    const devDependencies = {};
    if (framework === "react-vite-ts") {
      scripts.dev = "vite";
      scripts.build = "vite build";
      scripts.preview = "vite preview";
      dependencies.react = "^18.3.1";
      dependencies["react-dom"] = "^18.3.1";
      devDependencies.vite = "^5.4.0";
      devDependencies.typescript = "^5.5.4";
    } else if (framework === "nextjs-ts") {
      scripts.dev = "next dev";
      scripts.build = "next build";
      scripts.start = "next start";
      dependencies.react = "^18.3.1";
      dependencies["react-dom"] = "^18.3.1";
      dependencies.next = "^14.2.0";
    } else if (framework === "node-express") {
      scripts.start = "node src/server.js";
      scripts.test = "node --check src/server.js";
      dependencies.express = "^4.19.2";
    } else if (framework === "php-plain") {
      scripts.start = "php -S localhost:8000";
    }
    return JSON.stringify({
      name: slugify(primaryConcept || "app"),
      private: true,
      type: "module",
      scripts,
      ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
      ...(Object.keys(devDependencies).length > 0 ? { devDependencies } : {})
    }, null, 2);
  }

  if (lower === "index.html") {
    const scriptSrc = framework === "generic-static-html" ? "assets/js/app.js" : "src/main.tsx";
    const stylesheetHref = framework === "generic-static-html" || framework === "php-plain"
      ? "assets/css/style.css"
      : "src/styles.css";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pascalName}</title>
  <link rel="stylesheet" href="${stylesheetHref}" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${scriptSrc}"></script>
</body>
</html>
`;
  }

  if (lower === "src/main.tsx" || lower === "src/main.jsx") {
    const componentImport = `./${slugify(primaryConcept || "app")}.${lower.endsWith(".jsx") ? "jsx" : "tsx"}`;
    return `import React from "react";
import ReactDOM from "react-dom/client";
import App from "${componentImport}";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
  }

  if (lower === "app/page.tsx" || lower === "pages/index.tsx") {
    const componentImportPrefix = lower.startsWith("app/") ? "../components" : "../components";
    return `import Layout from "${componentImportPrefix}/layout/Layout";
import Navbar from "${componentImportPrefix}/navigation/Navbar";
import HeroSection from "${componentImportPrefix}/sections/HeroSection";
import FeatureGrid from "${componentImportPrefix}/sections/FeatureGrid";
import CTASection from "${componentImportPrefix}/sections/CTASection";
import Footer from "${componentImportPrefix}/sections/Footer";

export default function Page() {
  return (
    <Layout>
      <Navbar />
      <HeroSection />
      <FeatureGrid />
      <CTASection />
      <Footer />
    </Layout>
  );
}
`;
  }

  if (lower === "app/layout.tsx") {
    return `export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
`;
  }

  if (lower === "src/app.tsx") {
    return `import Layout from "./components/layout/Layout";
import Navbar from "./components/navigation/Navbar";
import HeroSection from "./components/sections/HeroSection";
import FeatureGrid from "./components/sections/FeatureGrid";
import CTASection from "./components/sections/CTASection";
import Footer from "./components/sections/Footer";

export default function App() {
  return (
    <Layout>
      <Navbar />
      <HeroSection />
      <FeatureGrid />
      <CTASection />
      <Footer />
    </Layout>
  );
}
`;
  }

  if (lower === "src/components/layout/layout.tsx") {
    return `export default function Layout({ children }) {
  return <main className="app-shell">{children}</main>;
}
`;
  }

  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) {
    return `export default function ${pascalName}() {
  return <main>${pascalName}</main>;
}
`;
  }

  if (lower.endsWith(".ts") || lower.endsWith(".js")) {
    return `export function ${pascalName}() {
  return "${pascalName}";
}
`;
  }

  if (lower === "src/server.js" || lower === "server.js") {
    return `import express from "express";

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(\`Server listening on ${port}\`));
`;
  }

  if (lower === "index.php") {
    return `<?php
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="assets/css/style.css" />
  <title>${pascalName}</title>
</head>
<body>
  <main class="app-shell">
    <h1>${pascalName}</h1>
  </main>
  <script src="assets/js/app.js"></script>
</body>
</html>
`;
  }

  if (lower.endsWith(".css")) {
    return `:root { color-scheme: light; }
body { margin: 0; font-family: system-ui, sans-serif; }
.app-shell { min-height: 100vh; display: grid; place-items: center; }
`;
  }

  if (lower.endsWith(".js")) {
    return `console.log("${pascalName} ready");
`;
  }

  if (lower.endsWith(".cs")) {
    return `var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapGet("/health", () => Results.Ok(new { ok = true }));
app.Run();
`;
  }

  if (lower.endsWith(".py")) {
    return `print("${pascalName} ready")
`;
  }

  return `// Bootstrap placeholder for ${file}
`;
}

export function inferArchitecture({ intent = {}, workspaceState = {}, knowledgeGraph = null } = {}) {
  const prompt = String(intent.prompt || intent.objective || "").trim();
  const concepts = knowledgeGraph?.concepts || inferPrimaryConcepts(prompt, workspaceState, knowledgeGraph?.uiPlan || null, knowledgeGraph?.componentTree || null, knowledgeGraph?.dependencyGraph || null);
  const surfaceType = inferSurfaceType(prompt, workspaceState, concepts);
  const framework = inferFramework(surfaceType, prompt, workspaceState);
  const packageManager = inferPackageManager(workspaceState, surfaceType);
  const targetFiles = buildTargetFiles({ framework, surfaceType, concepts, workspaceState });
  const validationCommands = buildValidationCommands({ framework, workspaceState, targetFiles });
  const installCommands = buildInstallCommands({ framework, workspaceState });
  const runCommands = buildRunCommands({ framework, targetFiles, workspaceState });
  const buildCommands = framework === "react-vite-ts" || framework === "nextjs-ts"
    ? unique(workspaceState?.scan?.buildCommands || ["npm run build"])
    : framework === "aspnet-core"
      ? ["dotnet build"]
      : [];

  return {
    framework,
    surfaceType,
    packageManager,
    concepts,
    targetFiles,
    validationCommands,
    installCommands,
    buildCommands,
    runCommands,
    canBootstrap: framework !== "aspnet-core" && framework !== "laravel" && framework !== "python-fastapi" && framework !== "python-flask" && framework !== "flutter" ? true : false,
    source: workspaceState?.workspaceRoot ? "workspace+prompt" : "prompt",
    validationStrategy: validationCommands.length > 0 ? "command" : "file-existence"
  };
}

export function buildBootstrapTaskGraphFromArchitecture(architecture = {}, {
  objective = "",
  projectIntent = {},
  workspaceState = {},
  knowledgeGraph = null,
  criteria = {}
} = {}) {
  const proposals = [];
  const validationSkipped = [];
  const targetFiles = unique(architecture.targetFiles || []);
  const validationCommands = unique(architecture.validationCommands || []);
  const contentByFile = {};

  for (const file of targetFiles) {
    contentByFile[file] = buildBootstrapContent({
      file,
      framework: architecture.framework,
      concepts: architecture.concepts || [],
      validationCommands
    });
  }

  const registry = createProposalRegistry();
  if (targetFiles.length > 0) {
    registry.add(createProposal({
      proposalType: "BOOTSTRAP",
      source: "architecture",
      proposalSource: "architecture",
      confidence: 0.92,
      required: true,
      description: `Bootstrap ${architecture.framework || "workspace"} starter files`,
      suggestedFiles: targetFiles,
      suggestedValidation: validationCommands,
      verificationStatus: "unverified",
      promotionDecision: "recommendation",
      evidenceRefs: [`architecture:${architecture.framework || "unknown"}`],
      metadata: { framework: architecture.framework || null, contentByFile, verificationStatus: "unverified", promotionDecision: "recommendation" }
    }));
  }

  const installCommands = unique(architecture.installCommands || []);
  if (installCommands.length > 0) {
    registry.add(createProposal({
      proposalType: "EXECUTION",
      source: "architecture",
      proposalSource: "architecture",
      confidence: 0.8,
      required: true,
      description: `Install dependencies for ${architecture.framework || "workspace"}`,
      suggestedCommands: installCommands,
      verificationStatus: "unverified",
      promotionDecision: "recommendation",
      evidenceRefs: [`architecture:${architecture.framework || "unknown"}`],
      metadata: { phase: "INSTALL_DEPENDENCIES", verificationStatus: "unverified", promotionDecision: "recommendation" }
    }));
  }

  const buildCommands = unique(architecture.buildCommands || []);
  if (buildCommands.length > 0) {
    registry.add(createProposal({
      proposalType: "EXECUTION",
      source: "architecture",
      proposalSource: "architecture",
      confidence: 0.82,
      required: true,
      description: `Build ${architecture.framework || "workspace"} project`,
      suggestedCommands: buildCommands,
      verificationStatus: "unverified",
      promotionDecision: "recommendation",
      evidenceRefs: [`architecture:${architecture.framework || "unknown"}`],
      metadata: { phase: "VALIDATE_BUILD", verificationStatus: "unverified", promotionDecision: "recommendation" }
    }));
  }

  for (const cmd of validationCommands) {
    if (architecture.framework === "php-plain" && criteria?.phpExecutableAvailable === false && cmd === "php -l index.php") {
      validationSkipped.push({ command: cmd, reason: "php executable not found" });
      continue;
    }
    registry.add(createProposal({
      proposalType: "VALIDATION",
      source: "architecture",
      proposalSource: "architecture",
      confidence: 0.86,
      required: true,
      description: `Validate ${architecture.framework || "workspace"} with ${cmd}`,
      suggestedCommands: [cmd],
      suggestedValidation: [cmd],
      verificationStatus: "unverified",
      promotionDecision: "recommendation",
      evidenceRefs: [`architecture:${architecture.framework || "unknown"}`],
      metadata: { phase: "VALIDATE", verificationStatus: "unverified", promotionDecision: "recommendation" }
    }));
  }

  return {
    profile: architecture,
    profileId: architecture.framework || null,
    intent: projectIntent,
    objective,
    proposals: registry.list(),
    validationSkipped
  };
}

export { inferPackageManager, inferFramework, buildTargetFiles, buildValidationCommands };
