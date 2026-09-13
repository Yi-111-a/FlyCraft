"""Event / Action dataclasses and JSON helpers."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Event:
    name: str
    t: float = 0.0
    payload: dict[str, Any] = field(default_factory=dict)
    type: str = "event"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Event:
        return cls(
            name=str(data["name"]),
            t=float(data.get("t", 0.0)),
            payload=dict(data.get("payload") or {}),
            type=str(data.get("type", "event")),
        )


@dataclass
class Action:
    program: str
    commands: list[dict[str, Any]]
    scores: dict[str, float] = field(default_factory=dict)
    t: float = 0.0
    type: str = "action"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Action:
        return cls(
            program=str(data["program"]),
            commands=list(data.get("commands") or []),
            scores={k: float(v) for k, v in (data.get("scores") or {}).items()},
            t=float(data.get("t", 0.0)),
            type=str(data.get("type", "action")),
        )


# Informal JSON Schema documentation (kept next to dataclasses for the MVP).
EVENT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["name"],
    "properties": {
        "type": {"const": "event"},
        "name": {"type": "string"},
        "t": {"type": "number"},
        "payload": {"type": "object"},
    },
}

ACTION_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["program", "commands"],
    "properties": {
        "type": {"const": "action"},
        "program": {"type": "string"},
        "commands": {"type": "array"},
        "scores": {"type": "object"},
        "t": {"type": "number"},
    },
}
