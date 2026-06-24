// Adversary Controller
// This module decides the state of the Byzantine Black Hole (BBH) each round.

export const ADVERSARY_TYPE = {
  NONE: 'none',
  PROBABILISTIC: 'probabilistic',
  INTELLIGENT: 'intelligent',
};

/**
 * Executes the adversary's logic for the current round.
 * @param {object} simState - The current simulation state.
 * @param {string} adversaryType - The type of adversary.
 * @returns {'active' | 'dormant'} - The state of the BBH for this round.
 */
export function runAdversary(simState, adversaryType) {
  if (!simState.bhNode || adversaryType === ADVERSARY_TYPE.NONE) {
    return 'dormant';
  }

  switch (adversaryType) {
    case ADVERSARY_TYPE.PROBABILISTIC:
      return runProbabilisticAdversary(simState);
    case ADVERSARY_TYPE.INTELLIGENT:
      return runIntelligentAdversary(simState);
    default:
      return 'dormant';
  }
}

function runProbabilisticAdversary(simState) {
  const activationProbability = (simState && typeof simState.bhProb === 'number')
    ? (simState.bhProb / 100)
    : 0.2;
  return Math.random() < activationProbability ? 'active' : 'dormant';
}

function runIntelligentAdversary(simState) {
  const { agents, bhNode } = simState;
  const agentsOnBBH = agents.filter(agent => agent.pos === bhNode && agent.alive && !agent.byzantine);

  // Activate if a certain number of good agents are on the BBH node.
  const activationThreshold = 2; // Example threshold

  if (agentsOnBBH.length >= activationThreshold) {
    return 'active';
  }

  // TODO: Add more sophisticated logic, e.g., luring agents.
  // For now, it just activates when agents are on the node.

  return 'dormant';
}
