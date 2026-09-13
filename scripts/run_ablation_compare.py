#!/usr/bin/env python3
"""Opt3: prove connectome matters by ablating motor-driving edges.

Runs the same observation sequence with intact vs ablated graph and writes
artifacts/ablation_compare.json. Expect ablated controller to lose fight/flee
alignment and score margins.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from flycraft.sim.live_server import LiveController  # noqa: E402


SEQ = [
    {"health": 20, "hurt": False, "visible": True, "surrounding_count": 1,
     "hostile": {"id": 1, "name": "husk", "distance": 4.0, "dy": 0},
     "hostiles": [{"id": 1, "name": "husk", "distance": 4.0, "dy": 0}]},
    {"health": 18, "hurt": False, "visible": True, "surrounding_count": 2,
     "hostile": {"id": 1, "name": "husk", "distance": 2.5, "dy": 0},
     "hostiles": [
         {"id": 1, "name": "husk", "distance": 2.5, "dy": 0},
         {"id": 2, "name": "husk", "distance": 6.0, "dy": 0},
     ]},
    {"health": 6, "hurt": True, "visible": True, "surrounding_count": 2,
     "hostile": {"id": 1, "name": "husk", "distance": 2.0, "dy": 0},
     "hostiles": [{"id": 1, "name": "husk", "distance": 2.0, "dy": 0}]},
    {"health": 5, "hurt": True, "visible": True, "surrounding_count": 3,
     "hostile": {"id": 2, "name": "husk", "distance": 3.0, "dy": 0},
     "hostiles": [
         {"id": 1, "name": "husk", "distance": 4.0, "dy": 0},
         {"id": 2, "name": "husk", "distance": 3.0, "dy": 0},
         {"id": 3, "name": "husk", "distance": 5.0, "dy": 0},
     ]},
    {"health": 16, "hurt": False, "visible": True, "surrounding_count": 1,
     "hostile": {"id": 1, "name": "husk", "distance": 5.0, "dy": 0},
     "hostiles": [{"id": 1, "name": "husk", "distance": 5.0, "dy": 0}]},
    {"health": 20, "hurt": False, "visible": False, "surrounding_count": 0,
     "hostile": None, "hostiles": []},
]


def run(label: str, ablate: bool) -> dict:
    env_ab = os.environ.get("FLYCRAFT_ABLATION")
    if ablate:
        os.environ["FLYCRAFT_ABLATION"] = "1"
        os.environ["FLYCRAFT_ABLATION_FRAC"] = os.environ.get("FLYCRAFT_ABLATION_FRAC", "0.9")
    else:
        os.environ.pop("FLYCRAFT_ABLATION", None)
    try:
        ctrl = LiveController(ROOT / "configs" / "malecns.yaml")
        rows = []
        for i, obs in enumerate(SEQ):
            out = ctrl.decide(dict(obs, t=i))
            rows.append({
                "i": i,
                "program": out["program"],
                "mode": out["mode"],
                "scores": {k: round(float(v), 4) for k, v in out["scores"].items()},
                "neural_event": out["neural_event"],
            })
        return {
            "label": label,
            "ablation": ctrl.ablation,
            "ablated_edges": ctrl.ablated_edges,
            "graph_nodes": ctrl.graph.n,
            "rows": rows,
        }
    finally:
        if env_ab is None:
            os.environ.pop("FLYCRAFT_ABLATION", None)
        else:
            os.environ["FLYCRAFT_ABLATION"] = env_ab


def margin(row: dict, prog: str) -> float:
    scores = row["scores"]
    winner = scores.get(prog, 0.0)
    others = [v for k, v in scores.items() if k != prog]
    second = max(others) if others else 0.0
    return float(winner - second)


def main() -> int:
    intact = run("intact", False)
    ablated = run("ablated_motor", True)

    agree = 0
    fight_margin_drop = []
    for a, b in zip(intact["rows"], ablated["rows"]):
        if a["program"] == b["program"]:
            agree += 1
        if a["program"] == "fight":
            fight_margin_drop.append(margin(a, "fight") - margin(b, "fight"))

    expected = ["fight", "fight", "flee", "flee", "flee", "idle"]
    intact_match = sum(1 for r, e in zip(intact["rows"], expected) if r["program"] == e or (e == "idle" and r["program"] in ("idle", "wander")))
    # ablated: state machine still forces flee on low HP, but fight margins / graph-driven picks degrade
    ablated_fight_margins = [margin(r, "fight") for r in ablated["rows"] if r["mode"] == "fight" or r["program"] == "fight"]
    intact_fight_margins = [margin(r, "fight") for r in intact["rows"] if r["mode"] == "fight" or r["program"] == "fight"]

    mean_intact = sum(intact_fight_margins) / max(1, len(intact_fight_margins))
    mean_ablated = sum(ablated_fight_margins) / max(1, len(ablated_fight_margins))
    # Also compare raw graph fight scores on first fight obs
    intact_fight_score = intact["rows"][0]["scores"].get("fight", 0)
    ablated_fight_score = ablated["rows"][0]["scores"].get("fight", 0)

    drop = mean_intact - mean_ablated
    score_drop = intact_fight_score - ablated_fight_score
    # Pass if ablation knocks edges and either program disagreement or fight score/margin drop
    measurable = (
        ablated["ablated_edges"] > 100
        and (agree < len(SEQ) or score_drop > 0.01 or drop > 0.01 or intact_fight_score > ablated_fight_score)
    )

    out = {
        "pass": bool(measurable and intact_match >= 4),
        "intact_expected_match": intact_match,
        "program_agree_intact_vs_ablated": agree,
        "seq_len": len(SEQ),
        "mean_fight_margin_intact": round(mean_intact, 4),
        "mean_fight_margin_ablated": round(mean_ablated, 4),
        "fight_margin_drop": round(drop, 4),
        "fight_score_intact_step0": round(intact_fight_score, 4),
        "fight_score_ablated_step0": round(ablated_fight_score, 4),
        "fight_score_drop": round(score_drop, 4),
        "ablated_edges": ablated["ablated_edges"],
        "intact": intact,
        "ablated": ablated,
        "note": "Motor-edge ablation should reduce fight readout strength / agreement vs intact graph.",
    }
    dest = ROOT / "artifacts" / "ablation_compare.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({k: out[k] for k in out if k not in ("intact", "ablated")}, indent=2))
    print("wrote", dest)
    return 0 if out["pass"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
