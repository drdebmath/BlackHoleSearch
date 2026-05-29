import { cyRef, runRef } from './state.js';
import { buildGraph, stepSimulation, resetSimulation, renderAgentsOnGraph } from './simulation.js';
import { $, updateFormula, closeOverlay, switchTab, setupBBHUI } from './ui.js';

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
$('simMode').onchange = updateFormula;

$('buildBtn').onclick = buildGraph;
$('resetBtn').onclick = resetSimulation;
$('stepBtn').onclick  = stepSimulation;

runBtn.onclick = () => {
  if (runRef.intervalId) {
    clearInterval(runRef.intervalId);
    runRef.intervalId = null;
    runBtn.textContent = '▶ RUN SIMULATION';
  } else {
    const speed = +$('speedSel').value;
    runRef.intervalId = setInterval(stepSimulation, speed);
    runBtn.textContent = '⏸ PAUSE';
  }
};

$('overlayCloseBtn').addEventListener('click', closeOverlay);
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// Initialize v2 UI and Logic
setupBBHUI();
updateFormula();
buildGraph();