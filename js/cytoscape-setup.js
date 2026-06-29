// Cytoscape instance creation + node/edge styling.

import { cyRef, simState } from './state.js';

const STYLE = [
  {
    selector: 'node',
    style: {
      'background-color': '#1e2530',
      'border-color': '#4a5568',
      'border-width': 2,
      'label': 'data(label)',
      'color': '#c8d6e5',
      'font-size': 10,
      'font-family': 'Share Tech Mono, monospace',
      'text-valign': 'center',
      'text-halign': 'center',
      'white-space': 'pre',
      'width': 36, 'height': 36,
    },
  },
  {
    selector: 'node.homebase',
    style: {
      'background-color': '#1a1500',
      'border-color': '#ffb700',
      'border-width': 3,
      'color': '#ffb700',
    },
  },
  {
    selector: 'node.safe',
    style: {
      'background-color': '#001a0d',
      'border-color': '#00e676',
      'border-width': 2,
      'color': '#00e676',
    },
  },
  {
    selector: 'node.blackhole',
    style: {
      'background-color': '#020305',
      'border-color': '#ff8a00',
      'border-width': 5,
      'color': '#ff3d5a',
      'label': '⬛',
      'font-size': 14,
      'text-outline-color': '#020305',
      'text-outline-width': 2,
    },
  },
  {
    selector: 'node.revealed',
    style: {
      'background-color': '#260008',
      'border-color': '#ff8a00',
      'border-width': 5,
      'color': '#ff3d5a',
      'label': '☠ BH',
      'font-size': 11,
      'font-weight': 'bold',
    },
  },
  {
    selector: 'node.current',
    style: {
      'border-color': '#00e5ff',
      'border-width': 3,
    },
  },
  {
    selector: 'edge',
    style: {
      'line-color': '#1e2530',
      'width': 2,
      'curve-style': 'bezier',
      'label': '',
      'font-size': 9,
      'color': '#4a5568',
      'font-family': 'Share Tech Mono, monospace',
      'text-rotation': 'autorotate',
    },
  },
  { selector: 'edge.safe',      style: { 'line-color': '#00e676', 'width': 3, 'opacity': 0.7 } },
  { selector: 'edge.dangerous', style: { 'line-color': '#ff3d5a', 'width': 3, 'line-style': 'dashed' } },
  { selector: 'edge.probing',   style: { 'line-color': '#ffb700', 'width': 3, 'line-style': 'dashed' } },
  // Probe-phase highlight per individual agent sub-step
  { selector: 'edge.ccp-active', style: { 'line-color': '#c850f0', 'width': 4, 'line-style': 'dashed' } },
];

export function initCy(nodes, edges) {
  if (cyRef.instance) cyRef.instance.destroy();
  const hasPresetPositions = nodes.some(node => node.position);

  cyRef.instance = cytoscape({
    container: document.getElementById('cy'),
    elements: { nodes, edges },
    style: STYLE,
    layout: hasPresetPositions
      ? { name: 'preset', padding: 60, fit: true, animate: false }
      : { name: 'cose', padding: 40, nodeOverlap: 30, animate: false },
  });

  cyRef.instance.on('mouseover', 'node', showTooltip);
  cyRef.instance.on('mouseout',  'node', () => { document.getElementById('tooltip').style.display = 'none'; });
}

function showTooltip(evt) {
  if (!simState) return;
  const node = evt.target;
  const nid = node.id();
  const tip = document.getElementById('tooltip');
  const pos = evt.renderedPosition;
  const nodeIdx = +nid.slice(1);
  const agentsHere = simState.agents.filter(a => `n${a.pos}` === nid);
  const here = node.hasClass('blackhole') || node.hasClass('revealed')
    ? '☠ BLACK HOLE'
    : node.hasClass('safe') ? '✓ SAFE' : '? Unexplored';

  const agentList = agentsHere.length > 0
    ? agentsHere.map(a => `A${a.id}${a.byzantine ? ' [BYZ]' : ''} (${a.alive ? 'alive' : 'dead'})`).join('<br>')
    : 'none';

  // Whiteboard memory for this node
  let wbHtml = '';
  if (simState.comm === 'whiteboard' && simState.whiteboard[nodeIdx]) {
    const wb = simState.whiteboard[nodeIdx];
    const entries = wb.map(e => `<span style="color:#c850f0">${e}</span>`).join('<br>');
    wbHtml = `<hr style="border-color:#1e2530;margin:4px 0">📋 WB:<br>${entries}`;
  }

  // Returns per edge for this node
  let retHtml = '';
  const edgeReturns = Object.entries(simState.edgeReturns || {})
    .filter(([k]) => k.startsWith(`${nodeIdx}-`) || k.endsWith(`-${nodeIdx}`));
  if (edgeReturns.length) {
    retHtml = `<hr style="border-color:#1e2530;margin:4px 0">Returns:<br>` +
      edgeReturns.map(([k, v]) => `${k}: <span style="color:#00e676">${v}/${simState.f + 1}</span>`).join('<br>');
  }

  tip.innerHTML = `<b>${nid}</b> ${here}<br>Agents here:<br>${agentList}${wbHtml}${retHtml}`;
  tip.style.left = (pos.x + 18) + 'px';
  tip.style.top  = (pos.y - 24) + 'px';
  tip.style.display = 'block';
}
