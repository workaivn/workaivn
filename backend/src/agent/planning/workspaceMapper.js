import path from 'node:path';

import { unique } from '../projectIntelligence/inference.js';

function normalizePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function toLower(value = '') {
  return String(value || '').toLowerCase();
}

function normalizeCapabilityKey(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function dedupeByPath(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizePath(item?.path || '');
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push({ ...item, path: normalized });
  }
  return output;
}

function collectWorkspaceFiles(projectScanSnapshot = {}, planningContext = {}) {
  return unique([
    ...(Array.isArray(projectScanSnapshot?.discoveredFiles) ? projectScanSnapshot.discoveredFiles : []),
    ...(Array.isArray(projectScanSnapshot?.files) ? projectScanSnapshot.files : []),
    ...(Array.isArray(projectScanSnapshot?.entryFiles) ? projectScanSnapshot.entryFiles : []),
    ...(Array.isArray(projectScanSnapshot?.styleFiles) ? projectScanSnapshot.styleFiles : []),
    ...(Array.isArray(planningContext?.verifiedFiles) ? planningContext.verifiedFiles : []),
    ...(Array.isArray(planningContext?.plannedFiles) ? planningContext.plannedFiles : []),
    ...(Array.isArray(planningContext?.facts?.discoveredFiles) ? planningContext.facts.discoveredFiles : []),
    ...(Array.isArray(planningContext?.facts?.verifiedFiles) ? planningContext.facts.verifiedFiles : []),
    ...(Array.isArray(planningContext?.facts?.plannedFiles) ? planningContext.facts.plannedFiles : [])
  ].map(normalizePath));
}

function collectEvidenceSources({
  objective = '',
  planningContext = {},
  projectScanSnapshot = {},
  requirement = null,
  frameworkResolution = null,
  planningStrategyGraph = null,
  constraintGraph = null,
  hintPath = null
} = {}) {
  const frameworkFamily = frameworkResolution?.frameworkKey
    ? String(frameworkResolution.frameworkKey).split('-')[0]
    : null;
  return unique([
    `objective:${String(objective || '').slice(0, 120)}`,
    `goalType:${String(planningContext?.goalType || projectScanSnapshot?.goalType || 'UNKNOWN').toUpperCase()}`,
    ...(Array.isArray(requirement?.evidence) ? requirement.evidence : []),
    ...(Array.isArray(frameworkResolution?.evidence) ? frameworkResolution.evidence : []),
    ...(Array.isArray(planningStrategyGraph?.strategies) ? planningStrategyGraph.strategies.map(strategy => `strategy:${strategy.strategy}`) : []),
    ...(Array.isArray(constraintGraph?.constraints) ? constraintGraph.constraints.map(constraint => `constraint:${constraint.value}`) : []),
    frameworkFamily ? `frameworkFamily:${frameworkFamily}` : null,
    frameworkResolution?.source ? `frameworkSource:${frameworkResolution.source}` : null,
    hintPath ? `hint:${hintPath}` : null
  ].filter(Boolean));
}

function detectWorkspaceFrameworkEvidence({ projectScanSnapshot = {}, planningContext = {}, objective = '' } = {}) {
  const files = new Set(collectWorkspaceFiles(projectScanSnapshot, planningContext).map(file => toLower(file)));
  const projectType = String(projectScanSnapshot?.projectType || planningContext?.facts?.projectType || planningContext?.projectType || '').toLowerCase();

  if (files.has('app/page.tsx') || files.has('app/layout.tsx') || projectType === 'next') {
    return { frameworkKey: 'nextjs-ts', source: 'workspace_evidence', verified: true, confidence: 0.99, evidence: ['projectScan:next', 'file:app/page.tsx'] };
  }
  if (files.has('src/pages/index.astro') || files.has('pages/index.astro') || files.has('astro.config.mjs') || files.has('astro.config.ts') || projectType === 'astro') {
    return { frameworkKey: 'astro-react', source: 'workspace_evidence', verified: true, confidence: 0.98, evidence: ['projectScan:astro', 'file:src/pages/index.astro'] };
  }
  if (files.has('src/app.tsx') || files.has('src/main.tsx') || files.has('vite.config.ts') || projectType === 'vite' || projectType === 'node_react') {
    return { frameworkKey: 'react-vite-ts', source: 'workspace_evidence', verified: true, confidence: 0.99, evidence: ['projectScan:vite', 'file:src/App.tsx|src/main.tsx'] };
  }
  if (files.has('artisan') || files.has('routes/web.php') || projectType === 'laravel') {
    return { frameworkKey: 'laravel', source: 'workspace_evidence', verified: true, confidence: 0.98, evidence: ['file:artisan', 'file:routes/web.php'] };
  }
  if (files.has('index.php') || projectType === 'php') {
    return { frameworkKey: 'php-plain', source: 'workspace_evidence', verified: true, confidence: 0.97, evidence: ['file:index.php'] };
  }
  if (files.has('lib/main.dart') || files.has('pubspec.yaml') || projectType === 'flutter') {
    return { frameworkKey: 'flutter', source: 'workspace_evidence', verified: true, confidence: 0.98, evidence: ['file:lib/main.dart', 'file:pubspec.yaml'] };
  }
  if (files.has('pages/index.cshtml') || files.has('views/home/index.cshtml')) {
    return { frameworkKey: 'aspnet-mvc', source: 'workspace_evidence', verified: true, confidence: 0.95, evidence: ['file:Views/Home/Index.cshtml|Pages/Index.cshtml'] };
  }
  if (files.has('pages/index.cshtml') || projectType === 'aspnet') {
    return { frameworkKey: 'aspnet-razor', source: 'workspace_evidence', verified: true, confidence: 0.95, evidence: ['projectScan:aspnet'] };
  }
  if (files.has('app.py') || files.has('main.py') || projectType === 'python') {
    if (files.has('manage.py') || files.has('templates/home.html')) {
      return { frameworkKey: 'python-django', source: 'workspace_evidence', verified: true, confidence: 0.94, evidence: ['file:manage.py', 'file:templates/home.html'] };
    }
    return { frameworkKey: 'python-flask', source: 'workspace_evidence', verified: true, confidence: 0.94, evidence: ['file:app.py|main.py'] };
  }
  if (files.has('index.html') || projectType === 'static_html') {
    return { frameworkKey: 'static-html', source: 'workspace_evidence', verified: true, confidence: 0.94, evidence: ['file:index.html'] };
  }
  if (projectType === 'generic') {
    return { frameworkKey: 'generic', source: 'workspace_evidence', verified: true, confidence: 0.5, evidence: ['projectScan:generic'] };
  }
  if (projectType === 'generic' && objective) {
    return null;
  }
  return null;
}

function resolveFrameworkResolution({
  objective = '',
  planningContext = {},
  projectScanSnapshot = {},
  projectIntent = {},
  constraintGraph = null,
  implementationResolution = null
} = {}) {
  const selectedImplementation = implementationResolution
    || planningContext?.selectedImplementation
    || planningContext?.implementationResolution
    || null;
  const selectedVariant = selectedImplementation?.selectedVariant || selectedImplementation?.variant || selectedImplementation || null;
  const selectedFrameworkKey = selectedVariant?.frameworkKey || selectedVariant?.variantKey || selectedImplementation?.frameworkKey || null;
  const verifiedFramework = detectWorkspaceFrameworkEvidence({ projectScanSnapshot, planningContext, objective }) || null;
  const frameworkKey = selectedFrameworkKey || verifiedFramework?.frameworkKey || null;
  const source = selectedFrameworkKey ? 'implementation_variant' : (verifiedFramework?.source || null);
  const evidence = unique([
    ...(Array.isArray(selectedVariant?.evidence) ? selectedVariant.evidence : []),
    ...(Array.isArray(verifiedFramework?.evidence) ? verifiedFramework.evidence : [])
  ]);
  return frameworkKey ? {
    frameworkKey,
    verifiedFrameworkKey: verifiedFramework?.frameworkKey || null,
    requiredFrameworkKey: selectedFrameworkKey || verifiedFramework?.frameworkKey || null,
    source,
    verified: verifiedFramework?.verified === true,
    required: selectedFrameworkKey ? true : (verifiedFramework?.frameworkKey ? true : false),
    confidence: Math.max(selectedVariant?.confidence || 0, verifiedFramework?.confidence || 0),
    evidence
  } : null;
}

function buildPathOptions(requirement, frameworkKey, existingFiles = new Set(), workspaceRoot = '') {
  const lowerCapability = normalizeCapabilityKey(requirement?.capability || '');
  const paths = [];
  const push = (pathValue, reason, confidence = 0.8) => {
    const normalized = normalizePath(pathValue);
    if (!normalized) return;
    paths.push({
      path: normalized,
      operation: existingFiles.has(normalized.toLowerCase()) ? 'modify' : 'create',
      mappingReason: reason,
      confidence,
      evidence: []
    });
  };

  const targetRoot = workspaceRoot ? normalizePath(workspaceRoot) : '';

  switch (frameworkKey) {
    case 'react-custom':
      // Custom React implementations must keep path authority explicit.
      break;
    case 'react-vite-ts':
      if (lowerCapability === 'APPLICATION_ENTRY') push('src/App.tsx', 'React/Vite application entry verified by workspace evidence', 0.98);
      else if (lowerCapability === 'ROOT_COMPONENT') push('src/App.tsx', 'React/Vite root component surface', 0.97);
      else if (lowerCapability === 'COMPONENT_HIERARCHY') push('src/components/index.ts', 'React/Vite component hierarchy surface', 0.92);
      else if (lowerCapability === 'ROUTING' || lowerCapability === 'ROUTING_CAPABILITY') push('src/router.tsx', 'React/Vite routing surface', 0.92);
      else if (lowerCapability === 'GLOBAL_STYLE') push('src/styles.css', 'React/Vite global stylesheet verified by workspace evidence', 0.95);
      else if (lowerCapability === 'STYLING' || lowerCapability === 'STYLING_CAPABILITY' || lowerCapability === 'STYLING_SYSTEM') push('src/styles.css', 'React/Vite styling surface', 0.95);
      else if (lowerCapability === 'THEME' || lowerCapability === 'THEME_CAPABILITY') push('src/theme.ts', 'React/Vite theme surface', 0.88);
      else if (lowerCapability === 'NAVIGATION') push('src/components/navigation/Navbar.tsx', 'React/Vite navigation surface', 0.9);
      else if (lowerCapability === 'HERO') push('src/components/sections/HeroSection.tsx', 'React/Vite hero surface', 0.9);
      else if (lowerCapability === 'FEATURES') push('src/components/sections/FeatureGrid.tsx', 'React/Vite feature surface', 0.9);
      else if (lowerCapability === 'PRICING') push('src/components/sections/PricingGrid.tsx', 'React/Vite pricing surface', 0.9);
      else if (lowerCapability === 'CTA') push('src/components/sections/CTASection.tsx', 'React/Vite CTA surface', 0.9);
      else if (lowerCapability === 'FOOTER') push('src/components/sections/Footer.tsx', 'React/Vite footer surface', 0.9);
      else if (lowerCapability === 'RESPONSIVE_LAYOUT' || lowerCapability === 'BREAKPOINT_SUPPORT') push('src/styles.css', 'React/Vite responsive styling surface', 0.9);
      else if (lowerCapability === 'ANIMATION_LAYER' || lowerCapability === 'MOTION_CAPABILITY') push('src/animations.ts', 'React/Vite animation surface', 0.86);
      else if (lowerCapability === 'SEMANTIC_STRUCTURE' || lowerCapability === 'KEYBOARD_SUPPORT' || lowerCapability === 'ARIA_SUPPORT') push('src/accessibility.ts', 'React/Vite accessibility surface', 0.84);
      else if (lowerCapability === 'CODE_SPLITTING' || lowerCapability === 'LAZY_LOADING' || lowerCapability === 'PERFORMANCE_OPTIMIZATION') push('src/performance.ts', 'React/Vite performance surface', 0.84);
      else if (lowerCapability === 'METADATA' || lowerCapability === 'STRUCTURED_CONTENT' || lowerCapability === 'SEMANTIC_HTML') push('index.html', 'React/Vite semantic document surface', 0.85);
      else if (lowerCapability === 'TEST') push('src/App.test.tsx', 'React/Vite test surface', 0.85);
      else if (lowerCapability === 'BUILD') push('vite.config.ts', 'React/Vite build configuration surface', 0.8);
      else if (lowerCapability === 'PROJECT_MANIFEST' || lowerCapability === 'DEPENDENCY_MANIFEST') push('package.json', 'React/Vite project manifest surface', 0.8);
      else if (lowerCapability === 'COMPONENT_STRUCTURE') push('src/components/index.ts', 'React/Vite component structure surface', 0.82);
      break;
    case 'nextjs-ts':
      if (lowerCapability === 'APPLICATION_ENTRY') push('app/page.tsx', 'Next.js application entry verified by workspace evidence', 0.99);
      else if (lowerCapability === 'ROOT_COMPONENT') push('app/page.tsx', 'Next.js root component surface', 0.97);
      else if (lowerCapability === 'COMPONENT_HIERARCHY') push('components/index.ts', 'Next.js component hierarchy surface', 0.92);
      else if (lowerCapability === 'ROUTING' || lowerCapability === 'ROUTING_CAPABILITY') push('app/router.tsx', 'Next.js routing surface', 0.92);
      else if (lowerCapability === 'GLOBAL_STYLE') push('app/globals.css', 'Next.js global stylesheet verified by workspace evidence', 0.95);
      else if (lowerCapability === 'STYLING' || lowerCapability === 'STYLING_CAPABILITY' || lowerCapability === 'STYLING_SYSTEM') push('app/globals.css', 'Next.js styling surface', 0.95);
      else if (lowerCapability === 'THEME' || lowerCapability === 'THEME_CAPABILITY') push('app/theme.ts', 'Next.js theme surface', 0.88);
      else if (lowerCapability === 'NAVIGATION') push('components/navigation/Navbar.tsx', 'Next.js navigation surface', 0.9);
      else if (lowerCapability === 'HERO') push('components/sections/HeroSection.tsx', 'Next.js hero surface', 0.9);
      else if (lowerCapability === 'FEATURES') push('components/sections/FeatureGrid.tsx', 'Next.js feature surface', 0.9);
      else if (lowerCapability === 'PRICING') push('components/sections/PricingGrid.tsx', 'Next.js pricing surface', 0.9);
      else if (lowerCapability === 'CTA') push('components/sections/CTASection.tsx', 'Next.js CTA surface', 0.9);
      else if (lowerCapability === 'FOOTER') push('components/sections/Footer.tsx', 'Next.js footer surface', 0.9);
      else if (lowerCapability === 'RESPONSIVE_LAYOUT' || lowerCapability === 'BREAKPOINT_SUPPORT') push('app/globals.css', 'Next.js responsive styling surface', 0.9);
      else if (lowerCapability === 'ANIMATION_LAYER' || lowerCapability === 'MOTION_CAPABILITY') push('app/animations.ts', 'Next.js animation surface', 0.86);
      else if (lowerCapability === 'SEMANTIC_STRUCTURE' || lowerCapability === 'KEYBOARD_SUPPORT' || lowerCapability === 'ARIA_SUPPORT') push('app/accessibility.ts', 'Next.js accessibility surface', 0.84);
      else if (lowerCapability === 'CODE_SPLITTING' || lowerCapability === 'LAZY_LOADING' || lowerCapability === 'PERFORMANCE_OPTIMIZATION') push('app/performance.ts', 'Next.js performance surface', 0.84);
      else if (lowerCapability === 'METADATA' || lowerCapability === 'STRUCTURED_CONTENT' || lowerCapability === 'SEMANTIC_HTML') push('app/page.tsx', 'Next.js semantic document surface', 0.85);
      else if (lowerCapability === 'TEST') push('app/page.test.tsx', 'Next.js test surface', 0.85);
      else if (lowerCapability === 'BUILD') push('next.config.js', 'Next.js build configuration surface', 0.8);
      else if (lowerCapability === 'PROJECT_MANIFEST' || lowerCapability === 'DEPENDENCY_MANIFEST') push('package.json', 'Next.js project manifest surface', 0.8);
      else if (lowerCapability === 'COMPONENT_STRUCTURE') push('components/index.ts', 'Next.js component structure surface', 0.82);
      break;
    case 'astro-react':
      if (lowerCapability === 'APPLICATION_ENTRY') push('src/pages/index.astro', 'Astro React integration application entry verified by workspace evidence', 0.98);
      else if (lowerCapability === 'ROOT_COMPONENT') push('src/pages/index.astro', 'Astro React integration root component surface', 0.96);
      else if (lowerCapability === 'COMPONENT_HIERARCHY') push('src/components/index.ts', 'Astro React integration component surface', 0.92);
      else if (lowerCapability === 'ROUTING' || lowerCapability === 'ROUTING_CAPABILITY') push('src/pages/index.astro', 'Astro React integration routing surface', 0.92);
      else if (lowerCapability === 'GLOBAL_STYLE') push('src/styles/global.css', 'Astro React integration stylesheet surface', 0.95);
      else if (lowerCapability === 'STYLING' || lowerCapability === 'STYLING_CAPABILITY' || lowerCapability === 'STYLING_SYSTEM') push('src/styles/global.css', 'Astro React integration styling surface', 0.95);
      else if (lowerCapability === 'NAVIGATION') push('src/components/navigation/Navbar.tsx', 'Astro React integration navigation surface', 0.9);
      else if (lowerCapability === 'HERO') push('src/components/sections/HeroSection.astro', 'Astro React integration hero surface', 0.9);
      else if (lowerCapability === 'FEATURES') push('src/components/sections/FeatureGrid.astro', 'Astro React integration features surface', 0.9);
      else if (lowerCapability === 'CTA') push('src/components/sections/CTASection.astro', 'Astro React integration CTA surface', 0.9);
      else if (lowerCapability === 'FOOTER') push('src/components/sections/Footer.astro', 'Astro React integration footer surface', 0.9);
      else if (lowerCapability === 'TEST') push('src/pages/index.test.tsx', 'Astro React integration test surface', 0.85);
      break;
    case 'laravel-react':
      if (lowerCapability === 'APPLICATION_ENTRY') push('resources/views/welcome.blade.php', 'Laravel React integration application entry verified by workspace evidence', 0.98);
      else if (lowerCapability === 'ROOT_COMPONENT') push('resources/js/app.tsx', 'Laravel React integration root component surface', 0.96);
      else if (lowerCapability === 'COMPONENT_HIERARCHY') push('resources/js/components/index.ts', 'Laravel React integration component surface', 0.92);
      else if (lowerCapability === 'ROUTING' || lowerCapability === 'ROUTING_CAPABILITY') push('routes/web.php', 'Laravel React integration routing surface', 0.92);
      else if (lowerCapability === 'GLOBAL_STYLE') push('resources/css/app.css', 'Laravel React integration stylesheet surface', 0.95);
      else if (lowerCapability === 'STYLING' || lowerCapability === 'STYLING_CAPABILITY' || lowerCapability === 'STYLING_SYSTEM') push('resources/css/app.css', 'Laravel React integration styling surface', 0.95);
      else if (lowerCapability === 'NAVIGATION') push('resources/js/components/navigation/Navbar.tsx', 'Laravel React integration navigation surface', 0.9);
      else if (lowerCapability === 'HERO') push('resources/js/components/sections/HeroSection.tsx', 'Laravel React integration hero surface', 0.9);
      else if (lowerCapability === 'FEATURES') push('resources/js/components/sections/FeatureGrid.tsx', 'Laravel React integration features surface', 0.9);
      else if (lowerCapability === 'CTA') push('resources/js/components/sections/CTASection.tsx', 'Laravel React integration CTA surface', 0.9);
      else if (lowerCapability === 'FOOTER') push('resources/js/components/sections/Footer.tsx', 'Laravel React integration footer surface', 0.9);
      else if (lowerCapability === 'TEST') push('tests/Feature/ReactIntegrationTest.php', 'Laravel React integration test surface', 0.85);
      else if (lowerCapability === 'BUILD') push('vite.config.ts', 'Laravel React integration build surface', 0.8);
      break;
    case 'laravel':
      if (lowerCapability === 'APPLICATION_ENTRY') push('resources/views/welcome.blade.php', 'Laravel welcome view verified by workspace evidence', 0.98);
      else if (lowerCapability === 'GLOBAL_STYLE') push('resources/css/app.css', 'Laravel style surface', 0.9);
      else if (lowerCapability === 'NAVIGATION') push('resources/views/components/navigation.blade.php', 'Laravel navigation surface', 0.85);
      else if (lowerCapability === 'CTA') push('resources/views/components/cta.blade.php', 'Laravel CTA surface', 0.82);
      else if (lowerCapability === 'FOOTER') push('resources/views/components/footer.blade.php', 'Laravel footer surface', 0.82);
      else if (lowerCapability === 'API_LAYER') push('routes/web.php', 'Laravel routing surface', 0.88);
      else if (lowerCapability === 'TEST') push('tests/Feature/LandingPageTest.php', 'Laravel test surface', 0.83);
      break;
    case 'php-plain':
      if (lowerCapability === 'APPLICATION_ENTRY') push('index.php', 'Plain PHP entry verified by workspace evidence', 0.97);
      else if (lowerCapability === 'GLOBAL_STYLE') push('assets/css/style.css', 'Plain PHP stylesheet surface', 0.92);
      else if (lowerCapability === 'NAVIGATION') push('assets/js/app.js', 'Plain PHP navigation script surface', 0.8);
      else if (lowerCapability === 'CTA') push('assets/js/app.js', 'Plain PHP CTA script surface', 0.8);
      else if (lowerCapability === 'FOOTER') push('assets/js/app.js', 'Plain PHP footer script surface', 0.8);
      break;
    case 'flutter':
      if (lowerCapability === 'APPLICATION_ENTRY') push('lib/main.dart', 'Flutter application entry verified by workspace evidence', 0.99);
      else if (lowerCapability === 'GLOBAL_STYLE') push('lib/theme.dart', 'Flutter theme surface', 0.88);
      else if (lowerCapability === 'NAVIGATION') push('lib/navigation.dart', 'Flutter navigation surface', 0.86);
      else if (lowerCapability === 'CTA') push('lib/widgets/cta.dart', 'Flutter CTA surface', 0.82);
      else if (lowerCapability === 'FOOTER') push('lib/widgets/footer.dart', 'Flutter footer surface', 0.82);
      break;
    case 'aspnet-razor':
      if (lowerCapability === 'APPLICATION_ENTRY') push('Pages/Index.cshtml', 'ASP.NET Razor application entry verified by workspace evidence', 0.97);
      else if (lowerCapability === 'GLOBAL_STYLE') push('wwwroot/css/site.css', 'ASP.NET Razor style surface', 0.9);
      else if (lowerCapability === 'NAVIGATION') push('Pages/Shared/_Layout.cshtml', 'ASP.NET Razor navigation/layout surface', 0.86);
      else if (lowerCapability === 'CTA') push('Pages/Shared/_CallToAction.cshtml', 'ASP.NET Razor CTA surface', 0.82);
      else if (lowerCapability === 'FOOTER') push('Pages/Shared/_Footer.cshtml', 'ASP.NET Razor footer surface', 0.82);
      break;
    case 'aspnet-mvc':
      if (lowerCapability === 'APPLICATION_ENTRY') push('Views/Home/Index.cshtml', 'ASP.NET MVC application entry verified by workspace evidence', 0.97);
      else if (lowerCapability === 'GLOBAL_STYLE') push('wwwroot/css/site.css', 'ASP.NET MVC style surface', 0.9);
      else if (lowerCapability === 'NAVIGATION') push('Views/Shared/_Layout.cshtml', 'ASP.NET MVC navigation/layout surface', 0.86);
      else if (lowerCapability === 'CTA') push('Views/Shared/_CallToAction.cshtml', 'ASP.NET MVC CTA surface', 0.82);
      else if (lowerCapability === 'FOOTER') push('Views/Shared/_Footer.cshtml', 'ASP.NET MVC footer surface', 0.82);
      break;
    case 'python-flask':
      if (lowerCapability === 'APPLICATION_ENTRY') push('templates/index.html', 'Python Flask entry template verified by workspace evidence', 0.95);
      else if (lowerCapability === 'GLOBAL_STYLE') push('static/css/style.css', 'Python Flask global style surface', 0.88);
      else if (lowerCapability === 'NAVIGATION') push('templates/components/navigation.html', 'Python Flask navigation template surface', 0.84);
      else if (lowerCapability === 'CTA') push('templates/components/cta.html', 'Python Flask CTA template surface', 0.82);
      else if (lowerCapability === 'FOOTER') push('templates/components/footer.html', 'Python Flask footer template surface', 0.82);
      break;
    case 'python-django':
      if (lowerCapability === 'APPLICATION_ENTRY') push('templates/home.html', 'Python Django home template verified by workspace evidence', 0.95);
      else if (lowerCapability === 'GLOBAL_STYLE') push('static/css/style.css', 'Python Django style surface', 0.88);
      else if (lowerCapability === 'NAVIGATION') push('templates/components/navigation.html', 'Python Django navigation template surface', 0.84);
      else if (lowerCapability === 'CTA') push('templates/components/cta.html', 'Python Django CTA template surface', 0.82);
      else if (lowerCapability === 'FOOTER') push('templates/components/footer.html', 'Python Django footer template surface', 0.82);
      break;
    case 'java-spring':
      if (lowerCapability === 'APPLICATION_ENTRY') push('templates/index.html', 'Java Spring template entry verified by workspace evidence', 0.95);
      else if (lowerCapability === 'GLOBAL_STYLE') push('src/main/resources/static/css/style.css', 'Java Spring style surface', 0.88);
      else if (lowerCapability === 'NAVIGATION') push('src/main/resources/templates/components/navigation.html', 'Java Spring navigation template surface', 0.84);
      else if (lowerCapability === 'CTA') push('src/main/resources/templates/components/cta.html', 'Java Spring CTA template surface', 0.82);
      else if (lowerCapability === 'FOOTER') push('src/main/resources/templates/components/footer.html', 'Java Spring footer template surface', 0.82);
      break;
    case 'static-html':
      if (lowerCapability === 'APPLICATION_ENTRY') push('index.html', 'Static HTML entry verified by workspace evidence', 0.96);
      else if (lowerCapability === 'ROOT_COMPONENT' || lowerCapability === 'COMPONENT_HIERARCHY' || lowerCapability === 'ROUTING' || lowerCapability === 'ROUTING_CAPABILITY') push('index.html', 'Static HTML structural surface', 0.86);
      else if (lowerCapability === 'GLOBAL_STYLE') push('assets/css/style.css', 'Static HTML stylesheet surface', 0.9);
      else if (lowerCapability === 'STYLING' || lowerCapability === 'STYLING_CAPABILITY' || lowerCapability === 'STYLING_SYSTEM') push('assets/css/style.css', 'Static HTML styling surface', 0.9);
      else if (lowerCapability === 'THEME' || lowerCapability === 'THEME_CAPABILITY') push('assets/css/theme.css', 'Static HTML theme surface', 0.84);
      else if (lowerCapability === 'NAVIGATION') push('index.html', 'Static HTML navigation surface', 0.8);
      else if (lowerCapability === 'HERO') push('index.html', 'Static HTML hero surface', 0.8);
      else if (lowerCapability === 'FEATURES') push('index.html', 'Static HTML features surface', 0.8);
      else if (lowerCapability === 'PRICING') push('index.html', 'Static HTML pricing surface', 0.8);
      else if (lowerCapability === 'CTA') push('index.html', 'Static HTML CTA surface', 0.8);
      else if (lowerCapability === 'FOOTER') push('index.html', 'Static HTML footer surface', 0.8);
      else if (lowerCapability === 'RESPONSIVE_LAYOUT' || lowerCapability === 'BREAKPOINT_SUPPORT') push('assets/css/style.css', 'Static HTML responsive styling surface', 0.88);
      else if (lowerCapability === 'ANIMATION_LAYER' || lowerCapability === 'MOTION_CAPABILITY') push('assets/js/animations.js', 'Static HTML animation surface', 0.82);
      else if (lowerCapability === 'SEMANTIC_STRUCTURE' || lowerCapability === 'KEYBOARD_SUPPORT' || lowerCapability === 'ARIA_SUPPORT') push('index.html', 'Static HTML accessibility surface', 0.84);
      else if (lowerCapability === 'CODE_SPLITTING' || lowerCapability === 'LAZY_LOADING' || lowerCapability === 'PERFORMANCE_OPTIMIZATION') push('assets/js/performance.js', 'Static HTML performance surface', 0.82);
      else if (lowerCapability === 'METADATA' || lowerCapability === 'STRUCTURED_CONTENT' || lowerCapability === 'SEMANTIC_HTML') push('index.html', 'Static HTML semantic document surface', 0.86);
      else if (lowerCapability === 'PROJECT_MANIFEST' || lowerCapability === 'DEPENDENCY_MANIFEST') push('package.json', 'Static HTML project manifest surface', 0.8);
      break;
    default:
      if (targetRoot) {
        // Preserve workspace-relative evidence only; do not invent new paths here.
        if (lowerCapability === 'APPLICATION_ENTRY' && existingFiles.has('src/app.tsx')) push('src/App.tsx', 'Existing React entry surface', 0.7);
      }
      break;
  }

  return dedupeByPath(paths);
}

export function findCandidatePaths({
  requirement = null,
  frameworkResolution = null,
  projectScanSnapshot = {},
  planningContext = {},
  objective = '',
  existingFiles = new Set()
} = {}) {
  if (!requirement) return [];
  const resolvedFramework = frameworkResolution?.requiredFrameworkKey || frameworkResolution?.frameworkKey || null;
  const paths = buildPathOptions(requirement, resolvedFramework, existingFiles, planningContext?.workspaceRoot || projectScanSnapshot?.workspaceRoot || '');
  return rankCandidatePaths(paths).map(candidate => ({
    ...candidate,
    requirementId: requirement.id,
    requirementCapability: requirement.capability,
    requirementPurpose: requirement.purpose,
    confidence: Math.min(1, Math.max(candidate.confidence || 0, requirement.confidence || 0)),
    evidence: collectEvidenceSources({
      objective,
      planningContext,
      projectScanSnapshot,
      requirement,
      frameworkResolution,
      hintPath: candidate.path
    })
  }));
}

export function rankCandidatePaths(paths = []) {
  return dedupeByPath(paths).sort((left, right) =>
    (right.confidence || 0) - (left.confidence || 0) ||
    String(left.path || '').localeCompare(String(right.path || ''))
  );
}

export function resolveRequirement({
  requirement = null,
  planningContext = {},
  projectScanSnapshot = {},
  projectIntent = {},
  objective = '',
  frameworkResolution = null,
  existingFiles = null,
  planningStrategyGraph = null,
  constraintGraph = null,
  implementationResolution = null
} = {}) {
  const files = existingFiles || new Set(collectWorkspaceFiles(projectScanSnapshot, planningContext).map(file => toLower(file)));
  const resolvedFramework = frameworkResolution || resolveFrameworkResolution({
    objective,
    planningContext,
    projectScanSnapshot,
    projectIntent,
    constraintGraph,
    implementationResolution
  });
  const candidatePaths = findCandidatePaths({
    requirement,
    frameworkResolution: resolvedFramework,
    projectScanSnapshot,
    planningContext,
    objective,
    existingFiles: files
  });

  console.log('[WORKSPACE_MAPPING_START]', {
    requirementId: requirement?.id || null,
    capability: requirement?.capability || null,
    frameworkKey: resolvedFramework?.frameworkKey || null,
    verifiedFrameworkKey: resolvedFramework?.verifiedFrameworkKey || null,
    requiredFrameworkKey: resolvedFramework?.requiredFrameworkKey || null,
    frameworkSource: resolvedFramework?.source || null,
    verified: resolvedFramework?.verified === true,
    required: resolvedFramework?.required === true
  });
  console.log('[WORKSPACE_MAPPING_EVIDENCE]', {
    requirementId: requirement?.id || null,
    evidence: collectEvidenceSources({
      objective,
      planningContext,
      projectScanSnapshot,
      requirement,
      frameworkResolution: resolvedFramework,
      planningStrategyGraph,
      constraintGraph
    })
  });

  if (candidatePaths.length === 0) {
    const unresolved = {
      requirementId: requirement?.id || null,
      capability: requirement?.capability || null,
      artifactType: requirement?.artifactType || null,
      path: null,
      operation: null,
      mappingReason: 'Implementation variant not yet selected.',
      confidence: Math.max(0.2, Number(requirement?.confidence || 0.35)),
      evidence: collectEvidenceSources({
      objective,
      planningContext,
      projectScanSnapshot,
      requirement,
      frameworkResolution: resolvedFramework,
      planningStrategyGraph,
      constraintGraph
    }),
      unresolved: true,
      required: requirement?.required !== false,
      optional: requirement?.optional === true,
      source: requirement?.source || 'objective'
    };
    console.log('[WORKSPACE_MAPPING_UNRESOLVED]', {
      requirementId: unresolved.requirementId,
      capability: unresolved.capability,
      reason: unresolved.mappingReason
    });
    return unresolved;
  }

  const selected = candidatePaths[0];
  console.log('[WORKSPACE_MAPPING_SELECTED]', {
    requirementId: requirement?.id || null,
    path: selected.path,
    capability: requirement?.capability || null,
    mappingReason: selected.mappingReason
  });
  console.log('[WORKSPACE_MAPPING_CANDIDATE]', {
    requirementId: requirement?.id || null,
    path: selected.path,
    operation: selected.operation,
    mappingReason: selected.mappingReason,
    confidence: selected.confidence
  });
  console.log('[MAPPED_ARTIFACT_CREATED]', {
    requirementId: requirement?.id || null,
    path: selected.path,
    capability: requirement?.capability || null
  });
  return {
    requirementId: requirement?.id || null,
    requirementCapability: requirement?.capability || null,
    artifactType: requirement?.artifactType || null,
    path: selected.path,
    operation: selected.operation,
    mappingReason: selected.mappingReason,
    confidence: selected.confidence,
    evidence: selected.evidence,
    required: requirement?.required !== false,
    optional: requirement?.optional === true,
    source: requirement?.source || 'objective',
    unresolved: false,
    verifiedFramework: resolvedFramework?.verifiedFrameworkKey || null,
    requiredFramework: resolvedFramework?.requiredFrameworkKey || null,
    recommendationOnly: false
  };
}

export function mapRequirementsToWorkspace({
  requirements = [],
  planningContext = {},
  projectScanSnapshot = {},
  projectIntent = {},
  objective = '',
  planningStrategyGraph = null,
  constraintGraph = null,
  implementationResolution = null
} = {}) {
  const requirementList = Array.isArray(requirements) ? requirements : [];
  const frameworkResolution = resolveFrameworkResolution({
    objective,
    planningContext,
    projectScanSnapshot,
    projectIntent,
    planningStrategyGraph: planningStrategyGraph || planningContext?.planningStrategyGraph || null,
    constraintGraph: constraintGraph || planningContext?.constraintGraph || planningContext?.objectiveConstraintGraph || null,
    implementationResolution: implementationResolution || planningContext?.selectedImplementation || planningContext?.implementationResolution || null
  });
  const existingFiles = new Set(collectWorkspaceFiles(projectScanSnapshot, planningContext).map(file => toLower(file)));
  const mappedArtifacts = [];
  const unresolvedRequirements = [];

  for (const requirement of requirementList) {
    const resolved = resolveRequirement({
      requirement,
      planningContext,
      projectScanSnapshot,
      projectIntent,
      objective,
      frameworkResolution,
      existingFiles,
      planningStrategyGraph: planningStrategyGraph || planningContext?.planningStrategyGraph || null,
      constraintGraph: constraintGraph || planningContext?.constraintGraph || planningContext?.objectiveConstraintGraph || null,
      implementationResolution: implementationResolution || planningContext?.selectedImplementation || planningContext?.implementationResolution || null
    });
    if (resolved.unresolved) unresolvedRequirements.push(resolved);
    else mappedArtifacts.push(resolved);
  }

  return {
    frameworkResolution,
    verifiedFramework: frameworkResolution?.verifiedFrameworkKey || null,
    requiredFramework: frameworkResolution?.requiredFrameworkKey || null,
    mappedArtifacts,
    unresolvedRequirements,
    candidates: [...mappedArtifacts, ...unresolvedRequirements]
  };
}

export function resolveInitializationArtifacts({
  requirements = [],
  planningContext = {},
  projectScanSnapshot = {},
  projectIntent = {},
  objective = ''
} = {}) {
  const mapping = mapRequirementsToWorkspace({
    requirements,
    planningContext,
    projectScanSnapshot,
    projectIntent,
    objective
  });
  return {
    ...mapping,
    initializationRecommendationOnly: false
  };
}
