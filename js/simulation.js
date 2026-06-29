// Black Hole Search simulation engine.
//
// The simulator keeps two levels of motion:
// 1. a DFS traversal plan over the graph, including physical backtracking; and
// 2. CCP substeps that probe unknown ports with f+1 thresholds.

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
  const edgeEvidence = {};
  edges.forEach(e => {
    const s = +e.data.source.slice(1);
    const t = +e.data.target.slice(1);
    const key = edgeKey(s, t);
    edgeStatus[key] = 'unknown';
    edgeEvidence[key] = {
      departed: new Set(),
      returned: new Set(),
      missing: new Set(),
    };
  });

  const state = {
    n, f, k, homebase, bhNode, agents, neighbors, ports, edges,
    edgeStatus, edgeEvidence, know, comm, delta,
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
  };
  state.traversalOrder = know === 'known'
    ? buildKnownDFSPlan(state)
    : buildUnknownDFSPlan(state);
  setSimState(state);

  cy.getElementById('n' + homebase).addClass('homebase');
  cy.getElementById('n' + bhNode).addClass('blackhole');

  updateAgentChips();
  updateEdgeTable();
  renderAgentsOnGraph();
  setStat('sRound', 0);
  setStat('sAlive', agents.filter(a => a.alive).length);
  setStat('sLost', 0);
  setStat('sByzFound', 0);
  setStat('sEdgeSafe', 0);
  setStat('sEdgeDanger', 0);
  $('progressBar').style.width = '0%';

  logClear();
  logAdd(0, 'system', `Graph built: ${n} nodes, ${edges.length} edges, Delta=${delta}`);
  logAdd(0, 'system', `Black Hole at node ${bhNode} (hidden from agents)`);
  logAdd(0, 'system', `Team: k=${k} agents, f=${f} Byzantine`);
  logAdd(0, 'system', `Algorithm: ${know === 'known' ? 'WhiteboardMap/ProbeMap' : 'WhiteboardWithoutMap/ProbeWithoutMap'}`);
  logAdd(0, 'info', `CCP thresholds: ${f + 1} distinct return(s) => SAFE, ${f + 1} distinct non-return(s) => DANGEROUS.`);
  logAdd(0, 'info', `Homebase: node ${homebase}. DFS traversal plan ready.`);

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
  const plan = [];

  const dfs = (u) => {
    for (const v of (ports[u] || [])) {
      if (visited.has(v)) continue;
      visited.add(v);
      plan.push({ kind: 'probe', from: u, to: v, classify: true, label: 'DFS probe' });
      dfs(v);
      plan.push({ kind: 'move', from: v, to: u, classify: false, label: 'DFS backtrack' });
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

export function stepSimulation() {
  if (!simState || simState.done) return;

  const s = simState;
  if (!s.currentOperation) {
    if (shouldFinish(s)) {
      finishSim(finishWasSuccessful(s));
      return;
    }
    s.currentOperation = prepareOperation(s, s.traversalOrder[s.traversalIndex]);
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
  highlightEdge(action.from ?? op.step.from, action.to ?? op.step.to);

  if (action.type === 'move') {
    moveAgent(action.agentId, action.from ?? op.step.from, action.to ?? op.step.to);
  } else if (action.type === 'lose') {
    loseAgentToBlackHole(action.agentId, action.from ?? op.step.from, action.to ?? op.step.to);
  } else if (action.type === 'refuseReturn') {
    refuseReturn(action.agentId, action.from ?? op.step.from, action.to ?? op.step.to);
  } else if (action.type === 'markMoveOnly') {
    s.currentNode = op.step.to;
    markCurrentNode(op.step.to);
  } else if (action.type === 'noop') {
    logAdd(s.round, 'info', 'No DFS movement was required this round.');
  }

  if (op.index >= op.actions.length) {
    const outcome = completeOperation(op);
    if (outcome === 'failed') {
      refreshDisplay();
      finishSim(false);
      return;
    }
    if (outcome === 'complete') {
      s.currentOperation = null;
      s.traversalIndex++;
    }
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

function prepareOperation(s, step) {
  if (!step) {
    return { step: { from: s.currentNode, to: s.currentNode }, actions: [{ type: 'noop' }], index: 0 };
  }

  if (step.kind === 'probe') return prepareProbeOperation(s, step);
  return prepareMoveOperation(s, step);
}

function prepareMoveOperation(s, step) {
  const key = edgeKey(step.from, step.to);
  const actions = [];

  if (s.edgeStatus[key] === 'dangerous') {
    logAdd(s.round, 'danger', `Golden rule: refusing to traverse dangerous port (${step.from}->${step.to}).`);
    actions.push({ type: 'noop' });
    return { step, actions, index: 0 };
  }

  const movers = s.agents.filter(a => a.alive && a.pos === step.from);
  movers.forEach(agent => actions.push({ type: 'move', agentId: agent.id, from: step.from, to: step.to }));
  if (movers.length === 0) {
    logAdd(s.round, 'warn', `No live agents at node ${step.from}; advancing logical DFS cursor to ${step.to}.`);
    actions.push({ type: 'markMoveOnly' });
  }

  return { step, actions, index: 0 };
}

function prepareProbeOperation(s, step) {
  const { from, to } = step;
  const key = edgeKey(from, to);

  if (s.edgeStatus[key] === 'dangerous') {
    logAdd(s.round, 'danger', `Golden rule: port (${from}->${to}) is dangerous and will not be probed again.`);
    return { step, actions: [{ type: 'noop' }], index: 0 };
  }

  if (s.edgeStatus[key] === 'safe') {
    logAdd(s.round, 'safe', `Port (${from}->${to}) is already SAFE; moving across it.`);
    return prepareMoveOperation(s, step);
  }

  if (s.bhLocated && to === s.bhNode) {
    markPortDangerous(from, to, `Known black-hole boundary (${from}->${to}) marked DANGEROUS without another probe.`);
    return { step, actions: [{ type: 'noop' }], index: 0 };
  }

  const threshold = s.f + 1;
  const candidates = agentsAvailableForProbe(s, from);
  if (candidates.length < threshold) {
    logAdd(s.round, 'danger', `CCP cannot start on (${from}->${to}): need ${threshold} available agents at node ${from}, found ${candidates.length}.`);
    return { step, actions: [{ type: 'noop' }], index: 0, failed: true };
  }

  const probe = {
    key,
    phase: 'initial',
    sent: new Set(),
    returned: new Set(),
    missing: new Set(),
    limit: Math.min(2 * s.f + 1, candidates.length),
  };
  const scoutGroup = candidates.slice(0, threshold);
  const actions = scoutGroup.flatMap(agent => buildProbeActionsForAgent(s, agent, from, to, probe));

  logAdd(s.round, 'system', `CCP starts on (${from}->${to}): initial scout group A${scoutGroup.map(a => a.id).join(', A')}.`);

  return { step, actions, index: 0, probe };
}

function agentsAvailableForProbe(s, nodeId) {
  return s.agents.filter(agent =>
    agent.alive &&
    agent.pos === nodeId &&
    !agent.identified &&
    !s.identifiedByzantine.has(agent.id)
  );
}

function buildProbeActionsForAgent(s, agent, from, to, probe) {
  probe.sent.add(agent.id);
  const isBlackHolePort = to === s.bhNode;

  if (isBlackHolePort) {
    if (agent.byzantine) {
      return [
        { type: 'move', agentId: agent.id, from, to },
        { type: 'move', agentId: agent.id, from: to, to: from, probeResult: 'return' },
      ];
    }
    return [{ type: 'lose', agentId: agent.id, from, to, probeResult: 'missing' }];
  }

  if (agent.byzantine) {
    return [{ type: 'refuseReturn', agentId: agent.id, from, to, probeResult: 'missing' }];
  }

  return [
    { type: 'move', agentId: agent.id, from, to },
    { type: 'move', agentId: agent.id, from: to, to: from, probeResult: 'return' },
  ];
}

function recordProbeEvidence(op) {
  const s = simState;
  const evidence = s.edgeEvidence[op.probe.key];

  op.actions.forEach(action => {
    if (!action.probeResult) return;
    op.probe.sent.add(action.agentId);
    evidence.departed.add(action.agentId);

    if (action.probeResult === 'return') {
      op.probe.returned.add(action.agentId);
      evidence.returned.add(action.agentId);
    } else if (action.probeResult === 'missing') {
      op.probe.missing.add(action.agentId);
      evidence.missing.add(action.agentId);
    }
  });
}

function scheduleSafeAdvance(op) {
  const s = simState;
  const { from, to } = op.step;
  const movers = s.agents.filter(agent => agent.alive && agent.pos === from);
  const actions = movers.map(agent => ({ type: 'move', agentId: agent.id, from, to }));

  if (actions.length === 0) {
    s.currentNode = to;
    markCurrentNode(to);
    return 'complete';
  }

  op.probe.phase = 'advance-safe';
  op.actions = actions;
  op.index = 0;
  logAdd(s.round, 'safe', `Port (${from}->${to}) is SAFE; surviving group advances.`);
  return 'continue';
}

function scheduleSoloProbe(op) {
  const s = simState;
  const { from, to } = op.step;

  if (op.probe.sent.size >= op.probe.limit) {
    logAdd(s.round, 'danger', `CCP exhausted ${op.probe.limit} probe agent(s) on (${from}->${to}) without reaching a threshold.`);
    return 'failed';
  }

  const nextAgent = agentsAvailableForProbe(s, from).find(agent => !op.probe.sent.has(agent.id));
  if (!nextAgent) {
    logAdd(s.round, 'danger', `CCP cannot continue on (${from}->${to}): no unused non-blacklisted agent remains at node ${from}.`);
    return 'failed';
  }

  op.probe.phase = 'solo';
  op.actions = buildProbeActionsForAgent(s, nextAgent, from, to, op.probe);
  op.index = 0;
  logAdd(s.round, 'system', `Solo CCP probe: A${nextAgent.id} tests (${from}->${to}).`);
  return 'continue';
}

function identifyByzantine(agentId, reason) {
  const s = simState;
  if (s.identifiedByzantine.has(agentId)) return;

  const agent = s.agents.find(a => a.id === agentId);
  s.identifiedByzantine.add(agentId);
  if (agent) agent.identified = true;
  logAdd(s.round, 'byz', `A${agentId} identified as Byzantine: ${reason}`);
}

function markPortDangerous(from, to, message) {
  const s = simState;
  const key = edgeKey(from, to);
  s.edgeStatus[key] = 'dangerous';
  const cyEdge = getCyEdge(from, to);
  cyEdge.addClass('dangerous').removeClass('probing');
  cyRef.instance.getElementById(`n${to}`).removeClass('blackhole').addClass('revealed');
  logAdd(s.round, 'danger', message);
}

function moveAgent(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;
  agent.pos = to;
  s.currentNode = to;
  markCurrentNode(to);
  logAdd(s.round, agent.byzantine ? 'byz' : 'info', `A${agent.id} moves ${from}->${to} (${agent.byzantine ? 'Byzantine' : 'good'}).`);
}

function refuseReturn(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;
  agent.pos = to;
  s.currentNode = from;
  markCurrentNode(from);
  logAdd(s.round, 'warn', `A${agent.id} leaves ${from}->${to} and does not return to the group.`);
}

function loseAgentToBlackHole(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;
  agent.alive = false;
  agent.status = 'dead';
  agent.pos = to;
  s.lostInBH++;
  s.currentNode = from;
  markCurrentNode(from);
  logAdd(s.round, 'danger', `A${agent.id} enters ${from}->${to} and is lost in the black hole (${s.lostInBH}/${s.f + 1}).`);
}

function completeOperation(op) {
  const s = simState;
  if (op.failed) return 'failed';

  const { from, to, classify, label } = op.step;
  const key = edgeKey(from, to);
  const cyEdge = getCyEdge(from, to);

  if (op.step.kind === 'move') {
    s.currentNode = to;
    markCurrentNode(to);
    cyEdge.removeClass('probing');
    return 'complete';
  }

  if (!op.probe) {
    cyEdge.removeClass('probing');
    return op.failed ? 'failed' : 'complete';
  }

  if (op.probe.phase === 'advance-safe') {
    s.currentNode = to;
    markCurrentNode(to);
    cyEdge.removeClass('probing');
    return 'complete';
  }

  recordProbeEvidence(op);

  const returned = op.probe.returned.size;
  const missing = op.probe.missing.size;
  const threshold = s.f + 1;

  logAdd(s.round, 'system', `CCP evidence on (${from}->${to}): ${returned}/${threshold} returned, ${missing}/${threshold} did not return.`);

  if (returned >= threshold) {
    if (classify && s.edgeStatus[key] === 'unknown') {
      s.edgeStatus[key] = 'safe';
      s.safeNodes.add(from);
      s.safeNodes.add(to);
      s.visitedNodes.add(to);
      cyEdge.addClass('safe');
      cyRef.instance.getElementById(`n${to}`).addClass('safe');
      cyRef.instance.getElementById(`n${from}`).addClass('safe');
      logAdd(s.round, 'safe', `${label}: port (${from}->${to}) certified SAFE after ${returned} distinct return(s).`);
    }

    op.probe.missing.forEach(agentId => {
      identifyByzantine(agentId, `it failed to return from (${from}->${to}), which was later certified SAFE.`);
    });

    return scheduleSafeAdvance(op);
  }

  if (missing >= threshold) {
    s.found = true;
    s.bhLocated = true;
    s.currentNode = from;
    markPortDangerous(from, to, `CCP on port (${from}->${to}) certified DANGEROUS after ${missing} distinct non-return(s).`);

    op.probe.returned.forEach(agentId => {
      identifyByzantine(agentId, `it returned from (${from}->${to}) after that port was certified DANGEROUS.`);
    });

    return 'complete';
  }

  return scheduleSoloProbe(op);
}

function shouldFinish(s) {
  if (s.currentOperation) return false;
  if (s.know === 'unknown') return allEdgesClassified(s) || s.traversalIndex >= s.traversalOrder.length;
  return s.traversalIndex >= s.traversalOrder.length || s.bhLocated;
}

function finishWasSuccessful(s) {
  if (s.know === 'unknown') return s.bhLocated && allEdgesClassified(s);
  return s.bhLocated;
}

function allEdgesClassified(s) {
  return Object.values(s.edgeStatus).every(status => status !== 'unknown');
}

function refreshDisplay() {
  const s = simState;
  const edgeSafe   = Object.values(s.edgeStatus).filter(v => v === 'safe').length;
  const edgeDanger = Object.values(s.edgeStatus).filter(v => v === 'dangerous').length;
  setStat('sEdgeSafe', edgeSafe);
  setStat('sEdgeDanger', edgeDanger);
  setStat('sAlive', s.agents.filter(a => a.alive).length);
  setStat('sLost', s.lostInBH);
  setStat('sByzFound', s.identifiedByzantine.size);
  $('progressBar').style.width = progressPercent(s) + '%';
  updateAgentChips();
  updateEdgeTable();
  renderAgentsOnGraph();
}

function progressPercent(s) {
  if (s.know === 'unknown') {
    const classified = Object.values(s.edgeStatus).filter(status => status !== 'unknown').length;
    return Math.min(100, classified / s.edges.length * 100);
  }

  if (s.traversalOrder.length === 0) return 100;
  const opFraction = s.currentOperation
    ? s.currentOperation.index / s.currentOperation.actions.length
    : 0;
  return Math.min(100, (s.traversalIndex + opFraction) / s.traversalOrder.length * 100);
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
    const modeNote = s.know === 'unknown'
      ? `All ${s.edges.length} edges explored/classified.`
      : 'DFS stopped after locating the black hole.';
    logAdd(s.round, 'system', `BH LOCATED at node ${s.bhNode}`);
    logAdd(s.round, 'safe', `${survivors} good agent(s) survived. ${s.lostInBH} lost in BH. ${modeNote}`);
    showOverlay('success', 'BLACK HOLE LOCATED',
      `Node ${s.bhNode} identified in ${s.round} rounds - ${survivors} survivors`);
  } else {
    const unknownLeft = Object.values(s.edgeStatus).filter(v => v === 'unknown').length;
    logAdd(s.round, 'danger', 'BHS FAILED');
    showOverlay('failure', 'MISSION FAILED',
      unknownLeft > 0 ? `${unknownLeft} edge(s) remained unexplored` : `All good agents eliminated by round ${s.round}`);
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
  ['sRound','sAlive','sLost','sByzFound','sEdgeSafe','sEdgeDanger'].forEach(id => setStat(id, '-'));
  $('progressBar').style.width = '0%';
  $('runBtn').disabled  = true;
  $('runBtn').textContent = 'RUN SIMULATION';
  $('stepBtn').disabled = true;
  $('overlay').className = '';
}
