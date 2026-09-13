"""Persistent NDJSON decision process used by the live Mineflayer bridge.

Observations arrive on stdin and actions are emitted on stdout.  A MaleCNS-derived
(or fixture) graph and its rate dynamics produce motor scores; light health/distance
floors remain as minimal demo safety (not a learned controller).

Supports Opt2 fight→flee→re-engage state machine, Opt3 ablation of motor edges,
and Opt4 perception channels (visibility / surrounding / hurt direction).
"""
from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

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
    # Opt3: floors reduced — graph readout should dominate.
    flee_floor: float = 0.18
    fight_floor: float = 0.15
    idle_floor: float = 0.08
    # Opt2 cooldowns (ms)
    flee_min_ms: float = 1400.0
    reengage_cooldown_ms: float = 900.0
    fight_sticky_ms: float = 600.0


@dataclass
class DecisionState:
    mode: str = "wander"  # fight | flee | reengage | wander
    mode_since: float = 0.0
    flee_until: float = 0.0
    reengage_until: float = 0.0
    target_id: int | None = None
    last_program: str = "idle"


def _now_ms() -> float:
    return time.time() * 1000.0


def ablate_motor_edges(graph, fraction: float = 0.85, seed: int = 7) -> int:
    """Zero outgoing weights into motor neurons (Opt3 ablation). Returns #edges knocked out."""
    motor_idx = {graph.id_to_index[m] for m in graph.motor_ids}
    rng = np.random.default_rng(seed)
    knocked = 0
    # adjacency[post, pre] — knock edges that drive motor posts
    for post in motor_idx:
        pres = np.where(np.abs(graph.adjacency[post]) > 1e-12)[0]
        if len(pres) == 0:
            continue
        mask = rng.random(len(pres)) < fraction
        for pre, do in zip(pres, mask):
            if do:
                graph.adjacency[post, pre] = 0.0
                knocked += 1
    return knocked


class LiveController:
    """Stateful graph controller with fight/flee/re-engage machine and reduced floors."""

    def __init__(self, config_path: str | Path | None = None) -> None:
        cfg_path = config_path or os.environ.get("FLYCRAFT_CONFIG")
        cfg = load_config(cfg_path)
        self.cfg = cfg
        self.graph = build_graph_from_config(cfg)
        gpath = Path(cfg.get("graph", {}).get("path", ""))
        self.graph_path = str(gpath)

        self.ablation = os.environ.get("FLYCRAFT_ABLATION", "").strip().lower() in {
            "1", "true", "yes", "motor"
        }
        self.ablated_edges = 0
        if self.ablation:
            frac = float(os.environ.get("FLYCRAFT_ABLATION_FRAC", "0.85"))
            self.ablated_edges = ablate_motor_edges(self.graph, fraction=frac)

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
        self.state = DecisionState(mode_since=_now_ms())

    def _pick_target(self, obs: dict[str, Any]) -> dict[str, Any] | None:
        hostiles = obs.get("hostiles") or []
        primary = obs.get("hostile")
        candidates: list[dict[str, Any]] = []
        if isinstance(hostiles, list):
            candidates.extend([h for h in hostiles if isinstance(h, dict) and h.get("distance") is not None])
        if primary and isinstance(primary, dict) and primary.get("distance") is not None:
            if not any(c.get("id") == primary.get("id") for c in candidates):
                candidates.append(primary)
        if not candidates:
            return None

        prefer = self.state.target_id
        best = None
        best_score = -1e9
        for h in candidates:
            dist = float(h["distance"])
            score = 40.0 - dist * 2.2
            surrounding = float(obs.get("surrounding_count") or 0)
            if surrounding >= 3 and dist < 6:
                score += 2.0  # prioritize nearer when surrounded
            if prefer is not None and h.get("id") == prefer:
                score += 8.0
            dy = abs(float(h.get("dy") or 0.0))
            score -= dy * 1.5
            if not obs.get("visible", True) and h is primary:
                score -= 3.0
            if score > best_score:
                best_score = score
                best = h
        return best

    def _neural_scores(
        self,
        event: str,
        *,
        surrounding_count: int = 0,
        visible: bool = True,
        hurt_dir: dict | None = None,
        hurt: bool = False,
    ) -> dict[str, float]:
        current = self.encoder.encode(event)
        current = self.encoder.inject_perception(
            current,
            surrounding_count=surrounding_count,
            visible=visible,
            hurt_dir=hurt_dir,
            hurt=hurt,
        )
        activity = self.dynamics.v.copy()
        substeps = max(1, int(self.cfg.get("loop", {}).get("substeps", 10)))
        decay = float(self.cfg.get("encode", {}).get("decay", 0.85))
        for i in range(substeps):
            if i:
                current = current * decay
            activity = self.dynamics.step(current)
        self.encoder.set_trace(current)
        return self.decoder.decode(activity)

    def _transition(self, *, must_flee: bool, has_hostile: bool, now: float) -> str:
        """Opt2 state machine: fight → flee → reengage → fight/wander."""
        st = self.state
        th = self.thresholds

        if must_flee:
            if st.mode != "flee":
                st.mode = "flee"
                st.mode_since = now
                st.flee_until = now + th.flee_min_ms
            else:
                st.flee_until = max(st.flee_until, now + th.flee_min_ms * 0.5)
            return "flee"

        if st.mode == "flee":
            if now < st.flee_until:
                return "flee"
            # exit flee → re-engage cooldown before full fight
            st.mode = "reengage"
            st.mode_since = now
            st.reengage_until = now + th.reengage_cooldown_ms
            return "reengage" if has_hostile else "wander"

        if st.mode == "reengage":
            if now < st.reengage_until and has_hostile:
                return "reengage"
            if has_hostile:
                st.mode = "fight"
                st.mode_since = now
                return "fight"
            st.mode = "wander"
            st.mode_since = now
            return "wander"

        if has_hostile:
            if st.mode != "fight":
                st.mode = "fight"
                st.mode_since = now
            return "fight"

        st.mode = "wander"
        st.mode_since = now
        return "wander"

    def decide(self, obs: dict[str, Any]) -> dict[str, Any]:
        health = float(obs.get("health", 20.0))
        hurt = bool(obs.get("hurt", False))
        surrounding = int(obs.get("surrounding_count") or 0)
        visible = bool(obs.get("visible", True))
        hurt_dir = obs.get("hurt_dir")
        target = self._pick_target(obs)
        distance = float(target["distance"]) if target else None
        has_hostile = distance is not None
        if target and target.get("id") is not None:
            try:
                self.state.target_id = int(target["id"])
            except (TypeError, ValueError):
                self.state.target_id = target.get("id")

        th = self.thresholds
        low = health <= th.low_health
        hurt_flee = hurt and health <= th.hurt_flee_health
        # Surrounded + soft HP also prefers flee
        surrounded_soft = surrounding >= 3 and health <= th.hurt_flee_health
        must_flee = low or hurt_flee or surrounded_soft

        now = _now_ms()
        mode = self._transition(must_flee=must_flee, has_hostile=has_hostile, now=now)

        # Map mode → sensory event
        if mode == "flee":
            event = "attack"
        elif mode in ("fight", "reengage") and has_hostile and distance <= th.fight_distance:
            event = "hostile_near"
        else:
            event = "blank"

        # Opt4: modulate event with perception channels via light current bias after decode floors
        scores = self._neural_scores(
            event,
            surrounding_count=surrounding,
            visible=visible,
            hurt_dir=hurt_dir if isinstance(hurt_dir, dict) else None,
            hurt=hurt,
        )

        reason = mode
        if mode == "flee":
            scores["flee"] = scores.get("flee", 0.0) + th.flee_floor + (20.0 - health) / 45.0
            if hurt_dir:
                scores["flee"] = scores.get("flee", 0.0) + 0.05
            if must_flee:
                reason = "low_health" if low else ("hurt_soft" if hurt_flee else "surrounded_soft")
            else:
                reason = "flee_min_window"
        elif mode == "reengage" and has_hostile:
            # Cautious approach: fight with small flee residual
            scores["fight"] = scores.get("fight", 0.0) + th.fight_floor * 0.7
            scores["flee"] = scores.get("flee", 0.0) + 0.04
            if not visible:
                scores["idle"] = scores.get("idle", 0.0) + 0.05
            reason = "reengage"
        elif mode == "fight" and has_hostile and distance <= th.fight_distance:
            scores["fight"] = (
                scores.get("fight", 0.0)
                + th.fight_floor
                + max(0.0, 10.0 - float(distance)) / 22.0
            )
            if surrounding >= 2:
                scores["fight"] = scores.get("fight", 0.0) + 0.04
            if hurt and not low:
                scores["flee"] = scores.get("flee", 0.0) + 0.03
            reason = "hostile_near_hp_ok"
        else:
            scores["idle"] = scores.get("idle", 0.0) + th.idle_floor
            reason = "clear"

        # During reengage, force program toward fight (approach) not idle
        program = self.decoder.pick(scores)
        if mode == "reengage" and has_hostile and program == "idle":
            program = "fight"
        if mode == "flee":
            program = "flee"
        if mode == "fight" and has_hostile and program not in ("fight", "flee"):
            # sticky fight briefly
            if now - self.state.mode_since < th.fight_sticky_ms:
                program = "fight"

        self.state.last_program = program
        self.step += 1
        return {
            "type": "action",
            "program": program,
            "commands": run_program(program),
            "scores": scores,
            "neural_event": event,
            "reason": reason,
            "mode": mode,
            "target_id": self.state.target_id,
            "step": self.step,
            "t": obs.get("t", self.step),
            "graph_nodes": self.graph.n,
            "graph_path": self.graph_path,
            "ablation": self.ablation,
            "ablated_edges": self.ablated_edges,
            "surrounding_count": surrounding,
            "visible": visible,
        }


def main() -> int:
    controller = LiveController()
    gname = Path(controller.graph_path).as_posix()
    kind = "malecns" if "malecns" in gname.lower() else ("fixture" if "fixture" in gname.lower() else "graph")
    print(
        f"[flycraft-python] {kind} subgraph nodes={controller.graph.n} edges={len(controller.graph.edges)} "
        f"path={gname} sensory={len(controller.graph.sensory_ids)} "
        f"motor={len(controller.graph.motor_ids)} ablation={controller.ablation} "
        f"ablated_edges={controller.ablated_edges}",
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
