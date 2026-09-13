"""Map discrete world events to sensory currents."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from flycraft.neural.graph import NeuralGraph


@dataclass
class EncodeConfig:
    event_gain: float = 1.5
    decay: float = 0.8


class SensoryEncoder:
    def __init__(self, graph: NeuralGraph, config: EncodeConfig | None = None) -> None:
        self.graph = graph
        self.config = config or EncodeConfig()
        self._trace = np.zeros(graph.n, dtype=np.float64)

    def reset(self) -> None:
        self._trace[:] = 0.0

    def set_trace(self, trace: np.ndarray) -> None:
        self._trace = np.asarray(trace, dtype=np.float64).copy()

    def encode(self, event_name: str) -> np.ndarray:
        """Return current vector for this event; maintains a decaying sensory trace."""
        cfg = self.config
        self._trace *= cfg.decay
        ids = self.graph.event_to_sensory.get(event_name, [])
        # blank: no injection (trace still decays)
        if event_name != "blank":
            for sid in ids:
                idx = self.graph.id_to_index[sid]
                self._trace[idx] += cfg.event_gain
        return self._trace.copy()
