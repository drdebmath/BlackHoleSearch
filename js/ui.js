// DOM helpers: stats, event log, agent chips, edge table, overlay, tabs,
// whiteboard viewer, theory sidebar, replay controls.

import { simState } from './state.js';

export const $ = id => document.getElementById(id);

export function setStat(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

// ── Event Log ──────────────────────────────────────────────────────────────

export function logAdd(round, type, msg) {
  const log = $('log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-round">R${round}</span><span class="log-msg ${type}">${msg}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

export function logClear() {
  const log = $('log');
  if (log) log.innerHTML = '';
}

// ── Agent Chips ────────────────────────────────────────────────────────────

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
    chip.title = `Agent ${a.id} | pos: ${a.pos} | ${a.byzantine ? 'Byzantine' : 'Good'} | ${a.alive ? 'Alive' : 'Dead'}`;
    chip.textContent = `A${a.id}${a.byzantine ? ' ☿' : ''}${!a.alive ? ' ✕' : ` @n${a.pos}`}`;
    list.appendChild(chip);
  });
}

// ── Edge Table ─────────────────────────────────────────────────────────────

export function updateEdgeTable() {
  if (!simState) return;
  const table = $('edgeTable');
  if (!table) return;
  table.innerHTML = '';
  for (const [key, status] of Object.entries(simState.edgeStatus)) {
    const returns = simState.edgeReturns?.[key] ?? 0;
    const threshold = simState.f + 1;
    const cls = status === 'safe' ? 'safe' : status === 'dangerous' ? 'danger' : 'unknown';
    const row = document.createElement('div');
    row.className = 'edge-row';
    row.innerHTML = `
      <span class="edge-key">${key}</span>
      <span class="edge-returns" title="Confirmed returns / threshold">${returns}/${threshold}</span>
      <span class="status-${cls}">${status.toUpperCase()}</span>`;
    table.appendChild(row);
  }
}

// ── Whiteboard Panel ───────────────────────────────────────────────────────

export function updateWhiteboardPanel() {
  if (!simState) return;
  const panel = $('wbPanel');
  if (!panel) return;
  panel.innerHTML = '';

  if (simState.comm !== 'whiteboard') {
    panel.innerHTML = '<div class="wb-empty">Whiteboard model not active.</div>';
    return;
  }

  const wb = simState.whiteboard || {};
  const nodes = Object.keys(wb).map(Number).sort((a, b) => a - b);
  if (nodes.length === 0) {
    panel.innerHTML = '<div class="wb-empty">No entries yet.</div>';
    return;
  }

  nodes.forEach(nodeId => {
    const entries = wb[nodeId];
    if (!entries || entries.length === 0) return;
    const block = document.createElement('div');
    block.className = 'wb-block';
    block.innerHTML = `<div class="wb-node-label">Node ${nodeId}</div>` +
      entries.map(e => `<div class="wb-entry">${e}</div>`).join('');
    panel.appendChild(block);
  });
}

// ── Theory Panel ───────────────────────────────────────────────────────────

export function updateTheoryPanel() {
  if (!simState) return;
  const panel = $('theoryPanel');
  if (!panel) return;

  const { f, know, comm, delta, round, currentOperation, traversalIndex, traversalOrder } = simState;

  let currentPhase = 'Idle';
  let phaseDetail = '—';
  if (currentOperation) {
    const op = currentOperation;
    const step = op.step;
    const isDangerous = step.to === simState.bhNode;
    currentPhase = isDangerous ? 'CCP — Dangerous Edge' : (step.kind === 'probe' ? 'CCP — Safe Probe' : 'DFS Backtrack');
    phaseDetail = isDangerous
      ? `Sending probe group to n${step.to} (BH boundary). Agents lost: ${simState.lostInBH}/${f + 1} threshold.`
      : `Probing edge (${step.from} → ${step.to}). Awaiting f+1=${f + 1} confirmed returns.`;
  } else if (traversalIndex < (traversalOrder?.length ?? 0)) {
    const next = traversalOrder[traversalIndex];
    currentPhase = 'DFS — Next Step Queued';
    phaseDetail = next ? `Next: ${next.label} (${next.from} → ${next.to})` : '—';
  }

  panel.innerHTML = `
    <div class="theory-section">
      <div class="theory-label">ALGORITHM</div>
      <div class="theory-val theory-hi">${know === 'known' ? 'DFS + CCP (Known Map)' : comm === 'whiteboard' ? 'DFS + CCP + Whiteboard' : 'DFS + CCP + Map Discovery'}</div>
    </div>
    <div class="theory-section">
      <div class="theory-label">CURRENT PHASE</div>
      <div class="theory-val theory-warn">${currentPhase}</div>
      <div class="theory-sub">${phaseDetail}</div>
    </div>
    <div class="theory-section">
      <div class="theory-label">CCP SAFE THRESHOLD</div>
      <div class="theory-sub">An edge is SAFE when <b>f+1 = ${f + 1}</b> distinct agents return from it without being consumed.</div>
      <div class="theory-returns">Currently tracking per-edge returns in the Edge Status tab.</div>
    </div>
    <div class="theory-section">
      <div class="theory-label">CCP DANGER THRESHOLD</div>
      <div class="theory-sub">An edge is DANGEROUS (BH boundary) when <b>f+1 = ${f + 1}</b> agents do NOT return. At most f Byzantine agents can lie — so f+1 non-returns confirms a black hole.</div>
    </div>
    <div class="theory-section">
      <div class="theory-label">TEAM SIZE</div>
      <div class="theory-sub">k ≥ ${know === 'known' ? `2f+2 = ${2 * f + 2}` : comm === 'whiteboard' ? `(f+1)(Δ+1) = ${(f + 1) * (delta + 1)}` : `(f+1)(Δ+1)+3f+1 = ${(f + 1) * (delta + 1) + 3 * f + 1}`} agents (Δ=${delta}, f=${f})</div>
    </div>
    <div class="theory-section">
      <div class="theory-label">DFS PROGRESS</div>
      <div class="theory-sub">Step ${traversalIndex} / ${traversalOrder?.length ?? '?'} &nbsp;|&nbsp; Round ${round}</div>
    </div>
  `;
}

// ── Overlay ────────────────────────────────────────────────────────────────

export function showOverlay(type, title, sub) {
  const ov = $('overlay');
  if (!ov) return;
  ov.className = 'show ' + type;
  $('ovTitle').textContent = title;
  $('ovSub').textContent   = sub;
}

export function closeOverlay() {
  const ov = $('overlay');
  if (ov) ov.className = '';
}

// ── Tabs ───────────────────────────────────────────────────────────────────

export function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id === 'tab-' + name);
  });
}

// ── Formula Box ────────────────────────────────────────────────────────────

export function updateFormula() {
  const fEl = $('fFault');
  const knowEl = $('topoKnow');
  const commEl = $('commModel');
  if (!fEl || !knowEl || !commEl) return;

  const f = +fEl.value;
  const know = knowEl.value;
  const comm = commEl.value;

  let k, time, alg;
  if (know === 'known') {
    k = 2 * f + 2;
    time = 'O(n + f)';
    alg = 'DFS+CCP';
  } else if (comm === 'whiteboard') {
    k = `(f+1)(∆+1)`;
    time = 'O(m + f)';
    alg = 'DFS+CCP+WB';
  } else {
    k = `(f+1)(∆+1)+3f+1`;
    time = 'O(m·n + f)';
    alg = 'DFS+CCP+MAP';
  }

  const box = $('formulaBox');
  if (box) {
    box.innerHTML = `
      <span class="hi">k ≥ ${typeof k === 'number' ? `<b>${k}</b>` : k}</span> agents needed<br>
      Time: <span class="hi-g">${time}</span><br>
      Algorithm: <span class="hi">${alg}</span><br>
      <span class="hi-r">f = ${f}</span> Byzantine fault(s)<br>
      <span class="hi-dim">Safe threshold: f+1 = ${f + 1} returns</span><br>
      <span class="hi-dim">Danger threshold: f+1 = ${f + 1} non-returns</span>
    `;
  }
}

// ── Replay Controls ────────────────────────────────────────────────────────

export function updateReplayControls() {
  if (!simState) return;
  const hist = simState.history || [];
  const idx  = simState.historyIndex ?? hist.length;
  const replayBack = $('replayBack');
  const replayFwd  = $('replayFwd');
  const replayLabel = $('replayLabel');
  if (replayBack)  replayBack.disabled  = idx <= 0;
  if (replayFwd)   replayFwd.disabled   = idx >= hist.length;
  if (replayLabel) replayLabel.textContent = hist.length > 0 ? `Step ${idx}/${hist.length}` : '';
}
