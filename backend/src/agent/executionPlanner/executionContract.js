function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

export function projectMessagesToExecutionContract(messages = [], contract = null) {
  const unit = contract?.currentExecutionUnit || null;
  const summary = unit?.description || contract?.objectiveSummary || 'Execute the current atomic unit.';
  const files = unique(contract?.requiredFiles || []);
  const requiredContext = contract?.requiredContext || {};
  const systemHeader = [
    `Execution unit: ${unit?.type || 'UNKNOWN'}`,
    unit?.id ? `Unit id: ${unit.id}` : '',
    summary ? `Unit description: ${summary}` : '',
    files.length > 0 ? `Required files: ${files.join(', ')}` : ''
  ].filter(Boolean).join('\n');

  return (Array.isArray(messages) ? messages : []).map(message => {
    if (!message || typeof message !== 'object') return message;
    if (message.role !== 'user') return message;
    return {
      ...message,
      content: `${systemHeader}\n\nUse only the execution contract. Do not expand beyond the listed unit.`
    };
  });
}

export function buildExecutionContract({
  unit = null,
  verifiedPlanningContext = null,
  knowledgeGraph = null,
  canonicalFileUniverse = [],
  plannerPolicies = {}
} = {}) {
  const verifiedFiles = unique(verifiedPlanningContext?.verifiedFiles || []);
  const verifiedCommands = unique(verifiedPlanningContext?.verifiedCommands || []);
  const requiredReads = unique(unit?.requiredReads || []);
  const requiredWrites = unique(unit?.requiredWrites || []);
  const targetFiles = unique(unit?.targetFiles || []);
  const acceptanceCriteria = Array.isArray(unit?.acceptanceCriteria) ? [...unit.acceptanceCriteria] : [];
  const outputFormat = unit?.type === 'VALIDATE'
    ? 'run_terminal_json'
    : (unit?.type === 'READ' || unit?.type === 'ANALYZE')
      ? 'analysis_json'
      : 'file_content_json';

  const contract = {
    currentExecutionUnit: unit ? {
      id: unit.id,
      type: unit.type,
      description: unit.description,
      targetFiles,
      requiredReads,
      requiredWrites,
      dependencies: unique(unit.dependencies || []),
      inputs: unit.inputs || {},
      outputs: unit.outputs || {},
      acceptanceCriteria,
      completionPredicate: unit.completionPredicate || null,
      retryPolicy: unit.retryPolicy || {},
      verificationPolicy: unit.verificationPolicy || {},
      outputFormat
    } : null,
    requiredContext: {
      verifiedFiles,
      verifiedCommands,
      canonicalFileUniverse: unique(canonicalFileUniverse),
      knowledgeGraph: knowledgeGraph ? {
        concepts: unique(knowledgeGraph.concepts || []),
        surfaces: knowledgeGraph.surfaces || null,
        summary: knowledgeGraph.summary || null
      } : null,
      plannerPolicies: { ...(plannerPolicies || {}) }
    },
    requiredFiles: unique([...requiredReads, ...requiredWrites, ...targetFiles]),
    acceptanceCriteria,
    validationCommands: verifiedCommands,
    objectiveSummary: unit?.description || '',
    outputFormat
  };

  console.log('[EXECUTION_CONTRACT_CREATED]', {
    unitId: unit?.id || null,
    unitType: unit?.type || null,
    requiredFileCount: contract.requiredFiles.length,
    verifiedCommandCount: verifiedCommands.length
  });

  return contract;
}
