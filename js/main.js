// Entry point: wires up DOM events and starts the simulator.

import { cyRef, runRef } from './state.js';
import { buildGraph, stepSimulation, resetSimulation, renderAgentsOnGraph, triggerAdversary } from './simulation.js';
import { $, updateFormula, closeOverlay, switchTab } from './ui.js';

const nNodes  = $('nNodes');
const fFault  = $('fFault');
const runBtn  = $('runBtn');
const panelToggle = $('panelToggle');
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
  if (!panelToggle) return;
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

if (nNodes) nNodes.oninput = () => { if ($('nVal')) $('nVal').textContent = nNodes.value; updateFormula(); };
if (fFault) fFault.oninput = () => { if ($('fVal')) $('fVal').textContent = fFault.value; updateFormula(); };
if ($('topoKnow')) $('topoKnow').onchange = updateFormula;
if ($('commModel')) $('commModel').onchange = updateFormula;
if ($('topoSelect')) $('topoSelect').onchange = () => { updateFormula(); buildGraph(); };

// Safely hook up the new Simulator Mode
const simModeSel = $('simMode');
if (simModeSel) {
    simModeSel.onchange = () => { updateFormula(); buildGraph(); };
}

if ($('buildBtn')) $('buildBtn').onclick = buildGraph;
if ($('resetBtn')) $('resetBtn').onclick = resetSimulation;
if ($('stepBtn')) $('stepBtn').onclick  = stepSimulation;

// Safely hook up the Manual Adversary Trap
const advBtn = $('adversaryBtn');
if (advBtn) {
  advBtn.onclick = () => {
    triggerAdversary();
    advBtn.textContent = "💥 BBH ARMED!";
    setTimeout(() => advBtn.textContent = "😈 ARM BYZANTINE BBH", 1500);
  };
}

if (runBtn) {
  runBtn.onclick = () => {
    if (runRef.intervalId) {
      clearInterval(runRef.intervalId);
      runRef.intervalId = null;
      runBtn.textContent = '▶ RUN SIMULATION';
    } else {
      const speedElement = $('speedSel');
      const speed = speedElement ? +speedElement.value : 400;
      runRef.intervalId = setInterval(stepSimulation, speed);
      runBtn.textContent = '⏸ PAUSE';
    }
  };
}

if ($('overlayCloseBtn')) $('overlayCloseBtn').addEventListener('click', closeOverlay);
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

updateFormula();
buildGraph();