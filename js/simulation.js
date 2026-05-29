// Black Hole Search simulation engine.
//
// The simulator now keeps two levels of motion:
// 1. a DFS traversal plan over the graph, including physical backtracking; and
// 2. per-agent substeps, so only one agent moves or is lost per visual step.

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
  const simMode = $('simMode') ? $('simMode').value : 'find-bbh';
  const bbhAdversary = $('bbhAdversary') ? $('bbhAdversary').checked : true;
  const adversaryView = $('adversaryView') ? $('adversaryView').checked : false;
  const bbhControlMode = $('bbhControlMode') ? $('bbhControlMode').value : 'manual';
  const bbhActive = $('bbhManualActive') ? $('bbhManualActive').checked : false;
  const bbhControlValue = $('bbhEveryN') ? +$('bbhEveryN').value : 5;
  const bbhAgentThreshold = $('bbhAgentThreshold') ? +$('bbhAgentThreshold').value : 3;

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

  // Assign roles to the first few good agents required by the path algorithm.
  const roles = ['L', 'I1', 'I2', 'F', 'F1', 'F2'];
  let goodIdx = 0;
  for (const a of agents) {
    if (!a.byzantine) {
      if (goodIdx < roles.length) a.role = roles[goodIdx++];
      else a.role = a.role || null;
    }
  }
  // Reserve one agent as the permanent Marker at home if available
  const marker = agents.slice().reverse().find(a => !a.byzantine);
  if (marker) {
    marker.role = 'Marker';
    marker.roleType = 'Marker';
    marker.settled = true;
    marker.pos = homebase;
  }

  agents.forEach(a => {
    if (!a.byzantine && !a.roleType) {
      a.roleType = a.role === 'L' ? 'Explorer' : 'Marker';
    }
  });

  const ports = {};
  for (let i = 0; i < n; i++) ports[i] = [...new Set(neighbors[i])].sort((a, b) => a - b);

  const edgeStatus = {};
  edges.forEach(e => {
    const s = +e.data.source.slice(1);
    const t = +e.data.target.slice(1);
    edgeStatus[edgeKey(s, t)] = 'unknown';
  });

  const state = {
    n, f, k, homebase, bhNode, agents, neighbors, ports, edges,
    topo,
    edgeStatus, know, comm, delta,
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
    mode: simMode,
    bbhAdversary,
    bbhControlMode,
    bbhControlValue,
    bbhAgentThreshold,
    bbhActive: bbhControlMode === 'manual' ? bbhActive : false,
    adversaryView,
    bbhActivations: 0,
    anchorsPlaced: 0,
    unanchoredNeighbors: 0,
    currentPhase: 0,
    maxDistance: 1,
    component: 'C1',
    roundsSurvived: 0,
    safeCoverage: 0,
    agentsLost: 0,
    cycleVisited: new Set([homebase]),
    perpTargetNodes: new Set(),
    pendingReturn: null,
    lastCautiousProbe: null,
    lastPhaseTraversalIndex: -1,
  };
  state.traversalOrder = know === 'known'
    ? buildKnownDFSPlan(state)
    : buildUnknownDFSPlan(state);
  setSimState(state);

  cy.getElementById('n' + homebase).addClass('homebase');
  const bhNodeElement = cy.getElementById('n' + bhNode);
  bhNodeElement.addClass('true-blackhole');
  if (adversaryView) bhNodeElement.addClass('blackhole');

  updateAgentChips();
  updateEdgeTable();
  renderAgentsOnGraph();
  refreshDisplay();
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

function isConfirmedSafeNode(s, nodeId) {
  return nodeId === s.homebase || s.safeNodes.has(nodeId);
}

function findSafeBacktrackNeighbor(s, nodeId) {
  for (const neighbor of (s.neighbors[nodeId] || [])) {
    if (isConfirmedSafeNode(s, neighbor)) return neighbor;
  }
  return null;
}

export function stepSimulation() {
  if (!simState || simState.done) return;

  const s = simState;
  updateBBHSchedule(s, s.round + 1);
  // Phase increment: when returning to home with no pending operation AND traversal has progressed
  if (s.currentNode === s.homebase && !s.currentOperation && s.traversalIndex > s.lastPhaseTraversalIndex) {
    s.currentPhase = (s.currentPhase || 0) + 1;
    s.maxDistance = Math.pow(2, s.currentPhase);
    s.lastPhaseTraversalIndex = s.traversalIndex;
    logAdd(s.round, 'info', `Phase ${s.currentPhase} start — Max Distance ${s.maxDistance}.`);
  }
  // Check for expired expected returns and trigger cautious probing if needed.
  if (s.pendingReturn && !s.pendingReturn.handled && s.round > s.pendingReturn.expiryRound) {
    startCautiousProbing(s.pendingReturn.from, s.pendingReturn.to);
    s.pendingReturn.handled = true;
  }
  if (!s.currentOperation) {
    if (s.traversalIndex >= s.traversalOrder.length) {
      s.traversalIndex = 0;
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
  s.roundsSurvived = s.round;
  s.activeAgentId = action.agentId ?? null;
  setStat('sRound', s.round);
  const actFrom = action.from ?? op.step.from;
  const actTo   = action.to   ?? op.step.to;
  highlightEdge(actFrom, actTo);

  if (action.type === 'move') {
    moveAgent(action.agentId, actFrom, actTo);
  } else if (action.type === 'enterBH') {
    handleEnterBH(action.agentId, actFrom, actTo);
  } else if (action.type === 'bulkMove') {
    // Move all agents in one round
    action.agentIds.forEach(id => moveAgent(id, actFrom, actTo));
  } else if (action.type === 'markEdgeSafe') {
    // Mark edge safe after explorers returned
    const k = edgeKey(action.from, action.to);
    if (s.edgeStatus[k] === 'unknown') {
      s.edgeStatus[k] = 'safe';
      cyRef.instance.getElementById(`n${action.to}`).addClass('safe');
      cyRef.instance.getElementById(`n${action.from}`).addClass('safe');
      getCyEdge(action.from, action.to).addClass('safe');
      s.safeNodes.add(action.from);
      s.safeNodes.add(action.to);
      logAdd(s.round, 'safe', `Explore procedure certified edge (${action.from}->${action.to}) SAFE.`);
    }
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
    s.traversalIndex++;
  }

  refreshDisplay();

  if (s.agents.filter(a => a.alive && !a.byzantine).length === 0) {
    logAdd(s.round, 'danger', 'ALL GOOD AGENTS ELIMINATED - BHS FAILED');
    finishSim(false);
    return;
  }

}

function handleEnterBH(agentId, from, to) {
  const s = simState;
  // Decide whether BBH activates this visit.
  if (bbhShouldActivate(s, from, to, agentId)) {
    loseAgentToBlackHole(agentId, from, to);
  } else {
    discoverAgentOnBH(agentId, from, to);
  }
}

function startCautiousProbing(from, to) {
  const s = simState;
  const f1 = s.agents.find(a => a.role === 'F1' && a.alive && a.pos === from);
  const f2 = s.agents.find(a => a.role === 'F2' && a.alive && a.pos === from);
  if (!f1 || !f2) return;
  // Build a cautious probe operation: F1 steps to `to` and returns (or dies).
  const actions = [];
  if (to === s.bhNode && !s.bhLocated) actions.push({ type: 'enterBH', agentId: f1.id, from, to });
  else actions.push({ type: 'move', agentId: f1.id, from, to });
  // schedule return if F1 did not die and not settled on BH
  actions.push({ type: 'move', agentId: f1.id, from: to, to: from });

  s.currentOperation = { step: { from, to, label: 'CAUTIOUS PROBE' }, actions, index: 0, cautiousProbe: true };
  s.lastCautiousProbe = { f1Id: f1.id, f2Id: f2.id, from, to };
  // clear pendingReturn record
  s.pendingReturn = null;
  logAdd(s.round, 'warn', `Cautious probing started by F1/A${f1.id} (with F2/A${f2.id} waiting).`);
}

function bbhShouldActivate(s, from, to, agentId) {
  if (!s.bbhAdversary) return true;
  if (s.bbhControlMode === 'manual') {
    if (s.bbhActive) s.bbhActivations++;
    return s.bbhActive;
  }
  if (s.bbhControlMode === 'every' || s.bbhControlMode === 'agents') {
    if (s.bbhActive) s.bbhActivations++;
    return s.bbhActive;
  }
  const willActivate = Math.random() > 0.35;
  if (willActivate) s.bbhActivations++;
  return willActivate;
}

function discoverAgentOnBH(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent) return;
  // If the BBH remained dormant, treat this as a cautious probe: the agent
  // does not remain on the BH node and should immediately return to `from`.
  // This prevents subsequent moves from passing through the (suspected)
  // BH node and forces backtracking behavior.
  agent.alive = true;
  agent.status = 'alive';
  if (to === s.bhNode && !s.bhLocated) {
    // Agent probed and returned safely
    agent.pos = from;
    s.currentNode = from;
    logAdd(s.round, 'info', `A${agent.id} probed BH node ${to} (dormant) and returned to ${from}.`);
    // do NOT add `to` to visited/safe sets; leave it unconfirmed
  } else {
    // Non-BH dormant case: adopt the node as visited
    agent.pos = to;
    s.currentNode = to;
    s.visitedNodes.add(to);
    logAdd(s.round, 'info', `A${agent.id} entered node ${to} while the BBH remained dormant.`);
  }
}

function prepareOperation(s, step) {
  if (!step) {
    return { step: { from: s.currentNode, to: s.currentNode }, actions: [{ type: 'noop' }], index: 0 };
  }

  // If we are currently at a node that has not been confirmed safe, do not
  // continue exploring outward from it. Instead, backtrack along the first
  // safe neighbor we know, preventing agents from passing through or jumping
  // across an unconfirmed black hole node.
  if (step.from !== s.homebase && !isConfirmedSafeNode(s, step.from)) {
    const backtrackTo = findSafeBacktrackNeighbor(s, step.from);
    if (backtrackTo !== null) {
      const backtracker = s.agents.find(a => a.alive && a.pos === step.from && a.role !== 'Marker');
      if (backtracker) {
        logAdd(s.round, 'warn', `Node ${step.from} is unconfirmed; backtracking to ${backtrackTo} instead of continuing.`);
        return {
          step: { from: step.from, to: backtrackTo, label: 'BACKTRACK FROM UNCONFIRMED NODE' },
          actions: [{ type: 'move', agentId: backtracker.id, from: step.from, to: backtrackTo }],
          index: 0,
        };
      }
    }
  }

  // For tree topologies, prefer a simple single-agent hop (DFS stepping):
  // pick one available mover at `from` and perform a single move to `to`.
  // This enforces visiting, dead-end/backtracking behavior naturally.
  if (s.topo === 'tree') {
    const mover = s.agents.find(a => a.alive && a.pos === step.from && a.role !== 'Marker');
    if (mover) {
      actions.push({ type: 'move', agentId: mover.id, from: step.from, to: step.to });
      return { step, actions, index: 0 };
    }
    // If no mover present, advance logical cursor only
    actions.push({ type: 'markMoveOnly' });
    return { step, actions, index: 0 };
  }

  const dangerous = step.to === s.bhNode;
  const actions = [];

  if (dangerous) {
    if (!s.bhLocated) {
      const probes = s.agents
        .filter(a => a.alive && !a.byzantine && a.pos === step.from && a.role !== 'Marker')
        .slice(0, s.f + 1);
      probes.forEach(agent => actions.push({ type: 'enterBH', agentId: agent.id }));
      if (probes.length < s.f + 1) {
        logAdd(s.round, 'warn', `Only ${probes.length} good agent(s) available for the required f+1=${s.f + 1} CCP loss threshold.`);
      }
    } else {
      actions.push({ type: 'markDanger' });
    }
  } else {
    const movers = s.agents.filter(a => a.alive && a.pos === step.from && a.role !== 'Marker');
    const key = edgeKey(step.from, step.to);
    // If edge already confirmed safe, allow fast bulk movement
    if (s.edgeStatus[key] === 'safe' && movers.length > 0) {
      actions.push({ type: 'bulkMove', agentIds: movers.map(a => a.id), from: step.from, to: step.to });
      return { step, actions, index: 0 };
    }

    // If the key path roles are present, perform Make_Pattern (2 rounds)
    // followed by a 5-round Translate_Pattern sub-phase choreography.
    const roleMap = {};
    movers.forEach(a => { if (a.role) roleMap[a.role] = a; });
    if (roleMap.L && roleMap.I1 && roleMap.I2 && roleMap.F) {
      const L = roleMap.L.id, I1 = roleMap.I1.id, I2 = roleMap.I2.id, F = roleMap.F.id;
      // Make_Pattern: round1 L+I1+I2 move forward (from->to), round2 I2 returns to F (to->from)
      // Translate_Pattern (5 rounds):
      // 1: L probes forward (from->to)
      // 2: I2 moves from->to (meet L)
      // 3: I2 returns to from (to->from) to relay
      // 4: F and I2 advance together from->to
      // 5: I1 moves from->to (catch up)
      const seq = [];
      // Make pattern round1
      seq.push({ type: 'move', agentId: L, from: step.from, to: step.to });
      seq.push({ type: 'move', agentId: I1, from: step.from, to: step.to });
      seq.push({ type: 'move', agentId: I2, from: step.from, to: step.to });
      // Make pattern round2: I2 returns to F (we model as move I2 to from)
      seq.push({ type: 'move', agentId: I2, from: step.to, to: step.from });

      // Translate pattern: 5 rounds as described
      // Round T1: L probes forward
      seq.push({ type: 'move', agentId: L, from: step.from, to: step.to });
      // Round T2: I2 moves forward to meet L
      seq.push({ type: 'move', agentId: I2, from: step.from, to: step.to });
      // Round T3: I2 returns to relay
      seq.push({ type: 'move', agentId: I2, from: step.to, to: step.from });
      // Round T4: F and I2 advance together
      seq.push({ type: 'move', agentId: F, from: step.from, to: step.to });
      seq.push({ type: 'move', agentId: I2, from: step.from, to: step.to });
      // Round T5: I1 catches up
      seq.push({ type: 'move', agentId: I1, from: step.from, to: step.to });

      // Convert moves that enter BH to enterBH actions
      seq.forEach(a => {
        if (a.to === s.bhNode && !s.bhLocated) actions.push({ type: 'enterBH', agentId: a.agentId, from: a.from, to: a.to });
        else actions.push({ type: 'move', agentId: a.agentId, from: a.from, to: a.to });
      });
      // mark an expected return window for the group so F1/F2 can start cautious probing
      if (!s.pendingReturn) {
        s.pendingReturn = { from: step.from, to: step.to, expiryRound: s.round + 3, handled: false };
      }
    } else {
      // Unknown-map exploration: perform cautious Explore(v) using three explorers
      if (s.know === 'unknown' && step.classify) {
        const explorers = s.agents.filter(a => a.alive && !a.byzantine && a.pos === step.from && !['Marker','L','I1','I2','F'].includes(a.role)).slice(0,3);
        if (explorers.length === 3) {
          explorers.forEach(exp => {
            if (step.to === s.bhNode && !s.bhLocated) actions.push({ type: 'enterBH', agentId: exp.id, from: step.from, to: step.to });
            else actions.push({ type: 'move', agentId: exp.id, from: step.from, to: step.to });
            // return
            actions.push({ type: 'move', agentId: exp.id, from: step.to, to: step.from });
          });
          if (step.to !== s.bhNode) {
            // after explorers return mark edge safe only if the target is not the hidden BH
            actions.push({ type: 'markEdgeSafe', from: step.from, to: step.to });
          }
        } else {
          movers.forEach(agent => actions.push({ type: 'move', agentId: agent.id }));
        }
      } else {
        movers.forEach(agent => actions.push({ type: 'move', agentId: agent.id }));
      }
    }
    if (movers.length === 0) {
      logAdd(s.round, 'warn', `No live agents at node ${step.from}; advancing logical DFS cursor to ${step.to}.`);
      actions.push({ type: 'markMoveOnly' });
    }
  }

  return { step, actions, index: 0 };
}

function moveAgent(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;
  agent.pos = to;
  s.currentNode = to;
  markCurrentNode(to);
  logAdd(s.round, agent.byzantine ? 'byz' : 'info', `A${agent.id} moves ${from}->${to} (${agent.byzantine ? 'Byzantine' : 'good'}).`);
  // Track visits for perpetual exploration target
  if (s.mode && s.mode.startsWith('perp') && s.perpTargetNodes && s.perpTargetNodes.has(to)) {
    s.cycleVisited.add(to);
    // If we've visited all target nodes in this cycle, declare perpetual success
    if (s.cycleVisited.size === s.perpTargetNodes.size) {
      s.done = true;
      logAdd(s.round, 'system', 'Perpetual exploration cycle completed for target component.');
      showOverlay('success', 'PERPETUAL EXPLORATION ACHIEVED', `All ${s.perpTargetNodes.size} nodes visited this cycle.`);
    }
  }
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
  const bhNode = cyRef.instance.getElementById(`n${to}`);
  bhNode.addClass('trap-sprung');
  window.setTimeout(() => bhNode.removeClass('trap-sprung'), 900);
  if (s.lostInBH >= s.f + 1) {
    s.bhLocated = true;
    s.found = true;
    cyRef.instance.getElementById(`n${to}`).removeClass('blackhole').addClass('revealed');
    logAdd(s.round, 'danger', `BH location confirmed after ${s.lostInBH} losses on node ${to}.`);
  }
}

function completeOperation(op) {
  const s = simState;
  const { from, to, classify, label } = op.step;
  const key = edgeKey(from, to);
  const cyEdge = getCyEdge(from, to);
  const dangerous = to === s.bhNode;

  cyEdge.removeClass('probing');

  if (dangerous) {
    // Only reveal the BH and mark the dangerous edge once the adversary has
    // actually activated and enough losses or a confirmed discovery occurred.
    if (s.bhLocated) {
      s.edgeStatus[key] = 'dangerous';
      s.found = true;
      s.currentNode = from;
      cyEdge.addClass('dangerous');
      cyRef.instance.getElementById(`n${to}`).removeClass('blackhole').addClass('revealed');
      logAdd(s.round, 'danger', `CCP on edge (${from}->${to}): BLACK HOLE DETECTED. Total BH losses: ${s.lostInBH} (target f+1=${s.f + 1}).`);
      computeComponentsAfterBH(s, s.bhNode);
      return;
    }
    // If the BBH remained dormant, no discovery occurs yet.
    s.currentNode = from;
    logAdd(s.round, 'info', `Edge (${from}->${to}) remains unclassified after a dormant BH encounter.`);
    return;
  }

  s.currentNode = to;
  if (classify && s.edgeStatus[key] === 'unknown') {
    s.edgeStatus[key] = 'safe';
    s.safeNodes.add(from);
    s.safeNodes.add(to);
    s.visitedNodes.add(to);
    cyEdge.addClass('safe');
    cyRef.instance.getElementById(`n${to}`).addClass('safe');
    cyRef.instance.getElementById(`n${from}`).addClass('safe');
    maybeIdentifyByzantine(from, to);
    logAdd(s.round, 'safe', `${label}: edge (${from}->${to}) certified SAFE after sequential CCP movement.`);
  }

  // If this operation was a cautious probe sequence, handle F1/F2 outcome.
  if (op.cautiousProbe && s.lastCautiousProbe) {
    const info = s.lastCautiousProbe;
    const f1 = s.agents.find(a => a.id === info.f1Id);
    const f2 = s.agents.find(a => a.id === info.f2Id);
    // If F1 was lost during the probe, let F2 settle as Anchor and mark BH located.
    if (f1 && !f1.alive) {
      if (f2 && f2.alive) {
        f2.settled = true;
        f2.role = 'Anchor';
        s.anchorsPlaced = (s.anchorsPlaced || 0) + 1;
        s.bhLocated = true;
        s.bhNode = info.to;
        cyRef.instance.getElementById(`n${info.to}`).removeClass('blackhole').addClass('revealed');
        logAdd(s.round, 'danger', `F1 lost on cautious probe; A${f2.id} becomes Anchor at ${info.from}. BH marked at ${info.to}.`);
      }
    } else {
      logAdd(s.round, 'info', 'Cautious probe completed: F1 returned safely.');
    }
    s.lastCautiousProbe = null;
  }
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

function computeComponentsAfterBH(s, bhNode) {
  const n = s.n;
  const neighbors = s.neighbors;
  const comp = new Array(n).fill(null);
  let cid = 0;
  for (let i = 0; i < n; i++) {
    if (i === bhNode) continue;
    if (comp[i] !== null) continue;
    // BFS
    const q = [i];
    comp[i] = cid;
    while (q.length) {
      const u = q.shift();
      for (const v of (neighbors[u] || [])) {
        if (v === bhNode) continue;
        if (comp[v] === null) { comp[v] = cid; q.push(v); }
      }
    }
    cid++;
  }
  s.nodeComponent = comp;
  // Home component id
  const homeComp = comp[s.homebase];
  s.component = homeComp === 0 ? 'C1' : 'C1';
  // mark nodes visually
  cyRef.instance.nodes().forEach(node => {
    const nid = +node.id().slice(1);
    node.removeClass('C1'); node.removeClass('C2');
    if (nid === bhNode) return;
    const label = comp[nid] === homeComp ? 'C1' : 'C2';
    node.addClass(label);
    // append component to label text
    const base = node.data('label') || `${nid}`;
    node.data('label', `${base}\n${label}`);
  });
  // set exploration target for Perp modes
  if (s.mode === 'perp-bbh-home') {
    s.perpTargetNodes = new Set(comp.map((c, idx) => c === homeComp ? idx : -1).filter(x => x >= 0));
  } else if (s.mode === 'perp-bbh') {
    // pick any non-home component as target (largest)
    const counts = {};
    for (let i = 0; i < comp.length; i++) if (comp[i] !== null) counts[comp[i]] = (counts[comp[i]] || 0) + 1;
    let pick = null; let best = -1;
    for (const [c, cnt] of Object.entries(counts)) {
      if (+c === homeComp) continue;
      if (cnt > best) { best = cnt; pick = +c; }
    }
    if (pick === null) pick = homeComp;
    s.perpTargetNodes = new Set(comp.map((c, idx) => c === pick ? idx : -1).filter(x => x >= 0));
  }
  s.cycleVisited = new Set();
}

function shouldFinish(s) {
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
  const aliveAgents = s.agents.filter(a => a.alive).length;
  setStat('sEdgeSafe', edgeSafe);
  setStat('sEdgeDanger', edgeDanger);
  setStat('sAlive', aliveAgents);
  setStat('sAgentsLost', s.lostInBH);
  setStat('sRoundsSurvived', s.roundsSurvived ?? s.round);
  const coveragePercent = s.n ? Math.round(s.safeNodes.size / s.n * 100) : 0;
  setStat('sSafeCoverage', `${coveragePercent}%`);
  setStat('sSafeNodes', s.safeNodes.size);
  setStat('sAdvMode', s.bbhControlMode);
  setStat('sBBHState', s.bbhActive ? 'active' : 'inactive');
  setStat('sAlive', aliveAgents);
  setStat('sByzFound', s.identifiedByzantine.size);
  setStat('sPhase', s.currentPhase ?? 0);
  setStat('sMaxDist', s.maxDistance ?? 1);
  setStat('sComponent', s.component ?? 'C1');
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

function updateBBHSchedule(s, nextRound) {
  if (!s.bbhAdversary) return;
  if (s.bbhControlMode === 'every') {
    s.bbhActive = s.bbhControlValue > 0 && nextRound % s.bbhControlValue === 0;
  } else if (s.bbhControlMode === 'agents') {
    const agentsOnBH = s.agents.filter(a => a.alive && !a.byzantine && a.pos === s.bhNode).length;
    s.bbhActive = agentsOnBH >= s.bbhAgentThreshold;
  }
}

export function setAdversaryView(visible) {
  const s = simState;
  if (!s) return;
  s.adversaryView = visible;
  const bhNode = cyRef.instance.getElementById(`n${s.bhNode}`);
  if (visible) bhNode.addClass('blackhole');
  else bhNode.removeClass('blackhole');
}

export function setBBHControlMode(mode) {
  const s = simState;
  if (!s) return;
  s.bbhControlMode = mode;
  if (mode !== 'manual') s.bbhActive = false;
}

export function setBBHControlValue(value) {
  const s = simState;
  if (!s) return;
  s.bbhControlValue = Number(value);
}

export function setBBHAgentThreshold(value) {
  const s = simState;
  if (!s) return;
  s.bbhAgentThreshold = Number(value);
}

export function setBBHActive(active) {
  const s = simState;
  if (!s) return;
  s.bbhActive = Boolean(active);
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
      const roleType = agent.roleType || (agent.role === 'L' ? 'Explorer' : 'Marker');
      particle.className = [
        'agent-particle',
        kind,
        roleType === 'Explorer' ? 'explorer' : 'marker',
        simState.activeAgentId === agent.id ? 'active' : '',
      ].filter(Boolean).join(' ');
      particle.style.transform = `translate(${x}px, ${y}px)`;
      particle.dataset.agentId = `A${agent.id}`;
      // Show explorer or marker label and anchor state on the particle
      const roleSpan = document.createElement('span');
      roleSpan.className = 'agent-role';
      roleSpan.textContent = roleType === 'Explorer' ? 'E' : 'M';
      if (agent.settled) particle.classList.add('anchored');
      particle.appendChild(roleSpan);
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
  ['sRound','sAlive','sAgentsLost','sRoundsSurvived','sSafeCoverage','sSafeNodes','sAdvMode','sBBHState','sByzFound','sEdgeSafe','sEdgeDanger','sPhase','sMaxDist','sComponent'].forEach(id => setStat(id, '-'));
  $('progressBar').style.width = '0%';
  $('runBtn').disabled  = true;
  $('runBtn').textContent = 'RUN SIMULATION';
  $('stepBtn').disabled = true;
  $('overlay').className = '';
}
