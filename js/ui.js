// DOM helpers: stats, event log, agent chips, edge table, overlay, tabs.

import { simState } from './state.js';

export const $ = id => document.getElementById(id);

export function setStat(id, val) { if ($(id)) $(id).textContent = val; }

export function logAdd(round, type, msg) {
  const log = $('log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-round">R${round}</span><span class="log-msg ${type}">${msg}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

export function logClear() { if ($('log')) $('log').innerHTML = ''; }

export function updateAgentChips() {
  if (!simState) return;
  const list = $('agentList');
  if (!list) return;
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
    
    // Add specific paper roles if perpetual mode is active
    const roleTag = a.role ? ` [${a.role}]` : '';
    chip.textContent = `A${a.id}${a.byzantine ? ' ☿' : ''}${!a.alive ? ' ✕' : ` @${a.pos}`}${roleTag}`;
    list.appendChild(chip);
  });
}

export function updateEdgeTable() {
  if (!simState) return;
  const table = $('edgeTable');
  if (!table) return;
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
  if (!ov) return;
  ov.className = 'show ' + type;
  if ($('ovTitle')) $('ovTitle').textContent = title;
  if ($('ovSub')) $('ovSub').textContent   = sub;
}

export function closeOverlay() { if ($('overlay')) $('overlay').className = ''; }

export function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id === 'tab-' + name);
  });
}

export function updateFormula() {
  const fEl = $('fFault');
  const f = fEl ? +fEl.value : 1;
  const knowEl = $('topoKnow');
  const know = knowEl ? knowEl.value : 'unknown';
  const commEl = $('commModel');
  const comm = commEl ? commEl.value : 'whiteboard';
  
  const modeEl = $('simMode');
  const mode = modeEl ? modeEl.value : 'classic';
  const topoEl = $('topoSelect');
  const topo = topoEl ? topoEl.value : 'random';

  let k, time, alg;
  
  const advRow = $('advRow');
  if (mode === 'perpetual') {
     if (advRow) advRow.style.display = 'flex'; // Show Manual Adversary
     // Research Paper Bounds
     if (topo === 'path' || topo === 'ring') {
         k = 6;
         time = 'Perpetual (O(n))';
         alg = 'PATH_PERPEXPLORE';
     } else {
         k = '3∆ + 3';
         time = 'Perpetual (O(n³∆²))';
         alg = 'GRAPH_PERPEXPLORE';
     }
  } else {
    if (advRow) advRow.style.display = 'none'; // Hide Manual Adversary
    // Classic BHS Bounds
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
  }

  const formulaBox = $('formulaBox');
  if (formulaBox) {
    formulaBox.innerHTML = `
      <span class="hi">k ≥ ${typeof k === 'number' ? `<b>${k}</b>` : k}</span> agents needed<br>
      Time: <span class="hi-g">${time}</span><br>
      Algorithm: <span class="hi">${alg}</span><br>
      <span class="hi-r">f = ${f}</span> Byzantine fault(s)
    `;
  }
}