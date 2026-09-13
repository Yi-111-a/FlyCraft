# Bridge protocol (Event ↔ Action)

Transport for MVP: **newline-delimited JSON** on stdin/stdout between Python and Node (or headless injector).

## Event (inbound)

```json
{"type": "event", "name": "light_on", "t": 0, "payload": {}}
```

| Field | Type | Notes |
|-------|------|--------|
| `type` | string | always `"event"` |
| `name` | string | `light_on`, `player_near`, `attack`, `food_near`, `blank`, … |
| `t` | number | step or ms |
| `payload` | object | optional extras |

## Action (outbound)

```json
{"type": "action", "program": "flee", "commands": [{"op": "sprint_back", "ticks": 10}], "scores": {"flee": 0.9}}
```

| Field | Type | Notes |
|-------|------|--------|
| `type` | string | always `"action"` |
| `program` | string | chosen body program |
| `commands` | array | scripted ops for the bot |
| `scores` | object | optional program scores |

Mineflayer stub currently **prints** actions; connecting to a real server is `MC_HOST` TODO.

## Live observation

`live_bot.js` sends observations such as `{"health":20,"hurt":false,"hostile":{"name":"zombie","distance":3.1}}` to `python -m flycraft.sim.live_server`. The persistent Python process maps them to fixture sensory events (`hostile_near`, `attack`, `blank`), advances the graph, then applies documented safety/affordance score shaping before returning `fight`, `flee`, or `idle`.
