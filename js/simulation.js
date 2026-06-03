import { cyRef, runRef, simState, setSimState } from './state.js';
import { generateGraph } from './graph-generation.js';
import { initCy } from './cytoscape-setup.js';
import {
  $, setStat, logAdd, logClear, updateAgentChips,
  updateEdgeTable, showOverlay, updateFormula,
} from './ui.js';

export function buildGraph() {
  clearInterval(runRef.intervalId);
  runRef.intervalId = null;
  $('runBtn').textContent = 'RUN SIMULATION';

  const topo = $('topoSelect').value;
  const n    = +$('nNodes').value;
  const f    = +$('fFault').value;
  const comm = $('commModel').value;
  const know = $('topoKnow').value;
  const memoryTTL = +$('memoryTTL').value;
  $('advViewToggle').checked = true;

  const { nodes, edges } = generateGraph(topo, n);
  initCy(nodes, edges);
  const cy = cyRef.instance;
  cy.on('pan zoom resize layoutstop', renderAgentsOnGraph);
  cy.on('position', 'node', renderAgentsOnGraph);

  const homebase = 0;
  const neighbors = buildNeighbors(n, edges);
  const bhNode = chooseBlackHole(n, homebase, neighbors, know);

  const delta = Math.max(...Object.values(neighbors).map(v => v.length));
  const k = Math.max(requiredAgents(know, comm, f, delta), f + 2);

  const agents = [];
  for (let i = 0; i < k; i++) {
    agents.push({
      id: i,
      pos: homebase,
      alive: true,
      byzantine: i < f,
      identified: false,
      status: i < f ? 'byz' : 'good',
    });
  }

  const ports = {};
  for (let i = 0; i < n; i++) ports[i] = [...new Set(neighbors[i])].sort((a, b) => a - b);

  const edgeStatus = {};
  const edgeMemory = {};
  edges.forEach(e => {
    const s = +e.data.source.slice(1);
    const t = +e.data.target.slice(1);
    const key = edgeKey(s, t);
    edgeStatus[key] = 'unknown';
    edgeMemory[key] = {
      status: 'unknown',
      certifiedRound: null,
      expiresAt: null,
      probes: 0,
      lastProbedRound: null,
    };
  });

  const state = {
    n, f, k, homebase, bhNode, agents, neighbors, ports, edges,
    edgeStatus, edgeMemory, know, comm, delta, memoryTTL,
    round: 0,
    done: false,
    found: false,
    bhLocated: false,
    currentNode: homebase,
    visitedNodes: new Set([homebase]),
    safeNodes: new Set([homebase]),
    traversalOrder: [],
    traversalIndex: 0,
    currentOperation: null,
    activeAgentId: null,
    identifiedByzantine: new Set(),
    lostInBH: 0,
    maintenanceCycle: 0,
    maintenanceLogged: false,
  };
  state.traversalOrder = know === 'known'
    ? buildKnownDFSPlan(state)
    : buildUnknownDFSPlan(state);
  setSimState(state);

  cy.getElementById('n' + homebase).addClass('homebase');
  
  cy.getElementById('n' + bhNode).addClass('revealed');

  updateAgentChips();
  updateEdgeTable();
  renderAgentsOnGraph();
  setStat('sRound', 0);
  setStat('sAlive', agents.filter(a => a.alive).length);
  setStat('sLost', 0);
  setStat('sByzFound', 0);
  setStat('sEdgeSafe', 0);
  setStat('sEdgeDanger', 0);
  setStat('sEdgeExpired', 0);
  $('progressBar').style.width = '0%';

  logClear();
  logAdd(0, 'system', `Graph built: ${n} nodes, ${edges.length} edges, Delta=${delta}`);
  logAdd(0, 'system', `Byzantine Black Hole (BBH) at node ${bhNode} (hidden from agents)`);
  logAdd(0, 'system', `Team: k=${k} agents, f=${f} Byzantine`);
  logAdd(0, 'system', `Algorithm: ${know === 'known' ? 'WhiteboardMap/ProbeMap' : 'WhiteboardWithoutMap/ProbeWithoutMap'}`);
  logAdd(0, 'info', `Homebase: node ${homebase}. DFS traversal plan ready; safe edge memory expires after ${memoryTTL} rounds.`);

  $('runBtn').disabled  = false;
  $('stepBtn').disabled = false;
  $('overlay').className = '';
  updateFormula();
}

function buildNeighbors(n, edges) {
  const neighbors = {};
  for (let i = 0; i < n; i++) neighbors[i] = [];
  edges.forEach(e => {
    const s = +e.data.source.slice(1);
    const t = +e.data.target.slice(1);
    neighbors[s].push(t);
    neighbors[t].push(s);
  });
  return neighbors;
}

function chooseBlackHole(n, homebase, neighbors, know) {
  const candidates = [...Array(n).keys()].filter(node => node !== homebase);
  const viable = know === 'unknown'
    ? candidates.filter(node => graphStaysConnectedWithout(node, homebase, neighbors, n))
    : candidates;
  const pool = viable.length > 0 ? viable : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

function graphStaysConnectedWithout(blockedNode, homebase, neighbors, n) {
  const visited = new Set([homebase]);
  const queue = [homebase];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of neighbors[cur] || []) {
      if (next === blockedNode || visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited.size === n - 1;
}

function requiredAgents(know, comm, f, delta) {
  if (know === 'known') return 2 * f + 2;
  if (comm === 'whiteboard') return (f + 1) * (delta + 1);
  return (f + 1) * (delta + 1) + 3 * f + 1;
}

function buildKnownDFSPlan(state) {
  const { homebase, ports } = state;
  const visited = new Set([homebase]);
  const exploredEdges = new Set();
  const plan = [];

  const dfs = (u) => {
    for (const v of (ports[u] || [])) {
      const key = edgeKey(u, v);
      if (exploredEdges.has(key)) continue;
      exploredEdges.add(key);

      if (!visited.has(v)) {
        visited.add(v);
        plan.push({ kind: 'probe', from: u, to: v, classify: true, label: 'DFS probe' });
        dfs(v);
        plan.push({ kind: 'move', from: v, to: u, classify: false, label: 'DFS backtrack' });
      } else {
        plan.push({ kind: 'probe', from: u, to: v, classify: true, label: 'DFS cross-edge probe' });
        plan.push({ kind: 'move', from: v, to: u, classify: false, label: 'Return after cross-edge probe' });
      }
    }
  };

  dfs(homebase);
  return plan;
}

function buildUnknownDFSPlan(state) {
  const { homebase, bhNode, ports } = state;
  const visitedNodes = new Set([homebase]);
  const exploredEdges = new Set();
  const plan = [];

  const dfs = (u) => {
    for (const v of (ports[u] || [])) {
      const key = edgeKey(u, v);
      if (exploredEdges.has(key)) continue;
      exploredEdges.add(key);

      if (v === bhNode) {
        plan.push({ kind: 'probe', from: u, to: v, classify: true, label: 'BH boundary probe' });
        plan.push({ kind: 'move', from: v, to: u, classify: false, label: 'Return after boundary probe' });
        continue;
      }

      if (!visitedNodes.has(v)) {
        visitedNodes.add(v);
        plan.push({ kind: 'probe', from: u, to: v, classify: true, label: 'DFS discovery' });
        dfs(v);
        plan.push({ kind: 'move', from: v, to: u, classify: false, label: 'DFS backtrack' });
      } else {
        plan.push({ kind: 'probe', from: u, to: v, classify: true, label: 'DFS cross-edge probe' });
        plan.push({ kind: 'move', from: v, to: u, classify: false, label: 'Return after cross-edge probe' });
      }
    }
  };

  dfs(homebase);
  return plan;
}

function evaluateAdversaryState(s) {
  const mode = $('bbhControlMode').value;
  const activeCheckbox = $('bbhActiveNow');

  if (mode === 'n-rounds') {
    const n = +$('bbhN').value;
    activeCheckbox.checked = (s.round > 0 && s.round % n === 0);
  } else if (mode === 'm-agents') {
    const m = +$('bbhM').value;
    const agentsOnBH = s.agents.filter(a => a.alive && a.pos === s.bhNode).length;
    if (agentsOnBH >= m) activeCheckbox.checked = true;
  }

  const isBBHActive = activeCheckbox.checked;

  if (isBBHActive) {
    const doomedAgents = s.agents.filter(a => a.alive && a.pos === s.bhNode);
    doomedAgents.forEach(agent => {
      agent.alive = false;
      agent.status = 'dead';
      s.lostInBH++;
      logAdd(s.round, 'danger', `BBH ACTIVATED! A${agent.id} was swallowed at node ${s.bhNode}.`);
    });
    if (doomedAgents.length > 0) {
      s.found = true;
      s.bhLocated = true;
      cyRef.instance.getElementById(`n${s.bhNode}`).removeClass('blackhole').addClass('revealed');
      if (
        s.currentOperation &&
        (s.currentOperation.step.from === s.bhNode || s.currentOperation.step.to === s.bhNode)
      ) {
        s.currentOperation.losses += doomedAgents.length;
      }
    }
  }

  return isBBHActive;
}

function nextPlannedStep(s) {
  if (s.traversalIndex < s.traversalOrder.length) {
    return { step: s.traversalOrder[s.traversalIndex], fromTraversal: true };
  }

  if (!s.maintenanceLogged) {
    s.maintenanceLogged = true;
    logAdd(s.round, 'system', 'Initial DFS plan exhausted; entering continuous re-exploration loop.');
  }

  return { step: buildMaintenanceStep(s), fromTraversal: false };
}

function buildMaintenanceStep(s) {
  const targetKey = chooseMaintenanceEdge(s);
  if (!targetKey) return null;

  const [a, b] = targetKey.split('-').map(Number);
  const status = s.edgeStatus[targetKey];
  const label = status === 'expired' ? 'Memory refresh probe' : 'Maintenance discovery probe';

  if (s.currentNode === a || s.currentNode === b) {
    const to = s.currentNode === a ? b : a;
    return { kind: 'probe', from: s.currentNode, to, classify: true, label, maintenance: true };
  }

  const path = shortestPathToAny(s, s.currentNode, new Set([a, b]));
  if (path && path.length > 1) {
    const from = path[0];
    const to = path[1];
    return {
      kind: 'move',
      from,
      to,
      classify: s.edgeStatus[edgeKey(from, to)] !== 'safe',
      label: 'Maintenance reposition',
      maintenance: true,
    };
  }

  logAdd(s.round, 'warn', `No non-dangerous route is currently available to refresh edge ${targetKey}.`);
  return null;
}

function chooseMaintenanceEdge(s) {
  return Object.entries(s.edgeStatus)
    .filter(([, status]) => status === 'expired' || status === 'unknown')
    .sort(([keyA, statusA], [keyB, statusB]) => {
      const priorityA = statusA === 'expired' ? 0 : 1;
      const priorityB = statusB === 'expired' ? 0 : 1;
      if (priorityA !== priorityB) return priorityA - priorityB;

      const expiresA = s.edgeMemory[keyA]?.expiresAt ?? Number.MAX_SAFE_INTEGER;
      const expiresB = s.edgeMemory[keyB]?.expiresAt ?? Number.MAX_SAFE_INTEGER;
      if (expiresA !== expiresB) return expiresA - expiresB;

      const probedA = s.edgeMemory[keyA]?.lastProbedRound ?? -1;
      const probedB = s.edgeMemory[keyB]?.lastProbedRound ?? -1;
      return probedA - probedB;
    })[0]?.[0] ?? null;
}

function shortestPathToAny(s, start, goals) {
  const visited = new Set([start]);
  const queue = [[start]];

  while (queue.length) {
    const path = queue.shift();
    const cur = path[path.length - 1];
    if (goals.has(cur)) return path;

    for (const next of s.ports[cur] || []) {
      const key = edgeKey(cur, next);
      if (s.edgeStatus[key] === 'dangerous' || visited.has(next)) continue;
      visited.add(next);
      queue.push([...path, next]);
    }
  }

  return null;
}

function prepareOperation(s, step) {
  if (!step) {
    return {
      step: { from: s.currentNode, to: s.currentNode, label: 'Memory watch' },
      actions: [{ type: 'noop' }],
      index: 0,
      losses: 0,
      requiresProbe: false,
      certified: false,
    };
  }

  const key = edgeKey(step.from, step.to);
  const edgeState = s.edgeStatus[key] || 'unknown';
  const actions = [];
  const movers = s.agents.filter(a => a.alive && a.pos === step.from);
  const requiresProbe = step.classify || edgeState !== 'safe';

  if (edgeState === 'dangerous') {
    logAdd(s.round, 'danger', `Movement blocked: edge (${step.from}->${step.to}) is already certified DANGEROUS.`);
    actions.push({ type: 'noop' });
    return { step, actions, index: 0, losses: 0, requiresProbe: false, certified: false };
  }

  if (movers.length === 0) {
    logAdd(s.round, 'warn', `No live agents at node ${step.from}; advancing logical cursor to ${step.to}.`);
    actions.push({ type: 'markMoveOnly' });
    return { step, actions, index: 0, losses: 0, requiresProbe: false, certified: false };
  }

  if (requiresProbe) {
    const probeAgents = movers.slice(0, Math.min(movers.length, s.f + 1));
    const reason = edgeState === 'expired' ? 'expired memory' : 'uncertified edge';
    logAdd(s.round, 'info', `CCP starts on edge (${step.from}->${step.to}) for ${reason}. Pattern: probe out, return, verify, then certify.`);

    probeAgents.forEach((agent, index) => {
      const phase = index + 1;
      actions.push({ type: 'probeOut', agentId: agent.id, phase });
      actions.push({ type: 'probeBack', agentId: agent.id, phase });
    });
    actions.push({ type: 'certifyAndGroupMove', agentIds: movers.map(agent => agent.id) });

    if (probeAgents.length < s.f + 1) {
      logAdd(s.round, 'warn', `Only ${probeAgents.length} agent(s) available for the required f+1=${s.f + 1} CCP probe threshold.`);
    }
  } else if (movers.length > 1) {
    actions.push({ type: 'groupMove', agentIds: movers.map(agent => agent.id) });
  } else {
    actions.push({ type: 'move', agentId: movers[0].id });
  }

  return {
    step: { ...step, classify: requiresProbe },
    actions,
    index: 0,
    losses: 0,
    requiresProbe,
    certified: false,
  };
}

export function stepSimulation() {
  if (!simState || simState.done) return;

  const s = simState;
  if (!s.currentOperation) {
    decayEdgeMemory(s);
    if (shouldFinish(s)) {
      finishSim(finishWasSuccessful(s));
      return;
    }
    const next = nextPlannedStep(s);
    s.currentOperation = prepareOperation(s, next.step);
    s.currentOperation.fromTraversal = next.fromTraversal;
  }

  const op = s.currentOperation;
  const action = op.actions[op.index++];
  if (!action) {
    logAdd(s.round, 'danger', 'Simulation halted: no valid action was available for the current DFS step.');
    finishSim(false);
    return;
  }
  s.round++;
  s.activeAgentId = action.agentId ?? null;
  setStat('sRound', s.round);
  evaluateAdversaryState(s);
  highlightEdge(op.step.from, op.step.to);

  if (action.type === 'move') {
    moveAgent(action.agentId, op.step.from, op.step.to, 'moves across certified edge');
  } else if (action.type === 'groupMove') {
    moveAgentGroup(action.agentIds, op.step.from, op.step.to);
  } else if (action.type === 'probeOut') {
    moveAgent(action.agentId, op.step.from, op.step.to, `CCP probe ${action.phase} out`);
  } else if (action.type === 'probeBack') {
    moveAgent(action.agentId, op.step.to, op.step.from, `CCP probe ${action.phase} returns`);
  } else if (action.type === 'certifyAndGroupMove') {
    certifySafeTraversal(op);
    moveAgentGroup(action.agentIds, op.step.from, op.step.to, true);
  } else if (action.type === 'markDanger') {
    logAdd(s.round, 'danger', `Edge (${op.step.from}->${op.step.to}) borders the known black hole; marked DANGEROUS without another loss.`);
  } else if (action.type === 'markMoveOnly') {
    s.currentNode = op.step.to;
    markCurrentNode(op.step.to);
  } else if (action.type === 'noop') {
    logAdd(s.round, 'info', 'No DFS movement was required this round.');
  }

  if (op.index >= op.actions.length) {
    completeOperation(op);
    s.currentOperation = null;
    if (op.fromTraversal) s.traversalIndex++;
    decayEdgeMemory(s);
  }

  refreshDisplay();

  if (s.agents.filter(a => a.alive && !a.byzantine).length === 0) {
    logAdd(s.round, 'danger', 'ALL GOOD AGENTS ELIMINATED - BHS FAILED');
    finishSim(false);
    return;
  }

  if (!s.currentOperation && shouldFinish(s)) {
    finishSim(finishWasSuccessful(s));
  }
}

function moveAgent(agentId, from, to, context = 'moves') {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive || agent.pos !== from) return false;

  if (to === s.bhNode && $('bbhActiveNow').checked) {
    loseAgentToBlackHole(agent.id, from, to);
    if (s.currentOperation) s.currentOperation.losses++;
    return false;
  }

  agent.pos = to;
  s.currentNode = to;
  markCurrentNode(to);
  logAdd(s.round, agent.byzantine ? 'byz' : 'info', `A${agent.id} ${context} ${from}->${to} (${agent.byzantine ? 'Byzantine' : 'good'}).`);
  return true;
}

function moveAgentGroup(agentIds, from, to, afterConfirmation = false) {
  const s = simState;
  const movers = agentIds
    .map(agentId => s.agents.find(a => a.id === agentId))
    .filter(agent => agent && agent.alive && agent.pos === from);

  if (movers.length === 0) return;

  if (to === s.bhNode && $('bbhActiveNow').checked) {
    movers.forEach(agent => {
      loseAgentToBlackHole(agent.id, from, to);
      if (s.currentOperation) s.currentOperation.losses++;
    });
    return;
  }

  movers.forEach(agent => {
    agent.pos = to;
  });
  s.currentNode = to;
  markCurrentNode(to);

  const labels = movers.map(agent => `A${agent.id}`).join(', ');
  const context = afterConfirmation ? 'certified agents' : 'agents';
  logAdd(s.round, 'info', `Group move ${from}->${to}: ${context} ${labels} move together to confirmed safe node ${to}.`);
}

function loseAgentToBlackHole(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return false;
  agent.alive = false;
  agent.status = 'dead';
  agent.pos = to;
  s.lostInBH++;
  s.currentNode = from;
  markCurrentNode(from);
  logAdd(s.round, 'danger', `A${agent.id} enters ${from}->${to} and is lost in the black hole (${s.lostInBH}/${s.f + 1}).`);
  return true;
}

function completeOperation(op) {
  const s = simState;
  const { from, to } = op.step;
  const key = edgeKey(from, to);
  const cyEdge = getCyEdge(from, to);
  
  cyEdge.removeClass('probing');

  if (op.losses > 0) {
    markDangerousEdge(op);
    return;
  }

  s.currentNode = to;
  if (op.requiresProbe && !op.certified) certifySafeTraversal(op);
}

function markDangerousEdge(op) {
  const s = simState;
  const { from, to } = op.step;
  const key = edgeKey(from, to);
  const memory = s.edgeMemory[key];

  s.edgeStatus[key] = 'dangerous';
  if (memory) {
    memory.status = 'dangerous';
    memory.certifiedRound = null;
    memory.expiresAt = null;
    memory.lastProbedRound = s.round;
  }

  s.found = true;
  s.bhLocated = true;
  s.currentNode = from === s.bhNode ? to : from;
  getCyEdge(from, to).removeClass('safe expired probing').addClass('dangerous');
  cyRef.instance.getElementById(`n${s.bhNode}`).removeClass('blackhole').addClass('revealed');
  logAdd(s.round, 'danger', `CCP on edge (${from}->${to}): BLACK HOLE DETECTED. Total BH losses: ${s.lostInBH}.`);
}

function certifySafeTraversal(op) {
  const s = simState;
  const { from, to, classify, label } = op.step;
  const key = edgeKey(from, to);

  if (!classify || s.edgeStatus[key] === 'dangerous') return;

  s.edgeStatus[key] = 'safe';
  const memory = s.edgeMemory[key];
  if (memory) {
    memory.status = 'safe';
    memory.certifiedRound = s.round;
    memory.expiresAt = s.round + s.memoryTTL;
    memory.probes++;
    memory.lastProbedRound = s.round;
  }
  s.safeNodes.add(from);
  s.safeNodes.add(to);
  s.visitedNodes.add(to);
  getCyEdge(from, to).removeClass('expired dangerous').addClass('safe');
  cyRef.instance.getElementById(`n${to}`).addClass('safe');
  cyRef.instance.getElementById(`n${from}`).addClass('safe');
  maybeIdentifyByzantine(from, to);
  op.certified = true;
  logAdd(s.round, 'safe', `${label}: edge (${from}->${to}) certified SAFE after CCP pattern; memory expires at R${memory?.expiresAt ?? '?'}.`);
}

function decayEdgeMemory(s) {
  if (!cyRef.instance) return;

  Object.entries(s.edgeMemory).forEach(([key, memory]) => {
    if (memory.status !== 'safe' || !Number.isFinite(memory.expiresAt)) return;
    if (s.round <= memory.expiresAt) return;

    const [from, to] = key.split('-').map(Number);
    memory.status = 'expired';
    s.edgeStatus[key] = 'expired';
    getCyEdge(from, to).removeClass('safe').addClass('expired');
    logAdd(s.round, 'warn', `Safe memory expired for edge (${from}->${to}); queued for CCP re-probe.`);
  });
}

function maybeIdentifyByzantine(from, to) {
  const s = simState;
  const aliveByz = s.agents.filter(a => a.alive && a.byzantine && !s.identifiedByzantine.has(a.id));
  if (aliveByz.length === 0 || Math.random() >= 0.4) return;

  const byz = aliveByz[0];
  s.identifiedByzantine.add(byz.id);
  byz.identified = true;
  logAdd(s.round, 'byz', `Byzantine agent A${byz.id} identified via CCP behavior on edge (${from}->${to})!`);
}

function shouldFinish(s) {
  if (s.currentOperation) return false;
  return s.bhLocated;
}

function finishWasSuccessful(s) {
  return s.bhLocated;
}

function allEdgesClassified(s) {
  return Object.values(s.edgeStatus).every(status => status !== 'unknown');
}

function refreshDisplay() {
  const s = simState;
  const edgeSafe   = Object.values(s.edgeStatus).filter(v => v === 'safe').length;
  const edgeDanger = Object.values(s.edgeStatus).filter(v => v === 'dangerous').length;
  const edgeExpired = Object.values(s.edgeStatus).filter(v => v === 'expired').length;
  setStat('sEdgeSafe', edgeSafe);
  setStat('sEdgeDanger', edgeDanger);
  setStat('sEdgeExpired', edgeExpired);
  setStat('sAlive', s.agents.filter(a => a.alive).length);
  setStat('sLost', s.lostInBH);
  setStat('sByzFound', s.identifiedByzantine.size);
  $('progressBar').style.width = progressPercent(s) + '%';
  updateAgentChips();
  updateEdgeTable();
  renderAgentsOnGraph();
}

function progressPercent(s) {
  if (s.edges.length === 0) return 100;
  const currentlyCertified = Object.values(s.edgeStatus)
    .filter(status => status === 'safe' || status === 'dangerous')
    .length;
  return Math.min(100, currentlyCertified / s.edges.length * 100);
}

function finishSim(success) {
  const s = simState;
  s.done = true;
  s.activeAgentId = null;
  clearInterval(runRef.intervalId);
  runRef.intervalId = null;

  cyRef.instance.edges().removeClass('probing');
  refreshDisplay();
  $('progressBar').style.width = '100%';
  $('runBtn').textContent = 'RUN SIMULATION';

  const survivors = s.agents.filter(a => a.alive && !a.byzantine).length;
  if (success) {
    const modeNote = 'Continuous re-exploration stopped after locating the black hole.';
    logAdd(s.round, 'system', `BH LOCATED at node ${s.bhNode}`);
    logAdd(s.round, 'safe', `${survivors} good agent(s) survived. ${s.lostInBH} lost in BH. ${modeNote}`);
    showOverlay('success', 'BLACK HOLE LOCATED',
      `Node ${s.bhNode} identified in ${s.round} rounds - ${survivors} survivors`);
  } else {
    const staleLeft = Object.values(s.edgeStatus).filter(v => v === 'unknown' || v === 'expired').length;
    logAdd(s.round, 'danger', 'BHS FAILED');
    showOverlay('failure', 'MISSION FAILED',
      staleLeft > 0 ? `${staleLeft} edge(s) had missing or expired safety memory` : `All good agents eliminated by round ${s.round}`);
  }
  $('runBtn').disabled  = true;
  $('stepBtn').disabled = true;
}

function highlightEdge(from, to) {
  const cy = cyRef.instance;
  cy.edges().removeClass('probing');
  getCyEdge(from, to).addClass('probing');
}

function markCurrentNode(nodeId) {
  const cy = cyRef.instance;
  cy.nodes().removeClass('current');
  cy.getElementById(`n${nodeId}`).addClass('current');
}

function getCyEdge(from, to) {
  return cyRef.instance.edges().filter(e =>
    (e.data('source') === `n${from}` && e.data('target') === `n${to}`) ||
    (e.data('source') === `n${to}`   && e.data('target') === `n${from}`)
  );
}

function edgeKey(a, b) {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

export function renderAgentsOnGraph() {
  const layer = $('agentLayer');
  if (layer) layer.innerHTML = '';
  if (!simState || !cyRef.instance) return;

  cyRef.instance.nodes().forEach(node => {
    const nid = +node.id().slice(1);
    const agentsHere = simState.agents.filter(a => a.alive && a.pos === nid);
    const goodCount = agentsHere.filter(a => !a.byzantine).length;
    const byzCount  = agentsHere.filter(a =>  a.byzantine).length;
    let label = `${nid}`;
    if (goodCount > 0) label += `\nG${goodCount}`;
    if (byzCount  > 0) label += `\nB${byzCount}`;
    node.data('label', label);
  });

  if (!layer) return;

  const agentsByNode = new Map();
  simState.agents
    .filter(agent => agent.alive)
    .forEach(agent => {
      if (!agentsByNode.has(agent.pos)) agentsByNode.set(agent.pos, []);
      agentsByNode.get(agent.pos).push(agent);
    });

  agentsByNode.forEach((agents, nodeId) => {
    const node = cyRef.instance.getElementById(`n${nodeId}`);
    if (!node || node.empty()) return;

    const pos = node.renderedPosition();
    const orbit = agents.length === 1 ? 23 : Math.min(34, 19 + agents.length * 2);

    agents.forEach((agent, index) => {
      const angle = agents.length === 1
        ? -Math.PI / 2
        : (Math.PI * 2 * index / agents.length) - Math.PI / 2;
      const x = pos.x + Math.cos(angle) * orbit;
      const y = pos.y + Math.sin(angle) * orbit;
      const particle = document.createElement('div');
      const kind = agent.byzantine
        ? (agent.identified ? 'identified' : 'byz')
        : 'good';
      particle.className = [
        'agent-particle',
        kind,
        simState.activeAgentId === agent.id ? 'active' : '',
      ].filter(Boolean).join(' ');
      particle.style.transform = `translate(${x}px, ${y}px)`;
      particle.dataset.agentId = `A${agent.id}`;
      layer.appendChild(particle);
    });
  });
}

export function resetSimulation() {
  clearInterval(runRef.intervalId);
  runRef.intervalId = null;
  setSimState(null);
  if (cyRef.instance) {
    cyRef.instance.destroy();
    cyRef.instance = null;
  }
  logClear();
  $('edgeTable').innerHTML = '';
  $('agentList').innerHTML = '';
  $('agentLayer').innerHTML = '';
  ['sRound','sAlive','sLost','sByzFound','sEdgeSafe','sEdgeDanger','sEdgeExpired'].forEach(id => setStat(id, '-'));
  $('progressBar').style.width = '0%';
  $('runBtn').disabled  = true;
  $('runBtn').textContent = 'RUN SIMULATION';
  $('stepBtn').disabled = true;
  $('overlay').className = '';
}
