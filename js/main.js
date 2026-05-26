// Entry point: wires up DOM events and starts the simulator.

import { cyRef, runRef, simState } from './state.js';
import { buildGraph, stepSimulation, resetSimulation, renderAgentsOnGraph, setAdversaryView, setBBHControlMode, setBBHControlValue, setBBHAgentThreshold, setBBHActive } from './simulation.js';
import { $, updateFormula, closeOverlay, switchTab, showOverlay } from './ui.js';

const nNodes  = $('nNodes');
const fFault  = $('fFault');
const runBtn  = $('runBtn');
const panelToggle = $('panelToggle');
const adversaryView = $('adversaryView');
const bbhControlMode = $('bbhControlMode');
const bbhManualActive = $('bbhManualActive');
const bbhEveryN = $('bbhEveryN');
const bbhAgentThreshold = $('bbhAgentThreshold');
const panelStoreKey = 'bhs-panels-collapsed';
const mobilePanelStoreKey = 'bhs-mobile-panels-collapsed';
const mobilePanelQuery = window.matchMedia('(max-width: 900px)');

function refreshGraphViewport() {
  window.setTimeout(() => {
    if (!cyRef.instance) return;
    cyRef.instance.resize();
    renderAgentsOnGraph();
  }, 260);
}

function setPanelsCollapsed(collapsed, persist = true) {
  const mobile = mobilePanelQuery.matches;
  document.body.classList.toggle('panels-collapsed', collapsed);
  panelToggle.setAttribute('aria-expanded', String(!collapsed));
  panelToggle.setAttribute('aria-label', collapsed ? 'Show controls and status panels' : 'Hide controls and status panels');
  panelToggle.title = collapsed ? 'Show panels' : 'Hide panels';

  const label = panelToggle.querySelector('.panel-toggle-label');
  if (label) {
    label.textContent = mobile
      ? (collapsed ? 'OPEN UI' : 'VIEW SIM')
      : (collapsed ? 'SHOW PANELS' : 'HIDE PANELS');
  }
  if (persist) {
    localStorage.setItem(mobile ? mobilePanelStoreKey : panelStoreKey, collapsed ? 'true' : 'false');
  }
  refreshGraphViewport();
}

if (panelToggle) {
  const syncPanelStateForViewport = () => {
    const mobile = mobilePanelQuery.matches;
    const key = mobile ? mobilePanelStoreKey : panelStoreKey;
    const storedPanelState = localStorage.getItem(key);
    setPanelsCollapsed(storedPanelState === null ? mobile : storedPanelState === 'true', false);
  };

  syncPanelStateForViewport();
  panelToggle.addEventListener('click', () => {
    setPanelsCollapsed(!document.body.classList.contains('panels-collapsed'));
  });
  if (mobilePanelQuery.addEventListener) {
    mobilePanelQuery.addEventListener('change', syncPanelStateForViewport);
  } else {
    mobilePanelQuery.addListener(syncPanelStateForViewport);
  }
}
window.addEventListener('resize', refreshGraphViewport);

nNodes.oninput = () => { $('nVal').textContent = nNodes.value; updateFormula(); };
fFault.oninput = () => { $('fVal').textContent = fFault.value; updateFormula(); };
$('topoKnow').onchange = updateFormula;
$('commModel').onchange = updateFormula;

if (adversaryView) {
  adversaryView.onchange = () => setAdversaryView(adversaryView.checked);
}
if (bbhControlMode) {
  const updateModeRows = () => {
    const mode = bbhControlMode.value;
    document.getElementById('bbhManualRow').style.display = mode === 'manual' ? 'block' : 'none';
    document.getElementById('bbhEveryRow').style.display = mode === 'every' ? 'block' : 'none';
    document.getElementById('bbhAgentsRow').style.display = mode === 'agents' ? 'block' : 'none';
  };
  bbhControlMode.onchange = () => {
    setBBHControlMode(bbhControlMode.value);
    updateModeRows();
  };
  updateModeRows();
}
if (bbhManualActive) {
  bbhManualActive.onchange = () => setBBHActive(bbhManualActive.checked);
}
if (bbhEveryN) {
  bbhEveryN.oninput = () => setBBHControlValue(bbhEveryN.value);
}
if (bbhAgentThreshold) {
  bbhAgentThreshold.oninput = () => setBBHAgentThreshold(bbhAgentThreshold.value);
}

$('buildBtn').onclick = buildGraph;
$('resetBtn').onclick = resetSimulation;

function safeStep() {
  try {
    if (!cyRef.instance || !simState) {
      buildGraph();
    }
    stepSimulation();
  } catch (err) {
    if (runRef.intervalId) { clearInterval(runRef.intervalId); runRef.intervalId = null; }
    runBtn.textContent = '▶ RUN SIMULATION';
    console.error(err);
    showOverlay('failure', 'RUNTIME ERROR', err && err.message ? err.message : String(err));
  }
}

$('stepBtn').onclick = safeStep;

runBtn.onclick = () => {
  if (runRef.intervalId) {
    clearInterval(runRef.intervalId);
    runRef.intervalId = null;
    runBtn.textContent = '▶ RUN SIMULATION';
  } else {
    // If the graph hasn't been built yet (or was reset), build it automatically
    if (!cyRef.instance || !simState) {
      buildGraph();
    }
    const speed = +$('speedSel').value;
    runRef.intervalId = setInterval(safeStep, speed);
    runBtn.textContent = '⏸ PAUSE';
  }
};

// Global error handlers to surface runtime problems to the UI overlay
window.addEventListener('error', (ev) => {
  try {
    const msg = ev && ev.message ? ev.message : String(ev.error || ev);
    console.error('Uncaught error:', ev.error || ev.message || ev);
    showOverlay('failure', 'UNCAUGHT ERROR', msg);
  } catch (e) {
    console.error(e);
  }
});
window.addEventListener('unhandledrejection', (ev) => {
  try {
    console.error('Unhandled promise rejection:', ev.reason);
    showOverlay('failure', 'UNHANDLED PROMISE REJECTION', ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason));
  } catch (e) {
    console.error(e);
  }
});

$('overlayCloseBtn').addEventListener('click', closeOverlay);
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

updateFormula();
buildGraph();
// Catch standard runtime Javascript errors
window.addEventListener('error', (ev) => {
  try {
    const msg = ev.error?.message || ev.message || String(ev);
    console.error('Uncaught error:', msg);
    showOverlay('failure', 'SYSTEM ERROR', msg);
  } catch (e) {
    console.error('Failed to show error overlay:', e);
  }
});

// Catch unhandled promises (e.g., failed network requests or async errors)
window.addEventListener('unhandledrejection', (ev) => {
  try {
    const msg = ev.reason?.message || String(ev.reason);
    console.error('Unhandled promise rejection:', msg);
    showOverlay('failure', 'UNHANDLED PROMISE', msg);
  } catch (e) {
    console.error('Failed to show error overlay:', e);
  }
});
