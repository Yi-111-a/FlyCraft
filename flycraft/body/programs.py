"""Scripted body programs → low-level command lists for the Minecraft bridge."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


PROGRAM_NAMES: tuple[str, ...] = (
    "flee",
    "fight",
    "approach_food",
    "turn_left",
    "turn_right",
    "jump",
    "idle",
)


@dataclass(frozen=True)
class BodyProgram:
    name: str
    description: str
    build: Callable[[], list[dict[str, Any]]]


def _flee() -> list[dict[str, Any]]:
    return [
        {"op": "look", "yaw_delta": 180},
        {"op": "sprint_back", "ticks": 12},
        {"op": "jump", "ticks": 2},
    ]


def _fight() -> list[dict[str, Any]]:
    return [
        {"op": "look_at_nearest", "tag": "hostile"},
        {"op": "approach", "range": 2.8},
        {"op": "attack", "cooldown_ms": 650},
    ]


def _approach_food() -> list[dict[str, Any]]:
    return [
        {"op": "look_at_nearest", "tag": "food"},
        {"op": "forward", "ticks": 15},
        {"op": "use_item", "hand": "main"},
    ]


def _turn_left() -> list[dict[str, Any]]:
    return [{"op": "look", "yaw_delta": -45}, {"op": "forward", "ticks": 4}]


def _turn_right() -> list[dict[str, Any]]:
    return [{"op": "look", "yaw_delta": 45}, {"op": "forward", "ticks": 4}]


def _jump() -> list[dict[str, Any]]:
    return [{"op": "jump", "ticks": 4}, {"op": "forward", "ticks": 2}]


def _idle() -> list[dict[str, Any]]:
    return [{"op": "wait", "ticks": 5}]


PROGRAMS: dict[str, BodyProgram] = {
    "flee": BodyProgram("flee", "Turn and sprint away", _flee),
    "fight": BodyProgram("fight", "Face, approach, and attack a hostile", _fight),
    "approach_food": BodyProgram("approach_food", "Move toward food and use", _approach_food),
    "turn_left": BodyProgram("turn_left", "Yaw left and step", _turn_left),
    "turn_right": BodyProgram("turn_right", "Yaw right and step", _turn_right),
    "jump": BodyProgram("jump", "Jump forward", _jump),
    "idle": BodyProgram("idle", "Wait in place", _idle),
}


def run_program(name: str) -> list[dict[str, Any]]:
    if name not in PROGRAMS:
        raise KeyError(f"unknown program: {name}")
    return PROGRAMS[name].build()
