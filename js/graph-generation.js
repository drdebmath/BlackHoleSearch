// Topology generators. Each returns { nodes, edges } in cytoscape element format.

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateGraph(topo, n) {
  const nodes = [];
  const edges = [];
  const edgeSet = new Set();

  const addEdge = (a, b) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ data: { id: `e${a}-${b}`, source: `n${a}`, target: `n${b}` } });
  };

  for (let i = 0; i < n; i++) nodes.push({ data: { id: `n${i}`, label: `${i}` } });

  switch (topo) {
    case 'ring':
      for (let i = 0; i < n; i++) addEdge(i, (i + 1) % n);
      break;

    case 'complete':
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) addEdge(i, j);
      break;

    case 'grid':
      buildGrid(n, addEdge, edges);
      applyGridPositions(nodes, n);
      break;

    case 'tree':
      for (let i = 1; i < n; i++) addEdge(Math.floor((i - 1) / 2), i);
      break;

    case 'star':
      for (let i = 1; i < n; i++) addEdge(0, i);
      break;

    default:
      buildRandomConnected(n, addEdge, edges);
  }

  return { nodes, edges };
}

function buildGrid(n, addEdge, edges) {
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    if ((i + 1) % cols !== 0 && i + 1 < n) addEdge(i, i + 1);
    if (i + cols < n) addEdge(i, i + cols);
  }
  // Patch connectivity in case rounding left orphans
  const visited = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const cur = queue.shift();
    edges
      .filter(e => e.data.source === `n${cur}` || e.data.target === `n${cur}`)
      .forEach(e => {
        const other = e.data.source === `n${cur}` ? +e.data.target.slice(1) : +e.data.source.slice(1);
        if (!visited.has(other)) { visited.add(other); queue.push(other); }
      });
  }
  for (let i = 1; i < n; i++) if (!visited.has(i)) addEdge(i - 1, i);
}

function applyGridPositions(nodes, n) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const spacing = 95;
  const width = (cols - 1) * spacing;
  const height = (rows - 1) * spacing;

  nodes.forEach((node, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    node.position = {
      x: col * spacing - width / 2,
      y: row * spacing - height / 2,
    };
  });
}

function buildRandomConnected(n, addEdge, edges) {
  // Spanning path first to guarantee connectivity, then sprinkle extras
  const perm = shuffle([...Array(n).keys()]);
  for (let i = 1; i < n; i++) addEdge(perm[i - 1], perm[i]);
  const extraEdges = Math.floor(n * 0.6);
  for (let t = 0; t < extraEdges * 10 && edges.length < n + extraEdges; t++) {
    const a = Math.floor(Math.random() * n);
    const b = Math.floor(Math.random() * n);
    if (a !== b) addEdge(a, b);
  }
}
