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

    def inject_perception(
        self,
        current: np.ndarray,
        *,
        surrounding_count: int = 0,
        visible: bool = True,
        hurt_dir: dict | None = None,
        hurt: bool = False,
    ) -> np.ndarray:
        """Opt4: bias sensory pools with continuous perception channels.

        Uses existing event-labeled sensory neurons as soft channels:
        - surrounding → hostile_near gain
        - not visible → blank-ish damp on hostile_near
        - hurt_dir / hurt → attack sensory gain
        """
        out = np.asarray(current, dtype=np.float64).copy()
        cfg = self.config
        # surrounding count elevates hostile_near sensors
        if surrounding_count > 0:
            gain = cfg.event_gain * min(1.5, 0.15 * surrounding_count)
            for sid in self.graph.event_to_sensory.get("hostile_near", [])[:32]:
                out[self.graph.id_to_index[sid]] += gain
        if not visible:
            for sid in self.graph.event_to_sensory.get("hostile_near", [])[:16]:
                idx = self.graph.id_to_index[sid]
                out[idx] *= 0.7
        if hurt or hurt_dir:
            gain = cfg.event_gain * (0.35 if hurt_dir else 0.2)
            for sid in self.graph.event_to_sensory.get("attack", [])[:32]:
                out[self.graph.id_to_index[sid]] += gain
        return out
