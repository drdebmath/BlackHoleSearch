# Black Hole Search — Byzantine Agents Simulator

An interactive, browser-based visualisation of the **Black Hole Search (BHS)**
problem in distributed computing, with **Byzantine** (malicious / lying) mobile
agents.

![status](https://img.shields.io/badge/status-research--prototype-blue)
![runtime](https://img.shields.io/badge/runtime-browser-purple)
![deps](https://img.shields.io/badge/deps-cytoscape.js-green)

---

## The problem

A **black hole** is a node in a network that silently destroys any mobile agent
that enters it — no message, no trace, no way to warn the rest of the team.

The **Black Hole Search problem** asks: given a team of mobile agents starting
from a safe *homebase*, how can the surviving agents collectively **locate the
black hole** while losing as few of their own as possible?

This simulator adds a second twist: some of the agents are **Byzantine**. They
can lie about what they saw, refuse to move, or report fake "safe" / "dangerous"
results to mislead the honest agents. The honest agents must still locate the
black hole *despite* this adversarial behaviour.

**Goal:** safe agents survive, all dangerous edges/nodes are catalogued, and the
black hole is unambiguously identified at the end of the exploration.

---

## What the simulator shows

- **Graph topologies:** ring, complete, grid, balanced tree, star, random
  connected.
- **Configurable parameters:** number of nodes `n`, number of Byzantine
  agents `f`, communication model, topology knowledge.
- **Live agent placement** drawn over a Cytoscape graph, with edge probing,
  safe/dangerous edge classification, and round-by-round event logging.
- **Ephemeral edge memory:** a safe edge certificate expires after a configurable
  number of rounds, forcing agents to re-probe it before relying on it again.
- **Continuous maintenance loop:** after the initial DFS plan, agents keep
  routing toward expired or unknown edges and refreshing their safety status.
- **Theoretical bounds** displayed as you tune the parameters — the team size
  `k`, time complexity, and algorithm name update in real time.

### Communication models

| Model | Meaning |
|---|---|
| **Whiteboard** | Each node has a shared, append-only blackboard. Agents at the same node read/write a common log. |
| **Local (Face-to-Face)** | Agents can only exchange information when co-located. No persistent memory at nodes. |

### Topology knowledge

| Mode | Meaning |
|---|---|
| **Known Map** | Agents know the graph in advance — they only need to *locate* the BH. The DFS variant is used. |
| **Unknown Map** | Agents must *explore* the graph from scratch, using DFS movement to discover and classify every edge. |

### Required team size and complexity

Depending on knowledge and communication, the simulator displays the
theoretical lower bound on the number of agents `k`:

| Setting | `k ≥` | Time | Algorithm |
|---|---|---|---|
| Known map | `2f + 2` | `O(n + f)` | `DFS + CCP` |
| Unknown + Whiteboard | `(f+1)(Δ+1)` | `O(m + f)` | `DFS + CCP + WB` |
| Unknown + Local | `(f+1)(Δ+1) + 3f + 1` | `O(m·n + f)` | `DFS + CCP + MAP` |

Here `n` is the number of nodes, `m` the number of edges, `Δ` the max degree,
and `f` the number of Byzantine agents. **CCP** = *Cautious Cyclic Probing*,
a probe-and-cross-check primitive used to test a candidate edge without losing
more than `f+1` honest agents.

---

## How it works (under the hood)

The simulator probes one edge at a time using a simplified CCP model:

1. A physical **DFS** walk is precomputed from the homebase, including
   backtracking moves.
2. A candidate edge is not considered safe until agents complete the visible
   CCP pattern: probe out, return, repeat up to the `f + 1` threshold, then
   certify and cross.
3. Each certified edge receives a round-based expiry timer. When that timer
   decays, the edge is marked `EXPIRED` and must be re-probed before blind use.
4. If `v` is the black hole, up to `f + 1` good agents are consumed (this is
   the worst case for cautious probing under `f` Byzantine faults) and the
   edge is flagged as *dangerous*.
5. Otherwise the edge is *safe*, `v` is added to the explored set, and there
   is a chance that any active Byzantine agent gets *identified* by its
   inconsistent behaviour during the cross-check.
6. Once the initial DFS plan is exhausted, the simulator enters a continuous
   maintenance loop that re-routes to expired or unknown edges and probes them
   again. The run finishes when the BH is located. The mission fails if every
   honest agent is consumed before that happens.

> ⚠️ This is a **teaching / visualisation prototype**, not a verified
> implementation of any published protocol. The CCP step is abstracted into a
> single coin-flip rather than a full round-based exchange.

---

## Running it

No build step, no package manager — it is a static page.

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` directly in a browser (some browsers block ES module
imports under `file://` — if so, use the local server above).

### Controls

| Button | What it does |
|---|---|
| **BUILD GRAPH** | Generate a fresh graph from the current settings and deploy agents. |
| **▶ RUN SIMULATION** | Auto-step at the selected speed (Slow → Turbo). Toggles to ⏸ PAUSE. |
| **STEP →** | Advance one round manually. |
| **RESET** | Tear everything down. |

Hover any node to see the agents currently on it and its safe/unknown/BH
status.

---

## Project layout

```
BlackHoleSearch/
├── index.html               # markup only
├── css/
│   └── styles.css           # all styling
├── js/
│   ├── main.js              # entry point — wires up DOM events
│   ├── state.js             # shared mutable state (cy, simState, run handle)
│   ├── graph-generation.js  # topology generators
│   ├── cytoscape-setup.js   # cy init + node/edge styles + tooltip
│   ├── simulation.js        # build / step / finish, DFS+BFS order, CCP probe
│   └── ui.js                # stats, log, agent chips, edge table, overlay, tabs
└── README.md
```

The original prototype was a single 1.2k-line HTML file; this layout splits
concerns so each module is short enough to read top-to-bottom.

---

## Background reading

- Dobrev, Flocchini, Prencipe, Santoro — *Searching for a Black Hole in
  Arbitrary Networks: Optimal Mobile Agents Protocols*. Distributed Computing
  (2007).
- Královič, Miklík — *Periodic Data Retrieval Problem in Rings Containing a
  Malicious Host*. SIROCCO (2010).
- Bhattacharya, Das, Santoro et al. — recent work on **Byzantine** variants of
  BHS in arbitrary networks (ICDCS / OPODIS lines of work).

The badges in the header reference an ICDCS line of work on Byzantine BHS; the
simulator is meant as a teaching aid alongside that material.

---

## License

Research / educational use.
