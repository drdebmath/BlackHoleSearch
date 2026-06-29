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
- **Theoretical bounds** displayed as you tune the parameters — the team size
  `k`, time complexity, and algorithm name update in real time.

### Byzantine strategy

| Mode | Meaning |
|---|---|
| **Adversarial** | Byzantine agents can join any CCP probe, always survive, and always report a return (whether the port is actually safe or dangerous), trying to stall classification and mislead the team. |
| **Passive** | Byzantine agents never volunteer for a probe, so they never get a chance to lie — but they also never get caught. |

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

The simulator runs a **real Cascading Cautious Probe (CCP)** per unexplored
port, matching Algorithm 1 in the paper:

1. A physical **DFS** walk is precomputed from the homebase, including
   backtracking moves.
2. To classify an unexplored port `p`, a probe wave is sent through it:
   the **first wave is `f+1-|B|` agents** (`B` = already-identified
   Byzantine agents), sent in a single round; every wave after that is
   **one agent at a time**.
3. The round after a wave is sent, the simulator checks who came back:
   - `R` = agents that returned through `p` (evidence the port is *safe*).
   - `D` = agents that did **not** return through `p` (evidence the port is
     *dangerous*).
   - The instant either `|R|` or `|D|` reaches `f+1-|B|`, the port is
     classified — there is **no need for all `2f+1` agents to be exhausted**;
     reaching the threshold either way is conclusive proof on its own.
4. If nobody misbehaves, this takes exactly **2 rounds**. Every Byzantine
   agent that gets folded into the probe and behaves adversarially adds
   **2 more rounds** to the cascade (Lemma 2), with an absolute worst case of
   **`2f+1` agents and `2f+2` rounds** to resolve a single port (Lemma 1).
5. A good agent that walks into the real black hole never returns and is
   removed from the simulation. A Byzantine agent **never dies** — under the
   **Byzantine Strategy** setting:
   - *Adversarial*: it can join any probe, always returns regardless of the
     true status of the node, and is exposed as Byzantine the moment its
     return behaviour contradicts the port's final classification.
   - *Passive*: it never volunteers for a probe at all, so it can't stall a
     classification, but it also can never be caught by CCP.
6. The run finishes when the BH is located (known-map) or when every edge has
   been classified (unknown-map). The mission fails if every honest agent is
   consumed before that happens.

> ⚠️ This is a **teaching / visualisation prototype**, not a verified
> implementation of any published protocol, but the CCP step now follows
> Algorithm 1's send/await/cascade structure and threshold logic directly,
> rather than abstracting it into a single coin-flip.

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
