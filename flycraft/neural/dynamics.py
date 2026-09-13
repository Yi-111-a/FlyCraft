"""Simple rate or LIF neural dynamics on a fixed graph."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from flycraft.neural.graph import NeuralGraph


@dataclass
class DynamicsConfig:
    model: str = "rate"  # rate | lif
    dt: float = 0.01
    tau: float = 0.05
    threshold: float = 1.0
    reset: float = 0.0
    leak: float = 0.95
    noise_std: float = 0.02


class NeuralDynamics:
    """Stateful activity vector over graph nodes."""

    def __init__(self, graph: NeuralGraph, config: DynamicsConfig | None = None) -> None:
        self.graph = graph
        self.config = config or DynamicsConfig()
        self.v = np.zeros(graph.n, dtype=np.float64)
        self.spike = np.zeros(graph.n, dtype=np.float64)
        self._rng = np.random.default_rng(0)

    def reset(self, seed: int | None = None) -> None:
        self.v[:] = 0.0
        self.spike[:] = 0.0
        if seed is not None:
            self._rng = np.random.default_rng(seed)

    def step(self, current: np.ndarray) -> np.ndarray:
        """Advance one step; `current` shape (N,). Returns activity used for readout."""
        cfg = self.config
        I = np.asarray(current, dtype=np.float64)
        if I.shape != (self.graph.n,):
            raise ValueError(f"current shape {I.shape} != ({self.graph.n},)")

        drive = self.graph.adjacency @ self.v + I
        if cfg.noise_std > 0:
            drive = drive + self._rng.normal(0.0, cfg.noise_std, size=self.graph.n)

        if cfg.model == "lif":
            self.v = cfg.leak * self.v + cfg.dt * drive
            spiked = self.v >= cfg.threshold
            self.spike = spiked.astype(np.float64)
            self.v = np.where(spiked, cfg.reset, self.v)
            return self.spike.copy()

        # rate model: exponential approach toward soft-rectified drive
        target = np.maximum(drive, 0.0)
        alpha = cfg.dt / max(cfg.tau, 1e-6)
        self.v = (1.0 - alpha) * self.v + alpha * target
        self.v = np.clip(self.v, 0.0, 10.0)
        return self.v.copy()
