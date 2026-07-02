export function validatePlanningContext(context) {
  if (!context) {
    return { valid: false, errors: ['Context is null or undefined'] };
  }
  const errors = [];
  const facts = context.facts || context.projectScan || {};

  if (!context.workspace || typeof context.workspace !== 'object') {
    errors.push('workspace must be an object');
  }

  if (!facts || typeof facts !== 'object') {
    errors.push('facts must be an object');
  }

  if (!Array.isArray(context.verifiedFiles)) {
    errors.push('verifiedFiles must be an array');
  }

  if (!Array.isArray(context.verifiedCommands)) {
    errors.push('verifiedCommands must be an array');
  }

  if (!Array.isArray(context.blockedRecommendations)) {
    errors.push('blockedRecommendations must be an array');
  }

  if (!Array.isArray(context.verifiedRecommendations)) {
    errors.push('verifiedRecommendations must be an array');
  }

  if (!context.plannerPolicies || typeof context.plannerPolicies !== 'object') {
    errors.push('plannerPolicies must be an object');
  }

  if (context.packageJsonFound !== undefined && facts.packageJsonFound !== undefined && context.packageJsonFound !== facts.packageJsonFound) {
    errors.push('packageJsonFound contradicts facts');
  }

  if (context.projectScan && facts && context.projectScan !== facts) {
    const factScanId = facts.scanId || null;
    const projectScanId = context.projectScan.scanId || null;
    if (factScanId && projectScanId && factScanId !== projectScanId) {
      errors.push('projectScan must match immutable facts snapshot');
    }
  }

  for (const file of context.verifiedFiles) {
    if (typeof file !== 'string') {
      errors.push(`verifiedFiles contains non-string: ${JSON.stringify(file)}`);
    }
  }

  const verifiedSet = new Set(context.verifiedFiles.map(f => f.replace(/\\/g, '/').toLowerCase()));
  for (const rec of context.blockedRecommendations) {
    if (rec.path) {
      const normalized = rec.path.replace(/\\/g, '/').toLowerCase();
      if (verifiedSet.has(normalized)) {
        errors.push(`File ${rec.path} is both in verifiedFiles and blockedRecommendations`);
      }
    }
  }

  if (facts.packageJsonFound === false && context.verifiedCommands.some(cmd => /^npm\s+run\s+(build|dev|preview|test)\b/i.test(String(cmd || "")))) {
    errors.push('verifiedCommands cannot be package-derived when facts.packageJsonFound is false');
  }

  return {
    valid: errors.length === 0,
    errors,
    verifiedRecommendationCount: context.verifiedRecommendations.length,
    blockedRecommendationCount: context.blockedRecommendations.length,
    verifiedFileCount: context.verifiedFiles.length
  };
}
