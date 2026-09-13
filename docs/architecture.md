# Architecture

## Pipeline

```
Minecraft events  →  sensory encoding  →  sparse neural dynamics on graph
                  →  motor readouts    →  scripted body programs
                  →  Minecraft actions
```

### Components

1. **`bridge/schema.py`** — `Event` and `Action` dataclasses; JSON field docs in `protocol.md`.
2. **`neural/graph.py`** — Load JSON nodes/edges; optional weight shuffle (control).
3. **`neural/encode.py`** — Map event names to sensory node currents.
4. **`neural/dynamics.py`** — Discrete-time rate model or simple LIF on the adjacency.
5. **`neural/decode.py`** — Aggregate motor-pool activity → body-program scores.
6. **`body/programs.py`** — Named programs (`flee`, `approach_food`, `turn_left`, `turn_right`, `jump`, `idle`) emitting action lists.
7. **`sim/loop.py`** — Closed loop: encode → step → decode → program → log.
8. **`sim/run_headless.py`** — CLI; injects a fixed event sequence without Minecraft.
9. **`bridge-js/`** — Mineflayer stub; dry-run prints actions; `MC_HOST` TODO.

### Design constraints

- No NeuroCraft mod dependency (unreleased).
- Default graph is a small synthetic fixture.
- Headless path never opens a Minecraft socket.
- Own code under MIT; MaleCNS attribution (CC-BY) when real data is used later.

### Control experiment

`--shuffle-weights` permutes edge weights while keeping topology, to contrast structured vs random synaptic strengths.
