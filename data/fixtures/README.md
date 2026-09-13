# Fixture data provenance

## `tiny_graph.json`

- **Type**: Synthetic sparse directed graph (~30 nodes).
- **Purpose**: Offline / CI / headless demos without downloading MaleCNS.
- **Inspiration**: Node `role` / `pool` labels loosely mirror functional categories discussed in MaleCNS literature (sensory, interneuron, descending / motor-like pools). **Weights and topology are handmade**, not extracted from the published connectome.
- **Not claimed**: Biological accuracy, learning, consciousness, or fidelity to any published synapse table.

## MaleCNS (optional, later)

MaleCNS is typically shared under **CC-BY**. To use a real subgraph later:

1. Obtain data from the official MaleCNS release / portal (do not commit multi‑GB dumps here).
2. Convert to the same JSON schema as `tiny_graph.json` (`nodes`, `edges` with `pre`, `post`, `weight`).
3. Point `configs/default.yaml` → `graph.path` at your file.
4. Attribute MaleCNS (CC-BY) in your README / paper and keep FlyCraft code MIT separate.

This repository **does not** ship or auto-download the full MaleCNS graph.
