// Black Hole Search simulation engine.
//
// Each `stepSimulation()` call probes one edge of a precomputed traversal
// (DFS for known-map, BFS for unknown-map) using a simplified Cautious
// Cyclic Probing (CCP) model: if the far endpoint is the black hole,
// up to f+1 good agents are lost; otherwise the edge is marked safe.

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

  const topo = $('topoSelect').value;
  const n    = +$('nNodes').value;
  const f    = +$('fFault').value;
  const comm = $('commModel').value;
  const know = $('topoKnow').value;

  const { nodes, edges } = generateGraph(topo, n);
  initCy(nodes, edges);
  const cy = cyRef.instance;

  const homebase = 0;
  let bhNode;
  do { bhNode = Math.floor(Math.random() * n); } while (bhNode === homebase);

  const neighbors = {};
  for (let i = 0; i < n; i++) neighbors[i] = [];
  edges.forEach(e => {
    const s = +e.data.source.slice(1);
    const t = +e.data.target.slice(1);
    neighbors[s].push(t);
    neighbors[t].push(s);
  });

  const delta = Math.max(...Object.values(neighbors).map(v => v.length));
  const k = Math.max(requiredAgents(know, comm, f, delta), f + 2);

  const agents = [];
  for (let i = 0; i < k; i++) {
    agents.push({
      id: i,
      pos: homebase,
      alive: true,
      byzantine: i < f,            // first f agents are byzantine
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
    edgeStatus[`${Math.min(s, t)}-${Math.max(s, t)}`] = 'unknown';
  });

  const state = {
    n, f, k, homebase, bhNode, agents, neighbors, ports, edges,
    edgeStatus, know, comm, delta,
    round: 0, done: false, found: false,
    currentNode: homebase,
    visitedNodes: new Set([homebase]),
    safeNodes: new Set([homebase]),
    traversalOrder: [],
    traversalIndex: 0,
    identifiedByzantine: new Set(),
    lostInBH: 0,
  };
  setSimState(state);

  cy.getElementById('n' + homebase).addClass('homebase');
  cy.getElementById('n' + bhNode).addClass('blackhole');

  state.traversalOrder = know === 'known'
    ? buildDFSOrder(state)
    : buildBFSOrder(state);

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
  logAdd(0, 'system', `Graph built: ${n} nodes, ${edges.length} edges, Δ=${delta}`);
  logAdd(0, 'system', `Black Hole at node ${bhNode} (hidden from agents)`);
  logAdd(0, 'system', `Team: k=${k} agents, f=${f} Byzantine`);
  logAdd(0, 'system', `Algorithm: ${know === 'known' ? 'WhiteboardMap/ProbeMap' : 'WhiteboardWithoutMap/ProbeWithoutMap'}`);
  logAdd(0, 'info',   `Homebase: node ${homebase}. Agents deployed.`);

  $('runBtn').disabled  = false;
  $('stepBtn').disabled = false;
  $('overlay').className = '';
  updateFormula();
}

function requiredAgents(know, comm, f, delta) {
  if (know === 'known') return 2 * f + 2;
  if (comm === 'whiteboard') return (f + 1) * (delta + 1);
  return (f + 1) * (delta + 1) + 3 * f + 1;
}

function buildDFSOrder(state) {
  const { homebase, bhNode, ports } = state;
  const visited = new Set([homebase]);
  const order = [];
  const dfs = (u) => {
    for (const v of (ports[u] || [])) {
      if (visited.has(v)) continue;
      visited.add(v);
      order.push({ from: u, to: v });
      if (v !== bhNode) dfs(v);
    }
  };
  dfs(homebase);
  return order;
}

function buildBFSOrder(state) {
  const { homebase, ports } = state;
  const visited = new Set([homebase]);
  const queue = [homebase];
  const order = [];
  while (queue.length) {
    const u = queue.shift();
    for (const v of (ports[u] || [])) {
      if (visited.has(v)) continue;
      visited.add(v);
      order.push({ from: u, to: v });
      queue.push(v);
    }
  }
  return order;
}

export function stepSimulation() {
  if (!simState || simState.done) return;

  const s = simState;
  s.round++;
  setStat('sRound', s.round);

  if (s.traversalIndex >= s.traversalOrder.length) {
    finishSim(true);
    return;
  }

  const { from, to } = s.traversalOrder[s.traversalIndex];
  const edgeKey = `${Math.min(from, to)}-${Math.max(from, to)}`;
  const isBH = (to === s.bhNode);
  const aliveGood = s.agents.filter(a => a.alive && !a.byzantine);
  const aliveByz  = s.agents.filter(a => a.alive && a.byzantine && !s.identifiedByzantine.has(a.id));

  const cy = cyRef.instance;
  const cyEdge = cy.edges().filter(e =>
    (e.data('source') === `n${from}` && e.data('target') === `n${to}`) ||
    (e.data('source') === `n${to}`   && e.data('target') === `n${from}`)
  );
  cy.edges().removeClass('probing');
  cyEdge.addClass('probing');

  if (isBH) {
    let lost = 0;
    for (const a of aliveGood) {
      if (lost >= s.f + 1) break;
      a.alive = false;
      a.status = 'dead';
      lost++;
    }
    s.lostInBH += lost;
    s.edgeStatus[edgeKey] = 'dangerous';
    cyEdge.removeClass('probing').addClass('dangerous');
    cy.getElementById(`n${to}`).removeClass('blackhole').addClass('revealed');
    logAdd(s.round, 'danger', `CCP on edge (${from}→${to}): BLACK HOLE DETECTED! ${lost} agent(s) lost.`);
    setStat('sLost', s.lostInBH);

    if (s.know === 'known') {
      finishSim(true);
      return;
    }
  } else {
    s.edgeStatus[edgeKey] = 'safe';
    s.safeNodes.add(to);
    s.visitedNodes.add(to);
    cyEdge.removeClass('probing').addClass('safe');
    cy.getElementById(`n${to}`).addClass('safe');

    if (aliveByz.length > 0 && Math.random() < 0.4) {
      const byz = aliveByz[0];
      s.identifiedByzantine.add(byz.id);
      byz.identified = true;
      logAdd(s.round, 'byz', `Byzantine agent A${byz.id} identified via CCP behavior on edge (${from}→${to})!`);
      setStat('sByzFound', s.identifiedByzantine.size);
    } else {
      logAdd(s.round, 'safe', `CCP on edge (${from}→${to}): SAFE. Node ${to} confirmed.`);
    }
  }

  s.currentNode = isBH ? from : to;
  s.agents.filter(a => a.alive).forEach(a => { a.pos = s.currentNode; });
  s.traversalIndex++;

  const edgeSafe   = Object.values(s.edgeStatus).filter(v => v === 'safe').length;
  const edgeDanger = Object.values(s.edgeStatus).filter(v => v === 'dangerous').length;
  setStat('sEdgeSafe',   edgeSafe);
  setStat('sEdgeDanger', edgeDanger);
  setStat('sAlive', s.agents.filter(a => a.alive).length);
  $('progressBar').style.width = (s.traversalIndex / s.traversalOrder.length * 100) + '%';

  if (s.agents.filter(a => a.alive && !a.byzantine).length === 0) {
    logAdd(s.round, 'danger', 'ALL GOOD AGENTS ELIMINATED — BHS FAILED');
    finishSim(false);
    return;
  }

  cy.getElementById(`n${s.currentNode}`).addClass('current');
  setTimeout(() => cy.getElementById(`n${s.currentNode}`).removeClass('current'), 300);

  updateAgentChips();
  updateEdgeTable();
  renderAgentsOnGraph();

  if (s.traversalIndex >= s.traversalOrder.length) {
    const bhFound = Object.values(s.edgeStatus).some(v => v === 'dangerous');
    finishSim(bhFound);
  }
}

function finishSim(success) {
  const s = simState;
  s.done = true;
  clearInterval(runRef.intervalId);
  runRef.intervalId = null;

  $('progressBar').style.width = '100%';
  cyRef.instance.edges().removeClass('probing');

  const survivors = s.agents.filter(a => a.alive && !a.byzantine).length;
  if (success) {
    logAdd(s.round, 'system', `━━ BH LOCATED at node ${s.bhNode} ━━`);
    logAdd(s.round, 'safe', `${survivors} good agent(s) survived. ${s.lostInBH} lost in BH.`);
    showOverlay('success', 'BLACK HOLE LOCATED',
      `Node ${s.bhNode} identified in ${s.round} rounds · ${survivors} survivors`);
  } else {
    logAdd(s.round, 'danger', `━━ BHS FAILED ━━`);
    showOverlay('failure', 'MISSION FAILED', `All good agents eliminated by round ${s.round}`);
  }
  $('runBtn').disabled  = true;
  $('stepBtn').disabled = true;
}

export function renderAgentsOnGraph() {
  if (!simState) return;
  cyRef.instance.nodes().forEach(node => {
    const nid = +node.id().slice(1);
    const agentsHere = simState.agents.filter(a => a.alive && a.pos === nid);
    const goodCount = agentsHere.filter(a => !a.byzantine).length;
    const byzCount  = agentsHere.filter(a =>  a.byzantine).length;
    let label = `${nid}`;
    if (goodCount > 0) label += `\n●${goodCount}`;
    if (byzCount  > 0) label += `\n◆${byzCount}`;
    node.data('label', label);
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
  ['sRound','sAlive','sLost','sByzFound','sEdgeSafe','sEdgeDanger'].forEach(id => setStat(id, '—'));
  $('progressBar').style.width = '0%';
  $('runBtn').disabled  = true;
  $('stepBtn').disabled = true;
  $('overlay').className = '';
}
