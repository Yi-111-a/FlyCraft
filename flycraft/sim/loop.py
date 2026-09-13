"""Closed-loop simulation: events → neural → body programs."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

import yaml

from flycraft.body.programs import run_program
from flycraft.bridge.schema import Action, Event
from flycraft.neural.decode import DecodeConfig, MotorDecoder
from flycraft.neural.dynamics import DynamicsConfig, NeuralDynamics
from flycraft.neural.encode import EncodeConfig, SensoryEncoder
from flycraft.neural.graph import NeuralGraph, load_graph


@dataclass
class StepLog:
    step: int
    event: str
    program: str
    scores: dict[str, float]
    commands: list[dict[str, Any]]
    mean_activity: float


@dataclass
class LoopResult:
    logs: list[StepLog] = field(default_factory=list)
    shuffle_weights: bool = False


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    root = _project_root()
    cfg_path = Path(path) if path else root / "configs" / "default.yaml"
    with cfg_path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_graph_from_config(
    cfg: dict[str, Any],
    *,
    shuffle_weights: bool | None = None,
    root: Path | None = None,
) -> NeuralGraph:
    root = root or _project_root()
    gcfg = cfg.get("graph", {})
    path = Path(gcfg.get("path", "data/fixtures/tiny_graph.json"))
    if not path.is_absolute():
        path = root / path
    shuffle = gcfg.get("shuffle_weights", False) if shuffle_weights is None else shuffle_weights
    seed = int(gcfg.get("seed", 42))
    return load_graph(path, shuffle_weights=bool(shuffle), seed=seed)


def run_closed_loop(
    events: list[str],
    *,
    config: dict[str, Any] | None = None,
    shuffle_weights: bool = False,
    dynamics_seed: int = 0,
) -> LoopResult:
    """Run encode → multi-step dynamics → decode → program for each event."""
    cfg = config or load_config()
    graph = build_graph_from_config(cfg, shuffle_weights=shuffle_weights)

    enc = SensoryEncoder(
        graph,
        EncodeConfig(
            **{k: v for k, v in cfg.get("encode", {}).items() if k in EncodeConfig.__dataclass_fields__}
        ),
    )
    dyn_kwargs = {
        k: v for k, v in cfg.get("dynamics", {}).items() if k in DynamicsConfig.__dataclass_fields__
    }
    dyn = NeuralDynamics(graph, DynamicsConfig(**dyn_kwargs))
    dyn.reset(seed=dynamics_seed)
    dec = MotorDecoder(
        graph,
        DecodeConfig(
            **{k: v for k, v in cfg.get("decode", {}).items() if k in DecodeConfig.__dataclass_fields__}
        ),
    )

    substeps = int(cfg.get("loop", {}).get("substeps", 8))
    hold_decay = float(cfg.get("encode", {}).get("decay", 0.8))

    result = LoopResult(shuffle_weights=shuffle_weights)
    for i, ev_name in enumerate(events):
        current = enc.encode(ev_name)
        activity = dyn.v.copy()
        for s in range(max(1, substeps)):
            if s > 0:
                current = current * hold_decay
            activity = dyn.step(current)
        enc.set_trace(current)  # align sensory trace with settled hold
        scores = dec.decode(activity)
        if ev_name == "blank":
            # Blank epochs bias toward idle so residuals do not keep prior programs sticky
            scores = dict(scores)
            scores["idle"] = scores.get("idle", 0.0) + 0.35
        program = dec.pick(scores)
        commands = run_program(program)
        result.logs.append(
            StepLog(
                step=i,
                event=ev_name,
                program=program,
                scores=scores,
                commands=commands,
                mean_activity=float(activity.mean()),
            )
        )
    return result


def iter_actions(result: LoopResult) -> Iterator[Action]:
    for log in result.logs:
        yield Action(
            program=log.program,
            commands=log.commands,
            scores=log.scores,
            t=float(log.step),
        )


def events_from_names(names: list[str]) -> list[Event]:
    return [Event(name=n, t=float(i)) for i, n in enumerate(names)]
