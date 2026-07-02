import { normalizeLower, pascalize, slugify, unique } from "./inference.js";

export const GOAL_TYPES = Object.freeze({
  LANDING_PAGE: "LANDING_PAGE",
  SAAS_APP: "SAAS_APP",
  DASHBOARD: "DASHBOARD",
  ADMIN_PANEL: "ADMIN_PANEL",
  API_SERVER: "API_SERVER",
  FULLSTACK_APP: "FULLSTACK_APP",
  BUG_FIX: "BUG_FIX",
  REFACTOR: "REFACTOR",
  READ_ONLY: "READ_ONLY",
  UNKNOWN: "UNKNOWN"
});

const GOAL_KNOWLEDGE = {
  [GOAL_TYPES.LANDING_PAGE]: {
    label: "Landing Page",
    features: ["navigation", "hero", "benefits", "social_proof", "cta", "footer"],
    components: ["Layout", "Navbar", "HeroSection", "FeatureGrid", "CTASection", "Footer"],
    directories: ["components/layout", "components/navigation", "components/sections", "components/shared"],
    validationHints: ["build", "file-existence"]
  },
  [GOAL_TYPES.SAAS_APP]: {
    label: "SaaS App",
    features: ["navigation", "hero", "pricing", "social_proof", "cta", "footer"],
    components: ["Layout", "Navbar", "HeroSection", "PricingGrid", "FeatureGrid", "CTASection", "Footer"],
    directories: ["components/layout", "components/navigation", "components/sections", "components/shared"],
    validationHints: ["build", "file-existence"]
  },
  [GOAL_TYPES.DASHBOARD]: {
    label: "Dashboard",
    features: ["sidebar", "topbar", "metrics", "table", "activity_feed", "settings"],
    components: ["Layout", "Sidebar", "Topbar", "StatsCards", "DataTable", "ActivityFeed", "SettingsPanel"],
    directories: ["components/layout", "components/navigation", "components/widgets", "components/shared"],
    validationHints: ["build", "file-existence"]
  },
  [GOAL_TYPES.ADMIN_PANEL]: {
    label: "Admin Panel",
    features: ["sidebar", "topbar", "users", "roles", "audit_log", "settings"],
    components: ["Layout", "Sidebar", "Topbar", "UserTable", "RoleMatrix", "AuditLog", "SettingsPanel"],
    directories: ["components/layout", "components/navigation", "components/widgets", "components/shared"],
    validationHints: ["build", "file-existence"]
  },
  [GOAL_TYPES.API_SERVER]: {
    label: "API Server",
    features: ["health_endpoint", "routes", "middleware", "error_handling", "tests"],
    components: ["Server", "HealthRoute", "Routes", "Middleware", "ErrorHandler"],
    directories: ["routes", "controllers", "middleware", "services"],
    validationHints: ["syntax", "test"]
  },
  [GOAL_TYPES.FULLSTACK_APP]: {
    label: "Fullstack App",
    features: ["ui_shell", "api_layer", "data_flow", "validation"],
    components: ["Layout", "Navbar", "HeroSection", "ApiClient", "Server", "ErrorHandler"],
    directories: ["components", "routes", "controllers", "middleware"],
    validationHints: ["build", "syntax", "file-existence"]
  },
  [GOAL_TYPES.BUG_FIX]: {
    label: "Bug Fix",
    features: ["reproduce", "inspect", "patch", "validate", "recheck"],
    components: ["ProblemArea", "PatchPlan", "ValidationCheck"],
    directories: ["fixes", "recovery"],
    validationHints: ["targeted-validation"]
  },
  [GOAL_TYPES.REFACTOR]: {
    label: "Refactor",
    features: ["map_structure", "extract", "preserve_behavior", "validate"],
    components: ["RefactorMap", "SharedModule", "Adapter", "ValidationCheck"],
    directories: ["refactor", "shared"],
    validationHints: ["build", "file-existence"]
  },
  [GOAL_TYPES.READ_ONLY]: {
    label: "Read Only",
    features: ["inspect", "summarize"],
    components: [],
    directories: [],
    validationHints: ["file-existence"]
  },
  [GOAL_TYPES.UNKNOWN]: {
    label: "Unknown",
    features: ["inspect", "plan", "validate"],
    components: ["App", "Layout"],
    directories: ["components"],
    validationHints: ["file-existence"]
  }
};

const PROFILE_KNOWLEDGE = {
  "react-vite-ts": {
    family: "react",
    baseDirectories: ["src", "src/components", "src/components/layout", "src/components/navigation", "src/components/sections", "src/components/shared", "src/styles"],
    baseFiles: ["package.json", "index.html", "src/main.tsx", "src/App.tsx", "src/styles.css"],
    installCommands: ["npm install"],
    buildCommands: ["npm run build"],
    runCommands: ["npm run dev"],
    validationCommands: ["npm run build"],
    fallbackTemplate: "react-vite-ts",
    canBootstrap: true
  },
  "nextjs-ts": {
    family: "next",
    baseDirectories: ["app", "components", "components/layout", "components/sections", "components/shared"],
    baseFiles: ["package.json", "app/layout.tsx", "app/page.tsx", "app/globals.css"],
    installCommands: ["npm install"],
    buildCommands: ["npm run build"],
    runCommands: ["npm run dev"],
    validationCommands: ["npm run build"],
    fallbackTemplate: "nextjs-ts",
    canBootstrap: true
  },
  "node-express": {
    family: "node",
    baseDirectories: ["src", "src/routes", "src/controllers", "src/middleware", "src/services"],
    baseFiles: ["package.json", "src/server.js"],
    installCommands: ["npm install"],
    buildCommands: [],
    runCommands: ["node src/server.js"],
    validationCommands: ["node --check src/server.js"],
    fallbackTemplate: "node-express",
    canBootstrap: true
  },
  "php-plain": {
    family: "php",
    baseDirectories: ["assets/css", "assets/js"],
    baseFiles: ["index.php", "assets/css/style.css", "assets/js/app.js"],
    installCommands: [],
    buildCommands: [],
    runCommands: ["php -S localhost:8000"],
    validationCommands: ["php -l index.php"],
    fallbackTemplate: "php-plain",
    canBootstrap: true
  },
  "generic-static-html": {
    family: "static",
    baseDirectories: ["assets/css", "assets/js"],
    baseFiles: ["index.html", "assets/css/style.css", "assets/js/app.js"],
    installCommands: [],
    buildCommands: [],
    runCommands: [],
    validationCommands: [],
    fallbackTemplate: "generic-static-html",
    canBootstrap: true
  },
  "aspnet-core": {
    family: "dotnet",
    baseDirectories: ["src", "Controllers", "Models", "Services"],
    baseFiles: ["Program.cs", "appsettings.json"],
    installCommands: ["dotnet restore"],
    buildCommands: ["dotnet build"],
    runCommands: ["dotnet run"],
    validationCommands: ["dotnet build"],
    fallbackTemplate: "aspnet-core",
    canBootstrap: false
  },
  "laravel": {
    family: "php",
    baseDirectories: ["app", "routes", "resources/views", "public", "storage"],
    baseFiles: ["artisan", "composer.json", "routes/web.php"],
    installCommands: ["composer install"],
    buildCommands: [],
    runCommands: ["php artisan serve"],
    validationCommands: ["php -l routes/web.php"],
    fallbackTemplate: "laravel",
    canBootstrap: false
  },
  "python-fastapi": {
    family: "python",
    baseDirectories: ["app"],
    baseFiles: ["main.py", "requirements.txt"],
    installCommands: ["pip install -r requirements.txt"],
    buildCommands: [],
    runCommands: ["python main.py"],
    validationCommands: ["python -m py_compile main.py"],
    fallbackTemplate: "python-fastapi",
    canBootstrap: false
  },
  "python-flask": {
    family: "python",
    baseDirectories: ["app"],
    baseFiles: ["app.py", "requirements.txt"],
    installCommands: ["pip install -r requirements.txt"],
    buildCommands: [],
    runCommands: ["python app.py"],
    validationCommands: ["python -m py_compile app.py"],
    fallbackTemplate: "python-flask",
    canBootstrap: false
  },
  "flutter": {
    family: "dart",
    baseDirectories: ["lib"],
    baseFiles: ["pubspec.yaml", "lib/main.dart"],
    installCommands: ["flutter pub get"],
    buildCommands: [],
    runCommands: ["flutter run"],
    validationCommands: ["flutter analyze"],
    fallbackTemplate: "flutter",
    canBootstrap: false
  }
};

function normalizeProfileKey(profile = "") {
  return normalizeLower(profile).replace(/^react\/vite$/, "react-vite-ts");
}

export function inferGoalType(prompt = "", projectIntent = {}) {
  const explicit = String(projectIntent.goalType || "").trim().toUpperCase();
  if (explicit && GOAL_TYPES[explicit]) return explicit;

  const text = String(prompt || projectIntent.prompt || projectIntent.objective || "").toLowerCase();
  if (/\b(?:read only|read-only|read only mode|show|summarize|inspect|view)\b/.test(text) && !/\b(?:create|write|build|fix|refactor|update|generate)\b/.test(text)) {
    return GOAL_TYPES.READ_ONLY;
  }
  if (/\b(?:bug fix|bugfix|fix bug|repair|issue|crash|broken|error)\b/.test(text)) return GOAL_TYPES.BUG_FIX;
  if (/\b(?:refactor|restructure|clean up|clean-up|reorganize|rewrite)\b/.test(text)) return GOAL_TYPES.REFACTOR;
  if (/\b(?:fullstack|full-stack|full stack)\b/.test(text)) return GOAL_TYPES.FULLSTACK_APP;
  if (/\b(?:api server|rest api|backend api|express server|node api)\b/.test(text)) return GOAL_TYPES.API_SERVER;
  if (/\b(?:landing page|homepage|hero section|marketing site)\b/.test(text)) return GOAL_TYPES.LANDING_PAGE;
  if (/\b(?:saas app|saas platform|saas product)\b/.test(text)) return GOAL_TYPES.SAAS_APP;
  if (/\b(?:admin panel|admin dashboard)\b/.test(text)) return GOAL_TYPES.ADMIN_PANEL;
  if (/\b(?:dashboard|admin|analytics portal|metrics portal)\b/.test(text)) return GOAL_TYPES.DASHBOARD;
  return GOAL_TYPES.UNKNOWN;
}

export function getGoalKnowledge(goalType = GOAL_TYPES.UNKNOWN) {
  return GOAL_KNOWLEDGE[goalType] || GOAL_KNOWLEDGE[GOAL_TYPES.UNKNOWN];
}

export function getProfileKnowledge(profileId = "") {
  return PROFILE_KNOWLEDGE[normalizeProfileKey(profileId)] || PROFILE_KNOWLEDGE["generic-static-html"];
}

export function getComponentKnowledge({ goalType = GOAL_TYPES.UNKNOWN, profileId = "" } = {}) {
  const goalKnowledge = getGoalKnowledge(goalType);
  const profileKnowledge = getProfileKnowledge(profileId);
  const family = profileKnowledge.family || "static";
  const sharedComponents = family === "react"
    ? ["Button", "SectionHeader", "Card"]
    : family === "node"
      ? ["Server", "Routes", "ErrorHandler"]
      : family === "php"
        ? ["PageShell", "Header", "Footer"]
        : family === "dotnet"
          ? ["Program", "Controller", "Service"]
          : ["App"];

  return {
    goalType,
    family,
    components: unique([...goalKnowledge.components, ...sharedComponents]),
    sharedComponents: unique(sharedComponents),
    layoutComponents: unique(goalKnowledge.components.filter(name => /layout|sidebar|topbar|wrapper|shell/i.test(name))),
    routeComponents: unique(goalKnowledge.components.filter(name => /route|page|server|health|controller/i.test(name))),
    validationHints: unique(goalKnowledge.validationHints || []),
    directories: unique([...profileKnowledge.baseDirectories, ...(goalKnowledge.directories || [])])
  };
}

export function getValidationKnowledge({ profileId = "", workspaceState = {}, toolAvailability = {}, goalType = GOAL_TYPES.UNKNOWN } = {}) {
  const profile = getProfileKnowledge(profileId);
  const scan = workspaceState?.scan || {};
  const commands = unique([
    ...(Array.isArray(scan.testCommands) ? scan.testCommands : []),
    ...(Array.isArray(scan.buildCommands) ? scan.buildCommands : []),
    ...(Array.isArray(scan.runCommands) ? scan.runCommands : [])
  ]);
  const skipped = [];
  const family = profile.family || "static";

  if (family === "php" && toolAvailability.php === false) {
    skipped.push({ command: "php -l index.php", reason: "php executable not found" });
  }
  if (family === "dotnet" && toolAvailability.dotnet === false) {
    skipped.push({ command: "dotnet build", reason: "dotnet executable not found" });
  }
  if (family === "python" && toolAvailability.python === false) {
    skipped.push({ command: commands[0] || "python -m py_compile", reason: "python executable not found" });
  }
  if (family === "dart" && toolAvailability.flutter === false) {
    skipped.push({ command: commands[0] || "flutter analyze", reason: "flutter executable not found" });
  }

  const fileExistence = [];
  if (Array.isArray(workspaceState?.existingFiles)) {
    fileExistence.push(...workspaceState.existingFiles.slice(0, 25));
  }

  const checks = [];
  if (profileId === "generic-static-html" || goalType === GOAL_TYPES.LANDING_PAGE || goalType === GOAL_TYPES.SAAS_APP) {
    checks.push({ type: "file-existence", files: fileExistence });
    checks.push({ type: "local-asset-references", files: fileExistence });
  } else if (profileId === "php-plain") {
    checks.push({ type: "file-existence", files: fileExistence });
    checks.push({ type: "local-asset-references", files: fileExistence });
  } else {
    checks.push({ type: "file-existence", files: fileExistence });
  }

  return {
    commands: commands.filter(Boolean),
    checks,
    skipped
  };
}

export function getRepairKnowledge({ failure = null, goalType = GOAL_TYPES.UNKNOWN, profileId = "" } = {}) {
  const text = String(failure?.message || failure?.stderr || failure?.error || failure?.output || failure?.text || failure || "").toLowerCase();
  const retryCommand = null;

  if (!text) {
    return {
      repairType: "none",
      confidence: 0.25,
      action: "defer_until_failure",
      tool: null,
      args: {},
      retryCommand
    };
  }

  if (/cannot find module|module not found|missing dependency|cannot resolve/i.test(text)) {
    return {
      repairType: "missing_dependency",
      confidence: 0.95,
      action: "install_dependency",
      tool: null,
      args: {},
      retryCommand
    };
  }

  if (/missing script|unknown script|script .* not found/i.test(text)) {
    return {
      repairType: "missing_script",
      confidence: 0.9,
      action: "patch_package_json",
      tool: null,
      args: {},
      retryCommand: null
    };
  }

  if (/unexpected token|unterminated string|syntax error|parse error/i.test(text)) {
    return {
      repairType: "syntax_error",
      confidence: 0.86,
      action: "patch_file",
      tool: "APPLY_PATCH",
      args: {},
      retryCommand
    };
  }

  if (/expect is not defined|tobe is not a function|node:test|assert/i.test(text)) {
    return {
      repairType: "framework_api_mismatch",
      confidence: 0.88,
      action: "adjust_framework_contract",
      tool: null,
      args: {},
      retryCommand
    };
  }

  if (/php.*not found|php executable not found/i.test(text)) {
    return {
      repairType: "tool_missing",
      confidence: 0.93,
      action: "skip_validation_with_reason",
      tool: null,
      args: { reason: "php executable not found" },
      retryCommand: null
    };
  }

  if (/dotnet.*not found|dotnet executable not found/i.test(text)) {
    return {
      repairType: "tool_missing",
      confidence: 0.93,
      action: "skip_validation_with_reason",
      tool: null,
      args: { reason: "dotnet executable not found" },
      retryCommand: null
    };
  }

  return {
    repairType: "generic_retry",
    confidence: 0.5,
    action: "retry_validation",
    tool: null,
    args: {},
    retryCommand
  };
}

export function createPlanningFileRecord(pathValue = "", {
  phase = "GENERATE_BASE_FILES",
  role = "file",
  reason = "",
  operation = "WRITE_FILE",
  component = null,
  feature = null,
  dependsOn = [],
  priority = 50
} = {}) {
  const path = String(pathValue || "").replace(/\\/g, "/").trim();
  return {
    path,
    file: path,
    operation,
    phase,
    role,
    reason,
    component,
    feature,
    dependsOn: unique((Array.isArray(dependsOn) ? dependsOn : []).map(value => String(value || "").trim()).filter(Boolean)),
    priority
  };
}

export function isReactProfile(profileId = "") {
  return normalizeProfileKey(profileId) === "react-vite-ts" || normalizeProfileKey(profileId) === "nextjs-ts";
}

export function isBootstrapCapableProfile(profileId = "") {
  const profile = getProfileKnowledge(profileId);
  return profile.canBootstrap !== false;
}

export function getProfileFallbackTemplate(profileId = "") {
  return getProfileKnowledge(profileId).fallbackTemplate || null;
}

