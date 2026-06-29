// Black Hole Search simulation engine.
//
// KEY FIXES over original:
//  1. CCP safe threshold  — edge becomes SAFE only after f+1 DISTINCT agents
//     return from it (tracked in edgeReturns per edge).
//  2. CCP danger threshold — edge becomes DANGEROUS after f+1 agents enter and
//     do NOT return (lostInBH per probing event, not global counter).
//  3. BH detection        — confirmed only after ≥ f+1 losses on that specific
//     edge, not loosely after any loss.
//  4. Whiteboard memory   — each node stores an append-only log; agents write
//     their ID + result when they visit or return.
//  5. Replay history      — every step snapshot saved; rewind/forward supported.

import { cyRef, runRef, simState, setSimState } from './state.js';
import { generateGraph } from './graph-generation.js';
import { initCy } from './cytoscape-setup.js';
import {
  $, setStat, logAdd, logClear,
  updateAgentChips, updateEdgeTable, updateWhiteboardPanel,
  updateTheoryPanel, updateReplayControls,
  showOverlay, updateFormula,
} from './ui.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function edgeKey(a, b) { return `${Math.min(a, b)}-${Math.max(a, b)}`; }

function getCyEdge(from, to) {
  return cyRef.instance.edges().filter(e =>
    (e.data('source') === `n${from}` && e.data('target') === `n${to}`) ||
    (e.data('source') === `n${to}`   && e.data('target') === `n${from}`)
  );
}

function highlightEdge(from, to) {
  cyRef.instance.edges().removeClass('probing ccp-active');
  getCyEdge(from, to).addClass('probing');
}

function markCurrentNode(nodeId) {
  cyRef.instance.nodes().removeClass('current');
  cyRef.instance.getElementById(`n${nodeId}`).addClass('current');
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

function requiredAgents(know, comm, f, delta) {
  if (know === 'known') return 2 * f + 2;
  if (comm === 'whiteboard') return (f + 1) * (delta + 1);
  return (f + 1) * (delta + 1) + 3 * f + 1;
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

// ── DFS Plan Builders ────────────────────────────────────────────────────────

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
        plan.push({ kind: 'move', from: v, to: u, classify: false, label: 'Return after cross-edge' });
      }
    }
  };

  dfs(homebase);
  return plan;
}

// ── Build Graph ──────────────────────────────────────────────────────────────

export function buildGraph() {
  clearInterval(runRef.intervalId);
  runRef.intervalId = null;
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

  const homebase  = 0;
  const neighbors = buildNeighbors(n, edges);
  const bhNode    = chooseBlackHole(n, homebase, neighbors, know);
  const delta     = Math.max(...Object.values(neighbors).map(v => v.length));
  const k         = Math.max(requiredAgents(know, comm, f, delta), f + 2);

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

  const edgeStatus  = {};
  // edgeReturns[key] = count of DISTINCT good agents that returned from that edge
  const edgeReturns = {};
  // edgeLosses[key]  = count of agents lost entering that specific edge (for danger threshold)
  const edgeLosses  = {};
  // agentReturnedEdge[agentId][key] = true if this agent already counted as a return
  const agentReturnedEdge = {};

  edges.forEach(e => {
    const s = +e.data.source.slice(1);
    const t = +e.data.target.slice(1);
    const key = edgeKey(s, t);
    edgeStatus[key]  = 'unknown';
    edgeReturns[key] = 0;
    edgeLosses[key]  = 0;
  });

  // Whiteboard: per-node append-only log (only used in whiteboard comm model)
  const whiteboard = {};
  for (let i = 0; i < n; i++) whiteboard[i] = [];

  const state = {
    n, f, k, homebase, bhNode, agents, neighbors, ports, edges,
    edgeStatus, edgeReturns, edgeLosses, agentReturnedEdge,
    whiteboard, know, comm, delta,
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
    // Replay
    history: [],
    historyIndex: 0,
    inReplay: false,
  };

  state.traversalOrder = know === 'known'
    ? buildKnownDFSPlan(state)
    : buildUnknownDFSPlan(state);

  setSimState(state);

  cy.getElementById('n' + homebase).addClass('homebase');
  cy.getElementById('n' + bhNode).addClass('blackhole');

  updateAgentChips();
  updateEdgeTable();
  updateWhiteboardPanel();
  updateTheoryPanel();
  renderAgentsOnGraph();
  setStat('sRound', 0);
  setStat('sAlive', agents.filter(a => a.alive).length);
  setStat('sLost', 0);
  setStat('sByzFound', 0);
  setStat('sEdgeSafe', 0);
  setStat('sEdgeDanger', 0);
  $('progressBar').style.width = '0%';

  logClear();
  logAdd(0, 'system', `Graph: ${n} nodes · ${edges.length} edges · Δ=${delta}`);
  logAdd(0, 'system', `Black Hole hidden at node ${bhNode}`);
  logAdd(0, 'system', `Team: k=${k} agents · f=${f} Byzantine`);
  logAdd(0, 'system', `Mode: ${know === 'known' ? 'Known Map' : 'Unknown Map'} · ${comm}`);
  logAdd(0, 'info',   `CCP thresholds: safe after ${f + 1} returns · danger after ${f + 1} losses`);
  logAdd(0, 'info',   `Homebase: node ${homebase}. DFS plan: ${state.traversalOrder.length} steps.`);

  $('runBtn').disabled  = false;
  $('stepBtn').disabled = false;
  $('overlay').className = '';
  updateFormula();
  updateReplayControls();
}

// ── Snapshot for Replay ──────────────────────────────────────────────────────

function takeSnapshot(s) {
  return JSON.parse(JSON.stringify({
    round: s.round,
    agents: s.agents,
    edgeStatus: s.edgeStatus,
    edgeReturns: s.edgeReturns,
    edgeLosses: s.edgeLosses,
    identifiedByzantine: [...s.identifiedByzantine],
    lostInBH: s.lostInBH,
    currentNode: s.currentNode,
    traversalIndex: s.traversalIndex,
    whiteboard: s.whiteboard,
    bhLocated: s.bhLocated,
    found: s.found,
    safeNodes: [...s.safeNodes],
    visitedNodes: [...s.visitedNodes],
    activeAgentId: s.activeAgentId,
  }));
}

function applySnapshot(s, snap) {
  s.round         = snap.round;
  s.agents        = snap.agents;
  s.edgeStatus    = snap.edgeStatus;
  s.edgeReturns   = snap.edgeReturns;
  s.edgeLosses    = snap.edgeLosses;
  s.identifiedByzantine = new Set(snap.identifiedByzantine);
  s.lostInBH      = snap.lostInBH;
  s.currentNode   = snap.currentNode;
  s.traversalIndex = snap.traversalIndex;
  s.whiteboard    = snap.whiteboard;
  s.bhLocated     = snap.bhLocated;
  s.found         = snap.found;
  s.safeNodes     = new Set(snap.safeNodes);
  s.visitedNodes  = new Set(snap.visitedNodes);
  s.activeAgentId = snap.activeAgentId;
  s.currentOperation = null;
}

// Replay: step backward
export function replayBack() {
  const s = simState;
  if (!s || s.historyIndex <= 0) return;
  s.historyIndex--;
  applySnapshot(s, s.history[s.historyIndex]);
  s.inReplay = true;
  rebuildCyFromState();
  refreshDisplay();
  updateReplayControls();
}

// Replay: step forward into history (without simulating new steps)
export function replayForward() {
  const s = simState;
  if (!s) return;
  if (s.historyIndex < s.history.length - 1) {
    s.historyIndex++;
    applySnapshot(s, s.history[s.historyIndex]);
    s.inReplay = true;
    rebuildCyFromState();
    refreshDisplay();
    updateReplayControls();
  } else {
    // At tip of history — exit replay mode
    s.inReplay = false;
    s.historyIndex = s.history.length;
    updateReplayControls();
  }
}

function rebuildCyFromState() {
  const s = simState;
  const cy = cyRef.instance;
  if (!cy) return;

  // Reset all node/edge classes then reapply from state
  cy.nodes().removeClass('safe blackhole revealed current homebase');
  cy.edges().removeClass('safe dangerous probing ccp-active');

  cy.getElementById(`n${s.homebase}`).addClass('homebase');

  for (const [key, status] of Object.entries(s.edgeStatus)) {
    const [a, b] = key.split('-').map(Number);
    const edge = getCyEdge(a, b);
    if (status === 'safe') edge.addClass('safe');
    else if (status === 'dangerous') edge.addClass('dangerous');
  }

  for (const nodeId of s.safeNodes) {
    cy.getElementById(`n${nodeId}`).addClass('safe');
  }

  if (s.bhLocated) {
    cy.getElementById(`n${s.bhNode}`).removeClass('blackhole').addClass('revealed');
  } else {
    cy.getElementById(`n${s.bhNode}`).addClass('blackhole');
  }

  markCurrentNode(s.currentNode);
}

// ── Step Simulation ──────────────────────────────────────────────────────────

export function stepSimulation() {
  if (!simState || simState.done) return;

  const s = simState;

  // If in replay mode at a past index, advance to tip first
  if (s.inReplay) {
    s.inReplay = false;
    s.historyIndex = s.history.length;
    rebuildCyFromState();
    updateReplayControls();
    return;
  }

  // Save snapshot before this step
  s.history.push(takeSnapshot(s));
  s.historyIndex = s.history.length;

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
    logAdd(s.round, 'danger', 'No valid action — halting.');
    finishSim(false);
    return;
  }

  s.round++;
  s.activeAgentId = action.agentId ?? null;
  setStat('sRound', s.round);
  highlightEdge(op.step.from, op.step.to);

  if (action.type === 'move') {
    moveAgent(action.agentId, op.step.from, op.step.to);
  } else if (action.type === 'probe-return') {
    recordProbeReturn(action.agentId, op.step.from, op.step.to);
  } else if (action.type === 'lose') {
    loseAgentToBlackHole(action.agentId, op.step.from, op.step.to);
  } else if (action.type === 'markDanger') {
    logAdd(s.round, 'danger', `Edge (${op.step.from}→${op.step.to}) already confirmed BH boundary — skipping re-probe.`);
  } else if (action.type === 'markMoveOnly') {
    s.currentNode = op.step.to;
    markCurrentNode(op.step.to);
  } else if (action.type === 'noop') {
    logAdd(s.round, 'info', 'No movement required this round.');
  }

  if (op.index >= op.actions.length) {
    completeOperation(op);
    s.currentOperation = null;
    s.traversalIndex++;
  }

  if (s.agents.filter(a => a.alive && !a.byzantine).length === 0) {
    logAdd(s.round, 'danger', 'ALL GOOD AGENTS ELIMINATED — BHS FAILED');
    finishSim(false);
    return;
  }

  if (!s.currentOperation && shouldFinish(s)) {
    finishSim(finishWasSuccessful(s));
  }

  refreshDisplay();
  updateReplayControls();
}

// ── Operation Builder ────────────────────────────────────────────────────────
//
// Each "operation" covers one DFS plan step and expands it into atomic sub-actions
// (one per visual round).  The CCP model is:
//
//   Probe (classify=true):
//     Phase 1 — send agents one-by-one toward `to`.
//       • If `to` is BH: agent is lost (type='lose').
//         After f+1 losses on this edge → BH confirmed.
//       • If `to` is safe: agent moves there (type='move').
//     Phase 2 — agents return one-by-one back to `from` (type='probe-return').
//       After f+1 distinct returns on this edge → edge certified safe.
//
//   Backtrack (classify=false):
//     Just moves all agents from `to` back to `from` (type='move').

function prepareOperation(s, step) {
  if (!step) {
    return { step: { from: s.currentNode, to: s.currentNode, kind: 'noop', classify: false, label: 'noop' }, actions: [{ type: 'noop' }], index: 0 };
  }

  const { from, to, classify } = step;
  const dangerous = to === s.bhNode;
  const key = edgeKey(from, to);
  const actions = [];

  if (classify) {
    if (dangerous && !s.bhLocated) {
      // ── CCP Dangerous Phase ──
      // Send up to f+1 good agents into the BH one by one.
      // Already-lost agents on this edge count toward the threshold.
      const alreadyLost = s.edgeLosses[key] || 0;
      const needed = Math.max(0, (s.f + 1) - alreadyLost);
      const available = s.agents.filter(a => a.alive && !a.byzantine && a.pos === from);

      if (needed === 0) {
        // Threshold already met from a prior pass
        actions.push({ type: 'markDanger' });
      } else {
        const probes = available.slice(0, needed);
        probes.forEach(agent => actions.push({ type: 'lose', agentId: agent.id }));
        if (probes.length < needed) {
          logAdd(s.round, 'warn', `Only ${probes.length}/${needed} good agents available for CCP loss threshold on edge (${from}→${to}).`);
        }
      }
    } else if (!dangerous) {
      // ── CCP Safe Phase ──
      // 1) Move agents forward to `to`
      const goers = s.agents.filter(a => a.alive && a.pos === from);
      goers.forEach(agent => actions.push({ type: 'move', agentId: agent.id }));

      // 2) Return good agents back (each return increments edgeReturns)
      //    Byzantine agents may not return (they lie), but good ones do.
      const goodGoers = goers.filter(a => !a.byzantine);
      goodGoers.forEach(agent => actions.push({ type: 'probe-return', agentId: agent.id }));

      if (goers.length === 0) {
        actions.push({ type: 'markMoveOnly' });
      }
    } else if (dangerous && s.bhLocated) {
      actions.push({ type: 'markDanger' });
    }
  } else {
    // ── Backtrack (no classification) ──
    const movers = s.agents.filter(a => a.alive && a.pos === from);
    movers.forEach(agent => actions.push({ type: 'move', agentId: agent.id }));
    if (movers.length === 0) {
      actions.push({ type: 'markMoveOnly' });
    }
  }

  if (actions.length === 0) actions.push({ type: 'noop' });

  return { step, actions, index: 0 };
}

// ── Action Handlers ──────────────────────────────────────────────────────────

function moveAgent(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;
  agent.pos = to;
  s.currentNode = to;
  markCurrentNode(to);

  // Whiteboard write: agent logs arrival
  if (s.comm === 'whiteboard' && s.whiteboard[to] !== undefined) {
    s.whiteboard[to].push(`A${agent.id} arrived (R${s.round})`);
  }

  logAdd(s.round, agent.byzantine ? 'byz' : 'info',
    `A${agent.id} moves n${from}→n${to} [${agent.byzantine ? 'Byzantine' : 'good'}]`);
}

function recordProbeReturn(agentId, from, to) {
  // Agent was at `to` (from the forward move), now returns to `from`.
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;

  const key = edgeKey(from, to);

  // Only count this agent's return once per edge
  if (!s.agentReturnedEdge[agentId]) s.agentReturnedEdge[agentId] = {};
  if (!s.agentReturnedEdge[agentId][key]) {
    s.agentReturnedEdge[agentId][key] = true;
    if (!agent.byzantine) {
      s.edgeReturns[key] = (s.edgeReturns[key] || 0) + 1;
    }
  }

  agent.pos = from;
  s.currentNode = from;
  markCurrentNode(from);

  // Whiteboard write: agent logs return
  if (s.comm === 'whiteboard' && s.whiteboard[from] !== undefined) {
    s.whiteboard[from].push(`A${agent.id} returned from n${to} (R${s.round})`);
  }

  logAdd(s.round, agent.byzantine ? 'byz' : 'info',
    `A${agent.id} returns n${to}→n${from} [${agent.byzantine ? 'Byzantine' : 'good'}] · returns on edge ${key}: ${s.edgeReturns[key]}/${s.f + 1}`);
}

function loseAgentToBlackHole(agentId, from, to) {
  const s = simState;
  const agent = s.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;
  agent.alive  = false;
  agent.status = 'dead';
  agent.pos    = to;

  const key = edgeKey(from, to);
  s.edgeLosses[key] = (s.edgeLosses[key] || 0) + 1;
  s.lostInBH++;
  s.currentNode = from;
  markCurrentNode(from);

  logAdd(s.round, 'danger',
    `A${agent.id} enters n${from}→n${to} and is LOST in BH · losses on edge ${key}: ${s.edgeLosses[key]}/${s.f + 1}`);
}

// ── Complete an Operation ────────────────────────────────────────────────────

function completeOperation(op) {
  const s = simState;
  const { from, to, classify } = op.step;
  const key      = edgeKey(from, to);
  const cyEdge   = getCyEdge(from, to);
  const dangerous = to === s.bhNode;

  cyEdge.removeClass('probing ccp-active');

  if (dangerous) {
    const losses = s.edgeLosses[key] || 0;
    if (losses >= s.f + 1) {
      // ── BH confirmed by threshold ──
      s.edgeStatus[key] = 'dangerous';
      s.found      = true;
      s.bhLocated  = true;
      s.currentNode = from;
      cyEdge.addClass('dangerous');
      cyRef.instance.getElementById(`n${to}`).removeClass('blackhole').addClass('revealed');
      logAdd(s.round, 'danger',
        `✓ BH CONFIRMED on edge (${from}→${to}): ${losses} losses ≥ threshold f+1=${s.f + 1}. Black hole is node ${to}.`);
    } else {
      logAdd(s.round, 'warn',
        `Edge (${from}→${to}): ${losses} loss(es) so far, need f+1=${s.f + 1} to confirm BH.`);
    }
    return;
  }

  // Safe edge: confirmed only when edgeReturns[key] >= f+1
  s.currentNode = to;
  if (classify) {
    const returns = s.edgeReturns[key] || 0;
    if (returns >= s.f + 1 && s.edgeStatus[key] !== 'safe') {
      s.edgeStatus[key] = 'safe';
      s.safeNodes.add(from);
      s.safeNodes.add(to);
      s.visitedNodes.add(to);
      cyEdge.addClass('safe');
      cyRef.instance.getElementById(`n${to}`).addClass('safe');
      cyRef.instance.getElementById(`n${from}`).addClass('safe');
      maybeIdentifyByzantine(from, to);
      logAdd(s.round, 'safe',
        `✓ Edge (${from}→${to}) SAFE: ${returns} confirmed returns ≥ f+1=${s.f + 1}.`);
    } else if (s.edgeStatus[key] !== 'safe') {
      logAdd(s.round, 'warn',
        `Edge (${from}→${to}): ${returns}/${s.f + 1} returns so far — not yet certified safe.`);
    }
  }
}

// ── Byzantine Identification ─────────────────────────────────────────────────

function maybeIdentifyByzantine(from, to) {
  const s = simState;
  const aliveByz = s.agents.filter(a => a.alive && a.byzantine && !s.identifiedByzantine.has(a.id));
  if (aliveByz.length === 0 || Math.random() >= 0.4) return;

  const byz = aliveByz[0];
  s.identifiedByzantine.add(byz.id);
  byz.identified = true;

  // Whiteboard: mark identified
  if (s.comm === 'whiteboard' && s.whiteboard[from] !== undefined) {
    s.whiteboard[from].push(`⚠ A${byz.id} identified as Byzantine (R${s.round})`);
  }

  logAdd(s.round, 'byz',
    `☿ Byzantine A${byz.id} identified via inconsistent CCP behaviour on edge (${from}→${to})!`);
}

// ── Finish Conditions ────────────────────────────────────────────────────────

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
  return Object.values(s.edgeStatus).every(st => st !== 'unknown');
}

// ── Display Refresh ──────────────────────────────────────────────────────────

function refreshDisplay() {
  const s = simState;
  const edgeSafe   = Object.values(s.edgeStatus).filter(v => v === 'safe').length;
  const edgeDanger = Object.values(s.edgeStatus).filter(v => v === 'dangerous').length;
  setStat('sEdgeSafe',   edgeSafe);
  setStat('sEdgeDanger', edgeDanger);
  setStat('sAlive',      s.agents.filter(a => a.alive).length);
  setStat('sLost',       s.lostInBH);
  setStat('sByzFound',   s.identifiedByzantine.size);
  $('progressBar').style.width = progressPercent(s) + '%';
  updateAgentChips();
  updateEdgeTable();
  updateWhiteboardPanel();
  updateTheoryPanel();
  renderAgentsOnGraph();
}

function progressPercent(s) {
  if (s.know === 'unknown') {
    const classified = Object.values(s.edgeStatus).filter(st => st !== 'unknown').length;
    return Math.min(100, classified / s.edges.length * 100);
  }
  if (s.traversalOrder.length === 0) return 100;
  const opFraction = s.currentOperation
    ? s.currentOperation.index / s.currentOperation.actions.length
    : 0;
  return Math.min(100, (s.traversalIndex + opFraction) / s.traversalOrder.length * 100);
}

// ── Finish ───────────────────────────────────────────────────────────────────

function finishSim(success) {
  const s = simState;
  s.done          = true;
  s.activeAgentId = null;
  clearInterval(runRef.intervalId);
  runRef.intervalId = null;

  cyRef.instance.edges().removeClass('probing ccp-active');
  refreshDisplay();
  $('progressBar').style.width = '100%';
  $('runBtn').textContent = '▶ RUN SIMULATION';

  const survivors = s.agents.filter(a => a.alive && !a.byzantine).length;
  if (success) {
    const note = s.know === 'unknown'
      ? `All ${s.edges.length} edges explored & classified.`
      : 'DFS halted after BH localisation.';
    logAdd(s.round, 'system', `BH LOCATED at node ${s.bhNode}`);
    logAdd(s.round, 'safe',   `${survivors} good agent(s) survived · ${s.lostInBH} lost in BH · ${note}`);
    showOverlay('success', 'BLACK HOLE LOCATED',
      `Node ${s.bhNode} identified in ${s.round} rounds — ${survivors} survivors`);
  } else {
    const unknownLeft = Object.values(s.edgeStatus).filter(v => v === 'unknown').length;
    logAdd(s.round, 'danger', 'BHS FAILED');
    showOverlay('failure', 'MISSION FAILED',
      unknownLeft > 0
        ? `${unknownLeft} edge(s) remained unexplored`
        : `All good agents eliminated by round ${s.round}`);
  }

  $('runBtn').disabled  = true;
  $('stepBtn').disabled = true;
  updateReplayControls();
}

// ── Agent Rendering ───────────────────────────────────────────────────────────

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
    if (goodCount > 0) label += `\nG:${goodCount}`;
    if (byzCount  > 0) label += `\nB:${byzCount}`;
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
    const pos  = node.renderedPosition();
    const orbit = agents.length === 1 ? 23 : Math.min(36, 19 + agents.length * 2.5);

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
        'agent-particle', kind,
        simState.activeAgentId === agent.id ? 'active' : '',
      ].filter(Boolean).join(' ');
      particle.style.transform = `translate(${x}px, ${y}px)`;
      particle.dataset.agentId = `A${agent.id}`;
      particle.title = `A${agent.id} [${agent.byzantine ? 'Byzantine' : 'good'}]`;
      layer.appendChild(particle);
    });
  });
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export function resetSimulation() {
  clearInterval(runRef.intervalId);
  runRef.intervalId = null;
  setSimState(null);
  if (cyRef.instance) {
    cyRef.instance.destroy();
    cyRef.instance = null;
  }
  logClear();
  $('edgeTable').innerHTML    = '';
  $('agentList').innerHTML    = '';
  $('agentLayer').innerHTML   = '';
  const wbPanel = $('wbPanel');
  if (wbPanel) wbPanel.innerHTML = '';
  const theoryPanel = $('theoryPanel');
  if (theoryPanel) theoryPanel.innerHTML = '';
  ['sRound','sAlive','sLost','sByzFound','sEdgeSafe','sEdgeDanger'].forEach(id => setStat(id, '—'));
  $('progressBar').style.width = '0%';
  $('runBtn').disabled   = true;
  $('runBtn').textContent = '▶ RUN SIMULATION';
  $('stepBtn').disabled  = true;
  $('overlay').className = '';
  updateReplayControls();
}
