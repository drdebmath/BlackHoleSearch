import { simState, cyRef } from './state.js';

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
    chip.textContent = `A${a.id}${a.byzantine ? ' ☿' : ''}${!a.alive ? ' ✕' : ` @${a.pos}`}`;
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

export function setupBBHUI() {
  const modeSelect = $('bbhControlMode');
  const nCont = $('bbhNContainer');
  const mCont = $('bbhMContainer');

  modeSelect.addEventListener('change', () => {
    nCont.style.display = modeSelect.value === 'n-rounds' ? 'flex' : 'none';
    mCont.style.display = modeSelect.value === 'm-agents' ? 'flex' : 'none';
  });

  $('advViewToggle').addEventListener('change', (e) => {
    if (!cyRef.instance || !simState) return;
    const bhNode = cyRef.instance.getElementById(`n${simState.bhNode}`);
    if (e.target.checked) {
      bhNode.addClass('revealed');
    } else if (!simState.bhLocated) {
      bhNode.removeClass('revealed');
    }
  });
}

export function updateFormula() {
  const f = +$('fFault').value;
  const k = Math.max(4, 2 * f + 2); // Enforce minimum 4 agents for visual/logic bounds
  
  $('formulaBox').innerHTML = `
    <span class="hi">BBH adversarial activation (per-round)</span><br>
    <span class="hi">k ≥ ${k}</span> agents needed<br>
    Time: <span class="hi-g">O(n + f)</span><br>
    Algorithm: <span class="hi">DFS+CCP</span><br>
    <span class="hi-r">f = ${f}</span> Byzantine fault(s)
  `;
}