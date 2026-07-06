// Simulation loop controller

import { runRef, simState } from './state.js';
import { stepSimulation } from './simulation.js';
import { $ } from './ui.js';

function simulationLoop() {
  if (!runRef.isRunning) return;

  stepSimulation();

  const speed = +$('speedSel').value;
  runRef.timeoutId = setTimeout(simulationLoop, speed);
}

export function startSimulationLoop() {
  if (runRef.isRunning) return;
  runRef.isRunning = true;
  $('runBtn').textContent = '⏸ PAUSE';
  simulationLoop();
}

export function stopSimulationLoop() {
  if (!runRef.isRunning) return;
  runRef.isRunning = false;
  if (runRef.timeoutId) {
    clearTimeout(runRef.timeoutId);
  }
  runRef.timeoutId = null;
  $('runBtn').textContent = '▶ RUN SIMULATION';
}

export function toggleSimulationLoop() {
  if (runRef.isRunning) {
    stopSimulationLoop();
  } else {
    startSimulationLoop();
  }
}
