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
  updateCcpReadout, hideCcpReadout,
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
  const byzStrategy = $('byzStrategy').value; // 'adversarial' | 'passive'

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
    edgeStatus, know, comm, delta, byzStrategy,
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
  hideCcpReadout();

  logClear();
  logAdd(0, 'system', `Graph built: ${n} nodes, ${edges.length} edges, Delta=${delta}`);
  logAdd(0, 'system', `Black Hole at node ${bhNode} (hidden from agents)`);
  logAdd(0, 'system', `Team: k=${k} agents, f=${f} Byzantine (${byzStrategy === 'adversarial' ? 'adversarial: probes & lies' : 'passive: never probes'})`);
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

export function stepSimulation() {
  if (!simState || simState.done) return;

  const s = simState;

  // Non-probe (plain move/backtrack) steps still run through the old
  // one-action-per-round path; CCP probe steps run through runCcpRound.
  if (!s.currentOperation) {
    if (shouldFinish(s)) {
      finishSim(finishWasSuccessful(s));
      return;
    }
    s.currentOperation = prepareOperation(s, s.traversalOrder[s.traversalIndex]);
  }

  const op = s.currentOperation;

  if (op.kind === 'ccp') {
    runCcpRound(op);
  } else {
    runPlainRound(op);
  }

  if (!s.currentOperation) s.traversalIndex++;

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

// --- Plain (non-probing) DFS movement / backtrack steps -------------------

function runPlainRound(op) {
  const s = simState;
  const action = op.actions[op.index++];
  if (!action) {
    logAdd(s.round, 'danger', 'Simulation halted: no valid action was available for the current DFS step.');
    finishSim(false);
    s.currentOperation = null;
    return;
  }
  s.round++;
  s.activeAgentId = action.agentId ?? null;
  setStat('sRound', s.round);
  highlightEdge(op.step.from, op.step.to);

  if (action.type === 'move') {
    moveAgent(action.agentId, op.step.from, op.step.to);
  } else if (action.type === 'markDanger') {
    logAdd(s.round, 'danger', `Edge (${op.step.from}->${op.step.to}) borders the known black hole; marked DANGEROUS without re-probing.`);
  } else if (action.type === 'markMoveOnly') {
    s.currentNode = op.step.to;
    markCurrentNode(op.step.to);
  } else if (action.type === 'noop') {
    logAdd(s.round, 'info', 'No DFS movement was required this round.');
  }

  if (op.index >= op.actions.length) {
    s.currentNode = op.step.to;
    s.currentOperation = null;
  }
}

function prepareOperation(s, step) {
  if (!step) {
    return { kind: 'plain', step: { from: s.currentNode, to: s.currentNode }, actions: [{ type: 'noop' }], index: 0 };
  }

  if (step.classify) {
    return startCcpOperation(s, step);
  }

  const actions = [];
  const movers = s.agents.filter(a => a.alive && a.pos === step.from);
  movers.forEach(agent => actions.push({ type: 'move', agentId: agent.id }));
  if (movers.length === 0) {
    logAdd(s.round, 'warn', `No live agents at node ${step.from}; advancing logical DFS cursor to ${step.to}.`);
    actions.push({ type: 'markMoveOnly' });
  }
  return { kind: 'plain', step, actions, index: 0 };
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

// --- Cascading Cautious Probe (CCP) — Algorithm 1 --------------------------
//
// Classifying a single unexplored port p at node u, leading to v:
//   * P = probe pool already sent through p (never reused on this port)
//   * R = subset of P that returned through p          ("safe" evidence)
//   * D = subset of P that did NOT return through p     ("dangerous" evidence)
//   * B = identified-Byzantine set (shared across the whole run)
//   * threshold = f + 1 - |B|   (Lines 1, 11, 14, 24, 30)
//
// Round j sends a wave: f+1-|B| agents the first wave, one agent every wave
// after that (Lines 7/18-20). Round j+1 reveals who returned. The port is
// classified the instant |R| or |D| reaches the threshold (worst case after
// 2f+1 agents have been committed, per Lemma 1).
//
// A "good" agent that enters a true black hole never returns -> added to D.
// An "adversarial" Byzantine agent always returns, whatever the truth is,
// and so always lands in R -> this is precisely what can stall a dangerous
// port's classification and burn extra rounds (Lemma 2/3), and it is what
// exposes that agent once the port finally resolves the other way.

function startCcpOperation(s, step) {
  const { from, to, label } = step;
  const dangerousTruth = to === s.bhNode;
  const port = `${from}->${to}`;

  const op = {
    kind: 'ccp',
    step,
    port,
    from, to, label,
    dangerousTruth,
    P: new Set(),     // agents already committed to this port
    R: new Set(),     // returned through p
    D: new Set(),     // did not return through p
    wave: [],
    phase: 'send',    // 'send' -> 'await' -> 'send' -> ... -> 'resolved'
  };

  if (dangerousTruth && s.bhLocated) {
    // Known-map shortcut: we already located the BH elsewhere; no need to
    // spend more agents re-discovering an edge we can already classify.
    op.phase = 'shortcut';
  }

  return op;
}

function ccpThreshold(s) {
  return Math.max(1, s.f + 1 - s.identifiedByzantine.size);
}

function pickNextProbeBatch(s, op, size) {
  // Prefer agents currently at the probing node `from` that have not yet
  // been used on this port. Order: by id. Under the "adversarial" strategy
  // Byzantine agents are not excluded — exactly like the paper, the probe
  // group is just "the next agents in order", Byzantine or not. Under the
  // "passive" strategy, Byzantine agents never volunteer for a probe.
  const eligible = s.agents
    .filter(a => a.alive && a.pos === op.from && !op.P.has(a.id))
    .filter(a => s.byzStrategy === 'adversarial' || !a.byzantine)
    .sort((a, b) => a.id - b.id);
  return eligible.slice(0, size);
}

function runCcpRound(op) {
  const s = simState;

  if (op.phase === 'shortcut') {
    s.round++;
    setStat('sRound', s.round);
    highlightEdge(op.from, op.to);
    logAdd(s.round, 'danger', `Port ${op.port} borders the already-located black hole; marked DANGEROUS without re-probing.`);
    finalizeCcp(op, true, []);
    s.currentOperation = null;
    return;
  }

  if (op.phase === 'send') {
    const batchSize = op.P.size === 0 ? ccpThreshold(s) : 1;
    const batch = pickNextProbeBatch(s, op, batchSize);

    if (batch.length === 0) {
      logAdd(s.round, 'warn', `No live agents available at node ${op.from} to continue CCP on ${op.port}; halting probe.`);
      finalizeCcp(op, op.D.size > op.R.size, []);
      s.currentOperation = null;
      return;
    }

    s.round++;
    s.activeAgentId = batch[0].id;
    setStat('sRound', s.round);
    highlightEdge(op.from, op.to);

    batch.forEach(a => { op.P.add(a.id); a.pos = op.to; });
    op.wave = batch.map(a => a.id);

    const ids = batch.map(a => `A${a.id}${a.byzantine ? '*' : ''}`).join(', ');
    logAdd(s.round, 'info', `CCP wave on port ${op.port}: sending ${ids} (probe ${op.P.size}/${2 * s.f + 1} max).`);
    updateCcpReadout(op.port, op.R.size, op.D.size, ccpThreshold(s));

    op.phase = 'await';
    return;
  }

  // phase === 'await': resolve this wave's outcome.
  s.round++;
  setStat('sRound', s.round);
  highlightEdge(op.from, op.to);

  const thresh = ccpThreshold(s);
  const returningIds = [];
  const stayingIds = [];

  op.wave.forEach(id => {
    const agent = s.agents.find(a => a.id === id);
    if (!agent || !agent.alive) return;
    const returns = agent.byzantine ? true : !op.dangerousTruth;
    if (returns) {
      agent.pos = op.from;
      op.R.add(id);
      returningIds.push(id);
    } else {
      agent.alive = false;
      agent.status = 'dead';
      agent.pos = op.to;
      s.lostInBH++;
      op.D.add(id);
      stayingIds.push(id);
    }
  });

  if (returningIds.length) {
    logAdd(s.round, 'safe', `A${returningIds.join(', A')} return through ${op.port}. RETURNED=${op.R.size}/${thresh}.`);
  }
  if (stayingIds.length) {
    logAdd(s.round, 'danger', `A${stayingIds.join(', A')} did NOT return through ${op.port}. FAILED-TO-RETURN=${op.D.size}/${thresh}.`);
  }
  s.currentNode = op.D.size >= op.R.size ? op.from : op.to;
  markCurrentNode(s.currentNode);
  updateCcpReadout(op.port, op.R.size, op.D.size, thresh);

  if (op.R.size >= thresh) {
    finalizeCcp(op, false, returningIds);
    s.currentOperation = null;
    return;
  }
  if (op.D.size >= thresh) {
    finalizeCcp(op, true, []);
    s.currentOperation = null;
    return;
  }

  // Neither threshold hit yet (some Byzantine agents muddied the count) —
  // cascade: send one more agent next round (Lines 17-20).
  op.phase = 'send';
}

function finalizeCcp(op, dangerous, returningIds) {
  const s = simState;
  const { from, to, label, port } = op;
  const key = edgeKey(from, to);
  const cyEdge = getCyEdge(from, to);
  cyEdge.removeClass('probing');
  hideCcpReadout();

  identifyByzantineFromProbe(op, dangerous);

  if (dangerous) {
    s.edgeStatus[key] = 'dangerous';
    s.found = true;
    s.bhLocated = true;
    s.currentNode = from;
    cyEdge.addClass('dangerous');
    cyRef.instance.getElementById(`n${to}`).removeClass('blackhole').addClass('revealed');
    logAdd(s.round, 'danger', `CCP resolved port ${port}: DANGEROUS — ${op.D.size} agent(s) failed to return (BH at node ${to}). Probe used ${op.P.size} agent(s).`);
    return;
  }

  s.currentNode = to;
  if (s.edgeStatus[key] === 'unknown') {
    s.edgeStatus[key] = 'safe';
    s.safeNodes.add(from);
    s.safeNodes.add(to);
    s.visitedNodes.add(to);
    cyEdge.addClass('safe');
    cyRef.instance.getElementById(`n${to}`).addClass('safe');
    cyRef.instance.getElementById(`n${from}`).addClass('safe');
    logAdd(s.round, 'safe', `${label}: CCP resolved port ${port} as SAFE — ${op.R.size} agent(s) returned. Probe used ${op.P.size} agent(s).`);
  }

  // Move every other live agent still waiting at `from` for this edge onward
  // too, so the team travels together once a port is certified safe.
  s.agents
    .filter(a => a.alive && a.pos === from && !op.P.has(a.id))
    .forEach(a => { a.pos = to; });
}

function identifyByzantineFromProbe(op, dangerous) {
  const s = simState;
  // An adversarial Byzantine agent always returns. If the port turned out to
  // be dangerous, every surviving returner that came from this probe's R set
  // is provably Byzantine (Line 31). If the port was safe, anyone who failed
  // to return (impossible for a truly-good agent on a safe port) would be
  // the giveaway (Line 25) — but since adversarial Byzantines always return,
  // that branch mainly matters for completeness.
  const suspects = dangerous ? op.R : op.D;
  suspects.forEach(id => {
    const agent = s.agents.find(a => a.id === id);
    if (!agent || !agent.byzantine || s.identifiedByzantine.has(id)) return;
    s.identifiedByzantine.add(id);
    agent.identified = true;
    logAdd(s.round, 'byz', `Byzantine agent A${id} IDENTIFIED — its return behavior on port ${op.port} contradicted the resolved status.`);
  });
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
  const op = s.currentOperation;
  let opFraction = 0;
  if (op) {
    if (op.kind === 'ccp') {
      const target = 2 * s.f + 1;
      opFraction = target > 0 ? Math.min(1, op.P.size / target) : 0;
    } else if (op.actions) {
      opFraction = op.index / op.actions.length;
    }
  }
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
  hideCcpReadout();
  ['sRound','sAlive','sLost','sByzFound','sEdgeSafe','sEdgeDanger'].forEach(id => setStat(id, '-'));
  $('progressBar').style.width = '0%';
  $('runBtn').disabled  = true;
  $('runBtn').textContent = 'RUN SIMULATION';
  $('stepBtn').disabled = true;
  $('overlay').className = '';
}
