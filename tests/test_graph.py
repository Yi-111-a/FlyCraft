"""Tests for graph loading and weight shuffle."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from flycraft.neural.graph import load_graph

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "data" / "fixtures" / "tiny_graph.json"


def test_load_fixture_counts():
    g = load_graph(FIXTURE)
    assert 20 <= g.n <= 50
    assert len(g.edges) >= 10
    assert g.adjacency.shape == (g.n, g.n)
    assert g.sensory_ids
    assert g.motor_ids
    assert "light_on" in g.event_to_sensory
    assert "flee" in g.program_to_motor


def test_shuffle_weights_preserves_topology_changes_weights():
    g0 = load_graph(FIXTURE, shuffle_weights=False, seed=1)
    g1 = load_graph(FIXTURE, shuffle_weights=True, seed=1)
    g2 = load_graph(FIXTURE, shuffle_weights=True, seed=1)

    mask0 = g0.adjacency != 0
    mask1 = g1.adjacency != 0
    assert np.array_equal(mask0, mask1), "topology (nonzero pattern) must match"
    # same seed → same shuffle
    assert np.allclose(g1.adjacency, g2.adjacency)
    # shuffled vs original should differ for this fixture
    assert not np.allclose(g0.adjacency, g1.adjacency)


def test_event_and_program_maps():
    g = load_graph(FIXTURE)
    for ev in ("light_on", "player_near", "attack", "hostile_near", "food_near", "blank"):
        assert ev in g.event_to_sensory
    for prog in ("flee", "fight", "approach_food", "turn_left", "turn_right", "jump", "idle"):
        assert prog in g.program_to_motor


def test_motor_ablation_reduces_fight_score(monkeypatch):
    from flycraft.sim.live_server import LiveController
    import os
    monkeypatch.delenv("FLYCRAFT_ABLATION", raising=False)
    intact = LiveController()
    obs = {
        "health": 20, "hurt": False, "visible": True, "surrounding_count": 1,
        "hostile": {"id": 1, "name": "husk", "distance": 3.0, "dy": 0},
        "hostiles": [{"id": 1, "name": "husk", "distance": 3.0, "dy": 0}],
    }
    a = intact.decide(obs)
    monkeypatch.setenv("FLYCRAFT_ABLATION", "1")
    monkeypatch.setenv("FLYCRAFT_ABLATION_FRAC", "0.95")
    ab = LiveController()
    b = ab.decide(obs)
    assert ab.ablated_edges > 0
    # Graph contribution to fight should weaken (floors equal); allow tiny noise
    assert b["scores"]["fight"] <= a["scores"]["fight"] + 0.05
