// Shared helpers for rendering agents and edge/node highlights usable by both sims.

export function getCyEdge(cy, from, to) {
  if (!cy) return { empty: () => true };
  return cy.edges().filter(e =>
    (e.data('source') === `n${from}` && e.data('target') === `n${to}`) ||
    (e.data('source') === `n${to}`   && e.data('target') === `n${from}`)
  );
}

export function highlightEdge(cy, from, to, mode = 'probing') {
  if (!cy) return;
  cy.edges().removeClass('probing').removeClass('release');
  getCyEdge(cy, from, to).addClass(mode);
}

export function markCurrentNode(cy, nodeId) {
  if (!cy) return;
  cy.nodes().removeClass('current');
  const n = cy.getElementById(`n${nodeId}`);
  if (n && n.length) n.addClass('current');
}

export function renderAgentsLayer(cy, layerElement, agents, activeAgentId) {
  if (!layerElement) return;
  layerElement.innerHTML = '';
  if (!cy || !agents) return;

  // Update node labels to show counts (keeps parity with sim1)
  cy.nodes().forEach(node => {
    const nid = +node.id().slice(1);
    const agentsHere = agents.filter(a => a.alive && a.pos === nid);
    const goodCount = agentsHere.filter(a => !a.byzantine).length;
    const byzCount  = agentsHere.filter(a => a.byzantine).length;
    let label = `${nid}`;
    if (goodCount > 0) label += `\nG${goodCount}`;
    if (byzCount  > 0) label += `\nB${byzCount}`;
    node.data('label', label);
  });

  const agentsByNode = new Map();
  agents.filter(a => a.alive).forEach(agent => {
    if (!agentsByNode.has(agent.pos)) agentsByNode.set(agent.pos, []);
    agentsByNode.get(agent.pos).push(agent);
  });

  agentsByNode.forEach((agentsList, nodeId) => {
    const node = cy.getElementById(`n${nodeId}`);
    if (!node || node.empty()) return;
    const pos = node.renderedPosition();
    const orbit = agentsList.length === 1 ? 23 : Math.min(34, 19 + agentsList.length * 2);

    agentsList.forEach((agent, index) => {
      const angle = agentsList.length === 1
        ? -Math.PI / 2
        : (Math.PI * 2 * index / agentsList.length) - Math.PI / 2;
      const x = pos.x + Math.cos(angle) * orbit;
      const y = pos.y + Math.sin(angle) * orbit;
      const particle = document.createElement('div');
      const kind = agent.byzantine ? (agent.identified ? 'identified' : 'byz') : 'good';
      particle.className = ['agent-particle', kind, (activeAgentId === agent.id ? 'active' : '')].filter(Boolean).join(' ');
      particle.style.transform = `translate(${x}px, ${y}px)`;
      particle.dataset.agentId = `${agent.id}`;
      layerElement.appendChild(particle);
    });
  });
}
