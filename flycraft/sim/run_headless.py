"""CLI: headless FlyCraft demo (no Minecraft required)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from flycraft.sim.loop import load_config, run_closed_loop


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="FlyCraft headless neural → body-program demo")
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Path to YAML config (default: configs/default.yaml)",
    )
    parser.add_argument(
        "--shuffle-weights",
        action="store_true",
        help="Shuffle edge weights (control mode); topology unchanged",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit one JSON object per step on stdout",
    )
    args = parser.parse_args(argv)

    cfg = load_config(args.config)
    loop_cfg = cfg.get("loop", {})
    events = list(loop_cfg.get("events") or ["light_on", "player_near", "attack", "food_near", "blank"])

    print("FlyCraft headless demo", file=sys.stdout)
    print(f"  events={events}", file=sys.stdout)
    print(f"  shuffle_weights={args.shuffle_weights}", file=sys.stdout)
    print(f"  dynamics={cfg.get('dynamics', {}).get('model', 'rate')}", file=sys.stdout)
    print("---", file=sys.stdout)

    result = run_closed_loop(events, config=cfg, shuffle_weights=args.shuffle_weights)

    for log in result.logs:
        score_str = ", ".join(f"{k}={v:.3f}" for k, v in sorted(log.scores.items(), key=lambda x: -x[1])[:3])
        line = (
            f"step={log.step} event={log.event:12s} → program={log.program:14s} "
            f"mean_act={log.mean_activity:.4f} top=[{score_str}] cmds={len(log.commands)}"
        )
        if args.json:
            print(
                json.dumps(
                    {
                        "step": log.step,
                        "event": log.event,
                        "program": log.program,
                        "scores": log.scores,
                        "commands": log.commands,
                        "mean_activity": log.mean_activity,
                    }
                )
            )
        else:
            print(line)

    print("---", file=sys.stdout)
    print(f"done: {len(result.logs)} steps, exit 0", file=sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
