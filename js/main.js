// Entry point: wires up DOM events and starts the simulator.

import { cyRef, runRef } from './state.js';
import { buildGraph, stepSimulation, resetSimulation, renderAgentsOnGraph } from './simulation.js';
import { $, updateFormula, closeOverlay, switchTab } from './ui.js';

const nNodes  = $('nNodes');
const fFault  = $('fFault');
const runBtn  = $('runBtn');
const panelToggle = $('panelToggle');
const panelStoreKey = 'bhs-panels-collapsed';

function refreshGraphViewport() {
  window.setTimeout(() => {
    if (!cyRef.instance) return;
    cyRef.instance.resize();
    renderAgentsOnGraph();
  }, 260);
}

function setPanelsCollapsed(collapsed, persist = true) {
  document.body.classList.toggle('panels-collapsed', collapsed);
  panelToggle.setAttribute('aria-expanded', String(!collapsed));
  panelToggle.setAttribute('aria-label', collapsed ? 'Show controls and status panels' : 'Hide controls and status panels');
  panelToggle.title = collapsed ? 'Show panels' : 'Hide panels';

  const label = panelToggle.querySelector('.panel-toggle-label');
  if (label) label.textContent = collapsed ? 'SHOW PANELS' : 'HIDE PANELS';
  if (persist) localStorage.setItem(panelStoreKey, collapsed ? 'true' : 'false');
  refreshGraphViewport();
}

if (panelToggle) {
  const storedPanelState = localStorage.getItem(panelStoreKey);
  const mobileDefault = window.matchMedia('(max-width: 900px)').matches;
  setPanelsCollapsed(storedPanelState === null ? mobileDefault : storedPanelState === 'true', false);
  panelToggle.addEventListener('click', () => {
    setPanelsCollapsed(!document.body.classList.contains('panels-collapsed'));
  });
}
window.addEventListener('resize', refreshGraphViewport);

nNodes.oninput = () => { $('nVal').textContent = nNodes.value; updateFormula(); };
fFault.oninput = () => { $('fVal').textContent = fFault.value; updateFormula(); };
$('topoKnow').onchange = updateFormula;
$('commModel').onchange = updateFormula;

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

updateFormula();
buildGraph();
