// Adversary Controller
// This module decides the state of the Byzantine Black Hole (BBH) each round.

export const ADVERSARY_TYPE = {
  NONE: 'none',
  PROBABILISTIC: 'probabilistic',
  INTELLIGENT: 'intelligent',
};

const DORMANT_DECISION = { decision: 'dormant', drop: false, spoof: false };

/**
 * Executes the adversary's logic for the current round.
 * @param {object} simState - The current simulation state.
 * @param {string} adversaryType - The type of adversary.
 * @returns {{decision: 'active' | 'dormant', drop: boolean, spoof: boolean}} - The adversary's plan.
 */
export function runAdversary(simState, adversaryType) {
  if (simState.manualBHTrigger) {
    simState.manualBHTrigger = false; // Reset trigger
    return { decision: 'active', drop: true, spoof: false };
  }
  
  if (!simState.bhNode || adversaryType === ADVERSARY_TYPE.NONE) {
    return DORMANT_DECISION;
  }

  switch (adversaryType) {
    case ADVERSARY_TYPE.PROBABILISTIC:
      return runProbabilisticAdversary(simState);
    case ADVERSARY_TYPE.INTELLIGENT:
      return runIntelligentAdversary(simState);
    default:
      return DORMANT_DECISION;
  }
}

function runProbabilisticAdversary(simState) {
  const activationProbability = (simState.bhProb / 100);
  if (Math.random() >= activationProbability) {
    return DORMANT_DECISION;
  }
  
  // If active, 50% chance to drop, 30% chance to spoof
  return {
    decision: 'active',
    drop: Math.random() < 0.5,
    spoof: Math.random() < 0.3,
  };
}

function runIntelligentAdversary(simState) {
  const { agents, bhNode, round, nodeStatus } = simState;
  const agentsEnteringBH = agents.filter(a => a.alive && !a.byzantine && simState.neighbors[a.pos].includes(bhNode));
  
  // If a node was recently marked safe, good time to activate and trap
  const recentlySafeNodes = Object.keys(nodeStatus).filter(nid => 
    nodeStatus[nid].status === 'safe' && (round - nodeStatus[nid].round < 5)
  );
  if (recentlySafeNodes.includes(String(bhNode))) {
    return { decision: 'active', drop: true, spoof: false };
  }

  // Activate if multiple agents are about to enter
  if (agentsEnteringBH.length >= 2) {
    // Be selective: drop one, spare one to create confusion
    return { decision: 'active', drop: true, spoof: true };
  }
  
  // Default to dormant
  return DORMANT_DECISION;
}
