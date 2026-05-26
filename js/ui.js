// DOM helpers: stats, event log, agent chips, edge table, overlay, tabs.

import { simState } from './state.js';

export const $ = id => document.getElementById(id);

export function setStat(id, val) { 
  const el = $(id);
  if (el) {
    el.textContent = val; 
  }
}

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
    const roleType = a.roleType || (a.role === 'L' ? 'Explorer' : 'Marker');
    classes.push(roleType === 'Explorer' ? 'explorer' : 'marker');
    if (a.alive && simState.activeAgentId === a.id) classes.push('active');
    chip.className = classes.join(' ');
    const role = a.role ? ` ${a.role}` : '';
    const typeLabel = roleType === 'Explorer' ? 'E' : 'M';
    const anchor = a.settled ? ' ⚓' : '';
    chip.textContent = `A${a.id}${a.byzantine ? ' ☿' : ''} ${typeLabel}${role}${anchor}${!a.alive ? ' ✕' : ` @${a.pos}`}`;
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

  let k, time, alg;
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
