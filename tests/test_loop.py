"""Tests for closed-loop headless simulation."""

from __future__ import annotations

from flycraft.body.programs import PROGRAM_NAMES, run_program
from flycraft.sim.loop import load_config, run_closed_loop
from flycraft.sim.run_headless import main
from flycraft.sim.live_server import LiveController


def test_run_closed_loop_default_events():
    cfg = load_config()
    events = list(cfg["loop"]["events"])
    result = run_closed_loop(events, config=cfg, shuffle_weights=False)
    assert len(result.logs) == len(events)
    for log, ev in zip(result.logs, events):
        assert log.event == ev
        assert log.program in PROGRAM_NAMES
        assert log.commands == run_program(log.program)
        assert set(log.scores.keys()) >= set(PROGRAM_NAMES)


def test_shuffle_changes_or_runs():
    cfg = load_config()
    events = ["attack", "food_near", "light_on"]
    a = run_closed_loop(events, config=cfg, shuffle_weights=False, dynamics_seed=0)
    b = run_closed_loop(events, config=cfg, shuffle_weights=True, dynamics_seed=0)
    assert len(a.logs) == len(b.logs) == 3
    # programs may or may not differ; at least both complete
    assert all(log.program in PROGRAM_NAMES for log in b.logs)


def test_headless_cli_exit_zero():
    assert main([]) == 0
    assert main(["--shuffle-weights"]) == 0


def test_live_controller_fights_and_flees():
    controller = LiveController()
    fight = controller.decide({"health": 20, "hurt": False, "hostile": {"name": "zombie", "distance": 3.0}})
    assert fight["program"] == "fight"
    assert fight["neural_event"] == "hostile_near"
    flee = controller.decide({"health": 8, "hurt": True, "hostile": {"name": "zombie", "distance": 2.0}})
    assert flee["program"] == "flee"
    assert flee["neural_event"] == "attack"
    assert any(c["op"] == "attack" for c in fight["commands"])


def test_live_multi_target_prefers_closer():
    controller = LiveController()
    obs = {
        "health": 20,
        "hurt": False,
        "visible": True,
        "surrounding_count": 2,
        "hostile": {"id": 2, "name": "husk", "distance": 7.0, "dy": 0},
        "hostiles": [
            {"id": 1, "name": "husk", "distance": 3.0, "dy": 0},
            {"id": 2, "name": "husk", "distance": 7.0, "dy": 0},
        ],
    }
    out = controller.decide(obs)
    assert out["program"] == "fight"
    assert out["target_id"] == 1
    assert out["mode"] == "fight"


def test_live_state_machine_reengage():
    controller = LiveController()
    # Force flee
    a = controller.decide({
        "health": 5, "hurt": True, "visible": True, "surrounding_count": 1,
        "hostile": {"id": 1, "name": "husk", "distance": 2.0},
        "hostiles": [{"id": 1, "name": "husk", "distance": 2.0}],
    })
    assert a["mode"] == "flee" and a["program"] == "flee"
    # Recover HP but still inside flee_min window → stay flee
    b = controller.decide({
        "health": 16, "hurt": False, "visible": True, "surrounding_count": 1,
        "hostile": {"id": 1, "name": "husk", "distance": 4.0},
        "hostiles": [{"id": 1, "name": "husk", "distance": 4.0}],
    })
    assert b["mode"] == "flee"
    assert b["reason"] == "flee_min_window"
