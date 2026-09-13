"""Motor pool activity → body program scores."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from flycraft.body.programs import PROGRAM_NAMES
from flycraft.neural.graph import NeuralGraph


@dataclass
class DecodeConfig:
    temperature: float = 1.0
    idle_bias: float = 0.1


class MotorDecoder:
    def __init__(self, graph: NeuralGraph, config: DecodeConfig | None = None) -> None:
        self.graph = graph
        self.config = config or DecodeConfig()

    def decode(self, activity: np.ndarray) -> dict[str, float]:
        """Return raw scores per body program."""
        scores = {name: 0.0 for name in PROGRAM_NAMES}
        for prog, motor_ids in self.graph.program_to_motor.items():
            if prog not in scores:
                scores[prog] = 0.0
            vals = [float(activity[self.graph.id_to_index[m]]) for m in motor_ids]
            scores[prog] = float(np.mean(vals)) if vals else 0.0
        scores["idle"] = scores.get("idle", 0.0) + self.config.idle_bias
        return scores

    def pick(self, scores: dict[str, float]) -> str:
        """Argmax with temperature softening (still deterministic argmax after scale)."""
        temp = max(self.config.temperature, 1e-6)
        scaled = {k: v / temp for k, v in scores.items()}
        return max(scaled, key=scaled.get)
