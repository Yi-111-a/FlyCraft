"""Short light RL bias tuner."""
from __future__ import annotations
import json, os, random
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parents[2]

def desired(obs):
    if obs["health"] <= 8 or (obs["hurt"] and obs["health"] <= 14):
        return "flee"
    if obs.get("hostile") and obs["hostile"]["distance"] <= 12:
        return "fight"
    return "idle"

def make_obs():
    hp = random.choice([20, 16, 12, 8, 5])
    dist = random.uniform(1.8, 11.0)
    return {"health": hp, "hurt": hp <= 10, "visible": True, "surrounding_count": random.randint(0, 2),
            "hostile": {"id": 1, "name": "husk", "distance": dist, "dy": 0},
            "hostiles": [{"id": 1, "name": "husk", "distance": dist, "dy": 0}]}

def train(steps=20, batch=5, lr=0.15, seed=0):
    print("[rl] loading controller once", flush=True)
    os.environ.pop("FLYCRAFT_ABLATION", None)
    from flycraft.sim.live_server import LiveController
    ctrl = LiveController(ROOT / "configs" / "malecns.yaml")
    rng = np.random.default_rng(seed)
    bias = np.zeros(3)
    history = []
    print("[rl] training", steps, "steps", flush=True)
    for t in range(steps):
        grad = np.zeros(3); reward_sum = 0.0
        for _ in range(batch):
            obs = make_obs(); out = ctrl.decide(obs); scores = out["scores"]
            logits = np.array([scores.get("fight",0.0)+bias[0], scores.get("flee",0.0)+bias[1], scores.get("idle",0.0)+bias[2]])
            e = np.exp(logits - logits.max()); probs = e/e.sum(); action=int(rng.choice(3,p=probs))
            target_i = {"fight":0,"flee":1,"idle":2}[desired(obs)]
            r = 1.0 if action==target_i else -0.2; reward_sum += r
            onehot=np.zeros(3); onehot[action]=1.0; grad += r*(onehot-probs)
        bias += lr*(grad/batch); bias=np.clip(bias,-0.4,0.4)
        avg_r=reward_sum/batch; history.append(float(avg_r))
        print(f"[rl] step={t} avg_r={avg_r:.3f} bias={bias}", flush=True)
    out={"bias":{"fight":float(bias[0]),"flee":float(bias[1]),"idle":float(bias[2])},"final_avg_r":history[-1],"history_tail":history[-5:],"steps":steps,"kept":False,"note":"Candidate only — keep iff live harness score improves vs baseline."}
    dest=ROOT/"artifacts"/"rl_bias.json"; dest.write_text(json.dumps(out,indent=2),encoding="utf-8")
    print("wrote", dest, flush=True); return out

if __name__ == "__main__":
    train()
