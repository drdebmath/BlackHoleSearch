export function classifyProbeOutcome(returned, missing, threshold) {
  if (returned >= threshold) return 'safe';
  if (missing >= threshold) return 'dangerous';
  return 'continue';
}

export function selectNextProbeAgent(candidates, sent) {
  return candidates.find(agent => !sent.has(agent.id));
}
