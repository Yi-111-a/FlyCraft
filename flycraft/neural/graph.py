"""Load JSON connectome-like graphs; optional weight shuffle."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np


@dataclass
class NeuronNode:
    id: str
    type: str  # sensory | interneuron | motor
    label: str
    role: str
    program: str | None = None
    index: int = -1


@dataclass
class NeuralGraph:
    """Sparse directed graph with dense adjacency for small fixtures."""

    name: str
    nodes: list[NeuronNode]
    edges: list[dict[str, Any]]
    adjacency: np.ndarray  # shape (N, N); A[post, pre] = weight (column→row drive)
    id_to_index: dict[str, int] = field(default_factory=dict)
    sensory_ids: list[str] = field(default_factory=list)
    motor_ids: list[str] = field(default_factory=list)
    event_to_sensory: dict[str, list[str]] = field(default_factory=dict)
    program_to_motor: dict[str, list[str]] = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.nodes)


def load_graph(path: str | Path, *, shuffle_weights: bool = False, seed: int = 42) -> NeuralGraph:
    """Load a fixture/real JSON graph. Optionally shuffle edge weights (topology fixed)."""
    path = Path(path)
    raw = json.loads(path.read_text(encoding="utf-8"))
    nodes_raw = raw["nodes"]
    edges_raw = list(raw["edges"])

    if shuffle_weights and edges_raw:
        rng = np.random.default_rng(seed)
        weights = [float(e["weight"]) for e in edges_raw]
        rng.shuffle(weights)
        for e, w in zip(edges_raw, weights):
            e = dict(e)
            e["weight"] = float(w)
        # rebuild list with shuffled weights
        edges_raw = [
            {**edges_raw[i], "weight": float(weights[i])} for i in range(len(edges_raw))
        ]

    nodes: list[NeuronNode] = []
    id_to_index: dict[str, int] = {}
    for i, n in enumerate(nodes_raw):
        node = NeuronNode(
            id=str(n["id"]),
            type=str(n.get("type", "interneuron")),
            label=str(n.get("label", n["id"])),
            role=str(n.get("role", n.get("type", "interneuron"))),
            program=n.get("program"),
            index=i,
        )
        nodes.append(node)
        id_to_index[node.id] = i

    n = len(nodes)
    adj = np.zeros((n, n), dtype=np.float64)
    for e in edges_raw:
        pre = id_to_index[str(e["pre"])]
        post = id_to_index[str(e["post"])]
        adj[post, pre] += float(e["weight"])

    sensory_ids = [nd.id for nd in nodes if nd.type == "sensory"]
    motor_ids = [nd.id for nd in nodes if nd.type == "motor"]

    event_to_sensory: dict[str, list[str]] = {}
    for nd in nodes:
        if nd.type == "sensory":
            event_to_sensory.setdefault(nd.label, []).append(nd.id)

    program_to_motor: dict[str, list[str]] = {}
    for nd in nodes:
        if nd.type == "motor":
            prog = nd.program or nd.label
            program_to_motor.setdefault(prog, []).append(nd.id)

    return NeuralGraph(
        name=str(raw.get("name", path.stem)),
        nodes=nodes,
        edges=edges_raw,
        adjacency=adj,
        id_to_index=id_to_index,
        sensory_ids=sensory_ids,
        motor_ids=motor_ids,
        event_to_sensory=event_to_sensory,
        program_to_motor=program_to_motor,
    )
