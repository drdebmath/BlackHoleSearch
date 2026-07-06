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
and `f` the number of Byzantine agents. **CCP** = *Cascading Cautious Probe*,
a probe-and-cross-check primitive used to test a candidate edge without losing
more than `f+1` honest agents.

---

## How it works (under the hood)

### 1. Classifying the territory

Every port/edge starts as **unexplored**. During exploration it is promoted to
one of two terminal states:

| State | Rule |
|---|---|
| **Safe** | At least `f + 1` different agents leave through the port and return from it. Since at most `f` agents are Byzantine, one returning witness must be honest. |
| **Dangerous** | At least `f + 1` different agents leave through the port and do not return. |
| **Unexplored** | Neither threshold has been reached yet. |

The golden rule is enforced by the simulator: once a port is classified as
dangerous, no future DFS move or probe is allowed to traverse it.

### 2. Cascading Cautious Probe

DFS chooses the next unexplored port, then CCP checks it without sending the
whole team at once:

1. **Initial scout group:** exactly `f + 1` non-blacklisted agents probe the
   port.
2. **Solo probing phase:** if the initial evidence is inconclusive, remaining
   non-blacklisted agents probe one at a time.
3. **Return-or-perish loop:** each solo agent attempts to enter the node and
   return to the group.
4. **Safety confirmed:** the port is marked safe as soon as `f + 1` distinct
   agents have returned.
5. **Danger confirmed:** the port is marked dangerous as soon as `f + 1`
   distinct agents have failed to return.
6. **Moving forward:** only after a port is certified safe does the surviving
   group move across it and continue the DFS.

The total probe budget for one port is capped at `2f + 1` agents, which is
enough to overcome up to `f` Byzantine responses while still limiting losses.

### 3. Catching Byzantine agents

Byzantine agents are immune to the black hole and can behave arbitrarily. CCP
exposes them through inconsistent probe outcomes:

- If an agent returns from a port that is later certified **dangerous**, it is
  blacklisted as Byzantine.
- If an agent refuses to return from a port that is later certified **safe**,
  it is blacklisted as Byzantine.
- Blacklisted agents remain visible in the simulator, but they are permanently
  excluded from future CCP probe groups.

> ⚠️ This is a **teaching / visualisation prototype**. It models the threshold
> logic of CCP and the DFS exploration strategy, while abstracting away lower
> level details such as authentication and message scheduling.

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
