import { generateGraph } from './graph-generation.js';
import { STYLE } from './cytoscape-setup.js';

const q = id => document.getElementById(id);
let cy2 = null;

// Use shared STYLE from sim1 for visual parity

function initCy2(nodes, edges) {
  if (!q('cy2')) return;
  if (cy2) cy2.destroy();
  cy2 = cytoscape({
    container: q('cy2'),
    elements: { nodes, edges },
    style: STYLE,
    layout: { name: 'preset', padding: 40, animate: false },
  });
  // expose for runtime inspection and debugging
  try { window.cy2 = cy2; } catch (e) { /* ignore */ }
  if (q('cy2')) {
    q('cy2').dataset.nodeCount = String(nodes.length || 0);
    q('cy2').dataset.edgeCount = String(edges.length || 0);
  }
  cy2.on('mouseover', 'node', showTooltip2);
  cy2.on('mouseout', 'node', () => { q('tooltip2').style.display = 'none'; });
}

function showTooltip2(evt) {
  const node = evt.target;
  const index = Number(node.id().slice(1));
  const tooltip = q('tooltip2');
  const pos = node.renderedPosition();
  const agentsHere = state.agents.filter(agent => agent.alive && agent.pos === index);
  const status = index === 0 ? 'Home node' : index === state.bhIndex ? 'Byzantine Black Hole' : (state.safeBoundary !== null && index <= state.safeBoundary ? 'Safe node' : 'Path node');
  const agentList = agentsHere.length ? agentsHere.map(agent => agent.id).join(', ') : 'none';
  tooltip.innerHTML = `<b>n${index}</b><br>${status}<br>Agents: ${agentList}`;
  tooltip.style.left = `${pos.x + 18}px`;
  tooltip.style.top = `${pos.y - 34}px`;
  tooltip.style.display = 'block';
}

const explorerPatterns = [
  [1, 0, 0, 0],
  [2, 1, 0, 0],
  [3, 2, 1, 0],
  [4, 3, 2, 1],
  [5, 4, 3, 2],
  [4, 3, 2, 1],
  [3, 2, 1, 0],
  [2, 1, 0, 0],
  [1, 0, 0, 0],
  [0, 0, 0, 0],
];

const phaseLabels = {
  formation: 'Explorer formation',
  'waiter-search': 'Waiters probing BBH boundary',
  'home-explore': 'Perpetual home component exploration',
  completed: 'Simulation completed',
};

const state = {
  round: 0,
  nodeCount: 7,
  bhIndex: 4,
  agents: [],
  phase: 'formation',
  safeBoundary: null,
  probeStep: null,
  homeCycle: 0,
  bhRevealed: false,
  log: [],
  intervalId: null,
  bhLocated: false,
  homeExploreStarted: false,
};

function makeAgents() {
  return [
    { id: 'F1', role: 'waiter', pos: 0, alive: true },
    { id: 'F2', role: 'waiter', pos: 0, alive: true },
    { id: 'L', role: 'leader', pos: 0, alive: true },
    { id: 'I1', role: 'intermediate', pos: 0, alive: true },
    { id: 'I2', role: 'intermediate', pos: 0, alive: true },
    { id: 'F', role: 'follower', pos: 0, alive: true },
  ];
}

function buildPathElements() {
  const nodes = [];
  const edges = [];
  const spacing = 120;
  const centerOffset = (state.nodeCount - 1) * spacing / 2;

  for (let index = 0; index < state.nodeCount; index += 1) {
    nodes.push({
      data: { id: `n${index}`, label: `${index}` },
      position: { x: index * spacing - centerOffset, y: 0 },
    });
    if (index < state.nodeCount - 1) {
      edges.push({ data: { id: `e${index}-${index + 1}`, source: `n${index}`, target: `n${index + 1}` } });
    }
  }

  initCy2(nodes, edges);
}

function addLog(text, style = 'info') {
  state.log.unshift({ round: state.round, text, style });
  if (state.log.length > 18) state.log.pop();
}

function getAgent(agentId) {
  return state.agents.find(agent => agent.id === agentId);
}

function aliveAgents() {
  return state.agents.filter(agent => agent.alive);
}

function explorerAgents() {
  return state.agents.filter(agent => agent.role !== 'waiter');
}

function explorersReturnedHome() {
  return explorerAgents().every(agent => !agent.alive || agent.pos === 0);
}

function getAliveCounts() {
  return {
    total: aliveAgents().length,
    explorers: explorerAgents().filter(agent => agent.alive).length,
    waiters: state.agents.filter(agent => agent.role === 'waiter' && agent.alive).length,
    dead: state.agents.filter(agent => !agent.alive).length,
  };
}

function renderSim2() {
  if (cy2) {
    cy2.nodes().forEach(node => {
      const index = Number(node.id().slice(1));
      node.removeClass('home bh safe');
      if (index === 0) node.addClass('home');
      if (index === state.bhIndex && state.bhRevealed) node.addClass('bh');
      if (state.safeBoundary !== null && index <= state.safeBoundary) node.addClass('safe');

      const agentsHere = state.agents.filter(agent => agent.alive && agent.pos === index);
      const label = agentsHere.length
        ? `${index}\n${agentsHere.map(agent => agent.id).join(',')}`
        : `${index}`;
      node.data('label', label);
    });
    cy2.resize();
    cy2.fit();
  }

  q('sim2Round').textContent = String(state.round);
  const counts = getAliveCounts();
  q('sim2Alive').textContent = String(counts.total);
  q('sim2Explorers').textContent = String(counts.explorers);
  q('sim2Waiters').textContent = String(counts.waiters);
  q('sim2Dead').textContent = String(counts.dead);
  q('sim2Phase').textContent = phaseLabels[state.phase] || '—';
  q('sim2Boundary').textContent = state.safeBoundary === null ? 'unknown' : state.safeBoundary;

  const logRoot = q('sim2Log');
  if (!state.log.length) {
    logRoot.innerHTML = '<div class="sim2-log-entry sim2-muted">Simulation initialized. Press step or run.</div>';
  } else {
    logRoot.innerHTML = state.log
      .map(entry => {
        const label = entry.round ? `Round ${entry.round}` : 'Start';
        const colorClass = entry.style === 'danger' ? 'sim2-log-danger' : entry.style === 'warn' ? 'sim2-log-warn' : entry.style === 'safe' ? 'sim2-log-safe' : 'sim2-log-info';
        return `<div class="sim2-log-entry ${colorClass}"><div class="sim2-log-label">${label}</div><div>${entry.text}</div></div>`;
      })
      .join('');
  }

  updateRunButton();
}

function updateRunButton() {
  q('sim2RunBtn').textContent = state.intervalId ? '⏸ PAUSE' : '▶ RUN SIMULATION';
}

function chooseAdversaryActivation() {
  const mode = q('sim2AdversaryMode').value;
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return Math.random() < 0.5;
}

function checkBlackHoleActivation() {
  const visitors = state.agents.filter(agent => agent.alive && agent.role !== 'waiter' && agent.pos === state.bhIndex);
  if (!visitors.length) return;

  const destroyed = chooseAdversaryActivation();
  if (destroyed) {
    visitors.forEach(agent => {
      agent.alive = false;
      agent.pos = null;
    });
    state.bhLocated = true;
    state.bhRevealed = true;
    addLog(`BBH activates and destroys ${visitors.map(agent => agent.id).join(', ')} at node ${state.bhIndex}.`, 'danger');
    const survivors = explorerAgents().filter(agent => agent.alive).map(agent => agent.id);
    if (survivors.length) {
      addLog(`Survivor(s) ${survivors.join(', ')} infer the BBH location from the missing formation.`, 'byz');
    }
  } else {
    state.bhRevealed = false;
    addLog(`BBH withheld destruction at node ${state.bhIndex}; explorers mark the node suspicious.`, 'warn');
  }
}

function applyFormationStep() {
  const pattern = explorerPatterns[Math.min(state.round - 1, explorerPatterns.length - 1)];
  const explorerOrder = ['L', 'I1', 'I2', 'F'];
  explorerOrder.forEach((id, index) => {
    const agent = getAgent(id);
    if (!agent || !agent.alive) return;
    agent.pos = pattern[index];
  });
  const movement = pattern.map((pos, idx) => `${['L', 'I1', 'I2', 'F'][idx]}→${pos}`).join(', ');
  addLog(`Explorers advance: ${movement}.`, 'info');
  checkBlackHoleActivation();
}

function stepWaiterSearch() {
  if (!state.probeStep) {
    state.probeStep = { nextMover: 'F1', nextIndex: 1 };
    addLog('Waiters begin cautious probing of the home component boundary.', 'warn');
  }

  const mover = getAgent(state.probeStep.nextMover);
  if (!mover || !mover.alive) {
    const alternative = state.agents.find(agent => agent.role === 'waiter' && agent.alive);
    if (!alternative) {
      state.phase = 'completed';
      addLog('Both waiters have been lost before boundary detection completed.', 'danger');
      return;
    }
    state.probeStep.nextMover = alternative.id;
    return;
  }

  const targetIndex = state.probeStep.nextIndex;
  if (targetIndex >= state.nodeCount) {
    state.safeBoundary = state.nodeCount - 1;
    state.phase = 'home-explore';
    addLog('Waiters confirmed the path beyond the home boundary as safe.', 'safe');
    return;
  }

  if (targetIndex === state.bhIndex) {
    mover.alive = false;
    mover.pos = null;
    state.bhRevealed = true;
    state.safeBoundary = targetIndex - 1;
    state.phase = 'home-explore';
    addLog(`${mover.id} died at node ${targetIndex}; home safe boundary is node ${state.safeBoundary}.`, 'danger');
    return;
  }

  mover.pos = targetIndex;
  addLog(`${mover.id} cautiously advances to node ${targetIndex} while partner watches.`, 'info');
  state.probeStep.nextIndex += 1;
  state.probeStep.nextMover = mover.id === 'F1' ? 'F2' : 'F1';
}

function stepHomeExploration() {
  if (!state.homeExploreStarted) {
    state.homeExploreStarted = true;
    addLog(`Waiters are now perpetually exploring safe home component [0..${state.safeBoundary}].`, 'safe');
  }

  const aliveWaiters = state.agents.filter(agent => agent.role === 'waiter' && agent.alive);
  if (!aliveWaiters.length) {
    state.phase = 'completed';
    addLog('No waiters remain to continue safe exploration.', 'danger');
    return;
  }

  if (state.safeBoundary === null) {
    state.safeBoundary = 0;
  }

  const stepIndex = state.homeCycle % (state.safeBoundary + 1);
  if (aliveWaiters.length === 2) {
    aliveWaiters[0].pos = stepIndex;
    aliveWaiters[1].pos = state.safeBoundary - stepIndex;
  } else {
    aliveWaiters[0].pos = stepIndex;
  }

  state.homeCycle += 1;
  if (state.homeCycle > (state.safeBoundary + 1) * 2) {
    state.homeCycle = 0;
  }
}

function stepSim2() {
  if (state.phase === 'completed') {
    addLog('Simulation has completed. Reset to run again.', 'warn');
    return;
  }

  state.round += 1;

  if (state.phase === 'formation') {
    applyFormationStep();
    if (state.round === explorerPatterns.length) {
      if (!explorersReturnedHome()) {
        state.phase = 'waiter-search';
        addLog('Explorers failed to return in the expected time; waiters begin cautious boundary detection.', 'danger');
      } else {
        state.phase = 'home-explore';
        state.safeBoundary = state.safeBoundary === null ? state.nodeCount - 1 : state.safeBoundary;
        addLog('Explorers returned safely. Waiters continue perpetual exploration of the safe home component.', 'safe');
      }
    }
  } else if (state.phase === 'waiter-search') {
    stepWaiterSearch();
  } else if (state.phase === 'home-explore') {
    stepHomeExploration();
  }

  if (state.phase === 'completed' && state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  renderSim2();
}

function resetSim2() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  state.round = 0;
  state.agents = makeAgents();
  state.phase = 'formation';
  state.safeBoundary = null;
  state.probeStep = null;
  state.homeCycle = 0;
  state.bhRevealed = false;
  state.bhLocated = false;
  state.homeExploreStarted = false;
  state.log = [];
  buildSim2();
}

function buildSim2() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  state.nodeCount = Math.max(6, Math.min(10, Number(q('sim2PathSize').value)));
  const maxIndex = state.nodeCount - 2;
  const minIndex = Math.max(3, Math.floor(state.nodeCount / 2));
  state.bhIndex = Math.min(maxIndex, Math.max(minIndex, Math.floor(Math.random() * (state.nodeCount - 4)) + 3));
  state.agents = makeAgents();
  state.round = 0;
  state.phase = 'formation';
  state.safeBoundary = null;
  state.probeStep = null;
  state.homeCycle = 0;
  state.bhRevealed = false;
  state.bhLocated = false;
  state.homeExploreStarted = false;
  state.log = [];

  // Build nodes/edges via shared generator and initialize cy2 with the same style/layout as sim1
  const topo = q('sim2TopoSelect') ? q('sim2TopoSelect').value : 'random';
  const { nodes, edges } = generateGraph(topo, state.nodeCount);
  initCy2(nodes, edges);
  if (cy2) {
    const homeId = `n0`;
    const bhId = `n${state.bhIndex}`;
    const nHome = cy2.getElementById(homeId);
    const nBh = cy2.getElementById(bhId);
    if (nHome && nHome.length) nHome.addClass('home');
    if (nBh && nBh.length) nBh.addClass('bh');
  }

  addLog('Byzantine BBH home exploration simulation initialized.', 'info');
  renderSim2();
}

function toggleRunSim2() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
    updateRunButton();
    addLog('Simulation paused.', 'warn');
    renderSim2();
    return;
  }

  const interval = Number(q('sim2SpeedSel').value);
  state.intervalId = setInterval(() => {
    stepSim2();
    if (state.phase === 'completed' && state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
      updateRunButton();
    }
  }, interval);
  updateRunButton();

  // Start running; UI will update on the next tick via renderSim2
  addLog('Simulation started.', 'info');
  renderSim2();
}

function switchSimulation(value) {
  const sim1 = q('sim1-container');
  const sim2 = q('sim2-container');
  if (!sim1 || !sim2) return;
  if (value === 'sim2') {
    sim1.style.display = 'none';
    sim2.style.display = 'flex';
  } else {
    sim1.style.display = '';
    sim2.style.display = 'none';
  }
  q('sim2Select').value = value === 'sim2' ? 'sim2' : 'sim1';
  updateSimulationIndicator(value);
}

function updateSimulationIndicator(value) {
  const indicator = q('simIndicator');
  if (!indicator) return;
  indicator.textContent = value === 'sim2'
    ? 'Active: Byzantine BBH Home Exploration'
    : 'Active: Classical Black Hole Search';
}

function installEventHandlers() {
  q('sim2BuildBtn').addEventListener('click', buildSim2);
  q('sim2ResetBtn').addEventListener('click', resetSim2);
  q('sim2RunBtn').addEventListener('click', toggleRunSim2);
  q('sim2StepBtn').addEventListener('click', stepSim2);
  q('sim2SpeedSel').addEventListener('change', () => {
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = setInterval(stepSim2, Number(q('sim2SpeedSel').value));
    }
  });
  q('sim2PathSize').addEventListener('input', () => {
    q('sim2PathSizeVal').textContent = q('sim2PathSize').value;
  });
  q('sim2PathSize').addEventListener('change', buildSim2);
  if (q('sim2TopoSelect')) {
    q('sim2TopoSelect').addEventListener('change', () => {
      addLog(`Topology set to ${q('sim2TopoSelect').value}.`, 'info');
    });
  }
  q('sim2AdversaryMode').addEventListener('change', () => addLog(`Adversary mode set to ${q('sim2AdversaryMode').value}.`, 'info'));
}

window.switchSimulation = switchSimulation;

(function initializeSim2() {
  if (!q('cy2')) return;
  installEventHandlers();
  buildSim2();
  updateSimulationIndicator(q('sim2Select').value || 'sim1');
}());
