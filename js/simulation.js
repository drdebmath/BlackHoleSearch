// Black Hole Search & Perpetual Exploration simulation engine.

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
  $('runBtn').textContent = '▶ RUN SIMULATION';

  const topo = $('topoSelect').value;
  const n    = +$('nNodes').value;
  const f    = +$('fFault').value;
  const comm = $('commModel').value;
  const know = $('topoKnow').value;
  const simMode = $('simModeSelect').value;

  const { nodes, edges } = generateGraph(topo, n);
  initCy(nodes, edges);
  const cy = cyRef.instance;
  cy.on('pan zoom resize layoutstop', renderAgentsOnGraph);
  cy.on('position', 'node', renderAgentsOnGraph);

  const homebase = 0;
  const neighbors = buildNeighbors(n, edges);
  const bhNode = chooseBlackHole(n, homebase, neighbors, know);

  const delta = Math.max(...Object.values(neighbors).map(v => v.length));
  
  // Calculate team dimension based strictly on selected runtime strategy
  let k;
  if (simMode === 'bbh_home') {
    k = (topo === 'tree' || topo === 'ring' || topo === 'star') ? 6 : (3 * delta + 3);
  } else {
    k = Math.max(requiredAgents(know, comm, f, delta), f + 2);
  }

  const agents = [];
  for (let i = 0; i < k; i++) {
    let role = null;
    if (simMode === 'bbh_home') {
      if (i === 0) role = 'F';
      else if (i === 1) role = 'I2';
      else if (i === 2) role = 'I1';
      else if (i === 3) role = 'L';
      else if (i === 4) role = 'F1';
      else if (i === 5) role = 'F2';
      else role = 'Explorer';
    }
    agents.push({
      id: i,
      pos: homebase,
      alive: true,
      byzantine: i < f,
      identified: false,
      status: i < f ? 'byz' : 'good',
      role: role
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
    edgeStatus, know, comm, delta, simMode,
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
    // Paper tracking parameters
    paperSubPhaseRound: 1,
    paperPhase: 1,
    paperInterventionTriggered: false,
    paperTargetEdgeIndex: 0,
    paperSequencePlan: []
  };

  if (simMode === 'bbh_home') {
    state.paperSequencePlan = generatePaperActionPlan(state);
  } else {
    state.traversalOrder = know === 'known' ? buildKnownDFSPlan(state) : buildUnknownDFSPlan(state);
  }
  
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
  logAdd(0, 'system', `Graph initialized with chosen layout. Max Node Degree Delta = ${delta}`);
  logAdd(0, 'system', `Malicious Black Hole allocated dynamically at target node ID: ${bhNode}`);
  
  if (simMode === 'bbh_home') {
    logAdd(0, 'info', `Initialized Perpetual Exploration Subsystem. Pattern agents [L, I1, I2, F] mapped successfully.`);
  } else {
    logAdd(0, 'system', `Standard BHS mode enabled. Multi-agent cluster configuration prepared.`);
  }

  $('runBtn').disabled  = false;
  $('stepBtn').disabled = false;
  $('overlay').className = '';
  updateFormula();
}

// Generate execution trace matching Section 3.2 and Section 4.2 definitions
function generatePaperActionPlan(state) {
  const plan = [];
  const baseOrder = buildKnownDFSPlan(state);
  
  // Phase 1: Establish Initial Exploration Topology Pattern Profile
  plan.push({ type: 'pattern_create', round: 1, desc: 'MAKE_PATTERN Round 1: L, I1, I2 move outward.' });
  plan.push({ type: 'pattern_create', round: 2, desc: 'MAKE_PATTERN Round 2: I2 falls back to check context.' });

  // Map DFS links to the core translation sequence loops
  baseOrder.forEach((edge, index) => {
    for (let r = 1; r <= 5; r++) {
      plan.push({
        type: 'translation_step',
        round: r,
        edgeIndex: index,
        from: edge.from,
        to: edge.to,
        desc: `TRANSLATE_PATTERN Sub-Phase [Edge ${edge.from}->${edge.to}] Round ${r}`
      });
    }
  });
  return plan;
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

  // Direct engine execution state into the isolated analytical function if active
  if (simState.simMode === 'bbh_home') {
    stepPaperSimulation();
    return;
  }

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
  highlightEdge(op.step.from, op.step.to);

  if (action.type === 'move') {
    moveAgent(action.agentId, op.step.from, op.step.to);
  } else if (action.type === 'lose') {
    loseAgentToBlackHole(action.agentId, op.step.from, op.step.to);
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

  if (!s.currentOperation && shouldFinish(s)) {
    finishSim(finishWasSuccessful(s));
  }
}

// Dedicated analytical execution engine processing research paper state configurations
function stepPaperSimulation() {
  const s = simState;
  
  if (s.traversalIndex >= s.paperSequencePlan.length) {
    s.done = true;
    finishSim(true);
    return;
  }

  const step = s.paperSequencePlan[s.traversalIndex];
  s.round++;
  setStat('sRound', s.round);

  const fAgent = s.agents.find(a => a.role === 'F');
  const i2Agent = s.agents.find(a => a.role === 'I2');
  const i1Agent = s.agents.find(a => a.role === 'I1');
  const lAgent = s.agents.find(a => a.role === 'L');

  if (step.type === 'pattern_create') {
    highlightEdge(s.homebase, s.homebase);
    if (step.round === 1) {
      if (lAgent) lAgent.pos = 1;
      if (i1Agent) i1Agent.pos = 1;
      if (i2Agent) i2Agent.pos = 1;
      logAdd(s.round, 'info', `${step.desc} [L, I1, I2] transition to neighboring node layout.`);
    } else if (step.round === 2) {
      if (i2Agent) i2Agent.pos = s.homebase;
      logAdd(s.round, 'info', `${step.desc} Geometric state validation pattern established successfully.`);
    }
    s.traversalIndex++;
  } else if (step.type === 'translation_step') {
    const { from, to, round } = step;
    const isDangerous = to === s.bhNode;
    highlightEdge(from, to);

    if (s.paperInterventionTriggered) {
      // Cautious verification subsystem handling trigger protocols (Section 3.2.1)
      const f1 = s.agents.find(a => a.role === 'F1');
      const f2 = s.agents.find(a => a.role === 'F2');
      if (f1 && f1.alive) {
        f1.pos = to;
        if (to === s.bhNode) {
          f1.alive = false;
          f1.status = 'dead';
          s.lostInBH++;
          logAdd(s.round, 'danger', `Base Backup Agent [F1] executes step verification check on link (${from}->${to}) and gets destroyed.`);
          logAdd(s.round, 'safe', `Stationary base controller [F2] captures exact failure tracking context data successfully.`);
          s.edgeStatus[edgeKey(from, to)] = 'dangerous';
          s.bhLocated = true;
          finishSim(true);
          return;
        } else {
          logAdd(s.round, 'info', `Backup checker [F1] confirms verification step safe at node ${to}. Falling back.`);
          f1.pos = from;
        }
      }
      s.traversalIndex++;
      refreshDisplay();
      return;
    }

    // Step-by-step trace implementation for the specific 5-round translation cycle
    if (round === 1) {
      if (lAgent) lAgent.pos = to;
      logAdd(s.round, 'info', `[Round 1] Leader [L] advances to explore forward node ${to}.`);
      if (isDangerous && lAgent) {
        lAgent.alive = false;
        s.lostInBH++;
        s.paperInterventionTriggered = true;
        logAdd(s.round, 'danger', `CRITICAL: Leader [L] entered the Byzantine Black Hole at node ${to} and was eliminated.`);
      }
    } else if (round === 2) {
      if (i2Agent) i2Agent.pos = to;
      if (lAgent && lAgent.alive) lAgent.pos = from;
      logAdd(s.round, 'info', `[Round 2] Intermediate [I2] moves forward, Leader [L] checks back position.`);
    } else if (round === 3) {
      if (i2Agent) i2Agent.pos = from;
      if (lAgent && lAgent.alive) lAgent.pos = to;
      logAdd(s.round, 'info', `[Round 3] I2 returns to synchronize context tracking coordinates.`);
      if (isDangerous && lAgent && lAgent.alive) {
        lAgent.alive = false;
        s.lostInBH++;
        s.paperInterventionTriggered = true;
        logAdd(s.round, 'danger', `CRITICAL: Leader [L] caught in malicious dynamic black hole state at node ${to}.`);
      }
    } else if (round === 4) {
      if (fAgent) fAgent.pos = from;
      if (i2Agent) i2Agent.pos = from;
      logAdd(s.round, 'info', `[Round 4] Follower [F] and [I2] align structure on verified link gateway.`);
    } else if (round === 5) {
      if (i1Agent) i1Agent.pos = to;
      logAdd(s.round, 'info', `[Round 5] Intermediate [I1] advances forward to consolidate the translated link.`);
      if (isDangerous && i1Agent) {
        i1Agent.alive = false;
        s.lostInBH++;
        s.paperInterventionTriggered = true;
        logAdd(s.round, 'danger', `CRITICAL: Pattern sync failure. Agent [I1] lost to unexpected malicious host activation.`);
      }
      
      // If the path step was completely safe, officially tag it in our UI table
      if (!isDangerous) {
        s.edgeStatus[edgeKey(from, to)] = 'safe';
        s.safeNodes.add(from);
        s.safeNodes.add(to);
        cyRef.instance.getElementById(`n${from}`).addClass('safe');
        cyRef.instance.getElementById(`n${to}`).addClass('safe');
        getCyEdge(from, to).addClass('safe');
      }
    }

    s.traversalIndex++;
    refreshDisplay();
  }
}

function prepareOperation(s, step) {
  if (!step) {
    return { step: { from: s.currentNode, to: s.currentNode }, actions: [{ type: 'noop' }], index: 0 };
  }

  const dangerous = step.to === s.bhNode;
  const actions = [];

  if (dangerous) {
    if (!s.bhLocated) {
      const probes = s.agents
        .filter(a => a.alive && !a.byzantine && a.pos === step.from)
        .slice(0, s.f + 1);
      probes.forEach(agent => actions.push({ type: 'lose', agentId: agent.id }));
      if (probes.length < s.f + 1) {
        logAdd(s.round, 'warn', `Only ${probes.length} good agent(s) available for the required f+1=${s.f + 1} CCP loss threshold.`);
      }
    } else {
      actions.push({ type: 'markDanger' });
    }
  } else {
    const movers = s.agents.filter(a => a.alive && a.pos === step.from);
    movers.forEach(agent => actions.push({ type: 'move', agentId: agent.id }));
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
}

// ... Rest of the helper functions from original codebase remain unaltered ...
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
  const { from, to, classify, label } = op.step;
  const key = edgeKey(from, to);
  const cyEdge = getCyEdge(from, to);
  const dangerous = to === s.bhNode;

  cyEdge.removeClass('probing');

  if (dangerous) {
    s.edgeStatus[key] = 'dangerous';
    s.found = true;
    s.bhLocated = true;
    s.currentNode = from;
    cyEdge.addClass('dangerous');
    cyRef.instance.getElementById(`n${to}`).removeClass('blackhole').addClass('revealed');
    logAdd(s.round, 'danger', `CCP on edge (${from}->${to}): BLACK HOLE DETECTED. Total BH losses: ${s.lostInBH} (target f+1=${s.f + 1}).`);
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
  if (s.simMode === 'bbh_home') {
    if (s.paperSequencePlan.length === 0) return 100;
    return Math.min(100, (s.traversalIndex / s.paperSequencePlan.length) * 100);
  }
  if (s.know === 'unknown') {
    const classified = Object.values(s.edgeStatus).filter(status => status !== 'unknown').length;
    return Math.min(100, classified / s.edges.length * 100);
  }
  if (s.traversalOrder.length === 0) return 100;
  const opFraction = s.currentOperation ? s.currentOperation.index / s.currentOperation.actions.length : 0;
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
  $('runBtn').textContent = '▶ RUN SIMULATION';

  const survivors = s.agents.filter(a => a.alive && !a.byzantine).length;
  if (success) {
    logAdd(s.round, 'system', `PROTCOL TERMINATED SUCCESSFULLY: Malicious node located cleanly.`);
    showOverlay('success', 'ANALYSIS COMPLETE', `Target network component successfully evaluated in ${s.round} steps.`);
  } else {
    logAdd(s.round, 'danger', 'SIMULATION RECOVERY FAIL: Fault parameters exceeded team scale capacity limits.');
    showOverlay('failure', 'MISSION HALTED', 'Available explorer resources completely depleted.');
  }
  $('runBtn').disabled  = true;
  $('stepBtn').disabled = true;
}

function highlightEdge(from, to) {
  const cy = cyRef.instance;
  if (!cy) return;
  cy.edges().removeClass('probing');
  getCyEdge(from, to).addClass('probing');
}

function markCurrentNode(nodeId) {
  const cy = cyRef.instance;
  if (!cy) return;
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
      const angle = agents.length === 1 ? -Math.PI / 2 : (Math.PI * 2 * index / agents.length) - Math.PI / 2;
      const x = pos.x + Math.cos(angle) * orbit;
      const y = pos.y + Math.sin(angle) * orbit;
      const particle = document.createElement('div');
      const kind = agent.byzantine ? (agent.identified ? 'identified' : 'byz') : 'good';
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
  $('runBtn').textContent = '▶ RUN SIMULATION';
  $('stepBtn').disabled = true;
  $('overlay').className = '';
}