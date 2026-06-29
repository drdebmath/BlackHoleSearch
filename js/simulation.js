// Black Hole Search simulation engine.
//
// The simulator now keeps two levels of motion:
// 1. a DFS traversal plan over the graph, including physical backtracking; and

import { cyRef, runRef, simState, setSimState } from './state.js';
import { generateGraph } from './graph-generation.js';
import { initCy } from './cytoscape-setup.js';
import {
  $, setStat, logAdd, logClear, updateAgentChips,
  updateEdgeTable, showOverlay, updateFormula,
} from './ui.js';

export function buildGraph() {
  if (runRef.isRunning) {
    stopSimulationLoop();
  }
  $('runBtn').textContent = '▶ RUN SIMULATION';

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
  const edgeConfirmations = {};
  edges.forEach(e => {
    const s = +e.data.source.slice(1);
    const t = +e.data.target.slice(1);
    const key = edgeKey(s,t);
    edgeStatus[key] = 'unknown';
    edgeConfirmations[key] = new Set();
  });

  const state = {
    n, f, k, homebase, bhNode, agents, neighbors, ports, edges,
    edgeStatus, edgeConfirmations, know, comm, delta,
    round: 0,
    tick: 0,
    moves: 0,
    done: false,
    bhLocated: false,
    currentNode: homebase,
    visitedNodes: new Set([homebase]),
    nodeStatus: { [homebase]: { status: 'safe', round: 0 } },
    traversalOrder: [],
    traversalIndex: 0,
    currentOperation: null,
    activeAgentId: null,
    byzantineBlacklist: new Set(),
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
  setStat('sMoves', 0);
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

function findAgentPathToTarget(s, target) {
  const queue = [];
  const parent = new Map();
  const sourceAgent = new Map();
  const blockedNode = s.bhLocated ? s.bhNode : null;

  for (const agent of s.agents) {
    if (!agent.alive) continue;
    if (agent.pos === target) return { agentId: agent.id, path: [target] };
    if (!parent.has(agent.pos)) {
      parent.set(agent.pos, null);
      sourceAgent.set(agent.pos, agent.id);
      queue.push(agent.pos);
    }
  }

  while (queue.length) {
    const cur = queue.shift();
    for (const next of s.neighbors[cur] || []) {
      if (parent.has(next)) continue;
      if (blockedNode !== null && next === blockedNode) continue;
      const key = edgeKey(cur, next);
      if (s.edgeStatus[key] === 'dangerous') continue;
      if (s.edgeStatus[key] === 'unknown') continue; // Don't use unconfirmed edges
      parent.set(next, cur);
      sourceAgent.set(next, sourceAgent.get(cur));
      if (next === target) {
        const path = [];
        let node = next;
        while (node !== null) {
          path.unshift(node);
          node = parent.get(node);
        }
        return { agentId: sourceAgent.get(next), path };
      }
      queue.push(next);
    }
  }

  return null;
}

function buildMoveActionsForPath(agentId, path) {
  const actions = [];
  for (let i = 0; i < path.length - 1; i++) {
    actions.push({ type: 'move', agentId, from: path[i], to: path[i + 1] });
  }
  return actions;
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

function advanceRound(s) {
    s.round++;
    setStat('sRound', s.round);
}

export function manualSpoofEdge(fromStatus, toStatus) {
    if (!simState) return;
    const s = simState;
    const edges = Object.keys(s.edgeStatus).filter(key => s.edgeStatus[key] === fromStatus);
    if (edges.length === 0) {
        logAdd(s.round, 'system', `Manual spoof failed: No edges with status '${fromStatus}'.`);
        return;
    }

    const edgeToSpoof = edges[Math.floor(Math.random() * edges.length)];
    s.edgeStatus[edgeToSpoof] = toStatus;

    const [from, to] = edgeToSpoof.split('-').map(Number);
    const cyEdge = getCyEdge(from, to);
    cyEdge.removeClass(fromStatus).addClass(toStatus);

    logAdd(s.round, 'byz', `MANUAL SPOOF: Edge (${edgeToSpoof}) changed from ${fromStatus.toUpperCase()} to ${toStatus.toUpperCase()}.`);
    refreshDisplay();
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

  advanceRound(s);

  const op = s.currentOperation;
  const action = op.actions[op.index++];
  if (!action) {
    // This can happen if an operation completes but a new one (like a cascade) is prepared.
    // We re-evaluate the operation completion logic.
    if (op.index >= op.actions.length) {
      completeOperation(op);
    }
    return; // Let the next tick handle the new state.
  }
  s.tick++;
  s.activeAgentId = action.agentId ?? null;
  highlightEdge(action.from ?? op.step.from, action.to ?? op.step.to);

  if (action.type === 'move') {
    moveAgent(action.agentId, action.from ?? op.step.from, action.to ?? op.step.to);
  } else if (action.type === 'lose') {
    loseAgentToBlackHole(action.agentId, action.from ?? op.step.from, action.to ?? op.step.to);
  } else if (action.type === 'noop') {
    logAdd(s.round, 'info', 'No DFS movement was required this round.');
  }

  if (op.index >= op.actions.length) {
    completeOperation(op);
    // completeOperation may have set up a new phase, so we don't nullify it here.
    if (op.probe && op.probe.phase === 'complete') {
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

  if (step.kind === 'move') {
    return prepareMoveOperation(s, step);
  } else { // 'probe'
    return prepareProbeOperation(s, step);
  }
}

function prepareMoveOperation(s, step) {
  const actions = [];
  const agentToMove = s.agents.find(a => a.alive && a.pos === step.from);

  if (agentToMove) {
    actions.push({ type: 'move', agentId: agentToMove.id, from: step.from, to: step.to });
  } else {
    const relocation = findAgentPathToTarget(s, step.from);
    if (relocation && relocation.path.length > 1) {
      actions.push(...buildMoveActionsForPath(relocation.agentId, relocation.path));
      actions.push({ type: 'move', agentId: relocation.agentId, from: step.from, to: step.to });
    } else if (relocation) {
      actions.push({ type: 'move', agentId: relocation.agentId, from: step.from, to: step.to });
    } else {
      logAdd(s.round, 'warn', `No agent available to move from ${step.from} to ${step.to}. Skipping.`);
      actions.push({ type: 'noop' });
    }
  }
  return { step, actions, index: 0 };
}

function prepareProbeOperation(s, step) {
  const { from, to } = step;
  const key = edgeKey(from, to);
  if (s.edgeStatus[key] !== 'unknown') {
    logAdd(s.round, 'info', `Skipping probe on (${from}->${to}); status is already '${s.edgeStatus[key]}'.`);
    return { step, actions: [{ type: 'noop' }], index: 0 };
  }

  const availableAgents = s.agents.filter(a => a.alive && !s.byzantineBlacklist.has(a.id));
  const agentsAtSource = availableAgents.filter(a => a.pos === from);

  // Initial Wave: f+1 agents
  const probeGroupSize = s.f + 1;
  const probeGroup = agentsAtSource.slice(0, probeGroupSize);

  if (probeGroup.length < probeGroupSize) {
    logAdd(s.round, 'warn', `CCP on (${from}->${to}) delayed: need ${probeGroupSize} agents at ${from}, found ${probeGroup.length}.`);
    const relocation = findAndDispatchAgent(s, from, availableAgents);
    if (relocation) {
      return { step, actions: relocation.actions, index: 0 };
    }
    return { step, actions: [{ type: 'noop' }], index: 0 }; // Wait for agents to arrive
  }

  const actions = [];
  const isBHEdge = to === s.bhNode;

  probeGroup.forEach(agent => {
    if (isBHEdge) {
      if (agent.byzantine) {
        // Byzantine agent is immune, returns and can lie.
        logAdd(s.round, 'byz', `Byzantine A${agent.id} probes BH edge, survives.`);
        actions.push({ type: 'move', agentId: agent.id, from, to });
        actions.push({ type: 'move', agentId: agent.id, to, from }); // Immediately returns
      } else {
        // Good agent is lost.
        actions.push({ type: 'lose', agentId: agent.id, from, to });
      }
    } else {
      // Safe edge, everyone returns.
      actions.push({ type: 'move', agentId: agent.id, from, to });
      actions.push({ type: 'move', agentId: agent.id, to, from });
    }
  });

  return {
    step,
    actions,
    index: 0,
    probe: {
      key,
      phase: 'initial_wave',
      group: probeGroup.map(a => a.id),
      lost: new Set(),
      returned: new Set(),
    }
  };
}

function completeOperation(op) {
  const s = simState;
  if (op.step.kind === 'move') {
    s.currentNode = op.step.to;
    markCurrentNode(op.step.to);
  } else if (op.step.kind === 'probe') {
    // If the operation was just to move an agent for a probe, don't evaluate yet.
    if (op.probe) {
      evaluateProbe(op);
    } else {
      s.currentOperation = null; // It was just a move, now we can re-attempt the probe
    }
  }
}

function evaluateProbe(op) {
  const s = simState;
  const { from, to } = op.step;
  const key = edgeKey(from, to);
  const cyEdge = getCyEdge(from, to);
  cyEdge.removeClass('probing');

  // Update probe results from the actions just executed
  op.actions.forEach(action => {
    if (action.type === 'lose') op.probe.lost.add(action.agentId);
    if (action.type === 'move' && action.to === from) op.probe.returned.add(action.agentId);
  });

  const numLost = op.probe.lost.size;
  const numReturned = op.probe.returned.size;

  logAdd(s.round, 'system', `CCP results for (${from}->${to}): ${numReturned} returned, ${numLost} lost.`);

  // Consensus checks
  if (numReturned >= s.f + 1) { // Includes all f+1 from initial wave
    s.edgeStatus[key] = 'safe';
    cyEdge.addClass('safe');
    s.visitedNodes.add(to);
    cyRef.instance.getElementById(`n${to}`).addClass('safe');
    logAdd(s.round, 'safe', `Edge (${from}->${to}) certified SAFE. (${numReturned} agents returned).`);
    op.probe.phase = 'complete';

    // Blacklist any agent who was in the probe group but was reported lost.
    // This requires a more complex communication model where agents report who they saw.
    // For now, we assume perfect knowledge of who was lost.

  } else if (numLost >= s.f + 1) {
    s.edgeStatus[key] = 'dangerous';
    s.bhLocated = true;
    cyEdge.addClass('dangerous');
    cyRef.instance.getElementById(`n${to}`).removeClass('blackhole').addClass('revealed');
    logAdd(s.round, 'danger', `Edge (${from}->${to}) certified DANGEROUS. (${numLost} agents lost).`);
    op.probe.phase = 'complete';

    // Blacklist any agent who returned from this now-confirmed dangerous edge.
    op.probe.returned.forEach(agentId => {
      if (!s.byzantineBlacklist.has(agentId)) {
        s.byzantineBlacklist.add(agentId);
        const agent = s.agents.find(a => a.id === agentId);
        if (agent) agent.identified = true;
        logAdd(s.round, 'byz', `Agent A${agentId} returned from a DANGEROUS edge and is now blacklisted as Byzantine.`);
      }
    });
  } else {
    // INCONCLUSIVE: This implies Byzantine activity. Trigger the cascading wave.
    logAdd(s.round, 'warn', `CCP on (${from}->${to}) is INCONCLUSIVE. Starting cascading wave.`);
    op.probe.phase = 'cascading';

    const sentAgents = new Set([...op.probe.returned, ...op.probe.lost]);
    const remainingAgents = s.agents.filter(a => a.alive && !s.byzantineBlacklist.has(a.id) && !sentAgents.has(a.id));

    if (remainingAgents.length === 0) {
      logAdd(s.round, 'danger', `CCP FAILED on (${from}->${to}): No more agents available to break tie.`);
      op.probe.phase = 'complete'; // Mark as done to avoid getting stuck
      return;
    }

    // Find the next agent to send. If not at the source, dispatch them.
    let nextAgent = remainingAgents.find(a => a.pos === from);
    if (!nextAgent) {
      const dispatch = findAndDispatchAgent(s, from, remainingAgents);
      if (dispatch) {
        logAdd(s.round, 'system', `Dispatching A${dispatch.agentId} to ${from} for cascading probe.`);
        op.actions = dispatch.actions;
        op.index = 0;
        return; // Let the move actions execute
      } else {
        logAdd(s.round, 'danger', `CCP FAILED on (${from}->${to}): Cannot route an agent to the probe site.`);
        op.probe.phase = 'complete';
        return;
      }
    } else {
      // Agent is ready at the source node, prepare the single-agent probe action.
      logAdd(s.round, 'system', `Cascading wave: sending A${nextAgent.id} through (${from}->${to}).`);
      const isBHEdge = to === s.bhNode;
      const actions = [];
      if (isBHEdge) {
        if (nextAgent.byzantine) {
          actions.push({ type: 'move', agentId: nextAgent.id, from, to });
          actions.push({ type: 'move', agentId: nextAgent.id, to, from });
        } else {
          actions.push({ type: 'lose', agentId: nextAgent.id, from, to });
        }
      } else {
        actions.push({ type: 'move', agentId: nextAgent.id, from, to });
        actions.push({ type: 'move', agentId: nextAgent.id, to, from });
      }
      op.actions = actions;
      op.index = 0;
    }
  }
}

function findAndDispatchAgent(s, targetNode, agentPool) {
  const relocation = findAgentPathToTarget(s, targetNode, agentPool);
  if (relocation) {
    return { agentId: relocation.agentId, actions: buildMoveActionsForPath(relocation.agentId, relocation.path) };
  } else {
    return null;
  }
}

function moveAgent(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;
  s.moves++;
  agent.pos = to;
  s.currentNode = to;
  markCurrentNode(to);
  logAdd(s.round, agent.byzantine ? 'byz' : 'info', `A${agent.id} moves ${from}->${to} (${agent.byzantine ? 'Byzantine' : 'good'}).`);
}

function loseAgentToBlackHole(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;
  agent.alive = false;
  agent.status = 'dead';
  agent.pos = to;
  s.lostInBH++;
  s.currentNode = from; // The "team" retreats to the safe side
  markCurrentNode(from);
  logAdd(s.round, 'danger', `A${agent.id} enters ${from}->${to} and is lost in the black hole (${s.lostInBH}/${s.f + 1}).`);

  if (s.nodeStatus && s.nodeStatus[to] && s.nodeStatus[to].status === 'safe') {
    s.nodeStatus[to] = { status: 'dangerous', round: s.round };
    cyRef.instance.getElementById(`n${to}`).removeClass('safe').addClass('trap');
    logAdd(s.round, 'danger', `NODE ${to} WAS A TRAP: previously marked safe but an agent was lost here.`);
  }
}

function shouldFinish(s) {
  if (s.traversalIndex >= s.traversalOrder.length) {
    return true;
  }
  if (s.know === 'known' && s.bhLocated) return true;
  return false;
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
  setStat('sByzFound', s.byzantineBlacklist.size);
  setStat('sMoves', s.moves);
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
  if (runRef.isRunning) {
    stopSimulationLoop();
  }

  cyRef.instance.edges().removeClass('probing');
  refreshDisplay();
  $('progressBar').style.width = '100%';
  $('runBtn').textContent = '▶ RUN SIMULATION';

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
    if (goodCount > 0) label += `
G${goodCount}`;
    if (byzCount  > 0) label += `
B${byzCount}`;
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
  if (runRef.isRunning) {
    stopSimulationLoop();
  }
  setSimState(null);
  if (cyRef.instance) {
    cyRef.instance.destroy();
    cyRef.instance = null;
  }
  logClear();
  $('edgeTable').innerHTML = '';
  $('agentList').innerHTML = '';
  $('agentLayer').innerHTML = '';
  ['sRound','sMoves','sAlive','sLost','sByzFound','sEdgeSafe','sEdgeDanger'].forEach(id => setStat(id, '-'));
  $('progressBar').style.width = '0%';
  $('runBtn').disabled  = true;
  $('runBtn').textContent = '▶ RUN SIMULATION';
  $('stepBtn').disabled = true;
  $('overlay').className = '';
}
