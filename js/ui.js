// DOM helpers: stats, event log, agent chips, edge table, overlay, tabs.

import { simState } from './state.js';

export const $ = id => document.getElementById(id);

export function setStat(id, val) { $(id).textContent = val; }

export function logAdd(round, type, msg) {
  const log = $('log');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-round">R${round}</span><span class="log-msg ${type}">${msg}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

export function logClear() { $('log').innerHTML = ''; }

export function updateAgentChips() {
  if (!simState) return;
  const list = $('agentList');
  list.innerHTML = '';
  simState.agents.forEach(a => {
    const chip = document.createElement('div');
    const classes = ['agent-chip'];
    if (!a.alive) classes.push('dead');
    else if (a.byzantine && a.identified) classes.push('identified');
    else if (a.byzantine) classes.push('byz');
    else classes.push('good');
    if (a.alive && simState.activeAgentId === a.id) classes.push('active');
    chip.className = classes.join(' ');
    
    // Add paper specific roles to the chip if BBH_HOME mode is active
    let roleLabel = '';
    if (simState.simMode === 'bbh_home' && a.alive) {
      if (a.role) roleLabel = ` [${a.role}]`;
    }
    
    chip.textContent = `A${a.id}${roleLabel}${a.byzantine ? ' ☿' : ''}${!a.alive ? ' ✕' : ` @${a.pos}`}`;
    list.appendChild(chip);
  });
}

export function updateEdgeTable() {
  if (!simState) return;
  const table = $('edgeTable');
  table.innerHTML = '';
  for (const [key, status] of Object.entries(simState.edgeStatus)) {
    const cls = status === 'safe' ? 'safe' : status === 'dangerous' ? 'danger' : 'unknown';
    const row = document.createElement('div');
    row.className = 'edge-row';
    row.innerHTML = `<span>${key}</span><span class="status-${cls}">${status.toUpperCase()}</span>`;
    table.appendChild(row);
  }
}

export function showOverlay(type, title, sub) {
  const ov = $('overlay');
  ov.className = 'show ' + type;
  $('ovTitle').textContent = title;
  $('ovSub').textContent   = sub;
}

export function closeOverlay() { $('overlay').className = ''; }

export function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id === 'tab-' + name);
  });
}

export function updateFormula() {
  const f = +$('fFault').value;
  const know = $('topoKnow').value;
  const comm = $('commModel').value;
  const topo = $('topoSelect').value;
  const simMode = $('simModeSelect')?.value; // Graceful catch

  let k, time, alg;

  if (simMode === 'bbh_home') {
    if (topo === 'tree' || topo === 'ring' || topo === 'star' || topo === 'path') {
      k = 6; 
      time = '$O(2^i \\log \\Delta)$';
      alg = 'TREE_PERPEXPLORE-BBH-HOME';
    } else {
      k = '$3\\Delta + 3$'; 
      time = '$O(n^3 \\Delta^2)$';
      alg = 'GRAPH_PERPEXPLORE-BBH-HOME';
    }
    
    $('formulaBox').innerHTML = `
      <span class="hi">k ≥ ${k}</span> agents needed [Paper]<br>
      Time Complexity: <span class="hi-g">${time}</span><br>
      Protocol: <span class="hi">${alg}</span><br>
      <span class="hi-r">f = ${f}</span> Byzantine black hole setting
    `;
  } else {
    // Original bounds logic
    if (know === 'known') {
      k = 2 * f + 2;
      time = 'O(n + f)';
      alg = 'DFS+CCP';
    } else if (comm === 'whiteboard') {
      k = '(f+1)(∆+1)';
      time = 'O(m + f)';
      alg = 'DFS+CCP+WB';
    } else {
      k = '(f+1)(∆+1)+3f+1';
      time = 'O(m·n + f)';
      alg = 'DFS+CCP+MAP';
    }

    $('formulaBox').innerHTML = `
      <span class="hi">k ≥ ${typeof k === 'number' ? `<b>${k}</b>` : k}</span> agents needed<br>
      Time: <span class="hi-g">${time}</span><br>
      Algorithm: <span class="hi">${alg}</span><br>
      <span class="hi-r">f = ${f}</span> Byzantine fault(s)
    `;
  }
}