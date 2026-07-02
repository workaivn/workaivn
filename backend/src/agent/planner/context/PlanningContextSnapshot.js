export function createPlanningContextSnapshot(context) {
  if (!context) return null;

  const facts = context.facts || context.projectScan || {};
  const derived = context.derived || {};
  return {
    facts: {
      ...facts
    },
    derived: {
      verifiedFramework: derived.verifiedFramework || context.verifiedFramework,
      verifiedPackageManager: derived.verifiedPackageManager || context.verifiedPackageManager,
      verifiedValidation: derived.verifiedValidation || context.verifiedValidation,
      verifiedFiles: [...context.verifiedFiles],
      verifiedCommands: [...context.verifiedCommands],
      verifiedRecommendations: [...context.verifiedRecommendations],
      blockedRecommendations: [...context.blockedRecommendations]
    },
    packageJsonFound: context.packageJsonFound,
    verifiedFileCount: context.verifiedFiles.length,
    blockedRecommendationCount: context.blockedRecommendations.length,
    verifiedCommandCount: context.verifiedCommands.length,
    verifiedFramework: context.verifiedFramework,
    verifiedPackageManager: context.verifiedPackageManager,
    verifiedValidation: context.verifiedValidation,
    hasVerifiedFiles: context.hasVerifiedFiles,
    hasBlockedRecommendations: context.hasBlockedRecommendations,
    policies: { ...(context.policies || context.plannerPolicies || {}) },
    verifiedFiles: [...context.verifiedFiles],
    blockedFiles: context.blockedRecommendations.map(r => r.path).filter(Boolean),
    verifiedCommands: [...context.verifiedCommands]
  };
}
