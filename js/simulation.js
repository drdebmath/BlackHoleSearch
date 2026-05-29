// Black Hole Search simulation engine.
// Completely refactored for Dynamic Perpetual Exploration, Adversarial Controllers, 
// and Ephemeral Memory. Agents dynamically decide their routes tick-by-tick.

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
  const adv  = $('advModel') ? $('advModel').value : 'static';

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
    bhLocated: false,
    activeAgentId: null,
    identifiedByzantine: new Set(),
    lostInBH: 0,
    // NEW: Dynamic Swarm State
    bhActive: true,
    advModel: adv,
    ephemeralMemory: new Map() // Tracks the round an edge was validated
  };
  
  setSimState(state);

  cy.getElementById('n' + homebase).addClass('homebase');
  cy.getElementById('n' + bhNode).addClass(state.advModel === 'static' ? 'blackhole' : 'dormant');

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
  logAdd(0, 'system', `Swarm initialized: ${k} agents (${f} Byzantine) exploring ${n} nodes.`);
  logAdd(0, 'system', `Adversary Model: ${adv.toUpperCase()}`);
  logAdd(0, 'info', `Perpetual Exploration Mode Engaged. Ephemeral Memory active.`);

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
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function requiredAgents(know, comm, f, delta) {
  if (know === 'known') return 2 * f + 2;
  if (comm === 'whiteboard') return (f + 1) * (delta + 1);
  return (f + 1) * (delta + 1) + 3 * f + 1;
}

// ---------------------------------------------------------
// DYNAMIC ADVERSARY & MEMORY ENGINES
// ---------------------------------------------------------

function runAdversaryController(s) {
  const cy = cyRef.instance;
  const bhCyNode = cy.getElementById(`n${s.bhNode}`);
  let shouldActivate = true;

  if (s.advModel === 'probabilistic') {
    // 20% chance to activate every round
    shouldActivate = Math.random() < 0.20;
  } else if (s.advModel === 'intelligent') {
    // Wait until at least 2 GOOD agents are currently on the Black Hole node.
    const goodAgentsOnBH = s.agents.filter(a => a.alive && !a.byzantine && a.pos === s.bhNode).length;
    shouldActivate = goodAgentsOnBH >= 2;
  }

  // Visual & State Toggle
  if (shouldActivate !== s.bhActive) {
    s.bhActive = shouldActivate;
    if (s.bhActive) {
      bhCyNode.removeClass('dormant').addClass('blackhole');
      logAdd(s.round, 'danger', `Adversary activated the Black Hole at Node ${s.bhNode}!`);
    } else {
      bhCyNode.removeClass('blackhole').addClass('dormant');
      logAdd(s.round, 'warn', `Adversary deactivated Black Hole at Node ${s.bhNode} to lay a trap.`);
    }
  }
}

function processEphemeralMemory(s) {
  const MEMORY_LIMIT = 5; // Edges degrade to "unknown" after 5 rounds
  
  for (const [key, roundVerified] of s.ephemeralMemory.entries()) {
    if (s.round - roundVerified > MEMORY_LIMIT) {
      s.edgeStatus[key] = 'unknown';
      s.ephemeralMemory.delete(key);
      
      const [u, v] = key.split('-');
      const cyEdge = getCyEdge(+u, +v);
      if (cyEdge) cyEdge.removeClass('safe');
      
      logAdd(s.round, 'warn', `Network memory of edge ${key} decayed. It must be re-explored.`);
    }
  }
}

// ---------------------------------------------------------
// TICK-BASED SWARM ENGINE
// ---------------------------------------------------------

export function stepSimulation() {
  if (!simState || simState.done) return;
  const s = simState;

  s.round++;
  s.advModel = $('advModel') ? $('advModel').value : 'static';

  // 1. Trigger Subsystems
  runAdversaryController(s);
  processEphemeralMemory(s);
  
  cyRef.instance.edges().removeClass('probing');

  // 2. Agent Movement & Synergy
  s.agents.filter(a => a.alive).forEach(agent => {
    const options = s.ports[agent.pos] || [];
    if (options.length === 0) return;

    let targetNode = agent.pos;

    if (agent.byzantine) {
      // BYZANTINE SYNERGY: Lure good agents to the Black Hole
      if (options.includes(s.bhNode)) {
        targetNode = s.bhNode;
      } else {
        targetNode = options[Math.floor(Math.random() * options.length)];
      }
    } else {
      // GOOD AGENTS: Prefer unknown edges to map the network
      const safeOptions = [];
      const unknownOptions = [];
      
      options.forEach(opt => {
        const status = s.edgeStatus[edgeKey(agent.pos, opt)];
        if (status === 'unknown') unknownOptions.push(opt);
        if (status === 'safe') safeOptions.push(opt);
      });

      if (unknownOptions.length > 0) {
        targetNode = unknownOptions[Math.floor(Math.random() * unknownOptions.length)];
      } else if (safeOptions.length > 0) {
        targetNode = safeOptions[Math.floor(Math.random() * safeOptions.length)];
      }
    }

    // 3. Movement Resolution
    if (targetNode !== agent.pos) {
      const edgeStr = edgeKey(agent.pos, targetNode);
      highlightEdge(agent.pos, targetNode);
      
      if (targetNode === s.bhNode && s.bhActive) {
        // FATAL TRAP
        agent.alive = false;
        agent.status = 'dead';
        agent.pos = targetNode;
        s.lostInBH++;
        
        // Broadcast danger to network (Whiteboard Invalidates Node)
        s.edgeStatus[edgeStr] = 'dangerous';
        s.ephemeralMemory.delete(edgeStr);
        getCyEdge(agent.pos, targetNode).removeClass('safe').addClass('dangerous');
        logAdd(s.round, 'danger', `A${agent.id} lost in ACTIVE BBH at ${targetNode}! Network mapping updated.`);
      } else {
        // SAFE PASSAGE (Even over dormant BBH)
        agent.pos = targetNode;
        s.edgeStatus[edgeStr] = 'safe';
        s.ephemeralMemory.set(edgeStr, s.round);
        getCyEdge(agent.pos, targetNode).addClass('safe');
        
        if (targetNode === s.bhNode && !s.bhActive) {
          logAdd(s.round, 'byz', `A${agent.id} traversed DORMANT BBH at ${targetNode}. False trust established.`);
        }
      }
    }
  });

  // 4. End of Tick Evaluation
  refreshDisplay();

  const goodAgentsAlive = s.agents.filter(a => a.alive && !a.byzantine).length;
  if (goodAgentsAlive === 0) {
    logAdd(s.round, 'danger', 'ALL RELIABLE AGENTS ELIMINATED - SWARM DESTROYED');
    finishSim(false);
  }
}

// ---------------------------------------------------------
// UI AND UTILITIES
// ---------------------------------------------------------

function refreshDisplay() {
  const s = simState;
  const edgeSafe   = Object.values(s.edgeStatus).filter(v => v === 'safe').length;
  const edgeDanger = Object.values(s.edgeStatus).filter(v => v === 'dangerous').length;
  
  setStat('sRound', s.round);
  setStat('sEdgeSafe', edgeSafe);
  setStat('sEdgeDanger', edgeDanger);
  setStat('sAlive', s.agents.filter(a => a.alive).length);
  setStat('sLost', s.lostInBH);
  setStat('sByzFound', s.identifiedByzantine.size);
  
  // Progress is now dynamic based on mapped edges
  const classified = edgeSafe + edgeDanger;
  $('progressBar').style.width = Math.min(100, (classified / s.edges.length) * 100) + '%';
  
  updateAgentChips();
  updateEdgeTable();
  renderAgentsOnGraph();
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

  if (!success) {
    showOverlay('failure', 'SWARM ANNIHILATED', `The Adversary eliminated all reliable agents in ${s.round} rounds.`);
  }
  $('runBtn').disabled  = true;
  $('stepBtn').disabled = true;
}

function highlightEdge(from, to) {
  getCyEdge(from, to).addClass('probing');
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