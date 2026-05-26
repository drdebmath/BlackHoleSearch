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
      'font-family': 'Share Tech Mono',
      'text-valign': 'center',
      'width': 32, 'height': 32,
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
    selector: 'node.C1',
    style: {
      'box-shadow-blur': 8,
      'box-shadow-color': '#00e5ff',
      'box-shadow-opacity': 0.12,
    },
  },
  {
    selector: 'node.C2',
    style: {
      'box-shadow-blur': 8,
      'box-shadow-color': '#ff8a00',
      'box-shadow-opacity': 0.12,
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
    selector: 'node.true-blackhole',
    style: {
      'background-color': '#020305',
      'border-color': '#ff8a00',
      'border-width': 3,
      'color': '#ff3d5a',
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
    selector: 'node.trap-sprung',
    style: {
      'border-color': '#ff3d5a',
      'border-width': 6,
      'background-color': '#3d0d12',
      'box-shadow-blur': 18,
      'box-shadow-color': '#ff3d5a',
      'box-shadow-opacity': 0.8,
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
      'box-shadow-blur': 20,
      'box-shadow-color': '#ff3d5a',
      'box-shadow-opacity': 0.8,
    },
  },
  {
    selector: 'node.current',
    style: {
      'border-color': '#00e5ff',
      'border-width': 3,
      'box-shadow-blur': 15,
      'box-shadow-color': '#00e5ff',
      'box-shadow-opacity': 0.6,
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
      'font-family': 'Share Tech Mono',
      'text-rotation': 'autorotate',
    },
  },
  { selector: 'edge.safe',      style: { 'line-color': '#00e676', 'width': 3, 'opacity': 0.7 } },
  { selector: 'edge.dangerous', style: { 'line-color': '#ff3d5a', 'width': 3, 'line-style': 'dashed' } },
  { selector: 'edge.probing',   style: { 'line-color': '#ffb700', 'width': 3, 'line-style': 'dashed' } },
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
  const agentsHere = simState.agents.filter(a => `n${a.pos}` === nid);
  const compLabel = node.hasClass('C1') ? 'C1' : node.hasClass('C2') ? 'C2' : '';
  const isTrueBH = simState.adversaryView && node.hasClass('true-blackhole');
  const here = (node.hasClass('revealed') || isTrueBH)
    ? '☠ BLACK HOLE'
    : node.hasClass('safe') ? '✓ SAFE' : 'Unexplored';
  const agentList = agentsHere.length > 0
    ? agentsHere.map(a => `A${a.id}${a.byzantine ? ' [BYZ]' : ''}`).join(', ')
    : 'none';
  tip.innerHTML = `<b>${nid}</b> ${compLabel}<br>Agents: ${agentList}<br>${here}`;
  tip.style.left = (pos.x + 16) + 'px';
  tip.style.top  = (pos.y - 20) + 'px';
  tip.style.display = 'block';
}
