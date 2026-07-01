function normalize(value = "") {
  return String(value || "").replace(/\\/g, "/").trim().toLowerCase();
}

function hasAny(existingFiles = [], candidates = []) {
  const files = new Set((Array.isArray(existingFiles) ? existingFiles : []).map(normalize));
  return candidates.some(candidate => files.has(normalize(candidate)));
}

function matchPrompt(intent = {}, keywords = []) {
  const text = String(intent.prompt || intent.objective || "").toLowerCase();
  return keywords.some(keyword => text.includes(String(keyword).toLowerCase()));
}

function createProfile(definition) {
  return {
    ...definition,
    detect(existingFiles = []) {
      return typeof definition.detect === "function"
        ? definition.detect(existingFiles)
        : false;
    },
    matchIntent(intent = {}) {
      return typeof definition.matchIntent === "function"
        ? definition.matchIntent(intent)
        : false;
    }
  };
}

const reactViteTs = createProfile({
  id: "react-vite-ts",
  label: "React + Vite + TypeScript",
  language: "TypeScript",
  framework: "React/Vite",
  packageManager: "npm",
  canBootstrap: true,
  detect(existingFiles = []) {
    return hasAny(existingFiles, ["vite.config.ts", "vite.config.js", "src/main.tsx", "src/main.jsx", "src/App.tsx", "src/App.jsx"]);
  },
  matchIntent(intent = {}) {
    const requested = String(intent.requestedFramework || "").toLowerCase();
    return requested === "react-vite-ts" || matchPrompt(intent, ["react", "vite", "spa", "dashboard", "admin", "saas", "frontend"]);
  }
});

const nextjsTs = createProfile({
  id: "nextjs-ts",
  label: "Next.js + TypeScript",
  language: "TypeScript",
  framework: "Next.js",
  packageManager: "npm",
  canBootstrap: false,
  detect(existingFiles = []) {
    return hasAny(existingFiles, ["next.config.js", "next.config.ts", "app/page.tsx", "pages/index.tsx"]);
  },
  matchIntent(intent = {}) {
    const requested = String(intent.requestedFramework || "").toLowerCase();
    return requested === "nextjs-ts" || matchPrompt(intent, ["next", "app router", "pages router"]);
  }
});

const nodeExpress = createProfile({
  id: "node-express",
  label: "Node + Express",
  language: "JavaScript",
  framework: "Express",
  packageManager: "npm",
  canBootstrap: true,
  detect(existingFiles = []) {
    return hasAny(existingFiles, ["src/server.js", "server.js", "app.js"]);
  },
  matchIntent(intent = {}) {
    const requested = String(intent.requestedFramework || "").toLowerCase();
    return requested === "node-express" || matchPrompt(intent, ["api", "backend", "server", "express", "rest"]);
  }
});

const phpPlain = createProfile({
  id: "php-plain",
  label: "Plain PHP",
  language: "PHP",
  framework: "PHP",
  packageManager: "none",
  canBootstrap: true,
  detect(existingFiles = []) {
    return hasAny(existingFiles, ["index.php", "public/index.php", "composer.json"]);
  },
  matchIntent(intent = {}) {
    const requested = String(intent.requestedFramework || "").toLowerCase();
    return requested === "php" || requested === "php-plain" || matchPrompt(intent, ["php", "blade", "laravel"]);
  }
});

const genericStaticHtml = createProfile({
  id: "generic-static-html",
  label: "Generic Static HTML",
  language: "HTML",
  framework: "Static",
  packageManager: "none",
  canBootstrap: true,
  detect(existingFiles = []) {
    return hasAny(existingFiles, ["index.html", "public/index.html"]);
  },
  matchIntent(intent = {}) {
    const requested = String(intent.requestedFramework || "").toLowerCase();
    return requested === "generic-static-html" || requested === "static-html" || matchPrompt(intent, ["static html", "plain html", "without framework"]);
  }
});

const aspnetCore = createProfile({
  id: "aspnet-core",
  label: "ASP.NET Core",
  language: "C#",
  framework: ".NET",
  packageManager: "dotnet",
  canBootstrap: false,
  detect(existingFiles = []) {
    return Array.isArray(existingFiles) && existingFiles.some(file => /\.csproj$/i.test(String(file || ""))) || hasAny(existingFiles, ["Program.cs", "Startup.cs"]);
  },
  matchIntent(intent = {}) {
    const requested = String(intent.requestedFramework || "").toLowerCase();
    return requested.includes("asp.net") || requested.includes("aspnet") || requested.includes(".net") || matchPrompt(intent, ["asp.net", "aspnet", ".net", "c#"]);
  }
});

const laravel = createProfile({
  id: "laravel",
  label: "Laravel",
  language: "PHP",
  framework: "Laravel",
  packageManager: "composer",
  canBootstrap: false,
  detect(existingFiles = []) {
    return hasAny(existingFiles, ["artisan", "composer.json", "routes/web.php", "app/Http"]);
  },
  matchIntent(intent = {}) {
    return matchPrompt(intent, ["laravel"]);
  }
});

const pythonFastapi = createProfile({
  id: "python-fastapi",
  label: "Python FastAPI",
  language: "Python",
  framework: "FastAPI",
  packageManager: "pip",
  canBootstrap: false,
  detect(existingFiles = []) {
    return hasAny(existingFiles, ["requirements.txt", "pyproject.toml", "main.py", "app/main.py"]);
  },
  matchIntent(intent = {}) {
    return matchPrompt(intent, ["fastapi"]);
  }
});

const pythonFlask = createProfile({
  id: "python-flask",
  label: "Python Flask",
  language: "Python",
  framework: "Flask",
  packageManager: "pip",
  canBootstrap: false,
  detect(existingFiles = []) {
    return hasAny(existingFiles, ["requirements.txt", "pyproject.toml", "app.py", "main.py"]);
  },
  matchIntent(intent = {}) {
    return matchPrompt(intent, ["flask"]);
  }
});

const flutter = createProfile({
  id: "flutter",
  label: "Flutter",
  language: "Dart",
  framework: "Flutter",
  packageManager: "pub",
  canBootstrap: false,
  detect(existingFiles = []) {
    return hasAny(existingFiles, ["pubspec.yaml", "lib/main.dart"]);
  },
  matchIntent(intent = {}) {
    return matchPrompt(intent, ["flutter", "dart"]);
  }
});

export const bootstrapProfiles = [
  reactViteTs,
  nextjsTs,
  nodeExpress,
  phpPlain,
  genericStaticHtml,
  aspnetCore,
  laravel,
  pythonFastapi,
  pythonFlask,
  flutter
];

export const bootstrapProfileMap = new Map(
  bootstrapProfiles.map(profile => [profile.id, profile])
);

export function getBootstrapProfileById(id) {
  return bootstrapProfileMap.get(String(id || "").trim()) || null;
}
