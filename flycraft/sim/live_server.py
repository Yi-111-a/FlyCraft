"""Persistent NDJSON decision process used by the live Mineflayer bridge.

Observations arrive on stdin and actions are emitted on stdout.  A MaleCNS-derived
(or fixture) graph and its rate dynamics produce motor scores; light health/distance
floors remain as minimal demo safety (not a learned controller).
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from flycraft.body.programs import run_program
from flycraft.neural.decode import DecodeConfig, MotorDecoder
from flycraft.neural.dynamics import DynamicsConfig, NeuralDynamics
from flycraft.neural.encode import EncodeConfig, SensoryEncoder
from flycraft.sim.loop import build_graph_from_config, load_config


@dataclass
class LiveThresholds:
    low_health: float = 8.0
    # Brief hurt only forces flee when HP is already soft; healthy bots keep fighting.
    hurt_flee_health: float = 14.0
    fight_distance: float = 12.0
    danger_distance: float = 3.2
    flee_floor: float = 0.40
    fight_floor: float = 0.35
    idle_floor: float = 0.15


class LiveController:
    """Stateful graph controller with transparent, reduced safety score floors."""

    def __init__(self, config_path: str | Path | None = None) -> None:
        cfg_path = config_path or os.environ.get("FLYCRAFT_CONFIG")
        cfg = load_config(cfg_path)
        self.cfg = cfg
        self.graph = build_graph_from_config(cfg)
        gpath = Path(cfg.get("graph", {}).get("path", ""))
        self.graph_path = str(gpath)
        self.encoder = SensoryEncoder(
            self.graph,
            EncodeConfig(**{k: v for k, v in cfg.get("encode", {}).items()
                            if k in EncodeConfig.__dataclass_fields__}),
        )
        self.dynamics = NeuralDynamics(
            self.graph,
            DynamicsConfig(**{k: v for k, v in cfg.get("dynamics", {}).items()
                              if k in DynamicsConfig.__dataclass_fields__}),
        )
        self.dynamics.reset(seed=0)
        self.decoder = MotorDecoder(
            self.graph,
            DecodeConfig(**{k: v for k, v in cfg.get("decode", {}).items()
                            if k in DecodeConfig.__dataclass_fields__}),
        )
        live = cfg.get("live", {})
        self.thresholds = LiveThresholds(
            **{k: v for k, v in live.items() if k in LiveThresholds.__dataclass_fields__}
        )
        self.step = 0

    def decide(self, obs: dict[str, Any]) -> dict[str, Any]:
        health = float(obs.get("health", 20.0))
        hurt = bool(obs.get("hurt", False))
        hostile = obs.get("hostile") or {}
        distance_raw = hostile.get("distance")
        distance = float(distance_raw) if distance_raw is not None else None
        has_hostile = distance is not None

        th = self.thresholds
        # Flee mainly on low HP. Brief hurt only sticky-flees when already soft.
        low = health <= th.low_health
        hurt_flee = hurt and health <= th.hurt_flee_health
        must_flee = low or hurt_flee

        if must_flee:
            event = "attack"
        elif has_hostile and distance <= th.fight_distance:
            event = "hostile_near"
        else:
            event = "blank"

        current = self.encoder.encode(event)
        activity = self.dynamics.v.copy()
        substeps = max(1, int(self.cfg.get("loop", {}).get("substeps", 10)))
        decay = float(self.cfg.get("encode", {}).get("decay", 0.85))
        for i in range(substeps):
            if i:
                current = current * decay
            activity = self.dynamics.step(current)
        self.encoder.set_trace(current)
        scores = self.decoder.decode(activity)

        # Minimal floors — graph readout is the primary score source.
        if must_flee:
            scores["flee"] = scores.get("flee", 0.0) + th.flee_floor + (20.0 - health) / 35.0
            reason = "low_health" if low else "hurt_soft"
        elif has_hostile and distance <= th.fight_distance:
            # Healthy + hostile near → fight like a zombie; tiny flinch if hurt but HP OK.
            scores["fight"] = (
                scores.get("fight", 0.0)
                + th.fight_floor
                + max(0.0, 10.0 - float(distance)) / 18.0
            )
            if hurt and not low:
                scores["flee"] = scores.get("flee", 0.0) + 0.05
            reason = "hostile_near_hp_ok"
        else:
            scores["idle"] = scores.get("idle", 0.0) + th.idle_floor
            reason = "clear"

        program = self.decoder.pick(scores)
        self.step += 1
        return {
            "type": "action",
            "program": program,
            "commands": run_program(program),
            "scores": scores,
            "neural_event": event,
            "reason": reason,
            "step": self.step,
            "t": obs.get("t", self.step),
            "graph_nodes": self.graph.n,
            "graph_path": self.graph_path,
        }


def main() -> int:
    controller = LiveController()
    gname = Path(controller.graph_path).as_posix()
    kind = "malecns" if "malecns" in gname.lower() else ("fixture" if "fixture" in gname.lower() else "graph")
    print(
        f"[flycraft-python] {kind} subgraph nodes={controller.graph.n} edges={len(controller.graph.edges)} "
        f"path={gname} sensory={len(controller.graph.sensory_ids)} "
        f"motor={len(controller.graph.motor_ids)}",
        file=sys.stderr,
        flush=True,
    )
    print(
        f"malecns subgraph nodes={controller.graph.n} edges={len(controller.graph.edges)}",
        file=sys.stderr,
        flush=True,
    )
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            obs = json.loads(line)
            action = controller.decide(obs)
            print(json.dumps(action, separators=(",", ":")), flush=True)
        except Exception as exc:  # keep the durable subprocess alive on malformed input
            print(json.dumps({"type": "error", "error": str(exc)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
