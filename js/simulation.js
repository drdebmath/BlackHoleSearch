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
  edges.forEach(e => {
    const s = +e.data.source.slice(1);
    const t = +e.data.target.slice(1);
    edgeStatus[edgeKey(s, t)] = 'unknown';
  });

  const state = {
    n, f, k, homebase, bhNode, agents, neighbors, ports, edges,
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

// 100% blind DFS tree building. Does NOT peek at the Black Hole location.
function buildUnknownDFSPlan(state) {
  const { homebase, ports } = state; 
  const visitedNodes = new Set([homebase]);
  const exploredEdges = new Set();
  const plan = [];

  const dfs = (u) => {
    for (const v of (ports[u] || [])) {
      const key = edgeKey(u, v);
      if (exploredEdges.has(key)) continue;
      exploredEdges.add(key);

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
    const nextStep = getNextStep(s);
    s.currentOperation = prepareOperation(s, nextStep);
  }

  const op = s.currentOperation;
  const action = op.actions[op.index++];
  
  if (!action) {
    logAdd(s.round, 'danger', 'Simulation halted: no valid action was available for the current step.');
    finishSim(false);
    return;
  }
  
  s.round++;
  s.activeAgentId = action.agentId ?? null;
  setStat('sRound', s.round);
  if (op.step) highlightEdge(op.step.from, op.step.to);

  // ACTION PROCESSING ENGINE
  if (action.type === 'startProbe' || action.type === 'nextProbe') {
      const pState = op.probeState;
      if (pState.queue.length === 0) {
          logAdd(s.round, 'warn', 'Ran out of agents to complete probe! Marking dangerous.');
          op.actions.splice(op.index, 0, { type: 'markDanger' });
      } else {
          const agentId = pState.queue.shift();
          logAdd(s.round, 'info', `Sending Agent A${agentId} to independently probe ${op.step.from}->${op.step.to}`);
          op.actions.splice(op.index, 0,
              { type: 'probeOut', agentId },
              { type: 'probeEvaluate', agentId }
          );
      }
  } else if (action.type === 'probeOut') {
      moveAgent(action.agentId, op.step.from, op.step.to);
  } else if (action.type === 'probeEvaluate') {
      const agent = s.agents.find(a => a.id === action.agentId);
      const isBH = (op.step.to === s.bhNode);
      // Byzantine agents survive the BH and return to lie to the swarm
      const survives = !(isBH && !agent.byzantine);

      if (survives) {
          moveAgent(action.agentId, op.step.to, op.step.from);
          op.probeState.returned++;
          logAdd(s.round, 'safe', `A${action.agentId} returned from probe (${op.probeState.returned}/${op.probeState.threshold} needed).`);
      } else {
          loseAgentToBlackHole(action.agentId, op.step.from, op.step.to);
          op.probeState.lost++;
      }

      // Check strictly against the threshold
      if (op.probeState.returned >= op.probeState.threshold) {
           op.actions.splice(op.index, 0, { type: 'markSafe' });
      } else if (op.probeState.lost >= op.probeState.threshold) {
           op.actions.splice(op.index, 0, { type: 'markDanger' });
      } else {
           op.actions.splice(op.index, 0, { type: 'nextProbe' });
      }
  } else if (action.type === 'move') {
      moveAgent(action.agentId, op.step.from, op.step.to);
  } else if (action.type === 'groupMove') {
      action.agentIds.forEach(id => moveAgent(id, op.step.from, op.step.to));
  } else if (action.type === 'markMoveOnly') {
      s.currentNode = op.step.to;
      markCurrentNode(op.step.to);
  } else if (action.type === 'markSafe') {
      completeOperation(op, 'safe');
  } else if (action.type === 'markDanger') {
      completeOperation(op, 'dangerous');
  } else if (action.type === 'noop') {
      logAdd(s.round, 'info', 'No movement required this round.');
  }

  if (op.index >= op.actions.length) {
    s.currentOperation = null;
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

// Determines the next step, falling back to dynamic routing if the static DFS breaks
function getNextStep(s) {
    while (s.traversalIndex < s.traversalOrder.length) {
        const step = s.traversalOrder[s.traversalIndex++];
        const edgeState = s.edgeStatus[edgeKey(step.from, step.to)];
        
        // If the static plan wants to walk through a node we already proved is a Black Hole, skip it.
        if (edgeState === 'dangerous') {
            logAdd(s.round, 'warn', `Skipping static DFS step ${step.from}->${step.to} as it is blocked by the Black Hole.`);
            continue;
        }
        return step;
    }

    // Dynamic routing for full exploration (Unknown Map)
    if (s.know === 'unknown') {
        const targetKey = Object.entries(s.edgeStatus).find(([k, v]) => v === 'unknown')?.[0];
        if (targetKey) {
            const [a, b] = targetKey.split('-').map(Number);
            if (s.currentNode === a || s.currentNode === b) {
                const to = s.currentNode === a ? b : a;
                return { from: s.currentNode, to, classify: true, label: 'Dynamic perimeter probe' };
            }
            const path = shortestPathToAny(s, s.currentNode, new Set([a, b]));
            if (path && path.length > 1) {
                return { from: path[0], to: path[1], classify: false, label: 'Dynamic reposition' };
            } else {
               logAdd(s.round, 'warn', 'Cannot find a safe path to the remaining unknown edges!');
            }
        }
    }
    return null;
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
    return { step: { from: s.currentNode, to: s.currentNode }, actions: [{ type: 'noop' }], index: 0 };
  }

  const key = edgeKey(step.from, step.to);
  const edgeState = s.edgeStatus[key];
  const actions = [];
  const movers = s.agents.filter(a => a.alive && a.pos === step.from);

  if (movers.length === 0) {
      logAdd(s.round, 'warn', `No live agents at node ${step.from}; advancing logical cursor.`);
      actions.push({ type: 'markMoveOnly' });
      return { step, actions, index: 0 };
  }

  // STRICT 1-BY-1 PROBE QUEUEING
  if (step.classify && edgeState === 'unknown') {
      logAdd(s.round, 'info', `Initiating STRICT 1-by-1 CCP on edge (${step.from}->${step.to}). (Threshold: ${s.f + 1})`);
      const probeState = {
          threshold: s.f + 1,
          returned: 0,
          lost: 0,
          queue: movers.map(a => a.id)
      };
      actions.push({ type: 'startProbe' });
      return { step, actions, index: 0, probeState, classify: true };
  } else {
      // It's a known safe edge, group move
      actions.push({ type: 'groupMove', agentIds: movers.map(a => a.id) });
      return { step, actions, index: 0 };
  }
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

function loseAgentToBlackHole(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;
  agent.alive = false;
  agent.status = 'dead';
  agent.pos = to; 
  s.lostInBH++;
  s.currentNode = from; // Swarm baseline remains at from
  markCurrentNode(from);
  logAdd(s.round, 'danger', `A${agent.id} enters ${from}->${to} and is lost in the black hole (${s.lostInBH} total lost).`);
}

function completeOperation(op, result) {
  const s = simState;
  const { from, to, label } = op.step;
  const key = edgeKey(from, to);
  const cyEdge = getCyEdge(from, to);

  cyEdge.removeClass('probing');

  if (result === 'dangerous') {
    s.edgeStatus[key] = 'dangerous';
    s.found = true;
    s.bhLocated = true;
    s.currentNode = from;
    cyEdge.addClass('dangerous');
    cyRef.instance.getElementById(`n${s.bhNode}`).removeClass('blackhole').addClass('revealed');
    
    const remainingUnknown = Object.values(s.edgeStatus).filter(v => v === 'unknown').length;
    if (s.know === 'unknown' && remainingUnknown > 0) {
      logAdd(s.round, 'warn', `BLACK HOLE EDGE DETECTED! UNKNOWN MAP MODE: ${remainingUnknown} edge(s) remain unclassified. Rerouting to continue map completion...`);
    } else {
      logAdd(s.round, 'danger', `BLACK HOLE DETECTED via (${from}->${to}).`);
    }
  } else if (result === 'safe') {
    s.currentNode = to;
    s.edgeStatus[key] = 'safe';
    s.safeNodes.add(from);
    s.safeNodes.add(to);
    s.visitedNodes.add(to);
    cyEdge.addClass('safe');
    cyRef.instance.getElementById(`n${to}`).addClass('safe');
    cyRef.instance.getElementById(`n${from}`).addClass('safe');
    maybeIdentifyByzantine(from, to);
    logAdd(s.round, 'safe', `${label}: edge (${from}->${to}) certified SAFE after sequential CCP.`);
    
    // Group move the rest of the agents across the now-safe edge
    const remainingMovers = s.agents.filter(a => a.alive && a.pos === from);
    remainingMovers.forEach(agent => {
        agent.pos = to;
    });
  }
}

function maybeIdentifyByzantine(from, to) {
  const s = simState;
  const aliveByz = s.agents.filter(a => a.alive && a.byzantine && !s.identifiedByzantine.has(a.id));
  if (aliveByz.length === 0 || Math.random() >= 0.4) return;

  const byz = aliveByz[0];
  s.identifiedByzantine.add(byz.id);
  byz.identified = true;
  logAdd(s.round, 'byz', `Byzantine agent A${byz.id} identified via anomalous CCP behavior on edge (${from}->${to})!`);
}

function shouldFinish(s) {
  if (s.currentOperation) return false;
  if (s.know === 'unknown') return allEdgesClassified(s);
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
      ? `All ${s.edges.length} edges explored/classified. True BH perimeter found.`
      : 'DFS stopped immediately after locating the black hole.';
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