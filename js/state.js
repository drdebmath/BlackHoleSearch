// Shared mutable state for the simulator.
// `simState` holds the current run; `cyRef` wraps the active cytoscape instance
// so modules can swap it out on rebuild without losing references.

export const cyRef = { instance: null };
export const runRef = { intervalId: null };
export let simState = null;

export function setSimState(next) {
  simState = next;
}
