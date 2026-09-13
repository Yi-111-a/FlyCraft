# VPS notes

## Recommended (MVP / fixture)

| Item | Spec |
|------|------|
| OS | Ubuntu 22.04 or 24.04 LTS |
| RAM | **16–32 GB** |
| CPU | 4+ vCPU |
| Disk | ≥40 GB SSD |
| Python | 3.11+ |
| Node | 18+ (optional, Mineflayer stub only) |

Fixture-scale graphs need far less RAM; 16–32 GB leaves headroom for a Minecraft server + bot on the same box later.

## Setup sketch

```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv git build-essential
# optional: nodejs npm openjdk for a local MC server

cd /opt  # or home
# copy / clone flycraft tree
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
./scripts/run_headless.sh
```

## Firewall

- Minecraft Java default: TCP **25565** (only if you run a server).
- Do not expose the neural Python process publicly; talk via local stdin/stdout or localhost.

## Later: real MaleCNS subgraph

Expect higher RAM/CPU when adjacency becomes dense or node count grows into tens/hundreds of thousands. Keep fixture as CI default; load large graphs from attached storage, not git.
