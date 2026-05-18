// Entry point: wires up DOM events and starts the simulator.

import { runRef } from './state.js';
import { buildGraph, stepSimulation, resetSimulation } from './simulation.js';
import { $, updateFormula, closeOverlay, switchTab } from './ui.js';

const nNodes  = $('nNodes');
const fFault  = $('fFault');
const runBtn  = $('runBtn');

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
