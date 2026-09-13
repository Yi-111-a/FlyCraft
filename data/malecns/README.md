# MaleCNS subgraph provenance (CC-BY)

## What this is
`subgraph_fight.json` is a **real MaleCNS v1.0-derived** sparse subgraph for the FlyCraft Minecraft demo — **not** the synthetic `data/fixtures/tiny_graph.json` fixture.

- Nodes: 8000 (sensory=461, motor=910, interneuron=6629)
- Edges: 351353 (raw synapse count ≥ 5, then log1p-scaled for rate dynamics)
- Construction: seed sensory + descending/motor neurons from body annotations → BFS depth 3 intersection → cap 8000

## Source files (worked)
1. `https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/body-annotations-male-cns-v1.0-minconf-0.5.feather` (14 MB) — **worked from deploy box**
2. `https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/connectome-weights-male-cns-v1.0-minconf-0.5-significant-only.feather` (502 MB) — **worked from deploy box**
3. Mirror also listed at HuggingFace `svgmediabills/malecns-connectome` / `hf-mirror.com` (same flat-connectome files)

Official portal: https://male-cns.janelia.org/download/

## Attribution
Male CNS Connectome © FlyEM (HHMI Janelia), University of Cambridge, MRC Laboratory of Molecular Biology, Google Research. Licensed **CC-BY**. Cite the MaleCNS release / associated paper when publishing.

## Honesty
Event labels (`hostile_near`, `attack`, …) and body-program tags (`fight`, `flee`, …) are **engineering overlays** for Minecraft affordances. They do not claim validated behavioral identity for each MaleCNS cell type. Dynamics remain fixed-graph rate/LIF stepping, not a trained Minecraft agent.
